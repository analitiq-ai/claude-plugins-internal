import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Gates } from "../src/contracts/gates.ts";
import { eventText, type LedgerEvent } from "../src/contracts/ledger.ts";
import type { Hold, Snapshot } from "../src/contracts/snapshot.ts";
import { GitHubRefused } from "../src/github.ts";
import {
  checkTransition,
  placeRescopeHold,
  readState,
  recordGates,
  releaseOnClaim,
  StateStale,
  StateWriteRefused,
  StateWriteUnsigned,
  writeState,
  type Opening,
  type Placement,
  type StateReading,
} from "../src/state.ts";
import {
  BOARD,
  ISSUE,
  NOW,
  QUESTION_TEXT,
  REPO,
  SHARED,
  addedFiles,
  adminComment,
  at,
  commitsAsked,
  fixRuling,
  gates,
  hold,
  lineage,
  move,
  placementOf,
  pushbackRuling,
  reader,
  releasedHold,
  round,
  sha,
  snapshot,
  writer,
  type CommitInput,
  type Issue,
} from "./fixtures/state/issue.ts";
import {
  clearanceCommit,
  event,
  eventCommit,
  fakeLedger,
  fileOf,
  invalidCommit,
  storyDir,
  storyOf,
  type FakeLedger,
} from "./fixtures/state/ledger.ts";
import type { FakeGitHub } from "./support/fake-github.ts";

const EMPTY: Snapshot = { v: 1, rounds: [], holds: [], pushbacks: [], rulings: [], gates: null };
const ROUND_1 = round(1, { result: "DIRTY", verdict: "PATCH" });
const ROUND_1_ID = { stage: "INTERNAL", n: 1 } as const;
const ROUND_2_ID = { stage: "INTERNAL", n: 2 } as const;

function inStory(name: string): string {
  return `${storyDir()}/${name}`;
}

/** The files a commit of `events` adds, path from the repository root to text. */
function filesOf(...events: LedgerEvent[]): Record<string, string> {
  return Object.fromEntries(events.map((each) => [inStory(fileOf(each)), eventText(each)]));
}

function ledgerOf(state: Snapshot): FakeLedger {
  const ledger = fakeLedger();
  storyOf(ledger, state);
  return ledger;
}

async function readingOf(ledger: FakeLedger, issue: Issue = {}): Promise<StateReading> {
  return readState(reader(issue, ledger), REPO, ISSUE, SHARED);
}

function onlyCommit(out: FakeGitHub): CommitInput {
  const asked = commitsAsked(out);
  assert.equal(asked.length, 1, "one commit");
  return asked[0];
}

function refusal(pattern: RegExp) {
  return (error: unknown) => {
    assert.ok(error instanceof StateWriteRefused, `expected StateWriteRefused, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  };
}

function withRound(reading: StateReading, n: number): Snapshot {
  const state = reading.snapshot ?? EMPTY;
  return { ...state, rounds: [...state.rounds, round(n)] };
}

type Write = (read: FakeGitHub, out: FakeGitHub, reading: StateReading, issue?: number) => Promise<StateReading>;

// Each call is given what COMMITTING_STATE lacks: round 2, spec PR 301 and check-9's gates; and RELEASING_ISSUE's
// admin comment and Ready move both come after COMMITTING_STATE's OPEN hold.
const WRITES: Array<[string, Write]> = [
  ["writeState", (read, out, reading, issue = ISSUE) => writeState(read, out, REPO, issue, SHARED, reading, withRound(reading, 2), [])],
  ["placeRescopeHold", (read, out, reading, issue = ISSUE) => placeRescopeHold(read, out, REPO, issue, SHARED, reading, 301)],
  ["recordGates", (read, out, reading, issue = ISSUE) => recordGates(read, out, REPO, issue, SHARED, reading, "check-9", gates(), [])],
  [
    "releaseOnClaim",
    async (read, out, reading, issue = ISSUE) => (await releaseOnClaim(read, out, REPO, issue, SHARED, reading)).reading,
  ],
];
const COMMITTING_STATE = snapshot({ holds: [hold("pushback-212", { since: at("10:00") })] });
const RELEASING_ISSUE: Issue = { comments: [adminComment(201, "10:30")], moves: [move("11:00")] };

describe("writeState, placeRescopeHold, recordGates and releaseOnClaim commit alike", () => {
  for (const [write, call] of WRITES) {
    it(`${write} makes one createCommitOnBranch on ledger at the reading's head, adding only, headline naming the story`, async () => {
      const ledger = ledgerOf(COMMITTING_STATE);
      const reading = await readingOf(ledger, RELEASING_ISSUE);
      const out = writer(ledger);
      await call(reader(RELEASING_ISSUE, ledger), out, reading);
      const input = onlyCommit(out);
      assert.deepEqual(input.branch, { repositoryNameWithOwner: REPO, branchName: "ledger" });
      assert.equal(input.expectedHeadOid, reading.head);
      assert.deepEqual(input.fileChanges.deletions ?? [], []);
      assert.match(input.message.headline, /^issues\/212: /);
      assert.ok(Object.keys(addedFiles(input)).every((path) => path.startsWith(`${storyDir()}/`)));
    });

    it(`${write} returns the reading a read at its commit gives, reading nothing more`, async () => {
      const ledger = ledgerOf(COMMITTING_STATE);
      const reading = await readingOf(ledger, RELEASING_ISSUE);
      const read = reader(RELEASING_ISSUE, ledger);
      const advanced = await call(read, writer(ledger), reading);
      assert.deepEqual(read.calls, []);
      assert.notEqual(advanced.head, reading.head);
      assert.deepEqual(advanced, await readingOf(ledger, RELEASING_ISSUE));
    });

    it(`${write} throws StateStale naming the new head when ledger moved from the reading's head`, async () => {
      const ledger = ledgerOf(COMMITTING_STATE);
      const reading = await readingOf(ledger, RELEASING_ISSUE);
      const moved = eventCommit(ledger, [event.round(round(1))], { issue: 7 });
      await assert.rejects(call(reader(RELEASING_ISSUE, ledger), writer(ledger), reading), (error: unknown) => {
        assert.ok(error instanceof StateStale, `expected StateStale, got ${String(error)}`);
        assert.equal(error.head, moved);
        return true;
      });
      assert.equal(ledger.head, moved);
    });

    it(`${write} rethrows GitHub's refusal as it came when ledger has not moved`, async () => {
      const ledger = ledgerOf(COMMITTING_STATE);
      const reading = await readingOf(ledger, RELEASING_ISSUE);
      const refused = new GitHubRefused(403, "POST /graphql: Resource not accessible by integration");
      ledger.refuseNext = refused;
      await assert.rejects(call(reader(RELEASING_ISSUE, ledger), writer(ledger), reading), (error: unknown) => error === refused);
    });

    it(`${write} throws StateWriteUnsigned naming its commit when GitHub's answer is not GitHub-signed`, async () => {
      for (const signature of [null, { isValid: true, wasSignedByGitHub: false }, { isValid: false, wasSignedByGitHub: true }]) {
        const ledger = ledgerOf(COMMITTING_STATE);
        const reading = await readingOf(ledger, RELEASING_ISSUE);
        ledger.nextSignature = signature;
        await assert.rejects(call(reader(RELEASING_ISSUE, ledger), writer(ledger), reading), (error: unknown) => {
          assert.ok(error instanceof StateWriteUnsigned, `expected StateWriteUnsigned, got ${String(error)}`);
          assert.equal(error.oid, ledger.head);
          assert.ok(error.message.includes(String(ledger.head)), error.message);
          return true;
        });
      }
    });

    it(`${write} throws TypeError for 0, -1, 1.5 and NaN, with no call on either client`, async () => {
      const ledger = ledgerOf(COMMITTING_STATE);
      const reading = await readingOf(ledger, RELEASING_ISSUE);
      for (const issue of [0, -1, 1.5, Number.NaN]) {
        const read = reader(RELEASING_ISSUE, ledger);
        const out = writer(ledger);
        await assert.rejects(call(read, out, reading, issue), (error: unknown) => {
          assert.ok(error instanceof TypeError, `expected TypeError for ${issue}, got ${String(error)}`);
          assert.match(error.message, /not an issue number/);
          return true;
        });
        assert.deepEqual([...read.calls, ...out.calls], []);
      }
    });
  }
});

describe("every write but releaseOnClaim is refused while an unreleased tamper stands", () => {
  const name = fileOf(event.round(round(2)));

  function tampered(): { ledger: FakeLedger; oid: string } {
    const ledger = ledgerOf(COMMITTING_STATE);
    const oid = invalidCommit(ledger, { put: { [name]: eventText(event.round(round(2))) }, date: at("10:15") });
    return { ledger, oid };
  }

  for (const [write, call] of WRITES.filter(([name]) => name !== "releaseOnClaim")) {
    it(`${write} names the tamper, its file, the board and the tamper's time, with an admin's deletion on ledger, a Ready move, a comment and the claim as its release`, async () => {
      const { ledger, oid } = tampered();
      const reading = await readingOf(ledger, RELEASING_ISSUE);
      const out = writer(ledger);
      await assert.rejects(call(reader(RELEASING_ISSUE, ledger), out, reading), (error: unknown) => {
        assert.ok(error instanceof StateWriteRefused, `expected StateWriteRefused, got ${String(error)}`);
        for (const named of [`tamper-${oid}`, inStory(name), BOARD, at("10:15")]) {
          assert.ok(error.message.includes(named), `${named} is not in: ${error.message}`);
        }
        assert.match(String(error.release), /admin.*delet.*ledger.*Ready.*comment.*claim/s);
        return true;
      });
      assert.deepEqual(out.calls, []);
    });

    it(`${write} is refused while a tamper stands even once its release holds`, async () => {
      const { ledger, oid } = tampered();
      clearanceCommit(ledger, [name], { date: at("10:20") });
      const issue: Issue = { comments: [adminComment(201, "10:45")], moves: [move("11:00")] };
      const reading = await readingOf(ledger, issue);
      const by = { id: 201, url: adminComment(201, "10:45").url, at: at("10:45") };
      assert.deepEqual(reading.tamper[0].releasable, { id: `tamper-${oid}`, comment: by, reset: false }, "the tamper's release holds");
      const out = writer(ledger);
      await assert.rejects(call(reader(issue, ledger), out, reading), refusal(new RegExp(`tamper-${oid}`)));
      assert.deepEqual(out.calls, []);
    });
  }
});

describe("writeState", () => {
  const base = snapshot({ rounds: [ROUND_1] });

  async function write(state: Snapshot, next: Snapshot, placements: Placement[] = []) {
    const ledger = ledgerOf(state);
    const reading = await readingOf(ledger);
    const out = writer(ledger);
    const advanced = await writeState(reader({}, ledger), out, REPO, ISSUE, SHARED, reading, next, placements);
    return { out, reading, advanced };
  }

  it("commits each new round in its own file with at from now(), whatever the caller gave, the rounds before it kept", async () => {
    const late = at("23:59");
    const { out, advanced } = await write(base, { ...base, rounds: [ROUND_1, round(2, { at: late }), round(3, { at: late })] });
    const input = onlyCommit(out);
    assert.equal(input.message.headline, "issues/212: round");
    assert.deepEqual(addedFiles(input), filesOf(event.round(round(2, { at: NOW })), event.round(round(3, { at: NOW }))));
    assert.deepEqual(advanced.snapshot?.rounds, [ROUND_1, round(2, { at: NOW }), round(3, { at: NOW })]);
  });

  it("commits a round, its rulings, a FIX's commits and its pushbacks as one commit, the headline's kinds in the contract's order", async () => {
    const fix = fixRuling("PRRC_1", 2, [sha(5)]);
    const pushback = { key: "PRRC_2", round: ROUND_2_ID };
    const next = { ...base, rounds: [ROUND_1, round(2)], rulings: [fix, pushbackRuling("PRRC_2", 2)], pushbacks: [pushback] };
    const { out, advanced } = await write(base, next);
    const input = onlyCommit(out);
    assert.equal(input.message.headline, "issues/212: round, ruling, ruling-commit, pushback");
    assert.deepEqual(
      addedFiles(input),
      filesOf(
        event.round(round(2, { at: NOW })),
        event.ruling(fix),
        event.ruling(pushbackRuling("PRRC_2", 2)),
        event.rulingCommit(ROUND_2_ID, "PRRC_1", sha(5)),
        event.pushback(pushback),
      ),
    );
    assert.deepEqual(advanced.snapshot, { ...next, rounds: [ROUND_1, round(2, { at: NOW })] });
  });

  it("commits a FIX's new commit as a ruling-commit, after those it named", async () => {
    const state = snapshot({ rounds: [ROUND_1], rulings: [fixRuling("PRRC_1", 1, [sha(5)])] });
    const next = { ...state, rulings: [fixRuling("PRRC_1", 1, [sha(5), sha(6)])] };
    const { out, advanced } = await write(state, next);
    const input = onlyCommit(out);
    assert.equal(input.message.headline, "issues/212: ruling-commit");
    assert.deepEqual(addedFiles(input), filesOf(event.rulingCommit(ROUND_1_ID, "PRRC_1", sha(6))));
    assert.deepEqual(advanced.snapshot, next);
  });

  it("places a hold per placement whose row is not OPEN, since from now() and no spec PR, a RELEASED row reopened in place; an OPEN row is left", async () => {
    const pushback = hold("pushback-212", { since: at("10:00") });
    const state = snapshot({ rounds: [ROUND_1], holds: [pushback, releasedHold("escalation-212", 90, { since: at("09:00"), released: at("09:30") })] });
    const question = "Which one?";
    const { out, advanced } = await write(state, state, [
      { id: "pushback-212", kind: "pushback", question: null },
      { id: "escalation-212", kind: "escalation", question },
      { id: "audit-212", kind: "audit", question: null },
    ]);
    const escalation = hold("escalation-212", { since: NOW, question });
    const audit = hold("audit-212", { since: NOW });
    const input = onlyCommit(out);
    assert.equal(input.message.headline, "issues/212: hold");
    assert.deepEqual(addedFiles(input), filesOf(event.hold(placementOf(escalation)), event.hold(placementOf(audit))));
    assert.deepEqual(advanced.snapshot?.holds, [pushback, escalation, audit]);
  });

  it("commits a round and the holds its report places as one commit", async () => {
    const { out, advanced } = await write(base, { ...base, rounds: [ROUND_1, round(2)] }, [{ id: "rescope-212", kind: "rescope", question: QUESTION_TEXT }]);
    const rescope = hold("rescope-212", { since: NOW });
    const input = onlyCommit(out);
    assert.equal(input.message.headline, "issues/212: round, hold");
    assert.deepEqual(addedFiles(input), filesOf(event.round(round(2, { at: NOW })), event.hold(placementOf(rescope))));
    assert.deepEqual(advanced.snapshot, { ...base, rounds: [ROUND_1, round(2, { at: NOW })], holds: [rescope] });
  });

  it("writes the first round of a story with no directory", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(round(1))], { issue: 7 });
    const reading = await readingOf(ledger);
    assert.equal(reading.snapshot, null);
    const out = writer(ledger);
    const advanced = await writeState(reader({}, ledger), out, REPO, ISSUE, SHARED, reading, { ...EMPTY, rounds: [round(1)] }, []);
    assert.deepEqual(addedFiles(onlyCommit(out)), filesOf(event.round(round(1, { at: NOW }))));
    assert.deepEqual(advanced.snapshot, { ...EMPTY, rounds: [round(1, { at: NOW })] });
  });

  it("commits nothing and returns the reading when next appends nothing and every placement's row is OPEN", async () => {
    const state = snapshot({ rounds: [ROUND_1], holds: [hold("pushback-212")] });
    const { out, reading, advanced } = await write(state, state, [{ id: "pushback-212", kind: "pushback", question: null }]);
    assert.deepEqual(commitsAsked(out), []);
    assert.deepEqual(advanced, reading);
  });

  const state = snapshot({ rounds: [ROUND_1], holds: [hold("pushback-212", { since: at("10:00") })] });
  const refused: Array<[string, Snapshot, Placement[], RegExp]> = [
    ["a round dropped", { ...state, rounds: [] }, [], /round/],
    ["a hold row changed", { ...state, holds: [releasedHold("pushback-212", 90, { since: at("10:00"), released: at("10:30") })] }, [], /pushback-212/],
    ["a gates section changed", { ...state, gates: gates() }, [], /recordGates/],
    ["a claim placement", state, [{ id: "claim-L7", kind: "claim", question: QUESTION_TEXT }], /recordGates/],
    ["a shim placement", state, [{ id: "shim-B3", kind: "shim", question: null }], /recordGates/],
    ["an escalation placement with no question", state, [{ id: "escalation-212", kind: "escalation", question: null }], /question/],
    ["a rescope placement with no question", state, [{ id: "rescope-212", kind: "rescope", question: null }], /question/],
    ["a question on a pushback placement", state, [{ id: "pushback-212", kind: "pushback", question: "Why?" }], /question/],
    ["a round breaking its contract", { ...state, rounds: [ROUND_1, round(2, { result: "DIRTY", verdict: null })] }, [], /contract/],
  ];
  for (const [what, next, placements, pattern] of refused) {
    it(`refuses ${what}, asking GitHub nothing`, async () => {
      const ledger = ledgerOf(state);
      const reading = await readingOf(ledger);
      const out = writer(ledger);
      const read = reader({}, ledger);
      await assert.rejects(writeState(read, out, REPO, ISSUE, SHARED, reading, next, placements), refusal(pattern));
      assert.deepEqual([...read.calls, ...out.calls], []);
    });
  }
});

describe("checkTransition", () => {
  const old = snapshot({
    rounds: [round(1), round(2)],
    holds: [hold("pushback-212"), releasedHold("escalation-212", 90)],
    pushbacks: [
      { key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1 } },
      { key: "thread:PRRT_2", round: { stage: "INTERNAL", n: 2 } },
    ],
    rulings: [pushbackRuling("thread:PRRT_1", 1), fixRuling("thread:PRRT_4", 2, [sha(5)])],
  });
  const [pushedBack, fix] = old.rulings;

  it("gives no event for nothing changed, and an event per appended round, ruling and pushback in the contract's kind order", () => {
    assert.deepEqual(checkTransition(old, old), []);
    const pushback = { key: "thread:PRRT_3", round: { stage: "INTERNAL", n: 3 } } as const;
    const next = {
      ...old,
      rounds: [...old.rounds, round(3)],
      pushbacks: [...old.pushbacks, pushback],
      rulings: [...old.rulings, pushbackRuling("thread:PRRT_3", 3)],
    };
    assert.deepEqual(checkTransition(old, next), [event.round(round(3)), event.ruling(pushbackRuling("thread:PRRT_3", 3)), event.pushback(pushback)]);
  });

  it("gives a ruling-commit event per commit a FIX names after those it named", () => {
    assert.deepEqual(checkTransition(old, { ...old, rulings: [pushedBack, { ...fix, commits: [sha(5), sha(6), sha(7)] }] }), [
      event.rulingCommit(ROUND_2_ID, "thread:PRRT_4", sha(6)),
      event.rulingCommit(ROUND_2_ID, "thread:PRRT_4", sha(7)),
    ]);
  });

  const refused: Array<[string, Snapshot]> = [
    ["a round dropped", { ...old, rounds: [old.rounds[0]] }],
    ["the newest round dropped and another appended", { ...old, rounds: [old.rounds[0], round(3)] }],
    ["a round rewritten", { ...old, rounds: [old.rounds[0], { ...old.rounds[1], result: "INCOMPLETE" }] }],
    ["a round's at rewritten", { ...old, rounds: [old.rounds[0], { ...old.rounds[1], at: at("11:00") }] }],
    ["a round inserted before the newest", { ...old, rounds: [old.rounds[0], round(3), old.rounds[1]] }],
    ["a pushback dropped", { ...old, pushbacks: [old.pushbacks[1]] }],
    ["a pushback rewritten", { ...old, pushbacks: [old.pushbacks[0], { ...old.pushbacks[1], key: "thread:PRRT_X" }] }],
    ["a ruling dropped", { ...old, rulings: [fix] }],
    ["a ruling rewritten", { ...old, rulings: [{ ...pushedBack, ruling: "DEFER" }, fix] }],
    ["a ruling's reply rewritten", { ...old, rulings: [{ ...pushedBack, reply: "Moved to #301." }, fix] }],
    ["a ruling inserted before the newest", { ...old, rulings: [pushedBack, pushbackRuling("thread:PRRT_3", 2), fix] }],
    ["a FIX's commit dropped", { ...old, rulings: [pushedBack, { ...fix, commits: [] }] }],
    ["a FIX's commit replaced", { ...old, rulings: [pushedBack, { ...fix, commits: [sha(6)] }] }],
    ["a commit named before a FIX's first", { ...old, rulings: [pushedBack, { ...fix, commits: [sha(6), sha(5)] }] }],
    ["a hold row added", { ...old, holds: [...old.holds, hold("audit-212")] }],
    ["a hold row dropped", { ...old, holds: [old.holds[0]] }],
    ["a hold row released", { ...old, holds: [releasedHold("pushback-212", 91), old.holds[1]] }],
    ["a released hold row reopened", { ...old, holds: [old.holds[0], hold("escalation-212")] }],
  ];
  for (const [what, next] of refused) {
    it(`refuses ${what}`, () => {
      assert.throws(() => checkTransition(old, next), StateWriteRefused);
    });
  }
});

describe("placeRescopeHold", () => {
  function rescope(fields: Partial<Hold>): Hold {
    return hold("rescope-212", fields);
  }

  async function place(state: Snapshot, specPr: number) {
    const ledger = ledgerOf(state);
    const reading = await readingOf(ledger);
    const out = writer(ledger);
    const advanced = await placeRescopeHold(reader({}, ledger), out, REPO, ISSUE, SHARED, reading, specPr);
    return { asked: commitsAsked(out), reading, advanced };
  }

  it("for spec PR #301 on 212 commits rescope-212 OPEN recording 301, since from now() and no question", async () => {
    const pushback = hold("pushback-212");
    const { asked, advanced } = await place(snapshot({ holds: [pushback] }), 301);
    const placed = rescope({ since: NOW, spec_pr: 301 });
    assert.equal(placed.question, null);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].message.headline, "issues/212: hold");
    assert.deepEqual(addedFiles(asked[0]), filesOf(event.hold(placementOf(placed))));
    assert.deepEqual(advanced.snapshot?.holds, [pushback, placed]);
  });

  it("for #301 again commits nothing, OPEN or RELEASED", async () => {
    for (const row of [rescope({ spec_pr: 301 }), releasedHold("rescope-212", 90, { since: at("09:00"), released: at("09:30"), spec_pr: 301 })]) {
      const { asked, reading, advanced } = await place(snapshot({ holds: [row] }), 301);
      assert.deepEqual(asked, []);
      assert.deepEqual(advanced, reading);
    }
  });

  const replaced: Array<[string, Hold, number]> = [
    ["RELEASED recording 301, then for #305, reopens the row OPEN recording 305", releasedHold("rescope-212", 90, { since: at("09:00"), released: at("09:30"), spec_pr: 301 }), 305],
    ["OPEN from a RESCOPE verdict, then for #301, replaces the row recording 301 with no question", rescope({ since: at("10:00") }), 301],
    ["OPEN recording 301, then for #305, replaces the row recording 305", rescope({ since: at("10:00"), spec_pr: 301 }), 305],
  ];
  for (const [what, row, specPr] of replaced) {
    it(what, async () => {
      const { asked, advanced } = await place(snapshot({ holds: [row] }), specPr);
      const placed = rescope({ since: NOW, spec_pr: specPr });
      assert.deepEqual(addedFiles(asked[0]), filesOf(event.hold(placementOf(placed))));
      assert.deepEqual(advanced.snapshot?.holds, [placed]);
    });
  }
});

describe("recordGates", () => {
  const before = gates({ lineages: [lineage("L6")] });
  const after = gates({ lineages: [lineage("L6"), lineage("L7")] });
  const question = "Line 4 says parse refuses a null header; parse(null) returns {}.";
  type Bug = Gates["bugs"][number];
  const tree = (n: number, time: string) => ({ tree: sha(n), at: time });
  const bug = (id: string, members: Bug["members"], absorbed: Bug["absorbed"] = []): Bug => ({ id, members, absorbed, ranges: [], deep: null, rulings: [] });

  async function record(state: Snapshot | null, ref: string, next: Gates, openings: Opening[]) {
    const ledger = fakeLedger();
    if (state === null) eventCommit(ledger, [event.round(round(1))], { issue: 7 });
    else storyOf(ledger, state);
    const reading = await readingOf(ledger);
    const out = writer(ledger);
    const advanced = await recordGates(reader({}, ledger), out, REPO, ISSUE, SHARED, reading, ref, next, openings);
    return { ledger, out, reading, advanced };
  }

  it("commits gates.<ref>.json and a hold per opening as one commit, a claim- opening carrying its question", async () => {
    const state = snapshot({ gates: before, holds: [hold("pushback-212")] });
    const { out, advanced } = await record(state, "check-2", after, [
      { id: "claim-L7", question },
      { id: "shim-B3", question: null },
    ]);
    const claim = hold("claim-L7", { since: NOW, question });
    const shim = hold("shim-B3", { since: NOW });
    const input = onlyCommit(out);
    assert.equal(input.message.headline, "issues/212: hold, gates");
    assert.deepEqual(addedFiles(input), filesOf(event.hold(placementOf(claim)), event.hold(placementOf(shim)), event.gates("check-2", after)));
    assert.deepEqual(advanced.snapshot, { ...state, gates: after, holds: [state.holds[0], claim, shim] });
  });

  it("commits the gates and leaves an OPEN row as it is", async () => {
    const state = snapshot({ gates: before, holds: [hold("claim-L7", { question: "Asked before?" })] });
    const { out, advanced } = await record(state, "check-2", after, [{ id: "claim-L7", question }]);
    assert.deepEqual(addedFiles(onlyCommit(out)), filesOf(event.gates("check-2", after)));
    assert.deepEqual(advanced.snapshot, { ...state, gates: after });
  });

  it("reopens a RELEASED row in its place with a new since and question, still one row per id", async () => {
    const state = snapshot({ gates: before, holds: [releasedHold("claim-L7", 90, { since: at("08:00"), released: at("08:30") }), hold("pushback-212")] });
    const { advanced } = await record(state, "check-2", after, [{ id: "claim-L7", question }]);
    assert.deepEqual(advanced.snapshot?.holds, [hold("claim-L7", { since: NOW, question }), state.holds[1]]);
  });

  it("writes the first gates of a story with no directory, every time from now()", async () => {
    const first = gates({ lineages: after.lineages, bugs: [bug("B3", [tree(2, at("23:59"))], [tree(6, at("23:59"))])] });
    const { out, advanced } = await record(null, "check-1", first, [{ id: "shim-B3", question: null }]);
    const stamped = {
      ...first,
      lineages: first.lineages.map((each) => ({ ...each, chain: each.chain.map((entry) => ({ ...entry, at: NOW })) })),
      bugs: [bug("B3", [tree(2, NOW)], [tree(6, NOW)])],
    };
    assert.deepEqual(addedFiles(onlyCommit(out)), filesOf(event.hold(placementOf(hold("shim-B3", { since: NOW }))), event.gates("check-1", stamped)));
    assert.deepEqual(advanced.snapshot, { ...EMPTY, holds: [hold("shim-B3", { since: NOW })], gates: stamped });
  });

  it("stamps each time from GitHub's clock: an entry the reading holds, by ref and claim or by tree, keeps its time, any other takes now", async () => {
    const forged = at("23:59");
    const entry = (ref: number, claim: string, time: string) => ({ ...lineage("L6").chain[0], ref: sha(ref), claim, at: time });
    const read = gates({
      lineages: [lineage("L6", { chain: [entry(1, "c1", at("09:00"))] })],
      bugs: [bug("B3", [tree(2, at("09:10"))]), bug("B4", [tree(6, at("09:20"))])],
    });
    // B4 merges into B3: its tree moves to B3's absorbed.
    const next = gates({
      lineages: [
        lineage("L6", { chain: [entry(1, "c1", forged), entry(3, "c1", forged)] }),
        lineage("L7", { chain: [entry(1, "c2", forged), entry(3, "c2", forged)] }),
      ],
      bugs: [bug("B3", [tree(2, forged), tree(4, forged)], [tree(6, forged), tree(5, forged)])],
    });
    const { advanced } = await record(snapshot({ gates: read }), "check-2", next, []);
    assert.deepEqual(advanced.snapshot?.gates, {
      ...next,
      lineages: [
        lineage("L6", { chain: [entry(1, "c1", at("09:00")), entry(3, "c1", NOW)] }),
        lineage("L7", { chain: [entry(1, "c2", NOW), entry(3, "c2", NOW)] }),
      ],
      bugs: [bug("B3", [tree(2, at("09:10")), tree(4, NOW)], [tree(6, at("09:20")), tree(5, NOW)])],
    });
  });

  it("commits nothing on a retry of its ref once committed: its gates file is in the fold and every opening is OPEN", async () => {
    const { ledger, advanced } = await record(snapshot({ gates: before }), "check-2", after, [{ id: "claim-L7", question }]);
    const out = writer(ledger);
    const again = await recordGates(reader({}, ledger), out, REPO, ISSUE, SHARED, advanced, "check-2", after, [{ id: "claim-L7", question }]);
    assert.deepEqual(commitsAsked(out), []);
    assert.deepEqual(again, advanced);
  });

  const placers: Array<[string, string]> = [
    ["pushback-212", "writeState"],
    ["escalation-212", "writeState"],
    ["audit-212", "writeState"],
    ["rescope-212", "placeRescopeHold"],
  ];
  for (const [id, placer] of placers) {
    it(`refuses an opening of ${id}, naming it and ${placer} as its release, asking GitHub nothing`, async () => {
      const ledger = ledgerOf(snapshot({ gates: before }));
      const reading = await readingOf(ledger);
      const out = writer(ledger);
      const read = reader({}, ledger);
      await assert.rejects(recordGates(read, out, REPO, ISSUE, SHARED, reading, "check-2", after, [{ id, question: null }]), (error: unknown) => {
        refusal(new RegExp(id))(error);
        assert.match((error as StateWriteRefused).release ?? "", new RegExp(`^${placer}\\b`));
        return true;
      });
      assert.deepEqual([...read.calls, ...out.calls], []);
    });
  }

  const broken: Array<[string, Gates, Opening[]]> = [
    ["an anchor that is no sha", { ...after, anchor: "HEAD" }, []],
    ["a claim- opening without its question", after, [{ id: "claim-L7", question: null }]],
    ["a shim- opening with a question", after, [{ id: "shim-B3", question: "Why?" }]],
  ];
  for (const [what, next, openings] of broken) {
    it(`refuses ${what}, which breaks the contract, asking GitHub nothing`, async () => {
      const ledger = ledgerOf(snapshot({ gates: before }));
      const reading = await readingOf(ledger);
      const out = writer(ledger);
      const read = reader({}, ledger);
      await assert.rejects(recordGates(read, out, REPO, ISSUE, SHARED, reading, "check-2", next, openings), refusal(/contract/));
      assert.deepEqual([...read.calls, ...out.calls], []);
    });
  }
});

describe("releaseOnClaim", () => {
  const holds = [
    hold("pushback-212", { since: at("10:00") }),
    hold("escalation-212", { since: at("10:00") }),
    hold("audit-212", { since: at("10:00") }),
    releasedHold("claim-L7", 80, { since: at("08:00"), released: at("08:30") }),
  ];
  const state = snapshot({ holds, pushbacks: [{ key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1 } }] });

  async function release(ledger: FakeLedger, issue: Issue) {
    const reading = await readingOf(ledger, issue);
    const read = reader(issue, ledger);
    const out = writer(ledger);
    const answer = await releaseOnClaim(read, out, REPO, ISSUE, SHARED, reading);
    return { read, out, reading, answer };
  }

  it("commits a release per releasable hold as one commit, each by its comment at now(), every other row unchanged", async () => {
    const issue: Issue = { comments: [adminComment(201, "10:30")], moves: [move("11:00")] };
    const { out, answer } = await release(ledgerOf(state), issue);
    const input = onlyCommit(out);
    assert.equal(input.message.headline, "issues/212: release");
    assert.deepEqual(addedFiles(input), filesOf(event.release("pushback-212", at("10:00"), NOW, 201), event.release("audit-212", at("10:00"), NOW, 201)));
    const releasedBy = { comment: 201, reset: false };
    assert.deepEqual(answer.reading.snapshot, {
      ...state,
      holds: [
        { ...holds[0], state: "RELEASED", released: NOW, released_by: releasedBy },
        holds[1],
        { ...holds[2], state: "RELEASED", released: NOW, released_by: releasedBy },
        holds[3],
      ],
    });
    const by = { id: 201, url: adminComment(201, "10:30").url, at: at("10:30") };
    assert.deepEqual(answer.released, [
      { id: "pushback-212", comment: by, reset: false },
      { id: "audit-212", comment: by, reset: false },
    ]);
    assert.equal(answer.reset, null);
  });

  it("records a reset's release as a reset", async () => {
    const reset = adminComment(300, "10:30", "/codeworks reset");
    const { answer } = await release(ledgerOf(state), { comments: [reset] });
    assert.deepEqual(
      answer.reading.snapshot?.holds.map((row) => row.released_by),
      [{ comment: 300, reset: true }, { comment: 300, reset: true }, { comment: 300, reset: true }, holds[3].released_by],
    );
    assert.deepEqual(answer.reset, { url: reset.url, at: reset.createdAt });
  });

  it("releases a cleared tamper on an admin's comment and a Ready move, both after the tamper, in release.tamper-<oid>.json", async () => {
    const ledger = ledgerOf(snapshot());
    const name = fileOf(event.round(round(2)));
    const oid = invalidCommit(ledger, { put: { [name]: eventText(event.round(round(2))) }, date: at("10:15") });
    clearanceCommit(ledger, [name], { date: at("10:20") });
    const issue: Issue = { comments: [adminComment(201, "10:45")], moves: [move("11:00")] };
    const { out, answer } = await release(ledger, issue);
    assert.deepEqual(addedFiles(onlyCommit(out)), filesOf(event.release(`tamper-${oid}`, null, NOW, 201)));
    const by = { id: 201, url: adminComment(201, "10:45").url, at: at("10:45") };
    assert.deepEqual(answer.released, [{ id: `tamper-${oid}`, comment: by, reset: false }]);
    assert.deepEqual(answer.reading.tamper, [{ commit: oid, at: at("10:15"), remaining: [], released: true, releasable: null }]);
    assert.deepEqual([answer.reading.held, answer.reading.causes, answer.reading.startable], [false, [], true]);
  });

  it("commits nothing when it releases no hold and no tamper", async () => {
    const { out, reading, answer } = await release(ledgerOf(state), {});
    assert.deepEqual(out.calls, []);
    assert.deepEqual(answer, { released: [], reset: null, reading });
  });

  it("is refused while a tamper stands whose files are still on ledger, naming them, asking GitHub nothing", async () => {
    const ledger = ledgerOf(state);
    const name = fileOf(event.round(round(2)));
    invalidCommit(ledger, { put: { [name]: eventText(event.round(round(2))) }, date: at("10:15") });
    const issue: Issue = { comments: [adminComment(201, "10:45")], moves: [move("11:00")] };
    const reading = await readingOf(ledger, issue);
    const out = writer(ledger);
    const read = reader(issue, ledger);
    await assert.rejects(releaseOnClaim(read, out, REPO, ISSUE, SHARED, reading), refusal(new RegExp(inStory(name).replaceAll(".", "\\."))));
    assert.deepEqual([...read.calls, ...out.calls], []);
  });

  it("decides from its reading and writes with one now(), reading nothing", async () => {
    const { read, out } = await release(ledgerOf(state), { comments: [adminComment(201, "10:30")], moves: [move("11:00")] });
    assert.deepEqual(read.calls, []);
    assert.deepEqual(
      out.calls.map((call) => call.kind),
      ["now", "graphql"],
    );
  });
});
