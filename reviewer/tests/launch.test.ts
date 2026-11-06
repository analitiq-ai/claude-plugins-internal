import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { at, hold, releasedHold, round, SHARED, sha, snapshot } from "../../core/tests/fixtures/state/issue.ts";
import type { Round, Snapshot } from "../plugin/core/contracts/snapshot.ts";
import type { StateReading, Tamper } from "../plugin/core/state.ts";
import { HoldKind, Lane, RoundResult, RoundStage, RoundVerdict } from "../plugin/core/values.ts";
import { launchDecision, type LaunchAsk } from "../plugin/lib/rules/launch.ts";

const { INTERNAL, AUDIT, GITHUB } = RoundStage.schema.enum;
const { CLEAN, DIRTY, INCOMPLETE } = RoundResult.schema.enum;
const { escalation, pushback, audit, claim, shim, rescope } = HoldKind.schema.enum;

const ISSUE = 42;
// Not the repository's own value, so a constant in code shows.
const SETTINGS = { max_rounds: 2 };
const ASK: LaunchAsk = { issue: ISSUE, stage: INTERNAL, lane: Lane.schema.enum["In progress"], off: false };

function reading(state: Snapshot | null, fields: Partial<StateReading> = {}): StateReading {
  return {
    head: sha(900),
    snapshot: state,
    held: false,
    causes: [],
    tamper: [],
    newest_round: state?.rounds.at(-1) ?? null,
    pushed_back: new Map(),
    releasable: [],
    startable: true,
    reset: null,
    ...fields,
  };
}

function refusal(decision: ReturnType<typeof launchDecision>): string {
  assert.ok("refused" in decision, `expected a refusal, got ${JSON.stringify(decision)}`);
  return decision.refused;
}

describe("launchDecision: a round launch refused while a hold refuses rounds (ADR-0013 d4)", () => {
  for (const kind of [escalation, pushback, audit]) {
    it(`refuses while ${kind}-<issue> is OPEN, naming it and its release`, () => {
      const id = `${kind}-${ISSUE}`;
      const reason = refusal(launchDecision(reading(snapshot({ holds: [hold(id)] })), ASK, SHARED, SETTINGS));
      assert.match(reason, new RegExp(id));
      assert.match(reason, /admin's comment/);
      assert.match(reason, /Ready/);
      assert.ok(reason.includes(SHARED.board), reason);
    });
  }

  for (const id of [`${claim}-L1`, `${shim}-B1`, `${rescope}-${ISSUE}`]) {
    it(`launches while ${id} is OPEN`, () => {
      assert.deepEqual(launchDecision(reading(snapshot({ holds: [hold(id)] })), ASK, SHARED, SETTINGS), { stage: INTERNAL });
    });
  }

  it("launches once the hold is RELEASED", () => {
    const released = snapshot({ holds: [releasedHold(`${escalation}-${ISSUE}`, 9)] });
    assert.deepEqual(launchDecision(reading(released), ASK, SHARED, SETTINGS), { stage: INTERNAL });
  });
});

describe("launchDecision: refusals that come before the holds", () => {
  const roundHold = `${escalation}-${ISSUE}`;
  const withRoundHold = snapshot({ holds: [hold(roundHold)] });

  it("refuses while an unreleased tamper stands, naming its commit, the files left and the release", () => {
    const tamper: Tamper = { id: `tamper-${sha(5)}`, commit: sha(5), at: at("10:00"), remaining: ["issues/42/round.x.json"], releasable: null, released: null, released_by: null };
    const reason = refusal(launchDecision(reading(withRoundHold, { tamper: [tamper], held: true }), ASK, SHARED, SETTINGS));
    assert.doesNotMatch(reason, new RegExp(roundHold));
    assert.match(reason, new RegExp(sha(5)));
    assert.match(reason, /issues\/42\/round\.x\.json/);
    assert.match(reason, /admin/);
    assert.match(reason, /Ready/);
  });

  it("launches past a released tamper", () => {
    const tamper: Tamper = {
      id: `tamper-${sha(5)}`,
      commit: sha(5),
      at: at("10:00"),
      remaining: [],
      releasable: null,
      released: at("10:30"),
      released_by: { comment: 9, reset: false },
    };
    assert.deepEqual(launchDecision(reading(snapshot(), { tamper: [tamper] }), ASK, SHARED, SETTINGS), { stage: INTERNAL });
  });

  for (const lane of [Lane.schema.enum.Blocked, Lane.schema.enum.Backlog]) {
    it(`refuses while the issue is in ${lane}, naming the lane and an admin's move to Ready (ADR-0015 d3)`, () => {
      const reason = refusal(launchDecision(reading(withRoundHold), { ...ASK, lane }, SHARED, SETTINGS));
      assert.doesNotMatch(reason, new RegExp(roundHold));
      assert.match(reason, new RegExp(lane));
      assert.match(reason, /admin/);
      assert.match(reason, /Ready/);
    });
  }

  it("refuses while reviewer is off, naming `reviewer on` (ADR-0006 d4)", () => {
    const reason = refusal(launchDecision(reading(withRoundHold), { ...ASK, off: true }, SHARED, SETTINGS));
    assert.doesNotMatch(reason, new RegExp(roundHold));
    assert.match(reason, /reviewer on/);
  });
});

describe("launchDecision: past max_rounds a stage's next round is the audit (ADR-0019 d5)", () => {
  const dirty = (n: number, stage: Round["stage"] = INTERNAL, clock = "09:00") =>
    round(n, { stage, result: DIRTY, verdict: RoundVerdict.schema.enum.PATCH, run: `run-${stage}-${n}`, at: at(clock) });

  it(`launches the asked stage below max_rounds`, () => {
    assert.deepEqual(launchDecision(reading(snapshot({ rounds: [dirty(1)] })), ASK, SHARED, SETTINGS), { stage: INTERNAL });
    const github = launchDecision(reading(snapshot({ rounds: [dirty(1, GITHUB)] })), { ...ASK, stage: GITHUB }, SHARED, SETTINGS);
    assert.deepEqual(github, { stage: GITHUB });
  });

  it(`runs the audit stage once the stage took max_rounds rounds`, () => {
    assert.deepEqual(launchDecision(reading(snapshot({ rounds: [dirty(1), dirty(2)] })), ASK, SHARED, SETTINGS), { stage: AUDIT });
  });

  it("leaves out an INCOMPLETE round and another stage's", () => {
    const rounds = [dirty(1), round(2, { result: INCOMPLETE, run: "run-i2" }), dirty(1, GITHUB)];
    assert.deepEqual(launchDecision(reading(snapshot({ rounds })), ASK, SHARED, SETTINGS), { stage: INTERNAL });
  });

  it("caps the github stage the same way", () => {
    const rounds = [dirty(1, GITHUB), dirty(2, GITHUB)];
    assert.deepEqual(launchDecision(reading(snapshot({ rounds })), { ...ASK, stage: GITHUB }, SHARED, SETTINGS), { stage: AUDIT });
  });

  // Two rounds before the floor at 09:30, then `count` after it.
  const aroundFloor = (count: number) => [
    dirty(1, INTERNAL, "09:00"),
    dirty(2, INTERNAL, "09:10"),
    ...Array.from({ length: count }, (_, i) => dirty(3 + i, INTERNAL, `09:4${i}`)),
  ];

  it("restarts the count at a hold's release", () => {
    const holds = [releasedHold(`${escalation}-${ISSUE}`, 9, { released: at("09:30") })];
    const decide = (count: number) => launchDecision(reading(snapshot({ rounds: aroundFloor(count), holds })), ASK, SHARED, SETTINGS);
    assert.deepEqual(decide(1), { stage: INTERNAL });
    assert.deepEqual(decide(2), { stage: AUDIT });
  });

  it("restarts the count at `/codeworks reset`", () => {
    const reset = { url: "https://github.com/acme/widgets/issues/42#issuecomment-1", at: at("09:30") };
    const decide = (count: number) => launchDecision(reading(snapshot({ rounds: aroundFloor(count) }), { reset }), ASK, SHARED, SETTINGS);
    assert.deepEqual(decide(1), { stage: INTERNAL });
    assert.deepEqual(decide(2), { stage: AUDIT });
  });

  it("counts a CLEAN round, which restarts nothing", () => {
    const rounds = [dirty(1, INTERNAL, "09:00"), round(2, { at: at("09:10"), result: CLEAN })];
    assert.deepEqual(launchDecision(reading(snapshot({ rounds })), ASK, SHARED, SETTINGS), { stage: AUDIT });
  });
});
