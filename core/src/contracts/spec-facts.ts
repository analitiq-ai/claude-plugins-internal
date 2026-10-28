import { z } from "zod";
import { parse } from "yaml";

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

function refused(reason: string, cause?: unknown): Error {
  return new Error(`spec.md front matter: ${reason}`, { cause });
}

// A missing block fails rather than reading as any kind: a reader must never guess the requirement (R9).
export function readSpecFacts(text: string): SpecFacts {
  const lines = text.split("\n");
  const end = lines.indexOf("---", 1);
  if (lines[0] !== "---" || end === -1) throw refused("no front matter");
  let frontMatter: unknown;
  try {
    frontMatter = parse(lines.slice(1, end).join("\n"));
  } catch (error) {
    throw refused(`unparsable: ${error instanceof Error ? error.message : String(error)}`, error);
  }
  if (typeof frontMatter !== "object" || frontMatter === null || !Object.hasOwn(frontMatter, "codeworks")) {
    throw refused("no codeworks key");
  }
  const facts = SpecFacts.safeParse((frontMatter as Record<string, unknown>).codeworks);
  if (!facts.success) throw refused(z.prettifyError(facts.error), facts.error);
  return facts.data;
}
