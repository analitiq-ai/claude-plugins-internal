import { basename, dirname, join } from "node:path";
import { z } from "zod";

import { governingDiff, treeListing } from "./attest.ts";
import { laneOf } from "./board.ts";
import { commitOf, mainCheckout, originRepository, runGit, trackingRef, trackingRefspec } from "./git.ts";
import { answerOf, assertIssueNumber, ownerAndName, repositoryPath, type GitHubClient } from "./github.ts";
import {
  defaultBranch,
  DerivationError,
  isDone,
  issueStory,
  pickStoryBranch,
  readSpecFolder,
  specIssue,
  specPrs,
  type IssueStory,
  type MergedSpecPr,
  type SpecFolderRead,
} from "./identity.ts";
import { sessionsFolder } from "./orchestrator-paths.ts";
import { readSessionRecord } from "./session-record.ts";
import { readSettings } from "./settings.ts";
import { storyStop, type HeadVsPr, type MergeNeed, type StoryStopFacts, type StoryWorktree } from "./story-stop.ts";
import { gitTree } from "./tree.ts";

export type StoryStopReaders = {
  /** A reading client: nothing here writes to GitHub (root ADR-0008 d4). */
  reader: GitHubClient;
  /** The home folder the orchestrator's session records are under. */
  home: string;
  /** The session's working checkout: the settings are read at its HEAD, and the main checkout is found from it (R16). */
  checkout: string;
  /** Fetches each refspec from the checkout's origin repository on GitHub, over the caller's transport. */
  fetch: (refspecs: readonly string[]) => Promise<void>;
};

export type StoryStopRead = { facts: StoryStopFacts; main: string };

const IssueAnswer = z.object({ state: z.enum(["open", "closed"]), title: z.string(), body: z.string().nullable() });

/**
 * The facts `storyStop` decides from, and the main checkout. Makes no local branch or worktree and writes no index
 * (R16).
 */
export async function readStoryStopFacts(s: number, sessionId: string, { reader, home, checkout, fetch }: StoryStopReaders): Promise<StoryStopRead> {
  assertIssueNumber(s);
  const record = readSessionRecord(sessionsFolder(home), sessionId);
  const [origin, main] = await Promise.all([originRepository(checkout), mainCheckout(checkout)]);
  const facts: StoryStopFacts = { story: s, session: record === null ? null : { repo: record.repo, issue: record.issue }, origin };
  const read: StoryStopRead = { facts, main };
  const stopped = () => storyStop(facts) !== null;
  if (stopped()) return read;
  const repo = origin;

  const { shared } = await readSettings(gitTree(checkout, "HEAD"));
  facts.shared = shared;
  const base = await defaultBranch(reader, repo);
  await fetch([trackingRefspec(base)]);
  const tip = await commitOf(main, trackingRef(base));

  const issue = await issueOf(reader, repo, s);
  facts.issue = { state: issue.state, title: issue.title, body: issue.body ?? "" };
  facts.done = await isDone(reader, repo, s);
  if (stopped()) return read;
  facts.lane = await laneOf(reader, repo, s, shared.board);
  if (stopped()) return read;
  // specIssue throws DerivationError only for a parent in another repository, and the story-branch reads only for
  // several branches: each is a fact the stop rule names, not a read that failed.
  let p: number;
  try {
    p = await specIssue(reader, repo, s);
  } catch (error) {
    if (!(error instanceof DerivationError)) throw error;
    facts.spec = { elsewhere: error.found };
    return read;
  }
  facts.spec = p;

  let story: IssueStory | null;
  let local: string | null;
  try {
    story = await issueStory(reader, repo, s);
    local = pickStoryBranch(await localBranches(main, s), s);
  } catch (error) {
    if (!(error instanceof DerivationError)) throw error;
    facts.branch = { several: error.found };
    return read;
  }
  const github = story?.branch ?? null;
  facts.branch = { github, local };
  facts.pr = story?.pr ?? null;
  if (stopped()) return read;
  // So the PR head, and the branch the worktree would start from, are known locally.
  if (github !== null) await fetch([trackingRefspec(github)]);
  const branch = github ?? local;
  facts.worktree = branch === null ? null : await worktreeOf(main, branch);
  if (stopped() || facts.worktree?.mergeInProgress === true) return read;

  // The head the work is on (R16 step 5): the worktree's, or the ref `git worktree add` would start it from (R8).
  const at = facts.worktree?.path ?? main;
  const head = await commitOf(at, facts.worktree === null ? (local ?? trackingRef(github ?? base)) : "HEAD");
  facts.head = head;
  if (facts.pr !== null && !facts.pr.closed) facts.headVsPr = await headVsPr(at, head, facts.pr.head);
  if (stopped()) return read;

  const folder = await readSpecFolder(gitTree(at, head), p);
  facts.merge = await mergeNeed(reader, repo, p, { at, base, tip, head, folder });
  if (facts.merge.needed) return read;
  facts.folder = folder;
  return read;
}

async function issueOf(reader: GitHubClient, repo: string, s: number): Promise<z.infer<typeof IssueAnswer>> {
  const answer = await reader.rest("GET", `${repositoryPath(ownerAndName(repo))}/issues/${s}`);
  return answerOf(IssueAnswer, answer, `${repo}#${s}`);
}

async function localBranches(main: string, s: number): Promise<string[]> {
  const { stdout } = await runGit(main, ["branch", "--list", "--format=%(refname:short)", `${s}-us*`]);
  return stdout.split("\n").filter((name) => name !== "");
}

const HEADS = "refs/heads/";

/** The worktree at the story branch's path beside the main checkout, or null when git lists none there. */
async function worktreeOf(main: string, branch: string): Promise<StoryWorktree | null> {
  const path = join(dirname(main), `${basename(main)}.worktrees`, branch);
  const listed = worktreeBranches((await runGit(main, ["worktree", "list", "--porcelain", "-z"])).stdout);
  if (!listed.has(path)) return null;
  const merging = await runGit(path, ["rev-parse", "--quiet", "--verify", "MERGE_HEAD"], [1]);
  // No optional lock, so the read refreshes no index. Without renames every entry is `XY <path>`: a rename is
  // listed as its deletion and its addition.
  const status = await runGit(path, ["--no-optional-locks", "status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
  const dirty = status.stdout.split("\0").filter((entry) => entry !== "").map((entry) => entry.slice(3));
  return { path, branch: listed.get(path) ?? null, mergeInProgress: merging.code === 0, dirty };
}

/** Each listed worktree's path and its branch, null for a detached HEAD. */
function worktreeBranches(porcelain: string): Map<string, string | null> {
  const branches = new Map<string, string | null>();
  let path: string | null = null;
  for (const line of porcelain.split("\0")) {
    if (line.startsWith("worktree ")) {
      path = line.slice("worktree ".length);
      branches.set(path, null);
    } else if (line.startsWith("branch ") && path !== null) {
      const ref = line.slice("branch ".length);
      branches.set(path, ref.startsWith(HEADS) ? ref.slice(HEADS.length) : ref);
    }
  }
  return branches;
}

// Exit 1 is "not an ancestor"; any other failure, such as a commit git does not hold, throws.
async function isAncestor(at: string, ancestor: string, of: string): Promise<boolean> {
  return (await runGit(at, ["merge-base", "--is-ancestor", ancestor, of], [1])).code === 0;
}

async function headVsPr(at: string, head: string, prHead: string): Promise<HeadVsPr> {
  if (head === prHead) return "same";
  if (await isAncestor(at, prHead, head)) return "ahead";
  if (await isAncestor(at, head, prHead)) return "behind";
  return "diverged";
}

function foldersOf(read: SpecFolderRead): readonly string[] {
  if ("one" in read) return [read.one];
  if ("several" in read) return read.several;
  return [];
}

type MergeAt = { at: string; base: string; tip: string; head: string; folder: SpecFolderRead };

/** Whether the default tip must be merged into the head before the folder is decided (R9, builder ADR-0004 d1-d2). */
async function mergeNeed(reader: GitHubClient, repo: string, p: number, { at, base, tip, head, folder }: MergeAt): Promise<MergeNeed> {
  if (await isAncestor(at, tip, head)) return { needed: false, why: [] };
  const why: string[] = [];

  const merged = (await specPrs(reader, repo, p)).find((pr): pr is MergedSpecPr => pr.state === "merged");
  if (merged !== undefined && !(await isAncestor(at, merged.mergeCommit.oid, head))) {
    why.push(`spec PR #${merged.number}'s merge commit ${merged.mergeCommit.oid} is not in ${head}'s history`);
  }

  // Both sides' folders, so a spec.md that one side holds and the other lacks is a difference.
  const folders = [...new Set([...foldersOf(await readSpecFolder(gitTree(at, tip), p)), ...foldersOf(folder)])];
  const [atTip, atHead] = await Promise.all([treeListing(at, tip), treeListing(at, head)]);
  for (const path of governingDiff(atTip, atHead, folders)) why.push(`${path} differs between ${base} and ${head}`);

  const merging = await runGit(at, ["merge-tree", "--write-tree", "--name-only", "--no-messages", tip, head], [1]);
  if (merging.code === 1) {
    const conflicted = merging.stdout.split("\n").slice(1).filter((path) => path !== "");
    why.push(`${base} conflicts with ${head} in ${conflicted.join(", ")}`);
  }
  return { needed: why.length > 0, why };
}
