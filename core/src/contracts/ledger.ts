import { createHash } from "node:crypto";
import { z } from "zod";
import { HoldKind, valueSet } from "../values.ts";
import { Gates } from "./gates.ts";
import { sortedJsonText } from "./json-text.ts";
import { setExactlyWhen } from "./refinements.ts";
import { GitSha, NameSegment, Time } from "./scalars.ts";
import { HoldPlacement, Pushback, ReleasedBy, Round, RoundId, Ruling } from "./snapshot.ts";

// Events are permanent, so a later contract adds a version beside this one and never narrows it.
const V1 = z.literal(1);

const TAMPER_PREFIX = "tamper-";
const TAMPER_ID = new RegExp(`^${TAMPER_PREFIX}[0-9a-f]{40}$`);

function isTamperId(id: string): boolean {
  return TAMPER_ID.test(id);
}

const Release = z
  .strictObject({ id: NameSegment, since: Time.nullable(), released: Time, released_by: ReleasedBy })
  .superRefine((release, ctx) => {
    const tamper = isTamperId(release.id);
    if (!tamper && !HoldKind.schema.options.some((kind) => release.id.startsWith(`${kind}-`))) {
      ctx.addIssue({ code: "custom", path: ["id"], message: `a release names a hold, <kind>-…, or a tamper, ${TAMPER_PREFIX}<oid>` });
    }
    // A hold row reopens in place, so its since names the opening a release ends; a tamper's id is its commit's.
    setExactlyWhen(ctx, "since", release.since, !tamper, "the id is a hold's");
  });

const LedgerEventKind = valueSet({
  round: "a review round",
  ruling: "a round's ruling on one finding",
  "ruling-commit": "a commit a FIX ruling names",
  pushback: "a finding a round pushed back",
  hold: "a hold placed, or a released one reopened",
  release: "a hold's opening, or a tamper, released",
  gates: "the gates section, replaced whole",
});
const KIND = LedgerEventKind.schema.enum;

export const LedgerEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal(KIND.round), v: V1, round: Round }),
  z.strictObject({ kind: z.literal(KIND.ruling), v: V1, ruling: Ruling }).superRefine((event, ctx) => {
    if (event.ruling.commits.length > 0) {
      ctx.addIssue({ code: "custom", path: ["ruling", "commits"], message: "a ruling's commits are each a ruling-commit event" });
    }
  }),
  z.strictObject({ kind: z.literal(KIND["ruling-commit"]), v: V1, round: RoundId, key: z.string().min(1), commit: GitSha }),
  z.strictObject({ kind: z.literal(KIND.pushback), v: V1, pushback: Pushback }),
  z.strictObject({ kind: z.literal(KIND.hold), v: V1, hold: HoldPlacement }),
  z.strictObject({ kind: z.literal(KIND.release), v: V1, release: Release }),
  z.strictObject({ kind: z.literal(KIND.gates), v: V1, ref: NameSegment, gates: Gates }),
]);
export type LedgerEvent = z.infer<typeof LedgerEvent>;

function hashed(key: string): string {
  return createHash("sha256").update(key, "utf8").digest("hex");
}

function roundSegment({ stage, n }: RoundId): string {
  return `${stage}-${n}`;
}

// YYYYMMDDTHHMMSSZ: a `Time` without its separators.
function timeSegment(time: string): string {
  return time.replaceAll(/[-:]/g, "");
}

/** The event's file name in its story's directory: it keys the event, so a retry of one event is one file. */
export function eventFile(event: LedgerEvent): string {
  switch (event.kind) {
    case KIND.round:
      return `round.${event.round.run}.json`;
    case KIND.ruling:
      return `ruling.${roundSegment(event.ruling.round)}.${hashed(event.ruling.key)}.json`;
    case KIND["ruling-commit"]:
      return `ruling-commit.${roundSegment(event.round)}.${hashed(event.key)}.${event.commit}.json`;
    case KIND.pushback:
      return `pushback.${roundSegment(event.pushback.round)}.${hashed(event.pushback.key)}.json`;
    case KIND.hold:
      return `hold.${event.hold.id}.${timeSegment(event.hold.since)}.json`;
    case KIND.release: {
      const { id, since } = event.release;
      return since === null ? `release.${id}.json` : `release.${id}.${timeSegment(since)}.json`;
    }
    case KIND.gates:
      return `gates.${event.ref}.json`;
  }
}

export function eventText(event: LedgerEvent): string {
  return sortedJsonText(event);
}
