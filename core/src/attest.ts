import type { Hold, Round, Snapshot } from "./contracts/snapshot.ts";
import { runGit } from "./git.ts";
import { secondOf, type StateCause, type StateReading } from "./state.ts";
import { isPlainPath, lsTreeRecords, type LsTreeRecord } from "./tree.ts";
import { RoundResult, RoundStage, RoundVerdict } from "./values.ts";

export type Attestation = { attested: boolean; reason: string | null };

// Only the stages that review the committed head; a GITHUB round, stage 2, never counts for or against
// (orchestrator ADR-0004 d1).
const ATTESTING_STAGES: ReadonlySet<Round["stage"]> = new Set([RoundStage.schema.enum.INTERNAL, RoundStage.schema.enum.AUDIT]);

function passes(round: Round): boolean {
  if (round.result === RoundResult.schema.enum.CLEAN) return true;
  return round.result === RoundResult.schema.enum.DIRTY && round.verdict === RoundVerdict.schema.enum.CONVERGED_PUSHBACK;
}

/** The rounds that may attest, newest first. */
export function passingRounds(snapshot: Snapshot): Round[] {
  return snapshot.rounds.filter((round) => ATTESTING_STAGES.has(round.stage) && passes(round)).toReversed();
}

const ADR_TREE = "docs/adr";
const CONSTITUTION_TREE = ".specify/memory";
const TREE_TYPE = "tree";

// A folder spelt any other way would never equal a listed path, and its spec.md would silently govern nothing.
function assertSpecFolder(specFolder: string): void {
  if (!isPlainPath(specFolder)) throw new TypeError(`not a spec folder path inside the tree: ${JSON.stringify(specFolder)}`);
}

// With `--full-tree -r`, a record's name is its path from the root.
function governs(listed: LsTreeRecord, specFolder: string): boolean {
  if (listed.name === `${specFolder}/spec.md` || listed.name === CONSTITUTION_TREE) return true;
  return listed.type === TREE_TYPE && (listed.name === ADR_TREE || listed.name.endsWith(`/${ADR_TREE}`));
}

/**
 * The governing paths whose object differs between two `ls-tree -r -t -z` listings, or that only one holds, in
 * path order. A tree's object id covers everything under it, so one entry per folder compares it whole.
 */
export function governingDiff(atBase: string, atRound: string, specFolder: string): string[] {
  assertSpecFolder(specFolder);
  const governing = (listing: string): Map<string, string> =>
    new Map(
      lsTreeRecords(listing)
        .filter((listed) => governs(listed, specFolder))
        .map((listed) => [listed.name, listed.object]),
    );
  const base = governing(atBase);
  const round = governing(atRound);
  return [...new Set([...base.keys(), ...round.keys()])].filter((path) => base.get(path) !== round.get(path)).sort();
}

/** A hold an admin's comment released after the round was recorded; a reset lapses nothing. */
export function releasedByComment(snapshot: Snapshot, round: Round): Hold | null {
  return (
    snapshot.holds.find(
      (hold) =>
        hold.released_by !== null && !hold.released_by.reset && hold.released !== null && secondOf(hold.released) > secondOf(round.at),
    ) ?? null
  );
}

function roundName(round: Round): string {
  return `round ${round.stage} ${round.n} at ${round.head}`;
}

function causeText(cause: StateCause): string {
  if ("id" in cause) return `${cause.cause} ${cause.id}`;
  if ("error" in cause) return `${cause.cause}: ${cause.error}`;
  return cause.cause;
}

// Resolved once, so a revision the clone lacks throws here, not as "not in history" from `merge-base`, and no
// later git call reads a caller's string as an option.
async function commitOf(checkout: string, revision: string): Promise<string> {
  return (await runGit(checkout, ["rev-parse", "--verify", "--end-of-options", `${revision}^{commit}`])).stdout.trim();
}

// Exit 1 is "not an ancestor"; 128 is a round commit the clone does not hold, which is not in the head's history
// either (R16; critique E5).
async function newestInHistory(checkout: string, rounds: readonly Round[], head: string): Promise<Round | null> {
  for (const round of rounds) {
    const { code } = await runGit(checkout, ["merge-base", "--is-ancestor", round.head, head], [1, 128]);
    if (code === 0) return round;
  }
  return null;
}

async function listing(checkout: string, commit: string): Promise<string> {
  return (await runGit(checkout, ["ls-tree", "-r", "-t", "-z", "--full-tree", commit])).stdout;
}

async function governingLapse(
  checkout: string,
  round: Round,
  base: string,
  baseCommit: string,
  specFolder: string,
): Promise<string | null> {
  const [atBase, atRound] = await Promise.all([listing(checkout, baseCommit), listing(checkout, round.head)]);
  const changed = governingDiff(atBase, atRound, specFolder);
  if (changed.length === 0) return null;
  return `governing documents differ between ${base} and ${roundName(round)}: ${changed.join(", ")}`;
}

// GitHub has no clean-merge API: a merge counts only when its tree is the one git makes of its parents (R16).
async function mergeLapse(checkout: string, round: Round, head: string): Promise<string | null> {
  const { stdout } = await runGit(checkout, ["rev-list", "--merges", "--parents", `${round.head}..${head}`]);
  for (const line of stdout.split("\n").filter((text) => text !== "")) {
    const [merge, ...parents] = line.split(" ");
    // `merge-tree --write-tree` merges two commits; git's own merge of more is not one it can remake.
    if (parents.length !== 2) return `merge ${merge} since ${roundName(round)} has ${parents.length} parents, not two`;
    const made = await runGit(checkout, ["merge-tree", "--write-tree", ...parents], [1]);
    if (made.code === 1) return `merge ${merge} since ${roundName(round)} was resolved from a conflict`;
    const madeTree = made.stdout.split("\n", 1)[0];
    const tree = (await runGit(checkout, ["rev-parse", `${merge}^{tree}`])).stdout.trim();
    if (tree !== madeTree) return `merge ${merge} since ${roundName(round)} is not git's clean merge of its parents`;
  }
  return null;
}

function commentLapse(snapshot: Snapshot, round: Round): string | null {
  const hold = releasedByComment(snapshot, round);
  if (hold === null) return null;
  return `hold ${hold.id} was released by an admin's comment at ${hold.released}, after ${roundName(round)}`;
}

/**
 * Whether a passing round vouches for `head` (contracts/state-comment.md, Attestation). `checkout` is a clone the
 * caller has fetched to `head` and to `base`, the default branch's ref.
 */
export async function attests(
  checkout: string,
  reading: Pick<StateReading, "snapshot" | "held" | "causes">,
  head: string,
  base: string,
  specFolder: string,
): Promise<Attestation> {
  assertSpecFolder(specFolder);
  const headCommit = await commitOf(checkout, head);
  const baseCommit = await commitOf(checkout, base);
  if (reading.snapshot === null) return { attested: false, reason: "no passing round: no state" };
  if (reading.held) return { attested: false, reason: `held: ${reading.causes.map(causeText).join("; ")}` };

  const round = await newestInHistory(checkout, passingRounds(reading.snapshot), headCommit);
  if (round === null) return { attested: false, reason: `no passing round at ${head} or in its history` };

  const lapse =
    (await governingLapse(checkout, round, base, baseCommit, specFolder)) ??
    (await mergeLapse(checkout, round, headCommit)) ??
    commentLapse(reading.snapshot, round);
  return lapse === null ? { attested: true, reason: null } : { attested: false, reason: lapse };
}
