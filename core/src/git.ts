import { execFile } from "node:child_process";

import { GH_TOKEN_VARIABLES } from "./gh-config.ts";
import { httpsUrl, type Repository } from "./github.ts";

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

/**
 * Pushes `refspec` to `repo`'s https URL, whatever the checkout's origin is, with the token gh holds in
 * `ghConfigDir` as the only credential: runGit's empty `credential.helper` comes first, so gh's is the one helper.
 * The environment is set here, not inherited, so the push is right whatever the caller's shell holds.
 */
export async function pushWithGhCredential(checkout: string, ghConfigDir: string, repo: Repository, refspec: string): Promise<void> {
  const env = {
    GH_CONFIG_DIR: ghConfigDir,
    GIT_TERMINAL_PROMPT: "0",
    ...Object.fromEntries(GH_TOKEN_VARIABLES.map((name) => [name, undefined])),
  };
  const args = ["-c", "credential.helper=!gh auth git-credential", "push", "--porcelain", "--end-of-options", httpsUrl(repo), refspec];
  await runGit(checkout, args, [], env);
}
