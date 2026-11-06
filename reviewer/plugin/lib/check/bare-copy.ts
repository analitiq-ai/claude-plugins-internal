import { isAbsolute, join } from "node:path";

import { sessionFolder, type Session } from "../../core/commit-pass.ts";
import type { Gates } from "../../core/contracts/gates.ts";
import { makePrivateFolder } from "../../core/files.ts";
import { GhCredentialRefused, GitFailed, runGit } from "../../core/git.ts";
import { failureOfStatus, GitHubRefused, GitHubUnanswered, type GitHubClient, type Repository } from "../../core/github.ts";
import { sectionWithoutAnchor } from "../rules/anchor.ts";

const COPY = "repo.git";

// GitHub answers 422 for a sha no commit of the repository has; its 404 is for a repository the token cannot see, so
// it says nothing of the commit.
const NO_SUCH_COMMIT = 422;

// upload-pack's refusal of a want of an object its repository lacks; git does not translate it.
const CLONE_LACKS = "upload-pack: not our ref";

// How git names the HTTP status of an answer it does not take, in words it prints untranslated.
const HTTP_STATUS = /The requested URL returned error: (\d{3})/;

const reasonOf = (failure: unknown): string => (failure instanceof GitFailed ? failure.stderr.trim() : String(failure));

/** The fetch of an object from the model's clone failed, and not because the clone lacks it. */
export class CloneFetchFailed extends Error {
  constructor(clone: string, sha: string, failure: unknown) {
    super(`the fetch of ${sha} from the model's clone ${clone} failed: ${reasonOf(failure)}`, { cause: failure });
    this.name = "CloneFetchFailed";
  }
}

function anchorRefspec(sha: string): string {
  return `${sha}:refs/anchors/${sha}`;
}

/** The session's bare copy (R13), made on first use; making it again repairs a copy a killed run left half made. */
export async function bareCopy(session: Session): Promise<string> {
  const folder = sessionFolder(session);
  makePrivateFolder(folder);
  await runGit(folder, ["init", "--quiet", "--bare", COPY]);
  return join(folder, COPY);
}

export async function holdsCommit(copy: string, sha: string): Promise<boolean> {
  const { code } = await runGit(copy, ["rev-parse", "--verify", "--quiet", "--end-of-options", `${sha}^{commit}`], [1]);
  return code === 0;
}

/**
 * Fetches object `sha` from the model's clone into the copy's own refs, by a fetch that writes nothing in the clone and
 * is the only git command run in it (ADR-0021 d6). False when the clone answers that it lacks the object;
 * CloneFetchFailed for every other failure of the fetch. TypeError, before any fetch, for a `clone` that is no absolute path.
 */
export async function fetchFromClone(copy: string, clone: string, sha: string): Promise<boolean> {
  // git reads a relative path with a colon in it as an ssh host.
  if (!isAbsolute(clone)) throw new TypeError(`the model's clone is not an absolute path: ${JSON.stringify(clone)}`);
  try {
    await runGit(copy, ["fetch", "--quiet", "--no-tags", "--end-of-options", clone, anchorRefspec(sha)]);
    return true;
  } catch (error) {
    if (error instanceof GitFailed && error.stderr.includes(`${CLONE_LACKS} ${sha}`)) return false;
    throw new CloneFetchFailed(clone, sha, error);
  }
}

/**
 * The text of the blob at path `file` in commit `sha` of the copy, as git diffs it: a symlink's is its target. Null when
 * the commit has no blob there (no entry, a folder, a submodule); GitFailed when the copy lacks the commit.
 */
export async function fileAt(copy: string, sha: string, file: string): Promise<string | null> {
  const { stdout } = await runGit(copy, ["ls-tree", "-z", "--end-of-options", sha, "--", file]);
  const entry = stdout
    .split("\0")
    .map((line) => line.split("\t"))
    .find(([, path]) => path === file);
  const [, type, blob] = entry?.[0].split(" ") ?? [];
  if (type !== "blob") return null;
  return (await runGit(copy, ["cat-file", "blob", blob])).stdout;
}

/**
 * The failure of the fetch of `sha` from GitHub's `repo`: `failureOfStatus` of the HTTP status git names, without the
 * headers git does not print, so a 403 that limits the rate refuses; GitHubUnanswered when git names no status.
 * GhCredentialRefused is the checkout's, not GitHub's, and stays as it is.
 */
function gitHubFetchFailure(repo: Repository, sha: string, failure: unknown): unknown {
  if (failure instanceof GhCredentialRefused) return failure;
  const message = `the fetch of commit ${sha} from GitHub ${repo.owner}/${repo.name} failed: ${reasonOf(failure)}`;
  const status = failure instanceof GitFailed ? HTTP_STATUS.exec(failure.stderr)?.[1] : undefined;
  return status === undefined ? new GitHubUnanswered(message, { cause: failure }) : failureOfStatus(Number(status), message);
}

/**
 * Asks GitHub for commit `sha` of `repo` and, when it has it, fetches it into the copy's own ref through `fetchRefspecs`.
 * False when GitHub answers that no commit of the repository has the sha; the read's other failures are thrown as the
 * client throws them, the fetch's as `gitHubFetchFailure` makes them.
 */
export function fromGitHub(reader: GitHubClient, repo: Repository, fetchRefspecs: (refspecs: readonly string[]) => Promise<void>): (sha: string) => Promise<boolean> {
  return async (sha) => {
    try {
      await reader.rest("GET", `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits/${sha}`);
    } catch (error) {
      if (error instanceof GitHubRefused && error.status === NO_SUCH_COMMIT) return false;
      throw error;
    }
    try {
      await fetchRefspecs([anchorRefspec(sha)]);
    } catch (error) {
      throw gitHubFetchFailure(repo, sha, error);
    }
    return true;
  };
}

/**
 * Where a check looks for the gates' anchor, in this order. `clone` and `github` fetch an object by its sha into the
 * copy: true once git took it, false only on the source's word that it lacks it, and thrown for anything else, since a
 * false from both is taken as the anchor being gone.
 */
export type AnchorSources = { copy: string; clone: (sha: string) => Promise<boolean>; github: (sha: string) => Promise<boolean> };

/**
 * `gates`, once the copy holds its anchor as a commit: already, else fetched by its sha from the model's clone, else from
 * GitHub (contracts/gates-snapshot.md §Anchor). When none has it, the section the anchor rule leaves, or AnchorMissing.
 */
export async function anchoredSection({ copy, clone, github }: AnchorSources, gates: Gates, head: string, reset: string | null): Promise<Gates> {
  const { anchor } = gates;
  if (await holdsCommit(copy, anchor)) return gates;
  for (const source of [clone, github]) if ((await source(anchor)) && (await holdsCommit(copy, anchor))) return gates;
  return sectionWithoutAnchor(gates, head, reset);
}
