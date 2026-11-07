import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { TestContext } from "node:test";

import { git } from "../../../core/tests/support/git.ts";
import { tempHome } from "./session.ts";

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

/** `count` lines, `<prefix>0` to `<prefix><count - 1>`. */
export function numbered(prefix: string, count: number): string {
  return Array.from({ length: count }, (_, index) => `${prefix}${index}\n`).join("");
}

export type FeatureRepo = { root: string; commit: (files: Record<string, string>, message: string) => string };

/**
 * A repository whose main holds a.py, `numbered("line", 30)`, checked out on a new branch feat; `commit` writes the
 * files, commits them on the branch checked out and gives the commit's sha. `init` is passed to `git init`.
 */
export function featureRepo(t: TestContext, ...init: string[]): FeatureRepo {
  const root = tempHome(t);
  git(root, "init", "-q", "-b", "main", ...init);
  const commit = (files: Record<string, string>, message: string): string => {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    git(root, "add", "-A");
    git(root, "commit", "-q", "--allow-empty", "-m", message);
    return git(root, "rev-parse", "HEAD");
  };
  commit({ "a.py": numbered("line", 30) }, "base");
  git(root, "checkout", "-q", "-b", "feat");
  return { root, commit };
}
