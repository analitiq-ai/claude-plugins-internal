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

// Every option that shapes a hunk is pinned, so no config shapes one.
const PRINTED = ["--no-color", "--no-ext-diff", "--no-textconv"];
const HUNK_SHAPE = ["-U0", "--inter-hunk-context=0", "--diff-algorithm=myers", "--indent-heuristic"];

// --text diffs a text holding a NUL by its lines.
const LINE_DIFF = ["diff", "--no-index", "--text", ...PRINTED, ...HUNK_SHAPE];

// A read of the repository's history also pins which changes git pairs as one file moved, what it shows of a
// submodule, and the order it lists files in.
const HISTORY = [...PRINTED, "--find-renames", "-l1000", "--submodule=short", "--ignore-submodules=none", "-O/dev/null"];

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

/** A path a commit or a diff changed; `from` is its name before, when the change moved it. */
export type Change = { path: string; from: string | null };

/** Inclusive line ranges of a file, as numbered on the later side of a diff. */
export type LineRange = [first: number, last: number];

const TREE_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const COMMIT_MARK = "commit:";

// In `-z --name-status` output a status is followed by one path, or by two for a rename or a copy; git starts the
// first status after a log's commit line on a new line.
function changesFrom(tokens: readonly string[], at: number): { changes: Change[]; next: number } {
  const changes: Change[] = [];
  let index = at;
  while (index < tokens.length && tokens[index] !== "" && !tokens[index].startsWith(COMMIT_MARK)) {
    const status = tokens[index].replace(/^\n/, "");
    if (status.startsWith("R") || status.startsWith("C")) {
      changes.push({ path: tokens[index + 2], from: status.startsWith("R") ? tokens[index + 1] : null });
      index += 3;
    } else {
      changes.push({ path: tokens[index + 1], from: null });
      index += 2;
    }
  }
  return { changes, next: index };
}

/** The tree git writes for `head` merged with `base`. */
export async function mergedTree(root: string, head: string, base: string): Promise<string> {
  // The conflict style changes the markers a conflicted text file holds in that tree.
  const args = ["-c", "merge.conflictStyle=merge", "merge-tree", "--write-tree", "--no-messages", "--name-only", head, base];
  // git exits 1 for a conflict, whose tree it still writes.
  const { stdout } = await runGit(root, args, [1]);
  const tree = stdout.split("\n", 1)[0];
  if (!TREE_ID.test(tree)) throw new Error(`git ${args.join(" ")} wrote no tree id in ${root}: ${JSON.stringify(tree)}`);
  return tree;
}

/** The line ranges the diff from `since`, a commit or a tree, to `until` adds, per path of `until` it adds lines to. */
export async function addedLines(root: string, since: string, until: string): Promise<Map<string, LineRange[]>> {
  const { stdout } = await runGit(root, ["diff", "-z", "--name-status", ...HISTORY, since, until, "--"]);
  const added = new Map<string, LineRange[]>();
  for (const { path, from } of changesFrom(stdout.split("\0"), 0).changes) {
    // With both of a moved file's names in the pathspec, git diffs it against its old self.
    const names = from === null ? [path] : [from, path];
    const patch = await runGit(root, ["--literal-pathspecs", "diff", ...HISTORY, ...HUNK_SHAPE, since, until, "--", ...names]);
    const ranges = hunksOf(patch.stdout).flatMap(({ new_start, new_count }): LineRange[] => (new_count === 0 ? [] : [[new_start, new_start + new_count - 1]]));
    if (ranges.length > 0) added.set(path, ranges);
  }
  return added;
}

/** How many lines `until` adds over `since`; a binary file adds none. */
export async function additions(root: string, since: string, until: string): Promise<number> {
  const { stdout } = await runGit(root, ["diff", "--numstat", ...HISTORY, since, until, "--"]);
  return stdout
    .split("\n")
    .filter((row) => row !== "")
    .reduce((sum, row) => {
      const added = row.split("\t", 1)[0];
      return added === "-" ? sum : sum + Number(added);
    }, 0);
}

export type CommitChanges = { sha: string; changes: Change[] };

/** The commits `to` has and neither `from` nor `excluded` has, oldest first, each with the paths it changed; merge commits are left out. */
export async function commitsBetween(root: string, from: string, to: string, excluded: string): Promise<CommitChanges[]> {
  const args = ["log", "--no-merges", "--reverse", "--no-show-signature", ...HISTORY, "--name-status", "-z", `--format=${COMMIT_MARK}%H`];
  const { stdout } = await runGit(root, [...args, to, `^${from}`, `^${excluded}`, "--"]);
  const tokens = stdout.split("\0");
  const commits: CommitChanges[] = [];
  // -z ends the output with a NUL, so its last token is empty.
  for (let index = 0; index < tokens.length - 1; ) {
    if (!tokens[index].startsWith(COMMIT_MARK)) throw new Error(`git ${args.join(" ")} wrote ${JSON.stringify(tokens[index])} where a commit line belongs`);
    const { changes, next } = changesFrom(tokens, index + 1);
    commits.push({ sha: tokens[index].slice(COMMIT_MARK.length), changes });
    index = next;
  }
  return commits;
}

/** What git says about the fixes made since round 1, none of the base branch's work counted as one. */
export type FixHistory = {
  /** Per head reviewed, oldest first: `commitsBetween` it and the next head reviewed, or the head under review after the last, `base` excluded. */
  ranges: readonly (readonly CommitChanges[])[];
  /** The lines the fixes wrote, per path at the head under review. */
  fixLines: ReadonlyMap<string, readonly LineRange[]>;
  /** The lines round 1's head adds over the commit it left the base branch at. */
  originalAdditions: number;
  /** The lines the head under review adds over round 1's head merged with `base`. */
  fixAdditions: number;
};

/**
 * `heads`: facts.ts `reviewedHeads` of the recorded rounds, empty before round 1. `base`: the newest commit `head` holds
 * of the branch its PR merges into, `git merge-base head <branch>`.
 */
export async function fixHistory(root: string, heads: readonly string[], head: string, base: string): Promise<FixHistory> {
  const first = heads[0] ?? head;
  // What the base branch brought in since round 1 is in the head too: the fixes are what the head holds beyond round 1's
  // head merged with the base.
  const fixedFrom = await mergedTree(root, first, base);
  const ends = [...heads.slice(1), head];
  const left = (await runGit(root, ["merge-base", first, base])).stdout.trim();
  const [fixLines, originalAdditions, fixAdditions, ranges] = await Promise.all([
    addedLines(root, fixedFrom, head),
    additions(root, left, first),
    additions(root, fixedFrom, head),
    Promise.all(heads.map((from, index) => commitsBetween(root, from, ends[index], base))),
  ]);
  return { ranges, fixLines, originalAdditions, fixAdditions };
}
