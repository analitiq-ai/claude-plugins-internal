// Writes the `codeworks` block into a spec folder's spec.md, from the premise report and the root cause section
// planner's checks have already graded (planner ADR-0008 d1).
//
// Usage: spec_facts.ts write <spec folder> [<premise report>]. Without a report, spec.md must be a no-spec one.
// Exits 1 when the facts are refused, each stderr line naming the next step, and 2 when it could not run.
//
// Anything past the guard is loaded with `await import(...)`: a static import would be evaluated before the guard
// runs. A type-only import is erased, so it loads nothing.
import "../lib/guarded.ts";
import type { SpecFacts } from "../core/contracts/spec-facts.ts";

const { readFileSync, writeFileSync } = await import("node:fs");
const { join } = await import("node:path");
const { REPORTS_WRONG_BEHAVIOUR, ROOT_CAUSE } = await import("../core/contracts/premise.ts");
const { FrontMatterRefused, RootCauseObserved, SpecKind, frontMatter, writeSpecFacts } = await import(
  "../core/contracts/spec-facts.ts"
);

const USAGE = "Usage: spec_facts.ts write <spec folder> [<premise report>]";
// no_spec.py's TITLE. It is no word of the premise vocabulary, so core does not carry it; the no-spec row of
// planner's spec-facts test, whose spec.md no_spec.py writes, fails when the two part.
const NO_SPEC_TITLE = "# No spec needed";

export class SpecFactsRefused extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "SpecFactsRefused";
  }
}

// premise_report.py grades these lines with comments removed, so a word quoted in a comment is never an answer.
function uncommentedLines(text: string): string[] {
  return text.replace(/<!--[\s\S]*?-->/g, "").split("\n");
}

// premise_report.py's `filled`: a template placeholder is one bracketed span and says nothing.
function filled(value: string): boolean {
  return value !== "" && !/^\[[^\]]*\]$/.test(value);
}

/** The report's one wrong-behaviour answer; empty when its line is missing or has no value. */
function wrongBehaviourOf(report: string): string {
  const label = `${REPORTS_WRONG_BEHAVIOUR.label}:`;
  const values = uncommentedLines(report)
    .filter((line) => line.startsWith(label))
    .map((line) => line.slice(label.length).trim());
  if (values.length > 1) {
    throw new SpecFactsRefused(
      `the premise report has ${values.length} \`${label}\` lines. Next step: keep the one that is meant.`,
    );
  }
  return values[0] ?? "";
}

/** The first line said under spec.md's one root cause heading; null without the heading. */
function rootCauseOpeningOf(spec: string): string | null {
  const lines = uncommentedLines(spec);
  const at = lines.indexOf(ROOT_CAUSE.heading);
  if (at === -1) return null;
  if (lines.indexOf(ROOT_CAUSE.heading, at + 1) !== -1) {
    throw new SpecFactsRefused(`spec.md has more than one \`${ROOT_CAUSE.heading}\` heading. Next step: keep one.`);
  }
  const under = lines.slice(at + 1);
  const end = under.findIndex((line) => line.startsWith("## "));
  return (end === -1 ? under : under.slice(0, end)).map((line) => line.trim()).find((line) => line !== "") ?? "";
}

/** Whether spec.md is a no-spec one: no_spec.py's `is_no_spec`, past any front matter. */
function isNoSpec(spec: string): boolean {
  return (frontMatter(spec)?.body ?? spec).split("\n")[0] === NO_SPEC_TITLE;
}

const { heading, observed, not_a_defect: notADefect, hypothesis } = ROOT_CAUSE;
const TRACED_OPENING = `\`${observed}\` and what was seen, or with \`${hypothesis}\``;

/** `opening` is rootCauseOpeningOf's; the report's answer plays no part (R11). */
function observedOf(opening: string | null): SpecFacts["root_cause"]["observed"] {
  const expected = `${TRACED_OPENING}; for an issue that reports no defect, with \`${notADefect}\``;
  if (opening === null) {
    throw new SpecFactsRefused(
      `spec.md has no \`${heading}\` section. Next step: add it as the spec template gives it, opening with ` +
        `${expected}.`,
    );
  }
  if (opening === notADefect) return RootCauseObserved.enum.none;
  if (!(opening.startsWith(observed) && filled(opening.slice(observed.length).trim()))) {
    throw new SpecFactsRefused(
      `spec.md's \`${heading}\` does not open with an \`${observed}\` line that says something. Next step: open ` +
        `it with ${expected}.`,
    );
  }
  return opening.startsWith(hypothesis) ? RootCauseObserved.enum.hypothesis : RootCauseObserved.enum.anchored;
}

/**
 * The facts of data-model.md "Spec facts": `wrong` is the premise report's answer to whether the issue reports
 * wrong behaviour, null for a no-spec spec.md, which has no report to say it; `opening` is rootCauseOpeningOf's.
 */
export function specFactsOf(wrong: string | null, opening: string | null): SpecFacts {
  if (wrong === null) {
    return { v: 1, kind: SpecKind.enum.no_spec, root_cause: { observed: RootCauseObserved.enum.none } };
  }
  const { label, yes, no } = REPORTS_WRONG_BEHAVIOUR;
  if (wrong !== yes && wrong !== no) {
    throw new SpecFactsRefused(
      `the premise report's \`${label}:\` is \`${wrong}\`, not \`${yes}\` or \`${no}\`. Next step: answer it ` +
        `\`${yes}\` or \`${no}\`.`,
    );
  }
  const kind = wrong === yes ? SpecKind.enum.defect : SpecKind.enum.feature;
  const found = observedOf(opening);
  // rootcause.py refuses the same pair: a report of wrong behaviour needs a trace.
  if (kind === SpecKind.enum.defect && found === RootCauseObserved.enum.none) {
    throw new SpecFactsRefused(
      `spec.md's \`${heading}\` says \`${notADefect}\` and the premise report says \`${label}: ${yes}\`. Next step: ` +
        `open the section with ${TRACED_OPENING}.`,
    );
  }
  return { v: 1, kind, root_cause: { observed: found } };
}

function cannotRun(reason: string): never {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

// Node's fs errors are plain Errors; a system error is the one that carries the failed syscall.
function isSystemError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && typeof (error as NodeJS.ErrnoException).syscall === "string";
}

function read(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (!isSystemError(error)) throw error;
    cannotRun(`spec_facts.ts could not read ${path}: ${error.message}`);
  }
}

function factsOf(spec: string, report: string | null): SpecFacts {
  if (report !== null) return specFactsOf(wrongBehaviourOf(report), rootCauseOpeningOf(spec));
  if (!isNoSpec(spec)) {
    throw new SpecFactsRefused(
      "spec.md is not a no-spec spec.md and no premise report was given. Next step: pass the run's premise report.",
    );
  }
  return specFactsOf(null, null);
}

function main(args: readonly string[]): void {
  if (args[0] !== "write" || args.length < 2 || args.length > 3) cannotRun(USAGE);
  const [, folder, reportPath] = args;
  const specPath = join(folder, "spec.md");
  const spec = read(specPath);
  const report = reportPath === undefined ? null : read(reportPath);
  let written: string;
  try {
    written = writeSpecFacts(spec, factsOf(spec, report));
  } catch (error) {
    if (error instanceof SpecFactsRefused) {
      process.stderr.write(`${specPath}: ${error.message}\n`);
    } else if (error instanceof FrontMatterRefused) {
      // The YAML parser's message goes on to draw the line it failed at; its first line already names where.
      process.stderr.write(
        `${specPath}: ${error.message.split("\n")[0]} Next step: make the front matter at the top of spec.md a ` +
          "YAML mapping that parses.\n",
      );
    } else {
      throw error;
    }
    process.exit(1);
  }
  try {
    writeFileSync(specPath, written);
  } catch (error) {
    if (!isSystemError(error)) throw error;
    cannotRun(`spec_facts.ts could not write ${specPath}: ${error.message}`);
  }
}

if (import.meta.main) main(process.argv.slice(2));
