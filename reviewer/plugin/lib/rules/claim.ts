import { createHash } from "node:crypto";
import { z } from "zod";

import { chainEntryKey, type Lineage } from "../../core/contracts/gates.ts";
import { ClaimVerdict } from "../../core/values.ts";
import type { Span } from "../check/lineage.ts";
import { known } from "../known.ts";
import type { LineHunk } from "../worktree.ts";
import { plain } from "./words.ts";

const { CORRECT, WRONG, UNSURE } = ClaimVerdict.schema.enum;

export const CATEGORIES = ["K1", "K2", "K3", "K4", "K5", "K6", "K7", "K8", "K9"] as const;
export const Category = z.enum(CATEGORIES);
export type Category = z.infer<typeof Category>;
// K1, what the repo's own code, contracts, validator or CI does; K9, what a test checks (engineering#57).
export const JUDGED = ["K1", "K9"] as const satisfies readonly Category[];
export const Judged = z.enum(JUDGED);
export const HunkKind = z.enum(["CODE", "PROSE", "MIXED"]);
export type HunkKind = z.infer<typeof HunkKind>;

// A claim with one of these words is about cases no cited file can close, so `cacheable` refuses its CORRECT.
const UNIVERSAL = /\b(?:every|only|all|exactly|always|never)\b/i;
const CLAIM_ID = "[0-9a-f]{16}";
// How agents and the user name a claim; the bare hash stays inside the plugin.
const CLAIM_REF = new RegExp(`^claim-(?<claim>${CLAIM_ID})$`);
const WORD_CHAR = String.raw`\p{L}\p{N}_`;
const CITATION = new RegExp(String.raw`(?<![${WORD_CHAR}/.:-])(?<path>[${WORD_CHAR}./-]+):(?<line>[0-9]+)(?![${WORD_CHAR}])`, "gu");
// A `.`, `,`, `;`, `:`, `!` or `?` at a URL's end is read as its sentence's punctuation, not the URL's.
const URL_TEXT = /https:\/\/[^\s<>"'`)\]]*[^\s<>"'`)\].,;:!?]/g;

/** A path's line count in the checked tree, null when the tree has no file there. */
export type Located = (path: string) => number | null;

export const Verdict = z.strictObject({
  verdict: ClaimVerdict.schema,
  basis: z.string(),
  assertions: z.array(z.strictObject({ text: z.string(), confirmed: z.boolean(), evidence: z.string() })).min(1),
  failing_case: z.string().optional(),
  gap: z.string().optional(),
});
export type Verdict = z.infer<typeof Verdict>;

export type Hunk = LineHunk & {
  id: string;
  file: string;
  removed: string[];
  added: string[];
  /** The key of the hunk's reader memo. */
  patch_id: string;
};

/** A claim a reader quoted: `line` is the line of the checked tree the reader says its words start on. */
export type Claim = { id: string; hunk: string; file: string; line: number; quote: string; category: Category };

/** One check's record of a change: its hunks and their labels by hunk id; the claims, verdicts and contest outcomes by claim id. */
export type ClaimCheck = {
  hunks: Hunk[];
  labels: Record<string, HunkKind>;
  claims: Record<string, Claim>;
  verdicts: Record<string, Verdict>;
  contests: Record<string, ContestOutcome>;
};

export type ContestOutcome = "rejected" | "upheld";

/** A short id of `parts`, the first 16 hex of the sha256 of their UTF-8 joined by NUL. */
export function textId(...parts: string[]): string {
  return createHash("sha256").update(parts.join("\0"), "utf8").digest("hex").slice(0, 16);
}

export function claimId(file: string, quote: string): string {
  return textId(file, plain(quote));
}

export function isClaimId(key: string): boolean {
  return new RegExp(`^${CLAIM_ID}$`).test(key);
}

export function claimRef(id: string): string {
  return `claim-${id}`;
}

export function parseClaimRef(ref: unknown): string | null {
  return typeof ref === "string" ? (CLAIM_REF.exec(ref)?.groups?.claim ?? null) : null;
}

/**
 * The 1-based first and last lines of the text around a hunk: its new lines, or for a removal the line before it (line
 * 1 when it removed the first lines), widened while the line beside either end is not blank. A removal is judged by
 * the text it leaves behind.
 */
function textAround(lines: readonly string[], hunk: LineHunk): [first: number, last: number] {
  let first = Math.max(1, Math.min(hunk.new_start, lines.length));
  let last = Math.max(first, Math.min(hunk.new_start + Math.max(hunk.new_count, 1) - 1, lines.length));
  while (first > 1 && lines[first - 2].trim() !== "") first -= 1;
  while (last < lines.length && lines[last].trim() !== "") last += 1;
  return [first, last];
}

/**
 * The `path:line` citations in `text` outside its https:// URLs. `good` holds those that name a line of the checked
 * tree, as `path:line` with no leading `./`; `bad` those whose file the tree lacks or whose line its file lacks. A
 * match whose path has no `/` or `.` and is no file of the tree, such as `step:3`, is in neither.
 */
export function citations(text: string, located: Located): { good: string[]; bad: string[] } {
  const good: string[] = [];
  const bad: string[] = [];
  for (const found of text.replace(URL_TEXT, " ").matchAll(CITATION)) {
    const { path: cited = "", line = "" } = found.groups ?? {};
    const path = cited.startsWith("./") ? cited.slice(2) : cited;
    const size = located(path);
    if (size !== null && 1 <= Number(line) && Number(line) <= size) good.push(`${path}:${line}`);
    else if (size !== null || path.includes("/") || path.includes(".")) bad.push(found[0]);
  }
  return { good, bad };
}

/** What the reader rules need of a hunk: its file's lines in the checked tree, and the lines a claim in it must sit on. */
export type ReaderSpan = { id: string; file: string; lines: readonly string[]; first: number; last: number };

export function readerSpan(hunk: Hunk, lines: readonly string[]): ReaderSpan {
  const [first, last] = textAround(lines, hunk);
  return { id: hunk.id, file: hunk.file, lines, first, last };
}

/** A reader's answer for one batch of hunks, before it is accepted. */
export type ReaderOutput = { hunks: { id: string; kind: string; claims: { line: number; quote: string; category: string }[] }[] };

const isOneOf = <T extends string>(values: readonly T[], value: string): value is T => (values as readonly string[]).includes(value);

/** Reasons a reader's labels and claims for one batch of hunks, each given as its `readerSpan`, are not accepted. */
export function validateReader(output: ReaderOutput, batch: readonly ReaderSpan[]): string[] {
  const errors: string[] = [];
  const byId = new Map(batch.map((span) => [span.id, span]));
  const seen = output.hunks.map((entry) => entry.id);
  const expected = [...byId.keys()].sort();
  if (seen.length !== new Set(seen).size || seen.toSorted().join("\0") !== expected.join("\0")) {
    errors.push(`label every hunk of your batch exactly once: expected ${JSON.stringify(expected)}, got ${JSON.stringify(seen)}`);
  }
  for (const entry of output.hunks) {
    const span = byId.get(entry.id);
    if (span === undefined) continue;
    if (!isOneOf(HunkKind.options, entry.kind)) errors.push(`${entry.id}: kind must be one of ${JSON.stringify(HunkKind.options)}`);
    if (entry.kind === HunkKind.enum.CODE && entry.claims.length > 0) errors.push(`${entry.id}: a CODE hunk states no claim; label it MIXED if it holds prose`);
    const { lines, first, last } = span;
    for (const claim of entry.claims) {
      const where = `${span.file}:${claim.line}`;
      if (!isOneOf(CATEGORIES, claim.category)) errors.push(`${where}: category must be one of ${JSON.stringify(CATEGORIES)}`);
      const words = plain(claim.quote);
      if (words === "") errors.push(`${where}: the quote is empty`);
      else if (claim.line < first || claim.line > last) errors.push(`${where}: the claim must sit in the text around ${entry.id}, lines ${first}-${last}`);
      else if (!plain(lines.slice(claim.line - 1, last).join("\n")).includes(words) || !plain(lines[claim.line - 1]).includes(words.split(" ")[0])) {
        errors.push(`${where}: the quote is not the checked text starting on that line; copy the words exactly`);
      }
    }
  }
  return errors;
}

const hasUrl = (text: string): boolean => new RegExp(URL_TEXT.source).test(text);

export function validateVerdict(verdict: Verdict, located: Located, { contest }: { contest: boolean }): string[] {
  const errors: string[] = [];
  const { assertions } = verdict;
  if (assertions.length === 0) errors.push("split the claim into its assertions; there must be at least one");
  const supported = (evidence: string): boolean => citations(evidence, located).good.length > 0 || (contest && hasUrl(evidence));
  const citable = contest ? "path:line or https:// page" : "path:line";
  for (const { evidence } of assertions) {
    const { bad } = citations(evidence, located);
    if (bad.length > 0) errors.push(`${bad.join(", ")} is not a line of a file in the checked tree; cite only what the commit records`);
    if (!contest && hasUrl(evidence)) errors.push("a web page is not evidence here; cite the file and line of the checked tree that settles it");
  }
  if (!assertions.every((entry) => (!entry.confirmed && verdict.verdict === UNSURE) || supported(entry.evidence))) {
    errors.push(`every assertion you settled needs the ${citable} that settles it; a conclusion drawn from another assertion is not one, so leave it out`);
  }
  if (verdict.verdict === CORRECT && !assertions.every((entry) => entry.confirmed)) errors.push("CORRECT needs every assertion confirmed");
  if (verdict.verdict === WRONG) {
    if ((verdict.failing_case ?? "").trim() === "") errors.push("WRONG needs failing_case: the input or situation in which the claim is false");
    if (!assertions.some((entry) => !entry.confirmed && supported(entry.evidence))) {
      errors.push(`WRONG needs an assertion that is not confirmed, with the ${citable} that breaks it`);
    }
  }
  if (verdict.verdict === UNSURE && (verdict.gap ?? "").trim() === "") errors.push("UNSURE needs gap: what you could not find or read");
  return errors;
}

export function citedPaths(verdict: Verdict, located: Located): Set<string> {
  return new Set(verdict.assertions.flatMap(({ evidence }) => citations(evidence, located).good.map((cited) => cited.slice(0, cited.lastIndexOf(":")))));
}

/** `check` with a hunk's label and claims recorded; `claims` carry `line` in the checked tree's numbering. */
export function withRead(check: ClaimCheck, hunk: Hunk, kind: HunkKind, claims: readonly { line: number; quote: string; category: Category }[]): ClaimCheck {
  const read = claims.map(({ line, quote, category }): Claim => ({ id: claimId(hunk.file, quote), hunk: hunk.id, file: hunk.file, line, quote, category }));
  return {
    ...check,
    labels: { ...check.labels, [hunk.id]: kind },
    claims: { ...check.claims, ...Object.fromEntries(read.map((claim) => [claim.id, claim])) },
  };
}

const isJudged = (claim: Claim): boolean => isOneOf(JUDGED, claim.category);

export function toJudge(check: ClaimCheck): Claim[] {
  return Object.values(check.claims).filter((claim) => isJudged(claim) && !(claim.id in check.verdicts));
}

export function notJudged(check: ClaimCheck): Partial<Record<Category, number>> {
  const counts: Partial<Record<Category, number>> = {};
  for (const claim of Object.values(check.claims)) if (!isJudged(claim)) counts[claim.category] = (counts[claim.category] ?? 0) + 1;
  return counts;
}

/** Where the check stands. An UNSURE verdict counts as judged: its claim is a note. */
export function checkStatus(check: ClaimCheck): "reading" | "judging" | "complete" {
  if (!check.hunks.every((hunk) => hunk.id in check.labels)) return "reading";
  return toJudge(check).length > 0 ? "judging" : "complete";
}

export function wrongClaims(check: ClaimCheck): Claim[] {
  return Object.entries(check.verdicts).flatMap(([id, verdict]) => (verdict.verdict === WRONG ? [known(check.claims, id)] : []));
}

/** A new lineage for `claim`: named by the claim's id, with the claim's words at `span` of the claim's file. */
export function mintLineage(claim: Claim, [start, end]: Span): Lineage {
  return { id: claim.id, file: claim.file, places: [{ start, end, claim: claim.id }], chain: [] };
}

/**
 * The lineage with a ruling entered once per check `ref` and claim, so a check ruled again adds nothing while the
 * halves of a split claim each enter theirs. A CORRECT ruling takes its claim's words out of the lineage.
 */
export function enterRuling(lineage: Lineage, ref: string, claim: Claim, verdict: Verdict, at: string): Lineage {
  const key = chainEntryKey({ ref, claim: claim.id });
  if (lineage.chain.some((entry) => chainEntryKey(entry) === key)) return lineage;
  const entry = { ref, claim: claim.id, line: claim.line, words: claim.quote, ruling: verdict.verdict, at };
  const places = verdict.verdict === CORRECT ? lineage.places.filter((place) => place.claim !== claim.id) : lineage.places;
  return { ...lineage, places, chain: [...lineage.chain, entry] };
}

/**
 * A fresh judge's ruling on a contested claim of check `ref`: it replaces the claim's verdict and enters the chain
 * under a ref of its own, `<ref>/contest-<n>`. A WRONG ruling rejects the contest and is one more WRONG; any other
 * upholds it, and a CORRECT one takes the claim's words out like any CORRECT ruling.
 */
export function contestOutcome(
  check: ClaimCheck,
  lineage: Lineage,
  ref: string,
  id: string,
  verdict: Verdict,
  at: string,
): { check: ClaimCheck; lineage: Lineage; outcome: ContestOutcome } {
  const prefix = `${ref}/contest-`;
  const nth = 1 + lineage.chain.filter((entry) => entry.claim === id && entry.ref.startsWith(prefix)).length;
  const outcome: ContestOutcome = verdict.verdict === WRONG ? "rejected" : "upheld";
  return {
    check: { ...check, verdicts: { ...check.verdicts, [id]: verdict }, contests: { ...check.contests, [id]: outcome } },
    lineage: enterRuling(lineage, `${prefix}${nth}`, known(check.claims, id), verdict, at),
    outcome,
  };
}

function named(claim: Claim): string {
  return `${claim.file}:${claim.line} "${claim.quote}" (${claimRef(claim.id)})`;
}

/** A contest as the launch's args give it, before it is accepted. */
export type Contest = { claim?: unknown; evidence?: unknown };

/** The id of the claim `contest` names, or why the contest is refused. */
export function acceptContest(contest: Contest, check: ClaimCheck, located: Located): { claim: string } | { refused: string } {
  const id = parseClaimRef(contest.claim);
  if (id === null || !Object.hasOwn(check.claims, id)) {
    const wrong = wrongClaims(check).map(named).join(", ") || "none";
    return { refused: `${JSON.stringify(contest.claim ?? null)} is not a claim id of this check; its WRONG claims: ${wrong}` };
  }
  const verdict = check.verdicts[id];
  if (verdict === undefined) return { refused: `${claimRef(id)} was not judged, so it has no WRONG verdict to contest` };
  if (verdict.verdict !== WRONG) return { refused: `${claimRef(id)} is ${verdict.verdict}, not WRONG` };
  const evidence = typeof contest.evidence === "string" ? contest.evidence : "";
  if (citations(evidence, located).good.length === 0 && !hasUrl(evidence)) {
    return {
      refused:
        `the contest of ${claimRef(id)} gives no evidence the checker can verify: ` +
        "add a path:line of the checked tree or an https:// page that shows the claim holds",
    };
  }
  return { claim: id };
}

/** The hosts of the https:// pages the contests cite, each once and sorted. */
export function citedHosts(contests: readonly Contest[]): string[] {
  const urls = contests.flatMap(({ evidence }) => (typeof evidence === "string" ? [...evidence.matchAll(URL_TEXT)].map(([url]) => url) : []));
  const hosts = urls.map((url) => URL.parse(url)?.hostname ?? "");
  return [...new Set(hosts.filter((host) => host !== ""))].sort();
}

export function fetchAllowed(url: string, hosts: readonly string[]): boolean {
  const parsed = URL.parse(url);
  return parsed !== null && parsed.protocol === "https:" && hosts.includes(parsed.hostname);
}

export function cacheable(claim: Claim, verdict: Verdict): boolean {
  return verdict.verdict === CORRECT && !UNIVERSAL.test(claim.quote);
}

/**
 * Whether a kept CORRECT still stands: the claim keeps the category it was judged under, since each judged category
 * is judged against different evidence, and it cited at least one file, each with the same blob in the checked tree.
 */
export function stillCorrect(
  memo: { category: Category; evidence_blobs: Readonly<Record<string, string>> },
  claim: Claim,
  blobOf: (path: string) => string | null,
): boolean {
  const cited = Object.entries(memo.evidence_blobs);
  return memo.category === claim.category && cited.length > 0 && cited.every(([path, blob]) => blobOf(path) === blob);
}
