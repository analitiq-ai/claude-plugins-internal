import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { at, gates, hold, lineage, releasedHold, sha } from "../../core/tests/fixtures/state/issue.ts";
import type { Bug, Lineage } from "../plugin/core/contracts/gates.ts";
import { ClaimVerdict, HoldKind, ShimRuling } from "../plugin/core/values.ts";
import { bugCount, claimOpening, deepDue, lineageCount, mergeBugs, openItems, shimOpening } from "../plugin/lib/rules/counts.ts";

const { WRONG, CORRECT } = ClaimVerdict.schema.enum;
const { SHARES, NOT_SHARED, DEFERRED } = ShimRuling.schema.enum;
const { claim, shim } = HoldKind.schema.enum;

// None is the repository's own value, so a constant in code shows.
const SETTINGS = { claim_hold_at: 2, shim_deep_at: 2, shim_hold_at: 5 };
const LAST_WRONG = { words: "refuses a null header", line: 4, failing_case: "a header of two nulls", evidence: "src/parse.ts:41" };

type Entry = Lineage["chain"][number];

function entry(ref: string, clock: string, fields: Partial<Entry> = {}): Entry {
  return { ref, claim: "c1", line: 4, words: "refuses a null header", ruling: WRONG, at: at(clock), ...fields };
}

function tree(n: number, clock: string): Bug["members"][number] {
  return { tree: sha(n), at: at(clock) };
}

function bug(id: string, fields: Partial<Bug> = {}): Bug {
  return { id, members: [], absorbed: [], ranges: [{ file: "src/parse.ts", old_start: 10, old_count: 3 }], deep: null, rulings: [], ...fields };
}

const members = (count: number, first = 1): Bug["members"] => Array.from({ length: count }, (_, i) => tree(first + i, `09:0${i}`));

describe("lineageCount (ADR-0013 d3, contracts/gates-snapshot.md §Derived)", () => {
  it("counts each check that ruled WRONG once, however many claims it ruled", () => {
    const counted = lineage("L1", { chain: [entry("check-1", "09:00"), entry("check-1", "09:00", { claim: "c2" }), entry("check-2", "09:10")] });
    assert.equal(lineageCount(counted, null), 2);
  });

  it("leaves out a CORRECT ruling", () => {
    assert.equal(lineageCount(lineage("L1", { chain: [entry("check-1", "09:00"), entry("check-2", "09:10", { ruling: CORRECT })] }), null), 1);
  });

  it("counts only WRONG rulings after the reset", () => {
    const counted = lineage("L1", {
      chain: [entry("check-1", "09:00"), entry("check-2", "10:00"), entry("check-3", "10:30", { ruling: CORRECT }), entry("check-4", "11:00")],
    });
    assert.equal(lineageCount(counted, at("09:30")), 2);
  });
});

describe("claimOpening", () => {
  const twice = lineage("L1", { chain: [entry("check-1", "09:00"), entry("check-2", "10:00")] });

  it(`places claim-<id> at claim_hold_at, asking with the last WRONG's failing case and evidence`, () => {
    const opening = claimOpening(twice, undefined, null, LAST_WRONG, SETTINGS);
    assert.equal(opening?.id, `${claim}-L1`);
    assert.match(opening?.question ?? "", /a header of two nulls/);
    assert.match(opening?.question ?? "", /src\/parse\.ts:41/);
    assert.match(opening?.question ?? "", /refuses a null header/);
  });

  it("quotes the words and line of the ruling whose failing case and evidence it gives", () => {
    const split = lineage("L1", {
      chain: [entry("check-1", "09:00"), entry("check-2", "10:00", { words: "first words", line: 3 }), entry("check-2", "10:00", { claim: "c2", words: "second words", line: 9 })],
    });
    const question = claimOpening(split, undefined, null, { ...LAST_WRONG, words: "second words", line: 9 }, SETTINGS)?.question ?? "";
    assert.ok(question.includes('"second words"') && question.includes(":9)"), question);
    assert.ok(!question.includes("first words"), question);
  });

  it("places nothing below claim_hold_at, or while the hold is OPEN", () => {
    assert.equal(claimOpening(lineage("L1", { chain: [entry("check-1", "09:00")] }), undefined, null, LAST_WRONG, SETTINGS), null);
    assert.equal(claimOpening(twice, hold(`${claim}-L1`), null, LAST_WRONG, SETTINGS), null);
  });

  it("opens a RELEASED hold again on a WRONG later than its release, not on a later CORRECT", () => {
    const released = releasedHold(`${claim}-L1`, 9, { released: at("10:30") });
    assert.equal(claimOpening(twice, released, null, LAST_WRONG, SETTINGS), null);
    const corrected = lineage("L1", { chain: [...twice.chain, entry("check-3", "10:45", { ruling: CORRECT })] });
    assert.equal(claimOpening(corrected, released, null, LAST_WRONG, SETTINGS), null);
    const again = lineage("L1", { chain: [...twice.chain, entry("check-3", "10:45")] });
    assert.equal(claimOpening(again, released, null, LAST_WRONG, SETTINGS)?.id, `${claim}-L1`);
  });

  it("counts afresh after a reset: only the WRONG rulings after it reach claim_hold_at", () => {
    const corrected = lineage("L1", { chain: [...twice.chain, entry("check-3", "10:10", { ruling: CORRECT })] });
    assert.equal(claimOpening(corrected, undefined, at("09:30"), LAST_WRONG, SETTINGS), null);
    const after = lineage("L1", { chain: [...twice.chain, entry("check-3", "10:10")] });
    assert.equal(claimOpening(after, undefined, at("09:30"), LAST_WRONG, SETTINGS)?.id, `${claim}-L1`);
  });
});

describe("bugCount and deepDue (ADR-0008, ADR-0013 d4)", () => {
  it("counts the members after the reset, never the absorbed", () => {
    const counted = bug("B1", { members: [tree(1, "09:00"), tree(2, "10:00"), tree(3, "11:00")], absorbed: [tree(4, "11:30")] });
    assert.equal(bugCount(counted, null), 3);
    assert.equal(bugCount(counted, at("09:30")), 2);
  });

  it(`makes the deep sweep due at shim_deep_at, once`, () => {
    assert.equal(deepDue(bug("B1", { members: members(1) }), null, SETTINGS), false);
    assert.equal(deepDue(bug("B1", { members: members(2) }), null, SETTINGS), true);
    assert.equal(deepDue(bug("B1", { members: members(2), deep: { same_operation: [], callers: [] } }), null, SETTINGS), false);
  });
});

describe("shimOpening", () => {
  it(`places shim-<id> at shim_hold_at, with no question`, () => {
    assert.deepEqual(shimOpening(bug("B1", { members: members(5) }), undefined, null, SETTINGS), { id: `${shim}-B1`, question: null });
    assert.equal(shimOpening(bug("B1", { members: members(4) }), undefined, null, SETTINGS), null);
  });

  it("places nothing while the hold is OPEN", () => {
    assert.equal(shimOpening(bug("B1", { members: members(5) }), hold(`${shim}-B1`), null, SETTINGS), null);
  });

  it("opens a RELEASED hold again on a member added after its release", () => {
    const released = releasedHold(`${shim}-B1`, 9, { released: at("10:30") });
    assert.equal(shimOpening(bug("B1", { members: members(5) }), released, null, SETTINGS), null);
    const touched = bug("B1", { members: [...members(5), tree(9, "10:45")] });
    assert.deepEqual(shimOpening(touched, released, null, SETTINGS), { id: `${shim}-B1`, question: null });
  });
});

describe("mergeBugs (ADR-0008 d2)", () => {
  it("gives the merged bug the higher count, not the sum, so bugs of 2 and 3 members place no hold", () => {
    const merged = mergeBugs([bug("B1", { members: members(2) }), bug("B2", { members: members(3, 10) })], null);
    assert.equal(bugCount(merged, null), 3);
    assert.equal(shimOpening(merged, undefined, null, SETTINGS), null);
  });

  it("keeps the higher count's bug, its members and deep lists, and absorbs the other's trees", () => {
    const deep = { same_operation: [{ file: "src/a.ts", line: 3, function: "a", does: "parses" }], callers: [] };
    const low = bug("B1", { members: members(2), absorbed: [tree(30, "08:00")], deep: { same_operation: [], callers: [] } });
    const high = bug("B2", { members: members(3, 10), deep });
    const merged = mergeBugs([low, high], null);
    assert.equal(merged.id, "B2");
    assert.deepEqual(merged.members, high.members);
    assert.deepEqual(merged.deep, deep);
    assert.deepEqual(merged.absorbed.map(({ tree }) => tree).toSorted(), [sha(1), sha(2), sha(30)].toSorted());
  });

  it("keeps the smaller id on a tie, whichever comes first", () => {
    const b9 = bug("B9", { members: members(2) });
    const b3 = bug("B3", { members: members(2, 10) });
    assert.equal(mergeBugs([b9, b3], null).id, "B3");
    assert.equal(mergeBugs([b3, b9], null).id, "B3");
  });

  it("compares the counts after the reset", () => {
    const older = bug("B1", { members: [tree(1, "09:00"), tree(2, "09:01"), tree(3, "09:02")] });
    const newer = bug("B2", { members: [tree(4, "10:00"), tree(5, "10:01")] });
    assert.equal(mergeBugs([older, newer], at("09:30")).id, "B2");
  });

  it("takes the union of the ranges, a shared one once, and the other's rulings only for sites it has not ruled", () => {
    const keep = bug("B2", {
      members: members(3, 10),
      rulings: [{ site: "s1", ruling: SHARES, issue: null }],
    });
    const other = bug("B1", {
      members: members(2),
      ranges: [...keep.ranges, { file: "src/emit.ts", old_start: 4, old_count: 2 }],
      rulings: [
        { site: "s1", ruling: NOT_SHARED, issue: null },
        { site: "s2", ruling: DEFERRED, issue: 31 },
      ],
    });
    const merged = mergeBugs([keep, other], null);
    assert.deepEqual(merged.rulings, [
      { site: "s1", ruling: SHARES, issue: null },
      { site: "s2", ruling: DEFERRED, issue: 31 },
    ]);
    assert.deepEqual(merged.ranges, other.ranges);
  });
});

describe("openItems: only open items stay in the section", () => {
  it("drops a lineage with no place left and a bug with no range left", () => {
    const section = gates({ lineages: [lineage("L1"), lineage("L2", { places: [] })], bugs: [bug("B1"), bug("B2", { ranges: [] })] });
    const open = openItems(section, new Set());
    assert.deepEqual(
      open.lineages.map(({ id }) => id),
      ["L1"],
    );
    assert.deepEqual(
      open.bugs.map(({ id }) => id),
      ["B1"],
    );
  });

  it("drops a moved file's lineages and ranges (ADR-0001 d2)", () => {
    const section = gates({
      lineages: [lineage("L1", { file: "src/old.ts" }), lineage("L2")],
      bugs: [
        bug("B1", { ranges: [{ file: "src/old.ts", old_start: 1, old_count: 2 }] }),
        bug("B2", { ranges: [{ file: "src/old.ts", old_start: 1, old_count: 2 }, { file: "src/parse.ts", old_start: 5, old_count: 1 }] }),
      ],
    });
    const open = openItems(section, new Set(["src/old.ts"]));
    assert.deepEqual(
      open.lineages.map(({ id }) => id),
      ["L2"],
    );
    assert.deepEqual(open.bugs, [{ ...section.bugs[1], ranges: [{ file: "src/parse.ts", old_start: 5, old_count: 1 }] }]);
  });
});
