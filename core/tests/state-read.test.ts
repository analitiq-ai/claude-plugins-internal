import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { Hold, Round, Snapshot } from "../src/contracts/snapshot.ts";
import type { Shared } from "../src/settings.ts";
import {
  BoardNotVisible,
  issueComments,
  readState,
  stateFrom,
  type CommentDeletion,
  type IssueComment,
  type StateReading,
  type StatusChange,
} from "../src/state.ts";
import { GitHubRefused, GitHubUnanswered } from "../src/github.ts";
import { fakeGitHub, type FakeAnswer } from "./support/fake-github.ts";

const REPO = "acme/widgets";
const ISSUE = 212;
const BOARD = "https://github.com/orgs/example-org/projects/1";
// The state comment contract's tag, spelt out here so the reader is graded against the contract, not its own constant.
const TAG = "<!-- codeworks:reviewer-state -->";

const SHARED: Shared = {
  validators: ["fixture"],
  trusted_reviewers: ["alice"],
  board: BOARD,
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};

// GraphQL names an App by its bare login; `[shared]` holds the REST form.
const REVIEWER_APP = { __typename: "Bot", login: "codeworks-reviewer" };
const ORCHESTRATOR_APP = { __typename: "Bot", login: "codeworks-orchestrator" };
const ADMIN = { __typename: "User", login: "alice" };
const WRITERS: ReadonlySet<string> = new Set([ADMIN.login]);

function at(clock: string): string {
  return `2026-10-28T${clock.length === 5 ? `${clock}:00` : clock}Z`;
}

function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

function round(n: number, fields: Partial<Round> = {}): Round {
  return { stage: "INTERNAL", n, head: sha(n), result: "CLEAN", verdict: null, root_cause: null, at: at("09:00"), ...fields };
}

function openHold(id: string, fields: Partial<Hold> = {}): Hold {
  const kind = id.slice(0, id.lastIndexOf("-")) as Hold["kind"];
  return { id, kind, state: "OPEN", since: at("09:30"), released: null, released_by: null, question: null, spec_pr: null, ...fields };
}

function snapshot(rounds: number, fields: Partial<Snapshot> = {}): Snapshot {
  return {
    v: 1,
    rounds: Array.from({ length: rounds }, (_, i) => round(i + 1)),
    holds: [],
    pushbacks: [],
    rulings: [],
    gates: null,
    ...fields,
  };
}

function stateBody(state: Snapshot): string {
  return `${TAG}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`;
}

function url(databaseId: number): string {
  return `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-${databaseId}`;
}

function comment(databaseId: number, author: IssueComment["author"], body: string, fields: Partial<IssueComment> = {}): IssueComment {
  return {
    databaseId,
    author,
    body,
    createdAt: at("10:00"),
    lastEditedAt: null,
    url: url(databaseId),
    ...fields,
  };
}

function stateComment(databaseId: number, state: Snapshot, fields: Partial<IssueComment> = {}): IssueComment {
  return comment(databaseId, REVIEWER_APP, stateBody(state), fields);
}

function deletion(clock: string, deletedCommentAuthor: CommentDeletion["deletedCommentAuthor"] = REVIEWER_APP): CommentDeletion {
  return { createdAt: at(clock), deletedCommentAuthor };
}

function read(comments: IssueComment[], deletions: CommentDeletion[] = [], moves: StatusChange[] = []): StateReading {
  return stateFrom(comments, deletions, moves, WRITERS, SHARED);
}

function causesOf(reading: StateReading): string[] {
  return reading.causes.map((cause) => cause.cause);
}

function invalidError(reading: StateReading): string {
  const invalid = reading.causes.find((cause) => cause.cause === "invalid");
  assert.ok(invalid !== undefined && "error" in invalid, `no invalid cause in ${JSON.stringify(reading.causes)}`);
  return invalid.error;
}

const EMPTY: Snapshot = { v: 1, rounds: [], holds: [], pushbacks: [], rulings: [], gates: null };

describe("stateFrom: which comment is the state comment", () => {
  it("is the newest by the reviewer App, among newer admin and orchestrator App comments", () => {
    const newest = snapshot(3);
    const reading = read([
      stateComment(101, snapshot(1), { createdAt: at("10:01") }),
      stateComment(102, snapshot(2), { createdAt: at("10:02") }),
      stateComment(103, newest, { createdAt: at("10:03") }),
      comment(104, ADMIN, "Looks right to me.", { createdAt: at("10:04") }),
      comment(105, ORCHESTRATOR_APP, stateBody(snapshot(9)), { createdAt: at("10:05") }),
    ]);
    assert.deepEqual(reading.snapshot, newest);
    assert.equal(reading.comment_url, url(103));
    assert.equal(reading.rebuilt, false);
    assert.equal(reading.held, false);
    assert.deepEqual(reading.causes, []);
  });

  it("matches a Bot's bare login with [bot] appended, and nothing else", () => {
    const reviewer = snapshot(1);
    const reading = read([
      stateComment(101, reviewer),
      comment(102, { __typename: "User", login: "codeworks-reviewer" }, stateBody(snapshot(2))),
      comment(103, { __typename: "Bot", login: "codeworks-reviewer[bot]" }, stateBody(snapshot(3))),
      comment(104, null, stateBody(snapshot(4))),
    ]);
    assert.deepEqual(reading.snapshot, reviewer);
    assert.equal(reading.comment_url, url(101));
  });

  it("settles two comments in one second by databaseId, not by list order", () => {
    const later = snapshot(2);
    const reading = read([
      stateComment(202, later, { createdAt: at("10:00:07") }),
      stateComment(201, snapshot(1), { createdAt: at("10:00:07") }),
    ]);
    assert.deepEqual(reading.snapshot, later);
    assert.equal(reading.comment_url, url(202));
  });

  it("is no state, not held, with no reviewer App comment and no deletion, whoever else wrote", () => {
    const reading = read(
      [
        comment(104, ADMIN, "Opened the PR."),
        comment(105, ORCHESTRATOR_APP, "Claimed."),
      ],
      [deletion("10:30", ADMIN)],
    );
    const { snapshot, comment_url, rebuilt, held, causes, newest_round, pushed_back } = reading;
    assert.deepEqual(
      { snapshot, comment_url, rebuilt, held, causes, newest_round, pushed_back },
      { snapshot: null, comment_url: null, rebuilt: false, held: false, causes: [], newest_round: null, pushed_back: new Map() },
    );
  });
});

describe("stateFrom: tampered, deleted and invalid state", () => {
  it("holds as tampered when the state comment was edited", () => {
    const reading = read([stateComment(101, snapshot(1)), stateComment(102, snapshot(2), { lastEditedAt: at("10:20") })]);
    assert.equal(reading.held, true);
    assert.deepEqual(reading.causes, [{ cause: "tampered" }]);
    assert.equal(reading.comment_url, url(102));
  });

  it("holds as deleted when a reviewer App deletion is at or after the state comment's second", () => {
    for (const clock of ["10:00:00", "10:00:59", "10:45"]) {
      const reading = read([stateComment(101, snapshot(1), { createdAt: at("10:00:00") })], [deletion(clock)]);
      assert.deepEqual(reading.causes, [{ cause: "deleted" }], clock);
      assert.equal(reading.held, true, clock);
    }
  });

  it("does not hold for a reviewer App deletion before the state comment's second", () => {
    const reading = read([stateComment(101, snapshot(1), { createdAt: at("10:00:00") })], [deletion("09:59:59")]);
    assert.equal(reading.held, false);
    assert.deepEqual(reading.causes, []);
  });

  it("counts no deletion of another author's comment, or of a deleted account's", () => {
    const reading = read(
      [stateComment(101, snapshot(1), { createdAt: at("10:00") })],
      [
        deletion("10:30", ADMIN),
        deletion("10:31", ORCHESTRATOR_APP),
        deletion("10:32", { __typename: "User", login: "codeworks-reviewer" }),
        deletion("10:33", null),
      ],
    );
    assert.equal(reading.held, false);
  });

  it("holds as deleted when a reviewer App comment was deleted and none is left", () => {
    const reading = read([comment(104, ADMIN, "Hm.")], [deletion("10:30")]);
    assert.equal(reading.held, true);
    assert.deepEqual(reading.causes, [{ cause: "deleted" }]);
    assert.equal(reading.comment_url, null);
    assert.deepEqual(reading.snapshot, EMPTY);
    assert.equal(reading.rebuilt, true);
  });

  it("holds as invalid when the newest lacks the tag beside an older tagged one, which never stands in for it", () => {
    const untagged = `\`\`\`json\n${JSON.stringify(snapshot(2), null, 2)}\n\`\`\`\n`;
    const reading = read([
      stateComment(101, snapshot(1), { createdAt: at("10:01") }),
      comment(102, REVIEWER_APP, untagged, { createdAt: at("10:02") }),
    ]);
    assert.equal(reading.held, true);
    assert.deepEqual(causesOf(reading), ["invalid"]);
    assert.equal(reading.comment_url, url(102));
    assert.ok(invalidError(reading).includes(url(102)), invalidError(reading));
    assert.equal(reading.rebuilt, true);
  });

  it("holds as invalid when the tag is only in a quoted reply", () => {
    const quoted = stateBody(snapshot(2))
      .trimEnd()
      .split("\n")
      .map((line) => `> ${line}`)
      .join("\n");
    const reading = read([stateComment(101, snapshot(1)), comment(102, REVIEWER_APP, `${quoted}\n\nAgreed.\n`)]);
    assert.deepEqual(causesOf(reading), ["invalid"]);
    assert.equal(reading.comment_url, url(102));
  });

  it("holds as invalid when the body is not exactly the tag line and one json fence ending it", () => {
    const json = JSON.stringify(snapshot(1), null, 2);
    const bodies = {
      "a space after the tag": `${TAG} \n\`\`\`json\n${json}\n\`\`\`\n`,
      "CRLF line ends": `${TAG}\r\n\`\`\`json\r\n${json}\r\n\`\`\`\r\n`,
      "text between tag and fence": `${TAG}\nState:\n\`\`\`json\n${json}\n\`\`\`\n`,
      "a fence of another language": `${TAG}\n\`\`\`jsonc\n${json}\n\`\`\`\n`,
      "text after the closing fence": `${TAG}\n\`\`\`json\n${json}\n\`\`\`\nThanks.\n`,
      "two newlines after the closing fence": `${TAG}\n\`\`\`json\n${json}\n\`\`\`\n\n`,
      "no closing fence": `${TAG}\n\`\`\`json\n${json}\n`,
      "two fenced blocks": `${TAG}\n\`\`\`json\n${json}\n\`\`\`\n\`\`\`json\n${json}\n\`\`\`\n`,
      "not JSON": `${TAG}\n\`\`\`json\n{"v": 1,\n\`\`\`\n`,
      "a JSON list": `${TAG}\n\`\`\`json\n[${json}]\n\`\`\`\n`,
      "the tag alone": `${TAG}\n`,
    };
    for (const [why, body] of Object.entries(bodies)) {
      const reading = read([comment(102, REVIEWER_APP, body)]);
      assert.deepEqual(causesOf(reading), ["invalid"], why);
      assert.ok(invalidError(reading).includes(url(102)), `${why}: ${invalidError(reading)}`);
    }
  });

  it("reads the body with or without a newline after the closing fence", () => {
    const state = snapshot(1);
    for (const body of [stateBody(state), stateBody(state).slice(0, -1)]) {
      const reading = read([comment(101, REVIEWER_APP, body)]);
      assert.deepEqual(reading.causes, []);
      assert.deepEqual(reading.snapshot, state);
    }
  });

  it("names the comment URL and the contract error when the snapshot breaks its contract", () => {
    const dirtyWithoutVerdict = snapshot(1, { rounds: [round(1, { result: "DIRTY", verdict: null })] });
    const reading = read([stateComment(101, snapshot(1)), stateComment(102, dirtyWithoutVerdict)]);
    assert.equal(reading.held, true);
    assert.deepEqual(causesOf(reading), ["invalid"]);
    const error = invalidError(reading);
    assert.ok(error.includes(url(102)), error);
    assert.ok(error.includes("verdict"), error);
  });

  it("reports every cause that stands, the open holds of the working snapshot after the tamper causes", () => {
    const working = snapshot(1, { holds: [openHold("pushback-212")] });
    const reading = read(
      [
        stateComment(101, working, { createdAt: at("10:01") }),
        comment(102, REVIEWER_APP, "{}", { createdAt: at("10:02"), lastEditedAt: at("10:10") }),
      ],
      [deletion("10:05")],
    );
    assert.equal(reading.held, true);
    assert.deepEqual(causesOf(reading), ["tampered", "deleted", "invalid", "open_hold"]);
    assert.deepEqual(reading.causes.at(-1), { cause: "open_hold", id: "pushback-212" });
  });
});

describe("stateFrom: the working snapshot", () => {
  it("is the state comment's when no tamper cause stands", () => {
    const state = snapshot(2);
    const reading = read([stateComment(101, snapshot(1)), stateComment(102, state)]);
    assert.deepEqual(reading.snapshot, state);
    assert.equal(reading.rebuilt, false);
  });

  it("is the newest unedited, tagged, valid reviewer App comment's when a tamper cause stands, rebuilt", () => {
    const working = snapshot(1);
    const reading = read([
      stateComment(101, working),
      stateComment(102, snapshot(2), { lastEditedAt: at("10:30") }),
      comment(103, REVIEWER_APP, "no tag"),
      stateComment(104, snapshot(1, { rounds: [round(1, { result: "DIRTY" })] })),
      stateComment(105, snapshot(5), { lastEditedAt: at("10:40") }),
    ]);
    assert.deepEqual(causesOf(reading), ["tampered"]);
    assert.deepEqual(reading.snapshot, working);
    assert.equal(reading.rebuilt, true);
    assert.equal(reading.comment_url, url(105));
  });

  it("is the state comment's own when only a deletion stands, rebuilt", () => {
    const state = snapshot(2);
    const reading = read([stateComment(101, snapshot(1)), stateComment(102, state, { createdAt: at("10:00") })], [deletion("10:30")]);
    assert.deepEqual(causesOf(reading), ["deleted"]);
    assert.deepEqual(reading.snapshot, state);
    assert.equal(reading.rebuilt, true);
  });

  it("is empty when no reviewer App comment is unedited, tagged and valid", () => {
    const reading = read([
      stateComment(101, snapshot(1), { lastEditedAt: at("10:30") }),
      comment(102, REVIEWER_APP, "no tag"),
    ]);
    assert.deepEqual(causesOf(reading), ["invalid"]);
    assert.deepEqual(reading.snapshot, EMPTY);
    assert.equal(reading.rebuilt, true);
  });
});

describe("stateFrom: what the working snapshot says", () => {
  it("holds on one open hold, naming it, and keeps the released hold's row", () => {
    const released: Hold = openHold("escalation-212", {
      question: "Which reading of FR-3 holds?",
      state: "RELEASED",
      released: at("09:50"),
      released_by: { comment: 90, reset: false },
    });
    const state = snapshot(1, { holds: [openHold("pushback-212"), released] });
    const reading = read([stateComment(101, state)]);
    assert.equal(reading.held, true);
    assert.deepEqual(reading.causes, [{ cause: "open_hold", id: "pushback-212" }]);
    assert.deepEqual(reading.snapshot?.holds, state.holds);
  });

  it("reports a pushed-back finding key with the round that pushed it back", () => {
    const state = snapshot(3, {
      pushbacks: [
        { key: "thread:PRRT_1", round: { stage: "INTERNAL", n: 1 } },
        { key: "thread:PRRT_K", round: { stage: "INTERNAL", n: 3 } },
      ],
    });
    const reading = read([stateComment(101, state)]);
    assert.deepEqual(reading.pushed_back.get("thread:PRRT_K"), { stage: "INTERNAL", n: 3 });
    assert.equal(reading.pushed_back.size, 2);
  });

  it("names a key pushed back twice by its newest round", () => {
    const state = snapshot(2, {
      pushbacks: [
        { key: "thread:PRRT_K", round: { stage: "INTERNAL", n: 1 } },
        { key: "thread:PRRT_K", round: { stage: "INTERNAL", n: 2 } },
      ],
    });
    assert.deepEqual(read([stateComment(101, state)]).pushed_back.get("thread:PRRT_K"), { stage: "INTERNAL", n: 2 });
  });

  it("gives the newest round, the last of the list", () => {
    const newest = round(1, { stage: "GITHUB", result: "DIRTY", verdict: "PATCH", head: sha(99) });
    const state = snapshot(2, { rounds: [round(1), round(2), newest] });
    assert.deepEqual(read([stateComment(101, state)]).newest_round, newest);
  });
});

describe("readState", () => {
  const comments = [
    stateComment(101, snapshot(1), { createdAt: at("10:00") }),
    stateComment(102, snapshot(2, { holds: [openHold("pushback-212")] }), { createdAt: at("10:05") }),
    comment(103, ADMIN, "Go.", { createdAt: at("10:30") }),
  ];
  const deletions = [deletion("09:58")];
  const moves: StatusChange[] = [{ createdAt: at("11:00"), status: "Ready", project: { url: BOARD } }];
  const timeline = [
    { __typename: "CommentDeletedEvent", ...deletions[0] },
    { __typename: "ProjectV2ItemStatusChangedEvent", ...moves[0] },
  ];

  function onIssue(vars: Record<string, unknown>): boolean {
    return vars.owner === "acme" && vars.name === "widgets" && vars.number === ISSUE;
  }

  const ROLE_PATH = "GET /repos/acme/widgets/collaborators/alice/permission";

  function reader(projectItems: unknown[], commentNodes: unknown[] = comments, role: FakeAnswer = { role_name: "admin" }) {
    return fakeGitHub({
      rest: { [ROLE_PATH]: role },
      graphqlPages: [
        { when: (query, vars) => /\bcomments\(/.test(query) && onIssue(vars), answer: commentNodes },
        {
          when: (query, vars) =>
            /\btimelineItems\(/.test(query) &&
            query.includes("COMMENT_DELETED_EVENT") &&
            query.includes("PROJECT_V2_ITEM_STATUS_CHANGED_EVENT") &&
            onIssue(vars),
          answer: timeline,
        },
        { when: (query, vars) => /\bprojectItems\(/.test(query) && onIssue(vars), answer: projectItems },
      ],
    });
  }

  it("gives stateFrom's answer over the issue's comments, deletions and status changes", async () => {
    const items = [{ project: { url: "https://github.com/orgs/example-org/projects/7" } }, { project: { url: BOARD } }];
    const reading = await readState(reader(items), REPO, ISSUE, SHARED);
    assert.deepEqual(reading, stateFrom(comments, deletions, moves, WRITERS, SHARED));
    assert.deepEqual(reading.causes, [{ cause: "open_hold", id: "pushback-212" }]);
  });

  it("reads each User commenter's role once, and no App's", async () => {
    const client = reader([{ project: { url: BOARD } }], [...comments, comment(104, ADMIN, "Still go.", { createdAt: at("10:40") })]);
    await readState(client, REPO, ISSUE, SHARED);
    const roleReads = client.calls.filter((call) => call.kind === "rest");
    assert.deepEqual(roleReads.map((call) => call.kind === "rest" && `${call.method} ${call.path}`), [ROLE_PATH]);
  });

  it("counts an org member's comment by its role, though GitHub tells the App CONTRIBUTOR", async () => {
    const asTheAppSeesIt = comments.map((node) => ({ ...node, authorAssociation: node.author === ADMIN ? "CONTRIBUTOR" : "NONE" }));
    const reading = await readState(reader([{ project: { url: BOARD } }], asTheAppSeesIt, { role_name: "write" }), REPO, ISSUE, SHARED);
    assert.deepEqual(reading.releasable.map((release) => [release.id, release.comment.id]), [["pushback-212", 103]]);
  });

  it("fails the read when a commenter's role cannot be read", async () => {
    const refused = new GitHubRefused(403, "Resource not accessible by integration");
    await assert.rejects(readState(reader([{ project: { url: BOARD } }], comments, refused), REPO, ISSUE, SHARED), GitHubRefused);
  });

  it("throws BoardNotVisible naming the board when no item of the issue is on it", async () => {
    for (const items of [[], [{ project: { url: "https://github.com/orgs/example-org/projects/7" } }]]) {
      await assert.rejects(readState(reader(items), REPO, ISSUE, SHARED), (error: unknown) => {
        assert.ok(error instanceof BoardNotVisible, `expected BoardNotVisible, got ${String(error)}`);
        assert.equal(error.board, BOARD);
        assert.ok(error.message.includes(BOARD), error.message);
        return true;
      });
    }
  });

  it("refuses an answer that is not the shape asked for, naming what was read", async () => {
    const fractional = [{ ...comments[0], createdAt: "2026-10-28T10:00:00.250Z" }];
    await assert.rejects(readState(reader([{ project: { url: BOARD } }], fractional), REPO, ISSUE, SHARED), /comments of acme\/widgets#212/);
  });

  it("refuses an issue that is no issue number before asking GitHub", async () => {
    for (const issue of [0, -1, 1.5, Number.NaN]) {
      const client = reader([{ project: { url: BOARD } }]);
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

  function reader(answer: FakeAnswer) {
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
    assert.deepEqual(await issueComments(reader(comments), REPO, ISSUE), comments);
  });

  it("refuses an answer that is not the shape asked for, naming what was read", async () => {
    const fractional = [{ ...comments[0], createdAt: "2026-10-28T10:00:00.250Z" }];
    await assert.rejects(issueComments(reader(fractional), REPO, ISSUE), /comments of acme\/widgets#212/);
  });

  it("fails when GitHub does not answer, never reading as no comments", async () => {
    await assert.rejects(issueComments(reader(new GitHubUnanswered("dummy: no answer")), REPO, ISSUE), GitHubUnanswered);
  });

  it("refuses an issue that is no issue number before asking GitHub", async () => {
    for (const issue of [0, -1, 1.5, Number.NaN]) {
      const client = reader(comments);
      await assert.rejects(issueComments(client, REPO, issue), /not an issue number/);
      assert.deepEqual(client.calls, []);
    }
  });
});
