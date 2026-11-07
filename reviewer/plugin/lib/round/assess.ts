import { z } from "zod";

import { FindingRuling, RoundVerdict } from "../../core/values.ts";
import { FINDING_KINDS, isFixing, RESHAPE_SPEC, type AssessorVerdict } from "../rules/rounds.ts";

const { FIX, DEFER } = FindingRuling.schema.enum;
const { PATCH, CLASS_FIX, REDESIGN, CONVERGED_PUSHBACK, ESCALATE } = RoundVerdict.schema.enum;

type Kind = (typeof FINDING_KINDS)[number];
const NOT_WORTH_FIXING: readonly Kind[] = ["bikeshed", "gold_plating", "not_real"];
const SHARED_CAUSE: readonly Kind[] = ["class_sibling", "fix_induced"];
const LOCKING: readonly AssessorVerdict[] = [RESHAPE_SPEC, ESCALATE];

/** Why a REDESIGN rewrites its file (ADR-0018 d1). */
export const REDESIGN_DIAGNOSES = ["unsettled_design", "too_many_responsibilities", "review_polish"] as const;

const ISSUE = /^(?:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)?#[1-9][0-9]*$/;
const SEVERITIES = ["HIGH", "MEDIUM", "LOW"] as const;

export type JsonSchema = z.core.JSONSchema.BaseSchema;

const literally = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function issuesOf(error: z.ZodError): string[] {
  return error.issues.map(({ path, message }) => (path.length === 0 ? message : `${path.join(".")}: ${message}`));
}

function reportShape(roundRef: string, short: string) {
  const finding = z.strictObject({
    id: z
      .string()
      .regex(new RegExp(`^${literally(short)}-[0-9]+$`))
      .describe(`${short}-1, ${short}-2, ...`),
    title: z.string(),
    file: z.string().describe("path relative to the repo root"),
    line: z.int().min(1).optional(),
    severity: z.enum(SEVERITIES),
    detail: z.string().describe("what is wrong and the concrete failure it causes"),
    suggested_fix: z.string().optional(),
  });
  return z.strictObject({
    round_ref: z.enum([roundRef]),
    findings: z.array(finding).describe("empty when nothing must change"),
    verdict: z.string().optional().describe("only for a reviewer whose remit is a verdict, e.g. history-shape"),
    clean_scope: z.string().optional().describe("what was examined and came back clean"),
  });
}

export type Report = z.infer<ReturnType<typeof reportShape>>;
export type ReportRead = { ok: true; report: Report } | { ok: false; errors: string[] };

/** The schema a reviewer of the round answers in; `short` prefixes its finding ids. */
export function findingsSchema(roundRef: string, short: string): JsonSchema {
  return z.toJSONSchema(reportShape(roundRef, short));
}

export function readReport(body: unknown, roundRef: string, short: string): ReportRead {
  const parsed = reportShape(roundRef, short).safeParse(body);
  if (!parsed.success) return { ok: false, errors: issuesOf(parsed.error) };
  const ids = parsed.data.findings.map(({ id }) => id);
  return new Set(ids).size === ids.length ? { ok: true, report: parsed.data } : { ok: false, errors: ["finding ids must be unique"] };
}

function assessmentShape(roundRef: string, admissible: readonly AssessorVerdict[]) {
  const entry = z.strictObject({
    id: z.string(),
    verdict: FindingRuling.schema,
    kind: z.enum(FINDING_KINDS),
    duplicate_of: z.string().optional().describe("kind duplicate only: the id of the finding of this round it repeats"),
    spec_ref: z.string().describe("the spec decision this touches, 'spec silent', or 'n/a'"),
    mechanism: z.string().trim().min(1).describe("what produces the problem, not where it shows: what a FIX changes"),
    reason: z.string().trim().min(1),
    issue: z.string().regex(ISSUE).optional().describe("DEFER only: the issue the finding moves to, #<n> or <owner>/<repo>#<n>"),
  });
  return z.strictObject({
    round_ref: z.enum([roundRef]),
    brief_token: z.string().describe("copied from the brief; proves it was read"),
    findings: z.array(entry),
    round_verdict: z.enum(admissible as [AssessorVerdict, ...AssessorVerdict[]], {
      error: ({ input }) => `round_verdict ${String(input)} is not admissible for this round; admissible: ${admissible.join(", ")}`,
    }),
    invariant: z.string().optional().describe("CLASS_FIX: the rule every site must satisfy. REDESIGN: the structure that replaces the current one"),
    diagnosis: z.enum(REDESIGN_DIAGNOSES).optional().describe("REDESIGN only: why the file is rewritten"),
    sites: z.array(z.string()).optional().describe("CLASS_FIX: every path:line the invariant covers"),
    enumeration_command: z.string().optional().describe("CLASS_FIX: the command that lists the sites"),
    patch_defense: z.string().optional().describe("PATCH under burden of proof: why these findings do not share a cause"),
    rationale: z.string(),
    user_decision: z
      .string()
      .nullable()
      .describe("RESHAPE_SPEC and ESCALATE only, else null: the question the user must answer"),
  });
}

export type AssessorAnswer = z.infer<ReturnType<typeof assessmentShape>>;
type Entry = AssessorAnswer["findings"][number];
export type AssessmentRead = { ok: true; assessment: AssessorAnswer } | { ok: false; errors: string[] };

/** The schema the assessor answers in, offering the round verdicts `admissible`. */
export function assessmentSchema(roundRef: string, admissible: readonly AssessorVerdict[]): JsonSchema {
  return z.toJSONSchema(assessmentShape(roundRef, admissible));
}

export type AssessmentContext = {
  roundRef: string;
  findingIds: readonly string[];
  admissible: readonly AssessorVerdict[];
  /** facts.ts `burden`. */
  burden: boolean;
  /** The brief's token. */
  token: string;
};

const stated = (text: string | null | undefined): boolean => (text ?? "").trim() !== "";

function duplicateErrors(findings: readonly Entry[]): string[] {
  const byId = new Map(findings.map((entry) => [entry.id, entry]));
  return findings.flatMap(({ id, kind, verdict, duplicate_of }) => {
    if (kind !== "duplicate") return duplicate_of === undefined ? [] : [`${id}: only a finding of kind duplicate names duplicate_of`];
    const original = duplicate_of === undefined ? undefined : byId.get(duplicate_of);
    if (original === undefined || original.id === id || original.kind === "duplicate") {
      return [`${id}: duplicate_of must name another finding of this round that is not itself a duplicate`];
    }
    return verdict === original.verdict ? [] : [`${id}: a duplicate carries the verdict of ${original.id} (${original.verdict})`];
  });
}

function rulingErrors(findings: readonly Entry[]): string[] {
  return findings.flatMap(({ id, kind, verdict, issue }) => [
    ...(verdict === FIX && NOT_WORTH_FIXING.includes(kind) ? [`${id}: kind ${kind} cannot carry verdict FIX; push it back or reclassify it`] : []),
    ...(verdict === DEFER && issue === undefined ? [`${id}: a DEFER names the issue the finding moves to, as #<n> or <owner>/<repo>#<n>`] : []),
    ...(verdict !== DEFER && issue !== undefined ? [`${id}: only a DEFER names an issue`] : []),
  ]);
}

function verdictErrors(answer: AssessorAnswer, burden: boolean): string[] {
  const { round_verdict: verdict, findings } = answer;
  const errors: string[] = [];
  const toFix = findings.some(({ verdict: ruling }) => ruling === FIX);
  if (isFixing(verdict) && !toFix) errors.push(`${verdict} needs at least one finding with verdict FIX; with none, the verdict is CONVERGED_PUSHBACK`);
  if (verdict === CONVERGED_PUSHBACK && toFix) errors.push("CONVERGED_PUSHBACK means nothing is to be fixed, but some findings carry verdict FIX");
  if (verdict === PATCH) {
    const shared = findings.filter(({ kind }) => SHARED_CAUSE.includes(kind)).map(({ id }) => id);
    if (shared.length > 0) {
      errors.push(
        `PATCH contradicts ${shared.join(", ")} being labelled class_sibling/fix_induced: findings with a shared cause are fixed at the ` +
          "cause (CLASS_FIX, REDESIGN or RESHAPE_SPEC)",
      );
    } else if (burden && !stated(answer.patch_defense)) {
      errors.push("the computed facts put the burden of proof on PATCH; give patch_defense or choose another verdict");
    }
  }
  if (verdict === CLASS_FIX && (!stated(answer.invariant) || !stated(answer.enumeration_command) || (answer.sites ?? []).length < 2)) {
    errors.push("CLASS_FIX needs invariant, enumeration_command and at least two sites");
  }
  if (verdict === REDESIGN && (!stated(answer.invariant) || answer.diagnosis === undefined)) {
    errors.push(`REDESIGN needs invariant, the structure that replaces the current one, and diagnosis: ${REDESIGN_DIAGNOSES.join(", ")}`);
  }
  if (verdict !== REDESIGN && answer.diagnosis !== undefined) errors.push(`${verdict} rewrites nothing, so it gives no diagnosis`);
  const asks = stated(answer.user_decision);
  if (LOCKING.includes(verdict) && !asks) errors.push(`${verdict} locks the branch until the user answers: give user_decision, the question they must answer`);
  if (!LOCKING.includes(verdict) && asks) errors.push(`${verdict} does not lock the branch, so it asks the user nothing: drop user_decision`);
  if (verdict === RESHAPE_SPEC && !findings.some(({ kind }) => kind === "spec_gap")) {
    errors.push("RESHAPE_SPEC needs at least one finding of kind spec_gap naming the unsettled decision");
  }
  return errors;
}

/** The assessor's answer, or why it cannot be recorded. */
export function readAssessment(body: unknown, { roundRef, findingIds, admissible, burden, token }: AssessmentContext): AssessmentRead {
  const parsed = assessmentShape(roundRef, admissible).safeParse(body);
  if (!parsed.success) return { ok: false, errors: issuesOf(parsed.error) };
  const answer = parsed.data;
  if (answer.brief_token !== token) {
    return {
      ok: false,
      errors: [
        "brief_token does not match: run the brief command from your instructions first; it prints the token together with the " +
          "facts this assessment must build on",
      ],
    };
  }
  const expected = findingIds.toSorted();
  const got = answer.findings.map(({ id }) => id).toSorted();
  const oneEach = expected.length === got.length && expected.every((id, index) => id === got[index]);
  const errors = [
    ...(oneEach ? [] : [`findings must hold exactly one entry per finding of the round; expected ids ${expected.join(", ")}, got ${got.join(", ")}`]),
    ...duplicateErrors(answer.findings),
    ...rulingErrors(answer.findings),
    ...verdictErrors(answer, burden),
  ];
  return errors.length === 0 ? { ok: true, assessment: answer } : { ok: false, errors };
}
