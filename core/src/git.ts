import { execFile } from "node:child_process";
import { dirname } from "node:path";

import { GH_TOKEN_VARIABLES } from "./gh-config.ts";
import { httpsUrl, repositoryOfRemote, withoutUserinfo, type Repository } from "./github.ts";

export type GitAnswer = { code: number; stdout: string };

export class GitFailed extends Error {
  readonly args: readonly string[];
  readonly code: number;
  readonly stderr: string;

  constructor(args: readonly string[], code: number, stderr: string) {
    super(`git ${args.join(" ")} exited ${code}: ${stderr.trim()}`);
    this.name = "GitFailed";
    this.args = args;
    this.code = code;
    this.stderr = stderr;
  }
}

// A hook must not run code that the user's config, the machine's config or the checkout names (root ADR-0008 d8,
// SECURITY.md §5); every git call of core passes through here so none can skip it.
const NO_CONFIGURED_CODE = ["-c", "credential.helper=", "-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null"];
const NO_GLOBAL_OR_SYSTEM_CONFIG = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

/** `env` is merged over git's own environment; a variable it maps to undefined is removed from the child's. */
export function runGit(
  checkout: string,
  args: readonly string[],
  answers: readonly number[] = [],
  env: Readonly<Record<string, string | undefined>> = {},
): Promise<GitAnswer> {
  const childEnv: NodeJS.ProcessEnv = { ...process.env, ...NO_GLOBAL_OR_SYSTEM_CONFIG };
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined) delete childEnv[name];
    else childEnv[name] = value;
  }
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", checkout, ...NO_CONFIGURED_CODE, ...args],
      { encoding: "utf8", env: childEnv },
      (error, stdout, stderr) => {
        if (error === null) {
          resolve({ code: 0, stdout });
          return;
        }
        // A spawn failure, a signal or an overflowed buffer is not an exit code a caller could have named.
        if (typeof error.code !== "number") {
          reject(error);
          return;
        }
        if (answers.includes(error.code)) {
          resolve({ code: error.code, stdout });
          return;
        }
        reject(new GitFailed(args, error.code, stderr));
      },
    );
  });
}

// Resolved once, so a revision the clone lacks throws here, not as "not in history" from `merge-base`, and no
// later git call reads a caller's string as an option.
export async function commitOf(checkout: string, revision: string): Promise<string> {
  return (await runGit(checkout, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`])).stdout.trim();
}

export async function mainCheckout(checkout: string): Promise<string> {
  // Every worktree of a repository answers the same common dir, absolute and canonical with `--path-format=absolute`.
  const { stdout } = await runGit(checkout, ["rev-parse", "--path-format=absolute", "--git-common-dir"]);
  return dirname(stdout.replace(/\n$/, ""));
}

export function trackingRef(branch: string): string {
  return `refs/remotes/origin/${branch}`;
}

/** Forced, as a branch on GitHub may be rewritten; a fetch from a URL updates no remote-tracking ref by itself. */
export function trackingRefspec(branch: string): string {
  return `+refs/heads/${branch}:${trackingRef(branch)}`;
}

/** The GitHub repository the checkout's origin names, as `owner/name`. */
export async function originRepository(checkout: string): Promise<string> {
  const { stdout } = await runGit(checkout, ["remote", "get-url", "origin"]);
  const { owner, name } = repositoryOfRemote(stdout.trim());
  return `${owner}/${name}`;
}

/** The checkout's git config would let a credential other than gh's token reach GitHub. */
export class GhCredentialRefused extends Error {
  constructor(setting: string) {
    super(`the checkout's git config ${setting}; remove it to reach GitHub with gh's token`);
    this.name = "GhCredentialRefused";
  }
}

/**
 * Runs git `args` against `repo`'s https URL, whatever the checkout's origin is, with the token gh holds in
 * `ghConfigDir` as the only credential: runGit's empty `credential.helper` comes first, so gh's is the one helper,
 * and no askpass is left for git to ask where gh has no answer. The environment is set here, not inherited, so the
 * call is right whatever the caller's shell holds.
 * A checkout whose config sets an http extra header or rewrites the URL is refused rather than reset: a
 * URL-specific header outranks any less specific reset, and no setting switches rewriting off.
 */
async function withGhCredential(checkout: string, ghConfigDir: string, url: string, args: readonly string[]): Promise<void> {
  // git exits 1 when no key matches.
  const headers = await runGit(checkout, ["config", "--name-only", "--get-regexp", "^http\\..*extraheader$"], [1]);
  if (headers.code === 0) {
    const keys = headers.stdout.trim().split("\n").map(withoutUserinfo);
    throw new GhCredentialRefused(`sets ${keys.join(", ")}, a header sent beside gh's token`);
  }
  // git rewrites a URL that starts with an insteadOf value. -z, as a base may hold a space or a newline: each entry
  // is the key, a newline, then the value.
  const rewrites = await runGit(checkout, ["config", "-z", "--get-regexp", "^url\\..*\\.(push)?insteadof$"], [1]);
  const prefixes = rewrites.stdout.split("\0").filter(Boolean).map((entry) => entry.slice(entry.indexOf("\n") + 1));
  // The base is left out of the message: it may hold a credential of its own.
  if (prefixes.some((prefix) => url.startsWith(prefix))) {
    throw new GhCredentialRefused(`rewrites ${url} with a url.<base>.insteadOf or pushInsteadOf, which takes the call off gh's token`);
  }
  const env = {
    GH_CONFIG_DIR: ghConfigDir,
    GIT_TERMINAL_PROMPT: "0",
    GIT_ASKPASS: undefined,
    SSH_ASKPASS: undefined,
    ...Object.fromEntries(GH_TOKEN_VARIABLES.map((name) => [name, undefined])),
  };
  await runGit(checkout, ["-c", "credential.helper=!gh auth git-credential", "-c", "core.askPass=", ...args], [], env);
}

export async function pushWithGhCredential(checkout: string, ghConfigDir: string, repo: Repository, refspec: string): Promise<void> {
  const url = httpsUrl(repo);
  await withGhCredential(checkout, ghConfigDir, url, ["push", "--porcelain", "--end-of-options", url, refspec]);
}

/** Each refspec names its destination: a fetch from a URL, not a remote, updates no remote-tracking ref by itself. */
export async function fetchWithGhCredential(
  checkout: string,
  ghConfigDir: string,
  repo: Repository,
  refspecs: readonly string[],
): Promise<void> {
  const url = httpsUrl(repo);
  await withGhCredential(checkout, ghConfigDir, url, ["fetch", "--quiet", "--no-tags", "--end-of-options", url, ...refspecs]);
}
