import type { Round } from "../../core/contracts/snapshot.ts";
import { RoundResult, RoundVerdict } from "../../core/values.ts";
import type { ReviewerSettings } from "../settings.ts";
import type { FixHistory, LineRange } from "../worktree.ts";
import { completedSince } from "./rounds.ts";

const { CLEAN } = RoundResult.schema.enum;
const { CONVERGED_PUSHBACK, REDESIGN } = RoundVerdict.schema.enum;

const CITES_PRIOR_FIX = /\b(previous|prior|earlier|last|recent) (fix|commit|change|round|patch)\b|\bregress|\bintroduced (by|in)\b|\bno longer\b/i;

/** Where a finding points; a whole-branch judgement names no line. */
export type Spot = { file: string | null; line: number | null };

/** The fields of a recorded round the facts read, and the file and line of each finding it had. */
export type ReviewedRound = Pick<Round, "stage" | "n" | "head" | "result" | "verdict" | "at"> & { findings: readonly Spot[] };

/** A finding of the round under assessment; `text` is what it says, searched for an earlier fix it cites. */
export type FindingUnderReview = Spot & { id: string; text: string };

/** Where a file's edit count starts (ADR-0018 d2). */
export type ResetPoint =
  | { at: "round 1"; head: string }
  | { at: "settled round"; stage: Round["stage"]; n: number; head: string }
  | { at: "REDESIGN closed"; stage: Round["stage"]; n: number; commit: string };

export type FindingFacts = { on_fix_lines: boolean; repeat_unit: boolean; cites_prior_fix: boolean };

export type RoundFacts = {
  round: number;
  stage: Round["stage"];
  finding_counts_of_earlier_rounds: number[];
  count_not_falling: boolean;
  findings: Record<string, FindingFacts>;
  original_additions: number;
  fix_additions: number;
  /** Per file the rounds' fixes touched since its reset point: how many of them did, and the reset point. */
  edits_since_reset: Record<string, { edits: number; reset: ResetPoint }>;
  files_over_edit_bar: string[];
  /** Whether a finding of the round names a file over the edit bar; rounds.ts `admissibleVerdicts` offers such a round no PATCH or CLASS_FIX (ADR-0018 d1). */
  churned: boolean;
  burden: boolean;
};

export type FactsInput = {
  /** The story's recorded rounds, oldest first. */
  rounds: readonly ReviewedRound[];
  round: { stage: Round["stage"]; n: number; findings: readonly FindingUnderReview[] };
  /** rounds.ts `adminFloor`: the earlier rounds whose finding counts are compared completed after it. */
  floor: string | null;
  /** worktree's `fixHistory` over `reviewedHeads(rounds)`. */
  history: FixHistory;
};

export type FactsSettings = Pick<ReviewerSettings, "edits_before_redesign" | "near_fix_lines" | "same_unit_lines">;

/** Each head the rounds reviewed, oldest first, once however many rounds in a row reviewed it: one fix range starts at each. */
export function reviewedHeads(rounds: readonly Pick<Round, "head">[]): string[] {
  return rangeOfRounds(rounds).heads;
}

function rangeOfRounds(rounds: readonly Pick<Round, "head">[]): { heads: string[]; rangeOf: number[] } {
  const heads: string[] = [];
  const rangeOf = rounds.map(({ head }, index) => {
    if (index === 0 || rounds[index - 1].head !== head) heads.push(head);
    return heads.length - 1;
  });
  return { heads, rangeOf };
}

function near(line: number | null, ranges: readonly LineRange[], slack: number): boolean {
  return line !== null && ranges.some(([first, last]) => first - slack <= line && line <= last + slack);
}

/**
 * Per fix range: the name at the head under review of each name a file has at that range's head or later, and the
 * last commit of the range that touched each file, by its name at the head under review.
 */
function fixesByRange(ranges: FixHistory["ranges"]): { names: ReadonlyMap<string, string>[]; touched: ReadonlyMap<string, string>[] } {
  const renamed = new Map<string, string>();
  const current = (path: string): string => renamed.get(path) ?? path;
  const names: Map<string, string>[] = [];
  const touched: Map<string, string>[] = [];
  for (let range = ranges.length - 1; range >= 0; range -= 1) {
    const last = new Map<string, string>();
    for (const { sha, changes } of ranges[range].toReversed()) {
      for (const { path } of changes) if (!last.has(current(path))) last.set(current(path), sha);
      for (const { path, from } of changes) if (from !== null) renamed.set(from, current(path));
    }
    touched[range] = last;
    names[range] = new Map(renamed);
  }
  return { names, touched };
}

const named = (names: ReadonlyMap<string, string> | undefined, file: string): string => names?.get(file) ?? file;

/** What git and the recorded rounds say about the round under assessment. */
export function roundFacts({ rounds, round, floor, history }: FactsInput, settings: FactsSettings): RoundFacts {
  const { heads, rangeOf } = rangeOfRounds(rounds);
  if (history.ranges.length !== heads.length) {
    throw new RangeError(`the fix history has ${history.ranges.length} ranges for the ${heads.length} heads the rounds reviewed`);
  }
  const { names, touched } = fixesByRange(history.ranges);
  const nameAt = (index: number, file: string): string => named(names[rangeOf[index]], file);

  const counts = completedSince(rounds, round.stage, floor).map(({ findings }) => findings.length);
  const countNotFalling = counts.length > 0 && round.findings.length >= (counts.at(-1) ?? 0);

  const seen = rounds.flatMap((each, index) =>
    each.findings.flatMap(({ file, line }) => (file === null || line === null ? [] : [{ file: nameAt(index, file), line }])),
  );
  const findings = Object.fromEntries(
    round.findings.map(({ id, file, line, text }): [string, FindingFacts] => [
      id,
      {
        on_fix_lines: file !== null && near(line, history.fixLines.get(file) ?? [], settings.near_fix_lines),
        repeat_unit: near(line, seen.filter((spot) => spot.file === file).map((spot): LineRange => [spot.line, spot.line]), settings.same_unit_lines),
        cites_prior_fix: CITES_PRIOR_FIX.test(text),
      },
    ]),
  );

  const settled = rounds.findLastIndex(({ result, verdict }) => result === CLEAN || verdict === CONVERGED_PUSHBACK);
  const edits: RoundFacts["edits_since_reset"] = {};
  for (const file of new Set(touched.flatMap((last) => [...last.keys()]))) {
    // The latest start wins. A settled round's head and a REDESIGN closed in the range before it start at one range;
    // the head is the later of the two.
    const points: { start: number; reset: ResetPoint }[] = [{ start: 0, reset: { at: "round 1", head: heads[0] } }];
    const redesigned = rounds.findLastIndex(
      ({ verdict, findings: spots }, index) => verdict === REDESIGN && spots.some((spot) => spot.file !== null && nameAt(index, spot.file) === file),
    );
    const closing = redesigned === -1 ? undefined : touched[rangeOf[redesigned]].get(file);
    if (closing !== undefined) {
      const { stage, n } = rounds[redesigned];
      points.push({ start: rangeOf[redesigned] + 1, reset: { at: "REDESIGN closed", stage, n, commit: closing } });
    }
    if (settled !== -1) {
      const { stage, n, head } = rounds[settled];
      points.push({ start: rangeOf[settled], reset: { at: "settled round", stage, n, head } });
    }
    const { start, reset } = points.reduce((latest, point) => (point.start >= latest.start ? point : latest));
    const count = touched.filter((last, range) => range >= start && last.has(file)).length;
    if (count > 0) edits[file] = { edits: count, reset };
  }
  const overBar = Object.keys(edits)
    .filter((file) => edits[file].edits >= settings.edits_before_redesign)
    .sort();

  return {
    round: round.n,
    stage: round.stage,
    finding_counts_of_earlier_rounds: counts,
    count_not_falling: countNotFalling,
    findings,
    original_additions: history.originalAdditions,
    fix_additions: history.fixAdditions,
    edits_since_reset: edits,
    files_over_edit_bar: overBar,
    churned: round.findings.some(({ file }) => file !== null && overBar.includes(file)),
    burden: countNotFalling && Object.values(findings).some((flags) => Object.values(flags).some(Boolean)),
  };
}
