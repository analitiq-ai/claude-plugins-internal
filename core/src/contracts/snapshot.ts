import { z } from "zod";
import { FindingRuling, HoldKind, HoldState, RootCause, RoundResult, RoundStage, RoundVerdict } from "../values.ts";

// Whole seconds, as GitHub's clock gives them: core stamps every time from the client's `now()`, so no caller's
// clock or precision ever reaches a snapshot.
export const Time = z.iso.datetime({ precision: 0 });

// The pair that names a round, so a pushback names its round by the same fields the round carries.
export const RoundId = z.strictObject({ stage: RoundStage.schema, n: z.int().min(1) });
export type RoundId = z.infer<typeof RoundId>;

export const CommitSha = z.string().regex(/^[0-9a-f]{40}$/);

export function setExactlyWhen(ctx: z.RefinementCtx, field: string, value: unknown, condition: boolean, when: string): void {
  if ((value !== null) !== condition) {
    ctx.addIssue({ code: "custom", path: [field], message: `${field} is set exactly when ${when}` });
  }
}

export const Round = z
  .strictObject({
    ...RoundId.shape,
    head: CommitSha,
    result: RoundResult.schema,
    verdict: RoundVerdict.schema.nullable(),
    root_cause: RootCause.schema.nullable(),
    at: Time,
  })
  .superRefine((round, ctx) => {
    const dirty = RoundResult.schema.enum.DIRTY;
    setExactlyWhen(ctx, "verdict", round.verdict, round.result === dirty, `result is ${dirty}`);
  });
export type Round = z.infer<typeof Round>;

export const Hold = z
  .strictObject({
    id: z.string(),
    kind: HoldKind.schema,
    state: HoldState.schema,
    since: Time,
    released: Time.nullable(),
    released_by: z.strictObject({ comment: z.int(), reset: z.boolean() }).nullable(),
    question: z.string().min(1).nullable(),
    spec_pr: z.int().min(1).nullable(),
  })
  .superRefine((hold, ctx) => {
    const prefix = `${hold.kind}-`;
    if (!hold.id.startsWith(prefix)) {
      ctx.addIssue({ code: "custom", path: ["id"], message: `a ${hold.kind} hold's id starts with "${prefix}"` });
    }
    const released = HoldState.schema.enum.RELEASED;
    setExactlyWhen(ctx, "released", hold.released, hold.state === released, `state is ${released}`);
    setExactlyWhen(ctx, "released_by", hold.released_by, hold.state === released, `state is ${released}`);
    const escalation = HoldKind.schema.enum.escalation;
    setExactlyWhen(ctx, "question", hold.question, hold.kind === escalation, `kind is ${escalation}`);
    // One way only: a rescope placed by a RESCOPE verdict records no spec PR (reviewer ADR-0013 d5).
    const rescope = HoldKind.schema.enum.rescope;
    if (hold.spec_pr !== null && hold.kind !== rescope) {
      ctx.addIssue({ code: "custom", path: ["spec_pr"], message: `spec_pr is null for every kind but ${rescope}` });
    }
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
    commits: z.array(CommitSha),
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
  })
  .superRefine((snapshot, ctx) => {
    const rounds = new Set<string>();
    snapshot.rounds.forEach((round, i) => {
      const name = roundName(round);
      if (rounds.has(name)) {
        ctx.addIssue({ code: "custom", path: ["rounds", i], message: `round ${name} is already in rounds` });
      }
      rounds.add(name);
    });
    // One row per id: placing a released hold again reopens its own row (reviewer ADR-0013 d1).
    const holds = new Set<string>();
    snapshot.holds.forEach((hold, i) => {
      if (holds.has(hold.id)) {
        ctx.addIssue({ code: "custom", path: ["holds", i, "id"], message: `hold ${hold.id} already has a row` });
      }
      holds.add(hold.id);
    });
    snapshot.pushbacks.forEach((pushback, i) => {
      const name = roundName(pushback.round);
      if (!rounds.has(name)) {
        ctx.addIssue({ code: "custom", path: ["pushbacks", i, "round"], message: `round ${name} is not in rounds` });
      }
    });
    // A round's assessment rules each of its findings once.
    const ruled = new Set<string>();
    snapshot.rulings.forEach((ruling, i) => {
      const name = roundName(ruling.round);
      if (!rounds.has(name)) {
        ctx.addIssue({ code: "custom", path: ["rulings", i, "round"], message: `round ${name} is not in rounds` });
      }
      const finding = `${name} ${ruling.key}`;
      if (ruled.has(finding)) {
        ctx.addIssue({ code: "custom", path: ["rulings", i], message: `${ruling.key} is already ruled in round ${name}` });
      }
      ruled.add(finding);
    });
  });
export type Snapshot = z.infer<typeof Snapshot>;
