import { z } from "zod";
import { FindingRuling, HoldKind, HoldState, RootCause, RoundResult, RoundStage, RoundVerdict } from "../values.ts";
import { Gates } from "./gates.ts";
import { setExactlyWhen } from "./refinements.ts";
import { GitSha, NameSegment, Time } from "./scalars.ts";

// The pair that names a round, so a pushback names its round by the same fields the round carries.
export const RoundId = z.strictObject({ stage: RoundStage.schema, n: z.int().min(1) });
export type RoundId = z.infer<typeof RoundId>;

// Stable across heads, so a pushback recorded at one head names the same item at the next. A round records each
// finding's key and position and no text (reviewer ADR-0016 d2).
export const RoundFinding = z.strictObject({
  key: z.string().min(1),
  file: z.string().nullable(),
  line: z.int().min(1).nullable(),
});
export type RoundFinding = z.infer<typeof RoundFinding>;

export const Round = z
  .strictObject({
    ...RoundId.shape,
    // The round's ledger file is `round.<run>.json`.
    run: NameSegment,
    head: GitSha,
    result: RoundResult.schema,
    verdict: RoundVerdict.schema.nullable(),
    root_cause: RootCause.schema.nullable(),
    at: Time,
    findings: z.array(RoundFinding),
  })
  .superRefine((round, ctx) => {
    const dirty = RoundResult.schema.enum.DIRTY;
    setExactlyWhen(ctx, "verdict", round.verdict, round.result === dirty, `result is ${dirty}`);
    const keys = new Set<string>();
    round.findings.forEach((finding, i) => {
      if (keys.has(finding.key)) {
        ctx.addIssue({ code: "custom", path: ["findings", i, "key"], message: `${finding.key} is already a finding of this round` });
      }
      keys.add(finding.key);
    });
    const listed = round.findings.length > 0;
    if (listed !== (round.result === dirty)) {
      ctx.addIssue({ code: "custom", path: ["findings"], message: `findings is non-empty exactly when result is ${dirty}` });
    }
  });
export type Round = z.infer<typeof Round>;

const PlacementShape = z.strictObject({
  id: NameSegment,
  kind: HoldKind.schema,
  since: Time,
  question: z.string().min(1).nullable(),
  spec_pr: z.int().min(1).nullable(),
});

type Placed = { id: string; kind: z.infer<typeof HoldKind.schema>; question: string | null; spec_pr: number | null };

function placementRules(hold: Placed, ctx: z.RefinementCtx): void {
  const prefix = `${hold.kind}-`;
  if (!hold.id.startsWith(prefix)) {
    ctx.addIssue({ code: "custom", path: ["id"], message: `a ${hold.kind} hold's id starts with "${prefix}"` });
  }
  // The question an admin answers (orchestrator ADR-0010 d1, reviewer ADR-0013 d4-d5); a rescope with a spec PR
  // asks none.
  const { escalation, claim, rescope } = HoldKind.schema.enum;
  const asks = hold.kind === escalation || hold.kind === claim || (hold.kind === rescope && hold.spec_pr === null);
  setExactlyWhen(ctx, "question", hold.question, asks, `kind is ${escalation} or ${claim}, or ${rescope} with no spec_pr`);
  if (hold.spec_pr !== null && hold.kind !== rescope) {
    ctx.addIssue({ code: "custom", path: ["spec_pr"], message: `spec_pr is null for every kind but ${rescope}` });
  }
}

/** A hold as a write asks for it, checked before core asks GitHub's clock for its `since`. */
export const HoldRequest = PlacementShape.omit({ since: true }).superRefine(placementRules);
export type HoldRequest = z.infer<typeof HoldRequest>;

/** A hold as its ledger event places it: a row without its state and release fields. */
export const HoldPlacement = PlacementShape.superRefine(placementRules);
export type HoldPlacement = z.infer<typeof HoldPlacement>;

export const ReleasedBy = z.strictObject({ comment: z.int(), reset: z.boolean() });

export const Hold = z
  .strictObject({
    ...PlacementShape.shape,
    state: HoldState.schema,
    released: Time.nullable(),
    released_by: ReleasedBy.nullable(),
  })
  .superRefine((hold, ctx) => {
    placementRules(hold, ctx);
    const released = HoldState.schema.enum.RELEASED;
    setExactlyWhen(ctx, "released", hold.released, hold.state === released, `state is ${released}`);
    setExactlyWhen(ctx, "released_by", hold.released_by, hold.state === released, `state is ${released}`);
  });
export type Hold = z.infer<typeof Hold>;

export const Pushback = z.strictObject({ key: z.string(), round: RoundId });
export type Pushback = z.infer<typeof Pushback>;

// Keyed as a finding is, so a FIX on a failing required check names its commits as one on a thread does: at stage 2
// a push adds only commits a FIX ruling names (orchestrator ADR-0001 d4).
export const Ruling = z
  .strictObject({
    key: z.string().min(1),
    round: RoundId,
    ruling: FindingRuling.schema,
    // The finding's own field when ruled: a trusted comment after it is a fresh finding this ruling does not answer
    // (reviewer ADR-0016 d3), so its thread is not resolved with this reply.
    latest_trusted_comment_id: z.string().nullable(),
    // The orchestrator App posts it before resolving the thread (orchestrator ADR-0007 d7); a finding with no thread
    // has nowhere to answer.
    reply: z.string().min(1).nullable(),
    // Appended as each passes reviewer's commit check, after the round that ruled it.
    commits: z.array(GitSha),
  })
  .superRefine((ruling, ctx) => {
    const thread = ruling.latest_trusted_comment_id !== null;
    setExactlyWhen(ctx, "reply", ruling.reply, thread, "latest_trusted_comment_id is set");
    const fix = FindingRuling.schema.enum.FIX;
    if (ruling.commits.length > 0 && ruling.ruling !== fix) {
      ctx.addIssue({ code: "custom", path: ["commits"], message: `commits is empty on every ruling but ${fix}` });
    }
  });
export type Ruling = z.infer<typeof Ruling>;

function roundName({ stage, n }: RoundId): string {
  return `${stage} ${n}`;
}

export const Snapshot = z
  .strictObject({
    v: z.literal(1),
    rounds: z.array(Round),
    holds: z.array(Hold),
    pushbacks: z.array(Pushback),
    rulings: z.array(Ruling),
    gates: Gates.nullable(),
  })
  .superRefine((snapshot, ctx) => {
    // Per round, its findings' keys: what a pushback or a ruling on it names.
    const rounds = new Map<string, ReadonlySet<string>>();
    snapshot.rounds.forEach((round, i) => {
      const name = roundName(round);
      if (rounds.has(name)) {
        ctx.addIssue({ code: "custom", path: ["rounds", i], message: `round ${name} is already in rounds` });
        return;
      }
      rounds.set(name, new Set(round.findings.map((finding) => finding.key)));
    });
    // One row per id: placing a released hold again reopens its own row (reviewer ADR-0013 d1).
    const holds = new Set<string>();
    snapshot.holds.forEach((hold, i) => {
      if (holds.has(hold.id)) {
        ctx.addIssue({ code: "custom", path: ["holds", i, "id"], message: `hold ${hold.id} already has a row` });
      }
      holds.add(hold.id);
    });
    // A round not in rounds has no findings to name, so the item is refused once, at its round.
    const namesFinding = (path: Array<string | number>, { key, round }: Pushback): void => {
      const name = roundName(round);
      const keys = rounds.get(name);
      if (keys === undefined) {
        ctx.addIssue({ code: "custom", path: [...path, "round"], message: `round ${name} is not in rounds` });
      } else if (!keys.has(key)) {
        ctx.addIssue({ code: "custom", path: [...path, "key"], message: `${key} is not a finding of round ${name}` });
      }
    };
    snapshot.pushbacks.forEach((pushback, i) => namesFinding(["pushbacks", i], pushback));
    // A round's assessment rules each of its findings once.
    const ruled = new Set<string>();
    snapshot.rulings.forEach((ruling, i) => {
      namesFinding(["rulings", i], ruling);
      const name = roundName(ruling.round);
      const finding = `${name} ${ruling.key}`;
      if (ruled.has(finding)) {
        ctx.addIssue({ code: "custom", path: ["rulings", i], message: `${ruling.key} is already ruled in round ${name}` });
      }
      ruled.add(finding);
    });
  });
export type Snapshot = z.infer<typeof Snapshot>;
