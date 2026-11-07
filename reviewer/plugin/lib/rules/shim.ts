import type { z } from "zod";

import type { Bug } from "../../core/contracts/gates.ts";
import { ShimRuling } from "../../core/values.ts";
import { type Budget, carry, lines, lineSpan, linesOf } from "../check/lineage.ts";
import { known } from "../known.ts";
import type { LineHunk } from "../worktree.ts";
import { citations, type HunkKind, type Located, textId } from "./claim.ts";
import { mergeBugs, withRanges } from "./counts.ts";

const { DEFERRED } = ShimRuling.schema.enum;

export type RangeHunk = Bug["ranges"][number];
export type Site = NonNullable<Bug["deep"]>["same_operation"][number];
export type ShimVerdict = "patch" | "complete";

/**
 * A completed shim check of a change: its swept hunks, the sites its sweep listed, and its verdict. A `deep` sweep
 * is the one a bug's count calls for (ADR-0008); `settleBugs` keeps its lists on the bug a patch settles.
 */
export type ShimCheck = {
  hunks: RangeHunk[];
  same_operation: Site[];
  callers: Site[];
  mode: "sweep" | "deep";
  verdict: ShimVerdict;
};

const SWEPT: readonly HunkKind[] = ["CODE", "MIXED"];
// Besides the file names the runners find by default (pytest, go test, Jest, terraform test), every file under a
// `tests`, `test` or `__tests__` folder counts, so fixtures and helpers kept there do too.
const TEST_FOLDERS = new Set(["tests", "test", "__tests__"]);
const TEST_NAME = /^(?:test_.*\.py|.*_test\.(?:py|go)|.*\.(?:test|spec)\.(?:js|jsx|ts|tsx|mjs|cjs)|.*\.tftest\.hcl)$/;

export function siteId(file: string, fn: string): string {
  return textId(file, fn);
}

/** Reasons a sweeper's two lists are not accepted; `located` gives a path's line count in HEAD, null for no file. */
export function validateSweep(output: Pick<ShimCheck, "same_operation" | "callers">, located: Located): string[] {
  const errors: string[] = [];
  for (const name of ["same_operation", "callers"] as const) {
    const seen = new Set<string>();
    for (const site of output[name]) {
      const size = located(site.file);
      const where = `${name}: ${site.file}:${site.line}`;
      if (size === null) errors.push(`${where}: ${site.file} is not a file of HEAD; name only what the snapshot holds`);
      else if (site.line < 1 || site.line > size) errors.push(`${where}: ${site.file} has lines 1-${size} in HEAD`);
      for (const field of ["function", "does"] as const) if (site[field].trim() === "") errors.push(`${where}: ${field} is empty`);
      const key = JSON.stringify([site.file, site.function]);
      if (seen.has(key)) errors.push(`${name}: ${site.file} ${site.function} is listed twice; list each site once`);
      seen.add(key);
    }
  }
  return errors;
}

/** `coverage` is read over the listed sites, so with no SAME OPERATION site left a cause fix is complete whatever it says. */
export function shimVerdict(kind: string, level: string | null, coverage: string | null, { sitesLeft }: { sitesLeft: boolean }): ShimVerdict {
  const reachesAll = !sitesLeft || coverage === "all" || coverage === "none_other";
  return kind === "not_fix" || (level === "cause" && reachesAll) ? "complete" : "patch";
}

export function siteRange(site: Site): RangeHunk {
  return { file: site.file, old_start: site.line, old_count: 1 };
}

function oldLines({ old_start, old_count }: RangeHunk): [first: number, last: number] {
  return [old_start, old_start + Math.max(old_count, 1) - 1];
}

/** Whether two ranges of one file share a line or sit side by side, a pure insertion counting as the line it follows; both are numbered in one text. */
function touches(a: RangeHunk, b: RangeHunk): boolean {
  const [[startA, endA], [startB, endB]] = [oldLines(a), oldLines(b)];
  return a.file === b.file && startA <= endB + 1 && startB <= endA + 1;
}

export function overlaps(ranges: readonly RangeHunk[], hunks: readonly RangeHunk[]): boolean {
  return ranges.some((range) => hunks.some((hunk) => touches(range, hunk)));
}

/**
 * Per site id, each hunk's old-side lines in the site's file, a pure insertion as the line it follows, or null when
 * the file is not in the change.
 * A site is known by its first line alone, so this gives the lines that changed, not whether the site's own did.
 */
export function altered(sites: readonly Site[], hunks: readonly RangeHunk[]): Record<string, [number, number][] | null> {
  return Object.fromEntries(
    sites.map((site) => {
      const found = hunks.filter((hunk) => hunk.file === site.file).map(oldLines);
      return [siteId(site.file, site.function), found.length > 0 ? found : null];
    }),
  );
}

export function linesText(found: readonly (readonly [number, number])[] | null): string {
  if (found === null) return "this file is not in the change";
  return `alters lines ${found.map(([first, last]) => (first === last ? `${first}` : `${first}-${last}`)).join(", ")} of this file`;
}

export function isTestFile(path: string): boolean {
  const parts = path.split("/");
  const name = parts.pop() ?? "";
  return parts.some((folder) => TEST_FOLDERS.has(folder)) || TEST_NAME.test(name);
}

/** The code hunks a fix is swept for: none when it has no code or all of it is in test files, since it fixes nothing yet. */
export function swept<H extends RangeHunk & { id: string }>(hunks: readonly H[], labels: Readonly<Record<string, HunkKind>>): H[] {
  const code = hunks.filter((hunk) => SWEPT.includes(known(labels, hunk.id)));
  return code.every((hunk) => isTestFile(hunk.file)) ? [] : code;
}

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Why `contests` are refused; empty when they are accepted. */
export function contestErrors(contests: unknown, check: ShimCheck, bug: Bug | null): string[] {
  if (!Array.isArray(contests) || contests.length === 0 || !contests.every(isRecord)) return ["args.contests is a non-empty list of {site, reason}"];
  if (check.verdict !== "patch" || bug === null) return ["a contest answers the patch verdict of the change; there is none to contest"];
  const listed = new Set(check.same_operation.map((site) => siteId(site.file, site.function)));
  const ruled = new Set(bug.rulings.map((ruling) => ruling.site));
  const named = new Set<string>();
  const errors: string[] = [];
  for (const { site, reason } of contests) {
    const shown = JSON.stringify(site ?? null);
    if (typeof site !== "string" || !listed.has(site)) errors.push(`site ${shown} is not in this check's SAME OPERATION list`);
    else if (ruled.has(site)) errors.push(`site ${site} was already ruled for this bug; a site is ruled once`);
    else if (named.has(site)) errors.push(`site ${site} is contested twice`);
    else named.add(site);
    if (typeof reason !== "string" || reason.trim() === "") errors.push(`site ${shown}: the reason is empty`);
  }
  return errors;
}

/** A site judge's answer, before it is accepted. */
export type SiteJudgement = { ruling: z.infer<typeof ShimRuling.schema>; issue?: number; evidence: readonly string[] };

/** Reasons a site judge's ruling is not accepted; `issueState` gives an issue's state, or null when it could not be read. */
export function validateRuling({ ruling, issue, evidence }: SiteJudgement, located: Located, issueState: (issue: number) => string | null): string[] {
  const errors: string[] = [];
  if (ruling === DEFERRED) {
    const state = issue === undefined ? undefined : issueState(issue);
    if (state === undefined) errors.push(`a ${DEFERRED} ruling needs the number of an open issue the site moves to`);
    else if (state === null) {
      errors.push(`issue #${issue} could not be read: it is not an issue of this repo, or GitHub could not be reached. Name an open issue of this repo`);
    } else if (state !== "OPEN") errors.push(`issue #${issue} is not open in this repo`);
  }
  for (const text of evidence) {
    const { good, bad } = citations(text, located);
    for (const cited of bad) errors.push(`evidence ${cited}: ${cited.slice(0, cited.lastIndexOf(":"))} is not a file of the tree, or has no such line`);
    if (good.length === 0 && bad.length === 0) errors.push(`evidence ${JSON.stringify(text)} names no path:line of the tree`);
  }
  return errors;
}

/** The tree a check ran on, its repo and branch, when it ran, and the reset counts start after. */
export type CheckedTree = { repo: string; branch: string; tree: string; at: string; reset: string | null };

/**
 * The bugs once `check` is settled. A complete verdict ends the bugs its hunks reach. A patch merges them into one
 * (`mergeBugs`), or opens a bug named by the repo, branch and tree when it reaches none, and gives it the hunks and
 * the SAME OPERATION sites as ranges. A deep sweep keeps its lists on that bug; any other sweep counts the tree in it unless
 * the bug already counted or absorbed it. Changes nothing it is given.
 */
export function settleBugs(bugs: readonly Bug[], check: ShimCheck, { repo, branch, tree, at, reset }: CheckedTree): Bug[] {
  const reached = bugs.filter((bug) => overlaps(bug.ranges, check.hunks));
  const untouched = bugs.filter((bug) => !reached.includes(bug));
  if (check.verdict === "complete") return untouched;
  const base: Bug =
    reached.length > 0 ? mergeBugs(reached, reset) : { id: textId(repo, branch, tree), members: [], absorbed: [], ranges: [], deep: null, rulings: [] };
  const settled = { ...base, ranges: withRanges(base.ranges, [...check.hunks, ...check.same_operation.map(siteRange)]) };
  if (check.mode === "deep") return [...untouched, { ...settled, deep: { same_operation: check.same_operation, callers: check.callers } }];
  const counted = [...settled.members, ...settled.absorbed].some((entry) => entry.tree === tree);
  return [...untouched, counted ? settled : { ...settled, members: [...settled.members, { tree, at }] }];
}

/** Each file's text before and after, and the hunks between them. */
type Texts = {
  olds: Readonly<Record<string, string>>;
  news: Readonly<Record<string, string>>;
  hunks: Readonly<Record<string, readonly LineHunk[]>>;
};

/**
 * Each of a file's ranges in its new text, or null where its lines have no place there. They are carried in one
 * pass, as `succeed` carries a file's places, so `char_diff_budget` bounds the file, not each range.
 */
function carriedRanges(file: string, ranges: readonly RangeHunk[], { olds, news, hunks }: Texts, settings: Budget): (RangeHunk | null)[] {
  const [before, after] = [known(olds, file), known(news, file)];
  if (after === before) return [...ranges];
  // A diff from nothing maps no span, so a range measured in empty text widens to the whole new file.
  if (before === "") return ranges.map(() => ({ file, old_start: 1, old_count: lines(after).length }));
  const spans = carry(
    ranges.map((range) => lineSpan(before, range.old_start, range.old_count)),
    before,
    after,
    known(hunks, file),
    settings,
  );
  return spans.map((span) => {
    if (span === null) return null;
    const [first, count] = linesOf(after, span);
    return { file, old_start: first, old_count: count };
  });
}

/**
 * `bugs` with each range moved from its file's text in `olds` to its text in `news`, as `carriedRanges` moves it. A
 * range in a file of `gone` (moved or deleted: nothing maps it) is dropped, and so is one whose lines have no place
 * in the new text. A bug with no range left is dropped. Changes nothing it is given.
 */
export function carriedBugs(
  bugs: readonly Bug[],
  olds: Texts["olds"],
  news: Texts["news"],
  gone: ReadonlySet<string>,
  hunks: Texts["hunks"],
  settings: Budget,
): Bug[] {
  const all = bugs.flatMap((bug) => bug.ranges).filter((range) => !gone.has(range.file));
  const moved = new Map<RangeHunk, RangeHunk | null>();
  for (const file of new Set(all.map((range) => range.file))) {
    const ranges = all.filter((range) => range.file === file);
    carriedRanges(file, ranges, { olds, news, hunks }, settings).forEach((carried, at) => moved.set(ranges[at], carried));
  }
  return bugs.flatMap((bug) => {
    const ranges = withRanges([], bug.ranges.flatMap((range) => moved.get(range) ?? []));
    return ranges.length > 0 ? [{ ...bug, ranges }] : [];
  });
}
