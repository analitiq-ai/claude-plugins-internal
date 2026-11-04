import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { eventText, type LedgerEvent } from "../src/contracts/ledger.ts";
import type { Snapshot } from "../src/contracts/snapshot.ts";
import { GitHubRefused, GitHubUnanswered, type GitHubClient } from "../src/github.ts";
import { BoardNotVisible, issueComments, LedgerMissing, readState, storyTouched, type StateReading } from "../src/state.ts";
import {
  ADMIN,
  BOARD,
  ISSUE,
  ORCHESTRATOR_APP,
  OTHER_PROJECT,
  REPO,
  SHARED,
  adminComment,
  at,
  comment,
  fixRuling,
  gates,
  hold,
  move,
  placementOf,
  pushbackRuling,
  reader,
  round,
  sha,
  snapshot,
  type Issue,
} from "./fixtures/state/issue.ts";
import {
  GITHUB_SIGNED,
  OWN_KEY_SIGNED,
  clearanceCommit,
  event,
  eventCommit,
  fakeLedger,
  fileOf,
  invalidCommit,
  reviewerCommit,
  storyDir,
  type FakeLedger,
  type Signature,
} from "./fixtures/state/ledger.ts";
import { fakeGitHub, type FakeAnswer } from "./support/fake-github.ts";

async function read(ledger: FakeLedger, issue: Issue = {}): Promise<StateReading> {
  return readState(reader(issue, ledger), REPO, ISSUE, SHARED);
}

function files(...events: LedgerEvent[]): Record<string, string> {
  return Object.fromEntries(events.map((each) => [fileOf(each), eventText(each)]));
}

const ROUND_1 = round(1, { result: "DIRTY", verdict: "PATCH" });
const ROUND_1_ID = { stage: "INTERNAL", n: 1 } as const;
const BY_THE_APP = { signature: GITHUB_SIGNED, author: SHARED.reviewer_app_login };

// A tamper's remaining files are named from the repository root, as the admin deleting them finds them.
function inStory(name: string): string {
  return `${storyDir()}/${name}`;
}

describe("readState: the ledger branch", () => {
  it("throws LedgerMissing naming orchestrator README.md step 6 when the repository has no ledger branch", async () => {
    await assert.rejects(read(fakeLedger({ exists: false })), (error: unknown) => {
      assert.ok(error instanceof LedgerMissing, `expected LedgerMissing, got ${String(error)}`);
      assert.match(error.message, /orchestrator/);
      assert.match(error.message, /README\.md/);
      assert.match(error.message, /step 6/);
      return true;
    });
  });

  it("answers no snapshot, not held and startable, at the ledger's head, when issues/212/ has no file", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(round(1))], { issue: 7 });
    const reading = await read(ledger);
    assert.equal(reading.head, ledger.head);
    assert.equal(reading.snapshot, null);
    assert.deepEqual([reading.held, reading.causes, reading.tamper, reading.startable], [false, [], [], true]);
  });
});

describe("readState: the fold of the story's event commits", () => {
  it("folds the event commits oldest first into the snapshot their events give, at the ledger's head", async () => {
    const ledger = fakeLedger();
    const fix = sha(77);
    const pushback = hold("pushback-212", { since: at("09:40") });
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    eventCommit(ledger, [event.ruling(fixRuling("PRRC_1", 1, []))], { date: at("09:10") });
    eventCommit(ledger, [event.rulingCommit(ROUND_1_ID, "PRRC_1", fix)], { date: at("09:20") });
    eventCommit(ledger, [event.round(round(2))], { date: at("09:30") });
    eventCommit(ledger, [event.pushback({ key: "PRRC_2", round: { stage: "INTERNAL", n: 2 } })], { date: at("09:35") });
    eventCommit(ledger, [event.hold(placementOf(pushback))], { date: at("09:40") });
    eventCommit(ledger, [event.release("pushback-212", at("09:40"), at("09:50"), 201)], { date: at("09:50") });
    eventCommit(ledger, [event.gates("check-1", gates({ branch: "212-first" }))], { date: at("09:52") });
    eventCommit(ledger, [event.gates("check-2", gates())], { date: at("09:55") });
    eventCommit(ledger, [event.round(round(1))], { issue: 7, date: at("09:58") });

    const reading = await read(ledger);
    assert.equal(reading.head, ledger.head);
    assert.deepEqual(
      reading.snapshot,
      snapshot({
        rounds: [ROUND_1, round(2)],
        rulings: [fixRuling("PRRC_1", 1, [fix])],
        pushbacks: [{ key: "PRRC_2", round: { stage: "INTERNAL", n: 2 } }],
        holds: [{ ...pushback, state: "RELEASED", released: at("09:50"), released_by: { comment: 201, reset: false } }],
        gates: gates(),
      }),
    );
    assert.deepEqual(reading.newest_round, round(2));
    assert.deepEqual([...reading.pushed_back], [["PRRC_2", { stage: "INTERNAL", n: 2 }]]);
    assert.deepEqual([reading.held, reading.causes, reading.tamper, reading.startable], [false, [], [], true]);
  });

  it("folds one commit's events to one snapshot, with no tamper, whether it lists them in reverse kind order, by file name or in kind order", async () => {
    const fix = sha(77);
    const third = { stage: "INTERNAL", n: 3 } as const;
    const audit = hold("audit-212", { since: at("10:00") });
    const kindOrder: LedgerEvent[] = [
      event.round(round(3, { result: "DIRTY", verdict: "PATCH" })),
      event.ruling(fixRuling("PRRC_3", 3, [])),
      event.rulingCommit(third, "PRRC_3", fix),
      event.pushback({ key: "PRRC_9", round: third }),
      event.hold(placementOf(audit)),
      event.release("audit-212", at("10:00"), at("10:00"), 201),
    ];
    const byName = [...kindOrder].sort((a, b) => (fileOf(a) < fileOf(b) ? -1 : 1));
    assert.notDeepEqual(byName, kindOrder);
    const listings: Array<[string, LedgerEvent[]]> = [
      ["reverse kind order", [...kindOrder].reverse()],
      ["file-name order", byName],
      ["kind order", kindOrder],
    ];
    for (const [listing, events] of listings) {
      const ledger = fakeLedger();
      eventCommit(ledger, events);
      const reading = await read(ledger);
      assert.deepEqual(reading.tamper, [], listing);
      assert.deepEqual(
        reading.snapshot,
        snapshot({
          rounds: [round(3, { result: "DIRTY", verdict: "PATCH" })],
          rulings: [fixRuling("PRRC_3", 3, [fix])],
          pushbacks: [{ key: "PRRC_9", round: third }],
          holds: [{ ...audit, state: "RELEASED", released: at("10:00"), released_by: { comment: 201, reset: false } }],
        }),
        listing,
      );
    }
  });

  it("applies one commit's events of one kind in the order of their file names, whether it lists them in that order or the reverse", async () => {
    const byName = [event.hold(placementOf(hold("audit-212"))), event.hold(placementOf(hold("escalation-212")))];
    for (const events of [byName, [...byName].reverse()]) {
      const ledger = fakeLedger();
      eventCommit(ledger, events);
      const reading = await read(ledger);
      assert.deepEqual(
        reading.snapshot?.holds.map((row) => row.id),
        ["audit-212", "escalation-212"],
      );
    }
  });

  it("reopens a released row in place with the new placement, one row per id", async () => {
    const ledger = fakeLedger();
    const first = hold("pushback-212", { since: at("09:00") });
    const audit = hold("audit-212", { since: at("09:15") });
    const again = hold("pushback-212", { since: at("10:00") });
    eventCommit(ledger, [event.hold(placementOf(first))], { date: at("09:00") });
    eventCommit(ledger, [event.hold(placementOf(audit))], { date: at("09:15") });
    eventCommit(ledger, [event.release("pushback-212", at("09:00"), at("09:30"), 201)], { date: at("09:30") });
    eventCommit(ledger, [event.hold(placementOf(again))], { date: at("10:00") });
    const reading = await read(ledger);
    assert.deepEqual(reading.tamper, []);
    assert.deepEqual(reading.snapshot?.holds, [again, audit]);
  });

  it("places a rescope row, then replaces it while OPEN each time a rescope event records a spec PR the row does not", async () => {
    const ledger = fakeLedger();
    const rows = [
      hold("rescope-212", { since: at("10:00") }),
      hold("rescope-212", { since: at("10:30"), spec_pr: 301 }),
      hold("rescope-212", { since: at("10:40"), spec_pr: 305 }),
    ];
    for (const row of rows) {
      eventCommit(ledger, [event.hold(placementOf(row))], { date: row.since });
      const reading = await read(ledger);
      assert.deepEqual(reading.tamper, [], row.since);
      assert.deepEqual(reading.snapshot?.holds, [row], row.since);
    }
  });

  it("reads each event from the blob of the commit that added it, so a later change in place changes no event", async () => {
    const ledger = fakeLedger();
    const row = hold("escalation-212");
    const placed = event.hold(placementOf(row));
    eventCommit(ledger, [placed], { date: at("10:00") });
    const changed = event.hold({ ...placementOf(row), question: "Something else?" });
    const oid = invalidCommit(ledger, { put: { [fileOf(placed)]: eventText(changed) }, date: at("10:05") });
    const reading = await read(ledger);
    assert.deepEqual(reading.snapshot?.holds, [row]);
    assert.deepEqual(
      reading.tamper.map((tamper) => [tamper.commit, tamper.remaining]),
      [[oid, [inStory(fileOf(placed))]]],
    );
  });
});

type Breach = {
  name: string;
  /** What the story holds before the breach, in one event commit. */
  base: LedgerEvent[];
  /** Story file names with texts, added or changed. */
  put?: Record<string, string>;
  remove?: string[];
  signature?: Signature | null;
  author?: string | null;
  /** The breaching commit's added or changed files still at the head. */
  remaining: string[];
};

const ROUND_2 = event.round(round(2));
const ESCALATION = event.hold(placementOf(hold("escalation-212", { since: at("09:00") })));
const PUSHBACK_HOLD = event.hold(placementOf(hold("pushback-212", { since: at("09:00") })));
const PUSHED_BACK = event.ruling(pushbackRuling("PRRC_1", 1));
const RESCOPE_301 = event.hold(placementOf(hold("rescope-212", { since: at("09:00"), spec_pr: 301 })));
// sha256("PRRC_1"), as the contract names a ruling's file.
const PRRC_1_HASH = "e6f3b753e424c4cbbd60c7c9e0b381d640245313c4976498a0f189c3d53a36db";

function breachOf(name: string, put: Record<string, string>, base: LedgerEvent[] = [event.round(ROUND_1)]): Breach {
  return { name, base, put, ...BY_THE_APP, remaining: Object.keys(put) };
}

const BREACHES: Breach[] = [
  { name: "an unsigned commit by the reviewer App", base: [event.round(ROUND_1)], put: files(ROUND_2), signature: null, author: SHARED.reviewer_app_login, remaining: [fileOf(ROUND_2)] },
  {
    name: "a reviewer App commit signed with a key of its own, not GitHub's",
    base: [event.round(ROUND_1)],
    put: files(ROUND_2),
    signature: OWN_KEY_SIGNED,
    author: SHARED.reviewer_app_login,
    remaining: [fileOf(ROUND_2)],
  },
  {
    name: "a reviewer App commit whose signature GitHub finds invalid",
    base: [event.round(ROUND_1)],
    put: files(ROUND_2),
    signature: { isValid: false, wasSignedByGitHub: true },
    author: SHARED.reviewer_app_login,
    remaining: [fileOf(ROUND_2)],
  },
  { name: "a GitHub-signed commit by an admin adding an event", base: [event.round(ROUND_1)], put: files(ROUND_2), signature: GITHUB_SIGNED, author: ADMIN.login, remaining: [fileOf(ROUND_2)] },
  { name: "a GitHub-signed commit by an author GitHub maps to no account", base: [event.round(ROUND_1)], put: files(ROUND_2), signature: GITHUB_SIGNED, author: null, remaining: [fileOf(ROUND_2)] },
  {
    name: "the reviewer App changing an event file in place",
    base: [event.round(ROUND_1), ESCALATION],
    put: { [fileOf(ESCALATION)]: eventText(event.hold({ ...placementOf(hold("escalation-212", { since: at("09:00") })), question: "Another?" })) },
    ...BY_THE_APP,
    remaining: [fileOf(ESCALATION)],
  },
  { name: "the reviewer App deleting an event file", base: [event.round(ROUND_1), PUSHBACK_HOLD], remove: [fileOf(PUSHBACK_HOLD)], ...BY_THE_APP, remaining: [] },
  breachOf("the reviewer App adding an event in a file its contract does not name", { "round.run-9.json": eventText(ROUND_2) }),
  breachOf("the reviewer App adding a file that is not JSON", { "round.run-2.json": "round 2\n" }),
  breachOf("the reviewer App adding JSON that is no event", { "note.json": '{\n  "note": "hi"\n}\n' }),
  breachOf("the reviewer App adding an event of a version the contract does not define", {
    "round.run-2.json": `${JSON.stringify({ kind: "round", v: 2, round: round(2) }, null, 2)}\n`,
  }),
  breachOf("the reviewer App adding a ruling that names its commits", {
    [`ruling.INTERNAL-1.${PRRC_1_HASH}.json`]: `${JSON.stringify({ kind: "ruling", v: 1, ruling: fixRuling("PRRC_1", 1, [sha(5)]) }, null, 2)}\n`,
  }),
  breachOf("a hold on an OPEN row", files(event.hold(placementOf(hold("escalation-212", { since: at("09:30") })))), [event.round(ROUND_1), ESCALATION]),
  breachOf("a rescope recording the spec PR its OPEN row records", files(event.hold(placementOf(hold("rescope-212", { since: at("09:30"), spec_pr: 301 })))), [
    event.round(ROUND_1),
    RESCOPE_301,
  ]),
  breachOf("a rescope recording no spec PR on an OPEN row", files(event.hold(placementOf(hold("rescope-212", { since: at("09:30") })))), [
    event.round(ROUND_1),
    RESCOPE_301,
  ]),
  breachOf("a round whose stage and n are in rounds", files(event.round(round(1, { run: "run-1b" })))),
  breachOf("a ruling whose round is not in rounds", files(event.ruling(pushbackRuling("PRRC_5", 5)))),
  breachOf("a ruling-commit with no ruling", files(event.rulingCommit(ROUND_1_ID, "PRRC_1", sha(5)))),
  breachOf("a ruling-commit of a ruling that is not FIX", files(event.rulingCommit(ROUND_1_ID, "PRRC_1", sha(5))), [event.round(ROUND_1), PUSHED_BACK]),
  breachOf("a pushback whose round is not in rounds", files(event.pushback({ key: "PRRC_1", round: { stage: "INTERNAL", n: 4 } }))),
  breachOf("a release naming a since its OPEN row does not have", files(event.release("pushback-212", at("08:59"), at("09:30"), 201)), [
    event.round(ROUND_1),
    PUSHBACK_HOLD,
  ]),
  breachOf("a release of a hold with no row", files(event.release("audit-212", at("09:00"), at("09:30"), 201))),
  breachOf("a release of a tamper the fold has not derived", files(event.release(`tamper-${sha(9)}`, null, at("09:30"), 201))),
];

describe("readState: a commit the fold takes as invalid", () => {
  for (const breach of BREACHES) {
    it(`for ${breach.name}: applies none of it, derives its tamper with its remaining files, and holds the story`, async () => {
      const before = fakeLedger();
      eventCommit(before, breach.base, { date: at("09:00") });
      const ledger = fakeLedger();
      eventCommit(ledger, breach.base, { date: at("09:00") });
      const { put, remove, signature, author } = breach;
      const oid = invalidCommit(ledger, { put, remove, signature, author, date: at("09:30") });

      const reading = await read(ledger);
      const remaining = breach.remaining.map(inStory);
      assert.deepEqual(reading.snapshot, (await read(before)).snapshot);
      assert.deepEqual(reading.tamper, [{ commit: oid, at: at("09:30"), remaining, released: false, releasable: null }]);
      assert.deepEqual(
        reading.causes.filter((cause) => cause.cause === "tampered"),
        [{ cause: "tampered", commit: oid, remaining }],
      );
      assert.deepEqual([reading.held, reading.startable], [true, false]);
    });
  }
});

describe("readState: an admin's clearance", () => {
  const added = files(ROUND_2);

  it("changes nothing, derives no tamper, and empties the remaining files of the invalid commit it clears", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const oid = invalidCommit(ledger, { put: added, date: at("09:30") });
    clearanceCommit(ledger, Object.keys(added), { date: at("10:30") });
    const reading = await read(ledger);
    assert.deepEqual(reading.snapshot, snapshot({ rounds: [ROUND_1] }));
    assert.deepEqual(
      reading.tamper.map((tamper) => [tamper.commit, tamper.remaining]),
      [[oid, []]],
    );
    assert.deepEqual(reading.causes, [{ cause: "tampered", commit: oid, remaining: [] }]);
  });

  it("of a file an invalid commit changed in place leaves the event the file first held in the fold", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1), ESCALATION], { date: at("09:00") });
    const changed = event.hold({ ...placementOf(hold("escalation-212", { since: at("09:00") })), question: "Another?" });
    const oid = invalidCommit(ledger, { put: { [fileOf(ESCALATION)]: eventText(changed) }, date: at("09:30") });
    clearanceCommit(ledger, [fileOf(ESCALATION)], { date: at("10:30") });
    const reading = await read(ledger);
    assert.deepEqual(reading.snapshot?.holds, [hold("escalation-212", { since: at("09:00") })]);
    assert.deepEqual(
      reading.tamper.map((tamper) => [tamper.commit, tamper.remaining]),
      [[oid, []]],
    );
  });

  type NotClearance = { name: string; remove: (eventFiles: string[]) => string[]; put?: Record<string, string>; author?: string; signature?: Signature };
  const NOT_CLEARANCES: NotClearance[] = [
    { name: "a deletion by a writer whose role is maintain, not admin", remove: () => Object.keys(added), author: "bob" },
    { name: "a deletion signed with the admin's own key", remove: () => Object.keys(added), signature: OWN_KEY_SIGNED },
    { name: "a deletion that also removes an event file", remove: (eventFiles) => [...Object.keys(added), ...eventFiles] },
  ];
  for (const { name, remove, author = ADMIN.login, signature = GITHUB_SIGNED } of NOT_CLEARANCES) {
    it(`takes ${name} as invalid, its own tamper derived`, async () => {
      const ledger = fakeLedger();
      const pushback = event.hold(placementOf(hold("pushback-212", { since: at("09:00") })));
      eventCommit(ledger, [event.round(ROUND_1), pushback], { date: at("09:00") });
      const first = invalidCommit(ledger, { put: added, date: at("09:30") });
      const second = ledger.commit({
        remove: remove([fileOf(pushback)]).map((file) => `issues/${ISSUE}/${file}`),
        date: at("10:30"),
        author,
        signature,
      });
      const reading = await read(ledger, { roles: { [ADMIN.login]: "admin", bob: "maintain" } });
      assert.deepEqual(
        reading.tamper.map((tamper) => tamper.commit),
        [first, second],
      );
      assert.deepEqual(reading.snapshot?.holds, [hold("pushback-212", { since: at("09:00") })]);
    });
  }

  it("takes a deletion that also adds a file as invalid, the added file remaining", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const first = invalidCommit(ledger, { put: added, date: at("09:30") });
    const second = invalidCommit(ledger, { remove: Object.keys(added), put: { "note.json": "{}\n" }, signature: GITHUB_SIGNED, date: at("10:30") });
    const reading = await read(ledger);
    assert.deepEqual(
      reading.tamper.map((tamper) => [tamper.commit, tamper.remaining]),
      [
        [first, []],
        [second, [inStory("note.json")]],
      ],
    );
  });

  it("takes an admin's deletion of an event file no invalid commit added as invalid, the deleted event still in the fold", async () => {
    const ledger = fakeLedger();
    const pushback = event.hold(placementOf(hold("pushback-212", { since: at("09:00") })));
    eventCommit(ledger, [event.round(ROUND_1), pushback], { date: at("09:00") });
    const oid = clearanceCommit(ledger, [fileOf(pushback)], { date: at("10:30") });
    const reading = await read(ledger);
    assert.deepEqual(reading.snapshot, snapshot({ rounds: [ROUND_1], holds: [hold("pushback-212", { since: at("09:00") })] }));
    assert.deepEqual(reading.tamper, [{ commit: oid, at: at("10:30"), remaining: [], released: false, releasable: null }]);
  });
});

describe("readState: the reads it makes", () => {
  it("refuses the read when REST's commit list for the story differs from GraphQL's, naming both", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const oid = eventCommit(ledger, [event.round(round(2))], { date: at("09:30") });
    ledger.restOmits = [oid];
    await assert.rejects(read(ledger), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /GraphQL/);
      assert.match(error.message, /REST/);
      return true;
    });
  });

  it("reads each of the branch's four history pages, the story's path history and the REST commit list at the head it read first, though a commit lands after it", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    invalidCommit(ledger, { remove: [], put: files(ROUND_2), date: at("09:30") });
    for (const clock of ["09:40", "09:41", "09:42", "09:43", "09:44"]) eventCommit(ledger, [event.round(round(1))], { issue: 7, date: at(clock) });
    const head = ledger.head;

    const base = reader({}, ledger);
    let landed = false;
    const client: GitHubClient = {
      ...base,
      async graphql(query, vars) {
        const answer = await base.graphql(query, vars);
        if (!landed && /\bref\(qualifiedName:/.test(query)) {
          landed = true;
          eventCommit(ledger, [event.round(round(2))], { issue: 7, date: at("09:45") });
        }
        return answer;
      },
    };
    const reading = await readState(client, REPO, ISSUE, SHARED);
    assert.ok(landed && ledger.head !== head, "a commit landed after the first read");
    assert.equal(reading.head, head);
    const reads = (kind: string) =>
      base.calls.flatMap((call) => {
        if (kind === "branch page" && call.kind === "graphql" && /\bhistory\(first: \d+, after: \$cursor\)/.test(call.query)) {
          return [[call.vars.head, call.vars.cursor ?? null]];
        }
        if (kind === "path history" && call.kind === "graphqlPages" && "path" in call.vars) return [call.vars.head];
        if (kind === "REST list" && call.kind === "restPages") return [new URL(call.path, "https://api.github.com").searchParams.get("sha")];
        return [];
      });
    assert.deepEqual(reads("branch page"), [[head, null], [head, "2"], [head, "4"], [head, "6"]], "seven commits, two to a page");
    for (const kind of ["path history", "REST list"]) {
      const heads = reads(kind);
      assert.ok(heads.length > 0, `no ${kind} read`);
      assert.deepEqual(heads, heads.map(() => head), `a ${kind} read not at the first head`);
    }
  });
});

describe("readState: release floors", () => {
  it("floors a hold's release at its placing commit's committedDate, not its since", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.hold(placementOf(hold("pushback-212", { since: at("10:00") })))], { date: at("10:20") });
    const commentBefore = await read(ledger, { comments: [adminComment(201, "10:10")], moves: [move("11:00")] });
    assert.deepEqual(commentBefore.releasable, []);
    const readyBefore = await read(ledger, { comments: [adminComment(202, "10:30")], moves: [move("10:10")] });
    assert.deepEqual(readyBefore.releasable, []);
    const after = await read(ledger, { comments: [adminComment(202, "10:30")], moves: [move("11:00")] });
    assert.deepEqual(
      after.releasable.map((release) => [release.id, release.comment.id]),
      [["pushback-212", 202]],
    );
  });

  it("floors a tamper at the first GitHub-signed commit after it, so one dated a year ahead is releasable after its clearance", async () => {
    const ledger = fakeLedger();
    const added = files(ROUND_2);
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const oid = invalidCommit(ledger, { put: added, signature: OWN_KEY_SIGNED, date: "2027-10-28T10:00:00Z" });
    clearanceCommit(ledger, Object.keys(added), { date: at("10:30") });
    const reading = await read(ledger, { comments: [adminComment(201, "10:45")], moves: [move("11:00")] });
    const release = { id: `tamper-${oid}`, comment: { id: 201, url: adminComment(201, "10:45").url, at: at("10:45") }, reset: false };
    assert.deepEqual(reading.tamper, [{ commit: oid, at: at("10:30"), remaining: [], released: false, releasable: release }]);
    assert.equal(reading.startable, true);
  });

  it("floors a tamper at its own committedDate when that is the earlier", async () => {
    const ledger = fakeLedger();
    const added = files(ROUND_2);
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const oid = invalidCommit(ledger, { put: added, date: at("10:00") });
    clearanceCommit(ledger, Object.keys(added), { date: at("10:30") });
    const reading = await read(ledger, { comments: [adminComment(201, "10:15")], moves: [move("11:00")] });
    assert.deepEqual(
      reading.tamper.map((tamper) => [tamper.at, tamper.releasable?.id]),
      [[at("10:00"), `tamper-${oid}`]],
    );
  });

  it("floors a tamper at the first GitHub-signed commit after it on ledger, another story's, past unsigned ones", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1), PUSHBACK_HOLD], { date: at("09:00") });
    const oid = invalidCommit(ledger, { remove: [fileOf(PUSHBACK_HOLD)], date: "2027-10-28T10:00:00Z" });
    invalidCommit(ledger, { issue: 7, put: files(event.round(round(1))), date: at("10:05") });
    eventCommit(ledger, [event.round(round(2))], { issue: 7, date: at("10:20") });
    for (const clock of ["10:21", "10:22", "10:23", "10:24"]) eventCommit(ledger, [event.round(round(1))], { issue: 8, date: at(clock) });
    const reading = await read(ledger, { comments: [adminComment(201, "10:25")], moves: [move("11:00")] });
    assert.deepEqual(
      reading.tamper.map((tamper) => [tamper.commit, tamper.at, tamper.remaining, tamper.releasable?.comment.id]),
      [[oid, at("10:20"), [], 201]],
    );
  });

  it("releases no tamper whose remaining files are still at the head, whatever the release rule says", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const oid = invalidCommit(ledger, { put: files(ROUND_2), date: at("09:30") });
    const reading = await read(ledger, { comments: [adminComment(201, "10:45"), adminComment(202, "10:50", "/codeworks reset")], moves: [move("11:00")] });
    assert.deepEqual(reading.tamper, [{ commit: oid, at: at("09:30"), remaining: [inStory(fileOf(ROUND_2))], released: false, releasable: null }]);
    assert.equal(reading.startable, false);
  });
});

describe("readState: frozen v1 histories", () => {
  // Each file's text as it was committed, byte for byte.
  type FrozenCommit = { date: string; files: Record<string, string> };
  type Frozen = { commits: FrozenCommit[]; snapshot: Snapshot };
  const folder = new URL("./fixtures/state/v1/", import.meta.url);
  const names = readdirSync(folder).filter((name) => name.endsWith(".json"));
  const frozenOf = (name: string) => JSON.parse(readFileSync(new URL(name, folder), "utf8")) as Frozen;

  it("has at least one history, each of at least one commit, every commit adding a file", () => {
    assert.ok(names.length > 0, "no history");
    for (const name of names) {
      const { commits } = frozenOf(name);
      assert.ok(commits.length > 0, `${name} has no commit`);
      assert.ok(commits.every((commit) => Object.keys(commit.files).length > 0), `${name} has a commit adding no file`);
    }
  });

  for (const name of names) {
    it(`folds ${name} to the snapshot it was written with, deriving no tamper`, async () => {
      const frozen = frozenOf(name);
      const ledger = fakeLedger();
      for (const { date, files: written } of frozen.commits) reviewerCommit(ledger, written, { date });
      const reading = await read(ledger);
      assert.deepEqual(reading.tamper, []);
      assert.deepEqual(reading.snapshot, frozen.snapshot);
    });
  }
});

describe("storyTouched", () => {
  it("is false when only another story's commits landed after the first head", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const from = ledger.head;
    eventCommit(ledger, [event.round(round(1))], { issue: 7, date: at("09:30") });
    assert.equal(await storyTouched(reader({}, ledger), REPO, ISSUE, String(from), String(ledger.head)), false);
  });

  it("is true when a commit to the story landed after the first head", async () => {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.round(ROUND_1)], { date: at("09:00") });
    const from = ledger.head;
    eventCommit(ledger, [event.round(round(2))], { date: at("09:30") });
    eventCommit(ledger, [event.round(round(1))], { issue: 7, date: at("09:40") });
    assert.equal(await storyTouched(reader({}, ledger), REPO, ISSUE, String(from), String(ledger.head)), true);
  });
});

describe("readState: the issue reads the release rule takes", () => {
  function heldLedger(): FakeLedger {
    const ledger = fakeLedger();
    eventCommit(ledger, [event.hold(placementOf(hold("pushback-212", { since: at("10:00") })))], { date: at("10:00") });
    return ledger;
  }

  it("reads each User commenter's role once, and no App's", async () => {
    const client = reader(
      {
        comments: [adminComment(201, "10:30"), adminComment(202, "10:40"), comment(203, ORCHESTRATOR_APP, "Asked.", { createdAt: at("10:35") })],
        moves: [move("11:00")],
      },
      heldLedger(),
    );
    await readState(client, REPO, ISSUE, SHARED);
    const roleReads = client.calls.flatMap((call) => (call.kind === "rest" ? [`${call.method} ${call.path}`] : []));
    assert.deepEqual(roleReads, ["GET /repos/acme/widgets/collaborators/alice/permission"]);
  });

  it("counts an org member's comment by its role, though GitHub tells the App CONTRIBUTOR", async () => {
    const asTheAppSeesIt = { ...adminComment(201, "10:30"), authorAssociation: "CONTRIBUTOR" };
    const reading = await read(heldLedger(), { comments: [asTheAppSeesIt], moves: [move("11:00")], roles: { [ADMIN.login]: "write" } });
    assert.deepEqual(
      reading.releasable.map((release) => [release.id, release.comment.id]),
      [["pushback-212", 201]],
    );
  });

  it("fails the read when a commenter's role cannot be read", async () => {
    const client = reader({ comments: [adminComment(201, "10:30")], roles: {} }, heldLedger());
    await assert.rejects(readState(client, REPO, ISSUE, SHARED), /no answer for/);
  });

  it("throws BoardNotVisible naming the board when no item of the issue is on it", async () => {
    for (const items of [[], [OTHER_PROJECT]]) {
      await assert.rejects(read(heldLedger(), { items }), (error: unknown) => {
        assert.ok(error instanceof BoardNotVisible, `expected BoardNotVisible, got ${String(error)}`);
        assert.equal(error.board, BOARD);
        assert.ok(error.message.includes(BOARD), error.message);
        return true;
      });
    }
  });

  it("refuses an answer that is not the shape asked for, naming what was read", async () => {
    const fractional = { ...adminComment(201, "10:30"), createdAt: "2026-10-28T10:30:00.250Z" };
    await assert.rejects(read(heldLedger(), { comments: [fractional] }), /comments of acme\/widgets#212/);
  });

  it("refuses an issue that is no issue number before asking GitHub", async () => {
    for (const issue of [0, -1, 1.5, Number.NaN]) {
      const client = reader({}, heldLedger());
      await assert.rejects(readState(client, REPO, issue, SHARED), (error: unknown) => {
        assert.ok(error instanceof TypeError, `expected TypeError for ${issue}, got ${String(error)}`);
        assert.match(error.message, /not an issue number/);
        return true;
      });
      assert.deepEqual(client.calls, []);
    }
  });
});

describe("issueComments", () => {
  const comments = [
    comment(101, ADMIN, "Opened the PR.", { createdAt: at("10:00") }),
    comment(102, ORCHESTRATOR_APP, "<!-- codeworks:orchestrator-reason blocked-211 -->\nBlocked by #211.", {
      createdAt: at("10:05"),
      lastEditedAt: at("10:06"),
    }),
    comment(103, null, "Written by an account since deleted.", { createdAt: at("10:10") }),
  ];

  function commentsReader(answer: FakeAnswer) {
    return fakeGitHub({
      graphqlPages: [
        {
          when: (query, vars) => /\bcomments\(/.test(query) && vars.owner === "acme" && vars.name === "widgets" && vars.number === ISSUE,
          answer,
        },
      ],
    });
  }

  it("gives every comment of the issue asked, as GitHub lists them", async () => {
    assert.deepEqual(await issueComments(commentsReader(comments), REPO, ISSUE), comments);
  });

  it("refuses an answer that is not the shape asked for, naming what was read", async () => {
    const fractional = [{ ...comments[0], createdAt: "2026-10-28T10:00:00.250Z" }];
    await assert.rejects(issueComments(commentsReader(fractional), REPO, ISSUE), /comments of acme\/widgets#212/);
  });

  it("fails when GitHub does not answer, never reading as no comments", async () => {
    await assert.rejects(issueComments(commentsReader(new GitHubUnanswered("dummy: no answer")), REPO, ISSUE), GitHubUnanswered);
  });

  it("fails when GitHub refuses, never reading as no comments", async () => {
    await assert.rejects(issueComments(commentsReader(new GitHubRefused(403, "dummy: refused")), REPO, ISSUE), GitHubRefused);
  });

  it("refuses an issue that is no issue number before asking GitHub", async () => {
    for (const issue of [0, -1, 1.5, Number.NaN]) {
      const client = commentsReader(comments);
      await assert.rejects(issueComments(client, REPO, issue), /not an issue number/);
      assert.deepEqual(client.calls, []);
    }
  });
});
