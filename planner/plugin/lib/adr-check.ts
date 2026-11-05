// planner's ADR check (planner ADR-0009): the stop table, and pure functions.
import { posix } from "node:path";
import { isDeepStrictEqual } from "node:util";

import type { AdrAnswer } from "../core/adr.ts";
import type { AdrAsked, AdrRuling, AdrVerdict, ArtifactPath } from "../core/contracts/decision-check.ts";
import { ADR_RULINGS_FILE, ASKED_FILE, REVIEW_QUESTIONS_FILE, STOP_FILE, TOUCHES_FILE, VERDICT_FILE } from "../core/contracts/decision-check.ts";
import { couldNotRun, type CouldNotRun } from "../core/outcomes.ts";
import { SETTINGS_FILE } from "../core/settings.ts";
import { AdrJudgment, CheckOutcome } from "../core/values.ts";

const { PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;
const { DEPARTS } = AdrJudgment.schema.enum;

type StopOutcome = typeof PASS | typeof FAIL | typeof COULD_NOT_RUN;
/** `label` and `what` are the table's text, or null where the stop gives its own (a `folder` stop gives neither: its
 *  line is core's CouldNotRun); `<name>` in `next` is filled from the stop's `fill`. */
type StopRow = { outcome: StopOutcome; label: string | null; what: string | null; next: string | null };

const CHECK_AGAIN = "resume to run the check again";
const CHANGE_PLAN = "change plan.md (the next round writes tasks.md again from it)";
const RULE_ON = "resume with adr_ruling naming <entry>, <id>, <path> and your reason";
const WRITE_TASKS_AGAIN = "delete tasks.md, then resume: the next round writes it again from the plan";
// workflow.yml's max_iterations for the adr-check loop.
const ROUNDS = 100;

/** One row per kind of workflow-steps.md's stop table; the departure rows lack its text for a departure found at
 *  review. A `folder` stop prints its CouldNotRun reason. */
export const ADR_STOPS = {
  empty: { outcome: PASS, label: SETTINGS_FILE, what: "No ADR folder is listed in [shared] adr_folders", next: null },
  governed: { outcome: PASS, label: null, what: null, next: null },
  ungoverned: { outcome: PASS, label: null, what: "no record governs these paths", next: null },
  "departure-inside": {
    outcome: FAIL,
    label: null,
    what: null,
    next: `${CHANGE_PLAN}; draft a superseding record into the spec PR (planner ADR-0009 d3); or ${RULE_ON}`,
  },
  "departure-outside": {
    outcome: FAIL,
    label: null,
    what: null,
    next: `${CHANGE_PLAN}; change record <id> in the repo that holds <entry>; or ${RULE_ON}`,
  },
  broken: { outcome: FAIL, label: null, what: null, next: "fix that record (in the spec PR, or in the repo that holds <entry>)" },
  folder: { outcome: COULD_NOT_RUN, label: null, what: null, next: null },
  "verdict-unread": { outcome: COULD_NOT_RUN, label: VERDICT_FILE, what: null, next: CHECK_AGAIN },
  "verdict-mismatch": { outcome: COULD_NOT_RUN, label: null, what: null, next: CHECK_AGAIN },
  rounds: {
    outcome: COULD_NOT_RUN,
    label: "adr-check",
    what: `the check ran ${ROUNDS} rounds in one run`,
    next: "discard the run's changes to <spec folder>, then start again: <start again>",
  },
  "stop-unread": { outcome: COULD_NOT_RUN, label: STOP_FILE, what: "does not parse", next: CHECK_AGAIN },
  "step-unfinished": { outcome: COULD_NOT_RUN, label: "adr-check", what: null, next: "fix what the step's error names, then resume" },
  "tasks-unfinished": {
    outcome: COULD_NOT_RUN,
    label: "tasks.md",
    what: "the tasks command did not answer (its exit code not 0)",
    next: CHECK_AGAIN,
  },
  "touches-refused": { outcome: COULD_NOT_RUN, label: TOUCHES_FILE, what: null, next: CHECK_AGAIN },
  "touches-missing": { outcome: COULD_NOT_RUN, label: TOUCHES_FILE, what: null, next: CHECK_AGAIN },
  "touches-stale": {
    outcome: COULD_NOT_RUN,
    label: TOUCHES_FILE,
    what: "plan.md or spec.md changed after this round listed the plan's paths",
    next: CHECK_AGAIN,
  },
  "questions-refused": { outcome: FAIL, label: REVIEW_QUESTIONS_FILE, what: null, next: "rerun the rescope from /planner:issue-spec rescope" },
  "tasks-refused": {
    outcome: FAIL,
    label: null,
    what: null,
    next: `${WRITE_TASKS_AGAIN}; if the line comes back, change spec.md or plan.md first`,
  },
  "tasks-empty": { outcome: COULD_NOT_RUN, label: "tasks.md", what: "no task line names a path", next: WRITE_TASKS_AGAIN },
  "sub-issues-extra": {
    outcome: FAIL,
    label: null,
    what: null,
    next: "remove them from #<issue>'s sub-issues, or add their stories to spec.md, then resume",
  },
  "sub-issues-foreign": { outcome: FAIL, label: null, what: null, next: "remove it from #<issue>'s sub-issues, then resume" },
  "sub-issues-misplaced": {
    outcome: FAIL,
    label: null,
    what: null,
    next: "order #<issue>'s sub-issues so sub-issue <i> is US<i>'s issue, then resume",
  },
  github: { outcome: COULD_NOT_RUN, label: "GitHub", what: null, next: CHECK_AGAIN },
  "rulings-refused": { outcome: FAIL, label: ADR_RULINGS_FILE, what: null, next: `correct <spec folder>/${ADR_RULINGS_FILE}, then resume` },
  "ruling-refused": { outcome: FAIL, label: "adr_ruling", what: null, next: "resume with a corrected adr_ruling, or without one" },
  "guard-rulings": {
    outcome: COULD_NOT_RUN,
    label: ADR_RULINGS_FILE,
    what: null,
    next: "remove the entry; only a resume with adr_ruling adds one",
  },
  "guard-paths": { outcome: COULD_NOT_RUN, label: null, what: null, next: CHECK_AGAIN },
  "guard-asked": { outcome: COULD_NOT_RUN, label: ASKED_FILE, what: "changed after ask", next: CHECK_AGAIN },
  settings: { outcome: COULD_NOT_RUN, label: SETTINGS_FILE, what: null, next: `fix ${SETTINGS_FILE} at HEAD, then resume` },
  git: { outcome: COULD_NOT_RUN, label: "git", what: null, next: "run from a git checkout of the repo, then resume" },
} as const satisfies Record<string, StopRow>;

type Stops = typeof ADR_STOPS;
export type StopKind = keyof Stops;

type Placeholders<Text> = Text extends `${string}<${infer Name}>${infer Rest}` ? Name | Placeholders<Rest> : never;
type Given<Kind extends StopKind> = (Stops[Kind]["label"] extends string ? unknown : { label: string }) &
  (Stops[Kind]["what"] extends string ? unknown : { what: string }) &
  ([Placeholders<Stops[Kind]["next"]>] extends [never] ? unknown : { fill: Readonly<Record<Placeholders<Stops[Kind]["next"]>, string>> });

/** The kinds whose line their row renders: every kind but `folder`. */
type RowKind = Exclude<StopKind, "folder">;
export type StopItem = { kind: "folder"; couldNotRun: CouldNotRun } | { [Kind in RowKind]: { kind: Kind } & Given<Kind> }[RowKind];

const PLACEHOLDER = /<([^<>]+)>/g;
const LINE_BREAK = /\s*\n\s*/g;

function filled(text: string, fill: Readonly<Record<string, string>>): string {
  return text.replace(PLACEHOLDER, (_, name: string) => {
    const value = fill[name];
    if (value === undefined) throw new TypeError(`no value for <${name}> in ${JSON.stringify(text)}`);
    return value;
  });
}

/** Any stop but a `folder` one, as its row reads it. */
type PlainItem = { kind: RowKind; label?: string; what?: string; fill?: Readonly<Record<string, string>> };

function given(text: string | null, item: PlainItem, field: "label" | "what"): string {
  const value = text ?? item[field];
  if (value === undefined) throw new TypeError(`a ${item.kind} stop gives no ${field}`);
  return value;
}

/** What a line says after its label: `<what>.`, then ` Next step: <next>.` unless the row has none. */
function after(item: PlainItem): string {
  const { what, next } = ADR_STOPS[item.kind];
  const said = `${given(what, item, "what")}.`;
  return next === null ? said : `${said} Next step: ${filled(next, item.fill ?? {})}.`;
}

/** A stop's label and what, from its row or, where the row has none, from the stop. */
export function stopWords(item: Exclude<StopItem, { kind: "folder" }>): { label: string; what: string } {
  const plain: PlainItem = item;
  const { label, what } = ADR_STOPS[plain.kind];
  return { label: given(label, plain, "label"), what: given(what, plain, "what") };
}

function said(item: StopItem): string {
  if (item.kind === "folder") return item.couldNotRun.reason;
  return `${stopWords(item).label}: ${after(item)}`;
}

/** One line per item, `<OUTCOME>: <label>: <what>.`, then ` Next step: <next>.` where the row has one (a `folder`
 *  item's line is `COULD_NOT_RUN: ` and core's CouldNotRun reason); exit 2 when any is COULD_NOT_RUN, else 1 when any
 *  is FAIL, else 0. */
export function adrStop(items: readonly StopItem[]): { lines: string[]; exit: number } {
  const outcomes = items.map((item) => ADR_STOPS[item.kind].outcome);
  // A what can be a parser's or git's several-line message; the session reads one line per item.
  const lines = items.map((item, i) => `${outcomes[i]}: ${said(item).replace(LINE_BREAK, " ")}`);
  const exit = outcomes.includes(COULD_NOT_RUN) ? 2 : outcomes.includes(FAIL) ? 1 : 0;
  return { lines, exit };
}

export type RunKind = "new" | "rescope";

// A new run's spec folder has never landed, so it is removed and scoped again; a rescope's is on its branch.
const START_AGAIN = {
  new: "remove <spec folder> and run <new run>",
  rescope: "restore <spec folder> to the branch's last commit and run /planner:issue-spec rescope <spec folder> #<issue>",
} as const satisfies Record<RunKind, string>;

/** `/planner:issue-spec #<issue> [<dir>]`, scoping `issue` again into the project that holds `specFolder`, a folder
 *  from the checkout's top (`<dir>/specs/<name>`, or `specs/<name>` in the top's own project). */
export function newRunCommand(issue: string, specFolder: string): string {
  const project = posix.dirname(posix.dirname(specFolder));
  return `/planner:issue-spec #${issue}${project === "." ? "" : ` ${project}`}`;
}

/** The stop of a check loop that ran out of rounds; `specFolder` is from the checkout's top, as the skill's entry
 *  points take it. */
export function roundsStop(runKind: RunKind, issue: string, specFolder: string): StopItem {
  const startAgain = filled(START_AGAIN[runKind], { "spec folder": specFolder, issue, "new run": newRunCommand(issue, specFolder) });
  return { kind: "rounds", fill: { "spec folder": specFolder, "start again": startAgain } };
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
  outcome: StopOutcome;
  governing: AdrAnswer["governing"];
  departures: Departure[];
  broken: AdrAnswer["broken"];
  couldNotRun: CouldNotRun | null;
};

function verdictMismatch(entry: string, parts: readonly string[]): { kind: "verdict-mismatch"; label: string; what: string } {
  return { kind: "verdict-mismatch", label: entry, what: `the verdict ${parts.join(", ")}` };
}

// Rulings are keyed on folder, record and path, never on a reason or a story.
export function isRuled(rulings: readonly Omit<AdrRuling, "reason">[], { folder, record, path }: Omit<AdrRuling, "reason">): boolean {
  return rulings.some((ruling) => ruling.folder === folder && ruling.record === record && ruling.path === path);
}

function storiesNaming(paths: readonly ArtifactPath[], path: string): string[] {
  return [...new Set(paths.flatMap((at) => (at.path === path && at.story !== null ? [at.story] : [])))];
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
    const mismatch = couldNotRun(entry, after(verdictMismatch(entry, mismatches)));
    return { entry, inside, outcome: COULD_NOT_RUN, governing, departures: [], broken, couldNotRun: mismatch };
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

function folderItems({ entry, inside, outcome, governing, departures, broken, couldNotRun: notRun }: FolderOutcome): StopItem[] {
  const brokenItems = broken.map(({ file, rule, message }): StopItem => ({
    kind: "broken",
    label: entry,
    what: `${file}: ${rule}: ${message}`,
    fill: { entry },
  }));
  if (notRun !== null) return [{ kind: "folder", couldNotRun: notRun }, ...brokenItems];
  if (outcome === PASS) {
    if (governing.length === 0) return [{ kind: "ungoverned", label: entry }];
    return [{ kind: "governed", label: entry, what: `governing: ${governing.map(({ recordId, title }) => `${recordId} ${title}`).join(", ")}` }];
  }
  const departureItems = departures.map(({ record, path, stories, why }): StopItem => ({
    kind: inside ? "departure-inside" : "departure-outside",
    label: entry,
    what: `${record} on ${path}${stories.length > 0 ? ` (story ${stories.join(", ")})` : ""}: ${why}`,
    fill: { entry, id: record, path },
  }));
  return [...departureItems, ...brokenItems];
}

/** Every asked folder's lines, in list order, then a line per folder the verdict names that was not asked. */
export function decideCheck(asked: AdrAsked, verdict: AdrVerdict | null, rulings: readonly AdrRuling[]): StopItem[] {
  const entries = new Set(asked.folders.map(({ entry }) => entry));
  const unasked = Map.groupBy(
    (verdict?.verdicts ?? []).filter(({ folder }) => !entries.has(folder)),
    ({ folder }) => folder,
  );
  return [
    ...asked.folders.flatMap((folder) => folderItems(decideFolder(folder, asked.paths, verdict, rulings))),
    ...[...unasked].map(([folder, judged]) => verdictMismatch(folder, judged.map(({ record }) => `names ${record} not governing`))),
  ];
}
