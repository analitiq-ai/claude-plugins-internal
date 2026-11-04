import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

import { z } from "zod";

import { chainEntryKey, Gates } from "./contracts/gates.ts";
import { byFileName, EVENT_KIND, eventFile, eventText, inApplyOrder, LedgerEvent, tamperId } from "./contracts/ledger.ts";
import { GitSha, NameSegment, Time } from "./contracts/scalars.ts";
import { HoldRequest, type Hold, type Round, type RoundId, type Ruling, type Snapshot } from "./contracts/snapshot.ts";
import {
  Actor,
  answerOf,
  assertIssueNumber,
  connectionNodes,
  GitHubRefused,
  isWriterRole,
  ownerAndName,
  restLogin,
  roleOf,
  USER_TYPE,
  type GitHubClient,
  type Repository,
} from "./github.ts";
import {
  applyEvents,
  EMPTY_SNAPSHOT,
  foldStory,
  mayClear,
  mayHoldEvents,
  type DerivedTamper,
  type StoryCommit,
  type StoryFile,
  type StoryFold,
} from "./ledger-fold.ts";
import type { Shared } from "./settings.ts";
import { HoldKind, HoldState, Lane } from "./values.ts";

const LEDGER_BRANCH = "ledger";

// For the release rule: the one command an admin resets with.
const RESET_COMMAND = "/codeworks reset";

function storyDir(issue: number): string {
  return `issues/${issue}`;
}

// Times are read as `Time`, whole seconds in UTC, as GitHub writes them and core stamps them, so a hold's floor and
// a comment's `createdAt` are compared on one scale.
const IssueCommentNode = z.object({
  databaseId: z.int().min(1),
  author: Actor.nullable(),
  body: z.string(),
  createdAt: Time,
  lastEditedAt: Time.nullable(),
  url: z.string(),
});
export type IssueComment = z.infer<typeof IssueCommentNode>;

// `project` is null for a project the reader cannot see, which is then no board's.
const StatusChangeNode = z.object({
  createdAt: Time,
  status: z.string().nullable(),
  project: z.object({ url: z.string() }).nullable(),
});
export type StatusChange = z.infer<typeof StatusChangeNode>;

const ProjectItem = z.object({ project: z.object({ url: z.string() }) });

/** Why a story is held. Not a value set: no component but core writes or compares one. */
export type StateCause = { cause: "tampered"; commit: string; remaining: string[] } | { cause: "open_hold"; id: string };

export type CommentAt = { url: string; at: string };

/** `comment.id` is the comment's `databaseId`, which the release records. */
export type Releasable = { id: string; comment: CommentAt & { id: number }; reset: boolean };

/** An invalid commit to the story: `at` is its release floor; `remaining`, its files at the head, from the root. */
export type Tamper = { commit: string; at: string; remaining: string[]; released: boolean; releasable: Releasable | null };

/** What a reading is folded from, so a write folds its own commit onto it as a read at that commit would. */
export type Folded = {
  /** The commits touching the story's directory at the reading's head, oldest first. */
  commits: StoryCommit[];
  /** Blob to text, for every file an event commit could have added. */
  texts: ReadonlyMap<string, string>;
  /** Login to `role_name`, for every User commenter and every author a clearance could be by. */
  roles: ReadonlyMap<string, string>;
  /** Per tamper's commit, the committedDate of the first GitHub-signed commit after it on `ledger`, if one is. */
  successors: ReadonlyMap<string, string | null>;
  comments: IssueComment[];
  moves: StatusChange[];
};

export type StateReading = {
  /** The `ledger` oid the fold was read at; every write names it. */
  head: string;
  /** Null only when no commit touches the story's directory. */
  snapshot: Snapshot | null;
  held: boolean;
  causes: StateCause[];
  /** Oldest first. */
  tamper: Tamper[];
  newest_round: Round | null;
  pushed_back: ReadonlyMap<string, RoundId>;
  /** Each open hold the release rule releases now, with the comment that releases it. */
  releasable: Releasable[];
  /** Every open hold and every unreleased tamper releasable. */
  startable: boolean;
  /** The newest admin `/codeworks reset`, from which reviewer and the orchestrator restart their counts. */
  reset: CommentAt | null;
  /** Absent only from a reading built by hand, which no write takes. */
  folded?: Folded;
};

/** The reader sees no item of the issue on `[shared] board`, so a missing Ready move would read as "no Ready". */
export class BoardNotVisible extends Error {
  readonly board: string;

  constructor(board: string) {
    super(`the issue has no item on ${board} that this reader can see`);
    this.name = "BoardNotVisible";
    this.board = board;
  }
}

export class LedgerMissing extends Error {
  constructor(repo: string) {
    super(`${repo} has no ${LEDGER_BRANCH} branch: an admin creates it with its three rulesets, as orchestrator README.md step 6 sets out`);
    this.name = "LedgerMissing";
  }
}

/** `ledger` moved from the reading's head, so the write committed nothing. */
export class StateStale extends Error {
  readonly head: string;

  constructor(from: string, head: string) {
    super(`${LEDGER_BRANCH} moved from ${from} to ${head}, so nothing was committed`);
    this.name = "StateStale";
    this.head = head;
  }
}

/** The write's commit landed without GitHub's signature, so the fold takes it as a tamper. */
export class StateWriteUnsigned extends Error {
  readonly oid: string;

  constructor(oid: string) {
    super(`commit ${oid} on ${LEDGER_BRANCH} is not signed by GitHub, so it tampers its story`);
    this.name = "StateWriteUnsigned";
    this.oid = oid;
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

// The comments and moves the release rule reads, picked once per reading.
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

function resetAfter(terms: ReleaseTerms, second: number): IssueComment | null {
  const { reset } = terms;
  return reset !== null && secondOf(reset.createdAt) > second ? reset : null;
}

function releasedBy(id: string, comment: IssueComment, reset: boolean): Releasable {
  return { id, comment: { id: comment.databaseId, url: comment.url, at: comment.createdAt }, reset };
}

function holdRelease(hold: Hold, floor: string, terms: ReleaseTerms): Releasable | null {
  const second = secondOf(floor);
  const reset = resetAfter(terms, second);
  if (reset !== null) return releasedBy(hold.id, reset, true);
  if (!readyAfter(terms, second)) return null;
  // An escalation's answer is a writer's comment after its question (orchestrator ADR-0010 d2); with no question
  // posted, only a reset releases it.
  let answeredAfter = 0;
  if (hold.kind === HoldKind.schema.enum.escalation) {
    const tag = questionTag(hold);
    const question = terms.orchestratorComments.find((comment) => firstLine(comment.body) === tag);
    if (question === undefined) return null;
    answeredAfter = question.databaseId;
  }
  const answer = adminCommentAfter(terms, second, answeredAfter);
  return answer === undefined ? null : releasedBy(hold.id, answer, false);
}

// Unlike a hold's, a tamper's release needs the Ready move even for a reset (FR-024).
function tamperRelease(id: string, at: string, terms: ReleaseTerms): Releasable | null {
  const second = secondOf(at);
  if (!readyAfter(terms, second)) return null;
  const reset = resetAfter(terms, second);
  if (reset !== null) return releasedBy(id, reset, true);
  const answer = adminCommentAfter(terms, second);
  return answer === undefined ? null : releasedBy(id, answer, false);
}

function earlier(a: string, b: string | null): string {
  return b !== null && secondOf(b) < secondOf(a) ? b : a;
}

function tamperOf(derived: DerivedTamper, issue: number, folded: Folded, story: StoryFold, terms: ReleaseTerms): Tamper {
  const { oid, committedDate } = derived.commit;
  const successor = folded.successors.get(oid);
  if (successor === undefined) throw new Error(`no commit after tamper ${oid} on ${LEDGER_BRANCH} was read`);
  // An invalid commit's date is its author's to set; the first GitHub-signed commit after it, if one is, bounds it.
  const at = earlier(committedDate, successor);
  const remaining = derived.touched.filter((name) => story.headFiles.has(name)).map((name) => `${storyDir(issue)}/${name}`);
  const released = story.releasedTampers.has(derived.id);
  // While a file it left stays on `ledger`, the release rule does not reach it.
  const releasable = released || remaining.length > 0 ? null : tamperRelease(derived.id, at, terms);
  return { commit: oid, at, remaining, released, releasable };
}

function holdFloor(story: StoryFold, id: string): string {
  const floor = story.placed.get(id);
  if (floor === undefined) throw new Error(`the fold holds no placing commit of hold ${id}`);
  return floor;
}

// The one place a reading is built, for readState and for every write's commit alike.
function readingOf(head: string, issue: number, folded: Folded, story: StoryFold, shared: Shared): StateReading {
  const writers = new Set([...folded.roles].flatMap(([login, role]) => (isWriterRole(role) ? [login] : [])));
  const terms = releaseTerms(folded.comments, folded.moves, writers, shared);
  const snapshot = folded.commits.length === 0 ? null : story.snapshot;
  const openHolds = (snapshot?.holds ?? []).filter((row) => row.state === HoldState.schema.enum.OPEN);
  const releasable = openHolds.flatMap((row) => holdRelease(row, holdFloor(story, row.id), terms) ?? []);
  const tamper = story.tampers.map((derived) => tamperOf(derived, issue, folded, story, terms));
  const causes: StateCause[] = [
    ...tamper.flatMap((each): StateCause[] => (each.released ? [] : [{ cause: "tampered", commit: each.commit, remaining: each.remaining }])),
    ...openHolds.map((row): StateCause => ({ cause: "open_hold", id: row.id })),
  ];
  return {
    head,
    snapshot,
    held: causes.length > 0,
    causes,
    tamper,
    newest_round: snapshot?.rounds.at(-1) ?? null,
    // A key pushed back more than once is named by its last pushback's round.
    pushed_back: new Map((snapshot?.pushbacks ?? []).map((pushback) => [pushback.key, pushback.round])),
    releasable,
    startable: tamper.every((each) => each.released || each.releasable !== null) && releasable.length === openHolds.length,
    reset: terms.reset === null ? null : { url: terms.reset.url, at: terms.reset.createdAt },
    folded,
  };
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
      timelineItems(itemTypes: [PROJECT_V2_ITEM_STATUS_CHANGED_EVENT], first: 100, after: $cursor) {
        nodes { ... on ProjectV2ItemStatusChangedEvent { createdAt status project { url } } }
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

/** The one read of an issue's comments, which a story's state and the orchestrator's keyed comments share. */
export async function issueComments(reader: GitHubClient, repo: string, issue: number): Promise<IssueComment[]> {
  assertIssueNumber(issue);
  const pages = await reader.graphqlPages(COMMENTS_QUERY, { ...ownerAndName(repo), number: issue }, ["repository", "issue", "comments"]);
  return answerOf(z.array(IssueCommentNode), pages, `the comments of ${repo}#${issue}`);
}

// The issue's status moves on every project the reader sees, refused when it sees no item of the issue on the board.
async function boardMoves(reader: GitHubClient, repo: string, issue: number, shared: Shared): Promise<StatusChange[]> {
  const where = { ...ownerAndName(repo), number: issue };
  const [timelineNodes, itemNodes] = await Promise.all([
    reader.graphqlPages(TIMELINE_QUERY, where, ["repository", "issue", "timelineItems"]),
    reader.graphqlPages(PROJECT_ITEMS_QUERY, where, ["repository", "issue", "projectItems"]),
  ]);
  const items = answerOf(z.array(ProjectItem), itemNodes, `the project items of ${repo}#${issue}`);
  if (!items.some((item) => item.project.url === shared.board)) throw new BoardNotVisible(shared.board);
  return answerOf(z.array(StatusChangeNode), timelineNodes, `the timeline of ${repo}#${issue}`);
}

const LEDGER_REF_QUERY = `query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    ref(qualifiedName: "refs/heads/${LEDGER_BRANCH}") { target { oid } }
  }
}`;

const LedgerRef = z.object({ repository: z.object({ ref: z.object({ target: z.object({ oid: GitSha }) }).nullable() }) });

async function ledgerHead(reader: GitHubClient, repo: string): Promise<string> {
  const answer = answerOf(LedgerRef, await reader.graphql(LEDGER_REF_QUERY, ownerAndName(repo)), `the ${LEDGER_BRANCH} ref of ${repo}`);
  if (answer.repository.ref === null) throw new LedgerMissing(repo);
  return answer.repository.ref.target.oid;
}

const DIRECTORY = "file(path: $path) { object { ... on Tree { entries { name oid } } } }";
const SIGNATURE = "signature { isValid wasSignedByGitHub }";
const HISTORY_PATH = ["repository", "object", "history"];

const STORY_HISTORY_QUERY = `query($owner: String!, $name: String!, $head: GitObjectID!, $path: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $head) {
      ... on Commit {
        history(first: 100, after: $cursor, path: $path) {
          nodes { oid committedDate ${SIGNATURE} ${DIRECTORY} parents(first: 1) { nodes { ${DIRECTORY} } } }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
}`;

const BRANCH_HISTORY_QUERY = `query($owner: String!, $name: String!, $head: GitObjectID!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    object(oid: $head) {
      ... on Commit {
        history(first: 100, after: $cursor) {
          nodes { oid committedDate ${SIGNATURE} }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  }
}`;

const TOUCHED_QUERY = `query($owner: String!, $name: String!, $from: GitObjectID!, $to: GitObjectID!, $path: String!) {
  repository(owner: $owner, name: $name) {
    from: object(oid: $from) { ... on Commit { history(first: 1, path: $path) { nodes { oid } } } }
    to: object(oid: $to) { ... on Commit { history(first: 1, path: $path) { nodes { oid } } } }
  }
}`;

const Signature = z.object({ isValid: z.boolean(), wasSignedByGitHub: z.boolean() }).nullable();
type Signature = z.infer<typeof Signature>;

function isSigned(signature: Signature): boolean {
  return signature !== null && signature.isValid && signature.wasSignedByGitHub;
}

// Null where the directory has no entry, as git keeps no empty tree.
const Directory = z.object({ object: z.object({ entries: z.array(z.object({ name: z.string(), oid: GitSha })) }) }).nullable();
type Directory = z.infer<typeof Directory>;

const StoryHistoryNode = z.object({
  oid: GitSha,
  committedDate: Time,
  signature: Signature,
  file: Directory,
  parents: z.object({ nodes: z.array(z.object({ file: Directory })).max(1) }),
});
type StoryHistoryNode = z.infer<typeof StoryHistoryNode>;

const BranchNode = z.object({ oid: GitSha, committedDate: Time, signature: Signature });

const RestCommit = z.object({ sha: GitSha, author: z.object({ login: z.string() }).nullable() });

function entriesOf(directory: Directory): Map<string, string> {
  return new Map((directory?.object.entries ?? []).map(({ name, oid }) => [name, oid]));
}

function byName(a: StoryFile, b: StoryFile): number {
  return byFileName(a.name, b.name);
}

function storyCommitOf(node: StoryHistoryNode, author: string | null): StoryCommit {
  const after = entriesOf(node.file);
  const before = entriesOf(node.parents.nodes[0]?.file ?? null);
  const files = [...after].map(([name, blob]) => ({ name, blob }));
  return {
    oid: node.oid,
    committedDate: node.committedDate,
    signed: isSigned(node.signature),
    author,
    added: files.filter(({ name }) => !before.has(name)).toSorted(byName),
    changed: files.filter(({ name, blob }) => before.has(name) && before.get(name) !== blob).toSorted(byName),
    removed: [...before.keys()].filter((name) => !after.has(name)).toSorted(byFileName),
  };
}

// GraphQL names no App's login on a commit, so each author is REST's; the two lists must be one.
async function storyCommits(reader: GitHubClient, repo: string, issue: number, head: string): Promise<StoryCommit[]> {
  const repository = ownerAndName(repo);
  const dir = storyDir(issue);
  const query = new URLSearchParams({ sha: head, path: dir, per_page: "100" });
  const [nodes, listed] = await Promise.all([
    reader.graphqlPages(STORY_HISTORY_QUERY, { ...repository, head, path: dir }, HISTORY_PATH),
    reader.restPages(`/repos/${repository.owner}/${repository.name}/commits?${query}`),
  ]);
  const history = answerOf(z.array(StoryHistoryNode), nodes, `GraphQL's history of ${dir} on ${LEDGER_BRANCH} at ${head}`);
  const authors = answerOf(z.array(RestCommit), listed, `REST's commit list of ${dir} on ${LEDGER_BRANCH} at ${head}`);
  const graphqlOids = history.map(({ oid }) => oid);
  const restOids = authors.map(({ sha }) => sha);
  if (!isDeepStrictEqual(graphqlOids, restOids)) {
    throw new Error(
      `GitHub lists different commits touching ${dir} at ${head}: GraphQL [${graphqlOids.join(", ")}], REST [${restOids.join(", ")}]`,
    );
  }
  return history.map((node, i) => storyCommitOf(node, authors[i].author?.login ?? null)).toReversed();
}

async function blobTexts(reader: GitHubClient, repo: string, blobs: readonly string[]): Promise<Map<string, string>> {
  const unique = [...new Set(blobs)];
  if (unique.length === 0) return new Map();
  const aliases = unique.map((_, i) => `b${i}`);
  const query = `query($owner: String!, $name: String!, ${aliases.map((alias) => `$${alias}: GitObjectID!`).join(", ")}) {
  repository(owner: $owner, name: $name) {
    ${aliases.map((alias) => `${alias}: object(oid: $${alias}) { ... on Blob { text } }`).join("\n    ")}
  }
}`;
  const vars = Object.fromEntries(aliases.map((alias, i) => [alias, unique[i]]));
  // A tree, or anything else not a Blob, answers with no text.
  const Blobs = z.object({ repository: z.record(z.string(), z.object({ text: z.string().nullable().optional() }).nullable()) });
  const answer = answerOf(Blobs, await reader.graphql(query, { ...ownerAndName(repo), ...vars }), `the blobs of ${repo}'s ${LEDGER_BRANCH}`);
  return new Map(
    aliases.flatMap((alias, i) => {
      const text = answer.repository[alias]?.text;
      return typeof text === "string" ? [[unique[i], text] as const] : [];
    }),
  );
}

// The role, not `authorAssociation`: GitHub hides a private org membership from an App's token, so a member's
// comment reads as CONTRIBUTOR to it (orchestrator ADR-0010 d2).
async function rolesOf(reader: GitHubClient, repository: Repository, logins: Iterable<string>): Promise<Map<string, string>> {
  const unique = [...new Set(logins)];
  return new Map(await Promise.all(unique.map(async (login) => [login, await roleOf(reader, repository, login)] as const)));
}

async function successorsOf(reader: GitHubClient, repo: string, head: string, oids: readonly string[]): Promise<Map<string, string | null>> {
  const nodes = await connectionNodes((query, vars) => reader.graphql(query, vars), BRANCH_HISTORY_QUERY, { ...ownerAndName(repo), head }, HISTORY_PATH);
  // Newest first.
  const branch = answerOf(z.array(BranchNode), nodes, `the history of ${LEDGER_BRANCH} at ${head}`);
  return new Map(
    oids.map((oid) => {
      const at = branch.findIndex((commit) => commit.oid === oid);
      if (at === -1) throw new Error(`the history of ${LEDGER_BRANCH} at ${head} lacks ${oid}, which its story's history holds`);
      const first = branch.slice(0, at).findLast((commit) => isSigned(commit.signature));
      return [oid, first?.committedDate ?? null];
    }),
  );
}

/**
 * The one answer every reader and writer of a story's state acts on: the fold of `ledger`'s commits to
 * `issues/<issue>/` at the head read first, with the issue's comments and board moves the release rule reads.
 * `reader` is a client that can read the issue, the board, collaborators' roles and `ledger`.
 */
export async function readState(reader: GitHubClient, repo: string, issue: number, shared: Shared): Promise<StateReading> {
  assertIssueNumber(issue);
  const repository = ownerAndName(repo);
  const head = await ledgerHead(reader, repo);
  const [comments, moves, commits] = await Promise.all([
    issueComments(reader, repo, issue),
    boardMoves(reader, repo, issue, shared),
    storyCommits(reader, repo, issue, head),
  ]);
  const reviewer = shared.reviewer_app_login;
  const commenters = comments.flatMap(({ author }) => (author?.__typename === USER_TYPE ? [author.login] : []));
  const clearers = commits.flatMap((commit) => (mayClear(commit, reviewer) ? [commit.author] : []));
  const [texts, roles] = await Promise.all([
    blobTexts(reader, repo, commits.flatMap((commit) => (mayHoldEvents(commit, reviewer) ? commit.added.map(({ blob }) => blob) : []))),
    rolesOf(reader, repository, [...commenters, ...clearers]),
  ]);
  const story = foldStory(commits, texts, roles, reviewer);
  const successors =
    story.tampers.length === 0 ? new Map<string, string | null>() : await successorsOf(reader, repo, head, story.tampers.map(({ commit }) => commit.oid));
  return readingOf(head, issue, { commits, texts, roles, successors, comments, moves }, story, shared);
}

const Newest = z.object({ history: z.object({ nodes: z.array(z.object({ oid: GitSha })).max(1) }) });
const TouchedAnswer = z.object({ repository: z.object({ from: Newest, to: Newest }) });

/**
 * Whether the newest commit touching `issues/<issue>/` differs at `from` and at `to`: with `to` a later head of
 * `ledger`, whether a commit to the story landed after `from`.
 */
export async function storyTouched(reader: GitHubClient, repo: string, issue: number, from: string, to: string): Promise<boolean> {
  assertIssueNumber(issue);
  for (const oid of [from, to]) {
    if (!GitSha.safeParse(oid).success) throw new TypeError(`not a commit oid: ${JSON.stringify(oid)}`);
  }
  const dir = storyDir(issue);
  const answer = await reader.graphql(TOUCHED_QUERY, { ...ownerAndName(repo), from, to, path: dir });
  const { repository } = answerOf(TouchedAnswer, answer, `the newest commits touching ${dir} at ${from} and ${to}`);
  return repository.from.history.nodes[0]?.oid !== repository.to.history.nodes[0]?.oid;
}

function keepsRuling(old: Ruling, next: Ruling | undefined): boolean {
  if (next === undefined) return false;
  const { commits, ...ruled } = old;
  const { commits: nextCommits, ...nextRuled } = next;
  return isDeepStrictEqual(ruled, nextRuled) && isDeepStrictEqual(commits, nextCommits.slice(0, commits.length));
}

function roundEvent(round: Round): LedgerEvent {
  return { kind: EVENT_KIND.round, v: 1, round };
}

/**
 * `writeState`'s transition, as the events that make it, in the contract's kind order: rounds, rulings, a FIX's
 * commits, pushbacks. Rounds, rulings and pushbacks are only appended, and a FIX's commits only appended to; every
 * hold row and the gates section stay as they were.
 */
export function checkTransition(old: Snapshot, next: Snapshot): LedgerEvent[] {
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
      "writeState's placements, placeRescopeHold, recordGates's openings or releaseOnClaim, the calls that change hold rows",
    );
  }
  if (!isDeepStrictEqual(old.gates, next.gates)) {
    throw new StateWriteRefused("the snapshot changes the gates section", "recordGates, which replaces it");
  }
  return [
    ...next.rounds.slice(old.rounds.length).map(roundEvent),
    ...next.rulings.slice(old.rulings.length).map((ruling): LedgerEvent => ({ kind: EVENT_KIND.ruling, v: 1, ruling: { ...ruling, commits: [] } })),
    ...next.rulings.flatMap(({ round, key, commits }, i) =>
      commits.slice(old.rulings[i]?.commits.length ?? 0).map((commit): LedgerEvent => ({ kind: EVENT_KIND["ruling-commit"], v: 1, round, key, commit })),
    ),
    ...next.pushbacks.slice(old.pushbacks.length).map((pushback): LedgerEvent => ({ kind: EVENT_KIND.pushback, v: 1, pushback })),
  ];
}

function contracted<Schema extends z.ZodType>(schema: Schema, value: unknown, what: string): z.output<Schema> {
  const parsed = schema.safeParse(value);
  if (!parsed.success) throw new StateWriteRefused(`${what} breaks its contract: ${z.prettifyError(parsed.error)}`, null);
  return parsed.data;
}

// A release names its steps in order: an admin's deletion of the files the tamper left, when it left any, then the
// release rule.
function refuseTampers(tampers: readonly Tamper[], shared: Shared): void {
  if (tampers.length === 0) return;
  const held = tampers.map(({ commit, at, remaining }) => {
    const left = remaining.length === 0 ? "no file" : remaining.join(", ");
    return `${tamperId(commit)}, invalid commit ${commit} at ${at}, leaves ${left} on ${LEDGER_BRANCH}`;
  });
  const releases = tampers.map(({ at, remaining }) => {
    const answered = `a Ready move on ${shared.board} and an admin's comment, both after ${at}, then the claim`;
    return remaining.length === 0 ? answered : `a repository admin's deletion on ${LEDGER_BRANCH} of ${remaining.join(", ")}, then ${answered}`;
  });
  throw new StateWriteRefused(`the story is held for ${held.join("; ")}`, releases.join("; "));
}

function unreleasedTampers(reading: StateReading): Tamper[] {
  return reading.tamper.filter((each) => !each.released);
}

function writable(issue: number, reading: StateReading): Folded {
  assertIssueNumber(issue);
  if (reading.folded === undefined) throw new TypeError("the reading carries no fold: a write takes readState's or a write's reading");
  return reading.folded;
}

function isOpen(reading: StateReading, id: string): boolean {
  return reading.snapshot?.holds.some((row) => row.id === id && row.state === HoldState.schema.enum.OPEN) ?? false;
}

function holdEvent(request: HoldRequest, since: string): LedgerEvent {
  return { kind: EVENT_KIND.hold, v: 1, hold: { ...request, since } };
}

// Git's object id of a blob of `text`: the name GitHub's tree entries give the file.
function blobOid(text: string): string {
  const body = Buffer.from(text, "utf8");
  return createHash("sha1").update(`blob ${body.length}\0`).update(body).digest("hex");
}

const COMMIT_MUTATION = `mutation($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) {
    commit { oid committedDate ${SIGNATURE} }
  }
}`;

const CommitAnswer = z.object({ createCommitOnBranch: z.object({ commit: BranchNode }) });

/**
 * The one commit every write makes: the `events` not yet in the fold, at the reading's head, adding only. Returns
 * the reading as it is when every event is in the fold already, else the reading a read at the commit gives, folded
 * from the reading's own.
 */
async function commitEvents(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  reading: StateReading,
  events: readonly LedgerEvent[],
  now: string,
): Promise<StateReading> {
  const folded = writable(issue, reading);
  const reviewer = shared.reviewer_app_login;
  const story = foldStory(folded.commits, folded.texts, folded.roles, reviewer);
  const fresh = events.map((event) => contracted(LedgerEvent, event, `the ${event.kind} event`)).filter((event) => !story.eventFiles.has(eventFile(event)));
  if (fresh.length === 0) return reading;
  const ordered = inApplyOrder(fresh);
  const applied = applyEvents(story, ordered, now, new Set(story.tampers.map(({ id }) => id)));
  if (!applied.ok) throw new StateWriteRefused(`the events do not apply to the story: ${applied.why}`, null);

  const dir = storyDir(issue);
  const files = ordered.map((event) => ({ name: eventFile(event), text: eventText(event) }));
  const kinds = new Set(ordered.map(({ kind }) => kind));
  const input = {
    branch: { repositoryNameWithOwner: repo, branchName: LEDGER_BRANCH },
    expectedHeadOid: reading.head,
    message: { headline: `${dir}: ${[...kinds].join(", ")}` },
    fileChanges: { additions: files.map(({ name, text }) => ({ path: `${dir}/${name}`, contents: Buffer.from(text, "utf8").toString("base64") })) },
  };
  let answer: unknown;
  try {
    answer = await writer.graphql(COMMIT_MUTATION, { input });
  } catch (error) {
    if (!(error instanceof GitHubRefused)) throw error;
    const head = await ledgerHead(reader, repo);
    if (head !== reading.head) throw new StateStale(reading.head, head);
    throw error;
  }
  const { commit } = answerOf(CommitAnswer, answer, `the commit to ${dir} on ${LEDGER_BRANCH}`).createCommitOnBranch;
  if (!isSigned(commit.signature)) throw new StateWriteUnsigned(commit.oid);

  const own: StoryCommit = {
    oid: commit.oid,
    committedDate: commit.committedDate,
    signed: true,
    author: reviewer,
    added: files.map(({ name, text }) => ({ name, blob: blobOid(text) })).toSorted(byName),
    changed: [],
    removed: [],
  };
  const advanced: Folded = {
    ...folded,
    commits: [...folded.commits, own],
    texts: new Map([...folded.texts, ...files.map(({ text }) => [blobOid(text), text] as const)]),
    // The commit is GitHub-signed, so it is the first after every tamper that had none.
    successors: new Map([...folded.successors].map(([oid, after]) => [oid, after ?? commit.committedDate])),
  };
  return readingOf(commit.oid, issue, advanced, foldStory(advanced.commits, advanced.texts, advanced.roles, reviewer), shared);
}

/** A hold a round's report places; `since` is core's to stamp. */
export type Placement = { id: string; kind: Hold["kind"]; question: string | null };

function placementRequest({ id, kind, question }: Placement): HoldRequest {
  const { claim, shim } = HoldKind.schema.enum;
  if (kind === claim || kind === shim) {
    throw new StateWriteRefused(`writeState does not place the ${kind} hold ${id}`, "recordGates, which places it with the gates count that reaches it");
  }
  return contracted(HoldRequest, { id, kind, question, spec_pr: null }, `the placement of ${id}`);
}

/**
 * Commits what `next` appends to the reading's snapshot, as `checkTransition` lets it, each new round's `at` from
 * GitHub's clock, and a hold per placement whose row is not OPEN, `since` from GitHub's clock: one commit. `writer`
 * is the reviewer App's client.
 */
export async function writeState(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  reading: StateReading,
  next: Snapshot,
  placements: readonly Placement[],
): Promise<StateReading> {
  writable(issue, reading);
  refuseTampers(unreleasedTampers(reading), shared);
  const transition = checkTransition(reading.snapshot ?? EMPTY_SNAPSHOT, next);
  for (const event of transition) contracted(LedgerEvent, event, `the ${event.kind} event`);
  const placing = placements.map(placementRequest).filter((request) => !isOpen(reading, request.id));
  if (transition.length === 0 && placing.length === 0) return reading;
  const now = await writer.now();
  const events = [
    ...transition.map((event) => (event.kind === EVENT_KIND.round ? roundEvent({ ...event.round, at: now }) : event)),
    ...placing.map((request) => holdEvent(request, now)),
  ];
  return commitEvents(reader, writer, repo, issue, shared, reading, events, now);
}

/**
 * Opens `rescope-<issue>` recording `specPr`, `since` from GitHub's clock, unless its row records `specPr` already,
 * OPEN or RELEASED: a spec PR's number keys the row (reviewer ADR-0013 d5). `writer` is the reviewer App's client.
 */
export async function placeRescopeHold(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  reading: StateReading,
  specPr: number,
): Promise<StateReading> {
  writable(issue, reading);
  refuseTampers(unreleasedTampers(reading), shared);
  const { rescope } = HoldKind.schema.enum;
  const request = contracted(
    HoldRequest,
    { id: `${rescope}-${issue}`, kind: rescope, question: null, spec_pr: specPr },
    `the ${rescope} hold of spec PR ${specPr}`,
  );
  if (reading.snapshot?.holds.some((row) => row.id === request.id && row.spec_pr === specPr)) return reading;
  const now = await writer.now();
  return commitEvents(reader, writer, repo, issue, shared, reading, [holdEvent(request, now)], now);
}

/** A hold a gates count reaches: `claim-` or `shim-`, its kind its id's prefix. */
export type Opening = { id: string; question: string | null };

// The writes that place each other kind, so a refused opening names them.
const PLACER: Partial<Record<Hold["kind"], string>> = {
  escalation: "writeState, whose placements are a round's holds",
  pushback: "writeState, whose placements are a round's holds",
  audit: "writeState, whose placements are a round's holds",
  rescope: "placeRescopeHold for a spec PR, or writeState's placements for a RESCOPE verdict",
};

function openingRequest({ id, question }: Opening): HoldRequest {
  const kind = HoldKind.schema.safeParse(id.slice(0, id.indexOf("-")));
  if (!kind.success) throw new StateWriteRefused(`the opening ${id} breaks its contract: its id names no hold kind`, null);
  const placer = PLACER[kind.data];
  if (placer !== undefined) throw new StateWriteRefused(`recordGates does not place ${id}`, placer);
  return contracted(HoldRequest, { id, kind: kind.data, question, spec_pr: null }, `the opening ${id}`);
}

// A time is its entry's: a chain entry or a tree the reading holds keeps that time, a tree a merge moved included,
// and any other takes `now`.
function stamped(read: Gates | null, gates: Gates, now: string): Gates {
  const entries = new Map<string, string>(read?.lineages.flatMap((lineage) => lineage.chain.map((entry) => [chainEntryKey(entry), entry.at] as const)));
  const trees = new Map<string, string>(read?.bugs.flatMap((bug) => [...bug.members, ...bug.absorbed].map(({ tree, at }) => [tree, at] as const)));
  const timed = <Entry extends { tree: string }>(entry: Entry): Entry => ({ ...entry, at: trees.get(entry.tree) ?? now });
  return {
    ...gates,
    lineages: gates.lineages.map((lineage) => ({ ...lineage, chain: lineage.chain.map((entry) => ({ ...entry, at: entries.get(chainEntryKey(entry)) ?? now })) })),
    bugs: gates.bugs.map((bug) => ({ ...bug, members: bug.members.map(timed), absorbed: bug.absorbed.map(timed) })),
  };
}

/**
 * Commits `gates.<ref>.json`, every time in it stamped as `stamped` keeps or sets it, and a hold per opening whose
 * row is not OPEN, `since` from GitHub's clock: one commit, so no count is on `ledger` without the hold it reached.
 * `writer` is the reviewer App's client.
 */
export async function recordGates(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  reading: StateReading,
  ref: string,
  gates: Gates,
  openings: readonly Opening[],
): Promise<StateReading> {
  writable(issue, reading);
  refuseTampers(unreleasedTampers(reading), shared);
  const requests = openings.map(openingRequest);
  const checked = contracted(Gates, gates, "the gates section");
  contracted(NameSegment, ref, `the gates ref ${JSON.stringify(ref)}`);
  const now = await writer.now();
  const events: LedgerEvent[] = [
    ...requests.filter((request) => !isOpen(reading, request.id)).map((request) => holdEvent(request, now)),
    { kind: EVENT_KIND.gates, v: 1, ref, gates: stamped(reading.snapshot?.gates ?? null, checked, now) },
  ];
  return commitEvents(reader, writer, repo, issue, shared, reading, events, now);
}

export type ClaimRelease = { released: Releasable[]; reset: CommentAt | null; reading: StateReading };

function releaseEvent({ id, comment, reset }: Releasable, since: string | null, released: string): LedgerEvent {
  return { kind: EVENT_KIND.release, v: 1, release: { id, since, released, released_by: { comment: comment.id, reset } } };
}

/**
 * On the orchestrator's claim: releases every releasable hold and every unreleased tamper, deciding from the
 * reading and committing once. Refused while a tamper stands that is not releasable. `writer` is the reviewer App's
 * client.
 */
export async function releaseOnClaim(
  reader: GitHubClient,
  writer: GitHubClient,
  repo: string,
  issue: number,
  shared: Shared,
  reading: StateReading,
): Promise<ClaimRelease> {
  writable(issue, reading);
  const tampers = unreleasedTampers(reading);
  refuseTampers(
    tampers.filter((each) => each.releasable === null),
    shared,
  );
  const tamperReleases = tampers.flatMap((each) => each.releasable ?? []);
  const released = [...reading.releasable, ...tamperReleases];
  if (released.length === 0) return { released, reset: reading.reset, reading };
  const now = await writer.now();
  const since = new Map((reading.snapshot?.holds ?? []).map((row) => [row.id, row.since]));
  const events = [
    ...reading.releasable.map((release) => releaseEvent(release, since.get(release.id) ?? null, now)),
    ...tamperReleases.map((release) => releaseEvent(release, null, now)),
  ];
  return { released, reset: reading.reset, reading: await commitEvents(reader, writer, repo, issue, shared, reading, events, now) };
}
