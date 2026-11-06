import type { Bug, Gates, Lineage } from "../../core/contracts/gates.ts";
import type { Hold } from "../../core/contracts/snapshot.ts";
import type { Opening } from "../../core/state.ts";
import { ClaimVerdict, HoldKind, HoldState } from "../../core/values.ts";
import type { ReviewerSettings } from "../settings.ts";
import { isAfter } from "./time.ts";

const { WRONG } = ClaimVerdict.schema.enum;
const { claim, shim } = HoldKind.schema.enum;
const { OPEN, RELEASED } = HoldState.schema.enum;

/** What the claim check said of the newest WRONG ruling: the hold's question carries it (ADR-0013 d4). */
export type WrongRuling = { failing_case: string; evidence: string };

function wrongs(lineage: Lineage, after: string | null): Lineage["chain"] {
  return lineage.chain.filter((entry) => entry.ruling === WRONG && isAfter(entry.at, after));
}

function membersAfter(bug: Bug, after: string | null): Bug["members"] {
  return bug.members.filter((member) => isAfter(member.at, after));
}

/** The checks that ruled the lineage WRONG after the reset, a check counting once whatever claims it ruled. */
export function lineageCount(lineage: Lineage, reset: string | null): number {
  return new Set(wrongs(lineage, reset).map((entry) => entry.ref)).size;
}

/** The bug's members after the reset; an absorbed tree was counted by the bug it came from. */
export function bugCount(bug: Bug, reset: string | null): number {
  return membersAfter(bug, reset).length;
}

/**
 * Whether the hold is placed now. An OPEN row already holds. A release by an admin's comment lowers no count, so its
 * row is placed again only on what came after the release, which `since` reads (ADR-0013 d4); a release by
 * `/codeworks reset` restarts the count (d3), which must reach `holdAt` again.
 */
function reaches(row: Hold | undefined, count: number, holdAt: number, since: (released: string) => boolean): boolean {
  if (row?.state === OPEN) return false;
  if (row?.state === RELEASED && row.released !== null && row.released_by?.reset === false) return since(row.released);
  return count >= holdAt;
}

/**
 * `claim-<id>`, unless its row is OPEN: for a row released by an admin's comment, once a check rules the lineage
 * WRONG after the release; otherwise once its count reaches `claim_hold_at`.
 */
export function claimOpening(
  lineage: Lineage,
  row: Hold | undefined,
  reset: string | null,
  last: WrongRuling,
  settings: Pick<ReviewerSettings, "claim_hold_at">,
): Opening | null {
  const count = lineageCount(lineage, reset);
  if (!reaches(row, count, settings.claim_hold_at, (released) => wrongs(lineage, released).length > 0)) return null;
  // Reaching takes a WRONG ruling, so the lineage has one.
  const newest = wrongs(lineage, null).reduce((found, entry) => (isAfter(entry.at, found.at) ? entry : found));
  return {
    id: `${claim}-${lineage.id}`,
    question: [
      `The claim "${newest.words}" (${lineage.file}:${newest.line}) was ruled ${WRONG} by ${count} checks since the count began.`,
      `Failing case: ${last.failing_case}`,
      `Evidence: ${last.evidence}`,
      "To decide: does the claim or the code it describes change?",
    ].join("\n"),
  };
}

/** Whether the bug's deep sweep is due: it reached `shim_deep_at` and has none yet. */
export function deepDue(bug: Bug, reset: string | null, settings: Pick<ReviewerSettings, "shim_deep_at">): boolean {
  return bug.deep === null && bugCount(bug, reset) >= settings.shim_deep_at;
}

/**
 * `shim-<id>`, unless its row is OPEN: for a row released by an admin's comment, once the bug gains a member after
 * the release; otherwise once its count reaches `shim_hold_at`.
 */
export function shimOpening(bug: Bug, row: Hold | undefined, reset: string | null, settings: Pick<ReviewerSettings, "shim_hold_at">): Opening | null {
  const placed = reaches(row, bugCount(bug, reset), settings.shim_hold_at, (released) => membersAfter(bug, released).length > 0);
  return placed ? { id: `${shim}-${bug.id}`, question: null } : null;
}

const rangeKey = (range: Bug["ranges"][number]): string => JSON.stringify([range.file, range.old_start, range.old_count]);

/**
 * Bugs that converged, as one (ADR-0008 d2): the bug with the higher count after the reset, the smaller id on a tie,
 * keeps its id, members and deep lists; the others' trees become absorbed, so no tree counts twice and the count is
 * the higher one, not the sum.
 */
export function mergeBugs(bugs: readonly Bug[], reset: string | null): Bug {
  const [survivor, ...others] = bugs.toSorted((a, b) => bugCount(b, reset) - bugCount(a, reset) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (survivor === undefined) throw new RangeError("mergeBugs needs at least one bug");
  const ranges = new Map(survivor.ranges.map((range) => [rangeKey(range), range]));
  const rulings = new Map(survivor.rulings.map((ruling) => [ruling.site, ruling]));
  for (const other of others) {
    for (const range of other.ranges) if (!ranges.has(rangeKey(range))) ranges.set(rangeKey(range), range);
    for (const ruling of other.rulings) if (!rulings.has(ruling.site)) rulings.set(ruling.site, ruling);
  }
  return {
    ...survivor,
    absorbed: [...survivor.absorbed, ...others.flatMap((other) => [...other.members, ...other.absorbed])],
    ranges: [...ranges.values()],
    rulings: [...rulings.values()],
  };
}

/**
 * The section with only its open items: a lineage with a place left and a bug with a range left. A moved file's
 * lineages and ranges go, so its new path starts with none (ADR-0001 d2); a bug with a range in another file keeps
 * its members and count.
 */
export function openItems(gates: Gates, moved: ReadonlySet<string>): Gates {
  return {
    ...gates,
    lineages: gates.lineages.filter((lineage) => lineage.places.length > 0 && !moved.has(lineage.file)),
    bugs: gates.bugs.flatMap((bug) => {
      const ranges = bug.ranges.filter((range) => !moved.has(range.file));
      return ranges.length > 0 ? [{ ...bug, ranges }] : [];
    }),
  };
}
