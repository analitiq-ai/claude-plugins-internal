import assert from "node:assert/strict";

import type { Hold, Round, Ruling, Snapshot } from "../../../src/contracts/snapshot.ts";
import type { Shared } from "../../../src/settings.ts";
import type { CommentDeletion, IssueComment, StatusChange } from "../../../src/state.ts";
import { fakeGitHub, type FakeGitHub } from "../../support/fake-github.ts";

export const REPO = "acme/widgets";
export const ISSUE = 212;
export const COMMENTS_PATH = "/repos/acme/widgets/issues/212/comments";
export const BOARD = "https://github.com/orgs/example-org/projects/1";
export const OTHER_PROJECT = "https://github.com/orgs/example-org/projects/7";
// The state comment contract's tag, spelt out here so core is graded against the contract, not its own constants.
export const TAG = "<!-- codeworks:reviewer-state -->";

export const SHARED: Shared = {
  validators: ["fixture"],
  trusted_reviewers: ["alice"],
  board: BOARD,
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};

export type Actor = NonNullable<IssueComment["author"]>;

// GraphQL names an App by its bare login; `[shared]` holds the REST form.
export const SESSION_APP: Actor = { __typename: "Bot", login: "codeworks-session" };
export const ORCHESTRATOR_APP: Actor = { __typename: "Bot", login: "codeworks-orchestrator" };
export const REVIEWER_APP: Actor = { __typename: "Bot", login: "codeworks-reviewer" };
export const PLANNER_APP: Actor = { __typename: "Bot", login: "codeworks-planner" };
export const ADMIN: Actor = { __typename: "User", login: "alice" };

export function at(clock: string): string {
  return `2026-10-28T${clock.length === 5 ? `${clock}:00` : clock}Z`;
}

export const NOW = at("12:00");

export function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

export function round(n: number, fields: Partial<Round> = {}): Round {
  return { stage: "INTERNAL", n, head: sha(n), result: "CLEAN", verdict: null, root_cause: null, at: at("09:00"), ...fields };
}

/** An OPEN row; an escalation gets a question, as its contract needs one. */
export function hold(id: string, fields: Partial<Hold> = {}): Hold {
  const kind = id.slice(0, id.indexOf("-")) as Hold["kind"];
  const question = kind === "escalation" ? "Which reading of FR-3 holds?" : null;
  return { id, kind, state: "OPEN", since: at("10:00"), released: null, released_by: null, question, spec_pr: null, ...fields };
}

export function releasedHold(id: string, comment: number, fields: Partial<Hold> = {}): Hold {
  return hold(id, { state: "RELEASED", released: at("09:55"), released_by: { comment, reset: false }, ...fields });
}

export function pushbackRuling(key: string, n: number): Ruling {
  return {
    key,
    round: { stage: "INTERNAL", n },
    ruling: "PUSH_BACK",
    latest_trusted_comment_id: `PRRC_${n}`,
    reply: "Not real: the caller never passes null here.",
    commits: [],
  };
}

export function fixRuling(key: string, n: number, commits: string[]): Ruling {
  return { ...pushbackRuling(key, n), ruling: "FIX", reply: "Fixed at the cause: the parser now refuses null.", commits };
}

export function snapshot(fields: Partial<Snapshot> = {}): Snapshot {
  return { v: 1, rounds: [round(1)], holds: [], pushbacks: [], rulings: [], ...fields };
}

export function stateBody(state: Snapshot): string {
  return `${TAG}\n\`\`\`json\n${JSON.stringify(state, null, 2)}\n\`\`\`\n`;
}

export function url(databaseId: number): string {
  return `https://github.com/${REPO}/issues/${ISSUE}#issuecomment-${databaseId}`;
}

export function comment(databaseId: number, author: IssueComment["author"], body: string, fields: Partial<IssueComment> = {}): IssueComment {
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

export function stateComment(databaseId: number, state: Snapshot, fields: Partial<IssueComment> = {}): IssueComment {
  return comment(databaseId, REVIEWER_APP, stateBody(state), fields);
}

export function adminComment(databaseId: number, clock: string, body = "Go ahead.", fields: Partial<IssueComment> = {}): IssueComment {
  return comment(databaseId, ADMIN, body, { createdAt: at(clock), ...fields });
}

/** The state comment contract's question tag, spelt out, as the orchestrator App posts it. */
export function questionComment(databaseId: number, of: Hold, clock: string, fields: Partial<IssueComment> = {}): IssueComment {
  const body = `<!-- codeworks:hold-question ${of.id} ${of.since} -->\n\n${of.question ?? ""}\n`;
  return comment(databaseId, ORCHESTRATOR_APP, body, { createdAt: at(clock), ...fields });
}

export function deletion(clock: string, deletedCommentAuthor: CommentDeletion["deletedCommentAuthor"] = REVIEWER_APP): CommentDeletion {
  return { createdAt: at(clock), deletedCommentAuthor };
}

/** The read takes no actor: one is carried here only to show it changes nothing. */
export type Move = StatusChange & { actor?: Actor | null };

export function move(clock: string, fields: Partial<Move> = {}): Move {
  return { createdAt: at(clock), status: "Ready", project: { url: BOARD }, ...fields };
}

export type Issue = {
  comments: IssueComment[];
  deletions?: CommentDeletion[];
  moves?: Move[];
  /** The issue's project items' URLs; the board alone unless a test says otherwise. */
  items?: string[];
  /** Each commenter's `role_name` on the repository; ADMIN's alone unless a test says otherwise. */
  roles?: Record<string, string>;
};

const ADMIN_ROLES: Record<string, string> = { [ADMIN.login]: "admin" };

// The state comment contract's writer roles, spelt out here so core is graded against the contract.
const WRITER_ROLES = ["admin", "maintain", "write"];

/** The logins `stateFrom` takes as writers: those whose role is a writer's. */
export function writersOf({ roles = ADMIN_ROLES }: Issue): Set<string> {
  return new Set(Object.entries(roles).flatMap(([login, role]) => (WRITER_ROLES.includes(role) ? [login] : [])));
}

function onIssue(vars: Record<string, unknown>): boolean {
  return vars.owner === "acme" && vars.name === "widgets" && vars.number === ISSUE;
}

/** The session App's client: it reads the issue, the board and each commenter's role, and answers nothing else. */
export function reader({ comments, deletions = [], moves = [], items = [BOARD], roles = ADMIN_ROLES }: Issue): FakeGitHub {
  const timeline = [
    ...deletions.map((event) => ({ __typename: "CommentDeletedEvent", ...event })),
    ...moves.map((event) => ({ __typename: "ProjectV2ItemStatusChangedEvent", ...event })),
  ];
  return fakeGitHub({
    graphqlPages: [
      { when: (query, vars) => /\bcomments\(/.test(query) && onIssue(vars), answer: comments },
      { when: (query, vars) => /\btimelineItems\(/.test(query) && onIssue(vars), answer: timeline },
      {
        when: (query, vars) => /\bprojectItems\(/.test(query) && onIssue(vars),
        answer: items.map((project) => ({ project: { url: project } })),
      },
    ],
    rest: Object.fromEntries(
      Object.entries(roles).map(([login, role]) => [`GET /repos/acme/widgets/collaborators/${login}/permission`, { role_name: role }]),
    ),
  });
}

/** The reviewer App's client: it tells GitHub's time and posts comments on the issue, and answers nothing else. */
export function writer(now: string = NOW): FakeGitHub {
  return fakeGitHub({ now, rest: { [`POST ${COMMENTS_PATH}`]: { id: 9001, html_url: url(9001) } } });
}

/** The bodies a writer posted; any other REST call it received fails the test. */
export function posts(client: FakeGitHub): string[] {
  return client.calls.flatMap((call) => {
    if (call.kind !== "rest") return [];
    assert.equal(`${call.method} ${call.path}`, `POST ${COMMENTS_PATH}`, "a state write only ever posts an issue comment");
    const { body } = call.body as { body: unknown };
    assert.equal(typeof body, "string");
    return [body as string];
  });
}

/** The snapshot of a posted body, read as the state comment contract writes it. */
export function postedSnapshot(body: string): Snapshot {
  const opening = `${TAG}\n\`\`\`json\n`;
  const closing = "\n```\n";
  assert.ok(body.startsWith(opening), `the body does not open with the tag line and a json fence:\n${body}`);
  assert.ok(body.endsWith(closing), `the body does not end with the closing fence:\n${body}`);
  return JSON.parse(body.slice(opening.length, -closing.length)) as Snapshot;
}
