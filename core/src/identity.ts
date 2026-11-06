import { z } from "zod";

import { GitSha } from "./contracts/scalars.ts";
import { readSpecFacts, SpecKind, type SpecFacts } from "./contracts/spec-facts.ts";
import {
  answerOf,
  assertIssueNumber,
  assertPositiveInteger,
  isWriterRole,
  ownerAndName,
  repositoryPath,
  roleOf,
  USER_TYPE,
  type GitHubClient,
  type Repository,
} from "./github.ts";
import { NotInTree, type Tree, type TreeEntry } from "./tree.ts";

export type StoryBranch = { story: number; k: number; slug: string };
export type SpecBranch = { spec: number };

/** A same-repository PR on `<p>-spec`; a merged PR is closed too, and reads `merged`. */
export type SpecPr = { number: number; state: "open" | "closed"; mergeCommit: null } | MergedSpecPr;
export type MergedSpecPr = { number: number; state: "merged"; mergeCommit: { oid: string } };

export type SpecFolderAnswer = { one: string } | { none: true } | { several: readonly string[] };

/** A spec folder answer that tells a ref with no `specs/` apart from one with no folder for `p`. */
export type SpecFolderRead = SpecFolderAnswer | { noSpecs: true };

/** The story's PR: `head` is its head commit; a merged PR is closed too. */
export type StoryPr = { number: number; head: string; closed: boolean; merged: boolean };

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

const SLUG_RUN = "[a-z0-9]+";
// Issue numbers have no leading zero, so `0212-…` is no story.
const STORY_BRANCH = new RegExp(`^([1-9][0-9]*)-us([1-9][0-9]*)-(${SLUG_RUN}(?:-${SLUG_RUN})*)$`);
const SPEC_BRANCH = /^([1-9][0-9]*)-spec$/;
// Matched after lowering, never with `iu`: under `iu` `ſ` matches `[a-z]`, and lowering leaves it `ſ`.
const SLUG_RUNS = new RegExp(SLUG_RUN, "g");
const SLUG_MAX = 40;
const EMPTY_SLUG = "story";

export function parseBranch(name: string): StoryBranch | SpecBranch | null {
  const story = STORY_BRANCH.exec(name);
  if (story !== null) return { story: Number(story[1]), k: Number(story[2]), slug: story[3] };
  const spec = SPEC_BRANCH.exec(name);
  if (spec !== null) return { spec: Number(spec[1]) };
  return null;
}

/** The title is untrusted, and the name becomes a ref and a worktree path. */
export function storyBranchName(s: number, k: number, title: string): string {
  assertIssueNumber(s);
  assertPositiveInteger(k, "a US<k> story index");
  const runs = title.toLowerCase().match(SLUG_RUNS) ?? [];
  // Runs are joined by single `-`, so a cut can end on one `-` at most.
  const slug = runs.join("-").slice(0, SLUG_MAX).replace(/-$/, "");
  return `${s}-us${k}-${slug || EMPTY_SLUG}`;
}

export function specBranch(p: number): string {
  assertIssueNumber(p);
  return `${p}-spec`;
}

function storyOf(branch: string): number | null {
  const parsed = parseBranch(branch);
  return parsed !== null && "story" in parsed ? parsed.story : null;
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

/** The folders of `specs/` named `<p>-*`, as paths from the root: none, one, or several to choose between. */
export function specFolderAnswer(names: readonly string[], p: number): SpecFolderAnswer {
  assertIssueNumber(p);
  const matching = names.filter((name) => name.startsWith(`${p}-`)).map((name) => `specs/${name}`);
  if (matching.length === 0) return { none: true };
  if (matching.length === 1) return { one: matching[0] };
  return { several: matching };
}

export function pickSpecFolder(names: readonly string[], p: number): string {
  const answer = specFolderAnswer(names, p);
  if ("one" in answer) return answer.one;
  const found =
    "several" in answer
      ? answer.several.map((path) => `${path}/`).join(", ")
      : `no specs/${p}-*/ among ${names.length === 0 ? "no folders" : names.join(", ")}`;
  throw new DerivationError(`the spec folder of #${p}`, found);
}

// The folders under specs/, or the NotInTree that says the ref has no specs/.
async function specsFolders(tree: Tree): Promise<string[] | NotInTree> {
  let entries: TreeEntry[];
  try {
    entries = await tree.listDir("specs");
  } catch (error) {
    if (!(error instanceof NotInTree)) throw error;
    return error;
  }
  return entries.filter((entry) => entry.isDir).map((entry) => entry.name);
}

export async function readSpecFolder(tree: Tree, p: number): Promise<SpecFolderRead> {
  const names = await specsFolders(tree);
  return names instanceof NotInTree ? { noSpecs: true } : specFolderAnswer(names, p);
}

export async function specFolder(tree: Tree, p: number): Promise<string> {
  const names = await specsFolders(tree);
  // A ref with no specs/ holds no spec folder, so it is a DerivationError, as pickSpecFolder's for a specs/ with none.
  if (names instanceof NotInTree) {
    throw new DerivationError(`the spec folder of #${p}`, `no specs/ folder (${names.message})`, { cause: names });
  }
  return pickSpecFolder(names, p);
}

const PullRequestHeadAnswer = z.object({
  number: IssueNumber,
  headRefName: z.string(),
  headRefOid: GitSha,
  isCrossRepository: z.boolean(),
  closed: z.boolean(),
  merged: z.boolean(),
});
export type PullRequestHead = z.infer<typeof PullRequestHeadAnswer>;

const PullRequestStateAnswer = z
  .object({
    number: IssueNumber,
    headRefName: z.string(),
    isCrossRepository: z.boolean(),
    closed: z.boolean(),
    merged: z.boolean(),
    mergeCommit: z.object({ oid: GitSha }).nullable(),
  })
  .refine((pr) => (pr.mergeCommit !== null) === pr.merged, { path: ["mergeCommit"], message: "a PR holds a merge commit once merged, and only then" });
export type PullRequestState = z.infer<typeof PullRequestStateAnswer>;

// Bodies and closing references are not asked for: any writer can edit them, and the branch names the story
// (root ADR-0005 d3). One query serves a story's PR and a spec's, each reading the fields it needs.
const PRS_ON_BRANCH_QUERY = `query($owner: String!, $name: String!, $branch: String!, $cursor: String) {
  repository(owner: $owner, name: $name) {
    pullRequests(headRefName: $branch, first: 100, after: $cursor) {
      nodes { number headRefName headRefOid isCrossRepository closed merged mergeCommit { oid } }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

function prsOnBranch(reader: GitHubClient, where: Repository, branch: string): Promise<unknown[]> {
  return reader.graphqlPages(PRS_ON_BRANCH_QUERY, { ...where, branch }, ["repository", "pullRequests"]);
}

// A fork's PR may share the branch name; it is never the repository's own.
function sameRepoNewestFirst<Pr extends { number: number; headRefName: string; isCrossRepository: boolean }>(
  prs: readonly Pr[],
  branch: string,
): Pr[] {
  return prs.filter((pr) => pr.headRefName === branch && !pr.isCrossRepository).sort((a, b) => b.number - a.number);
}

export function pickStoryPr(prs: readonly PullRequestHead[], branch: string): StoryPr | null {
  if (storyOf(branch) === null) return null;
  const [newest] = sameRepoNewestFirst(prs, branch);
  return newest === undefined ? null : { number: newest.number, head: newest.headRefOid, closed: newest.closed, merged: newest.merged };
}

export async function storyPr(reader: GitHubClient, repo: string, branch: string): Promise<StoryPr | null> {
  const where = ownerAndName(repo);
  // A branch that is no story has no story PR, so GitHub is not asked.
  if (storyOf(branch) === null) return null;
  const nodes = await prsOnBranch(reader, where, branch);
  return pickStoryPr(answerOf(z.array(PullRequestHeadAnswer), nodes, `the PRs on ${repo} ${branch}`), branch);
}

/** A story's branch on GitHub and its PR; `pr` is null until one is opened from the branch. */
export type IssueStory = { branch: string; pr: StoryPr | null };

// `<k>` is never checked (root ADR-0005 d1), so two branches of one story leave none to pick, whatever their `<k>`.
export function pickStoryBranch(names: readonly string[], s: number): string | null {
  assertIssueNumber(s);
  const branches = names.filter((name) => storyOf(name) === s);
  if (branches.length > 1) throw new DerivationError(`the story branch of #${s}`, branches.join(", "));
  return branches[0] ?? null;
}

const HEADS = "refs/heads/";

const BranchRef = z.object({ ref: z.string().startsWith(HEADS) }).transform(({ ref }) => ref.slice(HEADS.length));

/** Null when GitHub holds no branch of the story: before its first push, or once its merge deleted it. */
export async function issueStory(reader: GitHubClient, repo: string, s: number): Promise<IssueStory | null> {
  assertIssueNumber(s);
  // Every branch the grammar gives `s` starts `<s>-us`, so a prefix read misses none; the grammar picks among them.
  const refs = await reader.restPages(`${repositoryPath(ownerAndName(repo))}/git/matching-refs/heads/${s}-us`);
  const branch = pickStoryBranch(answerOf(z.array(BranchRef), refs, `the branches of ${repo} starting ${s}-us`), s);
  if (branch === null) return null;
  return { branch, pr: await storyPr(reader, repo, branch) };
}

export function pickSpecPrs(prs: readonly PullRequestState[], p: number): SpecPr[] {
  // The answer's refine ties mergeCommit to merged.
  return sameRepoNewestFirst(prs, specBranch(p)).map(({ number, closed, mergeCommit }) =>
    mergeCommit === null ? { number, state: closed ? "closed" : "open", mergeCommit } : { number, state: "merged", mergeCommit },
  );
}

/** Every spec PR of `p`, newest first. */
export async function specPrs(reader: GitHubClient, repo: string, p: number): Promise<SpecPr[]> {
  const branch = specBranch(p);
  const nodes = await prsOnBranch(reader, ownerAndName(repo), branch);
  return pickSpecPrs(answerOf(z.array(PullRequestStateAnswer), nodes, `the PRs on ${repo} ${branch}`), p);
}

export async function specPr(reader: GitHubClient, repo: string, p: number): Promise<SpecPr | null> {
  return (await specPrs(reader, repo, p))[0] ?? null;
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

/** Done from history: a reopened issue keeps the merge or the admin close that made it done. */
export function doneFrom(prs: readonly { merged: boolean }[], closes: readonly IssueClose[]): boolean {
  return (
    prs.some((pr) => pr.merged) ||
    closes.some((close) => close.actorType === USER_TYPE && close.role !== null && isWriterRole(close.role))
  );
}

const REPOSITORY_ID_QUERY = `query($owner: String!, $name: String!) { repository(owner: $owner, name: $name) { id } }`;

const RepositoryIdAnswer = z.object({ repository: z.object({ id: z.string() }) });

/** What a node's `repository { id }` is compared with: a name can differ in case or follow a rename, an id cannot. */
export async function repositoryId(reader: GitHubClient, repo: string): Promise<string> {
  const answer = await reader.graphql(REPOSITORY_ID_QUERY, ownerAndName(repo));
  return answerOf(RepositoryIdAnswer, answer, `the id of ${repo}`).repository.id;
}

const RepositoryAnswer = z.object({ default_branch: z.string().min(1) });

export async function defaultBranch(reader: GitHubClient, repo: string): Promise<string> {
  const answer = await reader.rest("GET", repositoryPath(ownerAndName(repo)));
  return answerOf(RepositoryAnswer, answer, `the default branch of ${repo}`).default_branch;
}

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

export async function isDone(reader: GitHubClient, repo: string, s: number): Promise<boolean> {
  assertIssueNumber(s);
  const where = ownerAndName(repo);
  const ownId = await repositoryId(reader, repo);
  const timeline = ["repository", "issue", "timelineItems"];
  const nodes = await reader.graphqlPages(TIMELINE_QUERY, { ...where, number: s }, timeline);
  const items = answerOf(z.array(TimelineItem), nodes, `the timeline of ${repo}#${s}`);

  const storyPrs = items
    .map(candidateOf)
    .filter(
      (pr): pr is CandidatePr =>
        pr !== null && pr.repository.id === ownId && !pr.isCrossRepository && storyOf(pr.headRefName) === s,
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
