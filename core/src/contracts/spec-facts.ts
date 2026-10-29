import { z } from "zod";
import { isMap, parse, parseDocument, stringify, YAMLParseError } from "yaml";

export const SpecKind = z.enum(["feature", "defect", "no_spec"]);
export type SpecKind = z.infer<typeof SpecKind>;

export const RootCauseObserved = z.enum(["anchored", "hypothesis", "none"]);
export type RootCauseObserved = z.infer<typeof RootCauseObserved>;

// The `codeworks` mapping of a spec.md's front matter (planner ADR-0008 d1).
export const SpecFacts = z.strictObject({
  v: z.literal(1),
  kind: SpecKind,
  root_cause: z.strictObject({ observed: RootCauseObserved }),
});
export type SpecFacts = z.infer<typeof SpecFacts>;

export class FrontMatterRefused extends Error {
  constructor(reason: string, cause?: unknown) {
    super(`spec.md front matter: ${reason}`, { cause });
    this.name = "FrontMatterRefused";
  }
}

// A front matter block opens on the first line and ends at the first `---` line after it; null when the text opens
// with none. Every reader of a spec.md's front matter or of what follows it shares it, so the writer sets the very
// block the reader reads and no reader mistakes the block for the body.
export function frontMatter(text: string): { yaml: string; body: string } | null {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) return null;
  return { yaml: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

// A missing block fails rather than reading as any kind: a reader must never guess the requirement.
export function readSpecFacts(text: string): SpecFacts {
  const block = frontMatter(text);
  if (block === null) throw new FrontMatterRefused("no front matter");
  let parsed: unknown;
  try {
    parsed = parse(block.yaml);
  } catch (error) {
    if (!(error instanceof YAMLParseError)) throw error;
    throw new FrontMatterRefused(`unparsable: ${error.message}`, error);
  }
  if (typeof parsed !== "object" || parsed === null || !Object.hasOwn(parsed, "codeworks")) {
    throw new FrontMatterRefused("no codeworks key");
  }
  const facts = SpecFacts.safeParse((parsed as Record<string, unknown>).codeworks);
  if (!facts.success) throw new FrontMatterRefused(z.prettifyError(facts.error), facts.error);
  return facts.data;
}

// The document is edited, not rebuilt, so the other keys and their comments stay as they were written.
export function writeSpecFacts(text: string, facts: SpecFacts): string {
  const valid = SpecFacts.safeParse(facts);
  if (!valid.success) throw new FrontMatterRefused(`facts to write: ${z.prettifyError(valid.error)}`, valid.error);
  const block = frontMatter(text);
  if (block === null) return `---\n${stringify({ codeworks: valid.data })}---\n${text}`;
  const document = parseDocument(block.yaml);
  const [error] = document.errors;
  if (error !== undefined) throw new FrontMatterRefused(`unparsable: ${error.message}`, error);
  if (document.contents !== null && !isMap(document.contents)) throw new FrontMatterRefused("not a mapping");
  document.set("codeworks", document.createNode(valid.data));
  return `---\n${document.toString()}---\n${block.body}`;
}
