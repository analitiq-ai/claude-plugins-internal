// The plan check's shell steps (planner ADR-0009, specs/177-plan-adr-check/contracts/workflow-steps.md). The stop table and the folder decision are
// ../lib/adr-check.ts's; every stop line it prints is one `adrStop` rendered.
//
// Usage:
//   adr_check.ts clear         <spec folder> <run folder>
//   adr_check.ts tasks-due     <spec folder> <run folder>
//   adr_check.ts tasks-written <run folder> <tasks exit code>
//   adr_check.ts stories       <issue> <kind> <spec folder> <run folder>
//   adr_check.ts ask           <spec folder> <run folder> <touches exit code>
//   adr_check.ts decide        <spec folder> <run folder> <asked digest> <judge exit code>
//   adr_check.ts report        <spec folder> <run folder>
//   adr_check.ts stop          rounds <kind> <issue> <spec folder>
//
// Anything past the guard is loaded with `await import(...)`: a static import would be evaluated before the guard
// runs. A type-only import is erased, so it loads nothing.
import "../lib/guarded.ts";

import type { ResolvedAdrFolder } from "../core/adr-folders.ts";
import type { AdrAsked, AdrRuling, AdrStepDone, AdrStopRecord, AdrVerdict, ArtifactPath, SourceHashes as SourceHashesType } from "../core/contracts/decision-check.ts";
import type { GitHubClient } from "../core/github.ts";
import type { CouldNotRun } from "../core/outcomes.ts";
import type { StopItem } from "../lib/adr-check.ts";
import type { CheckoutSettings } from "../lib/settings.ts";
import type { Mint } from "../lib/github.ts";

const { createHash } = await import("node:crypto");
const { existsSync, mkdirSync, realpathSync, renameSync, rmSync } = await import("node:fs");
const { dirname, posix, resolve } = await import("node:path");
const { z } = await import("zod");
const { checkAdrFolder } = await import("../core/adr.ts");
const { adrFolders, checkoutToplevel } = await import("../core/adr-folders.ts");
const decisionCheck = await import("../core/contracts/decision-check.ts");
const { sortedJsonText } = await import("../core/contracts/json-text.ts");
const { TaskLineRefused, TaskBlockLabelRefused, readTaskBlockLabels, readTaskPaths } = await import("../core/contracts/tasks.ts");
const { jsonOf, textIfPresent, writeWhole } = await import("../core/files.ts");
const { GhFolderRefused } = await import("../core/gh-config.ts");
const { GitFailed, runGit } = await import("../core/git.ts");
const { gitHub, GitHubPartlyAnswered, GitHubRefused, GitHubUnanswered, RemoteRefused } = await import("../core/github.ts");
const { KeyReadRefused } = await import("../core/keys.ts");
const { SettingsError } = await import("../core/settings.ts");
const { MintError } = await import("../core/tokens.ts");
const { gitTree, NotInTree } = await import("../core/tree.ts");
const { ADR_STOPS, adrStop, changedSince, decideCheck, decideFolder, roundsStop } = await import("../lib/adr-check.ts");
const { mintPlannerToken, NoOrigin, originRepository, plannerGitHub, readRepository, readSubIssues } = await import("../lib/github.ts");
const { readPlannerSettings } = await import("../lib/settings.ts");
const { storyPlan, subIssueProblem, TasksRefused } = await import("../lib/story-plan.ts");

const {
  ADR_RULINGS_FILE,
  ADR_RULINGS_WRITTEN_FILE,
  AdrAsked: AdrAskedSchema,
  AdrRuling: AdrRulingSchema,
  AdrRulings,
  AdrStepDone: AdrStepDoneSchema,
  AdrStopRecord: AdrStopRecordSchema,
  AdrVerdict: AdrVerdictSchema,
  ASKED_FILE,
  INPUTS_FILE,
  PathRefused,
  readRulings,
  readTouchedPaths,
  ROUND_FILES,
  roundInputPaths,
  RulingsRefused,
  rulingKey,
  SourceHashes,
  sourceHashes,
  STEPS_DIR,
  STOP_FILE,
  TASKS_SOURCES_FILE,
  TASKS_SOURCES_NEXT_FILE,
  tasksSourcePaths,
  TOUCHES_FILE,
  TOUCHES_FROM_FILE,
  TouchesRefused,
  VERDICT_FILE,
} = decisionCheck;

const USAGE = [
  "Usage: adr_check.ts clear <spec folder> <run folder>",
  "       adr_check.ts tasks-due <spec folder> <run folder>",
  "       adr_check.ts tasks-written <run folder> <tasks exit code>",
  "       adr_check.ts stories <issue> <kind> <spec folder> <run folder>",
  "       adr_check.ts ask <spec folder> <run folder> <touches exit code>",
  "       adr_check.ts decide <spec folder> <run folder> <asked digest> <judge exit code>",
  "       adr_check.ts report <spec folder> <run folder>",
  "       adr_check.ts stop rounds <kind> <issue> <spec folder>",
].join("\n");

/** Under the check steps' 1800 s timeout, so a slow `adr` is reported before the engine kills the step. */
export const ADR_DEADLINE_MS = 1_500_000;

const KINDS = new Set(["new", "rescope"]);
// A model step answered only when the engine gives its exit code as exactly this.
const ANSWERED = "0";

export type AdrCheckIo = {
  /** The workflow's cwd: the checkout the round's folders are relative to. */
  checkout: string;
  connect: (token: string) => GitHubClient;
  mint: Mint;
  /** The resume's `ADR_RULING`, unset when the resume carries none. */
  adrRuling: string | undefined;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

/** One round's folders as given on the command line; spec is "" for tasks-written. */
type Round = { io: AdrCheckIo; spec: string; run: string };

function inRun(round: Round, name: string): string {
  return resolve(round.io.checkout, round.run, name);
}

function inSpec(round: Round, name: string): string {
  return resolve(round.io.checkout, round.spec, name);
}

function writeRecord(path: string, value: unknown): string {
  const text = sortedJsonText(value);
  mkdirSync(dirname(path), { recursive: true });
  writeWhole(path, text, renameSync);
  return text;
}

// A stop the step found; `checked` records it unless the round already holds one.
class Found extends Error {
  readonly items: readonly StopItem[];
  constructor(items: readonly StopItem[]) {
    super(`${items.length} stop item(s)`);
    this.name = "Found";
    this.items = items;
  }
}

function found(...items: StopItem[]): never {
  throw new Found(items);
}

/** The stop row of a failure this maps; null for any other, which `checked` throws on. */
function stopOf(error: unknown, spec: string): StopItem | null {
  if (error instanceof SettingsError) return { kind: "settings", fill: { what: error.message } };
  if (error instanceof GitFailed) return { kind: "git", fill: { what: error.message } };
  if (error instanceof RulingsRefused) return { kind: "rulings-refused", fill: { what: error.why, spec } };
  if (
    error instanceof GitHubUnanswered ||
    error instanceof GitHubPartlyAnswered ||
    error instanceof GitHubRefused ||
    error instanceof RemoteRefused ||
    error instanceof NoOrigin ||
    error instanceof GhFolderRefused ||
    error instanceof KeyReadRefused ||
    error instanceof MintError
  ) {
    return { kind: "github", fill: { what: error.message } };
  }
  return null;
}

function hasStop(round: Round): boolean {
  return existsSync(inRun(round, STOP_FILE));
}

function stopRecord(items: readonly StopItem[]): AdrStopRecord {
  const { lines, exit } = adrStop(items);
  if (exit !== 1 && exit !== 2) throw new TypeError(`a stop exits 1 or 2, not ${exit}: ${lines.join(" | ")}`);
  const unanswered = items.some((item) => item.kind !== "folder" && ADR_STOPS[item.kind].unanswered !== null);
  return { v: 1, exit, lines, shown: false, unanswered };
}

// A step keeps the round's first stop, so a later step never writes over it; report alone may show another.
function recordStop(round: Round, items: readonly StopItem[]): void {
  if (hasStop(round)) return;
  writeRecord(inRun(round, STOP_FILE), stopRecord(items));
}

/** True when the step's checks found a stop or failed as stopOf maps; recordStop records it unless the round holds
 *  one. */
async function checked(round: Round, checks: () => Promise<void>): Promise<boolean> {
  try {
    await checks();
    return false;
  } catch (error) {
    if (error instanceof Found) {
      recordStop(round, error.items);
      return true;
    }
    const item = stopOf(error, round.spec);
    if (item === null) throw error;
    recordStop(round, [item]);
    return true;
  }
}

// Each step's last act, after every other file it writes, whatever its answer.
function done(round: Round, record: AdrStepDone): void {
  writeRecord(inRun(round, `${STEPS_DIR}/${record.step}.json`), record);
}

function hashesOf(text: string | null): SourceHashesType | null {
  return text === null ? null : jsonOf(text, SourceHashes, () => null);
}

function sameHashes(recorded: SourceHashesType | null, now: SourceHashesType): boolean {
  return recorded !== null && sortedJsonText(recorded) === sortedJsonText(now);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

async function settingsOf(round: Round): Promise<CheckoutSettings> {
  return readPlannerSettings(round.io.checkout);
}

// --- clear --------------------------------------------------------------------------------------------------------

async function clear(round: Round): Promise<number> {
  for (const name of ROUND_FILES) rmSync(inRun(round, name), { recursive: true, force: true });
  const read = [posix.join(round.spec, "plan.md"), posix.join(round.spec, "spec.md")];
  writeRecord(inRun(round, TOUCHES_FROM_FILE), await sourceHashes(round.io.checkout, read));
  return 0;
}

// --- tasks-due, tasks-written -------------------------------------------------------------------------------------

async function tasksDue(round: Round): Promise<number> {
  const { checkout } = round.io;
  const next = await sourceHashes(checkout, await tasksSourcePaths(checkout, round.spec));
  writeRecord(inRun(round, TASKS_SOURCES_NEXT_FILE), next);
  const recorded = hashesOf(textIfPresent(inRun(round, TASKS_SOURCES_FILE)));
  const due = !existsSync(inSpec(round, "tasks.md")) || !sameHashes(recorded, next);
  // Only a tasks command that finished puts it back, so one that failed leaves the next round due.
  if (due) rmSync(inRun(round, TASKS_SOURCES_FILE), { force: true });
  done(round, { v: 1, step: "tasks-due", due });
  round.io.stdout(JSON.stringify({ due }));
  return 0;
}

function tasksWritten(round: Round, tasksCode: string): number {
  if (tasksCode === ANSWERED) {
    renameSync(inRun(round, TASKS_SOURCES_NEXT_FILE), inRun(round, TASKS_SOURCES_FILE));
  } else {
    recordStop(round, [{ kind: "tasks-unfinished", fill: {} }]);
  }
  done(round, { v: 1, step: "tasks-written" });
  return 0;
}

// --- stories ------------------------------------------------------------------------------------------------------

/** The folders `[shared] adr_folders` lists, as core's adrFolders resolves them. */
async function listedFolders(round: Round, settings: CheckoutSettings): Promise<ResolvedAdrFolder[]> {
  return adrFolders(round.io.checkout, settings.shared);
}

type Listed = { settings: CheckoutSettings; folders: ResolvedAdrFolder[] };

/** Settings and the folders they list, or the stop a settings or git failure is. */
async function listed(round: Round): Promise<Listed | StopItem> {
  try {
    const settings = await settingsOf(round);
    return { settings, folders: await listedFolders(round, settings) };
  } catch (error) {
    const item = stopOf(error, round.spec);
    if (item === null) throw error;
    return item;
  }
}

async function inputHashes(round: Round, folders: readonly ResolvedAdrFolder[]): Promise<SourceHashesType> {
  const { checkout } = round.io;
  const paths = await roundInputPaths(checkout, round.spec, round.run, folders.map((folder) => folder.path));
  return sourceHashes(checkout, paths);
}

// A tasks command that answered without writing tasks.md, or a file deleted since, stops the step reading it.
const TASKS_MISSING = { where: "tasks.md", what: "tasks.md is missing" };

async function storyChecks(round: Round, issue: number, kind: string, settings: CheckoutSettings): Promise<void> {
  const text = textIfPresent(inSpec(round, "tasks.md"));
  if (text === null) found({ kind: "tasks-refused", fill: TASKS_MISSING });
  let stories;
  let labels;
  try {
    stories = storyPlan(text);
    labels = readTaskBlockLabels(text);
  } catch (error) {
    if (!(error instanceof TasksRefused || error instanceof TaskBlockLabelRefused)) throw error;
    found({ kind: "tasks-refused", fill: { where: "tasks.md", what: error.why } });
  }
  // A rescope's sub-issues are its existing stories, which its new tasks.md may drop or reorder; reconciling them is
  // landing a rescope (#178), not this check.
  if (kind !== "new") return;
  const repo = await originRepository(round.io.checkout);
  const github = await plannerGitHub(repo, settings, round.io.connect, new Date(), round.io.mint);
  const { url } = await readRepository(github, repo);
  const subIssues = await readSubIssues(github, repo, issue);
  const problem = subIssueProblem(subIssues, stories, labels, url);
  if (problem === null) return;
  const on = String(issue);
  switch (problem.kind) {
    case "extra":
      found({
        kind: "sub-issues-extra",
        fill: {
          issue: on,
          count: String(subIssues.length),
          stories: String(stories.length),
          extra: problem.extra.map((n) => `#${n}`).join(", "),
        },
      });
    case "foreign":
      found(...problem.foreign.map((sub): StopItem => ({ kind: "sub-issues-foreign", fill: { issue: on, sub } })));
    case "misplaced":
      found(
        ...problem.misplaced.map(
          ({ position, sub, label }): StopItem => ({
            kind: "sub-issues-misplaced",
            fill: { issue: on, position: String(position), sub: String(sub), label: `#${label}` },
          }),
        ),
      );
  }
}

async function stories(round: Round, issue: number, kind: string): Promise<number> {
  const read = await listed(round);
  // First, whatever follows: the hashes of the repo files report compares to see the round went stale.
  writeRecord(inRun(round, INPUTS_FILE), await inputHashes(round, "settings" in read ? read.folders : []));
  if (!("settings" in read)) recordStop(round, [read]);
  else if (!hasStop(round)) await checked(round, () => storyChecks(round, issue, kind, read.settings));
  done(round, { v: 1, step: "stories" });
  return 0;
}

// --- the paths a round asks about, and the writer guard -----------------------------------------------------------

type AskedPaths = { plan: ArtifactPath[]; tasks: ArtifactPath[] };

type PathsStop = "touches-missing" | "touches-refused" | "tasks-refused";

// Ask records it as its row; decide, reading the paths again, as a change after ask to `file`.
class PathsUnread extends Error {
  readonly kind: PathsStop;
  readonly file: string;
  readonly fill: Readonly<Record<string, string>>;
  constructor(kind: PathsStop, file: string, fill: Readonly<Record<string, string>>) {
    super(`${kind}: ${fill.what}`);
    this.name = "PathsUnread";
    this.kind = kind;
    this.file = file;
    this.fill = fill;
  }
}

function touchesUnread(kind: Exclude<PathsStop, "tasks-refused">, what: string): never {
  throw new PathsUnread(kind, TOUCHES_FILE, { what });
}

function tasksUnread(where: string, what: string): never {
  throw new PathsUnread("tasks-refused", where, { where, what });
}

/** The plan's paths from touches.json and the task lines' paths from tasks.md, as ask and decide both read them. */
async function readAskedPaths(round: Round): Promise<AskedPaths> {
  const touchesText = textIfPresent(inRun(round, TOUCHES_FILE));
  if (touchesText === null) touchesUnread("touches-missing", `${TOUCHES_FILE} is missing`);
  let touchesJson: unknown;
  try {
    touchesJson = JSON.parse(touchesText);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    touchesUnread("touches-refused", `not JSON: ${error.message}`);
  }
  let plan: ArtifactPath[];
  try {
    plan = readTouchedPaths(touchesJson);
  } catch (error) {
    if (!(error instanceof TouchesRefused)) throw error;
    touchesUnread("touches-refused", error.why);
  }
  if (plan.length === 0) touchesUnread("touches-missing", `${TOUCHES_FILE} lists no path`);

  const tracked = (await runGit(round.io.checkout, ["ls-files", "-z"])).stdout.split("\0");
  const rootFiles = new Set([...tracked, ...plan.map((one) => one.path)].filter((path) => path !== "" && !path.includes("/")));
  const tasksText = textIfPresent(inSpec(round, "tasks.md"));
  if (tasksText === null) tasksUnread(TASKS_MISSING.where, TASKS_MISSING.what);
  let tasks: ArtifactPath[];
  try {
    tasks = readTaskPaths(tasksText, rootFiles);
  } catch (error) {
    // readTaskPaths names each span's line; a PathRefused with none is a defect, thrown as it is.
    if (error instanceof PathRefused && error.where !== null) tasksUnread(error.where, `${JSON.stringify(error.span)} ${error.why}`);
    if (error instanceof TaskLineRefused) tasksUnread(error.where, error.why);
    throw error;
  }
  return { plan, tasks };
}

async function rulingsAtHead(round: Round): Promise<AdrRuling[]> {
  const file = posix.join(round.spec, ADR_RULINGS_FILE);
  let text: string;
  try {
    text = await gitTree(round.io.checkout, "HEAD").readText(file);
  } catch (error) {
    if (!(error instanceof NotInTree)) throw error;
    return [];
  }
  return jsonOf(text, AdrRulings, (why) => {
    throw new RulingsRefused(`HEAD:${file}`, why);
  }).rulings;
}

// The run's record of what decide appended; one that does not parse is deleted, so the guard names every entry.
function rulingsWritten(round: Round): AdrRuling[] {
  const path = inRun(round, ADR_RULINGS_WRITTEN_FILE);
  const text = textIfPresent(path);
  if (text === null) return [];
  const parsed = jsonOf(text, AdrRulings, () => null);
  if (parsed === null) {
    rmSync(path, { force: true });
    return [];
  }
  return parsed.rulings;
}

/** R9 a: each rulings-file entry neither the file at HEAD nor the run's record holds. */
async function rulingsGuard(round: Round, rulings: readonly AdrRuling[]): Promise<StopItem[]> {
  const allowed = [...(await rulingsAtHead(round)), ...rulingsWritten(round)];
  return changedSince(allowed, rulings).added.map(({ folder, record, path }) => ({ kind: "guard-rulings", fill: { folder, record, path } }));
}

async function rulingsOf(round: Round): Promise<AdrRuling[]> {
  return readRulings(inSpec(round, ""));
}

// --- ask ----------------------------------------------------------------------------------------------------------

const NO_DECISION = { judge: false, decide: false, asked: "" };

function askedFolder(folder: ResolvedAdrFolder, answer: Awaited<ReturnType<typeof checkAdrFolder>>): AdrAsked["folders"][number] {
  const { entry, path, inside } = folder;
  if ("outcome" in answer) return { entry, path, inside, outcome: answer };
  return { entry, path, inside, governing: answer.governing, broken: answer.broken };
}

async function askChecks(round: Round, touchesCode: string): Promise<{ judge: boolean; asked: string }> {
  const { checkout } = round.io;
  const settings = await settingsOf(round);
  if (settings.shared.adr_folders.length === 0) {
    const text = writeRecord(inRun(round, ASKED_FILE), { v: 1, paths: [], folders: [] } satisfies AdrAsked);
    return { judge: false, asked: sha256(text) };
  }
  const toplevel = await checkoutToplevel(checkout);
  if (toplevel !== realpathSync(checkout)) {
    found({ kind: "git", fill: { what: `the check runs from the checkout's toplevel ${toplevel}, not ${checkout}` } });
  }
  if (touchesCode !== ANSWERED) {
    found({ kind: "touches-missing", fill: { what: "the touches step did not answer (its exit code is not 0)" } });
  }
  const from = hashesOf(textIfPresent(inRun(round, TOUCHES_FROM_FILE)));
  const now = await sourceHashes(checkout, [posix.join(round.spec, "plan.md"), posix.join(round.spec, "spec.md")]);
  if (!sameHashes(from, now)) found({ kind: "touches-stale", fill: {} });

  let paths: AskedPaths;
  try {
    paths = await readAskedPaths(round);
  } catch (error) {
    if (!(error instanceof PathsUnread)) throw error;
    found({ kind: error.kind, fill: error.fill });
  }
  if (paths.tasks.length === 0) found({ kind: "tasks-empty", fill: {} });
  const guard = await rulingsGuard(round, await rulingsOf(round));
  if (guard.length > 0) found(...guard);

  const asked = [...paths.plan, ...paths.tasks];
  const unique = [...new Set(asked.map((one) => one.path))];
  const folders = await listedFolders(round, settings);
  const answers = await Promise.all(folders.map((folder) => checkAdrFolder(checkout, folder, unique, ADR_DEADLINE_MS)));
  const record: AdrAsked = { v: 1, paths: asked, folders: folders.map((folder, i) => askedFolder(folder, answers[i])) };
  const text = writeRecord(inRun(round, ASKED_FILE), record);
  return { judge: record.folders.some((folder) => "governing" in folder && folder.governing.length > 0), asked: sha256(text) };
}

async function ask(round: Round, touchesCode: string): Promise<number> {
  let said = NO_DECISION;
  if (!hasStop(round)) {
    await checked(round, async () => {
      const { judge, asked } = await askChecks(round, touchesCode);
      said = { judge, decide: true, asked };
    });
  }
  round.io.stdout(JSON.stringify(said));
  done(round, { v: 1, step: "ask", decide: said.decide });
  return 0;
}

// --- decide -------------------------------------------------------------------------------------------------------

function pathsChanged(file: string, recorded: readonly ArtifactPath[], now: readonly ArtifactPath[]): StopItem[] {
  const { added, removed } = changedSince(recorded, now);
  if (added.length === 0 && removed.length === 0) return [];
  const changed = [...added.map((one) => `added ${one.path}`), ...removed.map((one) => `removed ${one.path}`)].join(", ");
  return [{ kind: "guard-paths", fill: { file, changed } }];
}

/** R9 b: the paths ask asked, read again; a touches.json or tasks.md that no longer reads is a change to it. */
async function pathsGuard(round: Round, asked: AdrAsked): Promise<StopItem[]> {
  let now: AskedPaths;
  try {
    now = await readAskedPaths(round);
  } catch (error) {
    if (!(error instanceof PathsUnread)) throw error;
    return [{ kind: "guard-paths", fill: { file: error.file, changed: error.fill.what } }];
  }
  const recorded = (artifact: string) => asked.paths.filter((one) => one.artifact === artifact);
  return [...pathsChanged(TOUCHES_FILE, recorded("plan"), now.plan), ...pathsChanged("tasks.md", recorded("tasks"), now.tasks)];
}

function verdictOf(round: Round, asked: AdrAsked, judgeCode: string): AdrVerdict {
  const judged = asked.folders.some((folder) => "governing" in folder && folder.governing.length > 0);
  // With no record governing no judge ran this round, so its exit code is an earlier round's.
  if (!judged) return { v: 1, verdicts: [] };
  const unread = (what: string): never => found({ kind: "verdict-unread", fill: { what } });
  if (judgeCode !== ANSWERED) unread("the judge did not answer (its exit code is not 0)");
  const text = textIfPresent(inRun(round, VERDICT_FILE));
  if (text === null) return unread(`${VERDICT_FILE} is missing`);
  return jsonOf(text, AdrVerdictSchema, (why) => unread(`not an AdrVerdict: ${why}`));
}

/** The resume's rulings not already held, validated whole against this round's departures (R9); those, or the stop
 *  that refuses them all. */
async function newRulings(
  round: Round,
  settings: CheckoutSettings,
  asked: AdrAsked,
  verdict: AdrVerdict,
  rulings: readonly AdrRuling[],
  given: string,
): Promise<{ rulings: AdrRuling[]; items: StopItem[] }> {
  const refused = (whys: readonly string[]): { rulings: AdrRuling[]; items: StopItem[] } => ({
    rulings: [],
    items: [{ kind: "ruling-refused", fill: { what: whys.join("; ") } }],
  });
  let json: unknown;
  try {
    json = JSON.parse(given);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return refused([`not JSON: ${error.message}`]);
  }
  const parsed = z.array(AdrRulingSchema).safeParse(json);
  if (!parsed.success) return refused([`not rulings: ${z.prettifyError(parsed.error)}`]);

  const held = new Set(rulings.map(rulingKey));
  const fresh = parsed.data.filter((ruling, i) => !held.has(rulingKey(ruling)) && parsed.data.findIndex((one) => rulingKey(one) === rulingKey(ruling)) === i);
  const askedPaths = new Set(asked.paths.map((one) => one.path));
  const whys = fresh.flatMap(({ folder, record, path }) => {
    const listed = asked.folders.find((one) => one.entry === folder);
    if (listed === undefined) return [`folder ${folder} is not listed in [shared] adr_folders`];
    if (!askedPaths.has(path)) return [`path ${path} was not asked`];
    const departures = decideFolder(listed, verdict.verdicts, asked.paths, []).departures;
    if (!departures.some((one) => one.record === record && one.path === path)) return [`no departure this round on ${folder} ${record} ${path}`];
    return [];
  });
  if (whys.length > 0) return refused(whys);

  const folders = await listedFolders(round, settings);
  const answers = await Promise.all(
    fresh.map(({ folder, path }) => {
      const resolved = folders.find((one) => one.entry === folder);
      if (resolved === undefined) throw new TypeError(`${folder} was listed when ask ran and is not now`);
      return checkAdrFolder(round.io.checkout, resolved, [path], ADR_DEADLINE_MS);
    }),
  );
  const notRun = answers.filter((answer): answer is CouldNotRun => "outcome" in answer);
  if (notRun.length > 0) return { rulings: [], items: notRun.map((couldNotRun): StopItem => ({ kind: "folder", couldNotRun })) };
  const notGoverning = fresh.flatMap(({ record, path }, i) => {
    const answer = answers[i];
    return "governing" in answer && answer.governing.some((one) => one.recordId === record) ? [] : [`${record} does not govern ${path}`];
  });
  if (notGoverning.length > 0) return refused(notGoverning);
  return { rulings: fresh, items: [] };
}

// Each append skips an entry already there, the run's record first, so the guard never takes an entry decide
// wrote for one a model wrote.
function appendRulings(round: Round, held: readonly AdrRuling[], fresh: readonly AdrRuling[]): AdrRuling[] {
  const append = (to: readonly AdrRuling[]) => {
    const keys = new Set(to.map(rulingKey));
    return [...to, ...fresh.filter((ruling) => !keys.has(rulingKey(ruling)))];
  };
  writeRecord(inRun(round, ADR_RULINGS_WRITTEN_FILE), { v: 1, rulings: append(rulingsWritten(round)) });
  const rulings = append(held);
  writeRecord(inSpec(round, ADR_RULINGS_FILE), { v: 1, rulings });
  return rulings;
}

async function decideChecks(round: Round, digest: string, judgeCode: string): Promise<string[]> {
  const settings = await settingsOf(round);
  if (settings.shared.adr_folders.length === 0) return adrStop([{ kind: "empty", fill: {} }]).lines;

  const askedText = textIfPresent(inRun(round, ASKED_FILE));
  if (askedText === null || sha256(askedText) !== digest) found({ kind: "guard-asked", fill: {} });
  const asked = jsonOf(askedText, AdrAskedSchema, (why) => {
    throw new TypeError(`${ASKED_FILE} has the digest ask printed, yet does not read: ${why}`);
  });
  let rulings = await rulingsOf(round);
  const guard = [...(await pathsGuard(round, asked)), ...(await rulingsGuard(round, rulings))];
  if (guard.length > 0) found(...guard);

  const verdict = verdictOf(round, asked, judgeCode);
  let refusal: StopItem[] = [];
  if (round.io.adrRuling !== undefined) {
    const given = await newRulings(round, settings, asked, verdict, rulings, round.io.adrRuling);
    if (given.items.some((item) => item.kind === "folder")) found(...given.items);
    refusal = given.items;
    if (given.rulings.length > 0) rulings = appendRulings(round, rulings, given.rulings);
  }
  const items = [...refusal, ...decideCheck(asked, verdict, rulings)];
  const { lines, exit } = adrStop(items);
  if (exit !== 0) found(...items);
  return lines;
}

async function decide(round: Round, digest: string, judgeCode: string): Promise<number> {
  await checked(round, async () => {
    for (const line of await decideChecks(round, digest, judgeCode)) round.io.stderr(line);
  });
  done(round, { v: 1, step: "decide" });
  return 0;
}

// --- report -------------------------------------------------------------------------------------------------------

/** Prints the stop and writes it shown; the run stops at report with its exit. */
function show(round: Round, record: AdrStopRecord): number {
  for (const line of record.lines) round.io.stderr(line);
  writeRecord(inRun(round, STOP_FILE), { ...record, shown: true });
  return record.exit;
}

function stepDone(round: Round, step: AdrStepDone["step"]): AdrStepDone | null {
  const text = textIfPresent(inRun(round, `${STEPS_DIR}/${step}.json`));
  return text === null ? null : jsonOf(text, AdrStepDoneSchema, () => null);
}

/** The steps this round expected a done record from and has none: tasks-written only when tasks-due was due,
 *  decide only when ask said decide. */
function unfinishedSteps(round: Round): string[] {
  const due = stepDone(round, "tasks-due");
  const asked = stepDone(round, "ask");
  const expected: AdrStepDone["step"][] = [
    "tasks-due",
    ...(due !== null && due.step === "tasks-due" && due.due ? (["tasks-written"] as const) : []),
    "stories",
    "ask",
    ...(asked !== null && asked.step === "ask" && asked.decide ? (["decide"] as const) : []),
  ];
  return expected.filter((step) => stepDone(round, step) === null);
}

// True when a file the round read no longer has the hash its step recorded (stories for its inputs, the tasks steps
// for the tasks command's sources), or the record is missing: the round's answer is out of date.
async function roundIsStale(round: Round, folders: readonly ResolvedAdrFolder[]): Promise<boolean> {
  const { checkout } = round.io;
  const inputs = await inputHashes(round, folders);
  const tasksSources = await sourceHashes(checkout, await tasksSourcePaths(checkout, round.spec));
  return (
    !sameHashes(hashesOf(textIfPresent(inRun(round, INPUTS_FILE))), inputs) ||
    !sameHashes(hashesOf(textIfPresent(inRun(round, TASKS_SOURCES_FILE))), tasksSources)
  );
}

async function report(round: Round): Promise<number> {
  const stopText = textIfPresent(inRun(round, STOP_FILE));
  const stop = stopText === null ? null : jsonOf(stopText, AdrStopRecordSchema, () => "unread" as const);
  const again = (value: boolean): number => {
    round.io.stdout(JSON.stringify({ again: value }));
    return 0;
  };
  if (stop !== null && stop !== "unread" && stop.shown) return again(true);
  const unfinished = unfinishedSteps(round);
  if (unfinished.length > 0) {
    return show(round, stopRecord([{ kind: "step-unfinished", fill: { steps: unfinished.map((step) => `adr-${step}`).join(", ") } }]));
  }
  if (stop !== null && stop !== "unread" && stop.unanswered) return show(round, stop);
  const read = await listed(round);
  if (!("settings" in read)) return show(round, stopRecord([read]));
  if (await roundIsStale(round, read.folders)) return again(true);
  if (stop === "unread") return show(round, stopRecord([{ kind: "stop-unread", fill: {} }]));
  if (stop !== null) return show(round, stop);
  return again(false);
}

// --- stop rounds --------------------------------------------------------------------------------------------------

function stopRounds(io: AdrCheckIo, kind: string, issue: number, spec: string): number {
  const { lines, exit } = adrStop([roundsStop(kind, issue, spec)]);
  for (const line of lines) io.stderr(line);
  return exit;
}

// --- main ---------------------------------------------------------------------------------------------------------

function issueOf(text: string | undefined): number | null {
  return text !== undefined && /^[1-9][0-9]*$/.test(text) ? Number(text) : null;
}

/** 2 for a usage error. report and `stop rounds` exit with the stop they print, report 0 with none; every other step
 *  exits 0 once done, a stop it found left for report. */
export async function main(args: readonly string[], io: AdrCheckIo): Promise<number> {
  const [command, ...rest] = args;
  const round = (spec: string, run: string): Round => ({ io, spec, run });
  const usage = (): number => {
    io.stderr(`planner: ${USAGE}`);
    return 2;
  };
  switch (command) {
    case "clear":
      return rest.length === 2 ? clear(round(rest[0], rest[1])) : usage();
    case "tasks-due":
      return rest.length === 2 ? tasksDue(round(rest[0], rest[1])) : usage();
    case "tasks-written":
      // tasks-written reads no spec folder.
      return rest.length === 2 ? tasksWritten(round("", rest[0]), rest[1]) : usage();
    case "stories": {
      const issue = issueOf(rest[0]);
      return rest.length === 4 && issue !== null && KINDS.has(rest[1]) ? stories(round(rest[2], rest[3]), issue, rest[1]) : usage();
    }
    case "ask":
      return rest.length === 3 ? ask(round(rest[0], rest[1]), rest[2]) : usage();
    case "decide":
      return rest.length === 4 ? decide(round(rest[0], rest[1]), rest[2], rest[3]) : usage();
    case "report":
      return rest.length === 2 ? report(round(rest[0], rest[1])) : usage();
    case "stop": {
      const issue = issueOf(rest[2]);
      return rest.length === 4 && rest[0] === "rounds" && KINDS.has(rest[1]) && issue !== null ? stopRounds(io, rest[1], issue, rest[3]) : usage();
    }
    default:
      return usage();
  }
}

if (import.meta.main) {
  process.exitCode = await main(process.argv.slice(2), {
    checkout: process.cwd(),
    connect: (token) => gitHub(token),
    mint: mintPlannerToken,
    adrRuling: process.env.ADR_RULING,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
