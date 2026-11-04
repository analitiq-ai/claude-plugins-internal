import { laneOf, moveCard } from "../core/board.ts";
import type { GitHubClient } from "../core/github.ts";
import { isDone, specIssue, specPrs, type SpecPr } from "../core/identity.ts";
import { blockedBy, subIssues } from "../core/issue-graph.ts";
import { writeSessionRecord } from "../core/session-record.ts";
import type { Shared } from "../core/settings.ts";
import { readState, type StateCause, type StateReading } from "../core/state.ts";
import { Lane, Taken } from "../core/values.ts";
import { postKeyed } from "./keyed.ts";

export type CardFacts = {
  lane: Lane;
  blockers: { issue: number; done: boolean }[];
  specIssue: number;
  specPrs: SpecPr[];
  subIssues: number[];
  done: boolean;
  state: StateReading;
};

export type StartFacts = { lane: null } | CardFacts;

export type StartDecision =
  | { decision: "start" }
  | { decision: "resume" }
  // A `key` is posted with the reason as its text before the card moves; `blocked` moves the card to Blocked.
  | { decision: "refuse"; reason: string; key: string | null; blocked: boolean };

/** What the start is decided from, read with the orchestrator App's client (R9). */
export async function gatherStartFacts(client: GitHubClient, repo: string, issue: number, shared: Shared): Promise<StartFacts> {
  const lane = await laneOf(client, repo, issue, shared.board);
  // readState refuses an issue with no item on the board, and no card decides the refusal alone.
  if (lane === null) return { lane: null };
  const blockers = await Promise.all(
    (await blockedBy(client, repo, issue)).map(async (blocker) => ({ issue: blocker, done: await isDone(client, repo, blocker) })),
  );
  const p = await specIssue(client, repo, issue);
  return {
    lane,
    blockers,
    specIssue: p,
    specPrs: await specPrs(client, repo, p),
    subIssues: await subIssues(client, repo, issue),
    done: await isDone(client, repo, issue),
    state: await readState(client, repo, issue, shared),
  };
}

function refuse(reason: string, key: string | null = null, blocked = false): StartDecision {
  return { decision: "refuse", reason, key, blocked };
}

const issues = (numbers: readonly number[]) => numbers.map((number) => `#${number}`).join(", ");

function causeOf(cause: StateCause): string {
  switch (cause.cause) {
    case "tampered":
      return cause.remaining.length === 0 ? cause.id : `${cause.id} (an admin deletes ${cause.remaining.join(", ")} from ledger)`;
    case "open_hold":
      return `open hold ${cause.id}`;
  }
}

const LANE_STEPS: Record<"Backlog" | "Blocked" | "Done", string> = {
  Backlog: "an admin moves it to Ready to start it",
  Blocked: "an admin moves it to Ready once its reason is handled",
  Done: "there is nothing left to build",
};

/** The start rules of data-model.md, in its order: a rule that writes nothing refuses before one that writes. */
export function decideStart(issue: number, facts: StartFacts): StartDecision {
  const s = `#${issue}`;
  if (facts.lane === null) return refuse(`${s} has no card on the board: an admin adds it and moves it to Ready`);
  const held = `${s} is held by ${facts.state.causes.map(causeOf).join(", ")}: an admin answers it, then moves ${s} to Ready`;
  switch (facts.lane) {
    case "In progress":
    case "In review":
      return facts.state.held ? refuse(held, null, true) : { decision: "resume" };
    case "Ready":
      break;
    default:
      return refuse(`${s} is in ${facts.lane}: ${LANE_STEPS[facts.lane]}`);
  }
  if (facts.done) return refuse(`${s} is done: there is nothing left to build`);
  const notDone = facts.blockers.filter((blocker) => !blocker.done).map((blocker) => blocker.issue);
  if (notDone.length > 0) return refuse(`${s} is blocked by ${issues(notDone)}, not done: start it once they are`);
  if (facts.subIssues.length > 0) {
    return refuse(`${s} has sub-issues ${issues(facts.subIssues)}: name one of them in /codeworks instead`, `parent-${issue}`, true);
  }
  const p = `#${facts.specIssue}`;
  const open = facts.specPrs.find((pr) => pr.state === "open");
  if (open !== undefined) {
    const step = `merge or close it, then an admin moves ${s} to Ready`;
    return refuse(`${p}'s spec PR #${open.number} is open: ${step}`, `spec-pr-open-${facts.specIssue}`, true);
  }
  if (!facts.specPrs.some((pr) => pr.state === "merged")) {
    const step = `merge one, then an admin moves ${s} to Ready`;
    return refuse(`${p} has no merged spec PR: ${step}`, `spec-pr-unmerged-${facts.specIssue}`, true);
  }
  if (!facts.state.startable) return refuse(held, null, true);
  return { decision: "start" };
}

export type StartWrites = {
  client: GitHubClient;
  repo: string;
  issue: number;
  shared: Shared;
  /** The folder of session records, and this session's id. */
  sessions: string;
  sessionId: string;
};

/**
 * Writes `decision` in data-model.md's order: the reason, then the lane, then the record. The lane is the commit
 * point (ADR-0002 d5), so a failed lane write leaves no record, and reviewer releases nothing (FR-015).
 */
export async function applyStart(decision: StartDecision, at: StartWrites): Promise<void> {
  const { client, repo, issue, shared } = at;
  if (decision.decision === "refuse") {
    if (decision.key !== null) await postKeyed(client, repo, issue, decision.key, decision.reason, shared.orchestrator_app_login);
    if (decision.blocked) await moveCard(client, repo, issue, shared.board, Lane.schema.enum.Blocked);
    return;
  }
  if (decision.decision === "start") await moveCard(client, repo, issue, shared.board, Lane.schema.enum["In progress"]);
  const taken = decision.decision === "start" ? Taken.schema.enum.claim : Taken.schema.enum.resume;
  writeSessionRecord(at.sessions, at.sessionId, { v: 1, repo, issue, taken, at: await client.now() });
}
