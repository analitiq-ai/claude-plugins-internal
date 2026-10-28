import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Hold, Snapshot } from "../src/contracts/snapshot.ts";
import { BoardNotVisible, questionTag, releaseOnClaim, StateWriteRefused, stateFrom, type IssueComment } from "../src/state.ts";
import {
  ADMIN,
  BOARD,
  ISSUE,
  NOW,
  ORCHESTRATOR_APP,
  OTHER_PROJECT,
  PLANNER_APP,
  REPO,
  REVIEWER_APP,
  SESSION_APP,
  SHARED,
  adminComment,
  at,
  comment,
  deletion,
  hold,
  move,
  postedSnapshot,
  posts,
  questionComment,
  reader,
  snapshot,
  stateComment,
  url,
  writer,
  type Issue,
} from "./fixtures/state/issue.ts";

// One fixture set for the orchestrator's read and reviewer's release alike, so the two can never answer apart
// (SC-002, critique X1).
type Fixture = {
  name: string;
  issue: Issue;
  /** Each releasable hold as [id, the releasing comment's databaseId, whether it is a reset]. */
  releasable: Array<[string, number, boolean]>;
  startable: boolean;
  tamper_released?: boolean;
  /** The databaseId of the newest admin reset. */
  reset?: number;
};

const PUSHBACK = hold("pushback-212", { since: at("10:00") });
const ESCALATION = hold("escalation-212", { since: at("10:00") });

/** The state comment that placed `holds`, posted in their `since` second. */
function placedBy(...holds: Hold[]): IssueComment {
  return stateComment(100, snapshot({ holds }), { createdAt: at("10:00") });
}

const APPS = { session: SESSION_APP, orchestrator: ORCHESTRATOR_APP, reviewer: REVIEWER_APP, planner: PLANNER_APP };

const AS12: Fixture[] = [
  {
    name: "a hold of 10:00, an admin's comment at 10:30 and a Ready move at 11:00: released by that comment",
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30")], moves: [move("11:00")] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  {
    name: "the admin's comment counts edited",
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30", "Go.", { lastEditedAt: at("11:30") })], moves: [move("11:00")] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  ...Object.entries(APPS).map(([name, app]): Fixture => ({
    name: `the only later comment is the ${name} App's, an owner's association or not`,
    issue: {
      comments: [placedBy(PUSHBACK), comment(201, app, "Go ahead.", { authorAssociation: "OWNER", createdAt: at("10:30") })],
      moves: [move("11:00")],
    },
    releasable: [],
    startable: false,
  })),
  ...["CONTRIBUTOR", "FIRST_TIME_CONTRIBUTOR", "FIRST_TIMER", "MANNEQUIN", "NONE"].map((association): Fixture => ({
    name: `the only later comment's authorAssociation is ${association}`,
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30", "Go.", { authorAssociation: association })], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  })),
  ...["OWNER", "COLLABORATOR"].map((association): Fixture => ({
    name: `an ${association}'s comment counts as an admin's`,
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30", "Go.", { authorAssociation: association })], moves: [move("11:00")] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  })),
  ...[
    ["on another project", move("11:00", { project: { url: OTHER_PROJECT } })],
    ["on a project the reader cannot see", move("11:00", { project: null })],
    ["to another status", move("11:00", { status: "In progress" })],
    ["to no status", move("11:00", { status: null })],
  ].map(([where, only]): Fixture => ({
    name: `the only later move is ${String(where)}`,
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30")], moves: [only as ReturnType<typeof move>] },
    releasable: [],
    startable: false,
  })),
  {
    name: "the admin's comment is in the hold's own second",
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:00:00")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the admin's comment is before the hold",
    issue: { comments: [adminComment(99, "09:59:59"), placedBy(PUSHBACK)], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the Ready move is in the hold's own second",
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30")], moves: [move("10:00:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the Ready move is before the hold",
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30")], moves: [move("09:59:59")] },
    releasable: [],
    startable: false,
  },
  ...[
    ["an App", ORCHESTRATOR_APP],
    ["a board workflow", { __typename: "Bot", login: "github-project-automation" }],
    ["nobody the reader can name", null],
  ].map(([who, actor]): Fixture => ({
    name: `a Ready move on the board counts whoever made it: ${String(who)}`,
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30")], moves: [move("11:00", { actor: actor as typeof ADMIN | null })] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  })),
  {
    name: "the order of comment and move does not matter",
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:40")], moves: [move("10:20")] },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  {
    name: "a later move elsewhere or to another status takes nothing from an earlier Ready move",
    issue: {
      comments: [placedBy(PUSHBACK), adminComment(201, "10:30")],
      moves: [move("10:40"), move("11:00", { status: "In progress" }), move("11:10", { project: { url: OTHER_PROJECT } })],
    },
    releasable: [["pushback-212", 201, false]],
    startable: true,
  },
  {
    name: "of several admin comments after the hold, the newest releases it",
    issue: { comments: [placedBy(PUSHBACK), adminComment(201, "10:30"), adminComment(202, "10:40")], moves: [move("11:00")] },
    releasable: [["pushback-212", 202, false]],
    startable: true,
  },
  {
    name: "two admin comments in one second are ordered by databaseId",
    issue: {
      comments: [placedBy(PUSHBACK), adminComment(203, "10:30:05"), adminComment(202, "10:30:05")],
      moves: [move("11:00")],
    },
    releasable: [["pushback-212", 203, false]],
    startable: true,
  },
];

const QUESTION = questionComment(150, ESCALATION, "10:10");

const AS13: Fixture[] = [
  {
    name: "an escalation hold's admin comment at 10:05, before its question at 10:10",
    issue: { comments: [placedBy(ESCALATION), adminComment(140, "10:05"), QUESTION], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "an escalation hold's admin comment at 10:20, after its question, and Ready after it",
    issue: { comments: [placedBy(ESCALATION), adminComment(140, "10:05"), QUESTION, adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [["escalation-212", 160, false]],
    startable: true,
  },
  {
    name: "an escalation hold whose question is not posted, with an admin comment and Ready",
    issue: { comments: [placedBy(ESCALATION), adminComment(160, "10:20")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "an escalation hold whose question is not posted, released by a reset",
    issue: { comments: [placedBy(ESCALATION), adminComment(160, "10:20", "/codeworks reset")] },
    releasable: [["escalation-212", 160, true]],
    startable: true,
    reset: 160,
  },
  {
    name: "the question's tag posted by an admin is no question",
    issue: {
      comments: [placedBy(ESCALATION), questionComment(150, ESCALATION, "10:10", { author: ADMIN, authorAssociation: "OWNER" }), adminComment(160, "10:20")],
      moves: [move("11:00")],
    },
    releasable: [],
    startable: false,
  },
  {
    name: "the question of an earlier placement of the hold is not this one's",
    issue: {
      comments: [questionComment(50, { ...ESCALATION, since: at("08:00") }, "08:10"), placedBy(ESCALATION), adminComment(160, "10:20")],
      moves: [move("11:00")],
    },
    releasable: [],
    startable: false,
  },
  {
    name: "the tag on a line other than the first is no question",
    issue: {
      comments: [
        placedBy(ESCALATION),
        comment(150, ORCHESTRATOR_APP, `Asked:\n${QUESTION.body}`, { createdAt: at("10:10") }),
        adminComment(160, "10:20"),
      ],
      moves: [move("11:00")],
    },
    releasable: [],
    startable: false,
  },
  {
    name: "the oldest question counts: an answer between two postings of it releases",
    issue: {
      comments: [placedBy(ESCALATION), QUESTION, adminComment(160, "10:20"), questionComment(170, ESCALATION, "10:25")],
      moves: [move("11:00")],
    },
    releasable: [["escalation-212", 160, false]],
    startable: true,
  },
  {
    name: "an answer in the question's second is after it by databaseId",
    issue: {
      comments: [placedBy(ESCALATION), questionComment(150, ESCALATION, "10:10:00"), adminComment(151, "10:10:00")],
      moves: [move("11:00")],
    },
    releasable: [["escalation-212", 151, false]],
    startable: true,
  },
  {
    name: "an admin comment in the question's second with a lower databaseId is before it",
    issue: {
      comments: [placedBy(ESCALATION), adminComment(149, "10:10:00"), questionComment(150, ESCALATION, "10:10:00")],
      moves: [move("11:00")],
    },
    releasable: [],
    startable: false,
  },
];

const THREE = [
  hold("pushback-212", { since: at("09:30") }),
  hold("audit-212", { since: at("09:40") }),
  hold("escalation-212", { since: at("09:50") }),
];
const PLACED_THREE = stateComment(100, snapshot({ holds: THREE }), { createdAt: at("09:50") });

const AS14: Fixture[] = [
  {
    name: "an admin's /codeworks reset, trimmed, after three holds releases all three and is reported",
    issue: { comments: [PLACED_THREE, adminComment(300, "10:00", "  /codeworks reset\n")] },
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
    issue: { comments: [adminComment(95, "09:45", "/codeworks reset"), PLACED_THREE] },
    releasable: [
      ["pushback-212", 95, true],
      ["audit-212", 95, true],
    ],
    startable: false,
    reset: 95,
  },
  {
    name: "a reset in a hold's own second leaves it",
    issue: { comments: [placedBy(PUSHBACK), adminComment(101, "10:00:00", "/codeworks reset")] },
    releasable: [],
    startable: false,
    reset: 101,
  },
  {
    name: "a reset by an App counts for nothing",
    issue: { comments: [PLACED_THREE, comment(300, ORCHESTRATOR_APP, "/codeworks reset", { authorAssociation: "MEMBER", createdAt: at("10:00") })] },
    releasable: [],
    startable: false,
  },
  {
    name: "a reset by a commenter who is no writer counts for nothing",
    issue: { comments: [PLACED_THREE, adminComment(300, "10:00", "/codeworks reset", { authorAssociation: "CONTRIBUTOR" })] },
    releasable: [],
    startable: false,
  },
  {
    name: "a comment that says more than the command is no reset",
    issue: { comments: [PLACED_THREE, adminComment(300, "10:00", "/codeworks reset please")] },
    releasable: [],
    startable: false,
  },
  {
    name: "the newest reset releases and is reported",
    issue: { comments: [PLACED_THREE, adminComment(300, "10:00", "/codeworks reset"), adminComment(301, "10:05", "/codeworks reset")] },
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
    issue: { comments: [placedBy(PUSHBACK), adminComment(300, "10:10", "/codeworks reset"), adminComment(301, "10:30")], moves: [move("11:00")] },
    releasable: [["pushback-212", 300, true]],
    startable: true,
    reset: 300,
  },
];

// The newest unedited, tagged, valid reviewer App comment, which a tamper cause's release rebuilds from.
const OLDER = stateComment(90, snapshot(), { createdAt: at("09:00") });

const TAMPER: Fixture[] = [
  {
    name: "an edit is released by a Ready move and an admin comment both after it",
    issue: { comments: [OLDER, stateComment(100, snapshot(), { lastEditedAt: at("10:30") }), adminComment(201, "10:45")], moves: [move("11:00")] },
    releasable: [],
    tamper_released: true,
    startable: true,
  },
  {
    name: "an edit is not released by an admin comment before it",
    issue: { comments: [OLDER, stateComment(100, snapshot(), { lastEditedAt: at("10:30") }), adminComment(201, "10:20")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "an edit is not released by an admin comment in its second",
    issue: { comments: [OLDER, stateComment(100, snapshot(), { lastEditedAt: at("10:30") }), adminComment(201, "10:30")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "an edit is not released by a Ready move in its second",
    issue: { comments: [OLDER, stateComment(100, snapshot(), { lastEditedAt: at("10:30") }), adminComment(201, "10:45")], moves: [move("10:30")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a deletion is released by a Ready move and an admin comment both after it",
    issue: { comments: [OLDER, stateComment(100, snapshot()), adminComment(201, "10:50")], deletions: [deletion("10:40")], moves: [move("11:00")] },
    releasable: [],
    tamper_released: true,
    startable: true,
  },
  {
    name: "a deletion is not released by an admin comment before it",
    issue: { comments: [OLDER, stateComment(100, snapshot()), adminComment(201, "10:35")], deletions: [deletion("10:40")], moves: [move("11:00")] },
    releasable: [],
    startable: false,
  },
  {
    name: "a deletion that left no reviewer App comment is released, rebuilding the empty snapshot",
    issue: { comments: [adminComment(201, "10:50")], deletions: [deletion("10:40")], moves: [move("11:00")] },
    releasable: [],
    tamper_released: true,
    startable: true,
  },
  {
    name: "an invalid comment is released by a Ready move and an admin comment both after it",
    issue: {
      comments: [OLDER, comment(100, REVIEWER_APP, "no tag", { createdAt: at("10:15") }), adminComment(201, "10:30")],
      moves: [move("11:00")],
    },
    releasable: [],
    tamper_released: true,
    startable: true,
  },
  {
    name: "of an edit and a later deletion, the deletion must be followed",
    issue: {
      comments: [OLDER, stateComment(100, snapshot(), { lastEditedAt: at("10:30") }), adminComment(201, "10:40")],
      deletions: [deletion("10:50")],
      moves: [move("11:00")],
    },
    releasable: [],
    startable: false,
  },
  {
    name: "of an edit and a later deletion, a comment after both releases",
    issue: {
      comments: [OLDER, stateComment(100, snapshot(), { lastEditedAt: at("10:30") }), adminComment(201, "10:55")],
      deletions: [deletion("10:50")],
      moves: [move("11:00")],
    },
    releasable: [],
    tamper_released: true,
    startable: true,
  },
  {
    name: "a released tamper cause leaves an open hold of the rebuilt snapshot to the hold's own rule",
    issue: {
      comments: [
        stateComment(90, snapshot({ holds: [hold("escalation-212", { since: at("09:00") })] }), { createdAt: at("09:00") }),
        stateComment(100, snapshot(), { lastEditedAt: at("10:30") }),
        adminComment(201, "10:45"),
      ],
      moves: [move("11:00")],
    },
    releasable: [],
    tamper_released: true,
    startable: false,
  },
  {
    name: "a released tamper cause and a releasable open hold of the rebuilt snapshot",
    issue: {
      comments: [
        stateComment(90, snapshot({ holds: [hold("pushback-212", { since: at("09:00") })] }), { createdAt: at("09:00") }),
        stateComment(100, snapshot(), { lastEditedAt: at("10:30") }),
        adminComment(201, "10:45"),
      ],
      moves: [move("11:00")],
    },
    releasable: [["pushback-212", 201, false]],
    tamper_released: true,
    startable: true,
  },
];

const NOTHING_HELD: Fixture[] = [
  {
    name: "state with no hold is startable and releases nothing",
    issue: { comments: [stateComment(100, snapshot()), adminComment(201, "10:30")], moves: [move("11:00")] },
    releasable: [],
    startable: true,
  },
  {
    name: "no state is startable, and an admin's reset on it is still reported",
    issue: { comments: [adminComment(300, "10:00", "/codeworks reset")] },
    releasable: [],
    startable: true,
    reset: 300,
  },
];

function releasedRows(snapshotOf: Snapshot, releasable: Fixture["releasable"]): Snapshot {
  const by = new Map(releasable.map(([id, comment, reset]) => [id, { comment, reset }]));
  return {
    ...snapshotOf,
    holds: snapshotOf.holds.map((row) => {
      const released_by = by.get(row.id);
      return released_by === undefined ? row : { ...row, state: "RELEASED", released: NOW, released_by };
    }),
  };
}

async function bothGiveOneAnswer(fixture: Fixture): Promise<void> {
  const { comments, deletions = [], moves = [] } = fixture.issue;
  const byId = new Map(comments.map((item) => [item.databaseId, item]));
  const commentRef = (databaseId: number) => {
    const found = byId.get(databaseId);
    assert.ok(found !== undefined, `no comment ${databaseId} in the fixture`);
    return { id: databaseId, url: found.url, at: found.createdAt };
  };

  const reading = stateFrom(comments, deletions, moves, SHARED);
  assert.deepEqual(
    reading.releasable,
    fixture.releasable.map(([id, databaseId, reset]) => ({ id, comment: commentRef(databaseId), reset })),
    "releasable",
  );
  assert.equal(reading.tamper_released, fixture.tamper_released ?? false, "tamper_released");
  assert.equal(reading.startable, fixture.startable, "startable");
  const reset = fixture.reset === undefined ? null : { url: url(fixture.reset), at: commentRef(fixture.reset).at };
  assert.deepEqual(reading.reset, reset, "reset");

  const out = writer();
  const claim = releaseOnClaim(reader(fixture.issue), out, REPO, ISSUE, SHARED);
  const tamperStands = reading.causes.some((cause) => cause.cause !== "open_hold");
  if (tamperStands && !reading.tamper_released) {
    await assert.rejects(claim, StateWriteRefused);
    assert.deepEqual(posts(out), []);
    return;
  }
  const answer = await claim;
  assert.deepEqual(answer, { released: reading.releasable, rebuilt: reading.rebuilt, reset: reading.reset });
  const bodies = posts(out);
  if (fixture.releasable.length === 0 && !reading.tamper_released) {
    assert.deepEqual(bodies, [], "nothing to release, so nothing is posted");
    return;
  }
  assert.equal(bodies.length, 1);
  assert.ok(reading.snapshot !== null);
  assert.deepEqual(postedSnapshot(bodies[0]), releasedRows(reading.snapshot, fixture.releasable));
}

const SETS: Array<[string, Fixture[]]> = [
  ["AS12: a Ready move and an admin's comment after the hold", AS12],
  ["AS13: an escalation hold's question", AS13],
  ["AS14: /codeworks reset", AS14],
  ["a tamper cause's release", TAMPER],
  ["nothing held", NOTHING_HELD],
];

for (const [title, fixtures] of SETS) {
  describe(`stateFrom and releaseOnClaim give one answer: ${title}`, () => {
    for (const fixture of fixtures) it(fixture.name, () => bothGiveOneAnswer(fixture));
  });
}

describe("questionTag", () => {
  it("is the first line the release rule finds the question by", () => {
    assert.equal(questionTag(ESCALATION), `<!-- codeworks:hold-question escalation-212 ${at("10:00")} -->`);
  });
});

describe("releaseOnClaim on a board the reader cannot see", () => {
  it("throws BoardNotVisible naming the board and posts nothing, never reading it as no Ready", async () => {
    const out = writer();
    const issue: Issue = {
      comments: [placedBy(PUSHBACK), adminComment(201, "10:30")],
      moves: [move("11:00")],
      items: [OTHER_PROJECT],
    };
    await assert.rejects(releaseOnClaim(reader(issue), out, REPO, ISSUE, SHARED), (error: unknown) => {
      assert.ok(error instanceof BoardNotVisible, `expected BoardNotVisible, got ${String(error)}`);
      assert.equal(error.board, BOARD);
      return true;
    });
    assert.deepEqual(out.calls, []);
  });
});
