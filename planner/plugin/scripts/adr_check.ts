// planner's ADR check on the plan (planner ADR-0009): ask records each listed folder's answer for the judge, decide
// reads the judge's verdict and the user's rulings, and stop prints the line of a judge or touches step that did
// not answer. Run from the project root.
//
// Every line goes to stderr through adrStop; ask's stdout is its JSON alone. Exit 2 when any line is COULD_NOT_RUN,
// else 1 when any is FAIL, else 0.
//
// Anything past the guard is loaded with `await import(...)`: a static import would be evaluated before the guard
// runs. A type-only import is erased, so it loads nothing.
import "../lib/guarded.ts";
import type { AdrAsked, AdrRuling, AdrVerdict, ArtifactPath, CheckedArtifactName } from "../core/contracts/decision-check.ts";
import type { Shared } from "../core/settings.ts";
import type { StopItem } from "../lib/adr-check.ts";

const { createHash } = await import("node:crypto");
const { renameSync, rmSync } = await import("node:fs");
const { join, relative, resolve } = await import("node:path");
const { z } = await import("zod");
const { checkAdrFolder } = await import("../core/adr.ts");
const { adrFolders, checkoutToplevel } = await import("../core/adr-folders.ts");
const {
  ADR_RULINGS_FILE,
  ADR_RULINGS_WRITTEN_FILE,
  AdrAsked: AdrAskedSchema,
  AdrRulings,
  AdrVerdict: AdrVerdictSchema,
  askedFile,
  parseRulings,
  readRulings,
  readTouchedPaths,
  RulingsRefused,
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
  "Usage: adr_check.ts ask plan <spec folder> <run folder> | decide plan <spec folder> <run folder> <asked digest> | " +
  "stop plan judge | stop plan touches";
// An exit no stop uses, so drive_workflow.py, which takes only a stop's 2, catches a call routed wrong.
const USAGE_EXIT = 64;

// Under the steps' 1800 s timeout, so the check reports a slow adr before the engine kills the step.
const ADR_DEADLINE_MS = 1_500_000;
const STARTED = performance.now();

/** What is left of the step's deadline, in whole ms: decide's ruling checks run under the one deadline. */
function deadlineLeft(): number {
  return Math.floor(ADR_DEADLINE_MS - (performance.now() - STARTED));
}

const EMPTY: StopItem = { kind: "empty" };

/** Ends the subcommand with its items' lines. */
class Stopped extends Error {
  readonly items: StopItem[];

  constructor(items: StopItem[]) {
    super(items.map((item) => item.kind).join(", "));
    this.name = "Stopped";
    this.items = items;
  }
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

/** Written whole: a kill mid-write would otherwise leave a file the next check refuses, as if the user had broken it. */
function writeJson(path: string, value: unknown): string {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  writeWhole(path, text, renameSync);
  return text;
}

function writeAsked(run: string, asked: AdrAsked): void {
  const text = writeJson(join(run, askedFile(asked.artifact)), AdrAskedSchema.parse(asked));
  process.stdout.write(`${JSON.stringify({ judge: judged(asked), asked: sha256(text) })}\n`);
}

async function ask(artifact: CheckedArtifactName, specDir: string, run: string): Promise<StopItem[]> {
  rmSync(join(run, verdictFile(artifact)), { force: true });
  const toplevel = await checkoutToplevel(process.cwd());
  const { shared } = await readPlannerSettings(toplevel);
  if (shared.adr_folders.length === 0) {
    writeAsked(run, { v: 1, artifact, paths: [], folders: [] });
    return [EMPTY];
  }
  const paths = touchedPaths(run);
  if (paths === null || paths.length === 0) {
    throw new Stopped([{ kind: "touches-missing", fill: { what: paths === null ? "missing" : "no path" } }]);
  }
  await guardedRulings(toplevel, specDir, run);
  const folders = await adrFolders(toplevel, shared);
  const checked = paths.map(({ path }) => path);
  const answers = await Promise.all(folders.map((folder) => checkAdrFolder(toplevel, folder, checked, ADR_DEADLINE_MS)));
  writeAsked(run, {
    v: 1,
    artifact,
    paths,
    folders: folders.map(({ entry, path, inside }, i) => {
      const answer = answers[i];
      return "outcome" in answer ? { entry, path, inside, outcome: answer } : { entry, path, inside, governing: answer.governing, broken: answer.broken };
    }),
  });
  return [];
}

/** What ask recorded, when its bytes are those ask printed the digest of (R9 c). */
function askedRecord(run: string, artifact: CheckedArtifactName, digest: string): AdrAsked {
  const file = askedFile(artifact);
  const text = textIfPresent(join(run, file));
  if (text === null || sha256(text) !== digest) throw new Stopped([{ kind: "guard-asked", fill: { file } }]);
  return AdrAskedSchema.parse(JSON.parse(text));
}

function readVerdict(run: string, artifact: CheckedArtifactName): AdrVerdict {
  const file = verdictFile(artifact);
  const unread = (what: string): StopItem => ({ kind: "verdict-unread", fill: { file, what } });
  const text = textIfPresent(join(run, file));
  if (text === null) throw new Stopped([unread("missing")]);
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

async function decide(artifact: CheckedArtifactName, specDir: string, run: string, digest: string): Promise<StopItem[]> {
  const toplevel = await checkoutToplevel(process.cwd());
  const { shared } = await readPlannerSettings(toplevel);
  if (shared.adr_folders.length === 0) return [EMPTY];
  const rulings = await guardedRulings(toplevel, specDir, run);
  const asked = askedRecord(run, artifact, digest);
  // A touches.json gone or emptied since ask lost every path ask recorded: the paths guard names them.
  const { added, removed } = changedSince(asked.paths, touchedPaths(run) ?? []);
  if (added.length > 0 || removed.length > 0) {
    const changes = [...added.map(({ path }) => `added ${path}`), ...removed.map(({ path }) => `removed ${path}`)];
    throw new Stopped([{ kind: "guard-paths", fill: { file: TOUCHES_FILE, changes: changes.join(", ") } }]);
  }
  const verdict = judged(asked) ? readVerdict(run, artifact) : null;
  const fresh = await newRulings(toplevel, shared, specDir, run, asked, rulings);
  return decideCheck(asked, verdict, [...rulings, ...fresh]);
}

function usage(): never {
  process.stderr.write(`${USAGE}\n`);
  process.exit(USAGE_EXIT);
}

function subcommand(args: readonly string[]): Promise<StopItem[]> {
  const [command, artifact, ...rest] = args;
  const { plan } = CheckedArtifact.schema.enum;
  if (command === "ask" && artifact === plan && rest.length === 2) return ask(plan, rest[0], rest[1]);
  if (command === "decide" && artifact === plan && rest.length === 3) return decide(plan, rest[0], rest[1], rest[2]);
  if (command === "stop" && artifact === plan && rest.length === 1) {
    if (rest[0] === "judge") return Promise.resolve([{ kind: "judge", fill: { a: plan } }]);
    if (rest[0] === "touches") return Promise.resolve([{ kind: "touches" }]);
  }
  usage();
}

function stopsOf(error: unknown): StopItem[] {
  if (error instanceof Stopped) return error.items;
  if (error instanceof SettingsError) return [{ kind: "settings", fill: { what: error.message } }];
  if (error instanceof GitFailed) return [{ kind: "git", fill: { what: error.message } }];
  throw error;
}

async function main(args: readonly string[]): Promise<void> {
  const items = await subcommand(args).catch(stopsOf);
  const { lines, exit } = adrStop(items);
  for (const line of lines) process.stderr.write(`${line}\n`);
  process.exitCode = exit;
}

if (import.meta.main) await main(process.argv.slice(2));
