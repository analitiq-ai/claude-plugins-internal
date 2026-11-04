// planner's ADR check on the plan (planner ADR-0009), one iteration of the workflow's check loop: ask records each
// listed folder's answer for the judge, decide reads the judge's verdict and the user's rulings, report shows a stop
// once and on the resume asks for another iteration, and stop prints the line of a loop out of rounds. Run from the
// project root.
//
// Every check line is adrStop's, on stderr; ask's and report's stdout is their JSON alone. ask and decide exit 0 once
// they reach an answer, writing a stop to the stop record, which report exits with: 2 when any line is COULD_NOT_RUN,
// else 1. Any other exit of theirs is the step's own failure, never a check stop.
//
// Anything past the guard is loaded with `await import(...)`: a static import would be evaluated before the guard
// runs. A type-only import is erased, so it loads nothing.
import "../lib/guarded.ts";
import type {
  AdrAsked,
  AdrRuling,
  AdrStopRecord,
  AdrVerdict,
  ArtifactPath,
  CheckedArtifactName,
} from "../core/contracts/decision-check.ts";
import type { Shared } from "../core/settings.ts";
import type { StopItem } from "../lib/adr-check.ts";

const { createHash } = await import("node:crypto");
const { renameSync, rmSync, statSync } = await import("node:fs");
const { join, relative, resolve } = await import("node:path");
const { z } = await import("zod");
const { checkAdrFolder } = await import("../core/adr.ts");
const { adrFolders, checkoutToplevel } = await import("../core/adr-folders.ts");
const {
  ADR_RULINGS_FILE,
  ADR_RULINGS_WRITTEN_FILE,
  AdrAsked: AdrAskedSchema,
  AdrRulings,
  AdrStopRecord: AdrStopRecordSchema,
  AdrVerdict: AdrVerdictSchema,
  askedFile,
  parseRulings,
  readRulings,
  readTouchedPaths,
  RulingsRefused,
  stopFile,
  TOUCHES_FILE,
  TouchesRefused,
  verdictFile,
} = await import("../core/contracts/decision-check.ts");
const { textIfPresent, writeWhole } = await import("../core/files.ts");
const { GitFailed } = await import("../core/git.ts");
const { SettingsError } = await import("../core/settings.ts");
const { gitTree, NotInTree } = await import("../core/tree.ts");
const { CheckedArtifact } = await import("../core/values.ts");
const { adrStop, changedSince, decideCheck, isRuled } = await import("../lib/adr-check.ts");
const { readPlannerSettings } = await import("../lib/settings.ts");

const USAGE =
  "Usage: adr_check.ts ask plan <spec folder> <run folder> <touches exit code> | decide plan <spec folder> " +
  "<run folder> <asked digest> <judge exit code> | report plan <run folder> | stop plan rounds";
// An exit no check outcome uses, so a call routed wrong never reads as one.
const USAGE_EXIT = 64;

// Under the steps' 1800 s timeout, so the check reports a slow adr before the engine kills the step.
const ADR_DEADLINE_MS = 1_500_000;
const STARTED = performance.now();

// The one exit code argument that says a model step answered: Spec Kit records none on some failure paths, and a
// step that failed may have written its file first.
const ANSWERED = "0";

/** What is left of the step's deadline, in whole ms: decide's ruling checks run under the one deadline. */
function deadlineLeft(): number {
  return Math.floor(ADR_DEADLINE_MS - (performance.now() - STARTED));
}

const EMPTY: StopItem = { kind: "empty" };
// report and stop are given neither the spec folder nor the issue: their lines leave them to the session that starts
// the run again.
const LEFT_FOR_THE_SESSION = { "spec folder": "<spec folder>", issue: "<issue>" };

/** A stop: ask and decide record theirs for report to show; any other subcommand ends with its lines. */
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
  if (error instanceof SettingsError) return [{ kind: "settings", fill: { what: error.message } }];
  if (error instanceof GitFailed) return [{ kind: "git", fill: { what: error.message } }];
  throw error;
}

function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function printLines(lines: readonly string[]): void {
  for (const line of lines) process.stderr.write(`${line}\n`);
}

function shown(items: readonly StopItem[]): number {
  const { lines, exit } = adrStop(items);
  printLines(lines);
  return exit;
}

function json(text: string, refused: (what: string) => StopItem): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Stopped([refused(`not JSON: ${error.message}`)]);
  }
}

function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Written whole: a kill mid-write would otherwise leave a file the next step refuses, as if the user had broken it. */
function writeJson(path: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeWhole(path, text, renameSync);
  return text;
}

function didNotAnswer(step: string, exitCode: string): string {
  return `${step} did not answer: its exit code is ${JSON.stringify(exitCode)}, not ${ANSWERED}`;
}

function judged(asked: AdrAsked): boolean {
  return asked.folders.some((folder) => "governing" in folder && folder.governing.length > 0);
}

/** The touches step's paths, null when it left no file; a file that does not parse is refused. */
function touchedPaths(run: string): ArtifactPath[] | null {
  const refused = (what: string): StopItem => ({ kind: "touches-refused", fill: { what, run } });
  const text = textIfPresent(join(run, TOUCHES_FILE));
  if (text === null) return null;
  try {
    return readTouchedPaths(json(text, refused));
  } catch (error) {
    if (!(error instanceof TouchesRefused)) throw error;
    throw new Stopped([refused(error.why)]);
  }
}

/** The plan's paths, read only from a touches step that answered, whatever file one that did not answer left. */
function planPaths(run: string, touchesExit: string): ArtifactPath[] {
  const missing = (what: string) => new Stopped([{ kind: "touches-missing", fill: { what } }]);
  if (touchesExit !== ANSWERED) throw missing(didNotAnswer("the touches step", touchesExit));
  const paths = touchedPaths(run);
  if (paths === null) throw missing("the file is missing");
  if (paths.length === 0) throw missing("the file has no path");
  return paths;
}

async function rulingsAtHead(toplevel: string, specDir: string): Promise<AdrRuling[]> {
  let text: string;
  try {
    text = await gitTree(toplevel, "HEAD").readText(relative(toplevel, resolve(specDir, ADR_RULINGS_FILE)));
  } catch (error) {
    if (!(error instanceof NotInTree)) throw error;
    return [];
  }
  return parseRulings(text, `${ADR_RULINGS_FILE} at HEAD`);
}

// Only decide writes the record, so one that does not parse is no stop of the user's to correct: it throws.
function rulingsWritten(run: string): AdrRuling[] {
  const text = textIfPresent(join(run, ADR_RULINGS_WRITTEN_FILE));
  return text === null ? [] : parseRulings(text, ADR_RULINGS_WRITTEN_FILE);
}

/** What `read` gives; a rulings file that does not parse is the user's to correct, a stop that says so. */
async function rulingsOrStop(read: Promise<AdrRuling[]>, refused: (why: string) => StopItem): Promise<AdrRuling[]> {
  try {
    return await read;
  } catch (error) {
    if (!(error instanceof RulingsRefused)) throw error;
    throw new Stopped([refused(error.why)]);
  }
}

/** The spec folder's rulings, each one, compared whole, at HEAD or written by this run's decide (R9 a). */
async function guardedRulings(toplevel: string, specDir: string, run: string): Promise<AdrRuling[]> {
  const refused = (what: string): StopItem => ({ kind: "rulings-refused", fill: { what, "spec folder": specDir } });
  const rulings = await rulingsOrStop(readRulings(specDir), refused);
  if (rulings.length === 0) return rulings;
  const atHead = await rulingsOrStop(rulingsAtHead(toplevel, specDir), (why) => refused(`at HEAD: ${why}`));
  const unwritten = changedSince([...atHead, ...rulingsWritten(run)], rulings).added;
  if (unwritten.length > 0) {
    throw new Stopped(unwritten.map(({ folder, record, path }) => ({ kind: "guard-rulings", fill: { folder, id: record, path } })));
  }
  return rulings;
}

type Found = { items: StopItem[] };

/** What ask or decide found, once it reached an answer: a pass's lines, printed, or a stop, written to the stop record
 *  for report to show. The pass, or null on a stop. */
async function settled<Pass extends Found>(run: string, artifact: CheckedArtifactName, found: Promise<Pass>): Promise<Pass | null> {
  let pass: Pass | null = null;
  let items: StopItem[];
  try {
    pass = await found;
    items = pass.items;
  } catch (error) {
    items = stopsOf(error);
  }
  const { lines, exit } = adrStop(items);
  if (pass !== null && exit === 0) {
    printLines(lines);
    return pass;
  }
  // AdrStopRecord refuses an exit of 0 and an empty list, so a stop that says nothing fails the step, never passes.
  writeJson(join(run, stopFile(artifact)), AdrStopRecordSchema.parse({ v: 1, exit, lines, shown: false }));
  return null;
}

async function asking(artifact: CheckedArtifactName, specDir: string, run: string, touchesExit: string): Promise<Found & { asked: AdrAsked }> {
  const toplevel = await checkoutToplevel(process.cwd());
  const { shared } = await readPlannerSettings(toplevel);
  if (shared.adr_folders.length === 0) return { items: [EMPTY], asked: { v: 1, artifact, paths: [], folders: [] } };
  const paths = planPaths(run, touchesExit);
  await guardedRulings(toplevel, specDir, run);
  const folders = await adrFolders(toplevel, shared);
  const checked = paths.map(({ path }) => path);
  const answers = await Promise.all(folders.map((folder) => checkAdrFolder(toplevel, folder, checked, ADR_DEADLINE_MS)));
  const asked: AdrAsked = {
    v: 1,
    artifact,
    paths,
    folders: folders.map(({ entry, path, inside }, i) => {
      const answer = answers[i];
      return "outcome" in answer ? { entry, path, inside, outcome: answer } : { entry, path, inside, governing: answer.governing, broken: answer.broken };
    }),
  };
  return { items: [], asked };
}

async function ask(artifact: CheckedArtifactName, specDir: string, run: string, touchesExit: string): Promise<number> {
  rmSync(join(run, verdictFile(artifact)), { force: true });
  rmSync(join(run, stopFile(artifact)), { force: true });
  const found = await settled(run, artifact, asking(artifact, specDir, run, touchesExit));
  if (found === null) {
    printJson({ judge: false, decide: false, asked: "" });
    return 0;
  }
  const text = writeJson(join(run, askedFile(artifact)), AdrAskedSchema.parse(found.asked));
  printJson({ judge: judged(found.asked), decide: true, asked: sha256(text) });
  return 0;
}

/** What ask recorded, when its bytes are those ask printed the digest of (R9 c). */
function askedRecord(run: string, artifact: CheckedArtifactName, digest: string): AdrAsked {
  const file = askedFile(artifact);
  const text = textIfPresent(join(run, file));
  if (text === null || sha256(text) !== digest) throw new Stopped([{ kind: "guard-asked", fill: { file } }]);
  return AdrAskedSchema.parse(JSON.parse(text));
}

/** The judge's verdict, read only from a judge that answered, whatever file one that did not answer left. */
function readVerdict(run: string, artifact: CheckedArtifactName, judgeExit: string): AdrVerdict {
  const file = verdictFile(artifact);
  const unread = (what: string): StopItem => ({ kind: "verdict-unread", fill: { file, what } });
  if (judgeExit !== ANSWERED) throw new Stopped([unread(didNotAnswer("the judge", judgeExit))]);
  const text = textIfPresent(join(run, file));
  if (text === null) throw new Stopped([unread("the file is missing")]);
  const parsed = AdrVerdictSchema.safeParse(json(text, unread));
  if (!parsed.success) throw new Stopped([unread(`not an AdrVerdict: ${z.prettifyError(parsed.error)}`)]);
  if (parsed.data.artifact !== artifact) throw new Stopped([unread(`a verdict on ${parsed.data.artifact}, not ${artifact}`)]);
  return parsed.data;
}

function writeRulings(path: string, rulings: AdrRuling[]): void {
  writeJson(path, AdrRulings.parse({ v: 1, rulings }));
}

/** ADR_RULING's rulings the rulings file does not hold yet, each checked and then appended; refused whole when any
 *  one is refused (artifact-grammar.md). */
async function newRulings(
  toplevel: string,
  shared: Shared,
  specDir: string,
  run: string,
  asked: AdrAsked,
  rulings: AdrRuling[],
): Promise<AdrRuling[]> {
  const given = process.env.ADR_RULING;
  if (given === undefined) return [];
  const refused = (what: string): StopItem => ({ kind: "ruling-refused", fill: { what } });
  const parsed = AdrRulings.shape.rulings.safeParse(json(given, refused));
  if (!parsed.success) throw new Stopped([refused(`not rulings: ${z.prettifyError(parsed.error)}`)]);
  const fresh = parsed.data.filter((ruling) => !isRuled(rulings, ruling));
  const listed = new Map((await adrFolders(toplevel, shared)).map((folder) => [folder.entry, folder]));
  const askedPaths = new Set(asked.paths.map(({ path }) => path));
  const located = fresh.map((ruling) => ({ ruling, folder: listed.get(ruling.folder) }));
  const refusals = located.flatMap(({ ruling: { folder, path }, folder: resolved }) => [
    ...(resolved === undefined ? [refused(`folder ${folder} is not listed in [shared] adr_folders`)] : []),
    ...(askedPaths.has(path) ? [] : [refused(`path ${path} was not asked`)]),
  ]);
  if (refusals.length > 0) throw new Stopped(refusals);

  const checks = located.flatMap(({ ruling, folder }) => (folder === undefined ? [] : [{ ruling, folder }]));
  const answers = await Promise.all(
    checks.map(({ ruling, folder }) => checkAdrFolder(toplevel, folder, [ruling.path], deadlineLeft())),
  );
  const stops = checks.flatMap(({ ruling: { folder, record, path } }, i): StopItem[] => {
    const answer = answers[i];
    if ("outcome" in answer) return [{ kind: "folder", couldNotRun: answer }];
    return answer.governing.some(({ recordId }) => recordId === record) ? [] : [refused(`${folder} ${record} not governing ${path}`)];
  });
  if (stops.length > 0) throw new Stopped(stops);
  if (fresh.length === 0) return fresh;

  // The record first: an entry it holds that the rulings file lacks stops nothing, the reverse stops the next run.
  const written = rulingsWritten(run).filter((ruling) => !isRuled(fresh, ruling));
  writeRulings(join(run, ADR_RULINGS_WRITTEN_FILE), [...written, ...fresh]);
  writeRulings(join(specDir, ADR_RULINGS_FILE), [...rulings, ...fresh]);
  return fresh;
}

async function deciding(artifact: CheckedArtifactName, specDir: string, run: string, digest: string, judgeExit: string): Promise<Found> {
  const toplevel = await checkoutToplevel(process.cwd());
  const { shared } = await readPlannerSettings(toplevel);
  if (shared.adr_folders.length === 0) return { items: [EMPTY] };
  const rulings = await guardedRulings(toplevel, specDir, run);
  const asked = askedRecord(run, artifact, digest);
  // A touches.json gone or emptied since ask lost every path ask recorded: the paths guard names them.
  const { added, removed } = changedSince(asked.paths, touchedPaths(run) ?? []);
  if (added.length > 0 || removed.length > 0) {
    const changes = [...added.map(({ path }) => `added ${path}`), ...removed.map(({ path }) => `removed ${path}`)];
    throw new Stopped([{ kind: "guard-paths", fill: { file: TOUCHES_FILE, changes: changes.join(", ") } }]);
  }
  // With no judge, the argument is an earlier iteration's, or empty.
  const verdict = judged(asked) ? readVerdict(run, artifact, judgeExit) : null;
  const fresh = await newRulings(toplevel, shared, specDir, run, asked, rulings);
  return { items: decideCheck(asked, verdict, [...rulings, ...fresh]) };
}

async function decide(artifact: CheckedArtifactName, specDir: string, run: string, digest: string, judgeExit: string): Promise<number> {
  await settled(run, artifact, deciding(artifact, specDir, run, digest, judgeExit));
  return 0;
}

/** The stop ask or decide recorded; one that does not parse stops report, naming it. */
function stopRecord(text: string, file: string): AdrStopRecord {
  const unread = (what: string): StopItem => ({ kind: "stop-unread", fill: { file, what, ...LEFT_FOR_THE_SESSION } });
  const parsed = AdrStopRecordSchema.safeParse(json(text, unread));
  if (!parsed.success) throw new Stopped([unread(`not an AdrStopRecord: ${z.prettifyError(parsed.error)}`)]);
  return parsed.data;
}

/** A stop not yet shown stops the run here, once; on the resume after it, report asks for another iteration. */
function report(artifact: CheckedArtifactName, run: string): number {
  const file = stopFile(artifact);
  const path = join(run, file);
  // A run folder that is not there is a wrong argument, not an iteration that recorded no stop.
  if (!statSync(run).isDirectory()) throw new Error(`${run} is not a folder`);
  const text = textIfPresent(path);
  if (text === null) {
    printJson({ again: false });
    return 0;
  }
  const record = stopRecord(text, file);
  if (record.shown) {
    rmSync(path);
    printJson({ again: true });
    return 0;
  }
  printLines(record.lines);
  writeJson(path, AdrStopRecordSchema.parse({ ...record, shown: true }));
  return record.exit;
}

function outOfRounds(artifact: CheckedArtifactName): number {
  return shown([{ kind: "rounds", fill: { a: artifact, ...LEFT_FOR_THE_SESSION } }]);
}

function usage(): never {
  process.stderr.write(`${USAGE}\n`);
  process.exit(USAGE_EXIT);
}

async function subcommand(args: readonly string[]): Promise<number> {
  const [command, artifact, ...rest] = args;
  const { plan } = CheckedArtifact.schema.enum;
  if (artifact === plan) {
    if (command === "ask" && rest.length === 3) return ask(plan, rest[0], rest[1], rest[2]);
    if (command === "decide" && rest.length === 4) return decide(plan, rest[0], rest[1], rest[2], rest[3]);
    if (command === "report" && rest.length === 1) return report(plan, rest[0]);
    if (command === "stop" && rest.length === 1 && rest[0] === "rounds") return outOfRounds(plan);
  }
  usage();
}

async function main(args: readonly string[]): Promise<void> {
  process.exitCode = await subcommand(args).catch((error: unknown) => shown(stopsOf(error)));
}

if (import.meta.main) await main(process.argv.slice(2));
