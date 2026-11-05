import { GhFolderRefused, readGhToken } from "../core/gh-config.ts";
import { GitHubRefused, GitHubUnanswered, type GitHubClient } from "../core/github.ts";
import { KeyReadRefused } from "../core/keys.ts";
import { ghFolder } from "../core/orchestrator-paths.ts";
import { MintError, type mintToken } from "../core/tokens.ts";
import { CouldNotRun, FIX_THEN_RETRY, RETRY } from "./hook-io.ts";

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

/** The session App's client, on the token the orchestrator's hooks keep in its gh folder. */
export function sessionReader({ home, connect }: { home: string; connect: Connect }): GitHubClient {
  const folder = ghFolder(home);
  const stored = storedToken(folder);
  // Claude Code runs the plugins' hooks on one call side by side, so the orchestrator's mint may not have landed yet.
  if (stored === null) throw new CouldNotRun(`${folder} holds no session token`, RETRY);
  return connect(stored.value);
}

// The next step after a mint core names as failed: an unanswered call may pass on a later run, the others hold until
// what they name is fixed. Null for anything else, which fails the hook.
function nextAfterMint(error: unknown): string | null {
  if (error instanceof GitHubUnanswered) return RETRY;
  if (error instanceof MintError || error instanceof KeyReadRefused || error instanceof GitHubRefused) return FIX_THEN_RETRY;
  return null;
}

export type WriterDeps = { mintToken: typeof mintToken; connect: Connect };

/**
 * The reviewer App's client on `repo`, minted when a write first asks and shared by the run's later writes. Its
 * token lives in this closure only, never on disk, so no run writes with another's.
 */
export function reviewerWriter(repo: string, appId: number, deps: WriterDeps): () => Promise<GitHubClient> {
  let minting: Promise<GitHubClient> | null = null;
  async function mint(): Promise<GitHubClient> {
    try {
      const token = await deps.mintToken("reviewer", appId, "reviewer-app.pem", "reviewer", repo);
      return deps.connect(token.value);
    } catch (error) {
      const next = nextAfterMint(error);
      if (next === null) throw error;
      throw new CouldNotRun(`the reviewer App's token for ${repo} was not minted: ${(error as Error).message}`, next, { cause: error });
    }
  }
  return () => (minting ??= mint());
}
