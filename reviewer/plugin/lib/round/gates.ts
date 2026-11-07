import type { Gates, Lineage } from "../../core/contracts/gates.ts";
import type { Hold } from "../../core/contracts/snapshot.ts";
import type { GitHubClient } from "../../core/github.ts";
import { gatesRecorded, recordGates, type Opening, type StateReading } from "../../core/state.ts";
import { ClaimVerdict } from "../../core/values.ts";
import { anchoredSection, fileAt, type AnchorSources } from "../check/bare-copy.ts";
import { succeed, Words, type Budget, type Successors } from "../check/lineage.ts";
import { orCouldNotRun } from "../hook-io.ts";
import { known } from "../known.ts";
import { checkRef, enterRuling, mintLineage, type Claim, type ClaimCheck, type Verdict } from "../rules/claim.ts";
import { claimHoldId, claimOpening, lineageCount, openItems, shimHoldId, shimOpening, type WrongRuling } from "../rules/counts.ts";
import { carriedBugs, settleBugs, type ShimCheck } from "../rules/shim.ts";
import type { RunState } from "../run-state.ts";
import type { ReviewerSettings } from "../settings.ts";
import { textHunks, type LineHunk } from "../worktree.ts";

const { WRONG } = ClaimVerdict.schema.enum;

/**
 * A check of commit `head`, whose tree is `tree`, on `branch`, completed under workflow run `run`: a claim check's
 * claims and verdicts, or the result of a shim check of the range from `base`, whose text its hunks are numbered in.
 */
export type CompletedCheck = { run: string; branch: string; head: string; tree: string } & (
  | { claim: Pick<ClaimCheck, "claims" | "verdicts"> }
  | { shim: ShimCheck; base: string }
);

/** What a hook run records a check with; `writer` gives the reviewer App's client, minted when first asked for. */
export type GatesRecorder = {
  state: RunState;
  writer: () => Promise<GitHubClient>;
  settings: Pick<ReviewerSettings, "claim_hold_at" | "shim_hold_at" | "char_diff_budget">;
  sources: AnchorSources;
};

export class GatesBranchMismatch extends Error {
  readonly gates: string;
  readonly check: string;

  constructor(gates: string, check: string) {
    super(`the story's gates are of branch ${gates}, not ${check}, so a check on ${check} is neither graded nor recorded; check ${gates}`);
    this.name = "GatesBranchMismatch";
    this.gates = gates;
    this.check = check;
  }
}

const resetOf = (reading: StateReading): string | null => reading.reset?.at ?? null;

/** The section a check of `head` on `branch` goes on from: an empty one anchored on `head` while the story has no gates, else `anchoredSection` of its gates, which must be of `branch`. */
export async function checkSection(sources: AnchorSources, reading: StateReading, branch: string, head: string): Promise<Gates> {
  const gates = reading.snapshot?.gates ?? null;
  if (gates === null) return { branch, anchor: head, lineages: [], bugs: [] };
  if (gates.branch !== branch) throw new GatesBranchMismatch(gates.branch, branch);
  return orCouldNotRun(anchoredSection(sources, gates, head, resetOf(reading)), `the gates anchor of branch ${branch}`);
}

/**
 * Of the files asked for, each one the second commit has, with its text at the first commit (`olds`, empty where the
 * first lacks it), at the second (`news`) and the hunks between; and in `gone`, each one only the first commit has.
 */
type Hop = { olds: Record<string, string>; news: Record<string, string>; hunks: Record<string, LineHunk[]>; gone: Set<string> };

async function hop(copy: string, from: string, to: string, files: Iterable<string>): Promise<Hop> {
  const found: Hop = { olds: {}, news: {}, hunks: {}, gone: new Set() };
  for (const file of new Set(files)) {
    const [before, after] = [await fileAt(copy, from, file), await fileAt(copy, to, file)];
    if (after === null) {
      if (before !== null) found.gone.add(file);
      continue;
    }
    found.olds[file] = before ?? "";
    found.news[file] = after;
    found.hunks[file] = await textHunks(found.olds[file], after);
  }
  return found;
}

/** The lineages carried over `hop`, with `claims` read in its new text, and the lineage each claim that belongs to one belongs to. */
function carriedLineages(
  lineages: readonly Lineage[],
  claims: readonly Claim[],
  { olds, news, hunks, gone }: Hop,
  reset: string | null,
  held: Successors["held"],
  settings: Budget,
) {
  const carried: Lineage[] = [];
  const inherited = new Map<string, string>();
  for (const file of new Set(lineages.map((lineage) => lineage.file))) {
    if (gone.has(file)) continue;
    const succession = succeed(
      {
        lineages: lineages.filter((lineage) => lineage.file === file),
        before: known(olds, file),
        after: known(news, file),
        hunks: known(hunks, file),
        claims: claims.filter((each) => each.file === file),
        count: (lineage) => lineageCount(lineage, reset),
        held,
      },
      settings,
    );
    carried.push(...succession.lineages);
    for (const [claimId, lineage] of succession.inherited) inherited.set(claimId, lineage);
  }
  return { lineages: carried, inherited };
}

function wrongRuling({ quote, line }: Claim, { failing_case, assertions }: Verdict): WrongRuling {
  const broken = assertions.find((assertion) => !assertion.confirmed);
  // validateVerdict accepts a WRONG only with both.
  if (failing_case === undefined || broken === undefined) throw new TypeError("a WRONG verdict lacks its failing case or the assertion it breaks");
  return { words: quote, line, failing_case, evidence: broken.evidence };
}

/**
 * `lineages` with each verdict of `claims` entered under `ref` in the lineage its claim inherits, a WRONG claim that
 * inherits none opening its own; with the WRONG each lineage was given, the last in `claims`' order when a split lineage
 * was given several.
 */
function ruled(
  lineages: readonly Lineage[],
  inherited: ReadonlyMap<string, string>,
  claims: readonly Claim[],
  verdicts: Readonly<Record<string, Verdict>>,
  news: Hop["news"],
  ref: string,
  at: string,
): { lineages: Lineage[]; wrongs: Map<string, WrongRuling> } {
  const byId = new Map(lineages.map((lineage) => [lineage.id, lineage]));
  const texts = new Map<string, Words>();
  const wrongs = new Map<string, WrongRuling>();
  for (const read of claims) {
    const verdict: Verdict | undefined = verdicts[read.id];
    if (verdict === undefined) continue;
    const owner = inherited.get(read.id);
    let lineage = owner === undefined ? null : known(byId, owner);
    if (lineage === null && verdict.verdict === WRONG) {
      const words = texts.get(read.file) ?? new Words(known(news, read.file));
      texts.set(read.file, words);
      lineage = mintLineage(read, words.span(read.line, read.quote));
    }
    if (lineage === null) continue;
    byId.set(lineage.id, enterRuling(lineage, ref, read, verdict, at));
    if (verdict.verdict === WRONG) wrongs.set(lineage.id, wrongRuling(read, verdict));
  }
  return { lineages: [...byId.values()], wrongs };
}

const byPlace = (a: Claim, b: Claim): number => (a.file === b.file ? a.line - b.line || (a.id < b.id ? -1 : 1) : a.file < b.file ? -1 : 1);

const rowOf = (reading: StateReading, id: string): Hold | undefined => reading.snapshot?.holds.find((row) => row.id === id);

/** What a check records: the section carried to its head, and the holds its counts place. */
type Recording = { gates: Gates; openings: Opening[] };

/** Null for a run already recorded; otherwise the recording, given the check's time. */
async function decide({ state, settings, sources }: GatesRecorder, check: CompletedCheck, reading: StateReading): Promise<((at: string) => Recording) | null> {
  const { repo, issue, shared } = state.source;
  if (gatesRecorded(issue, shared, reading, check.run)) return null;
  const section = await checkSection(sources, reading, check.branch, check.head);
  const reset = resetOf(reading);
  const held = (id: string): Hold["state"] | null => rowOf(reading, claimHoldId(id))?.state ?? null;
  const lineageFiles = section.lineages.map(({ file }) => file);
  const bugFiles = section.bugs.flatMap(({ ranges }) => ranges.map(({ file }) => file));
  const anchored = (fields: Pick<Gates, "lineages" | "bugs">, gone: ReadonlySet<string>): Gates => openItems({ ...section, anchor: check.head, ...fields }, gone);

  if ("claim" in check) {
    const claims = Object.values(check.claim.claims).toSorted(byPlace);
    const toHead = await hop(sources.copy, section.anchor, check.head, [...lineageFiles, ...bugFiles, ...claims.map(({ file }) => file)]);
    return (at) => {
      const carried = carriedLineages(section.lineages, claims, toHead, reset, held, settings);
      const { lineages, wrongs } = ruled(carried.lineages, carried.inherited, claims, check.claim.verdicts, toHead.news, checkRef(repo, check.tree), at);
      const gates = anchored({ lineages, bugs: carriedBugs(section.bugs, toHead.olds, toHead.news, toHead.gone, toHead.hunks, settings) }, toHead.gone);
      const openings = gates.lineages.flatMap((lineage) => {
        const last = wrongs.get(lineage.id);
        return (last && claimOpening(lineage, rowOf(reading, claimHoldId(lineage.id)), reset, last, settings)) || [];
      });
      return { gates, openings };
    };
  }

  const swept = [...check.shim.hunks, ...check.shim.same_operation].map(({ file }) => file);
  const toHead = await hop(sources.copy, section.anchor, check.head, lineageFiles);
  const toBase = await hop(sources.copy, section.anchor, check.base, bugFiles);
  const baseToHead = await hop(sources.copy, check.base, check.head, [...bugFiles, ...swept]);
  return (at) => {
    const atBase = carriedBugs(section.bugs, toBase.olds, toBase.news, toBase.gone, toBase.hunks, settings);
    const settled = settleBugs(atBase, check.shim, { repo, branch: check.branch, tree: check.tree, at, reset });
    const bugs = carriedBugs(settled, baseToHead.olds, baseToHead.news, baseToHead.gone, baseToHead.hunks, settings);
    const gates = anchored({ lineages: carriedLineages(section.lineages, [], toHead, reset, held, settings).lineages, bugs }, new Set([...toHead.gone, ...baseToHead.gone]));
    const openings = gates.bugs.flatMap((bug) => shimOpening(bug, rowOf(reading, shimHoldId(bug.id)), reset, settings) ?? []);
    return { gates, openings };
  };
}

/**
 * Records `check` in one `recordGates` commit: the story's gates carried to the check's head, its new anchor, with
 * its rulings or its bugs, and the `claim-`/`shim-` holds their counts reach (contracts/gates-snapshot.md).
 */
export async function recordCheck(recorder: GatesRecorder, check: CompletedCheck): Promise<void> {
  const { reader, repo, issue, shared } = recorder.state.source;
  await recorder.state.step(
    (reading) => decide(recorder, check, reading),
    async (reading, recording) => {
      if (recording === null) return reading;
      const w = await recorder.writer();
      // Core stamps its own clock over every new time; the writer is minted only once there is a write.
      const { gates, openings } = recording(await w.now());
      return recordGates(reader, w, repo, issue, shared, reading, check.run, gates, openings);
    },
  );
}
