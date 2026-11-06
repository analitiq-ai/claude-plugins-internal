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

/** The id the fold derives for invalid commit `oid`, which its release names. */
export function tamperId(oid: string): string {
  return `${TAMPER_PREFIX}${oid}`;
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

// Declared in the order one commit's events apply in.
const LedgerEventKind = valueSet({
  round: "a review round",
  ruling: "a round's ruling on one finding",
  "ruling-commit": "a commit a FIX ruling names",
  pushback: "a finding a round pushed back",
  hold: "a hold placed, or a released one reopened",
  release: "a hold's opening, or a tamper, released",
  gates: "the gates section, replaced whole",
});
/** The kinds by name, so a module outside this one names a kind without quoting it. */
export const EVENT_KIND = LedgerEventKind.schema.enum;

export const LedgerEvent = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal(EVENT_KIND.round), v: V1, round: Round }),
  z.strictObject({ kind: z.literal(EVENT_KIND.ruling), v: V1, ruling: Ruling }).superRefine((event, ctx) => {
    if (event.ruling.commits.length > 0) {
      ctx.addIssue({ code: "custom", path: ["ruling", "commits"], message: "a ruling's commits are each a ruling-commit event" });
    }
  }),
  z.strictObject({ kind: z.literal(EVENT_KIND["ruling-commit"]), v: V1, round: RoundId, key: z.string().min(1), commit: GitSha }),
  z.strictObject({ kind: z.literal(EVENT_KIND.pushback), v: V1, pushback: Pushback }),
  z.strictObject({ kind: z.literal(EVENT_KIND.hold), v: V1, hold: HoldPlacement }),
  z.strictObject({ kind: z.literal(EVENT_KIND.release), v: V1, release: Release }),
  z.strictObject({ kind: z.literal(EVENT_KIND.gates), v: V1, ref: NameSegment, gates: Gates }),
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

/** The file of the gates event check `ref` records. */
export function gatesFile(ref: string): string {
  return `gates.${ref}.json`;
}

/** The event's file name in its story's directory: it keys the event, so a retry of one event is one file. */
export function eventFile(event: LedgerEvent): string {
  switch (event.kind) {
    case EVENT_KIND.round:
      return `round.${event.round.run}.json`;
    case EVENT_KIND.ruling:
      return `ruling.${roundSegment(event.ruling.round)}.${hashed(event.ruling.key)}.json`;
    case EVENT_KIND["ruling-commit"]:
      return `ruling-commit.${roundSegment(event.round)}.${hashed(event.key)}.${event.commit}.json`;
    case EVENT_KIND.pushback:
      return `pushback.${roundSegment(event.pushback.round)}.${hashed(event.pushback.key)}.json`;
    case EVENT_KIND.hold:
      return `hold.${event.hold.id}.${timeSegment(event.hold.since)}.json`;
    case EVENT_KIND.release: {
      const { id, since } = event.release;
      return since === null ? `release.${id}.json` : `release.${id}.${timeSegment(since)}.json`;
    }
    case EVENT_KIND.gates:
      return gatesFile(event.ref);
  }
}

/** Two file names of a story's directory in git's tree order, which compares code units. */
export function byFileName(a: string, b: string): number {
  if (a < b) return -1;
  return a > b ? 1 : 0;
}

/** `events` in the order one commit's events apply in: by kind, as `LedgerEventKind` declares them, then by file name. */
export function inApplyOrder(events: readonly LedgerEvent[]): LedgerEvent[] {
  const kinds: readonly string[] = LedgerEventKind.schema.options;
  return events
    .map((event) => ({ event, rank: kinds.indexOf(event.kind), file: eventFile(event) }))
    .toSorted((a, b) => a.rank - b.rank || byFileName(a.file, b.file))
    .map(({ event }) => event);
}

export function eventText(event: LedgerEvent): string {
  return sortedJsonText(event);
}
