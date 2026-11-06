import { isAbsolute, join } from "node:path";

import { sessionFolder, type Session } from "../../core/commit-pass.ts";
import type { Gates } from "../../core/contracts/gates.ts";
import { makePrivateFolder } from "../../core/files.ts";
import { GitFailed, runGit } from "../../core/git.ts";
import { GitHubRefused, type GitHubClient, type Repository } from "../../core/github.ts";
import { sectionWithoutAnchor } from "../rules/anchor.ts";

const COPY = "repo.git";

// GitHub answers 422 for a sha no commit of the repository has; its 404 is for a repository the token cannot see, so
// it says nothing of the commit.
const NO_SUCH_COMMIT = 422;

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

/** Takes commit `sha` from the model's clone into the copy's own refs, by a fetch that writes nothing in the clone (ADR-0021 d6). */
export async function fetchFromClone(copy: string, clone: string, sha: string): Promise<void> {
  // git reads a relative path with a colon in it as an ssh host.
  if (!isAbsolute(clone)) throw new TypeError(`the model's clone is not an absolute path: ${JSON.stringify(clone)}`);
  await runGit(copy, ["fetch", "--quiet", "--no-tags", "--end-of-options", clone, anchorRefspec(sha)]);
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
 * Asks GitHub for commit `sha` of `repo` and, when it has it, takes it into the copy's own ref through `fetchRefspecs`.
 * False for a commit GitHub lacks; any other refusal is no answer and is thrown.
 */
export function fromGitHub(reader: GitHubClient, repo: Repository, fetchRefspecs: (refspecs: readonly string[]) => Promise<void>): (sha: string) => Promise<boolean> {
  return async (sha) => {
    try {
      await reader.rest("GET", `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}/commits/${sha}`);
    } catch (error) {
      if (error instanceof GitHubRefused && error.status === NO_SUCH_COMMIT) return false;
      throw error;
    }
    await fetchRefspecs([anchorRefspec(sha)]);
    return true;
  };
}

/**
 * Where a check looks for the gates' anchor, in this order. `clone` takes the commit into the copy or fails with
 * GitFailed; `github` is true once it took the commit into the copy.
 */
export type AnchorSources = { copy: string; clone: (sha: string) => Promise<void>; github: (sha: string) => Promise<boolean> };

/**
 * `gates`, once the copy holds its anchor: from the copy, else fetched by its sha from the model's clone, else from
 * GitHub (contracts/gates-snapshot.md §Anchor). When none has it, the section the anchor rule leaves, or AnchorMissing.
 */
export async function anchoredSection({ copy, clone, github }: AnchorSources, gates: Gates, head: string, reset: string | null): Promise<Gates> {
  if (await holdsCommit(copy, gates.anchor)) return gates;
  const cloneFailure = await clone(gates.anchor).then(
    () => null,
    (error: unknown) => {
      if (error instanceof GitFailed) return error;
      throw error;
    },
  );
  if (cloneFailure === null || (await github(gates.anchor))) return gates;
  return sectionWithoutAnchor(gates, head, reset, cloneFailure);
}
