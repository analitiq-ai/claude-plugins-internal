import { join } from "node:path";
import { z } from "zod";

import { textIfPresent } from "../files.ts";
import { listedOnce } from "../listed-once.ts";
import { isPlainPath } from "../tree.ts";
import { AdrJudgment, CheckedArtifact, CheckOutcome } from "../values.ts";

// Every file planner's ADR check reads or writes in the run folder or the spec folder (planner ADR-0009).

export type CheckedArtifactName = z.infer<typeof CheckedArtifact.schema>;

export const ADR_RULINGS_FILE = "adr-rulings.json";
export const TOUCHES_FILE = "touches.json";
export const ADR_RULINGS_WRITTEN_FILE = "adr-rulings-written.json";
export const askedFile = (artifact: CheckedArtifactName) => `adr-${artifact}-asked.json`;
export const verdictFile = (artifact: CheckedArtifactName) => `adr-${artifact}-verdict.json`;
export const stopFile = (artifact: CheckedArtifactName) => `adr-${artifact}-stop.json`;

export type ArtifactPath = { path: string; line: number; story: string | null };

export class PathRefused extends Error {
  readonly span: string;
  readonly why: string;

  constructor(span: string, why: string) {
    super(`${JSON.stringify(span)}: ${why}`);
    this.name = "PathRefused";
    this.span = span;
    this.why = why;
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
      throw new PathRefused(span, unlistable(span) ?? "not one literal repo-relative file path");
    }
    return span;
  }
  if (isPath(span)) return span.includes("/") || rootFiles.has(span) ? span : null;
  // A space makes the span a command, whatever path it names.
  const why = span.includes("/") && !span.includes(" ") ? unlistable(span) : null;
  if (why !== null) throw new PathRefused(span, why);
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

/** Pure: parsed `touches.json`, each entry's line its 1-based index; throws TouchesRefused naming `touches.json` and
 *  the entry. */
export function readTouchedPaths(json: unknown): ArtifactPath[] {
  const parsed = TouchedPaths.safeParse(json);
  if (!parsed.success) throw new TouchesRefused(z.prettifyError(parsed.error));
  return parsed.data.paths.map((path, i) => ({ path, line: i + 1, story: null }));
}

const NonEmpty = z.string().min(1);
const Governing = z.strictObject({ recordId: z.string(), title: z.string() });
const Broken = z.strictObject({ file: z.string(), id: z.string().optional(), rule: z.string(), message: z.string() });
const NotRun = z.strictObject({ outcome: z.literal(CheckOutcome.schema.enum.COULD_NOT_RUN), reason: NonEmpty });

export const AdrAsked = z.strictObject({
  v: z.literal(1),
  artifact: CheckedArtifact.schema,
  paths: z.array(z.strictObject({ path: Path, line: z.number().int().positive(), story: NonEmpty.nullable() })),
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

/** One verdict per governing record per folder, `folder` the entry as written. */
export const AdrVerdict = z.strictObject({
  v: z.literal(1),
  artifact: CheckedArtifact.schema,
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

/** A check's stop: ask or decide writes it, report shows it once, then on the resume deletes it. */
export const AdrStopRecord = z.strictObject({
  v: z.literal(1),
  exit: z.literal([1, 2]),
  lines: z.array(NonEmpty).min(1),
  shown: z.boolean(),
});
export type AdrStopRecord = z.infer<typeof AdrStopRecord>;

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
