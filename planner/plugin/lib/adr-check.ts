// What planner's ADR check decides from what ask recorded, the judge's verdict and the rulings, and the stop table
// its lines are printed from, a `folder` item's but as its CouldNotRun reason (planner ADR-0009).
import { isDeepStrictEqual } from "node:util";

import type { AdrAnswer } from "../core/adr.ts";
import type { AdrAsked, AdrRuling, AdrVerdict, ArtifactPath, CheckedArtifactName } from "../core/contracts/decision-check.ts";
import { ADR_RULINGS_FILE, TOUCHES_FILE } from "../core/contracts/decision-check.ts";
import type { CouldNotRun } from "../core/outcomes.ts";
import { SETTINGS_FILE } from "../core/settings.ts";
import { AdrJudgment, CheckedArtifact, CheckOutcome } from "../core/values.ts";

const { PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;
const { DEPARTS } = AdrJudgment.schema.enum;

type StopRow = {
  outcome: typeof PASS | typeof FAIL | typeof COULD_NOT_RUN;
  label: string | null;
  what: string | null;
  next: string | null;
};

const RULE_ON = "resume with adr_ruling naming <entry>, <id>, <path> and your reason";
const CHECK_AGAIN = "resume to run the check again";
const START_AGAIN = "start the run again with /planner:issue-spec rescope <spec folder> #<issue>";

/** The stop table (workflow-steps.md), row for row, and `stop-unread` for the stop record report cannot read, which
 *  the table's report gives as "exit 2 naming it" but no row; `<name>` in a label, what or next step is filled from
 *  the item. A `folder` item says its CouldNotRun reason in place of a row: core's, or one verdictMismatch builds. */
export const ADR_STOPS = {
  empty: { outcome: PASS, label: SETTINGS_FILE, what: "No ADR folder is listed in [shared] adr_folders", next: null },
  governed: { outcome: PASS, label: "<entry>", what: "governing: <records>", next: null },
  ungoverned: { outcome: PASS, label: "<entry>", what: "no record governs these paths", next: null },
  "departure-inside": {
    outcome: FAIL,
    label: "<entry>",
    what: "<id> on <path><stories>: <why>",
    next: `change <artifact>; draft a superseding record into the spec PR (planner ADR-0009 d3); or ${RULE_ON}`,
  },
  "departure-outside": {
    outcome: FAIL,
    label: "<entry>",
    what: "<id> on <path><stories>: <why>",
    next: `change <artifact>; change record <id> in the repo that holds <entry>; or ${RULE_ON}`,
  },
  broken: {
    outcome: FAIL,
    label: "<entry>",
    what: "<file>: <rule>: <message>",
    next: "fix that record (in the spec PR, or in the repo that holds <entry>)",
  },
  folder: { outcome: COULD_NOT_RUN, label: null, what: null, next: null },
  "verdict-unread": { outcome: COULD_NOT_RUN, label: "<file>", what: "<what>", next: CHECK_AGAIN },
  "verdict-mismatch": { outcome: COULD_NOT_RUN, label: "<entry>", what: "the verdict <mismatches>", next: CHECK_AGAIN },
  rounds: { outcome: COULD_NOT_RUN, label: "adr-<a>-check", what: "the check stopped 100 times in one run", next: START_AGAIN },
  // A resume runs report alone, on the same record.
  "stop-unread": { outcome: COULD_NOT_RUN, label: "<file>", what: "<what>", next: START_AGAIN },
  "touches-refused": { outcome: FAIL, label: TOUCHES_FILE, what: "<what>", next: `correct <run>/${TOUCHES_FILE}, then resume` },
  "touches-missing": { outcome: COULD_NOT_RUN, label: TOUCHES_FILE, what: "<what>", next: CHECK_AGAIN },
  "questions-refused": {
    outcome: FAIL,
    label: "review-questions.json",
    what: "<what>",
    next: "rerun the rescope from /planner:issue-spec rescope",
  },
  "tasks-refused": { outcome: FAIL, label: "tasks.md:<line>", what: "<what>", next: "change tasks.md, then resume" },
  "tasks-empty": {
    outcome: COULD_NOT_RUN,
    label: "tasks.md",
    what: "no task line names a path",
    next: "name each task's files, one per backtick span, then resume",
  },
  "rulings-refused": {
    outcome: FAIL,
    label: ADR_RULINGS_FILE,
    what: "<what>",
    next: `correct <spec folder>/${ADR_RULINGS_FILE}, then resume`,
  },
  "ruling-refused": { outcome: FAIL, label: "adr_ruling", what: "<what>", next: "resume with a corrected adr_ruling, or without one" },
  "guard-rulings": {
    outcome: COULD_NOT_RUN,
    label: ADR_RULINGS_FILE,
    what: "entry <folder> <id> <path> was not written by the check",
    next: "remove the entry; only a resume with adr_ruling adds one",
  },
  "guard-paths": { outcome: COULD_NOT_RUN, label: "<file>", what: "changed after ask: <changes>", next: CHECK_AGAIN },
  "guard-asked": { outcome: COULD_NOT_RUN, label: "<file>", what: "changed after ask", next: CHECK_AGAIN },
  settings: { outcome: COULD_NOT_RUN, label: SETTINGS_FILE, what: "<what>", next: `fix ${SETTINGS_FILE} at HEAD, then resume` },
  git: { outcome: COULD_NOT_RUN, label: "git", what: "<what>", next: "run from a git checkout of the repo, then resume" },
} as const satisfies Record<string, StopRow>;

type Stops = typeof ADR_STOPS;
export type StopKind = keyof Stops;

type Placeholders<Text> = Text extends `${string}<${infer Name}>${infer Rest}` ? Name | Placeholders<Rest> : never;
type RowPlaceholders<Kind extends StopKind> = Placeholders<Stops[Kind]["label"] | Stops[Kind]["what"] | Stops[Kind]["next"]>;
// A kind whose row names a placeholder cannot be stopped on without a value for it.
type Fill<Kind extends StopKind> = [RowPlaceholders<Kind>] extends [never]
  ? unknown
  : { fill: Readonly<Record<RowPlaceholders<Kind>, string>> };

type Said = Exclude<StopKind, "folder">;
export type StopItem =
  | { kind: "folder"; couldNotRun: CouldNotRun }
  | { [Kind in Said]: { kind: Kind } & Fill<Kind> }[Said];

const PLACEHOLDER = /<([^<>]+)>/g;
const LINE_BREAK = /\s*\n\s*/g;

function said(item: StopItem): string {
  if (item.kind === "folder") return item.couldNotRun.reason;
  const { label, what, next } = ADR_STOPS[item.kind];
  const fill: Readonly<Record<string, string | undefined>> = "fill" in item ? item.fill : {};
  const filled = (text: string): string =>
    text.replace(PLACEHOLDER, (_, name: string) => {
      const value = fill[name];
      if (value === undefined) throw new Error(`a ${item.kind} stop has no value for <${name}>`);
      return value;
    });
  const line = `${filled(label)}: ${filled(what)}.`;
  return next === null ? line : `${line} Next step: ${filled(next)}.`;
}

/** One line per item, its row's outcome before it, and the exit: 2 when any line is COULD_NOT_RUN, else 1 when any
 *  is FAIL, else 0. */
export function adrStop(items: readonly StopItem[]): { lines: string[]; exit: number } {
  const outcomes = items.map((item) => ADR_STOPS[item.kind].outcome);
  // A what can be a parser's or git's several-line message; the session reads one line per item.
  const lines = items.map((item, i) => `${outcomes[i]}: ${said(item).replace(LINE_BREAK, " ")}`);
  const exit = outcomes.includes(COULD_NOT_RUN) ? 2 : outcomes.includes(FAIL) ? 1 : 0;
  return { lines, exit };
}

/** Each value of `now` that `recorded` lacks, and each of `recorded` that `now` lacks, compared whole. */
export function changedSince<Value>(recorded: readonly Value[], now: readonly Value[]): { added: Value[]; removed: Value[] } {
  const lacking = (list: readonly Value[]) => (value: Value) => !list.some((other) => isDeepStrictEqual(other, value));
  return { added: now.filter(lacking(recorded)), removed: recorded.filter(lacking(now)) };
}

type AskedFolder = AdrAsked["folders"][number];
type Departure = { record: string; path: string; stories: string[]; why: string };

export type FolderOutcome = {
  entry: string;
  inside: boolean;
  outcome: typeof PASS | typeof FAIL | typeof COULD_NOT_RUN;
  governing: AdrAnswer["governing"];
  departures: Departure[];
  broken: AdrAnswer["broken"];
  couldNotRun: CouldNotRun | null;
};

function verdictMismatch(entry: string, parts: readonly string[]): CouldNotRun {
  return { outcome: COULD_NOT_RUN, reason: said({ kind: "verdict-mismatch", fill: { entry, mismatches: parts.join(", ") } }) };
}

/** Whether a ruling names this departure: rulings are keyed on folder, record and path, never on a reason. */
export function isRuled(rulings: readonly AdrRuling[], { folder, record, path }: Omit<AdrRuling, "reason">): boolean {
  return rulings.some((ruling) => ruling.folder === folder && ruling.record === record && ruling.path === path);
}

/** One folder's outcome: core's CouldNotRun as it is; COULD_NOT_RUN when its verdicts are not one per governing
 *  record over asked paths; else FAIL on each departure no ruling names and each broken record, PASS otherwise. */
export function decideFolder(
  folder: AskedFolder,
  paths: readonly ArtifactPath[],
  verdict: AdrVerdict | null,
  rulings: readonly AdrRuling[],
): FolderOutcome {
  const { entry, inside } = folder;
  if ("outcome" in folder) {
    return { entry, inside, outcome: COULD_NOT_RUN, governing: [], departures: [], broken: [], couldNotRun: folder.outcome };
  }
  const { governing, broken } = folder;
  const own = (verdict?.verdicts ?? []).filter((judged) => judged.folder === entry);
  const judgedIds = new Set(own.map((judged) => judged.record));
  const governingIds = new Set(governing.map((record) => record.recordId));
  const asked = new Set(paths.map(({ path }) => path));
  const mismatches = [
    ...[...governingIds].filter((id) => !judgedIds.has(id)).map((id) => `misses governing ${id}`),
    ...[...judgedIds].filter((id) => !governingIds.has(id)).map((id) => `names ${id} not governing`),
    ...[...new Set(own.flatMap((judged) => judged.paths))].filter((path) => !asked.has(path)).map((path) => `names ${path} not asked`),
  ];
  if (mismatches.length > 0) {
    return { entry, inside, outcome: COULD_NOT_RUN, governing, departures: [], broken, couldNotRun: verdictMismatch(entry, mismatches) };
  }
  const departures = own
    .filter((judged) => judged.judgment === DEPARTS)
    .flatMap(({ record, paths: departing, why }) =>
      departing
        .filter((path) => !isRuled(rulings, { folder: entry, record, path }))
        .map((path) => ({ record, path, stories: storiesNaming(paths, path), why })),
    );
  const outcome = departures.length > 0 || broken.length > 0 ? FAIL : PASS;
  return { entry, inside, outcome, governing, departures, broken, couldNotRun: null };
}

function storiesNaming(paths: readonly ArtifactPath[], path: string): string[] {
  return [...new Set(paths.flatMap((at) => (at.path === path && at.story !== null ? [at.story] : [])))];
}

const ARTIFACT_FILE: Readonly<Record<CheckedArtifactName, string>> = {
  [CheckedArtifact.schema.enum.plan]: "plan.md",
  [CheckedArtifact.schema.enum.tasks]: "tasks.md",
};

function folderItems(decided: FolderOutcome, artifact: CheckedArtifactName): StopItem[] {
  const { entry, inside, governing } = decided;
  const broken: StopItem[] = decided.broken.map(({ file, rule, message }) => ({
    kind: "broken",
    fill: { entry, file, rule, message },
  }));
  if (decided.couldNotRun !== null) return [{ kind: "folder", couldNotRun: decided.couldNotRun }, ...broken];
  if (decided.outcome === PASS) {
    const records = governing.map(({ recordId, title }) => `${recordId} ${title}`).join(", ");
    return governing.length > 0 ? [{ kind: "governed", fill: { entry, records } }] : [{ kind: "ungoverned", fill: { entry } }];
  }
  const departures: StopItem[] = decided.departures.map(({ record, path, stories, why }) => ({
    kind: inside ? "departure-inside" : "departure-outside",
    fill: {
      artifact: ARTIFACT_FILE[artifact],
      entry,
      id: record,
      path,
      stories: stories.length > 0 ? ` (story ${stories.join(", ")})` : "",
      why,
    },
  }));
  return [...departures, ...broken];
}

/** Every asked folder's lines, in list order, then a line per folder the verdict names that was not asked. */
export function decideCheck(asked: AdrAsked, verdict: AdrVerdict | null, rulings: readonly AdrRuling[]): StopItem[] {
  const entries = new Set(asked.folders.map(({ entry }) => entry));
  const unasked = Map.groupBy(
    (verdict?.verdicts ?? []).filter(({ folder }) => !entries.has(folder)),
    ({ folder }) => folder,
  );
  return [
    ...asked.folders.flatMap((folder) => folderItems(decideFolder(folder, asked.paths, verdict, rulings), asked.artifact)),
    ...[...unasked].map(([folder, judged]): StopItem => ({
      kind: "folder",
      couldNotRun: verdictMismatch(folder, judged.map(({ record }) => `names ${record} not governing`)),
    })),
  ];
}
