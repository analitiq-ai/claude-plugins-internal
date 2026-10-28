import { execFile } from "node:child_process";

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

export function runGit(checkout: string, args: readonly string[], answers: readonly number[] = []): Promise<GitAnswer> {
  return new Promise((resolve, reject) => {
    execFile(
      "git",
      ["-C", checkout, ...NO_CONFIGURED_CODE, ...args],
      { encoding: "utf8", env: { ...process.env, ...NO_GLOBAL_OR_SYSTEM_CONFIG } },
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
