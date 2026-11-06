import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { at, gates, lineage as lineageFixture, sha } from "../../core/tests/fixtures/state/issue.ts";
import { Gates, type Bug, type Lineage } from "../plugin/core/contracts/gates.ts";
import { GitFailed } from "../plugin/core/git.ts";
import { ClaimVerdict } from "../plugin/core/values.ts";
import { anchoredSection, bareCopy, fetchFromClone, fileAt, holdsCommit } from "../plugin/lib/check/bare-copy.ts";
import { carry, differ, lineSpan, lines, linesOf, SpanNotFound, succeed, Words, type ReadClaim, type Span } from "../plugin/lib/check/lineage.ts";
import { AnchorMissing } from "../plugin/lib/rules/anchor.ts";
import { lineageCount } from "../plugin/lib/rules/counts.ts";
import { plain } from "../plugin/lib/rules/words.ts";
import { textHunks, type LineHunk } from "../plugin/lib/worktree.ts";
import { cloneWith } from "./support/git.ts";
import { tempSession } from "./support/session.ts";

const { WRONG } = ClaimVerdict.schema.enum;

const SETTINGS = { char_diff_budget: 10 ** 8 };
const FILE = "f.md";

function hunk(old_start: number, old_count: number, new_start: number, new_count: number): LineHunk {
  return { old_start, old_count, new_start, new_count };
}

function carried(before: string, after: string, hunks: LineHunk[], spans: Span[], settings = SETTINGS): (Span | null)[] {
  return carry(spans, before, after, hunks, settings);
}

function textOf(text: string, span: Span | null): string | null {
  return span === null ? null : text.slice(span[0], span[1]);
}

describe("Words.span", () => {
  it("finds a sentence that wraps across lines", () => {
    const text = "Intro\nThe validator rejects an empty list,\nand it logs the reason.\nOther.\n";
    const span = new Words(text).span(2, "The validator rejects an empty list, and it logs the reason.");
    assert.equal(textOf(text, span), "The validator rejects an empty list,\nand it logs the reason.");
  });

  it("skips the comment marks the claim id drops", () => {
    const text = "# The validator rejects\n# an empty list.\n";
    const span = new Words(text).span(1, "The validator rejects an empty list.");
    assert.equal(textOf(text, span), "The validator rejects\n# an empty list.");
  });

  it("begins at the claim's line, not at an earlier copy", () => {
    assert.deepEqual(new Words("Same words.\nother\nSame words.\n").span(3, "Same words."), [18, 29]);
  });

  it("finds a quote that starts in the middle of its line", () => {
    const text = "Intro. The claim is here.\n";
    assert.equal(textOf(text, new Words(text).span(1, "The claim is here.")), "The claim is here.");
  });

  it("finds a quote that a longer run of characters with no space holds, as a declaration holds a test's name", () => {
    const text = "import x\ndef test_an_empty_list_is_rejected():\n    pass\n";
    assert.deepEqual(new Words(text).span(2, "test_an_empty_list_is_rejected"), [13, 43]);
  });

  it("takes whole words over an earlier match inside a word", () => {
    assert.deepEqual(new Words("Unsafe. safe.\n").span(1, "safe."), [8, 13]);
  });

  it("throws SpanNotFound when the words are not there", () => {
    assert.throws(() => new Words("Intro\nSomething else.\n").span(1, "The validator rejects an empty list."), SpanNotFound);
  });

  it("throws SpanNotFound when the words are only before its line", () => {
    assert.throws(() => new Words("The claim.\nOther.\n").span(2, "The claim."), SpanNotFound);
  });
});

describe("lines: a line is what git numbers, the text between two \\n and nothing else", () => {
  it("ends a line at \\n only", () => {
    const inside = "a\u2028b\x0cc\x85d\re\x0bf\x1cg\x1dh\x1ei\u2029j\r";
    assert.deepEqual(lines(`${inside}\nnext\n`), [inside, "next"]);
  });

  it("lets the final \\n end the last line and start none", () => {
    assert.deepEqual([lines("a\nb\n"), lines("a\nb"), lines("a\n\n")], [["a", "b"], ["a", "b"], ["a", ""]]);
  });

  it("gives no text no line", () => {
    assert.deepEqual(lines(""), []);
  });
});

describe("lineSpan and linesOf: a range of lines is a span from its first line's start to its last line's end", () => {
  const text = "aaa\nbbb\nccc\nddd\n";

  it("makes a span of lines, and gives the lines back from it", () => {
    const span = lineSpan(text, 2, 3);
    assert.equal(textOf(text, span), "bbb\nccc\nddd");
    assert.deepEqual(linesOf(text, span), [2, 3]);
  });

  it("ends at the text's end on a last line with no final \\n", () => {
    assert.deepEqual(lineSpan("aaa\nbbb", 2, 1), [4, 7]);
  });

  it("takes a pure insertion as the line it follows", () => {
    assert.equal(textOf(text, lineSpan(text, 2, 0)), "bbb");
  });

  it("holds a range past the text to the text's lines", () => {
    assert.equal(textOf(text, lineSpan(text, 4, 9)), "ddd");
  });
});

describe("carry", () => {
  it("moves a span below an insertion down by its lines", () => {
    const after = "xxx\naaa\nbbb\nccc\nddd\n";
    assert.equal(textOf(after, carried("aaa\nbbb\nccc\nddd\n", after, [hunk(0, 0, 1, 1)], [[8, 11]])[0]), "ccc");
  });

  it("moves a span below a deletion up by its lines", () => {
    const after = "bbb\nccc\nddd\n";
    assert.equal(textOf(after, carried("aaa\nbbb\nccc\nddd\n", after, [hunk(1, 1, 0, 0)], [[8, 11]])[0]), "ccc");
  });

  it("leaves a span above every hunk where it is", () => {
    const got = carried("aaa\nbbb\nccc\n", "aaa\nbbb\nxxx\nccc\nyyy\n", [hunk(2, 0, 3, 1), hunk(3, 0, 5, 1)], [[0, 3], [4, 7]]);
    assert.deepEqual(got, [[0, 3], [4, 7]]);
  });

  it("keeps a span's column when only other lines changed", () => {
    const after = "zzzzzz\nbbb ccc\n";
    assert.equal(textOf(after, carried("aaa\nbbb ccc\n", after, [hunk(1, 1, 1, 1)], [[8, 11]])[0]), "ccc");
  });

  it("adds up several hunks above a span", () => {
    const after = "a\nb\nb1\nc\nd\nf\n";
    const got = carried("a\nb\nc\nd\ne\nf\n", after, [hunk(2, 0, 3, 1), hunk(5, 1, 5, 0)], [[10, 11]]);
    assert.equal(textOf(after, got[0]), "f");
  });

  it("follows the character diff for an offset inside a replaced range", () => {
    const after = "One two THREE four.\n";
    const got = carried("One two three four.\n", after, [hunk(1, 1, 1, 1)], [[14, 18], [4, 13]]);
    assert.deepEqual(got.map((span) => textOf(after, span)), ["four", "two THREE"]);
  });

  it("maps a span that starts outside a hunk and ends inside it", () => {
    const after = "Alpha beta\nGamma DELTA\n";
    assert.equal(textOf(after, carried("Alpha beta\nGamma delta\n", after, [hunk(2, 1, 2, 1)], [[6, 22]])[0]), "beta\nGamma DELTA");
  });

  it("maps an offset inside a pure deletion to where the text was", () => {
    assert.deepEqual(carried("aaa\nbbb\nccc\n", "aaa\nccc\n", [hunk(2, 1, 1, 0)], [[0, 7]]), [[0, 4]]);
  });

  it("gives null for a span whose two ends meet", () => {
    assert.deepEqual(carried("aaa\nbbb\nccc\n", "aaa\nccc\n", [hunk(2, 1, 1, 0)], [[4, 7]]), [null]);
  });

  it("leaves every span as it was when there is no hunk", () => {
    assert.deepEqual(carried("aaa\nbbb\n", "aaa\nbbb\n", [], [[0, 3], [4, 7]]), [[0, 3], [4, 7]]);
  });

  it("widens a span in a range replaced past char_diff_budget to the whole replacement", () => {
    const after = "Intro\nOne two THREE four.\nOutro\n";
    const got = carried("Intro\nOne two three four.\nOutro\n", after, [hunk(2, 1, 2, 1)], [[20, 24], [0, 5]], { char_diff_budget: 10 });
    assert.deepEqual(got.map((span) => textOf(after, span)), ["One two THREE four.", "Intro"]);
  });

  it("widens only the end of a span that ends in a widened range", () => {
    const after = "Alpha beta\nGamma DELTA\n";
    const got = carried("Alpha beta\nGamma delta\n", after, [hunk(2, 1, 2, 1)], [[6, 14]], { char_diff_budget: 10 });
    assert.equal(textOf(after, got[0]), "beta\nGamma DELTA");
  });

  it("diffs the ranges from the top until the budget is spent and widens the rest", () => {
    const after = "aaaa BBBB\ncccc DDDD\n";
    // One range costs 9 × 9 = 81.
    const got = carried("aaaa bbbb\ncccc dddd\n", after, [hunk(1, 1, 1, 1), hunk(2, 1, 2, 1)], [[5, 9], [15, 19]], { char_diff_budget: 100 });
    assert.deepEqual(got.map((span) => textOf(after, span)), ["BBBB", "cccc DDDD"]);
  });

  it("spends nothing on a replaced range no span touches", () => {
    const after = "aaaa BBBB\ncccc DDDD\n";
    // One range costs 9 × 9 = 81, so the budget affords the second only if the first spent nothing.
    const got = carried("aaaa bbbb\ncccc dddd\n", after, [hunk(1, 1, 1, 1), hunk(2, 1, 2, 1)], [[15, 19]], { char_diff_budget: 100 });
    assert.deepEqual(got.map((span) => textOf(after, span)), ["DDDD"]);
  });
});

const idOf = (quote: string): string => plain(quote);

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function claim(text: string, quote: string): ReadClaim {
  const found = new RegExp(quote.split(/\s+/).filter(Boolean).map(escaped).join("\\s+")).exec(text);
  assert.ok(found !== null, `${quote} is not in the text`);
  return { id: idOf(quote), line: text.slice(0, found.index).split("\n").length, quote };
}

function chainEntry(claimId: string, words: string): Lineage["chain"][number] {
  return { ref: "check-1", claim: claimId, line: 1, words, ruling: WRONG, at: at("09:00") };
}

function lineage(id: string, text: string, quote: string): Lineage {
  const [start, end] = new Words(text).span(claim(text, quote).line, quote);
  return { id, file: FILE, places: [{ start, end, claim: idOf(quote) }], chain: [] };
}

async function succeeded(lineages: Lineage[], before: string, after: string, claims: ReadClaim[], counts: Record<string, number> = {}, settings = SETTINGS) {
  const hunks = await textHunks(before, after);
  return succeed({ lineages, before, after, hunks, claims, count: (found) => counts[found.id] ?? 1 }, settings);
}

function byId(lineages: readonly Lineage[]): Map<string, Lineage> {
  return new Map(lineages.map((found) => [found.id, found]));
}

function wordsAt(text: string, found: Lineage | undefined): string[] {
  assert.ok(found !== undefined, "the lineage is not open");
  return found.places.map(({ start, end }) => text.slice(start, end));
}

describe("succeed: which lineage each claim of a new text belongs to, the hunks from git", () => {
  it("gives both halves of a sentence split in place the lineage", async () => {
    const before = "Intro.\nThe tool is fast and it is safe.\nOutro.\n";
    const after = "Intro.\nThe tool is fast.\nIt is safe.\nOutro.\n";
    const halves = [claim(after, "The tool is fast."), claim(after, "It is safe.")];
    const { lineages, ended, inherited } = await succeeded([lineage("L1", before, "The tool is fast and it is safe.")], before, after, halves);
    assert.deepEqual(inherited, new Map([[halves[0].id, "L1"], [halves[1].id, "L1"]]));
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["The tool is fast.", "It is safe."]);
    assert.deepEqual(ended, []);
  });

  it("goes on with the lineage of the higher count when two sentences merge, the other ended into it", async () => {
    const before = "Intro.\nThe tool is fast.\nIt is safe.\nOutro.\n";
    const after = "Intro.\nThe tool is fast and it is safe.\nOutro.\n";
    const merged = claim(after, "The tool is fast and it is safe.");
    const given = [lineage("L1", before, "The tool is fast."), lineage("L2", before, "It is safe.")];
    const { lineages, ended, inherited } = await succeeded(given, before, after, [merged], { L1: 1, L2: 2 });
    assert.deepEqual(inherited, new Map([[merged.id, "L2"]]));
    assert.deepEqual(
      lineages.map(({ id }) => id),
      ["L2"],
    );
    assert.deepEqual(ended, [{ id: "L1", into: "L2" }]);
  });

  it("hands a merged-away lineage's words no claim was read in to the lineage that goes on", async () => {
    const before = "The tool is fast.\nIt is safe.\nSomewhere else, the far half.\n";
    const after = "The tool is fast and it is safe.\nSomewhere else, the far half.\n";
    const merged = claim(after, "The tool is fast and it is safe.");
    const split = lineage("L2", before, "It is safe.");
    split.places.push(...lineage("L2", before, "Somewhere else, the far half.").places);
    const { lineages, ended } = await succeeded([lineage("L1", before, "The tool is fast."), split], before, after, [merged], { L1: 2, L2: 1 });
    assert.deepEqual(ended, [{ id: "L2", into: "L1" }]);
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["The tool is fast and it is safe.", "Somewhere else, the far half."]);
  });

  for (const [first, second] of [
    ["L9", "L3"],
    ["L3", "L9"],
  ]) {
    it(`goes on with the smaller id on equal counts, ${first} given and placed first`, async () => {
      const before = "The tool is fast.\nIt is safe.\n";
      const after = "The tool is fast and it is safe.\n";
      const merged = claim(after, "The tool is fast and it is safe.");
      const given = [lineage(first, before, "The tool is fast."), lineage(second, before, "It is safe.")];
      const { ended, inherited } = await succeeded(given, before, after, [merged], { L3: 2, L9: 2 });
      assert.deepEqual(inherited, new Map([[merged.id, "L3"]]));
      assert.deepEqual(ended, [{ id: "L9", into: "L3" }]);
    });
  }

  it("ends a lineage whose words were deleted with nothing in their place", async () => {
    const before = "Intro.\nThe tool is fast.\nOutro.\n";
    const { lineages, ended, inherited } = await succeeded([lineage("L1", before, "The tool is fast.")], before, "Intro.\nOutro.\n", []);
    assert.deepEqual(inherited, new Map());
    assert.deepEqual(lineages, []);
    assert.deepEqual(ended, [{ id: "L1", into: null }]);
  });

  it("keeps the lineage of words moved unchanged by their id", async () => {
    const before = "Intro.\nThe tool is fast.\nMiddle.\nOutro.\n";
    const after = "Intro.\nMiddle.\nOutro.\nThe tool is fast.\n";
    const moved = claim(after, "The tool is fast.");
    const { lineages, ended, inherited } = await succeeded([lineage("L1", before, "The tool is fast.")], before, after, [moved]);
    assert.deepEqual(inherited, new Map([[moved.id, "L1"]]));
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["The tool is fast."]);
    assert.deepEqual(ended, []);
  });

  it("keeps the lineage of words moved unchanged with no claim read", async () => {
    const before = "Intro.\nThe tool is fast.\nMiddle.\nOutro.\n";
    const after = "Intro.\nMiddle.\nOutro.\nThe tool is fast.\n";
    const { lineages, ended, inherited } = await succeeded([lineage("L1", before, "The tool is fast.")], before, after, []);
    assert.deepEqual(inherited, new Map());
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["The tool is fast."]);
    assert.deepEqual(ended, []);
  });

  it("keeps a lineage whose first words are found elsewhere, with no claim read", async () => {
    const first = "The tool is fast.";
    const second = "The tool is quick.";
    const before = `Intro.\n${second}\nMiddle.\n`;
    const after = `Intro.\nMiddle.\n${first}\n`;
    const held = { ...lineage(idOf(first), before, second), chain: [chainEntry(idOf(first), first)] };
    const { lineages, ended } = await succeeded([held], before, after, []);
    assert.deepEqual(wordsAt(after, byId(lineages).get(held.id)), [first]);
    assert.deepEqual(ended, []);
  });

  it("answers only for the claims read", async () => {
    const before = "Intro.\nThe tool is fast.\nMiddle.\n";
    const after = "Intro.\nMiddle.\nThe tool is fast.\n";
    const { inherited } = await succeeded([lineage("L1", before, "The tool is fast.")], before, after, [claim(after, "Middle.")]);
    assert.deepEqual(inherited, new Map());
  });

  it("keeps the lineage of a claim in a range replaced past char_diff_budget", async () => {
    const before = "Intro.\nOne two three four.\n";
    const after = "Intro.\nOne two THREE four.\n";
    const reread = claim(after, "THREE");
    const { lineages, ended, inherited } = await succeeded([lineage("L1", before, "three")], before, after, [reread], {}, { char_diff_budget: 10 });
    assert.deepEqual(
      lineages.map(({ id }) => id),
      ["L1"],
    );
    assert.deepEqual(inherited, new Map([[reread.id, "L1"]]));
    assert.deepEqual(ended, []);
  });

  it("carries words in a range replaced past char_diff_budget over the whole replacement", async () => {
    const before = "Intro.\nOne two three four.\n";
    const after = "Intro.\nOne two THREE four.\n";
    const { lineages } = await succeeded([lineage("L1", before, "three")], before, after, [], {}, { char_diff_budget: 10 });
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["One two THREE four."]);
  });

  it("follows a long file's many claims in a time a scan of the file per claim could not meet", async () => {
    // The scan per claim this replaced took 19.8 s on this text.
    const guide = Array.from({ length: 1000 }, (_, i) => `Line ${i} of the guide says the validator rejects an empty list.`);
    const text = `${guide.join("\n")}\n`;
    const words = new Words(text);
    const claims = Array.from({ length: 10 }, (_, i) => ({ id: `c${i}`, line: i * 100 + 1, quote: guide[i * 100] }));
    const given = claims.map(({ id, line, quote }, i): Lineage => {
      const [start, end] = words.span(line, quote);
      return { id: `L${i}`, file: FILE, places: [{ start, end, claim: id }], chain: [] };
    });
    const started = performance.now();
    const { lineages, ended, inherited } = await succeeded(given, text, text, claims);
    assert.ok(performance.now() - started < 3000);
    assert.deepEqual(inherited, new Map(claims.map(({ id }, i) => [id, `L${i}`])));
    assert.equal(lineages.length, 10);
    assert.deepEqual(ended, []);
  });

  it("continues two lineages under one hunk, each by its own place", async () => {
    const before = "Alpha is fast.\nBeta is slow.\n";
    const after = "Alpha is very fast.\nBeta is quite slow.\n";
    const first = claim(after, "Alpha is very fast.");
    const second = claim(after, "Beta is quite slow.");
    const given = [lineage("L1", before, "Alpha is fast."), lineage("L2", before, "Beta is slow.")];
    const { lineages, inherited } = await succeeded(given, before, after, [first, second]);
    assert.deepEqual(inherited, new Map([[first.id, "L1"], [second.id, "L2"]]));
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["Alpha is very fast."]);
    assert.deepEqual(wordsAt(after, byId(lineages).get("L2")), ["Beta is quite slow."]);
  });

  it("takes words moved and reworded in one step as a new claim", async () => {
    const before = "Intro.\nThe tool is fast.\nMiddle.\nOutro.\n";
    const after = "Intro.\nMiddle.\nOutro.\nThe tool is quick.\n";
    const { ended, inherited } = await succeeded([lineage("L1", before, "The tool is fast.")], before, after, [claim(after, "The tool is quick.")]);
    assert.deepEqual(inherited, new Map());
    assert.deepEqual(ended, [{ id: "L1", into: null }]);
  });

  it("keeps the lineage across a reflow that leaves the words unchanged", async () => {
    const quote = "The tool is fast and it is safe to use.";
    const before = "Intro.\nThe tool is fast and it is\nsafe to use.\nOutro.\n";
    const after = "Intro.\nThe tool is fast\nand it is safe to use.\nOutro.\n";
    const same = claim(after, quote);
    const { lineages, ended, inherited } = await succeeded([lineage("L1", before, quote)], before, after, [same]);
    assert.deepEqual(inherited, new Map([[same.id, "L1"]]));
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["The tool is fast\nand it is safe to use."]);
    assert.deepEqual(ended, []);
  });

  it("keeps only the first half of a split whose second half lands elsewhere", async () => {
    const before = "Intro.\nThe tool is fast and it is safe.\nOutro.\n";
    const after = "Intro.\nThe tool is fast.\nOutro.\nIt is safe.\n";
    const first = claim(after, "The tool is fast.");
    const { lineages, inherited } = await succeeded([lineage("L1", before, "The tool is fast and it is safe.")], before, after, [first, claim(after, "It is safe.")]);
    assert.deepEqual(inherited, new Map([[first.id, "L1"]]));
    assert.deepEqual(wordsAt(after, byId(lineages).get("L1")), ["The tool is fast."]);
  });

  it("keeps open a lineage whose place is carried to text no claim was read in", async () => {
    const before = "Intro.\nThe tool is fast.\n";
    const { lineages, ended, inherited } = await succeeded([lineage("L1", before, "The tool is fast.")], before, "The tool is quick.\n", []);
    assert.deepEqual(inherited, new Map());
    assert.equal(byId(lineages).get("L1")?.places.length, 1);
    assert.deepEqual(ended, []);
  });

  it("gives a claim the lineage its id names when no place of the lineage is left", async () => {
    const first = "The tool is fast.";
    const before = "Intro.\nThe tool is quick.\nMiddle.\n";
    const after = `Intro.\nMiddle.\n${first}\n`;
    const cameBack = claim(after, first);
    const held = lineage(idOf(first), before, "The tool is quick.");
    const { inherited } = await succeeded([held], before, after, [cameBack]);
    assert.deepEqual(inherited, new Map([[cameBack.id, held.id]]));
  });

  it("ends merges made one after another in the last survivor", async () => {
    const text = "aaa bbb ccc ddd\n";
    const holding = (id: string, start: number, end: number): Lineage => ({ id, file: FILE, places: [{ start, end, claim: id }], chain: [] });
    const given = [holding("L1", 0, 3), holding("L2", 4, 11), holding("L3", 12, 15)];
    const claims = [
      { id: "X", line: 1, quote: "aaa bbb" },
      { id: "Y", line: 1, quote: "ccc ddd" },
    ];
    const { lineages, ended, inherited } = await succeeded(given, text, text, claims, { L1: 1, L2: 2, L3: 3 });
    assert.deepEqual(inherited, new Map([["X", "L3"], ["Y", "L3"]]));
    assert.deepEqual(ended, [{ id: "L1", into: "L3" }, { id: "L2", into: "L3" }]);
    assert.deepEqual(
      lineages.map(({ id }) => id),
      ["L3"],
    );
  });

  it("changes none of the lineages it is given, those it moves and merges included", async () => {
    const before = "Intro.\nThe tool is fast.\nIt is safe.\nOutro.\n";
    const after = "New.\nIntro.\nThe tool is fast and it is safe.\nOutro.\n";
    const given = [
      { ...lineage("L1", before, "The tool is fast."), chain: [chainEntry("c1", "The tool is fast.")] },
      lineage("L2", before, "It is safe."),
      lineage("L3", before, "Outro."),
    ];
    const copy = structuredClone(given);
    const { lineages, ended } = await succeeded(given, before, after, [claim(after, "The tool is fast and it is safe.")], { L1: 1, L2: 2 });
    assert.deepEqual(ended, [{ id: "L1", into: "L2" }]);
    assert.deepEqual(wordsAt(after, byId(lineages).get("L3")), ["Outro."]);
    assert.notDeepEqual(byId(lineages).get("L3")?.places, copy[2].places);
    assert.deepEqual(given, copy);
  });

  it("throws SpanNotFound for a claim whose words are not at its line: a defect of the check, not an input", async () => {
    const before = "Intro.\nThe tool is fast.\n";
    await assert.rejects(succeeded([lineage("L1", before, "The tool is fast.")], before, before, [{ id: "c1", line: 1, quote: "Not here." }]), SpanNotFound);
  });
});

describe("differ", () => {
  it("has its clock off", () => {
    assert.equal(differ().Diff_Timeout, 0);
  });
});

const BRANCH = "212-us1-ledger";
const HEAD = sha(77);

/** A source of the anchor as `anchoredSection` asks it, each sha it was asked for recorded. */
function recorded<T>(answer: (anchor: string) => Promise<T>): { ask: (anchor: string) => Promise<T>; asks: string[] } {
  const asks: string[] = [];
  return { asks, ask: (anchor) => (asks.push(anchor), answer(anchor)) };
}

/** GitHub lacking every commit. */
const noGitHub = async (): Promise<boolean> => false;

function bug(fields: Partial<Bug> = {}): Bug {
  return { id: "B1", members: [{ tree: sha(5), at: at("10:00") }], absorbed: [], ranges: [{ file: FILE, old_start: 1, old_count: 1 }], deep: null, rulings: [], ...fields };
}

describe("anchoredSection (contracts/gates-snapshot.md §Anchor)", () => {
  it("reads the anchor from the bare copy, asking neither the clone nor GitHub", async (t) => {
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    const copy = await bareCopy(tempSession(t));
    await fetchFromClone(copy, clone, head);
    const section = gates({ branch: BRANCH, anchor: head, lineages: [lineageFixture("L1")] });
    const fromClone = recorded((anchor) => fetchFromClone(copy, clone, anchor));
    const fromGitHub = recorded(noGitHub);
    assert.deepEqual(await anchoredSection({ copy, clone: fromClone.ask, github: fromGitHub.ask }, section, HEAD, null), section);
    assert.deepEqual([fromClone.asks, fromGitHub.asks], [[], []]);
  });

  it("fetches the anchor by its sha from the model's clone when the copy lacks it", async (t) => {
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    const copy = await bareCopy(tempSession(t));
    const section = gates({ branch: BRANCH, anchor: head, lineages: [lineageFixture("L1")] });
    const fromClone = recorded((anchor) => fetchFromClone(copy, clone, anchor));
    const fromGitHub = recorded(noGitHub);
    assert.deepEqual(await anchoredSection({ copy, clone: fromClone.ask, github: fromGitHub.ask }, section, HEAD, null), section);
    assert.equal(await holdsCommit(copy, head), true);
    assert.deepEqual([fromClone.asks, fromGitHub.asks], [[head], []]);
  });

  it("asks GitHub for the anchor when the clone lacks it", async (t) => {
    const pushed = cloneWith(t, { "a.md": "pushed\n" });
    const { clone } = cloneWith(t, { "a.md": "a\n" });
    const copy = await bareCopy(tempSession(t));
    const section = gates({ branch: BRANCH, anchor: pushed.head, lineages: [lineageFixture("L1")] });
    const fromClone = recorded((anchor) => fetchFromClone(copy, clone, anchor));
    const fromGitHub = recorded(async (anchor) => (await fetchFromClone(copy, pushed.clone, anchor), true));
    assert.deepEqual(await anchoredSection({ copy, clone: fromClone.ask, github: fromGitHub.ask }, section, HEAD, null), section);
    assert.deepEqual([fromClone.asks, fromGitHub.asks], [[pushed.head], [pushed.head]]);
    assert.equal(await holdsCommit(copy, pushed.head), true);
  });

  it("stops naming the branch, the anchor and `/codeworks reset` when none has it, with the clone's failure as its cause", async (t) => {
    const { clone } = cloneWith(t, { "a.md": "a\n" });
    const copy = await bareCopy(tempSession(t));
    const section = gates({ branch: BRANCH, anchor: sha(4096), lineages: [lineageFixture("L1")] });
    const fromGitHub = recorded(noGitHub);
    const sources = { copy, clone: (anchor: string) => fetchFromClone(copy, clone, anchor), github: fromGitHub.ask };
    await assert.rejects(anchoredSection(sources, section, HEAD, null), (error: unknown) => {
      assert.ok(error instanceof AnchorMissing, String(error));
      assert.ok(error.message.includes(BRANCH), error.message);
      assert.ok(error.message.includes(sha(4096)), error.message);
      assert.ok(error.message.includes("/codeworks reset"), error.message);
      assert.ok(error.cause instanceof GitFailed, String(error.cause));
      return true;
    });
    assert.deepEqual(fromGitHub.asks, [sha(4096)]);
  });

  it("starts the section over, anchored on the head, when none has it and the newest reset is later than every `at` in it", async (t) => {
    const { clone } = cloneWith(t, { "a.md": "a\n" });
    const copy = await bareCopy(tempSession(t));
    const section = gates({ branch: BRANCH, anchor: sha(4096), lineages: [lineageFixture("L1")], bugs: [bug({ absorbed: [{ tree: sha(6), at: at("11:00") }] })] });
    const sources = { copy, clone: (anchor: string) => fetchFromClone(copy, clone, anchor), github: noGitHub };
    assert.deepEqual(await anchoredSection(sources, section, HEAD, at("11:30")), { branch: BRANCH, anchor: HEAD, lineages: [], bugs: [] });
  });

  for (const [what, section] of [
    ["a chain entry", gates({ branch: BRANCH, anchor: sha(4096), lineages: [lineageFixture("L1", { chain: [chainEntry("c1", "words")] })] })],
    ["a bug's member", gates({ branch: BRANCH, anchor: sha(4096), bugs: [bug({ members: [{ tree: sha(5), at: at("09:00") }] })] })],
    ["a bug's absorbed tree", gates({ branch: BRANCH, anchor: sha(4096), bugs: [bug({ members: [], absorbed: [{ tree: sha(6), at: at("09:00") }] })] })],
  ] as const) {
    it(`stops when none has the anchor and ${what} is as late as the newest reset`, async (t) => {
      const { clone } = cloneWith(t, { "a.md": "a\n" });
      const copy = await bareCopy(tempSession(t));
      const sources = { copy, clone: (anchor: string) => fetchFromClone(copy, clone, anchor), github: noGitHub };
      await assert.rejects(anchoredSection(sources, section, HEAD, at("09:00")), AnchorMissing);
    });
  }
});

describe("a lineage read back from the gates section", () => {
  it("is inherited by a reworded claim in another session, its anchor fetched from the model's clone", async (t) => {
    const file = "docs/guide.md";
    const quote = "The validator rejects an empty list.";
    const before = `# Guide\n\n${quote}\n`;
    const { clone, head: anchor } = cloneWith(t, { [file]: before });
    const [start, end] = new Words(before).span(3, quote);
    const written: Lineage = { id: idOf(quote), file, places: [{ start, end, claim: idOf(quote) }], chain: [chainEntry(idOf(quote), quote)] };
    const section = Gates.parse(JSON.parse(JSON.stringify(gates({ branch: BRANCH, anchor, lineages: [written] }))));
    // A session other than the one that wrote the section: its bare copy starts empty.
    const copy = await bareCopy(tempSession(t));
    const anchored = await anchoredSection({ copy, clone: (sha) => fetchFromClone(copy, clone, sha), github: noGitHub }, section, HEAD, null);
    const read = await fileAt(copy, anchored.anchor, file);
    assert.ok(read !== null);
    const after = "# Guide\n\nThe validator refuses an empty list.\n";
    const reworded = claim(after, "The validator refuses an empty list.");
    const { lineages, inherited } = succeed(
      { lineages: anchored.lineages, before: read, after, hunks: await textHunks(read, after), claims: [reworded], count: (found) => lineageCount(found, null) },
      SETTINGS,
    );
    assert.deepEqual(inherited, new Map([[reworded.id, idOf(quote)]]));
    assert.deepEqual(wordsAt(after, byId(lineages).get(idOf(quote))), ["The validator refuses an empty list."]);
  });
});
