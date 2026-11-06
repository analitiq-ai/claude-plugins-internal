import { sortedJsonText } from "../core/contracts/json-text.ts";
import {
  ADR_RULINGS_FILE,
  type AdrAsked,
  type AdrRuling,
  type AdrVerdict,
  type ArtifactPath,
  ASKED_FILE,
  REVIEW_QUESTIONS_FILE,
  rulingKey,
  STOP_FILE,
  TOUCHES_FILE,
  VERDICT_FILE,
} from "../core/contracts/decision-check.ts";
import type { CouldNotRun } from "../core/outcomes.ts";
import { oneLine } from "../core/one-line.ts";
import { AdrJudgment, CheckOutcome } from "../core/values.ts";

const { PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;
/** The outcomes a check line has: a folder is never pending, silent or waived. */
type Outcome = typeof PASS | typeof FAIL | typeof COULD_NOT_RUN;

export type StopKind =
  | "empty"
  | "governed"
  | "ungoverned"
  | "departure-inside"
  | "departure-outside"
  | "broken"
  | "folder"
  | "verdict-unread"
  | "verdict-mismatch"
  | "rounds"
  | "stop-unread"
  | "step-unfinished"
  | "tasks-unfinished"
  | "touches-refused"
  | "touches-missing"
  | "touches-stale"
  | "questions-refused"
  | "tasks-refused"
  | "tasks-empty"
  | "sub-issues-extra"
  | "sub-issues-foreign"
  | "sub-issues-misplaced"
  | "github"
  | "rulings-refused"
  | "ruling-refused"
  | "guard-rulings"
  | "guard-paths"
  | "guard-asked"
  | "settings"
  | "git";

/** `{name}` in a template is filled from the item; `unanswered` names the model step whose error, when that step
 *  failed, the driver shows beside the row. */
export type StopRow = { outcome: Outcome; label: string; what: string; next: string | null; unanswered: string | null };

const RESUME = "resume to run the check again";
const DEPARTURE = "{record} on {path}{stories}: {why}";
const AS_WRITTEN_AGAIN = "delete tasks.md, then resume: the next round writes it again from the plan";

function row(outcome: Outcome, label: string, what: string, next: string | null, unanswered: string | null = null): StopRow {
  return { outcome, label, what, next, unanswered };
}

/** The stop table of contracts/workflow-steps.md, row for row: every line any check step prints is one of these. */
export const ADR_STOPS: Readonly<Record<StopKind, StopRow>> = {
  empty: row(PASS, "codeworks.toml", "No ADR folder is listed in [shared] adr_folders", null),
  governed: row(PASS, "{entry}", "governing: {records}", null),
  ungoverned: row(PASS, "{entry}", "no record governs these paths", null),
  "departure-inside": row(
    FAIL,
    "{entry}",
    DEPARTURE,
    "change plan.md (the next round writes tasks.md again from it); draft a superseding record into the spec PR (planner ADR-0009 d3); " +
      "or resume with adr_ruling naming {entry}, {record}, {path} and your reason",
  ),
  "departure-outside": row(
    FAIL,
    "{entry}",
    DEPARTURE,
    "change plan.md (the next round writes tasks.md again from it); change record {record} in the repo that holds {entry}; " +
      "or resume with adr_ruling naming {entry}, {record}, {path} and your reason",
  ),
  broken: row(FAIL, "{entry}", "{file}: {rule}: {message}", "fix that record (in the spec PR, or in the repo that holds {entry})"),
  // Core's reason is the whole line after the outcome, its Next step included; adrStop prints it as it is.
  folder: row(COULD_NOT_RUN, "{entry}", "{what}", null),
  "verdict-unread": row(COULD_NOT_RUN, VERDICT_FILE, "{what}", RESUME, "adr-judge"),
  "verdict-mismatch": row(COULD_NOT_RUN, "{entry}", "{what}", RESUME),
  rounds: row(COULD_NOT_RUN, "adr-check", "the check ran 100 rounds in one run", "discard the run's changes to {spec}, then start again: {again}"),
  "stop-unread": row(COULD_NOT_RUN, STOP_FILE, "does not parse", RESUME),
  "step-unfinished": row(COULD_NOT_RUN, "adr-check", "step {steps} did not finish this round (no done record)", "fix what the step's error names, then resume"),
  "tasks-unfinished": row(COULD_NOT_RUN, "tasks.md", "the tasks command did not answer (its exit code is not 0)", RESUME, "adr-tasks"),
  "touches-refused": row(COULD_NOT_RUN, TOUCHES_FILE, "{what}", RESUME),
  "touches-missing": row(COULD_NOT_RUN, TOUCHES_FILE, "{what}", RESUME, "adr-touches"),
  "touches-stale": row(COULD_NOT_RUN, TOUCHES_FILE, "plan.md or spec.md changed after this round listed the plan's paths", RESUME),
  "questions-refused": row(FAIL, REVIEW_QUESTIONS_FILE, "{what}", "rerun the rescope from `/planner:issue-spec rescope`"),
  "tasks-refused": row(FAIL, "{where}", "{what}", `${AS_WRITTEN_AGAIN}; if the line comes back, change spec.md or plan.md first`),
  "tasks-empty": row(COULD_NOT_RUN, "tasks.md", "no task line names a path", AS_WRITTEN_AGAIN),
  "sub-issues-extra": row(
    FAIL,
    "#{issue}",
    "{count} sub-issues for {stories} stories; the extra: {extra}",
    "remove them from #{issue}'s sub-issues, or add their stories to spec.md, then resume",
  ),
  "sub-issues-foreign": row(FAIL, "#{issue}", "sub-issue {sub} is in another repository", "remove it from #{issue}'s sub-issues, then resume"),
  "sub-issues-misplaced": row(
    FAIL,
    "#{issue}",
    "sub-issue {position} is #{sub}, but tasks.md labels US{position} with {label}",
    "order #{issue}'s sub-issues so sub-issue {position} is US{position}'s issue, then resume",
  ),
  github: row(COULD_NOT_RUN, "GitHub", "{what}", RESUME),
  "rulings-refused": row(FAIL, ADR_RULINGS_FILE, "{what}", `correct {spec}/${ADR_RULINGS_FILE}, then resume`),
  "ruling-refused": row(FAIL, "adr_ruling", "{what}", "resume with a corrected adr_ruling, or without one"),
  "guard-rulings": row(
    COULD_NOT_RUN,
    ADR_RULINGS_FILE,
    "entry {folder} {record} {path} was not written by the check",
    "remove the entry; only a resume with adr_ruling adds one",
  ),
  "guard-paths": row(COULD_NOT_RUN, "{file}", "changed after ask: {changed}", RESUME),
  "guard-asked": row(COULD_NOT_RUN, ASKED_FILE, "changed after ask", RESUME),
  settings: row(COULD_NOT_RUN, "codeworks.toml", "{what}", "fix codeworks.toml at HEAD, then resume"),
  git: row(COULD_NOT_RUN, "git", "{what}", "run from a git checkout of the repo, then resume"),
};

export type StopItem = { kind: "folder"; couldNotRun: CouldNotRun } | { kind: Exclude<StopKind, "folder">; fill: Readonly<Record<string, string>> };

// A stop is read line by line, and its values carry text from git, Zod and the judge that may span lines.
function filled(template: string, fill: Readonly<Record<string, string>>): string {
  return template.replace(/\{([a-z]+)\}/g, (_, name: string) => {
    const value = fill[name];
    if (value === undefined) throw new TypeError(`the stop template ${JSON.stringify(template)} needs ${name}`);
    return oneLine(value);
  });
}

const EXIT: Readonly<Record<Outcome, number>> = { [PASS]: 0, [FAIL]: 1, [COULD_NOT_RUN]: 2 };

/** Each item as its line, and the stop's exit: 2 when any line could not run, else 1 when any fails, else 0. */
export function adrStop(items: readonly StopItem[]): { lines: string[]; exit: number } {
  const lines = items.map((item) => {
    if (item.kind === "folder") return `${COULD_NOT_RUN}: ${oneLine(item.couldNotRun.reason)}`;
    const { outcome, label, what, next } = ADR_STOPS[item.kind];
    const said = `${outcome}: ${filled(label, item.fill)}: ${filled(what, item.fill).replace(/\.$/, "")}`;
    return next === null ? `${said}.` : `${said}. Next step: ${filled(next, item.fill)}.`;
  });
  const exit = Math.max(0, ...items.map((item) => EXIT[ADR_STOPS[item.kind].outcome]));
  return { lines, exit };
}

/** The `rounds` stop: the next step differs for a new run and a rescope, which has a branch to restore from. */
export function roundsStop(kind: string, issue: number, spec: string): StopItem {
  const again =
    kind === "rescope"
      ? `restore ${spec} to the branch's last commit and run \`/planner:issue-spec rescope ${spec} #${issue}\``
      : `remove ${spec} and run \`/planner:issue-spec #${issue} [<dir>]\``;
  return { kind: "rounds", fill: { spec, again } };
}

/** What `now` holds that `recorded` does not, and the reverse, each item compared whole whatever its key order. */
export function changedSince<Item>(recorded: readonly Item[], now: readonly Item[]): { added: Item[]; removed: Item[] } {
  const keys = (items: readonly Item[]) => new Set(items.map((item) => sortedJsonText(item)));
  const was = keys(recorded);
  const is = keys(now);
  return { added: now.filter((item) => !was.has(sortedJsonText(item))), removed: recorded.filter((item) => !is.has(sortedJsonText(item))) };
}

type Departure = { record: string; path: string; stories: string[]; why: string };
type Broken = Extract<AdrAsked["folders"][number], { broken: unknown }>["broken"];

export type FolderOutcome = {
  entry: string;
  inside: boolean;
  outcome: Outcome;
  governing: { recordId: string; title: string }[];
  /** The departures no ruling names. */
  departures: Departure[];
  broken: Broken;
  couldNotRun: CouldNotRun | null;
  /** How the verdict fails to answer the asked record for this folder; non-empty makes the folder could not run. */
  mismatch: string[];
};

type Verdict = AdrVerdict["verdicts"][number];

/** One folder's outcome from what ask found in it, the judge's verdicts and the user's rulings (R8). */
export function decideFolder(
  folder: AdrAsked["folders"][number],
  verdicts: readonly Verdict[],
  asked: readonly ArtifactPath[],
  rulings: readonly AdrRuling[],
): FolderOutcome {
  const { entry, inside } = folder;
  if ("outcome" in folder) {
    return { entry, inside, outcome: COULD_NOT_RUN, governing: [], departures: [], broken: [], couldNotRun: folder.outcome, mismatch: [] };
  }
  const { governing, broken } = folder;
  const own = verdicts.filter((verdict) => verdict.folder === entry);
  const governingIds = new Set(governing.map((record) => record.recordId));
  const judged = new Set(own.map((verdict) => verdict.record));
  const askedPaths = new Set(asked.map((one) => one.path));
  const mismatch = [
    ...[...governingIds].filter((id) => !judged.has(id)).map((id) => `the verdict misses governing ${id}`),
    ...[...judged].filter((id) => !governingIds.has(id)).map((id) => `the verdict names ${id}, which does not govern these paths`),
    ...[...new Set(own.flatMap((verdict) => verdict.paths))].filter((path) => !askedPaths.has(path)).map((path) => `the verdict names ${path}, which was not asked`),
  ];
  if (mismatch.length > 0) {
    return { entry, inside, outcome: COULD_NOT_RUN, governing, departures: [], broken, couldNotRun: null, mismatch };
  }
  const ruled = new Set(rulings.map(rulingKey));
  const departures = own
    .filter((verdict) => verdict.judgment === AdrJudgment.schema.enum.DEPARTS)
    .flatMap(({ record, paths, why }) =>
      paths
        .filter((path) => !ruled.has(rulingKey({ folder: entry, record, path })))
        .map((path) => ({
          record,
          path,
          stories: [...new Set(asked.flatMap((one) => (one.path === path && one.story !== null ? [one.story] : [])))],
          why,
        })),
    );
  const outcome = departures.length > 0 || broken.length > 0 ? FAIL : PASS;
  return { entry, inside, outcome, governing, departures, broken, couldNotRun: null, mismatch: [] };
}

function folderItems(folder: FolderOutcome): StopItem[] {
  const { entry } = folder;
  if (folder.couldNotRun !== null) return [{ kind: "folder", couldNotRun: folder.couldNotRun }];
  if (folder.mismatch.length > 0) return [{ kind: "verdict-mismatch", fill: { entry, what: folder.mismatch.join("; ") } }];
  if (folder.outcome === PASS) {
    if (folder.governing.length === 0) return [{ kind: "ungoverned", fill: { entry } }];
    return [{ kind: "governed", fill: { entry, records: folder.governing.map((record) => `${record.recordId} ${record.title}`).join(", ") } }];
  }
  const departures: StopItem[] = folder.departures.map(({ record, path, stories, why }) => ({
    kind: folder.inside ? "departure-inside" : "departure-outside",
    fill: { entry, record, path, why, stories: stories.length === 0 ? "" : ` (story ${stories.join(", ")})` },
  }));
  const broken: StopItem[] = folder.broken.map(({ file, rule, message }) => ({ kind: "broken", fill: { entry, file, rule, message } }));
  return [...departures, ...broken];
}

/** Every folder's lines, in list order, from the asked record, the verdict and the rulings; a verdict on a folder
 *  the record does not hold could not run. */
export function decideCheck(asked: AdrAsked, verdict: AdrVerdict, rulings: readonly AdrRuling[]): StopItem[] {
  const entries = new Set(asked.folders.map((folder) => folder.entry));
  const strangers = [...new Set(verdict.verdicts.map((one) => one.folder))].filter((entry) => !entries.has(entry));
  return [
    ...asked.folders.flatMap((folder) => folderItems(decideFolder(folder, verdict.verdicts, asked.paths, rulings))),
    ...strangers.map((entry): StopItem => ({ kind: "verdict-mismatch", fill: { entry, what: "the verdict names a folder [shared] adr_folders does not list" } })),
  ];
}
