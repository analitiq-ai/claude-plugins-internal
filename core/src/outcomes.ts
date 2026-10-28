import type { z } from "zod";

import { GitHubUnanswered } from "./github.ts";
import { CheckOutcome } from "./values.ts";

type Outcome = z.infer<typeof CheckOutcome.schema>;

const { PENDING, PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;

/** Every `status` answer; `reason` is set for SILENT, WAIVED and COULD_NOT_RUN. */
export type StatusAnswer = { outcome: Outcome; reason: string | null };

/** What a `findings` returns in place of its list: never an empty list, which would read as nothing found. */
export type CouldNotRun = { outcome: typeof CheckOutcome.schema.enum.COULD_NOT_RUN; reason: string };

/** The reason names `source` first, so a caller reading several checks can tell whose it is. */
export function couldNotRun(source: string, why: string): CouldNotRun {
  return { outcome: COULD_NOT_RUN, reason: `${source}: ${why}` };
}

/** GitHub's no-answer as `source`'s COULD_NOT_RUN, the outcome of a check that could not read. */
export function couldNotRunIfUnanswered(source: string, error: unknown): CouldNotRun {
  // Any other error is core's own, not the check's outcome.
  if (!(error instanceof GitHubUnanswered)) throw error;
  return couldNotRun(source, error.message);
}

type CheckRun = { status: string; conclusion: string | null };
type CommitStatus = { state: string };

// A check run's conclusions and a commit status's states share one table: no name means one thing in one and
// another in the other. `neutral` and `skipped` pass because GitHub's required checks count them as passing.
const OUTCOME_OF_STATE: ReadonlyMap<string, Outcome> = new Map([
  ["success", PASS],
  ["neutral", PASS],
  ["skipped", PASS],
  ["failure", FAIL],
  ["error", COULD_NOT_RUN],
  ["cancelled", COULD_NOT_RUN],
  ["timed_out", COULD_NOT_RUN],
  ["action_required", COULD_NOT_RUN],
  ["startup_failure", COULD_NOT_RUN],
  ["stale", COULD_NOT_RUN],
  ["pending", PENDING],
]);

const COMPLETED = "completed";

/** A required check at the head, `undefined` when GitHub has neither a check run nor a status for it. */
export function outcomeOf(checkRunOrStatus: CheckRun | CommitStatus | undefined): Outcome {
  if (checkRunOrStatus === undefined) return PENDING;
  let state: string | null;
  if ("state" in checkRunOrStatus) state = checkRunOrStatus.state;
  // A check run has a conclusion only once completed; every status before that, whatever GitHub names it, is no
  // reading yet.
  else if (checkRunOrStatus.status === COMPLETED) state = checkRunOrStatus.conclusion;
  else return PENDING;
  const outcome = state === null ? undefined : OUTCOME_OF_STATE.get(state);
  // Read as any outcome, a state GitHub has added could pass or fail a head nobody graded.
  if (outcome === undefined) throw new Error(`GitHub's check state ${JSON.stringify(state)} has no check outcome`);
  return outcome;
}
