// planner's ADR check (planner ADR-0009): the steps of one round of the workflow's adr-check loop, and the stop of a
// loop out of rounds (contracts/workflow-steps.md). Run from the project root.
//
// Anything past the guard is loaded with `await import(...)`: a static import would be evaluated before the guard
// runs. A type-only import is erased, so it loads nothing.
import "../lib/guarded.ts";
import type * as Zod from "zod";
import type { ResolvedAdrFolder } from "../core/adr-folders.ts";
import type {
  AdrAsked,
  AdrRuling,
  AdrStepDone,
  AdrVerdict,
  ArtifactPath,
  CheckedArtifactName,
  SourceHashes,
} from "../core/contracts/decision-check.ts";
import type { RunKind, StopItem } from "../lib/adr-check.ts";
import type { CheckoutSettings } from "../lib/settings.ts";
import type { StoryPlan, SubIssue } from "../lib/story-plan.ts";

const { createHash } = await import("node:crypto");
const { existsSync, mkdirSync, renameSync, rmSync } = await import("node:fs");
const { join, relative, resolve } = await import("node:path");
const { isDeepStrictEqual } = await import("node:util");
const { z } = await import("zod");
const { checkAdrFolder } = await import("../core/adr.ts");
const { adrFolders, checkoutToplevel } = await import("../core/adr-folders.ts");
const {
  ADR_RULINGS_FILE,
  ADR_RULINGS_WRITTEN_FILE,
  AdrAsked: AdrAskedSchema,
  AdrRulings,
  AdrStepDone: AdrStepDoneSchema,
  AdrStopRecord,
  AdrVerdict: AdrVerdictSchema,
  ASKED_FILE,
  INPUTS_FILE,
  parseRulings,
  PathRefused,
  readRulings,
  readTouchedPaths,
  ROUND_FILES,
  roundInputPaths,
  RulingsRefused,
  SourceHashes: SourceHashesSchema,
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
} = await import("../core/contracts/decision-check.ts");
const { readTaskPaths, TaskLineRefused } = await import("../core/contracts/tasks.ts");
const { textIfPresent, writeWhole } = await import("../core/files.ts");
const { GhFolderRefused } = await import("../core/gh-config.ts");
const { GitFailed, runGit } = await import("../core/git.ts");
const { gitHub, GitHubRefused, GitHubUnanswered } = await import("../core/github.ts");
const { KeyReadRefused } = await import("../core/keys.ts");
const { SettingsError } = await import("../core/settings.ts");
const { MintError } = await import("../core/tokens.ts");
const { gitTree, NotInTree } = await import("../core/tree.ts");
const { CheckedArtifact } = await import("../core/values.ts");
const { adrStop, changedSince, decideCheck, decideFolder, isRuled, roundsStop, stopWords } = await import("../lib/adr-check.ts");
const { mintPlannerToken, originRepository, plannerGitHub, readRepository, readSubIssues } = await import("../lib/github.ts");
const { readPlannerSettings } = await import("../lib/settings.ts");
const { extraSubIssues, foreignSubIssues, misplacedSubIssues, readStoryPlan, TasksRefused } = await import("../lib/story-plan.ts");

const USAGE =
  "Usage: adr_check.ts clear <spec folder> <run folder> | tasks-due <spec folder> <run folder> | tasks-written " +
  "<run folder> <tasks exit code> | stories <issue> <kind> <spec folder> <run folder> | ask <spec folder> <run folder> " +
  "<touches exit code> | decide <spec folder> <run folder> <asked digest> <judge exit code> | report <spec folder> " +
  "<run folder> | stop rounds <kind> <issue> <spec folder>";
// An exit no check outcome uses, so a call routed wrong never reads as one.
const USAGE_EXIT = 64;

// Under the steps' 1800 s timeout, so the check reports a slow adr before the engine kills the step.
const ADR_DEADLINE_MS = 1_500_000;
const STARTED = performance.now();

// The one exit code argument that says a model step answered: a step that failed may have written its file first,
// and Spec Kit passes other values (empty, -1) on some failure paths.
const ANSWERED = "0";
const TASKS_MD = "tasks.md";
const RUN_KINDS: ReadonlySet<string> = new Set(["new", "rescope"] satisfies RunKind[]);
const ISSUE_NUMBER = /^[1-9][0-9]*$/;
// The stop table's Unanswered column (workflow-steps.md).
const UNANSWERED: ReadonlySet<StopItem["kind"]> = new Set(["touches-missing", "tasks-unfinished", "verdict-unread"]);
const { plan: PLAN, tasks: TASKS } = CheckedArtifact.schema.enum;

const CWD = process.cwd();

/** A stop's items as an error, so a check can throw them. */
class Stopped extends Error {
  readonly items: StopItem[];

  constructor(items: StopItem[]) {
    super(items.map((item) => item.kind).join(", "));
    this.name = "Stopped";
    this.items = items;
  }
}

function stopsOf(error: unknown): StopItem[] {
  if (error instanceof Stopped) return error.items;
  if (error instanceof SettingsError) return [{ kind: "settings", what: error.message }];
  if (error instanceof GitFailed) return [{ kind: "git", what: error.message }];
  throw error;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printLines(lines: readonly string[]): void {
  for (const line of lines) process.stderr.write(`${line}\n`);
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Written whole: a step killed mid-write leaves the old record or the new one, never a torn one. */
function writeJson(path: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeWhole(path, text, renameSync);
  return text;
}

function json(text: string): { value: unknown } | { notJson: string } {
  try {
    return { value: JSON.parse(text) };
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return { notJson: error.message };
  }
}

/** `text` read as `schema`; null when there is none, or it is not JSON or not that shape. */
function parsedAs<Schema extends Zod.ZodType>(schema: Schema, text: string | null): Zod.output<Schema> | null {
  if (text === null) return null;
  const read = json(text);
  if ("notJson" in read) return null;
  const parsed = schema.safeParse(read.value);
  return parsed.success ? parsed.data : null;
}

function hashesAt(path: string): SourceHashes | null {
  return parsedAs(SourceHashesSchema, textIfPresent(path));
}

/** What is left of the step's deadline, in whole ms, at least 1: a spent deadline still ends the call at once. Every
 *  adr call of a step runs under the one deadline. */
function deadlineLeft(): number {
  return Math.max(Math.floor(ADR_DEADLINE_MS - (performance.now() - STARTED)), 1);
}

// --- the round's records ------------------------------------------------------------------------------------------

function stopRecorded(run: string): boolean {
  return existsSync(join(run, STOP_FILE));
}

function recordStop(run: string, items: readonly StopItem[]): void {
  const { lines, exit } = adrStop(items);
  const unanswered = items.some((item) => UNANSWERED.has(item.kind));
  // AdrStopRecord refuses an exit of 0 and an empty list, so a stop that says nothing fails the step, never passes.
  writeJson(join(run, STOP_FILE), AdrStopRecord.parse({ v: 1, exit, lines, shown: false, unanswered }));
}

/** `check`'s answer, or null on a stop: its own, which it records, or one the round already recorded, the one shown. */
async function checked<Answer>(run: string, check: () => Promise<Answer>): Promise<Answer | null> {
  if (stopRecorded(run)) return null;
  try {
    return await check();
  } catch (error) {
    recordStop(run, stopsOf(error));
    return null;
  }
}

/** The step's last act: report takes a missing one for a step that did not finish. */
function writeDone(run: string, done: AdrStepDone): void {
  mkdirSync(join(run, STEPS_DIR), { recursive: true });
  writeJson(join(run, STEPS_DIR, `${done.step}.json`), AdrStepDoneSchema.parse(done));
}

function doneRecord<Step extends AdrStepDone["step"]>(run: string, step: Step): Extract<AdrStepDone, { step: Step }> | null {
  const done = parsedAs(AdrStepDoneSchema, textIfPresent(join(run, STEPS_DIR, `${step}.json`)));
  return done !== null && done.step === step ? (done as Extract<AdrStepDone, { step: Step }>) : null;
}

// --- what a round reads -------------------------------------------------------------------------------------------

type Round = { toplevel: string; settings: CheckoutSettings; folders: ResolvedAdrFolder[] };

/** codeworks.toml at HEAD, the folders it lists as adrFolders resolves them, and the checkout's toplevel, the cwd
 *  every adr call is given. */
async function roundSettings(): Promise<Round> {
  const toplevel = await checkoutToplevel(CWD);
  const settings = await readPlannerSettings(toplevel);
  return { toplevel, settings, folders: await adrFolders(toplevel, settings.shared) };
}

async function roundSettingsOrStop(): Promise<Round | Stopped> {
  try {
    return await roundSettings();
  } catch (error) {
    return new Stopped(stopsOf(error));
  }
}

function touchesSources(specDir: string): Promise<SourceHashes> {
  return sourceHashes(CWD, [join(specDir, "plan.md"), join(specDir, "spec.md")]);
}

async function tasksSources(specDir: string): Promise<SourceHashes> {
  return sourceHashes(CWD, await tasksSourcePaths(CWD, specDir));
}

async function roundInputs(specDir: string, run: string, folders: readonly ResolvedAdrFolder[]): Promise<SourceHashes> {
  return sourceHashes(CWD, await roundInputPaths(CWD, specDir, run, folders.map(({ path }) => path)));
}

function readTasks(specDir: string): string {
  const text = textIfPresent(join(specDir, TASKS_MD));
  if (text === null) throw new Stopped([{ kind: "tasks-refused", label: TASKS_MD, what: "the file is missing" }]);
  return text;
}

/** touches.json's paths, each the plan's. */
function readPlanPaths(run: string): ArtifactPath[] {
  const missing = (what: string) => new Stopped([{ kind: "touches-missing", what }]);
  const refused = (what: string) => new Stopped([{ kind: "touches-refused", what }]);
  const text = textIfPresent(join(run, TOUCHES_FILE));
  if (text === null) throw missing("the file is missing");
  const read = json(text);
  if ("notJson" in read) throw refused(`not JSON: ${read.notJson}`);
  let paths: ArtifactPath[];
  try {
    paths = readTouchedPaths(read.value);
  } catch (error) {
    if (!(error instanceof TouchesRefused)) throw error;
    throw refused(error.why);
  }
  if (paths.length === 0) throw missing("the file has no path");
  return paths;
}

/** tasks.md's task paths; a span naming a root file is one only when git tracks that file or `plan` lists it. */
async function readTasksPaths(toplevel: string, specDir: string, plan: readonly ArtifactPath[]): Promise<ArtifactPath[]> {
  const text = readTasks(specDir);
  const tracked = (await runGit(toplevel, ["ls-files", "-z"])).stdout.split("\0");
  const rootFiles = new Set([...tracked, ...plan.map(({ path }) => path)].filter((path) => path !== "" && !path.includes("/")));
  try {
    return readTaskPaths(text, rootFiles);
  } catch (error) {
    if (error instanceof PathRefused) {
      throw new Stopped([{ kind: "tasks-refused", label: error.at ?? TASKS_MD, what: `${error.span}: ${error.why}` }]);
    }
    if (error instanceof TaskLineRefused) throw new Stopped([{ kind: "tasks-refused", label: error.at, what: error.why }]);
    throw error;
  }
}

async function rulingsAtHead(toplevel: string, specDir: string): Promise<AdrRuling[]> {
  let text: string;
  try {
    text = await gitTree(toplevel, "HEAD").readText(relative(toplevel, resolve(CWD, specDir, ADR_RULINGS_FILE)));
  } catch (error) {
    if (!(error instanceof NotInTree)) throw error;
    return [];
  }
  return parseRulings(text, `${ADR_RULINGS_FILE} at HEAD`);
}

/** The run's record of the rulings decide wrote. Only decide writes it, so one that does not parse is deleted and the
 *  guard runs without it: every entry the run added then stops the check, naming it. */
function rulingsWritten(run: string): AdrRuling[] {
  const path = join(run, ADR_RULINGS_WRITTEN_FILE);
  const text = textIfPresent(path);
  if (text === null) return [];
  try {
    return parseRulings(text, ADR_RULINGS_WRITTEN_FILE);
  } catch (error) {
    if (!(error instanceof RulingsRefused)) throw error;
    rmSync(path);
    return [];
  }
}

type Rulings = { rulings: AdrRuling[]; written: AdrRuling[] };

/** The rulings file, when each of its entries, compared whole, is at HEAD or in the run's written record (R9 a): only
 *  decide adds one. */
async function guardedRulings(toplevel: string, specDir: string, run: string): Promise<Rulings> {
  const refused = (why: string): Stopped => new Stopped([{ kind: "rulings-refused", what: why, fill: { "spec folder": specDir } }]);
  const read = async (rulingsOf: () => Promise<AdrRuling[]>, at: string): Promise<AdrRuling[]> => {
    try {
      return await rulingsOf();
    } catch (error) {
      if (!(error instanceof RulingsRefused)) throw error;
      throw refused(`${at}${error.why}`);
    }
  };
  const rulings = await read(() => readRulings(specDir), "");
  const atHead = await read(() => rulingsAtHead(toplevel, specDir), "at HEAD: ");
  const written = rulingsWritten(run);
  const unwritten = changedSince([...atHead, ...written], rulings).added;
  if (unwritten.length > 0) {
    throw new Stopped(
      unwritten.map(({ folder, record, path }) => ({ kind: "guard-rulings", what: `entry ${folder} ${record} ${path} was not written by the check` })),
    );
  }
  return { rulings, written };
}

function judged(asked: AdrAsked): boolean {
  return asked.folders.some((folder) => "governing" in folder && folder.governing.length > 0);
}

// --- the steps ----------------------------------------------------------------------------------------------------

async function clear(specDir: string, run: string): Promise<number> {
  for (const file of ROUND_FILES) rmSync(join(run, file), { recursive: true, force: true });
  writeJson(join(run, TOUCHES_FROM_FILE), await touchesSources(specDir));
  return 0;
}

async function tasksDue(specDir: string, run: string): Promise<number> {
  const next = await tasksSources(specDir);
  writeJson(join(run, TASKS_SOURCES_NEXT_FILE), next);
  const recorded = hashesAt(join(run, TASKS_SOURCES_FILE));
  const due = !existsSync(join(specDir, TASKS_MD)) || recorded === null || !isDeepStrictEqual(recorded, next);
  // Only a tasks command that answered restores it, so one that failed leaves the next round due.
  if (due) rmSync(join(run, TASKS_SOURCES_FILE), { force: true });
  printJson({ due });
  writeDone(run, { v: 1, step: "tasks-due", due });
  return 0;
}

function tasksWritten(run: string, tasksExit: string): number {
  // The hashes tasks-due took before the command ran: a source changed while it ran makes the next round due.
  if (tasksExit === ANSWERED) renameSync(join(run, TASKS_SOURCES_NEXT_FILE), join(run, TASKS_SOURCES_FILE));
  else if (!stopRecorded(run)) recordStop(run, [{ kind: "tasks-unfinished" }]);
  writeDone(run, { v: 1, step: "tasks-written" });
  return 0;
}

function storyPlanOf(tasks: string): StoryPlan {
  try {
    return readStoryPlan(tasks);
  } catch (error) {
    if (!(error instanceof TasksRefused)) throw error;
    throw new Stopped([{ kind: "tasks-refused", label: TASKS_MD, what: error.why }]);
  }
}

/** The spec issue's sub-issues against the story plan, as landing checks them, read as the planner App; the first
 *  kind of finding only, as landing stops on it. */
async function subIssueStops(issue: string, { toplevel, settings }: Round, { stories, labels }: StoryPlan): Promise<StopItem[]> {
  let url: string;
  let subIssues: SubIssue[];
  try {
    const repo = await originRepository(toplevel);
    const github = await plannerGitHub(repo, settings, gitHub, new Date(), mintPlannerToken);
    url = (await readRepository(github, repo)).url;
    subIssues = await readSubIssues(github, repo, Number(issue));
  } catch (error) {
    if (
      !(
        error instanceof GitHubUnanswered ||
        error instanceof GitHubRefused ||
        error instanceof GhFolderRefused ||
        error instanceof KeyReadRefused ||
        error instanceof MintError
      )
    ) {
      throw error;
    }
    return [{ kind: "github", what: error.message }];
  }
  const label = `#${issue}`;
  const extra = extraSubIssues(subIssues, stories);
  if (extra !== null) return [{ kind: "sub-issues-extra", label, what: extra, fill: { issue } }];
  const foreign = foreignSubIssues(subIssues, url);
  if (foreign.length > 0) return foreign.map((what) => ({ kind: "sub-issues-foreign", label, what, fill: { issue } }));
  return misplacedSubIssues(subIssues, stories, labels).map(({ position, what }) => ({
    kind: "sub-issues-misplaced",
    label,
    what,
    fill: { issue, i: String(position) },
  }));
}

async function stories(issue: string, kind: RunKind, specDir: string, run: string): Promise<number> {
  const round = await roundSettingsOrStop();
  // First, whatever follows, so report can tell whether any of these files changed after stories hashed them.
  writeJson(join(run, INPUTS_FILE), await roundInputs(specDir, run, round instanceof Stopped ? [] : round.folders));
  await checked(run, async () => {
    if (round instanceof Stopped) throw round;
    const plan = storyPlanOf(readTasks(specDir));
    // A rescope's sub-issues are its existing stories, which its new tasks.md may drop or reorder (#178).
    if (kind === "rescope") return;
    const items = await subIssueStops(issue, round, plan);
    if (items.length > 0) throw new Stopped(items);
  });
  writeDone(run, { v: 1, step: "stories" });
  return 0;
}

async function asking(specDir: string, run: string, touchesExit: string): Promise<AdrAsked> {
  const { toplevel, folders } = await roundSettings();
  if (folders.length === 0) return { v: 1, paths: [], folders: [] };
  if (touchesExit !== ANSWERED) {
    throw new Stopped([{ kind: "touches-missing", what: "the touches step did not answer (its exit code not 0)" }]);
  }
  const listedFrom = hashesAt(join(run, TOUCHES_FROM_FILE));
  if (listedFrom === null || !isDeepStrictEqual(listedFrom, await touchesSources(specDir))) {
    throw new Stopped([{ kind: "touches-stale" }]);
  }
  const plan = readPlanPaths(run);
  const tasks = await readTasksPaths(toplevel, specDir, plan);
  if (tasks.length === 0) throw new Stopped([{ kind: "tasks-empty" }]);
  await guardedRulings(toplevel, specDir, run);
  const paths = [...plan, ...tasks];
  const asked = [...new Set(paths.map(({ path }) => path))];
  const answers = await Promise.all(folders.map((folder) => checkAdrFolder(toplevel, folder, asked, deadlineLeft())));
  return {
    v: 1,
    paths,
    folders: folders.map(({ entry, path, inside }, i) => {
      const answer = answers[i];
      return "outcome" in answer ? { entry, path, inside, outcome: answer } : { entry, path, inside, governing: answer.governing, broken: answer.broken };
    }),
  };
}

async function ask(specDir: string, run: string, touchesExit: string): Promise<number> {
  const asked = await checked(run, () => asking(specDir, run, touchesExit));
  if (asked === null) {
    printJson({ judge: false, decide: false, asked: "" });
    writeDone(run, { v: 1, step: "ask", decide: false });
    return 0;
  }
  const text = writeJson(join(run, ASKED_FILE), AdrAskedSchema.parse(asked));
  printJson({ judge: judged(asked), decide: true, asked: sha256(text) });
  writeDone(run, { v: 1, step: "ask", decide: true });
  return 0;
}

/** What ask recorded, when its bytes are those ask printed the digest of (R9 c). */
function askedRecord(run: string, digest: string): AdrAsked {
  const text = textIfPresent(join(run, ASKED_FILE));
  if (text === null || sha256(text) !== digest) throw new Stopped([{ kind: "guard-asked" }]);
  return AdrAskedSchema.parse(JSON.parse(text));
}

type Reread = { paths: ArtifactPath[] } | { refused: StopItem[] };

async function reread(read: () => Promise<ArtifactPath[]>): Promise<Reread> {
  try {
    return { paths: await read() };
  } catch (error) {
    if (!(error instanceof Stopped)) throw error;
    return { refused: error.items };
  }
}

/** What a refusal says, in a guard line that already names `file`. */
function refusalWords(file: string, item: StopItem): string {
  if (item.kind === "folder") return item.couldNotRun.reason;
  const { label, what } = stopWords(item);
  return label === file ? what : `${label}: ${what}`;
}

/** touches.json's and tasks.md's paths against those ask recorded (R9 b): each path added or removed, or why the file
 *  no longer reads. */
async function guardPaths(toplevel: string, specDir: string, run: string, asked: AdrAsked): Promise<void> {
  // ask's plan paths, not touches.json's now: a root file touches.json gained after ask is then a tasks.md path only
  // when git tracks it.
  const askedPlan = asked.paths.filter((at) => at.artifact === PLAN);
  const compared = (artifact: CheckedArtifactName, paths: readonly ArtifactPath[]) =>
    paths.filter((at) => at.artifact === artifact).map(({ path, line, story }) => ({ path, line, story }));
  const rereads = [
    [TOUCHES_FILE, PLAN, await reread(async () => readPlanPaths(run))],
    [TASKS_MD, TASKS, await reread(() => readTasksPaths(toplevel, specDir, askedPlan))],
  ] as const;
  const items = rereads.flatMap(([file, artifact, now]): StopItem[] => {
    let changes: string[];
    if ("refused" in now) {
      changes = now.refused.map((item) => refusalWords(file, item));
    } else {
      const { added, removed } = changedSince(compared(artifact, asked.paths), compared(artifact, now.paths));
      changes = [...added.map(({ path }) => `added ${path}`), ...removed.map(({ path }) => `removed ${path}`)];
    }
    return changes.length === 0 ? [] : [{ kind: "guard-paths", label: file, what: `changed after ask: ${changes.join(", ")}` }];
  });
  if (items.length > 0) throw new Stopped(items);
}

/** The judge's verdict, read only from a judge that answered, whatever file one that did not answer left. */
function readVerdict(run: string, judgeExit: string): AdrVerdict {
  const unread = (what: string) => new Stopped([{ kind: "verdict-unread", what }]);
  if (judgeExit !== ANSWERED) throw unread("the judge did not answer (its exit code not 0)");
  const text = textIfPresent(join(run, VERDICT_FILE));
  if (text === null) throw unread("the file is missing");
  const read = json(text);
  if ("notJson" in read) throw unread(`not JSON: ${read.notJson}`);
  const parsed = AdrVerdictSchema.safeParse(read.value);
  if (!parsed.success) throw unread(`not an AdrVerdict: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function writeRulings(path: string, rulings: readonly AdrRuling[]): void {
  writeJson(path, AdrRulings.parse({ v: 1, rulings }));
}

type GivenRulings = { appended: AdrRuling[] } | { refused: StopItem[] };

/** ADR_RULING's rulings the rulings file does not hold yet, each checked, then appended; refused whole, none appended,
 *  when any one is (artifact-grammar.md). */
async function newRulings(
  { toplevel, folders }: Round,
  specDir: string,
  run: string,
  asked: AdrAsked,
  verdict: AdrVerdict | null,
  { rulings, written }: Rulings,
): Promise<GivenRulings> {
  const given = process.env.ADR_RULING;
  if (given === undefined) return { appended: [] };
  const refused = (what: string): StopItem => ({ kind: "ruling-refused", what });
  const read = json(given);
  if ("notJson" in read) return { refused: [refused(`not JSON: ${read.notJson}`)] };
  const parsed = AdrRulings.shape.rulings.safeParse(read.value);
  if (!parsed.success) return { refused: [refused(`not rulings: ${z.prettifyError(parsed.error)}`)] };
  // A key the rulings file holds is satisfied, not checked: adr-judge.md tells the judge to name no departure on it, so
  // the check would refuse it as no departure this round.
  const fresh = parsed.data.filter((ruling) => !isRuled(rulings, ruling));
  if (fresh.length === 0) return { appended: [] };

  const listed = new Map(folders.map((folder) => [folder.entry, folder]));
  const askedPaths = new Set(asked.paths.map(({ path }) => path));
  // Every departure this round found, before a ruling drops any.
  const departures = asked.folders.flatMap((folder) =>
    decideFolder(folder, asked.paths, verdict, []).departures.map(({ record, path }) => ({ folder: folder.entry, record, path })),
  );
  const unfounded = fresh.flatMap(({ folder, record, path }): StopItem[] => {
    if (!listed.has(folder)) return [refused(`folder ${folder} is not listed in [shared] adr_folders`)];
    if (!askedPaths.has(path)) return [refused(`path ${path} was not asked`)];
    if (!isRuled(departures, { folder, record, path })) return [refused(`no departure this round on ${folder} ${record} ${path}`)];
    return [];
  });
  if (unfounded.length > 0) return { refused: unfounded };

  // One call per ruling: adr answers for the whole path set it is given, so only one path makes record and path exact.
  const answers = await Promise.all(
    fresh.map(({ folder, path }) => checkAdrFolder(toplevel, listed.get(folder) as ResolvedAdrFolder, [path], deadlineLeft())),
  );
  const ungoverned = fresh.flatMap(({ record, path }, i): StopItem[] => {
    const answer = answers[i];
    if ("outcome" in answer) return [{ kind: "folder", couldNotRun: answer }];
    return answer.governing.some(({ recordId }) => recordId === record) ? [] : [refused(`${record} not governing ${path}`)];
  });
  if (ungoverned.length > 0) return { refused: ungoverned };

  // The record first: an entry it holds that the rulings file lacks stops nothing, the reverse stops the next round.
  writeRulings(join(run, ADR_RULINGS_WRITTEN_FILE), [...written.filter((ruling) => !isRuled(fresh, ruling)), ...fresh]);
  writeRulings(join(specDir, ADR_RULINGS_FILE), [...rulings, ...fresh]);
  return { appended: fresh };
}

/** A pass's lines; a stop is thrown. */
async function deciding(specDir: string, run: string, digest: string, judgeExit: string): Promise<string[]> {
  const round = await roundSettings();
  if (round.folders.length === 0) return adrStop([{ kind: "empty" }]).lines;
  const asked = askedRecord(run, digest);
  const guarded = await guardedRulings(round.toplevel, specDir, run);
  await guardPaths(round.toplevel, specDir, run, asked);
  // With no judge, its exit code is an earlier round's, or empty.
  const verdict = judged(asked) ? readVerdict(run, judgeExit) : null;
  const given = await newRulings(round, specDir, run, asked, verdict, guarded);
  // A refused ruling still leaves every folder's outcome to print (FR-009), decided on the rulings file as it stands.
  const items =
    "refused" in given
      ? [...given.refused, ...decideCheck(asked, verdict, guarded.rulings)]
      : decideCheck(asked, verdict, [...guarded.rulings, ...given.appended]);
  const { lines, exit } = adrStop(items);
  if (exit !== 0) throw new Stopped(items);
  return lines;
}

async function decide(specDir: string, run: string, digest: string, judgeExit: string): Promise<number> {
  const lines = await checked(run, () => deciding(specDir, run, digest, judgeExit));
  if (lines !== null) printLines(lines);
  writeDone(run, { v: 1, step: "decide" });
  return 0;
}

/** Prints the stop's lines and records it shown, so the resume after it asks for a new round. */
function show(run: string, { exit, lines, unanswered }: { exit: number; lines: string[]; unanswered: boolean }): number {
  printLines(lines);
  writeJson(join(run, STOP_FILE), AdrStopRecord.parse({ v: 1, exit, lines, shown: true, unanswered }));
  return exit;
}

function showReportStop(run: string, items: readonly StopItem[]): number {
  return show(run, { ...adrStop(items), unanswered: false });
}

/** Each step this round expected that left no done record, in round order. */
function unfinishedSteps(run: string): string[] {
  const tasksDue = doneRecord(run, "tasks-due");
  const asked = doneRecord(run, "ask");
  const expected: [string, unknown][] = [
    ["tasks-due", tasksDue],
    ...(tasksDue?.due ? [["tasks-written", doneRecord(run, "tasks-written")] as [string, unknown]] : []),
    ["stories", doneRecord(run, "stories")],
    ["ask", asked],
    ...(asked?.decide ? [["decide", doneRecord(run, "decide")] as [string, unknown]] : []),
  ];
  return expected.flatMap(([step, done]) => (done === null ? [`adr-${step}`] : []));
}

/** True when a file the round read hashes other than adr-inputs.json records, a tasks source other than
 *  tasks-sources.json records, or either record does not read (a missing tasks-sources.json: tasks.md written by a
 *  tasks command that did not finish). */
async function roundOutOfDate(specDir: string, run: string, folders: readonly ResolvedAdrFolder[]): Promise<boolean> {
  const inputs = hashesAt(join(run, INPUTS_FILE));
  const sources = hashesAt(join(run, TASKS_SOURCES_FILE));
  return (
    inputs === null ||
    sources === null ||
    !isDeepStrictEqual(inputs, await roundInputs(specDir, run, folders)) ||
    !isDeepStrictEqual(sources, await tasksSources(specDir))
  );
}

async function report(specDir: string, run: string): Promise<number> {
  const text = textIfPresent(join(run, STOP_FILE));
  const record = parsedAs(AdrStopRecord, text);
  if (record?.shown) {
    printJson({ again: true });
    return 0;
  }
  const unfinished = unfinishedSteps(run);
  if (unfinished.length > 0) {
    return showReportStop(run, [{ kind: "step-unfinished", what: `step ${unfinished.join(", ")} did not finish this round (no done record)` }]);
  }
  if (record?.unanswered) return show(run, record);
  const round = await roundSettingsOrStop();
  if (round instanceof Stopped) return showReportStop(run, round.items);
  if (await roundOutOfDate(specDir, run, round.folders)) {
    printJson({ again: true });
    return 0;
  }
  if (record !== null) return show(run, record);
  // A record that does not parse is neither shown nor unanswered, so it is shown only where a stop is.
  if (text !== null) return showReportStop(run, [{ kind: "stop-unread" }]);
  printJson({ again: false });
  return 0;
}

/** The rounds stop names the spec folder from the checkout's top, as the skill's entry points take it; the workflow
 *  gives it from the project's. */
async function outOfRounds(kind: RunKind, issue: string, specDir: string): Promise<number> {
  let items: StopItem[];
  try {
    const project = (await runGit(CWD, ["rev-parse", "--show-prefix"])).stdout.trim();
    items = [roundsStop(kind, issue, join(project, specDir))];
  } catch (error) {
    items = stopsOf(error);
  }
  const { lines, exit } = adrStop(items);
  printLines(lines);
  return exit;
}

function isRunKind(kind: string): kind is RunKind {
  return RUN_KINDS.has(kind);
}

function usage(): number {
  process.stderr.write(`${USAGE}\n`);
  return USAGE_EXIT;
}

async function subcommand([command, ...rest]: readonly string[]): Promise<number> {
  const [a, b, c, d] = rest;
  const given = (n: number) => rest.length === n;
  if (command === "clear" && given(2)) return clear(a, b);
  if (command === "tasks-due" && given(2)) return tasksDue(a, b);
  if (command === "tasks-written" && given(2)) return tasksWritten(a, b);
  if (command === "stories" && given(4) && ISSUE_NUMBER.test(a) && isRunKind(b)) return stories(a, b, c, d);
  if (command === "ask" && given(3)) return ask(a, b, c);
  if (command === "decide" && given(4)) return decide(a, b, c, d);
  if (command === "report" && given(2)) return report(a, b);
  if (command === "stop" && given(4) && a === "rounds" && isRunKind(b) && ISSUE_NUMBER.test(c)) return outOfRounds(b, c, d);
  return usage();
}

if (import.meta.main) process.exitCode = await subcommand(process.argv.slice(2));
