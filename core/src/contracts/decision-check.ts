import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { z } from "zod";

import { isReadableFolder, liesUnder } from "../adr-folders.ts";
import { textIfPresent } from "../files.ts";
import { runGit } from "../git.ts";
import { listedOnce } from "../listed-once.ts";
import { SETTINGS_FILE } from "../settings.ts";
import { isPlainPath } from "../tree.ts";
import { AdrJudgment, CheckedArtifact, CheckOutcome } from "../values.ts";

// Every file planner's ADR check reads or writes in the run folder or the spec folder (planner ADR-0009).

export type CheckedArtifactName = z.infer<typeof CheckedArtifact.schema>;

export const ADR_RULINGS_FILE = "adr-rulings.json";
export const TOUCHES_FILE = "touches.json";
export const ADR_RULINGS_WRITTEN_FILE = "adr-rulings-written.json";
export const ASKED_FILE = "adr-asked.json";
export const VERDICT_FILE = "adr-verdict.json";
export const STOP_FILE = "adr-stop.json";
export const TOUCHES_FROM_FILE = "touches-from.json";
export const TASKS_SOURCES_FILE = "tasks-sources.json";
export const TASKS_SOURCES_NEXT_FILE = "tasks-sources-next.json";
export const STEPS_DIR = "adr-steps";
export const INPUTS_FILE = "adr-inputs.json";
export const REVIEW_QUESTIONS_FILE = "review-questions.json";
/** The run-folder records `adr-clear` deletes as a round starts. */
export const ROUND_FILES = [STEPS_DIR, TOUCHES_FILE, INPUTS_FILE, ASKED_FILE, VERDICT_FILE, STOP_FILE] as const;

export type ArtifactPath = { path: string; artifact: CheckedArtifactName; line: number; story: string | null };

export const SourceHashes = z.strictObject({ v: z.literal(1), files: z.record(z.string(), z.string()) });
export type SourceHashes = z.infer<typeof SourceHashes>;

/** The checkout's top, relative to `cwd`: empty at the top. GitFailed when `cwd` is in no git checkout. */
async function checkoutTopFrom(cwd: string): Promise<string> {
  return (await runGit(cwd, ["rev-parse", "--show-cdup"])).stdout.trim();
}

/** The sha256 of each path given that exists, relative to `cwd` or absolute, keyed repo-relative from the top of the
 *  checkout `cwd` is in, whichever project of it `cwd` is, and absolute outside it (a listed folder outside the repo);
 *  an absent one left out. Equal sets mean unchanged sources. GitFailed when `cwd` is in no git checkout. */
export async function sourceHashes(cwd: string, paths: readonly string[]): Promise<SourceHashes> {
  const top = resolve(cwd, await checkoutTopFrom(cwd));
  const files: Record<string, string> = {};
  for (const path of paths) {
    const absolute = resolve(cwd, path);
    const bytes = await bytesIfPresent(absolute);
    if (bytes === null) continue;
    const key = liesUnder(top, absolute) ? relative(top, absolute) : absolute;
    files[key] = createHash("sha256").update(bytes).digest("hex");
  }
  return { v: 1, files };
}

async function bytesIfPresent(path: string): Promise<Buffer | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return null;
  }
}

async function filesUnder(cwd: string, folder: string): Promise<string[]> {
  const root = resolve(cwd, folder);
  if (!(await isReadableFolder(root))) return [];
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) => join(folder, relative(root, join(entry.parentPath, entry.name))))
    .sort();
}

const TASKS_SOURCES = ["spec.md", "plan.md", "research.md", "data-model.md", "quickstart.md"];
const CONSTITUTION = ".specify/memory/constitution.md";

/** Every file the tasks command reads: the spec folder's spec.md, plan.md, research.md, data-model.md,
 *  quickstart.md, every regular file under contracts/, and .specify/memory/constitution.md. */
export async function tasksSourcePaths(cwd: string, specDir: string): Promise<string[]> {
  return [...TASKS_SOURCES.map((file) => join(specDir, file)), ...(await filesUnder(cwd, join(specDir, "contracts"))), CONSTITUTION];
}

/** Every file a round checks: tasksSourcePaths, tasks.md, the rulings file, the checkout's codeworks.toml, the run
 *  folder's review-questions.json, and every regular file under each of `folderPaths`, none under one that is not a
 *  readable folder. GitFailed when `cwd` is in no git checkout. */
export async function roundInputPaths(cwd: string, specDir: string, runDir: string, folderPaths: readonly string[]): Promise<string[]> {
  const folderFiles = await Promise.all(folderPaths.map((folder) => filesUnder(cwd, folder)));
  // The settings are the checkout's, read at its top, whichever project of it the run is in.
  const toTop = await checkoutTopFrom(cwd);
  return [
    ...(await tasksSourcePaths(cwd, specDir)),
    join(specDir, "tasks.md"),
    join(specDir, ADR_RULINGS_FILE),
    join(toTop, SETTINGS_FILE),
    // Listed whether or not this run has one: sourceHashes leaves an absent file out.
    join(runDir, REVIEW_QUESTIONS_FILE),
    ...folderFiles.flat(),
  ];
}

/** `at`: where the span was read, such as `tasks.md:<line>`; null for a span read on its own. */
export class PathRefused extends Error {
  readonly span: string;
  readonly why: string;
  readonly at: string | null;

  constructor(span: string, why: string, at: string | null) {
    super(`${at === null ? "" : `${at}: `}${JSON.stringify(span)}: ${why}`);
    this.name = "PathRefused";
    this.span = span;
    this.why = why;
    this.at = at;
  }
}

const PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const GLOB_OR_BRACE = /[*?[\]{}]/;

function isPath(span: string): boolean {
  return PATH.test(span) && isPlainPath(span);
}

/** Why a glob, brace group, `.` or `..` segment in `span` makes it name paths the check cannot list; null when it
 *  has none. */
function unlistable(span: string): string | null {
  if (GLOB_OR_BRACE.test(span)) return "a glob or brace group names files the check cannot list";
  if (span.split("/").some((segment) => segment === "." || segment === "..")) {
    return "a . or .. segment names a path the check cannot list";
  }
  return null;
}

/** Pure: one span against the path grammar (artifact-grammar.md). With "any", a touches.json entry: the span when
 *  it is a PATH, else PathRefused naming it. With rootFiles, a tasks.md span: the span when it is a PATH with a `/`
 *  or one rootFiles holds; PathRefused naming a span with a `/`, no space, and a glob, brace group, `.` or `..`
 *  segment; else null. */
export function artifactPath(span: string, rootFiles: ReadonlySet<string> | "any"): string | null {
  if (rootFiles === "any") {
    if (!isPath(span)) {
      throw new PathRefused(span, unlistable(span) ?? "not one literal repo-relative file path", null);
    }
    return span;
  }
  if (isPath(span)) return span.includes("/") || rootFiles.has(span) ? span : null;
  // A space makes the span a command, whatever path it names.
  const why = span.includes("/") && !span.includes(" ") ? unlistable(span) : null;
  if (why !== null) throw new PathRefused(span, why, null);
  return null;
}

const Path = z.string().superRefine((span, ctx) => {
  try {
    artifactPath(span, "any");
  } catch (error) {
    if (!(error instanceof PathRefused)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});

export const TouchedPaths = z.strictObject({ v: z.literal(1), paths: listedOnce(Path) });

export class TouchesRefused extends Error {
  readonly why: string;

  constructor(why: string) {
    super(`${TOUCHES_FILE}: ${why}`);
    this.name = "TouchesRefused";
    this.why = why;
  }
}

/** Pure: parsed `touches.json`, each entry the plan's, its line its 1-based index; throws TouchesRefused naming
 *  `touches.json` and the entry. */
export function readTouchedPaths(json: unknown): ArtifactPath[] {
  const parsed = TouchedPaths.safeParse(json);
  if (!parsed.success) throw new TouchesRefused(z.prettifyError(parsed.error));
  return parsed.data.paths.map((path, i) => ({ path, artifact: CheckedArtifact.schema.enum.plan, line: i + 1, story: null }));
}

const NonEmpty = z.string().min(1);
const Governing = z.strictObject({ recordId: z.string(), title: z.string() });
const Broken = z.strictObject({ file: z.string(), id: z.string().optional(), rule: z.string(), message: z.string() });
const NotRun = z.strictObject({ outcome: z.literal(CheckOutcome.schema.enum.COULD_NOT_RUN), reason: NonEmpty });
const AskedPath = z.strictObject({
  path: Path,
  artifact: CheckedArtifact.schema,
  line: z.number().int().positive(),
  story: NonEmpty.nullable(),
});

export const AdrAsked = z.strictObject({
  v: z.literal(1),
  paths: z.array(AskedPath),
  folders: z.array(
    z.union([
      z.strictObject({ entry: NonEmpty, path: NonEmpty, inside: z.boolean(), outcome: NotRun }),
      z.strictObject({ entry: NonEmpty, path: NonEmpty, inside: z.boolean(), governing: z.array(Governing), broken: z.array(Broken) }),
    ]),
  ),
});
export type AdrAsked = z.infer<typeof AdrAsked>;

const { WITHIN, DEPARTS } = AdrJudgment.schema.enum;

const Judged = z
  .strictObject({
    folder: NonEmpty,
    record: NonEmpty,
    judgment: AdrJudgment.schema,
    paths: z.array(NonEmpty),
    why: NonEmpty,
  })
  .superRefine(({ judgment, paths }, ctx) => {
    if (judgment === DEPARTS && paths.length === 0) {
      ctx.addIssue({ code: "custom", path: ["paths"], message: `a ${DEPARTS} verdict names the paths that depart` });
    }
    if (judgment === WITHIN && paths.length > 0) {
      ctx.addIssue({ code: "custom", path: ["paths"], message: `a ${WITHIN} verdict names no path` });
    }
  });

/** One verdict per governing record per folder, `folder` the entry as written; it judges plan.md and tasks.md
 *  together, so it names no artifact. */
export const AdrVerdict = z.strictObject({
  v: z.literal(1),
  verdicts: listedOnce(Judged, ({ folder, record }) => `${folder} ${record}`),
});
export type AdrVerdict = z.infer<typeof AdrVerdict>;

export const AdrRuling = z.strictObject({ folder: NonEmpty, record: NonEmpty, path: Path, reason: NonEmpty });
export type AdrRuling = z.infer<typeof AdrRuling>;

/** The rulings file and the rulings-written record alike. */
export const AdrRulings = z.strictObject({
  v: z.literal(1),
  rulings: listedOnce(AdrRuling, ({ folder, record, path }) => `${folder} ${record} ${path}`),
});
export type AdrRulings = z.infer<typeof AdrRulings>;

export const AdrStopRecord = z.strictObject({
  v: z.literal(1),
  exit: z.literal([1, 2]),
  lines: z.array(NonEmpty).min(1),
  shown: z.boolean(),
  unanswered: z.boolean(),
});
export type AdrStopRecord = z.infer<typeof AdrStopRecord>;

/** The one list of the round steps that write a done record. */
export const AdrStepDone = z.discriminatedUnion("step", [
  z.strictObject({ v: z.literal(1), step: z.literal("tasks-due"), due: z.boolean() }),
  z.strictObject({ v: z.literal(1), step: z.literal("tasks-written") }),
  z.strictObject({ v: z.literal(1), step: z.literal("stories") }),
  z.strictObject({ v: z.literal(1), step: z.literal("ask"), decide: z.boolean() }),
  z.strictObject({ v: z.literal(1), step: z.literal("decide") }),
]);
export type AdrStepDone = z.infer<typeof AdrStepDone>;

export class RulingsRefused extends Error {
  readonly file: string;
  readonly why: string;

  constructor(file: string, why: string) {
    super(`${file}: ${why}`);
    this.name = "RulingsRefused";
    this.file = file;
    this.why = why;
  }
}

/** Pure: an AdrRulings file's text; throws RulingsRefused naming `file` when it does not parse, never reading it as
 *  empty. */
export function parseRulings(text: string, file: string): AdrRuling[] {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new RulingsRefused(file, `not JSON: ${error.message}`);
  }
  const parsed = AdrRulings.safeParse(json);
  if (!parsed.success) throw new RulingsRefused(file, z.prettifyError(parsed.error));
  return parsed.data.rulings;
}

/** The spec folder's rulings file; `[]` when absent; throws RulingsRefused naming the file when it does not parse. */
// Async as the contract gives it, so a refusal is a rejection for every caller.
export async function readRulings(specDir: string): Promise<AdrRuling[]> {
  const text = textIfPresent(join(specDir, ADR_RULINGS_FILE));
  return text === null ? [] : parseRulings(text, ADR_RULINGS_FILE);
}
