import { needsMint, readGhToken, writeGhToken } from "../core/gh-config.ts";
import { runGit } from "../core/git.ts";
import { repositoryOfRemote } from "../core/github.ts";
import type { mintToken } from "../core/tokens.ts";
import { ghFolder } from "./paths.ts";
import type { OnGitHub } from "./settings.ts";

/** The GitHub repository the checkout's origin names, the one repository the session's token is for. */
export async function originRepository(checkout: string): Promise<string> {
  const { stdout } = await runGit(checkout, ["remote", "get-url", "origin"]);
  const { owner, name } = repositoryOfRemote(stdout.trim());
  return `${owner}/${name}`;
}

export type SessionTokenDeps = {
  home: string;
  mintToken: typeof mintToken;
  onGitHub: () => Promise<OnGitHub>;
};

/**
 * Mints the session App's token for `repo` into the gh folder the session's `gh` and git read, unless the stored one
 * is for `repo` with core's margin left (FR-010, FR-011); only then are settings read, so most calls touch no network.
 */
export async function ensureSessionToken(repo: string, now: Date, deps: SessionTokenDeps): Promise<void> {
  const folder = ghFolder(deps.home);
  if (!needsMint(readGhToken(folder), repo, now)) return;
  const { settled } = await deps.onGitHub();
  const token = await deps.mintToken("session", settled.orchestrator.session_app_id, "session-app.pem", "orchestrator", repo);
  writeGhToken(folder, token, settled.shared.session_app_login);
}
