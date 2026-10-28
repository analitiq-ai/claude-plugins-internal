import { z } from "zod";

import { readSpecFacts, SpecKind, type SpecFacts } from "./contracts/spec-facts.ts";
import { ownerAndName, type GitHubClient, type Repository } from "./github.ts";
import { NotInTree, type Tree, type TreeEntry } from "./tree.ts";

export type StoryBranch = { story: number; k: number; slug: string };
export type SpecBranch = { spec: number };

/** The story's PR: `head` is its head commit. */
export type StoryPr = { number: number; head: string; merged: boolean };

/** The text a story is built and graded against; `source` says where it was read. */
export type Requirement = { kind: SpecKind; text: string; source: string };

export type IssueClose = {
  /** The closing actor's GitHub type, null for a deleted account; every App acts as a `Bot`. */
  actorType: string | null;
  /** The actor's `role_name` on the repository, read for a `User` only. */
  role: string | null;
};

/** A story fact that cannot be derived from what GitHub or the tree holds; `found` names what is there. */
export class DerivationError extends Error {
  readonly what: string;
  readonly found: string;

  constructor(what: string, found: string, options?: ErrorOptions) {
    super(`cannot derive ${what}: found ${found}`, options);
    this.name = "DerivationError";
    this.what = what;
    this.found = found;
  }
}

// Issue numbers have no leading zero, so `0212-…` is no story (R10).
const STORY_BRANCH = /^([1-9][0-9]*)-us([1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const SPEC_BRANCH = /^([1-9][0-9]*)-spec$/;

export function parseBranch(name: string): StoryBranch | SpecBranch | null {
  const story = STORY_BRANCH.exec(name);
  if (story !== null) return { story: Number(story[1]), k: Number(story[2]), slug: story[3] };
  const spec = SPEC_BRANCH.exec(name);
  if (spec !== null) return { spec: Number(spec[1]) };
  return null;
}

function storyOf(branch: string): number | null {
  const parsed = parseBranch(branch);
  return parsed !== null && "story" in parsed ? parsed.story : null;
}

function assertIssueNumber(n: number): void {
  if (!Number.isSafeInteger(n) || n < 1) throw new TypeError(`not an issue number: ${n}`);
}

function answerOf<Schema extends z.ZodType>(schema: Schema, answer: unknown, what: string): z.output<Schema> {
  const parsed = schema.safeParse(answer);
  if (!parsed.success) {
    throw new Error(`GitHub's answer for ${what} is not the shape asked for: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

const IssueNumber = z.number().int().positive();

// Only `parent` is asked for, never its parent: the spec's issue is the immediate parent (Edge Cases).
const SPEC_ISSUE_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) {
    id
    issue(number: $number) { parent { number repository { id nameWithOwner } } }
  }
}`;

const SpecIssueAnswer = z.object({
  repository: z.object({
    id: z.string(),
    issue: z.object({
      parent: z
        .object({ number: IssueNumber, repository: z.object({ id: z.string(), nameWithOwner: z.string() }) })
        .nullable(),
    }),
  }),
});

export async function specIssue(reader: GitHubClient, repo: string, s: number): Promise<number> {
  assertIssueNumber(s);
  const answer = await reader.graphql(SPEC_ISSUE_QUERY, { ...ownerAndName(repo), number: s });
  const { repository } = answerOf(SpecIssueAnswer, answer, `the parent of ${repo}#${s}`);
  const parent = repository.issue.parent;
  if (parent === null) return s;
  // Compared by id: a name can differ in case or follow a rename, an id cannot.
  if (parent.repository.id !== repository.id) {
    throw new DerivationError(
      `the spec's issue of ${repo}#${s}`,
      `its parent ${parent.repository.nameWithOwner}#${parent.number}, in another repository`,
    );
  }
  return parent.number;
}

export function pickSpecFolder(names: readonly string[], p: number): string {
  assertIssueNumber(p);
  const matching = names.filter((name) => name.startsWith(`${p}-`));
  if (matching.length === 1) return `specs/${matching[0]}`;
  const found =
    matching.length === 0
      ? `no specs/${p}-*/ among ${names.length === 0 ? "no folders" : names.join(", ")}`
      : matching.map((name) => `specs/${name}/`).join(", ");
  throw new DerivationError(`the spec folder of #${p}`, found);
}

export async function specFolder(tree: Tree, p: number): Promise<string> {
  let entries: TreeEntry[];
  try {
    entries = await tree.listDir("specs");
  } catch (error) {
    // A ref with no specs/ holds no spec folder: the same answer as a specs/ with none for `p`.
    if (!(error instanceof NotInTree)) throw error;
    throw new DerivationError(`the spec folder of #${p}`, `no specs/ folder (${error.message})`, { cause: error });
  }
  return pickSpecFolder(
    entries.filter((entry) => entry.isDir).map((entry) => entry.name),
    p,
  );
}

const PullRequestHeadAnswer = z.object({
  number: IssueNumber,
  headRefName: z.string(),
  headRefOid: z.string().regex(/^[0-9a-f]{40}$/),
  isCrossRepository: z.boolean(),
  merged: z.boolean(),
});
export type PullRequestHead = z.infer<typeof PullRequestHeadAnswer>;

// Bodies and closing references are not asked for: any writer can edit them, and the branch names the story
// (root ADR-0005 d3).
const STORY_PRS_QUERY = `query($owner: String!, $name: String!, $branch: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 100, after: $cursor) {
      nodes { number headRefName headRefOid isCrossRepository merged }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export function pickStoryPr(prs: readonly PullRequestHead[], branch: string): StoryPr | null {
  if (storyOf(branch) === null) return null;
  const sameRepo = prs.filter((pr) => pr.headRefName === branch && !pr.isCrossRepository);
  if (sameRepo.length === 0) return null;
  const newest = sameRepo.reduce((a, b) => (b.number > a.number ? b : a));
  return { number: newest.number, head: newest.headRefOid, merged: newest.merged };
}

export async function storyPr(reader: GitHubClient, repo: string, branch: string): Promise<StoryPr | null> {
  const where = ownerAndName(repo);
  // A branch that is no story has no story PR, so GitHub is not asked.
  if (storyOf(branch) === null) return null;
  const nodes = await reader.graphqlPages(STORY_PRS_QUERY, { ...where, branch }, ["repository", "pullRequests"]);
  return pickStoryPr(answerOf(z.array(PullRequestHeadAnswer), nodes, `the PRs on ${repo} ${branch}`), branch);
}

const ISSUE_BODY_SOURCE = "story issue body";

export async function requirement(tree: Tree, folder: string, issueBody: string): Promise<Requirement> {
  const path = `${folder}/spec.md`;
  const text = await tree.readText(path);
  let facts: SpecFacts;
  try {
    facts = readSpecFacts(text);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new DerivationError(`the requirement in ${folder}`, `${path}: ${reason}`, { cause: error });
  }
  if (facts.kind === SpecKind.enum.no_spec) return { kind: facts.kind, text: issueBody, source: ISSUE_BODY_SOURCE };
  return { kind: facts.kind, text, source: path };
}

// GitHub's type for a person; an App acts as a `Bot`, so its close never counts (P9).
const USER_TYPE = "User";
// `role_name`, not the legacy `permission`, which folds maintain into write and names no custom role.
const WRITER_ROLES: ReadonlySet<string> = new Set(["admin", "maintain", "write"]);

/** Done from history: a reopened issue keeps the merge or the admin close that made it done. */
export function doneFrom(prs: readonly { merged: boolean }[], closes: readonly IssueClose[]): boolean {
  return (
    prs.some((pr) => pr.merged) ||
    closes.some((close) => close.actorType === USER_TYPE && close.role !== null && WRITER_ROLES.has(close.role))
  );
}

const REPOSITORY_ID_QUERY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }`;

const RepositoryIdAnswer = z.object({ repository: z.object({ id: z.string() }) });

// The head branch is deleted on merge (orchestrator ADR-0009 d6), so a story's PRs are found from the issue's
// timeline; the branch grammar, not the reference, decides which of them are the story's.
const TIMELINE_QUERY = `query($owner: String!, $name: String!, $number: Int!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    issue(number: $number) {
      timelineItems(itemTypes: [CLOSED_EVENT, CROSS_REFERENCED_EVENT, CONNECTED_EVENT], first: 100, after: $cursor) {
        nodes {
          __typename
          ... on ClosedEvent { actor { __typename login } closer { __typename ...Candidate } }
          ... on CrossReferencedEvent { source { __typename ...Candidate } }
          ... on ConnectedEvent { subject { __typename ...Candidate } }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
}
fragment Candidate on PullRequest { number headRefName merged isCrossRepository repository { id } }`;

const PULL_REQUEST_TYPE = "PullRequest";

const CandidatePr = z.object({
  __typename: z.literal(PULL_REQUEST_TYPE),
  number: IssueNumber,
  headRefName: z.string(),
  merged: z.boolean(),
  isCrossRepository: z.boolean(),
  repository: z.object({ id: z.string() }),
});
type CandidatePr = z.infer<typeof CandidatePr>;

// A closer may be a commit or a project, and a reference an issue: none is a PR, so none is a candidate.
const Candidate = z.union([
  CandidatePr,
  z
    .object({ __typename: z.string().refine((type) => type !== PULL_REQUEST_TYPE, "a PullRequest without its fields") })
    .transform(() => null),
]);

const TimelineItem = z.discriminatedUnion("__typename", [
  z.object({
    __typename: z.literal("ClosedEvent"),
    actor: z.object({ __typename: z.string(), login: z.string() }).nullable(),
    closer: Candidate.nullable(),
  }),
  z.object({ __typename: z.literal("CrossReferencedEvent"), source: Candidate }),
  z.object({ __typename: z.literal("ConnectedEvent"), subject: Candidate }),
]);
type TimelineItem = z.infer<typeof TimelineItem>;

const PermissionAnswer = z.object({ role_name: z.string() });

function candidateOf(item: TimelineItem): CandidatePr | null {
  switch (item.__typename) {
    case "ClosedEvent":
      return item.closer;
    case "CrossReferencedEvent":
      return item.source;
    case "ConnectedEvent":
      return item.subject;
  }
}

async function roleOf(reader: GitHubClient, repo: Repository, login: string): Promise<string> {
  const collaborator = [repo.owner, repo.name, "collaborators", login].map(encodeURIComponent).join("/");
  const answer = await reader.rest("GET", `/repos/${collaborator}/permission`);
  return answerOf(PermissionAnswer, answer, `${login}'s role on ${repo.owner}/${repo.name}`).role_name;
}

export async function isDone(reader: GitHubClient, repo: string, s: number): Promise<boolean> {
  assertIssueNumber(s);
  const where = ownerAndName(repo);
  const idAnswer = await reader.graphql(REPOSITORY_ID_QUERY, where);
  const repositoryId = answerOf(RepositoryIdAnswer, idAnswer, `the id of ${repo}`).repository.id;
  const timeline = ["repository", "issue", "timelineItems"];
  const nodes = await reader.graphqlPages(TIMELINE_QUERY, { ...where, number: s }, timeline);
  const items = answerOf(z.array(TimelineItem), nodes, `the timeline of ${repo}#${s}`);

  const storyPrs = items
    .map(candidateOf)
    .filter(
      (pr): pr is CandidatePr =>
        pr !== null && pr.repository.id === repositoryId && !pr.isCrossRepository && storyOf(pr.headRefName) === s,
    );
  const closes = await Promise.all(
    items.flatMap((item) => (item.__typename === "ClosedEvent" ? [item.actor] : [])).map(
      async (actor): Promise<IssueClose> => ({
        actorType: actor?.__typename ?? null,
        role: actor?.__typename === USER_TYPE ? await roleOf(reader, where, actor.login) : null,
      }),
    ),
  );
  return doneFrom(storyPrs, closes);
}
