import { GhFolderRefused, needsMint, readGhToken } from "../core/gh-config.ts";
import type { GitHubClient } from "../core/github.ts";
import { ghFolder } from "../core/orchestrator-paths.ts";
import type { mintToken } from "../core/tokens.ts";
import { CouldNotRun, orCouldNotRun } from "./hook-io.ts";

export type Connect = (token: string) => GitHubClient;

function storedToken(folder: string) {
  try {
    return readGhToken(folder);
  } catch (error) {
    if (!(error instanceof GhFolderRefused)) throw error;
    // The orchestrator refuses on the same folder; once it is gone, the orchestrator's next Bash call mints the token.
    throw new CouldNotRun(`the session token cannot be read: ${error.message}`, `remove ${folder} and retry the step`, { cause: error });
  }
}

// The orchestrator's hooks mint the session token on a prompt and a Bash call, when core's needsMint says it must.
const AFTER_SESSION_MINT = "make a Bash call or send a prompt, on which the orchestrator mints the session token, then retry the step";

/** The session App's client, on the token the orchestrator's hooks keep in its gh folder, refused by their rule. */
export function sessionReader({ home, repo, now, connect }: { home: string; repo: string; now: Date; connect: Connect }): GitHubClient {
  const folder = ghFolder(home);
  const stored = storedToken(folder);
  // Claude Code runs the plugins' hooks on one call side by side, so the orchestrator's mint may not have landed yet.
  if (stored === null || needsMint(stored, repo, now)) {
    throw new CouldNotRun(`${folder} holds no session token for ${repo} that outlasts core's refresh margin`, AFTER_SESSION_MINT);
  }
  return connect(stored.value);
}

export type WriterDeps = { mintToken: typeof mintToken; connect: Connect };

/**
 * The reviewer App's client on `repo`, minted when a write first asks and shared by the run's later writes. Its
 * token lives in this closure only, never on disk, so no run writes with another's.
 */
export function reviewerWriter(repo: string, appId: number, deps: WriterDeps): () => Promise<GitHubClient> {
  let minting: Promise<GitHubClient> | null = null;
  function mint(): Promise<GitHubClient> {
    const minted = deps.mintToken("reviewer", appId, "reviewer-app.pem", "reviewer", repo).then((token) => deps.connect(token.value));
    return orCouldNotRun(minted, `the reviewer App's token for ${repo} was not minted`);
  }
  return () => (minting ??= mint());
}
