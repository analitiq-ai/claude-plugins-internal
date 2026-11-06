import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, posix, relative, resolve } from "node:path";
import { z } from "zod";

import { jsonOf, textIfPresent } from "../files.ts";
import { SETTINGS_FILE } from "../settings.ts";
import { AdrJudgment, CheckedArtifact, CheckOutcome } from "../values.ts";
import { uniqueBy } from "./refinements.ts";

// Every file planner's plan check reads or writes (planner ADR-0009); the run folder is gitignored.
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
/** The run-folder files one round writes; `adr-clear` deletes them all before the round. */
export const ROUND_FILES = [STEPS_DIR, TOUCHES_FILE, INPUTS_FILE, ASKED_FILE, VERDICT_FILE, STOP_FILE] as const;

type CheckedArtifactName = z.infer<typeof CheckedArtifact.schema>;
export type ArtifactPath = { path: string; artifact: CheckedArtifactName; line: number; story: string | null };

/** A span that reads as a path but names none the check can list. */
export class PathRefused extends Error {
  readonly span: string;
  readonly why: string;
  /** `tasks.md:<line>` for a task line's span; null under `"any"`, whose caller names the file. */
  readonly where: string | null;
  constructor(span: string, why: string, where: string | null = null) {
    super(`${where === null ? "" : `${where}: `}${JSON.stringify(span)} ${why}`);
    this.name = "PathRefused";
    this.span = span;
    this.why = why;
    this.where = where;
  }
}

export class TouchesRefused extends Error {
  readonly why: string;
  constructor(why: string) {
    super(`${TOUCHES_FILE}: ${why}`);
    this.name = "TouchesRefused";
    this.why = why;
  }
}

export class RulingsRefused extends Error {
  readonly why: string;
  constructor(file: string, why: string) {
    super(`${file}: ${why}`);
    this.name = "RulingsRefused";
    this.why = why;
  }
}

const PATH = /^[A-Za-z0-9._-]+(\/[A-Za-z0-9._-]+)*$/;
const GLOB_OR_BRACE = /[*?[\]{}]/;
const NO_PATH = "is no literal repo-relative file path: no glob, brace group, `.` or `..` segment, or trailing /";

function isDotSegment(segment: string): boolean {
  return segment === "." || segment === "..";
}

function isPath(span: string): boolean {
  return PATH.test(span) && !span.split("/").some(isDotSegment);
}

/** One span against the path grammar (artifact-grammar.md): `"any"` for a touches.json entry, which is a path by
 *  its place; else `rootFiles`, the files with no `/` a tasks.md span may name. `null`: the span is not a path. */
export function artifactPath(span: string, rootFiles: ReadonlySet<string> | "any"): string | null {
  if (rootFiles === "any") {
    if (!isPath(span)) throw new PathRefused(span, NO_PATH);
    return span;
  }
  const readsAsPath = span.includes("/") && !/\s/.test(span);
  if (readsAsPath && (GLOB_OR_BRACE.test(span) || span.split("/").some(isDotSegment))) {
    throw new PathRefused(span, `names paths the check cannot list: ${NO_PATH}`);
  }
  if (!isPath(span)) return null;
  return span.includes("/") || rootFiles.has(span) ? span : null;
}

const Path = z.string().superRefine((span, ctx) => {
  try {
    artifactPath(span, "any");
  } catch (error) {
    if (!(error instanceof PathRefused)) throw error;
    ctx.addIssue({ code: "custom", message: error.message });
  }
});

const NonEmpty = z.string().min(1);

const ArtifactPathRecord = z
  .object({ path: Path, artifact: CheckedArtifact.schema, line: z.int().positive(), story: NonEmpty.nullable() })
  .strict();

export const TouchedPaths = z
  .object({ v: z.literal(1), paths: z.array(Path).superRefine(uniqueBy<string>((path) => JSON.stringify(path))) })
  .strict();

/** `touches.json` as parsed JSON; each entry's line is its 1-based index in `paths`. */
export function readTouchedPaths(json: unknown): ArtifactPath[] {
  const parsed = TouchedPaths.safeParse(json);
  if (!parsed.success) throw new TouchesRefused(z.prettifyError(parsed.error));
  return parsed.data.paths.map((path, i) => ({ path, artifact: CheckedArtifact.schema.enum.plan, line: i + 1, story: null }));
}

const FolderAsked = { entry: NonEmpty, path: NonEmpty, inside: z.boolean() };

export const AdrAsked = z
  .object({
    v: z.literal(1),
    paths: z.array(ArtifactPathRecord),
    folders: z.array(
      z.union([
        z
          .object({
            ...FolderAsked,
            outcome: z.object({ outcome: z.literal(CheckOutcome.schema.enum.COULD_NOT_RUN), reason: NonEmpty }).strict(),
          })
          .strict(),
        z
          .object({
            ...FolderAsked,
            governing: z.array(z.object({ recordId: NonEmpty, title: z.string() }).strict()),
            broken: z.array(
              z.object({ file: z.string(), id: z.string().optional(), rule: z.string(), message: z.string() }).strict(),
            ),
          })
          .strict(),
      ]),
    ),
  })
  .strict();
export type AdrAsked = z.infer<typeof AdrAsked>;

const { WITHIN, DEPARTS } = AdrJudgment.schema.enum;

const Verdict = z
  .object({ folder: NonEmpty, record: NonEmpty, judgment: AdrJudgment.schema, paths: z.array(Path), why: NonEmpty })
  .strict()
  .superRefine((verdict, ctx) => {
    if (verdict.judgment === DEPARTS && verdict.paths.length === 0) {
      ctx.addIssue({ code: "custom", path: ["paths"], message: `a ${DEPARTS} verdict names the paths that depart` });
    }
    if (verdict.judgment === WITHIN && verdict.paths.length > 0) {
      ctx.addIssue({ code: "custom", path: ["paths"], message: `a ${WITHIN} verdict names no path` });
    }
  });

export const AdrVerdict = z
  .object({
    v: z.literal(1),
    verdicts: z.array(Verdict).superRefine(uniqueBy((verdict) => JSON.stringify([verdict.folder, verdict.record]))),
  })
  .strict();
export type AdrVerdict = z.infer<typeof AdrVerdict>;

export const AdrRuling = z.object({ folder: NonEmpty, record: NonEmpty, path: Path, reason: NonEmpty }).strict();
export type AdrRuling = z.infer<typeof AdrRuling>;

/** A ruling's key: one ruling honours every departure with it, whichever artifact named the path. */
export function rulingKey(ruling: { folder: string; record: string; path: string }): string {
  return JSON.stringify([ruling.folder, ruling.record, ruling.path]);
}

export const AdrRulings = z.object({ v: z.literal(1), rulings: z.array(AdrRuling).superRefine(uniqueBy(rulingKey)) }).strict();
export type AdrRulings = z.infer<typeof AdrRulings>;

export const AdrStopRecord = z
  .object({
    v: z.literal(1),
    exit: z.union([z.literal(1), z.literal(2)]),
    lines: z.array(NonEmpty).min(1),
    shown: z.boolean(),
    unanswered: z.boolean(),
  })
  .strict();
export type AdrStopRecord = z.infer<typeof AdrStopRecord>;

/** The one list of the round's steps that leave a done record; report takes a missing one as a step that did not finish. */
export const AdrStepDone = z.discriminatedUnion("step", [
  z.object({ v: z.literal(1), step: z.literal("tasks-due"), due: z.boolean() }).strict(),
  z.object({ v: z.literal(1), step: z.literal("tasks-written") }).strict(),
  z.object({ v: z.literal(1), step: z.literal("stories") }).strict(),
  z.object({ v: z.literal(1), step: z.literal("ask"), decide: z.boolean() }).strict(),
  z.object({ v: z.literal(1), step: z.literal("decide") }).strict(),
]);
export type AdrStepDone = z.infer<typeof AdrStepDone>;

export const SourceHashes = z
  .object({ v: z.literal(1), files: z.record(NonEmpty, z.string().regex(/^[0-9a-f]{64}$/)) })
  .strict();
export type SourceHashes = z.infer<typeof SourceHashes>;

function isAbsent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

/** The sha256 of each path that exists, keyed repo-relative under `cwd` and absolute outside it, an absent one left
 *  out: equal records mean unchanged sources. */
export async function sourceHashes(cwd: string, paths: readonly string[]): Promise<SourceHashes> {
  const files: Record<string, string> = {};
  for (const given of [...paths].sort()) {
    const absolute = resolve(cwd, given);
    const fromCwd = relative(cwd, absolute);
    const key = fromCwd.startsWith("..") || isAbsolute(fromCwd) ? absolute : fromCwd;
    let bytes: Buffer;
    try {
      bytes = await readFile(absolute);
    } catch (error) {
      if (!isAbsent(error)) throw error;
      continue;
    }
    files[key] = createHash("sha256").update(bytes).digest("hex");
  }
  return { v: 1, files };
}

// The files under `folder`, `[]` when there is no such folder.
async function filesUnder(folder: string): Promise<string[]> {
  let entries;
  try {
    entries = await readdir(folder, { recursive: true, withFileTypes: true });
  } catch (error) {
    if (!isAbsent(error)) throw error;
    return [];
  }
  return entries.filter((entry) => entry.isFile()).map((entry) => join(entry.parentPath, entry.name));
}

const TASKS_SOURCE_FILES = ["spec.md", "plan.md", "research.md", "data-model.md", "quickstart.md"];
const CONSTITUTION = ".specify/memory/constitution.md";

/** Every file the tasks command reads, present or not; contracts/ as it now holds. */
export async function tasksSourcePaths(cwd: string, specDir: string): Promise<string[]> {
  const contracts = await filesUnder(resolve(cwd, specDir, "contracts"));
  return [
    ...TASKS_SOURCE_FILES.map((name) => posix.join(specDir, name)),
    ...contracts.map((file) => relative(cwd, file)),
    CONSTITUTION,
  ];
}

// A folder the check cannot read lists no file: its `checkAdrFolder` answers could not run, which stops the round.
async function readableFilesUnder(folder: string): Promise<string[]> {
  try {
    return await filesUnder(folder);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code !== "EACCES" && code !== "ENOTDIR") throw error;
    return [];
  }
}

/** Every file a round checks, so a change to any of them after the round answered runs a new round. */
export async function roundInputPaths(
  cwd: string,
  specDir: string,
  runDir: string,
  folderPaths: readonly string[],
): Promise<string[]> {
  const questions = posix.join(runDir, REVIEW_QUESTIONS_FILE);
  const folders = await Promise.all(folderPaths.map(readableFilesUnder));
  return [
    ...(await tasksSourcePaths(cwd, specDir)),
    posix.join(specDir, "tasks.md"),
    posix.join(specDir, ADR_RULINGS_FILE),
    SETTINGS_FILE,
    ...(existsSync(resolve(cwd, questions)) ? [questions] : []),
    ...folders.flat(),
  ];
}

/** The spec folder's rulings, `[]` when it has no rulings file; a file that does not parse is never read as none. */
export async function readRulings(specDir: string): Promise<AdrRuling[]> {
  const file = join(specDir, ADR_RULINGS_FILE);
  const text = textIfPresent(file);
  if (text === null) return [];
  return jsonOf(text, AdrRulings, (why) => {
    throw new RulingsRefused(file, why);
  }).rulings;
}
