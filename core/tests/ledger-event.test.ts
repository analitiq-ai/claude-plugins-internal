import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { z } from "zod";
import { eventFile, eventText, LedgerEvent } from "../src/contracts/ledger.ts";

type Fields = Record<string, unknown>;

const HEAD = "0123456789abcdef0123456789abcdef01234567";
const FIX_COMMIT = "89abcdef0123456789abcdef0123456789abcdef";
const TAMPERING = "fedcba9876543210fedcba9876543210fedcba98";
const AT = "2026-10-28T10:00:00Z";
const LATER = "2026-10-28T11:00:00Z";

// The contract's <h(x)>: SHA-256 hex of x's UTF-8.
function h(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

const round = {
  stage: "INTERNAL",
  n: 1,
  run: "18342197301",
  head: HEAD,
  result: "CLEAN",
  verdict: null,
  root_cause: null,
  at: AT,
};

const EVENTS = {
  round: { kind: "round", v: 1, round },
  ruling: {
    kind: "ruling",
    v: 1,
    ruling: {
      key: "thread:PRRT_1",
      round: { stage: "INTERNAL", n: 1 },
      ruling: "FIX",
      latest_trusted_comment_id: "PRRC_1",
      reply: "Fixed at the cause: the parser now refuses null.",
      commits: [],
    },
  },
  "ruling-commit": { kind: "ruling-commit", v: 1, round: { stage: "INTERNAL", n: 1 }, key: "thread:PRRT_1", commit: FIX_COMMIT },
  pushback: { kind: "pushback", v: 1, pushback: { key: "thread:PRRT_2", round: { stage: "GITHUB", n: 2 } } },
  hold: {
    kind: "hold",
    v: 1,
    hold: { id: "escalation-212", kind: "escalation", since: AT, question: "Which reading of FR-3 holds?", spec_pr: null },
  },
  release: {
    kind: "release",
    v: 1,
    release: { id: "escalation-212", since: AT, released: LATER, released_by: { comment: 9001, reset: false } },
  },
  "release of a tamper": {
    kind: "release",
    v: 1,
    release: { id: `tamper-${TAMPERING}`, since: null, released: LATER, released_by: { comment: 9002, reset: true } },
  },
  gates: { kind: "gates", v: 1, ref: "18342197305", gates: { branch: "42-us1-login", anchor: HEAD, lineages: [], bugs: [] } },
} satisfies Record<string, Fields>;

const FILES: Record<keyof typeof EVENTS, string> = {
  round: "round.18342197301.json",
  ruling: `ruling.INTERNAL-1.${h("thread:PRRT_1")}.json`,
  "ruling-commit": `ruling-commit.INTERNAL-1.${h("thread:PRRT_1")}.${FIX_COMMIT}.json`,
  pushback: `pushback.GITHUB-2.${h("thread:PRRT_2")}.json`,
  hold: "hold.escalation-212.20261028T100000Z.json",
  release: "release.escalation-212.20261028T100000Z.json",
  "release of a tamper": `release.tamper-${TAMPERING}.json`,
  gates: "gates.18342197305.json",
};

function parsed(value: Fields): LedgerEvent {
  const event = LedgerEvent.safeParse(value);
  if (!event.success) assert.fail(z.prettifyError(event.error));
  return event.data;
}

// Every issue's path is compared, so a refusal at any other path, or at one more, fails the test.
function refusedAt(value: Fields, ...paths: PropertyKey[][]): void {
  const event = LedgerEvent.safeParse(value);
  if (event.success) assert.fail("accepted");
  assert.deepEqual(
    event.error.issues.map((issue) => issue.path),
    paths,
    z.prettifyError(event.error),
  );
}

for (const [name, value] of Object.entries(EVENTS)) {
  test(`a ${name} event is accepted as written`, () => {
    assert.deepEqual(parsed(value), value);
  });

  test(`a ${name} event's file is ${FILES[name as keyof typeof EVENTS].replace(/[0-9a-f]{64}/g, "<h>")}`, () => {
    assert.equal(eventFile(parsed(value)), FILES[name as keyof typeof EVENTS]);
  });

  test(`a ${name} event takes v 1 and refuses any other v or none`, () => {
    parsed(value);
    for (const v of [0, 2, "1", null]) refusedAt({ ...value, v }, ["v"]);
    const { v: _, ...unversioned } = value;
    refusedAt(unversioned, ["v"]);
  });
}

test("a round event carries its round's findings, its file still named by the run", () => {
  const findings = [
    { key: "thread:PRRT_1", file: "src/parse.ts", line: 42 },
    { key: "required-check:ci", file: null, line: null },
  ];
  const value = { kind: "round", v: 1, round: { ...round, result: "DIRTY", verdict: "PATCH", findings } };
  assert.deepEqual(parsed(value), value);
  assert.equal(eventFile(parsed(value)), FILES.round);
});

test("a key is hashed as its UTF-8, so a key outside ASCII names one file", () => {
  const key = "required-check:ci ✓ é";
  const pushback = { kind: "pushback", v: 1, pushback: { key, round: { stage: "INTERNAL", n: 3 } } };
  assert.equal(eventFile(parsed(pushback)), `pushback.INTERNAL-3.${h(key)}.json`);
});

test("an event of no kind in the table is refused", () => {
  assert.equal(LedgerEvent.safeParse({ kind: "comment", v: 1 }).success, false);
  assert.equal(LedgerEvent.safeParse({ v: 1, round }).success, false);
});

test("an event's text is its JSON, keys sorted, two-space indent, trailing newline", () => {
  assert.equal(
    eventText(parsed(EVENTS.pushback)),
    '{\n  "kind": "pushback",\n  "pushback": {\n    "key": "thread:PRRT_2",\n    "round": {\n      "n": 2,\n      "stage": "GITHUB"\n    }\n  },\n  "v": 1\n}\n',
  );
});

const BAD_SEGMENTS = ["a/b", "a b", "a#b", "ä", "a\nb", "a\\b"];

test("a round's run and a gates ref match [A-Za-z0-9._-]+", () => {
  const good = "Az09._-";
  parsed({ ...EVENTS.round, round: { ...round, run: good } });
  parsed({ ...EVENTS.gates, ref: good });
  for (const bad of ["", ...BAD_SEGMENTS]) {
    refusedAt({ ...EVENTS.round, round: { ...round, run: bad } }, ["round", "run"]);
    refusedAt({ ...EVENTS.gates, ref: bad }, ["ref"]);
  }
});

test("a hold or release id of each hold kind takes [A-Za-z0-9._-] after <kind>- and refuses /, space, #, a non-ASCII letter, newline or backslash there", () => {
  const holds = [
    { kind: "escalation", question: "Why?" },
    { kind: "claim", question: "Why?" },
    { kind: "rescope", question: "Why?" },
    { kind: "pushback", question: null },
    { kind: "audit", question: null },
    { kind: "shim", question: null },
  ];
  for (const { kind, question } of holds) {
    const hold = { id: `${kind}-Az09._-`, kind, since: AT, question, spec_pr: null };
    parsed({ ...EVENTS.hold, hold });
    parsed({ ...EVENTS.release, release: { ...EVENTS.release.release, id: hold.id } });
    for (const bad of BAD_SEGMENTS) {
      refusedAt({ ...EVENTS.hold, hold: { ...hold, id: `${kind}-${bad}` } }, ["hold", "id"]);
      refusedAt({ ...EVENTS.release, release: { ...EVENTS.release.release, id: `${kind}-${bad}` } }, ["release", "id"]);
    }
  }
});

test("a ruling event's ruling carries no commits; a ruling-commit event carries one", () => {
  refusedAt({ ...EVENTS.ruling, ruling: { ...EVENTS.ruling.ruling, commits: [FIX_COMMIT] } }, ["ruling", "commits"]);
  assert.equal((parsed(EVENTS["ruling-commit"]) as { commit: string }).commit, FIX_COMMIT);
});

test("a ruling-commit names a non-empty key and a 40-hex commit", () => {
  refusedAt({ ...EVENTS["ruling-commit"], key: "" }, ["key"]);
  for (const commit of [FIX_COMMIT.slice(1), `${FIX_COMMIT}0`, `${FIX_COMMIT.slice(1)}g`, FIX_COMMIT.toUpperCase(), "HEAD"]) {
    refusedAt({ ...EVENTS["ruling-commit"], commit }, ["commit"]);
  }
});

test("a hold event's question is non-empty on an escalation or claim, and refused on a pushback, audit or shim and on a rescope with a spec PR", () => {
  const placed = EVENTS.hold.hold;
  refusedAt({ ...EVENTS.hold, hold: { ...placed, question: null } }, ["hold", "question"]);
  refusedAt({ ...EVENTS.hold, hold: { ...placed, question: "" } }, ["hold", "question"]);
  for (const question of [null, ""]) {
    refusedAt({ ...EVENTS.hold, hold: { id: "claim-L7", kind: "claim", since: AT, question, spec_pr: null } }, ["hold", "question"]);
  }
  for (const kind of ["pushback", "audit", "shim"]) {
    refusedAt({ ...EVENTS.hold, hold: { id: `${kind}-212`, kind, since: AT, question: "Why?", spec_pr: null } }, ["hold", "question"]);
  }
  refusedAt({ ...EVENTS.hold, hold: { id: "rescope-212", kind: "rescope", since: AT, question: "Why?", spec_pr: 301 } }, [
    "hold",
    "question",
  ]);
});

test("a hold event's spec_pr is null or a positive integer on a rescope, and null on every other kind", () => {
  const rescope = { id: "rescope-212", kind: "rescope", since: AT, question: null, spec_pr: 301 };
  parsed({ ...EVENTS.hold, hold: rescope });
  parsed({ ...EVENTS.hold, hold: { ...rescope, question: "Why?", spec_pr: null } });
  for (const spec_pr of [0, -5, 1.5, "301", undefined]) {
    refusedAt({ ...EVENTS.hold, hold: { ...rescope, spec_pr } }, ["hold", "spec_pr"]);
  }
  const others = [
    { kind: "escalation", question: "Why?" },
    { kind: "claim", question: "Why?" },
    { kind: "pushback", question: null },
    { kind: "audit", question: null },
    { kind: "shim", question: null },
  ];
  for (const { kind, question } of others) {
    refusedAt({ ...EVENTS.hold, hold: { id: `${kind}-212`, kind, since: AT, question, spec_pr: 301 } }, ["hold", "spec_pr"]);
  }
});

test("a hold event's id must start with its kind, and a since with milliseconds is refused", () => {
  refusedAt({ ...EVENTS.hold, hold: { ...EVENTS.hold.hold, id: "pushback-212" } }, ["hold", "id"]);
  refusedAt({ ...EVENTS.hold, hold: { ...EVENTS.hold.hold, since: "2026-10-28T10:00:00.000Z" } }, ["hold", "since"]);
});

test("a hold event's hold carries no state, released or released_by key", () => {
  for (const key of ["state", "released", "released_by"]) {
    refusedAt({ ...EVENTS.hold, hold: { ...EVENTS.hold.hold, [key]: null } }, ["hold"]);
  }
});

test("a release names a hold's id and since, or a tamper's id and no since", () => {
  const release = EVENTS.release.release;
  const tamper = EVENTS["release of a tamper"].release;
  refusedAt({ ...EVENTS.release, release: { ...release, since: null } }, ["release", "since"]);
  refusedAt({ ...EVENTS.release, release: { ...tamper, since: AT } }, ["release", "since"]);
  for (const id of ["tamper-xyz", `tamper-${TAMPERING.toUpperCase()}`, "release-212", "212"]) {
    refusedAt({ ...EVENTS.release, release: { ...release, id } }, ["release", "id"]);
  }
});

test("a release's released is a time and released_by is {comment: int, reset: bool}", () => {
  const release = EVENTS.release.release;
  refusedAt({ ...EVENTS.release, release: { ...release, released: "2026-10-28T11:00Z" } }, ["release", "released"]);
  for (const comment of ["9001", 1.5]) {
    refusedAt({ ...EVENTS.release, release: { ...release, released_by: { comment, reset: false } } }, ["release", "released_by", "comment"]);
  }
  for (const reset of ["yes", null, undefined]) {
    refusedAt({ ...EVENTS.release, release: { ...release, released_by: { comment: 9001, reset } } }, ["release", "released_by", "reset"]);
  }
});

test("an unknown key is refused on each event, its payload, and the payload's round, released_by and gates section", () => {
  for (const value of Object.values(EVENTS)) refusedAt({ ...value, extra: 1 }, []);
  refusedAt({ ...EVENTS.round, round: { ...round, extra: 1 } }, ["round"]);
  refusedAt({ ...EVENTS.ruling, ruling: { ...EVENTS.ruling.ruling, extra: 1 } }, ["ruling"]);
  refusedAt({ ...EVENTS.ruling, ruling: { ...EVENTS.ruling.ruling, round: { stage: "INTERNAL", n: 1, extra: 1 } } }, ["ruling", "round"]);
  refusedAt({ ...EVENTS["ruling-commit"], round: { stage: "INTERNAL", n: 1, extra: 1 } }, ["round"]);
  refusedAt({ ...EVENTS.pushback, pushback: { ...EVENTS.pushback.pushback, extra: 1 } }, ["pushback"]);
  refusedAt({ ...EVENTS.pushback, pushback: { key: "thread:PRRT_2", round: { stage: "GITHUB", n: 2, extra: 1 } } }, ["pushback", "round"]);
  refusedAt({ ...EVENTS.hold, hold: { ...EVENTS.hold.hold, extra: 1 } }, ["hold"]);
  refusedAt({ ...EVENTS.release, release: { ...EVENTS.release.release, extra: 1 } }, ["release"]);
  refusedAt({ ...EVENTS.release, release: { ...EVENTS.release.release, released_by: { comment: 9001, reset: false, extra: 1 } } }, [
    "release",
    "released_by",
  ]);
  refusedAt({ ...EVENTS.gates, gates: { ...EVENTS.gates.gates, extra: 1 } }, ["gates"]);
});
