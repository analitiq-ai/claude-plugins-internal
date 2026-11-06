import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

import { tempHome } from "./session.ts";

const GIT_ENV = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

/** git's trimmed output, run with no config but a dummy author. */
export function git(root: string, ...args: string[]): string {
  const author = ["-c", "user.name=dummy", "-c", "user.email=dummy@example.com"];
  return execFileSync("git", ["-C", root, ...author, ...args], { env: GIT_ENV, encoding: "utf8" }).trim();
}

/** A clone holding `files` in one commit, and that commit's sha. */
export function cloneWith(t: TestContext, files: Record<string, string>): { clone: string; head: string } {
  const clone = tempHome(t);
  git(clone, "init", "-q");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(clone, path)), { recursive: true });
    writeFileSync(join(clone, path), text);
  }
  git(clone, "add", "-A");
  git(clone, "commit", "-q", "-m", "files");
  return { clone, head: git(clone, "rev-parse", "HEAD") };
}
