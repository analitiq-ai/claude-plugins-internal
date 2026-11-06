import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runGit } from "../core/git.ts";

/**
 * Lines `old_start`… of one text replaced by lines `new_start`… of the other. A count of 0 is a pure insertion or
 * deletion, its start the line it follows.
 */
export type LineHunk = { old_start: number; old_count: number; new_start: number; new_count: number };

const HUNK = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

// Every option that shapes a hunk is pinned, so no config shapes them; --text diffs a text holding a NUL by its lines.
const LINE_DIFF = [
  "diff",
  "--no-index",
  "--text",
  "-U0",
  "--no-color",
  "--no-ext-diff",
  "--no-textconv",
  "--inter-hunk-context=0",
  "--diff-algorithm=myers",
  "--indent-heuristic",
];

function hunksOf(patch: string): LineHunk[] {
  return patch.split("\n").flatMap((line) => {
    const hunk = HUNK.exec(line);
    if (hunk === null) return [];
    return [{ old_start: Number(hunk[1]), old_count: Number(hunk[2] ?? 1), new_start: Number(hunk[3]), new_count: Number(hunk[4] ?? 1) }];
  });
}

/** The hunks git gives between two texts. Neither need be in any repository. */
export async function textHunks(before: string, after: string): Promise<LineHunk[]> {
  const folder = mkdtempSync(join(tmpdir(), "reviewer-hunks-"));
  try {
    writeFileSync(join(folder, "before"), before, { mode: 0o600 });
    writeFileSync(join(folder, "after"), after, { mode: 0o600 });
    // git diff exits 1 when the two differ.
    const { stdout } = await runGit(folder, [...LINE_DIFF, "--", "before", "after"], [1]);
    return hunksOf(stdout);
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}
