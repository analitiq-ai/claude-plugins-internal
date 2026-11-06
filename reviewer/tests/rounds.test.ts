import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { at, hold, pushbackRuling, releasedHold, round, sha, snapshot } from "../../core/tests/fixtures/state/issue.ts";
import type { Round, Ruling } from "../plugin/core/contracts/snapshot.ts";
import { FindingRuling, HoldKind, RoundResult, RoundStage, RoundVerdict } from "../plugin/core/values.ts";
import {
  adminFloor,
  deadlocks,
  placements,
  roundOf,
  roundResult,
  roundVerdict,
  specPrHold,
  type Assessment,
  type AssessedFinding,
} from "../plugin/lib/rules/rounds.ts";

const { INTERNAL, AUDIT, GITHUB } = RoundStage.schema.enum;
const { CLEAN, DIRTY, INCOMPLETE } = RoundResult.schema.enum;
const { PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK, ESCALATE } = RoundVerdict.schema.enum;
const { FIX, PUSH_BACK, DEFER } = FindingRuling.schema.enum;
const { escalation, pushback, audit, rescope } = HoldKind.schema.enum;

const ISSUE = 42;
// Neither is the repository's own value, so a constant in code shows.
const K_TOPIC = 2;
const MAX_AUDITS = 3;
const NOW = at("11:00");

/** A finding of kind defect, unless `fields` says otherwise. */
function finding(id: string, verdict: AssessedFinding["verdict"], reason = `why ${id}`, fields: Partial<AssessedFinding> = {}): AssessedFinding {
  return { id, verdict, reason, kind: "defect", spec_ref: "n/a", mechanism: `the mechanism of ${id}`, ...fields };
}

function assessment(fields: Partial<Assessment> & Pick<Assessment, "findings" | "round_verdict">): Assessment {
  return { user_decision: null, rationale: "the rationale", ...fields };
}

const NO_DEPARTURES = new Set<string>();

describe("roundResult (ADR-0021 d4)", () => {
  const expected = ["a:one", "a:two"];

  it("is INCOMPLETE when an expected agent is silent, even with findings from the others", () => {
    assert.equal(roundResult(expected, new Map([["a:one", { findings: [{}] }]])), INCOMPLETE);
  });

  it("is DIRTY when every expected agent reported and one found something", () => {
    assert.equal(roundResult(expected, new Map([["a:one", { findings: [] }], ["a:two", { findings: [{}] }]])), DIRTY);
  });

  it("is CLEAN when every expected agent reported nothing", () => {
    assert.equal(roundResult(expected, new Map([["a:one", { findings: [] }], ["a:two", { findings: [] }]])), CLEAN);
  });
});

describe("roundVerdict, the first clause of ADR-0017 d2 that matches", () => {
  it("is ESCALATE when a finding is ruled ESCALATE", () => {
    const raised = roundVerdict(
      assessment({ findings: [finding("cr-1", FIX), finding("cr-2", ESCALATE, "which owner keeps the cache")], round_verdict: PATCH }),
      NO_DEPARTURES,
      [],
    );
    assert.equal(raised.verdict, ESCALATE);
    assert.match(raised.question ?? "", /cr-2/);
    assert.match(raised.question ?? "", /which owner keeps the cache/);
  });

  for (const ruling of [PUSH_BACK, DEFER, ESCALATE]) {
    it(`is ESCALATE when an ADR departure is ruled ${ruling}`, () => {
      const raised = roundVerdict(
        assessment({ findings: [finding("dr-1", ruling, "the record is out of date")], round_verdict: CONVERGED_PUSHBACK }),
        new Set(["dr-1"]),
        [],
      );
      assert.equal(raised.verdict, ESCALATE);
      assert.match(raised.question ?? "", /dr-1/);
      assert.match(raised.question ?? "", /the record is out of date/);
    });
  }

  it("is not ESCALATE for an ADR departure ruled FIX", () => {
    const raised = roundVerdict(assessment({ findings: [finding("dr-1", FIX)], round_verdict: PATCH }), new Set(["dr-1"]), []);
    assert.deepEqual(raised, { verdict: PATCH, question: null });
  });

  it("is ESCALATE when the assessor cannot decide, asking what it says must be decided", () => {
    const raised = roundVerdict(
      assessment({
        findings: [finding("cr-1", PUSH_BACK)],
        round_verdict: ESCALATE,
        rationale: "the two readings of FR-3 both hold",
        user_decision: "Which reading of FR-3 is meant?",
      }),
      NO_DEPARTURES,
      [],
    );
    assert.equal(raised.verdict, ESCALATE);
    assert.match(raised.question ?? "", /the two readings of FR-3 both hold/);
    assert.match(raised.question ?? "", /Which reading of FR-3 is meant\?/);
  });

  it("is ESCALATE when a deadlock stands, naming the thread and its answers", () => {
    const raised = roundVerdict(assessment({ findings: [finding("gh-1", PUSH_BACK)], round_verdict: CONVERGED_PUSHBACK }), NO_DEPARTURES, [
      { key: "thread-PRRT_x", answers: 3 },
    ]);
    assert.equal(raised.verdict, ESCALATE);
    assert.match(raised.question ?? "", /thread-PRRT_x/);
    assert.match(raised.question ?? "", /\b3\b/);
  });

  it("is RESCOPE when the assessor finds the spec does not settle a decision (its RESHAPE_SPEC)", () => {
    const raised = roundVerdict(
      assessment({
        findings: [finding("cr-1", FIX)],
        round_verdict: "RESHAPE_SPEC",
        rationale: "the spec is silent on retries",
        user_decision: "How many retries does FR-9 allow?",
      }),
      NO_DEPARTURES,
      [],
    );
    assert.equal(raised.verdict, RESCOPE);
    assert.match(raised.question ?? "", /the spec is silent on retries/);
    assert.match(raised.question ?? "", /How many retries does FR-9 allow\?/);
  });

  it("asks in a RESCOPE's question for the open decision, after the rationale and each spec gap's mechanism with the spec decision it touches", () => {
    const raised = roundVerdict(
      assessment({
        findings: [
          finding("cr-1", FIX, "two rounds picked two roots", { kind: "spec_gap", mechanism: "the canonical root is chosen round by round", spec_ref: "FR-3" }),
          finding("cr-2", FIX, "no fallback root", { kind: "spec_gap", mechanism: "the fallback root is unnamed", spec_ref: "spec silent" }),
          finding("cr-3", FIX, "a null is dereferenced", { mechanism: "an unchecked null", spec_ref: "n/a" }),
        ],
        round_verdict: "RESHAPE_SPEC",
        rationale: "two rounds chose different roots",
        user_decision: "Which root is canonical?",
      }),
      NO_DEPARTURES,
      [],
    );
    assert.deepEqual(raised, {
      verdict: RESCOPE,
      question: [
        "The round rescoped because:",
        "- two rounds chose different roots",
        "- spec gap: the canonical root is chosen round by round (FR-3)",
        "- spec gap: the fallback root is unnamed (spec silent)",
        "To decide: Which root is canonical?",
      ].join("\n"),
    });
  });

  for (const verdict of [PATCH, CLASS_FIX, REDESIGN]) {
    it(`is the assessor's ${verdict} when at least one finding is ruled FIX`, () => {
      const raised = roundVerdict(assessment({ findings: [finding("cr-1", FIX), finding("cr-2", DEFER)], round_verdict: verdict }), NO_DEPARTURES, []);
      assert.deepEqual(raised, { verdict, question: null });
    });
  }

  it("is CONVERGED_PUSHBACK when every finding is ruled PUSH_BACK or DEFER", () => {
    const raised = roundVerdict(
      assessment({ findings: [finding("cr-1", PUSH_BACK), finding("cr-2", DEFER)], round_verdict: CONVERGED_PUSHBACK }),
      NO_DEPARTURES,
      [],
    );
    assert.deepEqual(raised, { verdict: CONVERGED_PUSHBACK, question: null });
  });

  it("takes ESCALATE over RESCOPE and a FIX when both match", () => {
    const raised = roundVerdict(
      assessment({
        findings: [finding("cr-1", FIX), finding("cr-2", ESCALATE)],
        round_verdict: "RESHAPE_SPEC",
        user_decision: "How many retries does FR-9 allow?",
      }),
      NO_DEPARTURES,
      [],
    );
    assert.equal(raised.verdict, ESCALATE);
  });

  it("takes RESCOPE over a FIX", () => {
    const raised = roundVerdict(
      assessment({ findings: [finding("cr-1", FIX)], round_verdict: "RESHAPE_SPEC", user_decision: "Which owner?" }),
      NO_DEPARTURES,
      [],
    );
    assert.equal(raised.verdict, RESCOPE);
  });

  it("refuses an assessment that rules a FIX yet names no verdict that fixes", () => {
    assert.throws(
      () => roundVerdict(assessment({ findings: [finding("cr-1", FIX)], round_verdict: CONVERGED_PUSHBACK }), NO_DEPARTURES, []),
      /FIX/,
    );
  });
});

describe("deadlocks: a thread of the round ruled k_topic times before", () => {
  function ruled(key: string, n: number): Ruling {
    return { ...pushbackRuling(key, n), round: { stage: GITHUB, n } };
  }

  it(`stands for a thread ruled ${K_TOPIC} times before`, () => {
    const rulings = [ruled("thread-A", 1), ruled("thread-A", 2), ruled("thread-B", 2)];
    assert.deepEqual(deadlocks([{ key: "thread-A" }, { key: "thread-B" }], rulings, K_TOPIC), [{ key: "thread-A", answers: K_TOPIC }]);
  });

  it("does not stand below k_topic", () => {
    assert.deepEqual(deadlocks([{ key: "thread-A" }], [ruled("thread-A", 1)], K_TOPIC), []);
  });
});

describe("roundOf: a round report as core's Round", () => {
  const launched = { stage: INTERNAL, run: "wf_1a2b3c4d-5e6", head: sha(7) };

  it("numbers the round after the stage's rounds in the snapshot, whatever the other stages hold", () => {
    const audits = [1, 2, 3].map((n) => round(n, { stage: AUDIT, run: `run-a${n}` }));
    const before = snapshot({ rounds: [round(1), round(2), ...audits] });
    const made = roundOf(before, launched, CLEAN, null, NOW);
    assert.deepEqual(made, { stage: INTERNAL, n: 3, run: launched.run, head: sha(7), result: CLEAN, verdict: null, root_cause: null, at: NOW });
  });

  it("is round 1 of a story with no state", () => {
    assert.equal(roundOf(null, launched, CLEAN, null, NOW).n, 1);
  });

  it("carries a DIRTY round's verdict", () => {
    const made = roundOf(null, launched, DIRTY, { verdict: PATCH, question: null }, NOW);
    assert.equal(made.verdict, PATCH);
  });
});

describe("adminFloor (ADR-0019 d5)", () => {
  it("is the newest of the reset and any hold's release", () => {
    const holds = [
      releasedHold("pushback-42", 8, { released: at("10:20") }),
      releasedHold("escalation-42", 9, { released: at("10:30") }),
      releasedHold("claim-L1", 10, { released: at("10:25") }),
      hold("audit-42"),
    ];
    const reading = { snapshot: snapshot({ holds }), reset: { url: "u", at: at("10:10") } };
    assert.equal(adminFloor(reading), at("10:30"));
    assert.equal(adminFloor({ ...reading, reset: { url: "u", at: at("10:40") } }), at("10:40"));
  });

  it("is null before either", () => {
    assert.equal(adminFloor({ snapshot: snapshot({ holds: [hold("pushback-42")] }), reset: null }), null);
    assert.equal(adminFloor({ snapshot: null, reset: null }), null);
  });
});

describe("placements: the holds a round places (ADR-0013 d4–d5)", () => {
  const settings = { max_audits: MAX_AUDITS };
  const base = { issue: ISSUE, snapshot: snapshot(), question: null, ruledFix: false, blockers: [] as string[], floor: null };

  function dirty(stage: Round["stage"], verdict: Round["verdict"], n = 1): Round {
    return round(n, { stage, result: DIRTY, verdict, at: NOW, run: `run-${stage}-${n}` });
  }

  it("places escalation-<issue> with its question on ESCALATE", () => {
    const placed = placements({ ...base, round: dirty(INTERNAL, ESCALATE), question: "Why, and what to decide." }, settings);
    assert.deepEqual(placed, [{ id: `${escalation}-${ISSUE}`, kind: escalation, question: "Why, and what to decide." }]);
  });

  it("places rescope-<issue> with its question on RESCOPE", () => {
    const placed = placements({ ...base, round: dirty(INTERNAL, RESCOPE), question: "Which owner?" }, settings);
    assert.deepEqual(placed, [{ id: `${rescope}-${ISSUE}`, kind: rescope, question: "Which owner?" }]);
  });

  it("places pushback-<issue> when a github round rules no FIX while a merge blocker fails at the head", () => {
    const placed = placements({ ...base, round: dirty(GITHUB, CONVERGED_PUSHBACK), blockers: ["ci / tests"] }, settings);
    assert.deepEqual(placed, [{ id: `${pushback}-${ISSUE}`, kind: pushback, question: null }]);
  });

  it("places no pushback hold when the github round rules a FIX, or no blocker fails, or the round is not github", () => {
    assert.deepEqual(placements({ ...base, round: dirty(GITHUB, PATCH), ruledFix: true, blockers: ["ci / tests"] }, settings), []);
    assert.deepEqual(placements({ ...base, round: dirty(GITHUB, CONVERGED_PUSHBACK) }, settings), []);
    assert.deepEqual(placements({ ...base, round: dirty(INTERNAL, CONVERGED_PUSHBACK), blockers: ["ci / tests"] }, settings), []);
  });

  it(`places audit-<issue> at the ${MAX_AUDITS}th audit ruled other than CONVERGED_PUSHBACK since the floor`, () => {
    const earlier = snapshot({
      rounds: [
        { ...dirty(AUDIT, REDESIGN, 1), at: at("10:05") },
        { ...dirty(AUDIT, CONVERGED_PUSHBACK, 2), at: at("10:06") },
        { ...dirty(AUDIT, CLASS_FIX, 3), at: at("10:00") },
        { ...dirty(AUDIT, PATCH, 4), at: at("09:00") },
        { ...dirty(INTERNAL, REDESIGN, 1), at: at("10:07") },
      ],
    });
    const third = dirty(AUDIT, REDESIGN, 5);
    // Since 09:30: audits 1 and 3, then this one; audit 2 converged, audit 4 is before the floor, and an internal
    // round is no audit.
    const counted = { ...base, snapshot: earlier, floor: at("09:30") };
    assert.deepEqual(placements({ ...counted, round: third }, settings), [{ id: `${audit}-${ISSUE}`, kind: audit, question: null }]);
    assert.deepEqual(placements({ ...counted, round: dirty(AUDIT, CONVERGED_PUSHBACK, 5) }, settings), []);
    assert.deepEqual(placements({ ...counted, floor: at("10:01"), round: third }, settings), []);
  });

  it("counts the round being recorded whatever its at, which core stamps when it writes", () => {
    const earlier = snapshot({ rounds: [{ ...dirty(AUDIT, REDESIGN, 1), at: at("10:05") }, { ...dirty(AUDIT, CLASS_FIX, 2), at: at("10:06") }] });
    const unstamped = { ...dirty(AUDIT, REDESIGN, 3), at: at("09:00") };
    const placed = placements({ ...base, snapshot: earlier, floor: at("09:30"), round: unstamped }, settings);
    assert.deepEqual(placed, [{ id: `${audit}-${ISSUE}`, kind: audit, question: null }]);
  });

  it("places nothing for a CLEAN round", () => {
    assert.deepEqual(placements({ ...base, round: round(2, { at: NOW }) }, settings), []);
  });
});

describe("specPrHold: a rescope's spec PR seen open (ADR-0013 d5)", () => {
  it("is the open spec PR's number", () => {
    assert.equal(specPrHold({ number: 77, state: "open" }), 77);
  });

  it("is null for a closed or merged spec PR, or none", () => {
    assert.equal(specPrHold({ number: 77, state: "closed" }), null);
    assert.equal(specPrHold({ number: 77, state: "merged" }), null);
    assert.equal(specPrHold(null), null);
  });
});
