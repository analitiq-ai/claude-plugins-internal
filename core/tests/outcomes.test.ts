import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { GitHubMisanswered } from "../src/github.ts";
import { outcomeOf } from "../src/outcomes.ts";
import { CheckOutcome } from "../src/values.ts";

const { PENDING, PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;

// A concluded check run's conclusion and a commit status's state share one mapping.
const CONCLUDED = [
  { state: "success", outcome: PASS },
  { state: "neutral", outcome: PASS },
  { state: "skipped", outcome: PASS },
  { state: "failure", outcome: FAIL },
  { state: "error", outcome: COULD_NOT_RUN },
  { state: "cancelled", outcome: COULD_NOT_RUN },
  { state: "timed_out", outcome: COULD_NOT_RUN },
  { state: "action_required", outcome: COULD_NOT_RUN },
  { state: "startup_failure", outcome: COULD_NOT_RUN },
  { state: "stale", outcome: COULD_NOT_RUN },
];

function completedRun(conclusion: string) {
  return { status: "completed", conclusion };
}

describe("outcomeOf", () => {
  for (const { state, outcome } of CONCLUDED) {
    it(`a check run concluded ${state} is ${outcome}`, () => {
      assert.equal(outcomeOf(completedRun(state)), outcome);
    });

    it(`a commit status in ${state} is ${outcome}`, () => {
      assert.equal(outcomeOf({ state }), outcome);
    });
  }

  // GitHub's statuses of a check run with no conclusion yet.
  for (const status of ["queued", "in_progress", "pending", "waiting", "requested"]) {
    it(`a check run ${status} is PENDING`, () => {
      assert.equal(outcomeOf({ status, conclusion: null }), PENDING);
    });
  }

  it("a commit status pending is PENDING", () => {
    assert.equal(outcomeOf({ state: "pending" }), PENDING);
  });

  it("an absent check is PENDING", () => {
    assert.equal(outcomeOf(undefined), PENDING);
  });

  it("a check run's conclusion or a commit status's state outside GitHub's throws GitHubMisanswered naming it, never read as an outcome", () => {
    for (const [answer, named] of [
      [completedRun("exploded"), /"exploded"/],
      [{ state: "constructor" }, /"constructor"/],
      [{ status: "completed", conclusion: null }, /null/],
    ] as const) {
      assert.throws(() => outcomeOf(answer), (error: unknown) => {
        assert.ok(error instanceof GitHubMisanswered, `expected GitHubMisanswered, got ${String(error)}`);
        assert.match(error.message, named);
        return true;
      });
    }
  });
});
