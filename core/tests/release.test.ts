import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { eventText, type LedgerEvent } from "../src/contracts/ledger.ts";
import type { Hold, Snapshot } from "../src/contracts/snapshot.ts";
import { questionTag, readState, releaseOnClaim, StateWriteRefused, type Releasable, type Tamper } from "../src/state.ts";
import {
  ADMIN,
  ISSUE,
  NOW,
  ORCHESTRATOR_APP,
  OTHER_PROJECT,
  PLANNER_APP,
  REPO,
  REVIEWER_APP,
  SESSION_APP,
  SHARED,
  addedFiles,
  adminComment,
  at,
  comment,
  commitsAsked,
  hold,
  move,
  questionComment,
  reader,
  round,
  url,
  writer,
  type Issue,
} from "./fixtures/state/issue.ts";
import { clearanceCommit, event, eventCommit, fakeLedger, fileOf, invalidCommit, placeHolds, storyDir } from "./fixtures/state/ledger.ts";

/** An admin's unsigned commit at `at`: it adds a stray file an admin's deletion at `cleared` removes, or it deletes `deletes`. */
type Tampering = { at: string; cleared?: string; deletes?: string };

// One fixture set for the orchestrator's read and reviewer's release alike, so the two can never answer apart.
type Fixture = {
  name: string;
  /** Placed by `placeHolds`; with neither this nor `tampers` given, the story has no directory. */
  holds?: Hold[];
  tampers?: Tampering[];
  issue: Issue;
  /** Each releasable hold, then tamper (`tamper-<i>`, the i-th), as [id, the releasing comment's databaseId, whether it is a reset]. */
  releasable: Array<[string, number, boolean]>;
  startable: boolean;
  /** The databaseId of the newest admin reset. */
  reset?: number;
};

const PUSHBACK = hold("pushback-212", { since: at("10:00") });
const ESCALATION = hold("escalation-212", { since: at("10:00") });
const ROUND_FILE = fileOf(event.round(round(1)));

const APPS = { session: SESSION_APP, orchestrator: ORCHESTRATOR_APP, reviewer: REVIEWER_APP, planner: PLANNER_APP };

const READY_AND_COMMENT: Fixture[] = [
  {
    name: "a hold of 10:00, an admin's comment at 10:30 and a Ready move at 11:00: released by that comment",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("11:00")] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  {
    name: "the admin's comment counts edited",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30", "Go.", { lastEditedAt: at("11:30") })], moves: [move("11:00")] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  ...Object.entries(APPS).map(([name, app]): Fixture => ({
    name: `the only later comment is the ${name} App's, whatever role its login has`,
    holds: [PUSHBACK],
    issue: { comments: [comment(201, app, "Go ahead.", { createdAt: at("10:30") })], moves: [move("11:00")], roles: { [app.login]: "admin" } },
    releasable: [],
    startable: false,
  })),
  ...["triage", "read", "none", ""].map((role): Fixture => ({
    name: `the only later comment's author has the role ${JSON.stringify(role)}`,
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("11:00")], roles: { [ADMIN.login]: role } },
    releasable: [],
    startable: false,
  })),
  ...["admin", "maintain", "write"].map((role): Fixture => ({
    name: `the comment of a User with the role ${role} counts as an admin's`,
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("11:00")], roles: { [ADMIN.login]: role } },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  })),
  {
    name: "the only later comment is a deleted account's",
    holds: [PUSHBACK],
    issue: { comments: [comment(201, null, "Go.", { createdAt: at("10:30") })], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  ...[
    ["on another project", move("11:00", { project: { url: OTHER_PROJECT } })],
    ["on a project the reader cannot see", move("11:00", { project: null })],
    ["to another status", move("11:00", { status: "In progress" })],
    ["to no status", move("11:00", { status: null })],
  ].map(([where, only]): Fixture => ({
    name: `the only later move is ${String(where)}`,
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30")], moves: [only as ReturnType<typeof move>] },
    releasable: [],
    startable: false,
  })),
  {
    name: "the admin's comment is in the second of the commit that placed the hold",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:00:00")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the admin's comment is before the hold",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(99, "09:59:59")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the Ready move is in the second of the commit that placed the hold",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("10:00:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the Ready move is before the hold",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("09:59:59")] },
    releasable: [],
    startable: false,
  },
  ...[
    ["an App", ORCHESTRATOR_APP],
    ["a board workflow", { __typename: "Bot", login: "github-project-automation" }],
    ["nobody the reader can name", null],
  ].map(([who, actor]): Fixture => ({
    name: `a Ready move on the board counts whoever made it: ${String(who)}`,
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("11:00", { actor: actor as typeof ADMIN | null })] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  })),
  {
    name: "the order of comment and move does not matter",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:40")], moves: [move("10:20")] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  {
    name: "a later move elsewhere or to another status takes nothing from an earlier Ready move",
    holds: [PUSHBACK],
    issue: {
      comments: [adminComment(201, "10:30")],
      moves: [move("10:40"), move("11:00", { status: "In progress" }), move("11:10", { project: { url: OTHER_PROJECT } })],
    },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  {
    name: "of several admin comments after the hold, the newest releases it",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(201, "10:30"), adminComment(202, "10:40")], moves: [move("11:00")] },
    releasable: [["pushback-212", 202, false]],
    startable: true,
  },
  {
    name: "two admin comments in one second are ordered by databaseId",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(203, "10:30:05"), adminComment(202, "10:30:05")], moves: [move("11:00")] },
    releasable: [["pushback-212", 203, false]],
    startable: true,
  },
];

const QUESTION = questionComment(150, ESCALATION, "10:10");

const ESCALATION_QUESTION: Fixture[] = [
  {
    name: "an escalation hold's admin comment at 10:05, before its question at 10:10",
    holds: [ESCALATION],
    issue: { comments: [adminComment(140, "10:05"), QUESTION], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "an escalation hold's admin comment at 10:20, after its question, and Ready after it",
    holds: [ESCALATION],
    issue: { comments: [adminComment(140, "10:05"), QUESTION, adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [["escalation-212", 160, false]],
    startable: true,
  },
  {
    name: "an escalation hold whose question is not posted, with an admin comment and Ready",
    holds: [ESCALATION],
    issue: { comments: [adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "an escalation hold whose question is not posted, released by a reset",
    holds: [ESCALATION],
    issue: { comments: [adminComment(160, "10:20", "/codeworks reset")] },
    releasable: [["escalation-212", 160, true]],
    startable: true,
    reset: 160,
  },
  {
    name: "the question's tag posted by an admin is no question",
    holds: [ESCALATION],
    issue: { comments: [questionComment(150, ESCALATION, "10:10", { author: ADMIN }), adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the question of an earlier placement of the hold is not this one's",
    holds: [ESCALATION],
    issue: { comments: [questionComment(50, { ...ESCALATION, since: at("08:00") }, "08:10"), adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the tag on a line other than the first is no question",
    holds: [ESCALATION],
    issue: {
      comments: [comment(150, ORCHESTRATOR_APP, `Asked:\n${QUESTION.body}`, { createdAt: at("10:10") }), adminComment(160, "10:20")],
      moves: [move("11:00")],
    },
    releasable: [],
    startable: false,
  },
  {
    name: "the oldest question counts: an answer between two postings of it releases",
    holds: [ESCALATION],
    issue: { comments: [QUESTION, adminComment(160, "10:20"), questionComment(170, ESCALATION, "10:25")], moves: [move("11:00")] },
    releasable: [["escalation-212", 160, false]],
    startable: true,
  },
  {
    name: "an answer in the question's second is after it by databaseId",
    holds: [ESCALATION],
    issue: { comments: [questionComment(150, ESCALATION, "10:10:00"), adminComment(151, "10:10:00")], moves: [move("11:00")] },
    releasable: [["escalation-212", 151, false]],
    startable: true,
  },
  {
    name: "an admin comment in the question's second with a lower databaseId is before it",
    holds: [ESCALATION],
    issue: { comments: [adminComment(149, "10:10:00"), questionComment(150, ESCALATION, "10:10:00")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
];

// Orchestrator ADR-0010 d1 posts a question for a rescope hold a verdict placed, as for an escalation; never for a spec PR's.
const VERDICT_RESCOPE = hold("rescope-212", { since: at("10:00") });
const SPEC_PR_RESCOPE = hold("rescope-212", { since: at("10:00"), spec_pr: 301 });
const RESCOPE_ASKED = questionComment(150, VERDICT_RESCOPE, "10:10");

const RESCOPE_QUESTION: Fixture[] = [
  {
    name: "a verdict's rescope hold's admin comment at 10:05, before its question at 10:10",
    holds: [VERDICT_RESCOPE],
    issue: { comments: [adminComment(140, "10:05"), RESCOPE_ASKED], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a verdict's rescope hold's admin comment at 10:20, after its question, and Ready after it",
    holds: [VERDICT_RESCOPE],
    issue: { comments: [adminComment(140, "10:05"), RESCOPE_ASKED, adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [["rescope-212", 160, false]],
    startable: true,
  },
  {
    name: "a verdict's rescope hold whose question is not posted, with an admin comment and Ready",
    holds: [VERDICT_RESCOPE],
    issue: { comments: [adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a spec PR's rescope hold, which asks no question, released by an admin comment and Ready",
    holds: [SPEC_PR_RESCOPE],
    issue: { comments: [adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [["rescope-212", 160, false]],
    startable: true,
  },
];

const THREE = [
  hold("pushback-212", { since: at("09:30") }),
  hold("audit-212", { since: at("09:40") }),
  hold("escalation-212", { since: at("09:50") }),
];

const ADMIN_RESET: Fixture[] = [
  {
    name: "an admin's /codeworks reset, trimmed, after three holds releases all three and is reported",
    holds: THREE,
    issue: { comments: [adminComment(300, "10:00", "  /codeworks reset\n")] },
    releasable: [
      ["pushback-212", 300, true],
      ["audit-212", 300, true],
      ["escalation-212", 300, true],
    ],
    startable: true,
    reset: 300,
  },
  {
    name: "a reset older than a hold leaves it",
    holds: THREE,
    issue: { comments: [adminComment(95, "09:45", "/codeworks reset")] },
    releasable: [
      ["pushback-212", 95, true],
      ["audit-212", 95, true],
    ],
    startable: false,
    reset: 95,
  },
  {
    name: "a reset in the second of the commit that placed the hold leaves it",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(101, "10:00:00", "/codeworks reset")] },
    releasable: [],
    startable: false,
    reset: 101,
  },
  {
    name: "a reset by an App counts for nothing",
    holds: THREE,
    issue: { comments: [comment(300, ORCHESTRATOR_APP, "/codeworks reset", { createdAt: at("10:00") })] },
    releasable: [],
    startable: false,
  },
  {
    name: "a reset by a commenter who is no writer counts for nothing",
    holds: THREE,
    issue: { comments: [adminComment(300, "10:00", "/codeworks reset")], roles: { [ADMIN.login]: "read" } },
    releasable: [],
    startable: false,
  },
  {
    name: "a comment that says more than the command is no reset",
    holds: THREE,
    issue: { comments: [adminComment(300, "10:00", "/codeworks reset please")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the newest reset releases and is reported",
    holds: THREE,
    issue: { comments: [adminComment(300, "10:00", "/codeworks reset"), adminComment(301, "10:05", "/codeworks reset")] },
    releasable: [
      ["pushback-212", 301, true],
      ["audit-212", 301, true],
      ["escalation-212", 301, true],
    ],
    startable: true,
    reset: 301,
  },
  {
    name: "a reset after a hold releases it before a later admin comment with Ready does",
    holds: [PUSHBACK],
    issue: { comments: [adminComment(300, "10:10", "/codeworks reset"), adminComment(301, "10:30")], moves: [move("11:00")] },
    releasable: [["pushback-212", 300, true]],
    startable: true,
    reset: 300,
  },
];

const CLEARED: Tampering = { at: at("10:30"), cleared: at("10:35") };

const TAMPER: Fixture[] = [
  {
    name: "a tamper an admin cleared is released by a Ready move and an admin comment both after it",
    tampers: [CLEARED],
    issue: { comments: [adminComment(201, "10:45")], moves: [move("11:00")] },
    releasable: [["tamper-0", 201, false]],
    startable: true,
  },
  {
    name: "a tamper is not released by an admin comment before it",
    tampers: [CLEARED],
    issue: { comments: [adminComment(201, "10:20")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a tamper is not released by an admin comment in its second",
    tampers: [CLEARED],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a tamper is not released by a Ready move in its second",
    tampers: [CLEARED],
    issue: { comments: [adminComment(201, "10:45")], moves: [move("10:30")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a tamper whose file is still on ledger is not released by a Ready move and an admin comment after it",
    tampers: [{ at: at("10:30") }],
    issue: { comments: [adminComment(201, "10:45")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a tamper that added or changed no file needs no clearance",
    tampers: [{ at: at("10:30"), deletes: ROUND_FILE }],
    issue: { comments: [adminComment(201, "10:45")], moves: [move("11:00")] },
    releasable: [["tamper-0", 201, false]],
    startable: true,
  },
  {
    name: "a reset after a tamper, with a Ready move after it, releases it as a reset",
    tampers: [CLEARED],
    issue: { comments: [adminComment(300, "10:45", "/codeworks reset")], moves: [move("11:00")] },
    releasable: [["tamper-0", 300, true]],
    startable: true,
    reset: 300,
  },
  {
    name: "a reset after a tamper, with no Ready move after it, does not release it",
    tampers: [CLEARED],
    issue: { comments: [adminComment(300, "10:45", "/codeworks reset")], moves: [move("10:20")] },
    releasable: [],
    startable: false,
    reset: 300,
  },
  {
    name: "of two tampers, an admin comment between them makes only the first releasable, so the claim is refused",
    tampers: [CLEARED, { at: at("10:50"), cleared: at("10:55") }],
    issue: { comments: [adminComment(201, "10:40")], moves: [move("11:00")] },
    releasable: [["tamper-0", 201, false]],
    startable: false,
  },
  {
    name: "of two tampers, an admin comment after both releases both",
    tampers: [CLEARED, { at: at("10:50"), cleared: at("10:55") }],
    issue: { comments: [adminComment(201, "10:58")], moves: [move("11:00")] },
    releasable: [
      ["tamper-0", 201, false],
      ["tamper-1", 201, false],
    ],
    startable: true,
  },
  {
    name: "a released tamper leaves an open hold to the hold's own rule",
    holds: [hold("escalation-212", { since: at("09:00") })],
    tampers: [CLEARED],
    issue: { comments: [adminComment(201, "10:45")], moves: [move("11:00")] },
    releasable: [["tamper-0", 201, false]],
    startable: false,
  },
  {
    name: "a releasable tamper and a releasable open hold",
    holds: [hold("pushback-212", { since: at("09:00") })],
    tampers: [CLEARED],
    issue: { comments: [adminComment(201, "10:45")], moves: [move("11:00")] },
    releasable: [
      ["pushback-212", 201, false],
      ["tamper-0", 201, false],
    ],
    startable: true,
  },
];

const NOTHING_HELD: Fixture[] = [
  {
    name: "a story with no hold is startable and releases nothing",
    holds: [],
    issue: { comments: [adminComment(201, "10:30")], moves: [move("11:00")] },
    releasable: [],
    startable: true,
  },
  {
    name: "a story with no directory is startable, and an admin's reset on it is still reported",
    issue: { comments: [adminComment(300, "10:00", "/codeworks reset")] },
    releasable: [],
    startable: true,
    reset: 300,
  },
];

function inStory(name: string): string {
  return `${storyDir()}/${name}`;
}

function filesOf(events: LedgerEvent[]): Record<string, string> {
  return Object.fromEntries(events.map((each) => [inStory(fileOf(each)), eventText(each)]));
}

function releasedBy(released: readonly Releasable[]): Map<string, { comment: number; reset: boolean }> {
  return new Map(released.map(({ id, comment, reset }) => [id, { comment: comment.id, reset }]));
}

function releasedRows(state: Snapshot, released: readonly Releasable[]): Snapshot {
  const by = releasedBy(released);
  return {
    ...state,
    holds: state.holds.map((row) => {
      const released_by = by.get(row.id);
      return released_by === undefined ? row : { ...row, state: "RELEASED", released: NOW, released_by };
    }),
  };
}

function releasedTampers(tampers: readonly Tamper[], released: readonly Releasable[]): Tamper[] {
  const by = releasedBy(released);
  return tampers.map((tamper) => {
    const released_by = by.get(tamper.id);
    return released_by === undefined ? tamper : { ...tamper, released: NOW, released_by, releasable: null };
  });
}

async function bothGiveOneAnswer(fixture: Fixture): Promise<void> {
  const ledger = fakeLedger();
  eventCommit(ledger, [event.round(round(1))], { issue: 7, date: at("07:00") });
  const oids: string[] = [];
  if (fixture.holds !== undefined || fixture.tampers !== undefined) {
    eventCommit(ledger, [event.round(round(1))], { date: at("08:00") });
    placeHolds(ledger, fixture.holds ?? []);
    for (const [i, { at: date, cleared, deletes }] of (fixture.tampers ?? []).entries()) {
      const stray = `stray-${i}.json`;
      oids.push(invalidCommit(ledger, deletes === undefined ? { put: { [stray]: "{}\n" }, date } : { remove: [deletes], date }));
      if (cleared !== undefined) clearanceCommit(ledger, [stray], { date: cleared });
    }
  }

  const { comments = [] } = fixture.issue;
  const byId = new Map(comments.map((item) => [item.databaseId, item]));
  const commentRef = (databaseId: number) => {
    const found = byId.get(databaseId);
    assert.ok(found !== undefined, `no comment ${databaseId} in the fixture`);
    return { id: databaseId, url: found.url, at: found.createdAt };
  };
  const idOf = (id: string) => (/^tamper-\d+$/.test(id) ? `tamper-${oids[Number(id.slice("tamper-".length))]}` : id);

  const reading = await readState(reader(fixture.issue, ledger), REPO, ISSUE, SHARED);
  const releasable = [...reading.releasable, ...reading.tamper.flatMap((tamper) => (tamper.releasable === null ? [] : [tamper.releasable]))];
  assert.deepEqual(
    releasable,
    fixture.releasable.map(([id, databaseId, reset]) => ({ id: idOf(id), comment: commentRef(databaseId), reset })),
    "releasable",
  );
  assert.equal(reading.startable, fixture.startable, "startable");
  const reset = fixture.reset === undefined ? null : { url: url(fixture.reset), at: commentRef(fixture.reset).at };
  assert.deepEqual(reading.reset, reset, "reset");

  const out = writer(ledger);
  const claim = releaseOnClaim(reader(fixture.issue, ledger), out, REPO, ISSUE, SHARED, reading);
  if (reading.tamper.some((tamper) => tamper.released === null && tamper.releasable === null)) {
    await assert.rejects(claim, StateWriteRefused);
    assert.deepEqual(out.calls, []);
    return;
  }
  const answer = await claim;
  assert.deepEqual([answer.released, answer.reset], [releasable, reading.reset]);
  const asked = commitsAsked(out);
  if (releasable.length === 0) {
    assert.deepEqual(asked, [], "nothing to release, so nothing is committed");
    return;
  }
  assert.equal(asked.length, 1);
  assert.ok(reading.snapshot !== null);
  const since = new Map(reading.snapshot.holds.map((row) => [row.id, row.since]));
  const releases = releasable.map(({ id, comment: by, reset: byReset }) => event.release(id, since.get(id) ?? null, NOW, by.id, byReset));
  assert.deepEqual(addedFiles(asked[0]), filesOf(releases));
  assert.deepEqual(answer.reading.snapshot, releasedRows(reading.snapshot, releasable));
  assert.deepEqual(answer.reading.tamper, releasedTampers(reading.tamper, releasable));
}

const SETS: Array<[string, Fixture[]]> = [
  ["a Ready move and an admin's comment after the hold", READY_AND_COMMENT],
  ["an escalation hold's question", ESCALATION_QUESTION],
  ["a verdict's rescope hold's question", RESCOPE_QUESTION],
  ["/codeworks reset", ADMIN_RESET],
  ["a tamper's release", TAMPER],
  ["nothing held", NOTHING_HELD],
];

for (const [title, fixtures] of SETS) {
  describe(`readState and releaseOnClaim give one answer: ${title}`, () => {
    for (const fixture of fixtures) it(fixture.name, () => bothGiveOneAnswer(fixture));
  });
}

describe("questionTag", () => {
  it("is the first line the release rule finds the question by", () => {
    assert.equal(questionTag(ESCALATION), `<!-- codeworks:hold-question escalation-212 ${at("10:00")} -->`);
  });
});
