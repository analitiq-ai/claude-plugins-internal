import { needsMint, readGhToken, REFRESH_MARGIN_MS } from "../core/gh-config.ts";
import { runGit } from "../core/git.ts";
import { repositoryOfRemote, type GitHubClient, type Repository } from "../core/github.ts";
import { ghFolder } from "./settings.ts";

/** The checkout has no `origin`, so it names no repository for planner to act on. */
export class NoOrigin extends Error {
  constructor(checkout: string) {
    super(`${checkout} has no remote origin, so it names no GitHub repository for planner`);
    this.name = "NoOrigin";
  }
}

/** The GitHub repository the checkout's origin names; the hook and every script act on this one. */
export async function originRepository(checkout: string): Promise<Repository> {
  // git exits 2 for a remote the checkout does not have.
  const { code, stdout } = await runGit(checkout, ["remote", "get-url", "origin"], [2]);
  if (code === 2) throw new NoOrigin(checkout);
  return repositoryOfRemote(stdout.trim());
}

/** Planner's stored token is missing, is another repository's, or expires within the margin; only the hook mints. */
export class StaleToken extends Error {
  constructor(repo: Repository, folder: string) {
    super(
      `planner's token for ${repo.owner}/${repo.name} in ${folder} is missing or expires within ` +
        `${REFRESH_MARGIN_MS / 60_000} minutes. Next step: run this from a Bash call of a planner session, ` +
        "before which planner's hook (hooks/token.ts) mints it",
    );
    this.name = "StaleToken";
  }
}

/** A client acting as the planner App with the token the hook stored for `repo`; a script never mints (R6). */
export function plannerGitHub(repo: Repository, connect: (token: string) => GitHubClient, now: Date): GitHubClient {
  const folder = ghFolder(repo);
  const stored = readGhToken(folder);
  if (stored === null || needsMint(stored, `${repo.owner}/${repo.name}`, now)) throw new StaleToken(repo, folder);
  return connect(stored.value);
}
