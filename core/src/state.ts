import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { Snapshot, Time, type Hold, type Round, type RoundId, type Ruling } from "./contracts/snapshot.ts";
import { Actor, answerOf, assertIssueNumber, isWriterRole, ownerAndName, restLogin, roleOf, USER_TYPE, type GitHubClient } from "./github.ts";
import type { Shared } from "./settings.ts";
import { HoldKind, HoldState, Lane } from "./values.ts";

// The state comment's first line, byte for byte, then one json fence that ends the body.
const STATE_TAG = "<!-- codeworks:reviewer-state -->";
const OPENING_FENCE = "```json";
const CLOSING_FENCE = "```";

// GitHub refuses a longer comment, and trimming history to fit would drop rows, which no write may do.
const COMMENT_LIMIT = 65_536;

// For the release rule: the one command an admin resets with.
const RESET_COMMAND = "/codeworks reset";

// Times are read as `Time`, whole seconds in UTC, as GitHub writes them and core stamps them, so a snapshot's
// `since` and a comment's `createdAt` are compared on one scale.
const IssueCommentNode = z.object({
  databaseId: z.int().min(1),
  author: Actor.nullable(),
  body: z.string(),
  createdAt: Time,
  lastEditedAt: Time.nullable(),
  url: z.string(),
});
export type IssueComment = z.infer<typeof IssueCommentNode>;

const CommentDeletionNode = z.object({ createdAt: Time, deletedCommentAuthor: Actor.nullable() });
export type CommentDeletion = z.infer<typeof CommentDeletionNode>;

// `project` is null for a project the reader cannot see, which is then no board's.
const StatusChangeNode = z.object({
  createdAt: Time,
  status: z.string().nullable(),
  project: z.object({ url: z.string() }).nullable(),
});
export type StatusChange = z.infer<typeof StatusChangeNode>;

const DELETED_EVENT = "CommentDeletedEvent";
const STATUS_CHANGED_EVENT = "ProjectV2ItemStatusChangedEvent";

const TimelineItem = z.discriminatedUnion("__typename", [
  CommentDeletionNode.extend({ __typename: z.literal(DELETED_EVENT) }),
  StatusChangeNode.extend({ __typename: z.literal(STATUS_CHANGED_EVENT) }),
]);

const ProjectItem = z.object({ project: z.object({ url: z.string() }) });

/** Why a story is held. Not a value set: no component but core writes or compares one. */
export type StateCause =
  | { cause: "tampered" }
  | { cause: "deleted" }
  | { cause: "invalid"; error: string }
  | { cause: "open_hold"; id: string };

export type StateReading = {
  /** The working snapshot every answer is over; null only when there is no state. */
  snapshot: Snapshot | null;
  comment_url: string | null;
  /** The snapshot came from the newest unedited, tagged, valid comment because a tamper cause stands. */
  rebuilt: boolean;
  held: boolean;
  causes: StateCause[];
  newest_round: Round | null;
  pushed_back: ReadonlyMap<string, RoundId>;
  /** Each open hold a start releases, with the comment that releases it. */
  releasable: Releasable[];
  /** A tamper cause stands, and a Ready move and an admin's comment both follow it. */
  tamper_released: boolean;
  startable: boolean;
  /** The newest admin `/codeworks reset`, from which reviewer and the orchestrator restart their counts. */
  reset: CommentAt | null;
};

export type CommentAt = { url: string; at: string };

/** `comment.id` is the comment's `databaseId`, which the released row records. */
export type Releasable = { id: string; comment: CommentAt & { id: number }; reset: boolean };

/** The reader sees no item of the issue on `[shared] board`, so a missing Ready move would read as "no Ready". */
export class BoardNotVisible extends Error {
  readonly board: string;

  constructor(board: string) {
    super(`the issue has no item on ${board} that this reader can see`);
    this.name = "BoardNotVisible";
    this.board = board;
  }
}

/** A write refused: `release` is what lets it through, null when only a different write would. */
export class StateWriteRefused extends Error {
  declare readonly cause: string;
  readonly release: string | null;

  constructor(cause: string, release: string | null) {
    super(release === null ? `state write refused: ${cause}` : `state write refused: ${cause}; released by ${release}`, { cause });
    this.name = "StateWriteRefused";
    this.release = release;
  }
}

function isApp(actor: Actor | null, appLogin: string): boolean {
  return restLogin(actor) === appLogin;
}

// GitHub's times are whole seconds, so two in one second have no order between them; callers compare seconds.
export function secondOf(time: string): number {
  const ms = Date.parse(time);
  if (Number.isNaN(ms)) throw new TypeError(`not a time: ${JSON.stringify(time)}`);
  return Math.floor(ms / 1000);
}

type SnapshotRead = { ok: true; snapshot: Snapshot } | { ok: false; error: string };

function snapshotOf(comment: IssueComment): SnapshotRead {
  const { body, url } = comment;
  if (body.split("\n", 1)[0] !== STATE_TAG) return { ok: false, error: `${url}: its first line is not ${STATE_TAG}` };
  const opening = `${STATE_TAG}\n${OPENING_FENCE}\n`;
  const closing = [`\n${CLOSING_FENCE}\n`, `\n${CLOSING_FENCE}`].find((end) => body.endsWith(end));
  if (!body.startsWith(opening) || closing === undefined || body.length < opening.length + closing.length) {
    return { ok: false, error: `${url}: the tag line is not followed by one ${OPENING_FENCE} fence that ends the body` };
  }
  let value: unknown;
  try {
    value = JSON.parse(body.slice(opening.length, body.length - closing.length));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { ok: false, error: `${url}: the fenced text is not JSON: ${error.message}` };
  }
  const parsed = Snapshot.safeParse(value);
  if (!parsed.success) {
    return { ok: false, error: `${url}: the snapshot breaks its contract: ${z.prettifyError(parsed.error)}` };
  }
  return { ok: true, snapshot: parsed.data };
}

function emptySnapshot(): Snapshot {
  return { v: 1, rounds: [], holds: [], pushbacks: [], rulings: [] };
}

function isWriter(actor: Actor | null, writers: ReadonlySet<string>): boolean {
  return actor !== null && actor.__typename === USER_TYPE && writers.has(actor.login);
}

function firstLine(body: string): string {
  return body.split("\n", 1)[0];
}

/** The first line of the comment the orchestrator App asks an escalation hold's question with. */
export function questionTag(hold: Pick<Hold, "id" | "since">): string {
  return `<!-- codeworks:hold-question ${hold.id} ${hold.since} -->`;
}

// The comments and moves the release rule reads, picked once per read.
type ReleaseTerms = {
  /** Newest first. */
  adminComments: IssueComment[];
  /** Oldest first, so the first with a hold's tag is its question. */
  orchestratorComments: IssueComment[];
  newestReadySecond: number | null;
  reset: IssueComment | null;
};

function releaseTerms(
  comments: readonly IssueComment[],
  moves: readonly StatusChange[],
  writers: ReadonlySet<string>,
  shared: Shared,
): ReleaseTerms {
  const adminComments = comments
    .filter((comment) => isWriter(comment.author, writers))
    .toSorted((a, b) => b.databaseId - a.databaseId);
  const readySeconds = moves
    .filter((move) => move.status === Lane.schema.enum.Ready && move.project?.url === shared.board)
    .map((move) => secondOf(move.createdAt));
  return {
    adminComments,
    orchestratorComments: comments
      .filter((comment) => isApp(comment.author, shared.orchestrator_app_login))
      .toSorted((a, b) => a.databaseId - b.databaseId),
    newestReadySecond: readySeconds.length === 0 ? null : Math.max(...readySeconds),
    reset: adminComments.find((comment) => comment.body.trim() === RESET_COMMAND) ?? null,
  };
}

// "After" a time is a later second: a same-second comment or move may have come first, so the admin acts again.
function readyAfter(terms: ReleaseTerms, second: number): boolean {
  return terms.newestReadySecond !== null && terms.newestReadySecond > second;
}

// Between two comments "after" is `databaseId` order, which settles a pair GitHub's seconds cannot.
function adminCommentAfter(terms: ReleaseTerms, second: number, afterComment = 0): IssueComment | undefined {
  return terms.adminComments.find((comment) => secondOf(comment.createdAt) > second && comment.databaseId > afterComment);
}

function releaseOf(hold: Hold, terms: ReleaseTerms): Releasable | null {
  const since = secondOf(hold.since);
  const { reset } = terms;
  if (reset !== null && secondOf(reset.createdAt) > since) {
    return { id: hold.id, comment: { id: reset.databaseId, url: reset.url, at: reset.createdAt }, reset: true };
  }
  if (!readyAfter(terms, since)) return null;
  // An escalation's answer is a writer's comment after its question (orchestrator ADR-0010 d2); with no question
  // posted, only a reset releases it.
  let answeredAfter = 0;
  if (hold.kind === HoldKind.schema.enum.escalation) {
    const tag = questionTag(hold);
    const question = terms.orchestratorComments.find((comment) => firstLine(comment.body) === tag);
    if (question === undefined) return null;
    answeredAfter = question.databaseId;
  }
  const answer = adminCommentAfter(terms, since, answeredAfter);
  if (answer === undefined) return null;
  return { id: hold.id, comment: { id: answer.databaseId, url: answer.url, at: answer.createdAt }, reset: false };
}

function newestTime(times: readonly string[]): string | null {
  return times.reduce<string | null>((newest, time) => (newest === null || secondOf(time) > secondOf(newest) ? time : newest), null);
}

type Judgement = {
  reading: StateReading;
  /** The newest of the state comment's edit, a reviewer App deletion and the invalid comment, when any stands. */
  tamperedAt: string | null;
};

function judge(
  comments: readonly IssueComment[],
  deletions: readonly CommentDeletion[],
  moves: readonly StatusChange[],
  writers: ReadonlySet<string>,
  shared: Shared,
): Judgement {
  // Every reviewer App comment, whatever its body: an edit that removes the tag must hold the story, not hand
  // the state to the comment before it (reviewer ADR-0011 d2).
  const reviewerComments = comments
    .filter((comment) => isApp(comment.author, shared.reviewer_app_login))
    .toSorted((a, b) => b.databaseId - a.databaseId);
  const reviewerDeletions = deletions.filter((deletion) => isApp(deletion.deletedCommentAuthor, shared.reviewer_app_login));
  const stateComment = reviewerComments.at(0) ?? null;
  const terms = releaseTerms(comments, moves, writers, shared);
  const reset = terms.reset === null ? null : { url: terms.reset.url, at: terms.reset.createdAt };

  if (stateComment === null && reviewerDeletions.length === 0) {
    const reading: StateReading = {
      snapshot: null,
      comment_url: null,
      rebuilt: false,
      held: false,
      causes: [],
      newest_round: null,
      pushed_back: new Map(),
      releasable: [],
      tamper_released: false,
      startable: true,
      reset,
    };
    return { reading, tamperedAt: null };
  }

  const causes: StateCause[] = [];
  const tamperTimes: string[] = [];
  if (stateComment !== null && stateComment.lastEditedAt !== null) {
    causes.push({ cause: "tampered" });
    tamperTimes.push(stateComment.lastEditedAt);
  }
  // A deletion in the state comment's own second may have come after it, so it holds.
  const deleted = reviewerDeletions.some(
    (deletion) => stateComment === null || secondOf(deletion.createdAt) >= secondOf(stateComment.createdAt),
  );
  if (deleted) {
    causes.push({ cause: "deleted" });
    tamperTimes.push(...reviewerDeletions.map((deletion) => deletion.createdAt));
  }
  const stateRead = stateComment === null ? null : snapshotOf(stateComment);
  if (stateComment !== null && stateRead !== null && !stateRead.ok) {
    causes.push({ cause: "invalid", error: stateRead.error });
    tamperTimes.push(stateComment.createdAt);
  }
  const tamperedAt = newestTime(tamperTimes);

  // Only tamper causes are in `causes` yet; open holds are read from the snapshot this picks.
  const rebuilt = causes.length > 0;
  let snapshot: Snapshot;
  if (!rebuilt && stateRead?.ok) {
    snapshot = stateRead.snapshot;
  } else {
    // The release path posts this snapshot, so it is never one that could have been tampered with.
    const fallback = reviewerComments
      .filter((comment) => comment.lastEditedAt === null)
      .map(snapshotOf)
      .find((read) => read.ok);
    snapshot = fallback?.ok ? fallback.snapshot : emptySnapshot();
  }

  const openHolds = snapshot.holds.filter((hold) => hold.state === HoldState.schema.enum.OPEN);
  for (const hold of openHolds) causes.push({ cause: "open_hold", id: hold.id });
  // The start is decided and the release written over this one snapshot, so neither acts on rows the
  // other did not judge.
  const releasable = openHolds.map((hold) => releaseOf(hold, terms)).filter((release) => release !== null);
  const tamperReleased =
    tamperedAt !== null && readyAfter(terms, secondOf(tamperedAt)) && adminCommentAfter(terms, secondOf(tamperedAt)) !== undefined;

  const reading: StateReading = {
    snapshot,
    comment_url: stateComment?.url ?? null,
    rebuilt,
    held: causes.length > 0,
    causes,
    newest_round: snapshot.rounds.at(-1) ?? null,
    // Pushbacks are appended, so a key pushed back again is named by its newest round.
    pushed_back: new Map(snapshot.pushbacks.map((pushback) => [pushback.key, pushback.round])),
    releasable,
    tamper_released: tamperReleased,
    startable: (tamperedAt === null || tamperReleased) && releasable.length === openHolds.length,
    reset,
  };
  return { reading, tamperedAt };
}

/**
 * The one answer every reader and writer of a story's state acts on. Pure: GitHub is read by the caller,
 * `writers` included, the logins whose role on the repository is a writer's.
 */
export function stateFrom(
  comments: readonly IssueComment[],
  deletions: readonly CommentDeletion[],
  moves: readonly StatusChange[],
  writers: ReadonlySet<string>,
  shared: Shared,
): StateReading {
  return judge(comments, deletions, moves, writers, shared).reading;
}

const COMMENTS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      comments(first: 100, after: $cursor) {
        nodes { databaseId author { __typename login } body createdAt lastEditedAt url }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const TIMELINE_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      timelineItems(itemTypes: [COMMENT_DELETED_EVENT, PROJECT_V2_ITEM_STATUS_CHANGED_EVENT], first: 100, after: $cursor) {
        nodes {
          __typename
          ... on ${DELETED_EVENT} { createdAt deletedCommentAuthor { __typename login } }
          ... on ${STATUS_CHANGED_EVENT} { createdAt status project { url } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

const PROJECT_ITEMS_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      projectItems(first: 100, after: $cursor) {
        nodes { project { url } }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}`;

// Every read and write of a story's state starts here, so one check covers the issue each of them asks about.
async function judgeIssue(reader: GitHubClient, repo: string, issue: number, shared: Shared): Promise<Judgement> {
  assertIssueNumber(issue);
  const where = { ...ownerAndName(repo), number: issue };
  const [commentNodes, timelineNodes, itemNodes] = await Promise.all([
    reader.graphqlPages(COMMENTS_QUERY, where, ["repository", "issue", "comments"]),
    reader.graphqlPages(TIMELINE_QUERY, where, ["repository", "issue", "timelineItems"]),
    reader.graphqlPages(PROJECT_ITEMS_QUERY, where, ["repository", "issue", "projectItems"]),
  ]);
  const comments = answerOf(z.array(IssueCommentNode), commentNodes, `the comments of ${repo}#${issue}`);
  const timeline = answerOf(z.array(TimelineItem), timelineNodes, `the timeline of ${repo}#${issue}`);
  const items = answerOf(z.array(ProjectItem), itemNodes, `the project items of ${repo}#${issue}`);

  if (!items.some((item) => item.project.url === shared.board)) throw new BoardNotVisible(shared.board);

  // The role, not `authorAssociation`: GitHub hides a private org membership from an App's token, so a member's
  // comment reads as CONTRIBUTOR to it (orchestrator ADR-0010 d2).
  const commenters = new Set(comments.flatMap((comment) => (comment.author?.__typename === USER_TYPE ? [comment.author.login] : [])));
  const roles = await Promise.all([...commenters].map(async (login) => [login, await roleOf(reader, where, login)] as const));
  const writers = new Set(roles.flatMap(([login, role]) => (isWriterRole(role) ? [login] : [])));

  const deletions: CommentDeletion[] = [];
  const moves: StatusChange[] = [];
  for (const item of timeline) {
    if (item.__typename === DELETED_EVENT) deletions.push(item);
    else moves.push(item);
  }
  return judge(comments, deletions, moves, writers, shared);
}

/** `reader` reads issues and the board: the session App's or the orchestrator App's client. */
export async function readState(reader: GitHubClient, repo: string, issue: number, shared: Shared): Promise<StateReading> {
  return (await judgeIssue(reader, repo, issue, shared)).reading;
}

// A plain object's keys in sorted order, so one snapshot always renders as one text.
function sortedKeys(_key: string, value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return value;
  const object = value as Record<string, unknown>;
  return Object.fromEntries(Object.keys(object).toSorted().map((key) => [key, object[key]]));
}

/** The state comment's body for `snapshot`. */
export function renderState(snapshot: Snapshot): string {
  return `${STATE_TAG}\n${OPENING_FENCE}\n${JSON.stringify(snapshot, sortedKeys, 2)}\n${CLOSING_FENCE}\n`;
}

function keepsRuling(old: Ruling, next: Ruling | undefined): boolean {
  if (next === undefined) return false;
  const { commits, ...ruled } = old;
  const { commits: nextCommits, ...nextRuled } = next;
  return isDeepStrictEqual(ruled, nextRuled) && isDeepStrictEqual(commits, nextCommits.slice(0, commits.length));
}

/**
 * `writeState`'s transition: rounds, pushbacks and rulings only appended, and a ruling's commits only appended to;
 * every hold row as it was.
 */
export function checkTransition(old: Snapshot, next: Snapshot): void {
  const rewrittenRound = old.rounds.find((round, i) => !isDeepStrictEqual(round, next.rounds[i]));
  if (rewrittenRound !== undefined) {
    throw new StateWriteRefused(`the snapshot drops or rewrites round ${rewrittenRound.stage} ${rewrittenRound.n}`, null);
  }
  const rewrittenPushback = old.pushbacks.find((pushback, i) => !isDeepStrictEqual(pushback, next.pushbacks[i]));
  if (rewrittenPushback !== undefined) {
    throw new StateWriteRefused(`the snapshot drops or rewrites the pushback of ${rewrittenPushback.key}`, null);
  }
  const rewrittenRuling = old.rulings.find((ruling, i) => !keepsRuling(ruling, next.rulings[i]));
  if (rewrittenRuling !== undefined) {
    const { key, round } = rewrittenRuling;
    throw new StateWriteRefused(`the snapshot drops or rewrites the ruling of ${key} in round ${round.stage} ${round.n}`, null);
  }
  const before = new Map(old.holds.map((row) => [row.id, row]));
  const after = new Map(next.holds.map((row) => [row.id, row]));
  const changed = [...new Set([...before.keys(), ...after.keys()])].filter((id) => !isDeepStrictEqual(before.get(id), after.get(id)));
  if (changed.length > 0) {
    throw new StateWriteRefused(
      `the snapshot changes hold rows ${changed.join(", ")}`,
      "placeHold, placeRescopeHold or releaseOnClaim, the one call that changes each",
    );
  }
}

const CAUSE_TEXT = {
  tampered: "tampered state: the state comment was edited",
  deleted: "deleted state: a reviewer App comment was deleted",
};

function tamperRefusal({ reading, tamperedAt }: Judgement, shared: Shared): StateWriteRefused | null {
  if (tamperedAt === null) return null;
  const held = reading.causes.flatMap((cause) => {
    if (cause.cause === "invalid") return [`invalid state: ${cause.error}`];
    return cause.cause === "open_hold" ? [] : [CAUSE_TEXT[cause.cause]];
  });
  return new StateWriteRefused(
    `the story is held for ${held.join("; ")}`,
    `a Ready move on ${shared.board} and an admin's comment, both after ${tamperedAt}, then the release on the claim`,
  );
}

// Every write but the release path: none may build on state that could have been tampered with.
async function untamperedSnapshot(reader: GitHubClient, repo: string, issue: number, shared: Shared): Promise<Snapshot> {
  const judgement = await judgeIssue(reader, repo, issue, shared);
  const refusal = tamperRefusal(judgement, shared);
  if (refusal !== null) throw refusal;
  return judgement.reading.snapshot ?? emptySnapshot();
}

// The one place a state comment is posted: never one a reader would take as invalid, never an edit.
async function post(writer: GitHubClient, repo: string, issue: number, snapshot: Snapshot): Promise<void> {
  const parsed = Snapshot.safeParse(snapshot);
  if (!parsed.success) {
    throw new StateWriteRefused(`the snapshot breaks its contract: ${z.prettifyError(parsed.error)}`, null);
  }
  const body = renderState(parsed.data);
  // GitHub counts characters; a string's length counts UTF-16 units.
  const size = [...body].length;
  if (size > COMMENT_LIMIT) {
    throw new StateWriteRefused(`the state comment would be ${size} characters, over GitHub's limit of ${COMMENT_LIMIT}`, null);
  }
  const { owner, name } = ownerAndName(repo);
  await writer.rest("POST", `/repos/${owner}/${name}/issues/${issue}/comments`, { body });
}

function withRow(snapshot: Snapshot, row: Hold): Snapshot {
  const at = snapshot.holds.findIndex((held) => held.id === row.id);
  return { ...snapshot, holds: at === -1 ? [...snapshot.holds, row] : snapshot.holds.with(at, row) };
}

function openRow(id: string, kind: Hold["kind"], since: string, question: string | null, specPr: number | null): Hold {
  return { id, kind, state: HoldState.schema.enum.OPEN, since, released: null, released_by: null, question, spec_pr: specPr };
}

/**
 * Posts `snapshot`, which may only append to the state as `checkTransition` lets it; core stamps each appended round's
 * `at` from GitHub's clock. `writer` is the reviewer App's client.
 */
export async function writeState(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  snapshot: Snapshot,
): Promise<void> {
  const working = await untamperedSnapshot(reader, repo, issue, shared);
  checkTransition(working, snapshot);
  const at = await writer.now();
  const rounds = snapshot.rounds.map((round, i) => (i < working.rounds.length ? round : { ...round, at }));
  await post(writer, repo, issue, { ...snapshot, rounds });
}

export type HoldPlacement = { id: string; kind: Hold["kind"]; question: string | null };

/** Opens a hold of any kind but `rescope`, stamping `since` from GitHub's clock; an OPEN row is left as it is. */
export async function placeHold(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  { id, kind, question }: HoldPlacement,
): Promise<void> {
  const { rescope, escalation } = HoldKind.schema.enum;
  if (kind === rescope) {
    throw new StateWriteRefused(`placeHold does not place a ${rescope} hold`, "placeRescopeHold, which records its spec PR");
  }
  if (kind === escalation && (question === null || question === "")) {
    throw new StateWriteRefused(`an ${escalation} hold needs its question (orchestrator ADR-0010 d1)`, null);
  }
  const working = await untamperedSnapshot(reader, repo, issue, shared);
  const row = working.holds.find((held) => held.id === id);
  if (row?.state === HoldState.schema.enum.OPEN) return;
  const since = await writer.now();
  await post(writer, repo, issue, withRow(working, openRow(id, kind, since, question, null)));
}

/**
 * Opens `rescope-<issue>` recording `specPr`, or null on a RESCOPE verdict. A spec PR's number keys the row, so a
 * hook deriving it at each run never places it twice for one PR; a verdict has none and places as `placeHold`
 * does (reviewer ADR-0013 d5).
 */
export async function placeRescopeHold(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  specPr: number | null,
): Promise<void> {
  const working = await untamperedSnapshot(reader, repo, issue, shared);
  const { rescope } = HoldKind.schema.enum;
  const id = `${rescope}-${issue}`;
  const row = working.holds.find((held) => held.id === id);
  const placed = specPr === null ? row?.state === HoldState.schema.enum.OPEN : row?.spec_pr === specPr;
  if (placed) return;
  const since = await writer.now();
  await post(writer, repo, issue, withRow(working, openRow(id, rescope, since, null, specPr)));
}

export type ClaimRelease = { released: Releasable[]; rebuilt: boolean; reset: CommentAt | null };

/**
 * On the orchestrator's claim: releases every releasable hold and a released tamper cause, deciding and writing
 * over one read. `writer` is the reviewer App's client.
 */
export async function releaseOnClaim(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
): Promise<ClaimRelease> {
  const judgement = await judgeIssue(reader, repo, issue, shared);
  const { snapshot, releasable, rebuilt, reset, tamper_released } = judgement.reading;
  if (!tamper_released) {
    const refusal = tamperRefusal(judgement, shared);
    if (refusal !== null) throw refusal;
  }
  const answer = { released: releasable, rebuilt, reset };
  if (snapshot === null || (releasable.length === 0 && !tamper_released)) return answer;

  const released = await writer.now();
  const releases = new Map(releasable.map((release) => [release.id, release]));
  const holds = snapshot.holds.map((row) => {
    const release = releases.get(row.id);
    if (release === undefined) return row;
    const released_by = { comment: release.comment.id, reset: release.reset };
    return { ...row, state: HoldState.schema.enum.RELEASED, released, released_by };
  });
  await post(writer, repo, issue, { ...snapshot, holds });
  return answer;
}
