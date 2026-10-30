import { laneOf } from "../core/board.ts";
import type { GitHubClient } from "../core/github.ts";
import { isDone, specIssue, specPr, type SpecPr } from "../core/identity.ts";
import { blockedBy, subIssues } from "../core/issue-graph.ts";
import type { Shared } from "../core/settings.ts";
import { readState, type StateCause, type StateReading } from "../core/state.ts";
import type { Lane } from "../core/values.ts";

export type CardFacts = {
  lane: Lane;
  blockers: { issue: number; done: boolean }[];
  specIssue: number;
  specPr: SpecPr | null;
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
    specPr: await specPr(client, repo, p),
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
      return "an edited reviewer state comment";
    case "deleted":
      return "a deleted reviewer state comment";
    case "invalid":
      return `an invalid reviewer state (${cause.error})`;
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
  if (facts.specPr?.state === "open") {
    const step = `merge or close it, then an admin moves ${s} to Ready`;
    return refuse(`${p}'s spec PR #${facts.specPr.number} is open: ${step}`, `spec-pr-open-${facts.specIssue}`, true);
  }
  if (facts.specPr?.state !== "merged") {
    const step = `merge one, then an admin moves ${s} to Ready`;
    return refuse(`${p} has no merged spec PR: ${step}`, `spec-pr-unmerged-${facts.specIssue}`, true);
  }
  if (!facts.state.startable) return refuse(held, null, true);
  return { decision: "start" };
}
