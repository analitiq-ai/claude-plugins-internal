import diff_match_patch from "diff-match-patch";

import type { Lineage } from "../../core/contracts/gates.ts";
import type { Hold } from "../../core/contracts/snapshot.ts";
import { HoldState } from "../../core/values.ts";
import { known } from "../known.ts";
import { plain, words } from "../rules/words.ts";
import type { ReviewerSettings } from "../settings.ts";
import type { LineHunk } from "../worktree.ts";

/** Where a piece of text is: its first character's offset and the offset one past its last, as `slice` takes them. */
export type Span = readonly [start: number, end: number];

/** A claim the check read in a file's new text: its id, the 1-based line its words start on, and its words. */
export type ReadClaim = { id: string; line: number; quote: string };

export type Budget = Pick<ReviewerSettings, "char_diff_budget">;

const { OPEN } = HoldState.schema.enum;

/**
 * A claim's quote has no words, or they are not in its file from the line it was read on: a defect of the check, not
 * an input to tolerate.
 */
export class SpanNotFound extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SpanNotFound";
  }
}

/** The character differ, its clock off so that two texts always give one answer. */
export function differ(): diff_match_patch {
  const found = new diff_match_patch();
  found.Diff_Timeout = 0;
  return found;
}

/** The lines of a text as git numbers them: split at \n only, the final \n ending the last line and starting none. */
export function lines(text: string): string[] {
  const found = text.split("\n");
  return found.at(-1) === "" ? found.slice(0, -1) : found;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let at = text.indexOf("\n"); at !== -1; at = text.indexOf("\n", at + 1)) starts.push(at + 1);
  return starts;
}

/** How many of the sorted `values` are below `value`. */
function countBelow(values: readonly number[], value: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = (low + high) >> 1;
    if (values[middle] < value) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** How many of the sorted `values` are at or below `value`. */
function countUpTo(values: readonly number[], value: number): number {
  return countBelow(values, value + 1);
}

/**
 * A text's words as one string, one space between each two, with where each of its characters came from: built once,
 * so any number of searches cost the search alone. The words are those `plain` joins.
 */
export class Words {
  readonly #lineStarts: number[];
  readonly #flat: string;
  readonly #origin: number[] = [];
  readonly #wordStarts: number[] = [];
  readonly #flatAt: number[] = [];

  constructor(text: string) {
    this.#lineStarts = lineStarts(text);
    const parts: string[] = [];
    let flatLength = 0;
    for (const { word, start } of words(text)) {
      if (parts.length > 0) {
        parts.push(" ");
        this.#origin.push(this.#origin[this.#origin.length - 1]);
        flatLength += 1;
      }
      this.#wordStarts.push(start);
      this.#flatAt.push(flatLength);
      parts.push(word);
      for (let i = 0; i < word.length; i += 1) this.#origin.push(start + i);
      flatLength += word.length;
    }
    this.#flat = parts.join("");
  }

  /**
   * Where `quote`'s words stand from the start of 1-based `line` on: as whole words where they stand so, else at their
   * first match, whose ends may fall inside words (a test's name inside its declaration). Throws SpanNotFound when they
   * are nowhere from there.
   */
  span(line: number, quote: string): Span {
    const wanted = plain(quote);
    if (line < 1 || line > this.#lineStarts.length || wanted === "") throw new SpanNotFound(`${JSON.stringify(quote)} is not at line ${line}`);
    const first = countBelow(this.#wordStarts, this.#lineStarts[line - 1]);
    const found = this.#search(wanted, first < this.#flatAt.length ? this.#flatAt[first] : this.#flat.length);
    if (found === null) throw new SpanNotFound(`${JSON.stringify(quote)} is not in the text from line ${line}`);
    return found;
  }

  /** Where `quote` stands anywhere in the text, found as `span` finds it; null when its words are nowhere. */
  find(quote: string): Span | null {
    const wanted = plain(quote);
    return wanted === "" ? null : this.#search(wanted, 0);
  }

  #isWholeWords(at: number, length: number): boolean {
    const end = at + length;
    return (at === 0 || this.#flat[at - 1] === " ") && (end === this.#flat.length || this.#flat[end] === " ");
  }

  #search(wanted: string, floor: number): Span | null {
    let at = this.#flat.indexOf(wanted, floor);
    while (at !== -1 && !this.#isWholeWords(at, wanted.length)) at = this.#flat.indexOf(wanted, at + 1);
    if (at === -1) at = this.#flat.indexOf(wanted, floor);
    if (at === -1) return null;
    return [this.#origin[at], this.#origin[at + wanted.length - 1] + 1];
  }
}

/**
 * From the start of 1-based line `first` to the end of the last of its `count` lines. A pure insertion (no line) is
 * the line it follows, line 1 when it follows none, and lines past the text are held to the text's own.
 */
export function lineSpan(text: string, first: number, count: number): Span {
  const starts = lineStarts(text);
  const total = Math.max(starts.length - (text.endsWith("\n") ? 1 : 0), 1);
  const from = Math.min(Math.max(first, 1), total);
  const last = Math.min(from + Math.max(count, 1) - 1, total);
  return [starts[from - 1], last < starts.length ? starts[last] - 1 : text.length];
}

/** The first line and the line count of a span: the lines its first and its last character are on. */
export function linesOf(text: string, [start, end]: Span): [first: number, count: number] {
  const starts = lineStarts(text);
  const first = countUpTo(starts, start);
  return [first, countUpTo(starts, Math.max(end - 1, start)) - first + 1];
}

/**
 * The two texts, their line tables and the hunks between them, each replaced range's diff made once, and the ranges
 * the budget could not afford noted in `#widened`.
 */
class Ground {
  readonly #before: string;
  readonly #after: string;
  readonly #hunks: LineHunk[];
  readonly #beforeStarts: number[];
  readonly #afterStarts: number[];
  readonly #budget: number;
  readonly #widened = new Set<LineHunk>();
  readonly #differ = differ();
  readonly #diffs = new Map<LineHunk, diff_match_patch.Diff[]>();

  constructor(before: string, after: string, hunks: readonly LineHunk[], { char_diff_budget }: Budget) {
    this.#before = before;
    this.#after = after;
    this.#hunks = hunks.toSorted((a, b) => a.old_start - b.old_start);
    this.#beforeStarts = lineStarts(before);
    this.#afterStarts = lineStarts(after);
    this.#budget = char_diff_budget;
  }

  #extent(text: string, starts: readonly number[], first: number, count: number): Span {
    const last = first + count - 1;
    return [starts[first - 1], last < starts.length ? starts[last] - 1 : text.length];
  }

  #replaced(hunk: LineHunk): [removed: string, added: string] {
    const [removedStart, removedEnd] = this.#extent(this.#before, this.#beforeStarts, hunk.old_start, hunk.old_count);
    const [addedStart, addedEnd] = this.#extent(this.#after, this.#afterStarts, hunk.new_start, hunk.new_count);
    return [this.#before.slice(removedStart, removedEnd), this.#after.slice(addedStart, addedEnd)];
  }

  /** The 1-based line of the old text `position` is on. */
  #lineOf(position: number): number {
    return countUpTo(this.#beforeStarts, position);
  }

  #covering(line: number): LineHunk | null {
    return this.#hunks.find((hunk) => hunk.old_count > 0 && hunk.old_start <= line && line < hunk.old_start + hunk.old_count) ?? null;
  }

  carry(spans: readonly Span[]): (Span | null)[] {
    this.#afford(spans.flat());
    return spans.map(([start, end]): Span | null => {
      const mapped: Span = [this.#position(start, false), this.#position(end, true)];
      return mapped[1] > mapped[0] ? mapped : null;
    });
  }

  /**
   * Spends the budget on the replaced ranges the positions are in, from the top of the file down; a range that would
   * take it past the budget is widened instead. A diff's time grows with the product of the two sizes, so the bound
   * is on size, not on the clock: that keeps the answer a function of the two texts.
   */
  #afford(positions: readonly number[]): void {
    const covering = positions.map((position) => this.#covering(this.#lineOf(position)));
    const used = new Set(covering.filter((hunk): hunk is LineHunk => hunk !== null && hunk.new_count > 0));
    let spent = 0;
    for (const hunk of [...used].toSorted((a, b) => a.old_start - b.old_start)) {
      const [removed, added] = this.#replaced(hunk);
      const cost = removed.length * added.length;
      if (spent + cost > this.#budget) this.#widened.add(hunk);
      else spent += cost;
    }
  }

  #position(position: number, isEnd: boolean): number {
    const line = this.#lineOf(position);
    const hunk = this.#covering(line);
    if (hunk === null) {
      const above = this.#hunks.filter((h) => (h.old_count > 0 ? h.old_start + h.old_count - 1 : h.old_start) < line);
      const shift = above.reduce((sum, h) => sum + h.new_count - h.old_count, 0);
      return this.#afterStarts[line + shift - 1] + position - this.#beforeStarts[line - 1];
    }
    if (hunk.new_count === 0) return hunk.new_start < this.#afterStarts.length ? this.#afterStarts[hunk.new_start] : this.#after.length;
    if (this.#widened.has(hunk)) return this.#extent(this.#after, this.#afterStarts, hunk.new_start, hunk.new_count)[isEnd ? 1 : 0];
    const removed = this.#replaced(hunk)[0];
    const offset = Math.min(position - this.#beforeStarts[hunk.old_start - 1], removed.length);
    return this.#afterStarts[hunk.new_start - 1] + this.#differ.diff_xIndex(this.#diffOf(hunk), offset);
  }

  #diffOf(hunk: LineHunk): diff_match_patch.Diff[] {
    const kept = this.#diffs.get(hunk);
    if (kept !== undefined) return kept;
    const diffs = this.#differ.diff_main(...this.#replaced(hunk));
    this.#differ.diff_cleanupSemantic(diffs);
    this.#diffs.set(hunk, diffs);
    return diffs;
  }
}

/**
 * Each span of `before` in `after`, or null where it is gone. The two ends of a span are mapped apart. Outside every
 * hunk an offset moves by the lines the hunks above it added or removed. Inside a replaced range it follows a character
 * diff of that range, while the diffs together stay within `char_diff_budget`: a span in a range that would take them
 * past it maps to the whole replacement, so it is kept unless that replacement has no characters. Inside a pure
 * deletion it lands where the text was, and a span whose two ends meet is gone.
 */
export function carry(spans: readonly Span[], before: string, after: string, hunks: readonly LineHunk[], settings: Budget): (Span | null)[] {
  return new Ground(before, after, hunks, settings).carry(spans);
}

export type Successors = {
  /** A file's open lineages, with their places in `before`. */
  lineages: readonly Lineage[];
  before: string;
  after: string;
  hunks: readonly LineHunk[];
  /** The claims read in `after`. */
  claims: readonly ReadClaim[];
  /** The lineage's count, which decides whose chain a merge goes on with. */
  count: (lineage: Lineage) => number;
  /** The state of the hold placed on the lineage of an id, null for none, which decides the id a merge goes on under. */
  held: (id: string) => Hold["state"] | null;
};

export type Succession = {
  /** The lineages still open, in the order given, each with its places in `after`. */
  lineages: Lineage[];
  /** The lineages that ended, in the order given: `into` the lineage a merge went on as, null for words deleted. */
  ended: { id: string; into: string | null }[];
  /** The lineage each claim that belongs to one belongs to, by the claim's id. */
  inherited: Map<string, string>;
};

/**
 * Words a lineage held, as `succeed` looks for them in `after`: each of its places, carried or found again, and its
 * first words where they are found when none of its places was. `claim` is the claim they were the words of, `span`
 * where they are now, if anywhere.
 */
type Carried = { claim: string; span: Span | null };

function overlaps(a: Span, b: Span): boolean {
  return Math.max(a[0], b[0]) < Math.min(a[1], b[1]);
}

/**
 * The lineages still open, with their places in `after`; those that ended; and the lineage each claim read in `after`
 * belongs to, for each claim that belongs to one. The words of a place carried to nothing, and a lineage's first words
 * when none of its places was carried or found, are looked for in `after`, so a lineage whose words are still in the
 * file is not ended for want of a claim read there. A claim inherits each lineage one of whose places it overlaps, else
 * each whose id is the claim's id or that held words of that id. Claims that inherit one lineage split it: each holds
 * it. A claim that inherits several lineages merges them: one lineage goes on, with the chain of the one with the
 * higher count (the smaller id on a tie) and the places of all of them, under the id of the first of them, that one
 * first, whose hold is OPEN, else the first with a hold, so a hold stays on the lines its lineage merged into; the
 * others end into it. A place in text no claim was read in stays. A lineage with no place left ends. A place in a
 * range replaced past the budget is carried as `carry` carries it. Changes nothing it is given.
 */
export function succeed({ lineages, before, after, hunks, claims, count, held }: Successors, settings: Budget): Succession {
  const index = new Words(after);
  const spans = new Map(claims.map((claim) => [claim.id, index.span(claim.line, claim.quote)]));
  const mapped = new Ground(before, after, hunks, settings).carry(lineages.flatMap(({ places }) => places.map(({ start, end }): Span => [start, end])));
  let next = 0;
  const carried = new Map<string, Carried[]>();
  for (const lineage of lineages) {
    const entries = lineage.places.map(({ start, end, claim }) => ({ claim, span: mapped[next++] ?? index.find(before.slice(start, end)) }));
    if (!entries.some(({ span }) => span !== null)) {
      const first = lineage.chain.find(({ claim }) => claim === lineage.id)?.words;
      const span = first === undefined ? null : index.find(first);
      if (span !== null) entries.push({ claim: lineage.id, span });
    }
    carried.set(lineage.id, entries);
  }
  const counts = new Map(lineages.map((lineage) => [lineage.id, count(lineage)]));
  // A merged lineage's id, and the lineage it went into.
  const survivor = new Map<string, string>();
  const live = (id: string): string => {
    let at = id;
    for (let into = survivor.get(at); into !== undefined; into = survivor.get(at)) at = into;
    return at;
  };
  const won = new Map<string, string>();
  const byPlace = claims.toSorted((a, b) => {
    const [x, y] = [known(spans, a.id), known(spans, b.id)];
    return x[0] - y[0] || x[1] - y[1];
  });
  for (const claim of byPlace) {
    const span = known(spans, claim.id);
    const overlapping = [...carried].filter(([, entries]) => entries.some((entry) => entry.span !== null && overlaps(entry.span, span)));
    const named = [...carried].filter(([id, entries]) => id === claim.id || entries.some((entry) => entry.claim === claim.id));
    const owners = [...new Set((overlapping.length > 0 ? overlapping : named).map(([id]) => live(id)))].sort();
    if (owners.length === 0) continue;
    const winner = owners.reduce((best, id) => (known(counts, id) > known(counts, best) ? id : best));
    for (const id of owners) if (id !== winner) survivor.set(id, winner);
    won.set(claim.id, winner);
  }
  const named = new Map(
    lineages.flatMap(({ id }) => {
      if (survivor.has(id)) return [];
      const merged = [id, ...lineages.flatMap((member) => (member.id !== id && live(member.id) === id ? [member.id] : []))];
      return [[id, merged.find((each) => held(each) === OPEN) ?? merged.find((each) => held(each) !== null) ?? id]];
    }),
  );
  const goesOnAs = (id: string): string => known(named, live(id));
  const inherited = new Map([...won].map(([claim, id]) => [claim, goesOnAs(id)]));
  const open: Lineage[] = [];
  const ended: Succession["ended"] = [];
  for (const lineage of lineages) {
    const as = goesOnAs(lineage.id);
    if (survivor.has(lineage.id)) {
      if (lineage.id !== as) ended.push({ id: lineage.id, into: as });
      continue;
    }
    const read = [...inherited].filter(([, id]) => id === as).map(([claim]) => ({ start: known(spans, claim)[0], end: known(spans, claim)[1], claim }));
    const unread = lineages
      .filter((member) => live(member.id) === lineage.id)
      .flatMap((member) => known(carried, member.id))
      .flatMap(({ claim, span }) => (span !== null && ![...spans.values()].some((each) => overlaps(span, each)) ? [{ start: span[0], end: span[1], claim }] : []));
    const places = [...read, ...unread].toSorted((a, b) => a.start - b.start);
    if (places.length === 0) ended.push({ id: lineage.id, into: null });
    else {
      if (lineage.id !== as) ended.push({ id: lineage.id, into: as });
      open.push({ ...lineage, id: as, places });
    }
  }
  return { lineages: open, ended, inherited };
}
