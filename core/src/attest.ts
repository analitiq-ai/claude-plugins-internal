import type { Hold, Round, Snapshot } from "./contracts/snapshot.ts";
import { commitOf, runGit } from "./git.ts";
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
function governs(listed: LsTreeRecord, specs: ReadonlySet<string>): boolean {
  if (specs.has(listed.name) || listed.name === CONSTITUTION_TREE) return true;
  return listed.type === TREE_TYPE && (listed.name === ADR_TREE || listed.name.endsWith(`/${ADR_TREE}`));
}

/**
 * The governing paths whose object differs between two `ls-tree -r -t -z` listings, or that only one holds, in
 * path order. A tree's object id covers everything under it, so one entry per folder compares it whole.
 */
export function governingDiff(atBase: string, atRound: string, specFolders: readonly string[]): string[] {
  for (const folder of specFolders) assertSpecFolder(folder);
  const specs = new Set(specFolders.map((folder) => `${folder}/spec.md`));
  const governing = (listing: string): Map<string, string> =>
    new Map(
      lsTreeRecords(listing)
        .filter((listed) => governs(listed, specs))
        .map((listed) => [listed.name, listed.object]),
    );
  const base = governing(atBase);
  const round = governing(atRound);
  return [...new Set([...base.keys(), ...round.keys()])].filter((path) => base.get(path) !== round.get(path)).sort();
}

type Release = Pick<Hold, "id" | "released" | "released_by">;

/** A hold or tamper an admin's comment released after the round was recorded; a reset lapses nothing. */
export function releasedByComment(rows: readonly Release[], round: Round): Release | null {
  return (
    rows.find(
      (row) => row.released_by !== null && !row.released_by.reset && row.released !== null && secondOf(row.released) > secondOf(round.at),
    ) ?? null
  );
}

function roundName(round: Round): string {
  return `round ${round.stage} ${round.n} at ${round.head}`;
}

function causeText(cause: StateCause): string {
  const named = `${cause.cause} ${cause.id}`;
  if (cause.cause === "open_hold") return named;
  return `${named}, leaving ${cause.remaining.length === 0 ? "no file" : cause.remaining.join(", ")}`;
}

// Exit 1 is "not an ancestor"; 128 is a round commit the clone does not hold, which is not in the head's history
// either.
async function newestInHistory(checkout: string, rounds: readonly Round[], head: string): Promise<Round | null> {
  for (const round of rounds) {
    const { code } = await runGit(checkout, ["merge-base", "--is-ancestor", round.head, head], [1, 128]);
    if (code === 0) return round;
  }
  return null;
}

/** The `ls-tree -r -t -z` listing of `commit`, which `governingDiff` compares. */
export async function treeListing(checkout: string, commit: string): Promise<string> {
  return (await runGit(checkout, ["ls-tree", "-r", "-t", "-z", "--full-tree", commit])).stdout;
}

async function governingLapse(
  checkout: string,
  round: Round,
  base: string,
  baseCommit: string,
  specFolder: string,
): Promise<string | null> {
  const [atBase, atRound] = await Promise.all([treeListing(checkout, baseCommit), treeListing(checkout, round.head)]);
  const changed = governingDiff(atBase, atRound, [specFolder]);
  if (changed.length === 0) return null;
  return `governing documents differ between ${base} and ${roundName(round)}: ${changed.join(", ")}`;
}

// GitHub has no clean-merge API: a merge counts only when its tree is the one git makes of its parents.
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

function commentLapse(rows: readonly Release[], round: Round): string | null {
  const row = releasedByComment(rows, round);
  if (row === null) return null;
  return `${row.id} was released by an admin's comment at ${row.released}, after ${roundName(round)}`;
}

/**
 * Whether a passing round vouches for `head`. `checkout` is a clone the
 * caller has fetched to `head` and to `base`, the default branch's ref.
 */
export async function attests(
  checkout: string,
  reading: Pick<StateReading, "snapshot" | "held" | "causes" | "tamper">,
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
    commentLapse([...reading.snapshot.holds, ...reading.tamper], round);
  return lapse === null ? { attested: true, reason: null } : { attested: false, reason: lapse };
}
