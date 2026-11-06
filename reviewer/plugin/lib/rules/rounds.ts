import type { Round, Ruling, Snapshot } from "../../core/contracts/snapshot.ts";
import type { SpecPr } from "../../core/identity.ts";
import type { Placement, StateReading } from "../../core/state.ts";
import { FindingRuling, HoldKind, RoundResult, RoundStage, RoundVerdict } from "../../core/values.ts";
import type { ReviewerSettings } from "../settings.ts";
import { isAfter, newest } from "./time.ts";

const { CLEAN, DIRTY, INCOMPLETE } = RoundResult.schema.enum;
const { PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK, ESCALATE } = RoundVerdict.schema.enum;
const { FIX } = FindingRuling.schema.enum;
const { AUDIT, GITHUB } = RoundStage.schema.enum;
const { escalation, rescope, pushback, audit } = HoldKind.schema.enum;

/** The assessor's word for a round whose findings show the spec does not settle a decision: RESCOPE unless it escalates. */
export const RESHAPE_SPEC = "RESHAPE_SPEC";

/** The round verdicts the assessor may name: one of what `roundVerdict` decides the recorded verdict from. */
export const ASSESSOR_VERDICTS = [PATCH, CLASS_FIX, REDESIGN, RESHAPE_SPEC, CONVERGED_PUSHBACK, ESCALATE] as const;
export type AssessorVerdict = (typeof ASSESSOR_VERDICTS)[number];

type FixingVerdict = typeof PATCH | typeof CLASS_FIX | typeof REDESIGN;
const FIXING: readonly AssessorVerdict[] = [PATCH, CLASS_FIX, REDESIGN];

export function isFixing(verdict: AssessorVerdict): verdict is FixingVerdict {
  return FIXING.includes(verdict);
}

// The verdicts that change the file a finding names in place, where a REDESIGN rewrites it (ADR-0018 d1).
const IN_PLACE: readonly AssessorVerdict[] = [PATCH, CLASS_FIX];

/** The round verdicts offered to the assessor: none that changes a file in place to a round `churned` by edits (facts.ts). */
export function admissibleVerdicts(churned: boolean): AssessorVerdict[] {
  return ASSESSOR_VERDICTS.filter((verdict) => !churned || !IN_PLACE.includes(verdict));
}

/** What the assessor finds a finding to be. */
export const FINDING_KINDS = ["defect", "fix_induced", "class_sibling", "duplicate", "spec_gap", "bikeshed", "gold_plating", "not_real"] as const;

export type AssessedFinding = {
  id: string;
  verdict: Ruling["ruling"];
  reason: string;
  kind: (typeof FINDING_KINDS)[number];
  spec_ref: string;
  mechanism: string;
};

/** The assessor's answer, as far as the round's verdict and question read it. */
export type Assessment = {
  findings: readonly AssessedFinding[];
  round_verdict: AssessorVerdict;
  user_decision: string | null;
  rationale: string;
};

/** A thread of the round, and `answers`, how many of the earlier rulings name its key. */
export type Deadlock = { key: string; answers: number };

/** A DIRTY round's verdict, and the question an ESCALATE or a RESCOPE puts to an admin. */
export type Raised = { verdict: NonNullable<Round["verdict"]>; question: string | null };

/** ADR-0021 d4: INCOMPLETE while an expected agent is silent, else DIRTY when one found something, else CLEAN. */
export function roundResult(expected: readonly string[], reports: ReadonlyMap<string, { findings: readonly unknown[] }>): Round["result"] {
  const answered = expected.map((type) => reports.get(type));
  if (answered.some((report) => report === undefined)) return INCOMPLETE;
  return answered.some((report) => (report?.findings.length ?? 0) > 0) ? DIRTY : CLEAN;
}

function escalations(assessment: Assessment, departures: ReadonlySet<string>, deadlocked: readonly Deadlock[]): string[] {
  return [
    ...assessment.findings.flatMap(({ id, verdict, reason }) => {
      if (verdict === ESCALATE) return [`${id} was ruled ${ESCALATE}: ${reason}`];
      // Reviewer ADR-0022 d4: a departure is ruled FIX or ESCALATE alone.
      if (departures.has(id) && verdict !== FIX) return [`ADR departure ${id} was ruled ${verdict}, where only ${FIX} or ${ESCALATE} may rule it: ${reason}`];
      return [];
    }),
    ...(assessment.round_verdict === ESCALATE ? [`the assessor could not decide: ${assessment.rationale}`] : []),
    ...deadlocked.map(({ key, answers }) => `the thread ${key} came back after ${answers} rulings`),
  ];
}

function questionOf(raised: string, why: readonly string[], decide: string | null): string {
  return [`The round ${raised} because:`, ...why.map((line) => `- ${line}`), `To decide: ${decide ?? "how each point above is settled"}`].join("\n");
}

/**
 * A DIRTY round's verdict, the first of reviewer ADR-0017 d2 that matches: ESCALATE, RESCOPE, the assessor's
 * fixing verdict when a finding is ruled FIX, else CONVERGED_PUSHBACK. `departures` are the ids of the findings the
 * decision check reported.
 */
export function roundVerdict(assessment: Assessment, departures: ReadonlySet<string>, deadlocked: readonly Deadlock[]): Raised {
  const why = escalations(assessment, departures, deadlocked);
  if (why.length > 0) return { verdict: ESCALATE, question: questionOf("escalated", why, assessment.user_decision) };
  if (assessment.round_verdict === RESHAPE_SPEC) {
    const gaps = assessment.findings.filter(({ kind }) => kind === "spec_gap").map(({ mechanism, spec_ref }) => `spec gap: ${mechanism} (${spec_ref})`);
    return { verdict: RESCOPE, question: questionOf("rescoped", [assessment.rationale, ...gaps], assessment.user_decision) };
  }
  if (!assessment.findings.some(({ verdict }) => verdict === FIX)) return { verdict: CONVERGED_PUSHBACK, question: null };
  if (!isFixing(assessment.round_verdict)) {
    throw new TypeError(`the assessment rules a finding ${FIX} yet names ${assessment.round_verdict}, which fixes nothing`);
  }
  return { verdict: assessment.round_verdict, question: null };
}

/** The round's threads whose key at least `kTopic` of the `earlier` rulings name. */
export function deadlocks(threads: readonly { key: string }[], earlier: readonly Ruling[], kTopic: number): Deadlock[] {
  return threads.flatMap(({ key }) => {
    const answers = earlier.filter((ruling) => ruling.key === key).length;
    return answers >= kTopic ? [{ key, answers }] : [];
  });
}

/** What a round's launch recorded: its stage, its workflow run and the head it reviewed. */
export type Launched = Pick<Round, "stage" | "run" | "head">;

/** The round a report records, numbered after its stage's rounds; core stamps `at` from GitHub's clock. */
export function roundOf(snapshot: Snapshot | null, launched: Launched, result: Round["result"], raised: Raised | null, at: string): Round {
  const n = 1 + (snapshot?.rounds.filter((round) => round.stage === launched.stage).length ?? 0);
  return { ...launched, n, result, verdict: raised?.verdict ?? null, root_cause: null, at };
}

/** The rounds of `stage` that completed, CLEAN or DIRTY, after `floor`, `adminFloor`'s time. */
export function completedSince<Recorded extends Pick<Round, "stage" | "result" | "at">>(
  rounds: readonly Recorded[],
  stage: Round["stage"],
  floor: string | null,
): Recorded[] {
  return rounds.filter((round) => round.stage === stage && (round.result === CLEAN || round.result === DIRTY) && isAfter(round.at, floor));
}

/**
 * The newest of `/codeworks reset` and an admin's release of any hold: the cap's and the audits' counts restart there
 * (reviewer ADR-0019 d5, ADR-0013 d4).
 */
export function adminFloor({ snapshot, reset }: Pick<StateReading, "snapshot" | "reset">): string | null {
  return newest([reset?.at ?? null, ...(snapshot?.holds ?? []).map((row) => row.released)]);
}

function unconvergedAudit(round: Round): boolean {
  return round.stage === AUDIT && round.result === DIRTY && round.verdict !== CONVERGED_PUSHBACK;
}

/** A round about to be recorded and what its holds are placed from. */
export type RoundPlacing = {
  issue: number;
  /** The reading's, before the round. */
  snapshot: Snapshot | null;
  round: Round;
  /** `Raised.question` of an ESCALATE or a RESCOPE. */
  question: string | null;
  ruledFix: boolean;
  /** The merge blockers failing at the head, for a github round. */
  blockers: readonly string[];
  floor: string | null;
};

/** The holds a round places, reviewer ADR-0013 d4's table and d5's verdict rescope. */
export function placements(
  { issue, snapshot, round, question, ruledFix, blockers, floor }: RoundPlacing,
  settings: Pick<ReviewerSettings, "max_audits">,
): Placement[] {
  const placed: Placement[] = [];
  if (round.verdict === ESCALATE) placed.push({ id: `${escalation}-${issue}`, kind: escalation, question });
  if (round.verdict === RESCOPE) placed.push({ id: `${rescope}-${issue}`, kind: rescope, question });
  if (round.stage === GITHUB && round.result === DIRTY && !ruledFix && blockers.length > 0) {
    placed.push({ id: `${pushback}-${issue}`, kind: pushback, question: null });
  }
  // The round is being recorded, so it is after the floor whatever `at` core stamps on it.
  const earlier = (snapshot?.rounds ?? []).filter((each) => unconvergedAudit(each) && isAfter(each.at, floor));
  if (unconvergedAudit(round) && earlier.length + 1 >= settings.max_audits) placed.push({ id: `${audit}-${issue}`, kind: audit, question: null });
  return placed;
}

/** The spec PR a story's `rescope-` hold records when it is seen open (ADR-0013 d5); core places nothing twice. */
export function specPrHold(pr: SpecPr | null): number | null {
  return pr?.state === "open" ? pr.number : null;
}
