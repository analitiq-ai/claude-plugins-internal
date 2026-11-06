import type { Finding } from "../../core/contracts/finding.ts";
import type { Pushback, Round, Ruling, Snapshot } from "../../core/contracts/snapshot.ts";
import type { GitHubClient } from "../../core/github.ts";
import { specIssue, specPr } from "../../core/identity.ts";
import { placeRescopeHold, writeState, type Placement, type StateReading } from "../../core/state.ts";
import { FindingRuling, REQUIRED_CHECKS_SOURCE, RoundResult, RoundStage } from "../../core/values.ts";
import { orCouldNotRun } from "../hook-io.ts";
import type { RunState } from "../run-state.ts";
import type { ReviewerSettings } from "../settings.ts";
import {
  adminFloor,
  deadlocks,
  placements,
  roundOf,
  roundResult,
  roundVerdict,
  specPrHold,
  type AssessedFinding,
  type Assessment,
  type Launched,
} from "../rules/rounds.ts";

const { CLEAN, DIRTY, INCOMPLETE } = RoundResult.schema.enum;
const { GITHUB } = RoundStage.schema.enum;
const { FIX, PUSH_BACK } = FindingRuling.schema.enum;

/** The agent whose findings are departures from an accepted decision, each ruled FIX or ESCALATE (ADR-0022 d4). */
export const DECISION_REVIEWER = "reviewer:decision-reviewer";

/** A launched round whose run has ended, with the answers it got. */
export type DecidedRun = {
  launched: Launched;
  /** The agent types whose reports the launch expects. */
  expected: readonly string[];
  /** The reports that came, by agent type. */
  reports: ReadonlyMap<string, { findings: readonly { id: string }[] }>;
  /** Null while the assessor is silent. */
  assessment: Assessment | null;
  /** A github round's findings, as its launch read them through core's modules (ADR-0016 d1). */
  findings: readonly Finding[];
};

/** What a hook run records with; `writer` gives the reviewer App's client, minted when first asked for. */
export type Recorder = {
  state: RunState;
  writer: () => Promise<GitHubClient>;
  settings: Pick<ReviewerSettings, "max_audits" | "k_topic">;
};

/** What a decided run appends to the story, and the holds it places. */
type Recording = { next: Snapshot; placements: Placement[] };

const EMPTY: Snapshot = { v: 1, rounds: [], holds: [], pushbacks: [], rulings: [], gates: null };

function isGithub(run: DecidedRun): boolean {
  return run.launched.stage === GITHUB;
}

// The assess phase follows the reviewers (ADR-0019 d1): a round that found something and has no assessment has a
// silent expected agent (ADR-0021 d4).
function resultOf(run: DecidedRun): Round["result"] {
  const found = isGithub(run) ? (run.findings.length > 0 ? DIRTY : CLEAN) : roundResult(run.expected, run.reports);
  return found === DIRTY && run.assessment === null ? INCOMPLETE : found;
}

function foundIds(run: DecidedRun): string[] {
  if (isGithub(run)) return run.findings.map(({ key }) => key);
  return [...run.reports.values()].flatMap(({ findings }) => findings.map(({ id }) => id));
}

/** The assessment's ruling of each id in `found`, in its order; an assessment ruling any other set is refused. */
function rulingsOf(assessment: Assessment, found: readonly string[]): AssessedFinding[] {
  const ruled = new Map(assessment.findings.map((each) => [each.id, each]));
  const inOrder = found.flatMap((id) => ruled.get(id) ?? []);
  if (inOrder.length !== found.length || ruled.size !== found.length || assessment.findings.length !== found.length) {
    const named = (ids: readonly string[]) => (ids.length === 0 ? "nothing" : ids.join(", "));
    throw new TypeError(`the assessment rules ${named(assessment.findings.map(({ id }) => id))} where the round found ${named(found)}`);
  }
  return inOrder;
}

/** A github round's rulings and pushbacks, and the merge blockers left failing; `ruled[i]` rules `findings[i]`. */
function githubRecords(findings: readonly Finding[], ruled: readonly AssessedFinding[], { stage, n }: Round) {
  const round = { stage, n };
  const pairs = findings.map((finding, i) => ({ finding, ruled: ruled[i] }));
  const rulings: Ruling[] = pairs.map(({ finding, ruled: { verdict, reason } }) => ({
    key: finding.key,
    round,
    ruling: verdict,
    latest_trusted_comment_id: finding.latest_trusted_comment_id,
    // Only a thread takes a reply; a finding with no thread is closed by its recorded fix or pushback (ADR-0016 d3).
    reply: finding.thread_id === null ? null : reason,
    commits: [],
  }));
  const noThread = pairs.filter(({ finding }) => finding.thread_id === null);
  const pushbacks: Pushback[] = noThread.filter(({ ruled }) => ruled.verdict === PUSH_BACK).map(({ finding }) => ({ key: finding.key, round }));
  // A thread is left to its reply. A pushback closes a finding with no thread but makes no failing required check pass.
  const blockers = noThread
    .filter(({ finding, ruled }) => finding.source === REQUIRED_CHECKS_SOURCE || ruled.verdict !== PUSH_BACK)
    .map(({ finding }) => finding.key);
  return { rulings, pushbacks, blockers };
}

/** Null for a run already recorded; otherwise the recording, given the round's time. */
function decide(reading: StateReading, run: DecidedRun, issue: number, settings: Recorder["settings"]): ((at: string) => Recording) | null {
  const { snapshot } = reading;
  if (snapshot?.rounds.some((round) => round.run === run.launched.run)) return null;
  const result = resultOf(run);
  const { assessment } = run;
  const ruled = assessment === null ? [] : rulingsOf(assessment, foundIds(run));
  const threads = isGithub(run) ? run.findings.filter(({ thread_id }) => thread_id !== null) : [];
  const departures = new Set(run.reports.get(DECISION_REVIEWER)?.findings.map(({ id }) => id) ?? []);
  const raised = result === DIRTY && assessment !== null ? roundVerdict(assessment, departures, deadlocks(threads, snapshot?.rulings ?? [], settings.k_topic)) : null;
  return (at) => {
    const round = roundOf(snapshot, run.launched, result, raised, at);
    const github = isGithub(run) && assessment !== null ? githubRecords(run.findings, ruled, round) : null;
    const base = snapshot ?? EMPTY;
    const next = {
      ...base,
      rounds: [...base.rounds, round],
      rulings: [...base.rulings, ...(github?.rulings ?? [])],
      pushbacks: [...base.pushbacks, ...(github?.pushbacks ?? [])],
    };
    const placing = {
      issue,
      snapshot,
      round,
      question: raised?.question ?? null,
      ruledFix: ruled.some(({ verdict }) => verdict === FIX),
      blockers: github?.blockers ?? [],
      floor: adminFloor(reading),
    };
    return { next, placements: placements(placing, settings) };
  };
}

/** Records a decided run as its round, with what a github round rules and the holds the round places: one commit. */
export async function recordRound({ state, writer, settings }: Recorder, run: DecidedRun): Promise<void> {
  const { reader, repo, issue, shared } = state.source;
  await state.step(
    (reading) => decide(reading, run, issue, settings),
    async (reading, recording) => {
      if (recording === null) return reading;
      const w = await writer();
      // Core stamps its own clock over the round's `at`; the writer is minted only once there is a write.
      const { next, placements: placed } = recording(await w.now());
      return writeState(reader, w, repo, issue, shared, reading, next, placed);
    },
  );
}

/** Places `rescope-<issue>` for the story's spec PR while it is open (ADR-0013 d5); core places nothing twice for one PR. */
export async function recordSpecPrRescope({ state, writer }: Recorder): Promise<void> {
  const { reader, repo, issue, shared } = state.source;
  const open = specPrHold(await orCouldNotRun(specIssue(reader, repo, issue).then((spec) => specPr(reader, repo, spec))));
  if (open === null) return;
  await state.step(
    () => open,
    async (reading, pr) => placeRescopeHold(reader, await writer(), repo, issue, shared, reading, pr),
  );
}
