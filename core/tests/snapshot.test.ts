import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Snapshot } from "../src/contracts/snapshot.ts";

type Fields = Record<string, unknown>;

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const FIX_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";
const AT = "2026-10-28T10:00:00Z";
const LATER = "2026-10-28T11:00:00Z";

function round(fields: Fields = {}): Fields {
  return { stage: "INTERNAL", n: 1, run: "18342197301", head: HEAD, result: "CLEAN", verdict: null, root_cause: null, at: AT, ...fields };
}

function hold(fields: Fields = {}): Fields {
  return {
    id: "pushback-212",
    kind: "pushback",
    state: "OPEN",
    since: AT,
    released: null,
    released_by: null,
    question: null,
    spec_pr: null,
    ...fields,
  };
}

function releasedHold(fields: Fields = {}): Fields {
  return hold({ state: "RELEASED", released: LATER, released_by: { comment: 9001, reset: false }, ...fields });
}

function ruling(fields: Fields = {}): Fields {
  return {
    key: "thread:PRRT_1",
    round: { stage: "INTERNAL", n: 1 },
    ruling: "PUSH_BACK",
    latest_trusted_comment_id: "PRRC_1",
    reply: "Not real: the caller never passes null here.",
    commits: [],
    ...fields,
  };
}

const THREADLESS = { key: "required-check:ci", latest_trusted_comment_id: null, reply: null };

function snapshot(fields: Fields = {}): Fields {
  return { v: 1, rounds: [round()], holds: [], pushbacks: [], rulings: [], gates: null, ...fields };
}

function accepted(value: Fields): void {
  const parsed = Snapshot.safeParse(value);
  if (!parsed.success) assert.fail(z.prettifyError(parsed.error));
  assert.deepEqual(parsed.data, value);
}

// Every issue's path is compared, so a refusal at any other path, or at one more, fails the test.
function refusedAt(value: Fields, ...paths: PropertyKey[][]): void {
  const parsed = Snapshot.safeParse(value);
  if (parsed.success) assert.fail("accepted");
  assert.deepEqual(
    parsed.error.issues.map((issue) => issue.path),
    paths,
    z.prettifyError(parsed.error),
  );
}

test("a snapshot holding every stage, kind and state is accepted as written", () => {
  accepted(
    snapshot({
      rounds: [
        round(),
        round({ n: 2, run: "18342197302", result: "DIRTY", verdict: "CONVERGED_PUSHBACK", root_cause: "AT_CAUSE", at: LATER }),
        round({ stage: "AUDIT", n: 1, run: "18342197303", result: "INCOMPLETE" }),
        round({ stage: "GITHUB", n: 1, run: "18342197304", result: "DIRTY", verdict: "PATCH" }),
      ],
      holds: [
        hold(),
        hold({ id: "escalation-212", kind: "escalation", question: "Which reading of FR-3 holds?" }),
        releasedHold({ id: "rescope-212", kind: "rescope", spec_pr: 301 }),
        hold({ id: "claim-L7", kind: "claim", question: "Line 4 says parse refuses null; parse(null) returns {}." }),
        releasedHold({ id: "shim-B3", kind: "shim", released_by: { comment: 9002, reset: true } }),
        hold({ id: "audit-212", kind: "audit" }),
      ],
      pushbacks: [{ key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 2 } }],
      rulings: [
        ruling({ round: { stage: "INTERNAL", n: 2 } }),
        ruling({ key: "thread:PRRT_2", ruling: "FIX", commits: [HEAD, FIX_COMMIT] }),
        ruling({ key: "thread:PRRT_3", ruling: "DEFER", reply: "Real, and separate: moved to #301." }),
        ruling({ ...THREADLESS, round: { stage: "GITHUB", n: 1 }, ruling: "FIX", commits: [FIX_COMMIT] }),
      ],
    }),
  );
});

test("an empty snapshot is accepted", () => {
  accepted({ v: 1, rounds: [], holds: [], pushbacks: [], rulings: [], gates: null });
});

test("rulings is required", () => {
  const { rulings: _, ...unruled } = snapshot();
  refusedAt(unruled, ["rulings"]);
});

test("gates is null until the story's first check, or a gates section", () => {
  accepted(snapshot({ gates: null }));
  accepted(snapshot({ gates: { branch: "42-us1-login", anchor: HEAD, lineages: [], bugs: [] } }));
  refusedAt(snapshot({ gates: { branch: "42-us1-login", anchor: "HEAD", lineages: [], bugs: [] } }), ["gates", "anchor"]);
});

test("gates is required", () => {
  const { gates: _, ...ungated } = snapshot();
  refusedAt(ungated, ["gates"]);
});

test("a round's run is its workflow run, one plain path segment", () => {
  for (const run of ["18342197301", "run-7.a_b"]) accepted(snapshot({ rounds: [round({ run })] }));
  for (const run of ["", "a/b", "run 7", "run#7"]) {
    refusedAt(snapshot({ rounds: [round({ run })] }), ["rounds", 0, "run"]);
  }
  const { run: _, ...unrun } = round();
  refusedAt(snapshot({ rounds: [unrun] }), ["rounds", 0, "run"]);
});

test("v is 1", () => {
  refusedAt(snapshot({ v: 2 }), ["v"]);
  const { v: _, ...unversioned } = snapshot();
  refusedAt(unversioned, ["v"]);
});

test("a round's (stage, n) is unique", () => {
  refusedAt(snapshot({ rounds: [round(), round({ at: LATER })] }), ["rounds", 1]);
});

test("n counts per stage, so one n in two stages is accepted", () => {
  accepted(snapshot({ rounds: [round(), round({ stage: "AUDIT" }), round({ stage: "GITHUB" })] }));
});

test("n is an integer of at least 1", () => {
  for (const n of [0, -1, 1.5]) refusedAt(snapshot({ rounds: [round({ n })] }), ["rounds", 0, "n"]);
});

test("head is 40 lower-case hex digits", () => {
  for (const head of [HEAD.slice(1), `${HEAD}0`, HEAD.toUpperCase(), `${HEAD.slice(1)}g`]) {
    refusedAt(snapshot({ rounds: [round({ head })] }), ["rounds", 0, "head"]);
  }
});

test("verdict is set on a DIRTY round", () => {
  for (const verdict of ["PATCH", "CLASS_FIX", "REDESIGN", "RESCOPE", "CONVERGED_PUSHBACK", "ESCALATE"]) {
    accepted(snapshot({ rounds: [round({ result: "DIRTY", verdict })] }));
  }
  refusedAt(snapshot({ rounds: [round({ result: "DIRTY" })] }), ["rounds", 0, "verdict"]);
});

test("verdict is null on a round that is not DIRTY", () => {
  for (const result of ["CLEAN", "INCOMPLETE"]) {
    refusedAt(snapshot({ rounds: [round({ result, verdict: "PATCH" })] }), ["rounds", 0, "verdict"]);
  }
});

test("root_cause is a root cause or null", () => {
  accepted(snapshot({ rounds: [round({ root_cause: "NOT_APPLICABLE" })] }));
  refusedAt(snapshot({ rounds: [round({ root_cause: "at_cause" })] }), ["rounds", 0, "root_cause"]);
});

test("a value field takes only its set's values", () => {
  refusedAt(snapshot({ rounds: [round({ stage: "internal" })] }), ["rounds", 0, "stage"]);
  refusedAt(snapshot({ rounds: [round({ result: "PASS" })] }), ["rounds", 0, "result"]);
  refusedAt(snapshot({ rounds: [round({ result: "DIRTY", verdict: "FIX" })] }), ["rounds", 0, "verdict"]);
  refusedAt(snapshot({ holds: [hold({ id: "Pushback-212", kind: "Pushback" })] }), ["holds", 0, "kind"]);
  refusedAt(snapshot({ holds: [hold({ state: "open" })] }), ["holds", 0, "state"]);
});

for (const [field, place] of [
  ["at", (at: string) => snapshot({ rounds: [round({ at })] })],
  ["since", (since: string) => snapshot({ holds: [hold({ since })] })],
  ["released", (released: string) => snapshot({ holds: [releasedHold({ released })] })],
] as const) {
  test(`${field} is YYYY-MM-DDTHH:MM:SSZ, UTC, whole seconds`, () => {
    const path = field === "at" ? ["rounds", 0, field] : ["holds", 0, field];
    for (const time of [
      "2026-10-28T10:00:00.000Z",
      "2026-10-28T10:00:00+00:00",
      "2026-10-28T10:00Z",
      "2026-10-28 10:00:00Z",
      "2026-10-28T10:00:00",
      "2026-13-28T10:00:00Z",
    ]) {
      refusedAt(place(time), path);
    }
  });
}

test("a hold's id starts with its kind and a hyphen", () => {
  accepted(snapshot({ holds: [hold({ id: "claim-L7", kind: "claim", question: "Why?" }), hold({ id: "shim-B3", kind: "shim" })] }));
  for (const id of ["escalation-212", "pushback212", "212-pushback", "Pushback-212"]) {
    refusedAt(snapshot({ holds: [hold({ id })] }), ["holds", 0, "id"]);
  }
});

test("a hold's id is unique, a released row included", () => {
  refusedAt(snapshot({ holds: [releasedHold(), hold()] }), ["holds", 1, "id"]);
});

test("released and released_by are set on a RELEASED hold", () => {
  refusedAt(snapshot({ holds: [releasedHold({ released: null })] }), ["holds", 0, "released"]);
  refusedAt(snapshot({ holds: [releasedHold({ released_by: null })] }), ["holds", 0, "released_by"]);
});

test("released and released_by are null on an OPEN hold", () => {
  refusedAt(snapshot({ holds: [hold({ released: LATER })] }), ["holds", 0, "released"]);
  refusedAt(snapshot({ holds: [hold({ released_by: { comment: 9001, reset: true } })] }), ["holds", 0, "released_by"]);
});

test("released_by is {comment: int, reset: bool}", () => {
  refusedAt(snapshot({ holds: [releasedHold({ released_by: { comment: 1.5, reset: false } })] }), [
    "holds",
    0,
    "released_by",
    "comment",
  ]);
  refusedAt(snapshot({ holds: [releasedHold({ released_by: { comment: "9001", reset: false } })] }), [
    "holds",
    0,
    "released_by",
    "comment",
  ]);
  refusedAt(snapshot({ holds: [releasedHold({ released_by: { comment: 9001, reset: "no" } })] }), [
    "holds",
    0,
    "released_by",
    "reset",
  ]);
  refusedAt(snapshot({ holds: [releasedHold({ released_by: { comment: 9001 } })] }), [
    "holds",
    0,
    "released_by",
    "reset",
  ]);
});

// The question an admin answers: an escalation's (orchestrator ADR-0010 d1), a claim's last WRONG and a verdict's
// rescope (reviewer ADR-0013 d4-d5).
test("question is set and non-empty on an escalation, a claim and a rescope with no spec PR", () => {
  for (const kind of ["escalation", "claim", "rescope"]) {
    accepted(snapshot({ holds: [hold({ id: `${kind}-212`, kind, question: "Why?" })] }));
    refusedAt(snapshot({ holds: [hold({ id: `${kind}-212`, kind, question: null })] }), ["holds", 0, "question"]);
    refusedAt(snapshot({ holds: [hold({ id: `${kind}-212`, kind, question: "" })] }), ["holds", 0, "question"]);
  }
});

test("question is null on a pushback, audit and shim hold, and on a rescope with a spec PR", () => {
  for (const kind of ["pushback", "shim", "audit"]) {
    refusedAt(snapshot({ holds: [hold({ id: `${kind}-212`, kind, question: "Why?" })] }), ["holds", 0, "question"]);
  }
  accepted(snapshot({ holds: [hold({ id: "rescope-212", kind: "rescope", question: null, spec_pr: 301 })] }));
  refusedAt(snapshot({ holds: [hold({ id: "rescope-212", kind: "rescope", question: "Why?", spec_pr: 301 })] }), [
    "holds",
    0,
    "question",
  ]);
});

test("spec_pr on a rescope hold is an integer of at least 1, or null for one placed by a verdict", () => {
  accepted(snapshot({ holds: [hold({ id: "rescope-212", kind: "rescope", question: "Why?", spec_pr: null })] }));
  for (const specPr of [0, -301, 1.5]) {
    refusedAt(snapshot({ holds: [hold({ id: "rescope-212", kind: "rescope", spec_pr: specPr })] }), [
      "holds",
      0,
      "spec_pr",
    ]);
  }
});

test("spec_pr is null on every kind but rescope", () => {
  for (const kind of ["escalation", "pushback", "claim", "shim", "audit"]) {
    const question = kind === "escalation" || kind === "claim" ? "Why?" : null;
    refusedAt(snapshot({ holds: [hold({ id: `${kind}-212`, kind, question, spec_pr: 301 })] }), [
      "holds",
      0,
      "spec_pr",
    ]);
  }
});

test("each pushback's round exists", () => {
  const pushback = (stage: string, n: number) => ({ key: "thread:PRRT_1", round: { stage, n } });
  accepted(snapshot({ pushbacks: [pushback("INTERNAL", 1)] }));
  refusedAt(snapshot({ pushbacks: [pushback("INTERNAL", 2)] }), ["pushbacks", 0, "round"]);
  refusedAt(snapshot({ pushbacks: [pushback("AUDIT", 1)] }), ["pushbacks", 0, "round"]);
  refusedAt(snapshot({ rounds: [], pushbacks: [pushback("INTERNAL", 1)] }), ["pushbacks", 0, "round"]);
});

test("each ruling's round exists", () => {
  const ruled = (stage: string, n: number) => ruling({ round: { stage, n } });
  accepted(snapshot({ rulings: [ruled("INTERNAL", 1)] }));
  refusedAt(snapshot({ rulings: [ruled("INTERNAL", 2)] }), ["rulings", 0, "round"]);
  refusedAt(snapshot({ rulings: [ruled("AUDIT", 1)] }), ["rulings", 0, "round"]);
  refusedAt(snapshot({ rounds: [], rulings: [ruled("INTERNAL", 1)] }), ["rulings", 0, "round"]);
});

test("a finding is ruled once per round, and again in a later round", () => {
  const rounds = [round(), round({ n: 2 })];
  refusedAt(snapshot({ rounds, rulings: [ruling(), ruling({ ruling: "DEFER" })] }), ["rulings", 1]);
  accepted(snapshot({ rounds, rulings: [ruling(), ruling({ round: { stage: "INTERNAL", n: 2 }, ruling: "FIX" })] }));
  accepted(snapshot({ rounds, rulings: [ruling(), ruling({ key: "thread:PRRT_2" })] }));
});

test("a ruling takes only a finding ruling's values", () => {
  for (const value of ["fix", "PATCH", "CONVERGED_PUSHBACK"]) {
    refusedAt(snapshot({ rulings: [ruling({ ruling: value })] }), ["rulings", 0, "ruling"]);
  }
});

test("a ruling's key is a finding's key, never empty", () => {
  refusedAt(snapshot({ rulings: [ruling({ key: "" })] }), ["rulings", 0, "key"]);
});

test("reply is set and non-empty exactly when latest_trusted_comment_id is, so a thread always has one", () => {
  accepted(snapshot({ rulings: [ruling({ ...THREADLESS })] }));
  refusedAt(snapshot({ rulings: [ruling({ reply: null })] }), ["rulings", 0, "reply"]);
  refusedAt(snapshot({ rulings: [ruling({ reply: "" })] }), ["rulings", 0, "reply"]);
  refusedAt(snapshot({ rulings: [ruling({ ...THREADLESS, reply: "Not real." })] }), ["rulings", 0, "reply"]);
});

test("a FIX names its commits, none before its first passes", () => {
  accepted(snapshot({ rulings: [ruling({ ruling: "FIX", commits: [] })] }));
  accepted(snapshot({ rulings: [ruling({ ruling: "FIX", commits: [FIX_COMMIT, HEAD] })] }));
});

test("commits is empty on a PUSH_BACK or DEFER", () => {
  for (const value of ["PUSH_BACK", "DEFER"]) {
    refusedAt(snapshot({ rulings: [ruling({ ruling: value, commits: [FIX_COMMIT] })] }), ["rulings", 0, "commits"]);
  }
});

test("each commit is 40 lower-case hex digits", () => {
  for (const commit of [FIX_COMMIT.slice(1), FIX_COMMIT.toUpperCase(), `${FIX_COMMIT.slice(1)}g`]) {
    refusedAt(snapshot({ rulings: [ruling({ ruling: "FIX", commits: [commit] })] }), ["rulings", 0, "commits", 0]);
  }
});

test("an unknown key is refused at every level", () => {
  refusedAt(snapshot({ extra: 1 }), []);
  refusedAt(snapshot({ rounds: [round({ extra: 1 })] }), ["rounds", 0]);
  refusedAt(snapshot({ holds: [hold({ extra: 1 })] }), ["holds", 0]);
  refusedAt(snapshot({ holds: [releasedHold({ released_by: { comment: 9001, reset: false, extra: 1 } })] }), [
    "holds",
    0,
    "released_by",
  ]);
  refusedAt(snapshot({ pushbacks: [{ key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1 }, extra: 1 }] }), [
    "pushbacks",
    0,
  ]);
  refusedAt(snapshot({ pushbacks: [{ key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1, extra: 1 } }] }), [
    "pushbacks",
    0,
    "round",
  ]);
  refusedAt(snapshot({ rulings: [ruling({ extra: 1 })] }), ["rulings", 0]);
  refusedAt(snapshot({ rulings: [ruling({ round: { stage: "INTERNAL", n: 1, extra: 1 } })] }), ["rulings", 0, "round"]);
});
