import assert from "node:assert/strict";

import type { Gates, Lineage } from "../../../src/contracts/gates.ts";
import type { Hold, HoldPlacement, Round, Ruling, Snapshot } from "../../../src/contracts/snapshot.ts";
import type { Shared } from "../../../src/settings.ts";
import type { IssueComment, StatusChange } from "../../../src/state.ts";
import { fakeGitHub, type FakeGitHub } from "../../support/fake-github.ts";
import type { FakeLedger } from "./ledger.ts";

export const REPO = "acme/widgets";
export const ISSUE = 212;
export const BOARD = "https://github.com/orgs/example-org/projects/1";
export const OTHER_PROJECT = "https://github.com/orgs/example-org/projects/7";

export const SHARED: Shared = {
  validators: ["fixture"],
  adr_folders: [],
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
  return { stage: "INTERNAL", n, run: `run-${n}`, head: sha(n), result: "CLEAN", verdict: null, root_cause: null, at: at("09:00"), ...fields };
}

export const QUESTION_TEXT = "Which reading of FR-3 holds?";

/** An OPEN row, with a question where its contract asks one: an escalation, a claim, a rescope with no spec PR. */
export function hold(id: string, fields: Partial<Hold> = {}): Hold {
  const kind = id.slice(0, id.indexOf("-")) as Hold["kind"];
  const specPr = fields.spec_pr ?? null;
  const asks = kind === "escalation" || kind === "claim" || (kind === "rescope" && specPr === null);
  return {
    id,
    kind,
    state: "OPEN",
    since: at("10:00"),
    released: null,
    released_by: null,
    question: asks ? QUESTION_TEXT : null,
    spec_pr: null,
    ...fields,
  };
}

export function releasedHold(id: string, comment: number, fields: Partial<Hold> = {}): Hold {
  return hold(id, { state: "RELEASED", released: at("09:55"), released_by: { comment, reset: false }, ...fields });
}

/** The `hold` event's payload of `row`: the row without its state and release fields. */
export function placementOf({ id, kind, since, question, spec_pr }: Hold): HoldPlacement {
  return { id, kind, since, question, spec_pr };
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

export function lineage(id: string, fields: Partial<Lineage> = {}): Lineage {
  return {
    id,
    file: "src/parse.ts",
    places: [{ start: 120, end: 168, claim: "c1" }],
    chain: [{ ref: sha(1), claim: "c1", line: 4, words: "refuses a null header", ruling: "WRONG", at: at("09:00") }],
    ...fields,
  };
}

export function gates(fields: Partial<Gates> = {}): Gates {
  return { branch: "212-us1-ledger", anchor: sha(4096), lineages: [], bugs: [], ...fields };
}

export function snapshot(fields: Partial<Snapshot> = {}): Snapshot {
  return { v: 1, rounds: [round(1)], holds: [], pushbacks: [], rulings: [], gates: null, ...fields };
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

export function adminComment(databaseId: number, clock: string, body = "Go ahead.", fields: Partial<IssueComment> = {}): IssueComment {
  return comment(databaseId, ADMIN, body, { createdAt: at(clock), ...fields });
}

/** The hold question's tag, spelt out, as the orchestrator App posts it. */
export function questionComment(
  databaseId: number,
  of: Pick<Hold, "id" | "since" | "question">,
  clock: string,
  fields: Partial<IssueComment> = {},
): IssueComment {
  const body = `<!-- codeworks:hold-question ${of.id} ${of.since} -->\n\n${of.question ?? ""}\n`;
  return comment(databaseId, ORCHESTRATOR_APP, body, { createdAt: at(clock), ...fields });
}

/** The read takes no actor: one is carried here only to show it changes nothing. */
export type Move = StatusChange & { actor?: Actor | null };

export function move(clock: string, fields: Partial<Move> = {}): Move {
  return { createdAt: at(clock), status: "Ready", project: { url: BOARD }, ...fields };
}

export type Issue = {
  comments?: IssueComment[];
  moves?: Move[];
  /** The issue's project items' URLs; the board alone unless a test says otherwise. */
  items?: string[];
  /** Each login's `role_name` on the repository; ADMIN's alone by default. */
  roles?: Record<string, string>;
};

const ADMIN_ROLES: Record<string, string> = { [ADMIN.login]: "admin" };

function onIssue(vars: Record<string, unknown>): boolean {
  return vars.owner === "acme" && vars.name === "widgets" && vars.number === ISSUE;
}

/** The session App's client: it reads the issue, the board, each login's role and `ledger`, and answers nothing else. */
export function reader({ comments = [], moves = [], items = [BOARD], roles = ADMIN_ROLES }: Issue, ledger: FakeLedger): FakeGitHub {
  const routes = ledger.readRoutes();
  return fakeGitHub({
    graphql: routes.graphql,
    graphqlPages: [
      { when: (query, vars) => /\bcomments\(/.test(query) && onIssue(vars), answer: comments },
      {
        when: (query, vars) => /\btimelineItems\(/.test(query) && onIssue(vars),
        answer: moves.map((each) => ({ __typename: "ProjectV2ItemStatusChangedEvent", ...each })),
      },
      {
        when: (query, vars) => /\bprojectItems\(/.test(query) && onIssue(vars),
        answer: items.map((project) => ({ project: { url: project } })),
      },
      ...routes.graphqlPages,
    ],
    rest: Object.fromEntries(
      Object.entries(roles).map(([login, role]) => [`GET /repos/acme/widgets/collaborators/${login}/permission`, { role_name: role }]),
    ),
    restPagesMatching: routes.restPagesMatching,
  });
}

/** The reviewer App's client: it tells GitHub's time and commits to `ledger`, and answers nothing else. */
export function writer(ledger: FakeLedger, now: string = NOW): FakeGitHub {
  return fakeGitHub({ now, graphql: ledger.writeRoutes().graphql });
}

export type CommitInput = {
  branch: { repositoryNameWithOwner: string; branchName: string };
  expectedHeadOid: string;
  message: { headline: string; body?: string };
  fileChanges: { additions?: { path: string; contents: string }[]; deletions?: { path: string }[] };
};

/** The commits `client` asked for; any call but a commit or the clock fails the test, so it posted no comment. */
export function commitsAsked(client: FakeGitHub): CommitInput[] {
  return client.calls.flatMap((call) => {
    if (call.kind === "now") return [];
    assert.ok(call.kind === "graphql" && /\bcreateCommitOnBranch\(/.test(call.query), `a state write only ever commits: ${JSON.stringify(call)}`);
    const input = call.vars.input as CommitInput;
    assert.deepEqual(input.branch, { repositoryNameWithOwner: REPO, branchName: "ledger" }, "a state write only ever commits to ledger");
    return [input];
  });
}

/** A commit's added files, path to text. */
export function addedFiles(input: CommitInput): Record<string, string> {
  return Object.fromEntries(
    (input.fileChanges.additions ?? []).map(({ path, contents }) => [path, Buffer.from(contents, "base64").toString("utf8")]),
  );
}
