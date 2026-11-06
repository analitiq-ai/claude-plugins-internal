import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import type { Bug } from "../plugin/core/contracts/gates.ts";
import {
  altered,
  carriedBugs,
  contestErrors,
  isTestFile,
  linesText,
  overlaps,
  type RangeHunk,
  type ShimCheck,
  type Site,
  siteId,
  siteRange,
  settleBugs,
  shimVerdict,
  swept,
  validateRuling,
  validateSweep,
} from "../plugin/lib/rules/shim.ts";
import { textHunks } from "../plugin/lib/worktree.ts";

const HEAD_FILES: Record<string, number> = { "src/load.py": 40, "src/save.py": 12 };
const located = (path: string): number | null => HEAD_FILES[path] ?? null;
const BUDGET = { char_diff_budget: 50_000_000 };
const TREE = "e".repeat(40);
const AT = "2026-11-01T10:00:00Z";

function site(fields: Partial<Site> = {}): Site {
  return { file: "src/load.py", line: 12, function: "load", does: "reads the file unchecked", ...fields };
}

function range(file = "src/load.py", oldStart = 12, oldCount = 1): RangeHunk {
  return { file, old_start: oldStart, old_count: oldCount };
}

const sha = (n: number): string => n.toString(16).padStart(40, "0");

function bug(id = "c".repeat(16), members = 1, fields: Partial<Bug> = {}): Bug {
  return {
    id,
    members: Array.from({ length: members }, (_, n) => ({ tree: sha(n + 1), at: `2026-10-0${n + 1}T10:00:00Z` })),
    absorbed: [],
    ranges: [range()],
    deep: null,
    rulings: [],
    ...fields,
  };
}

function check(fields: Partial<ShimCheck> = {}): ShimCheck {
  return { hunks: [range()], same_operation: [site()], callers: [], mode: "sweep", verdict: "patch", ...fields };
}

const settled = (bugs: Bug[], given: ShimCheck = check()) => settleBugs(bugs, given, { repo: "acme/demo", branch: "main", tree: TREE, at: AT, reset: null });
const byId = (bugs: Bug[]) => Object.fromEntries(bugs.map((each) => [each.id, each]));

describe("site and bug ids", () => {
  it("name a site by its file and function", () => {
    assert.equal(siteId("src/load.py", "load"), createHash("sha256").update("src/load.py\0load").digest("hex").slice(0, 16));
    assert.notEqual(siteId("src/load.py", "load"), siteId("src/load.py", "save"));
  });

  it("name a new bug by its repository, branch and the tree that opened it", () => {
    const [opened] = settled([]);
    assert.equal(opened.id, createHash("sha256").update(`acme/demo\0main\0${TREE}`).digest("hex").slice(0, 16));
  });
});

describe("validateSweep", () => {
  const sweep = (same: Site[] = [], callers: Site[] = []) => ({ same_operation: same, callers });

  it("accepts sites of files and lines the head has, one site in both lists included", () => {
    assert.deepEqual(validateSweep(sweep([site()], [site({ file: "src/save.py", line: 3, function: "main" })]), located), []);
    assert.deepEqual(validateSweep(sweep([site()], [site()]), located), []);
  });

  it("returns every reason", () => {
    const errors = validateSweep(
      sweep(
        [site({ file: "src/gone.py" }), site({ line: 41, function: "parse" }), site({ function: " " }), site({ function: "dump", does: "" })],
        [site({ file: "src/save.py", line: 3, function: "main" }), site({ file: "src/save.py", line: 5, function: "main" })],
      ),
      located,
    );
    assert.equal(errors.length, 5, errors.join("\n"));
    for (const part of ["src/gone.py", "src/load.py:41", "function", "does", "src/save.py main"]) assert.ok(errors.some((error) => error.includes(part)), part);
  });

  it("rejects a line before the first", () => {
    assert.equal(validateSweep(sweep([site({ line: 0 })]), located).length, 1);
  });
});

describe("shimVerdict", () => {
  const COVERAGES = ["all", "none_other", "edited_only", "some"];

  it("is complete only for a cause fix that reaches every site, or for no fix", () => {
    assert.equal(shimVerdict("not_fix", null, null, { sitesLeft: true }), "complete");
    for (const level of ["cause", "symptom"]) {
      for (const coverage of COVERAGES) {
        const expected = level === "cause" && (coverage === "all" || coverage === "none_other") ? "complete" : "patch";
        assert.equal(shimVerdict("fix", level, coverage, { sitesLeft: true }), expected, `${level} ${coverage}`);
      }
    }
  });

  it("with no site left, is complete for a cause fix whatever the coverage, and a patch for a symptom fix", () => {
    for (const coverage of COVERAGES) {
      assert.equal(shimVerdict("fix", "cause", coverage, { sitesLeft: false }), "complete", coverage);
      assert.equal(shimVerdict("fix", "symptom", coverage, { sitesLeft: false }), "patch", coverage);
    }
    assert.equal(shimVerdict("not_fix", null, null, { sitesLeft: false }), "complete");
  });
});

describe("overlaps and siteRange", () => {
  it("overlaps old-side ranges of one file that share or touch a line", () => {
    assert.equal(overlaps([range("src/load.py", 10, 3)], [range("src/load.py", 12, 1)]), true);
    assert.equal(overlaps([range("src/load.py", 10, 1)], [range("src/load.py", 11, 1)]), true);
    assert.equal(overlaps([range("src/load.py", 10, 3)], [range("src/save.py", 12, 1)]), false);
    assert.equal(overlaps([range("src/load.py", 10, 1)], [range("src/load.py", 30, 2)]), false);
    assert.equal(overlaps([], [range()]), false);
  });

  it("takes a site as its line", () => {
    assert.deepEqual(siteRange(site({ line: 7 })), range("src/load.py", 7, 1));
  });
});

describe("altered and linesText", () => {
  it("gives each site the lines the change alters in its file, or null when its file is not in it", () => {
    const sites = [site({ line: 329 }), site({ file: "src/save.py", line: 3, function: "main" }), site({ file: "src/other.py", line: 1, function: "run" })];
    const marks = altered(sites, [range("src/load.py", 333, 1), range("src/load.py", 340, 13), range("src/save.py", 9, 2)]);
    assert.deepEqual(marks, {
      [siteId("src/load.py", "load")]: [[333, 333], [340, 352]],
      [siteId("src/save.py", "main")]: [[9, 10]],
      [siteId("src/other.py", "run")]: null,
    });
  });

  it("takes a pure insertion as the line it follows", () => {
    assert.deepEqual(altered([site()], [range("src/load.py", 7, 0)]), { [siteId("src/load.py", "load")]: [[7, 7]] });
  });

  it("writes the lines for the report", () => {
    assert.equal(linesText([[333, 333], [340, 352]]), "alters lines 333, 340-352 of this file");
    assert.equal(linesText(null), "this file is not in the change");
  });
});

describe("isTestFile and swept", () => {
  it("knows each runner's test file names, and any file under a tests, test or __tests__ folder", () => {
    for (const path of ["test_load.py", "src/test_load.py", "src/load_test.py", "cmd/load_test.go", "web/App.test.tsx", "web/app.spec.js", "lib/util.test.mjs", "lib/util.spec.cjs", "web/a.test.ts", "web/a.spec.jsx", "modules/vpc/main.tftest.hcl", "tests/fixtures/repo.json", "pkg/test/helpers.go", "web/__tests__/App.jsx", "web/__tests__/data.json"]) {
      assert.equal(isTestFile(path), true, path);
    }
  });

  it("does not take a near miss for a test file", () => {
    for (const path of ["specs/006/spec.md", "src/contest.py", "latest.py", "src/testing.py", "attest/main.py", "src/test_load.go", "web/a.test.md", "load_test.pyc"]) {
      assert.equal(isTestFile(path), false, path);
    }
  });

  it("sweeps nothing of a change whose code is all in test files, else its code hunks, tests included", () => {
    const testOnly = [{ id: "h1", ...range("tests/test_load.py") }, { id: "h2", ...range("src/test_save.py") }, { id: "h3", ...range("README.md") }];
    assert.deepEqual(swept(testOnly, { h1: "CODE", h2: "MIXED", h3: "PROSE" }), []);
    const mixed = [{ id: "h1", ...range("tests/test_load.py") }, { id: "h2", ...range() }, { id: "h3", ...range("README.md") }];
    assert.deepEqual(swept(mixed, { h1: "CODE", h2: "CODE", h3: "PROSE" }), mixed.slice(0, 2));
  });
});

describe("contestErrors", () => {
  const listed = siteId("src/load.py", "load");

  it("accepts a contest of a listed, unruled site with a reason", () => {
    assert.deepEqual(contestErrors([{ site: listed, reason: "it checks the file first" }], check(), bug()), []);
  });

  it("refuses contests that are not a non-empty list of objects", () => {
    for (const contests of [[], "x", [7], null]) assert.deepEqual(contestErrors(contests, check(), bug()), ["args.contests is a non-empty list of {site, reason}"]);
  });

  it("refuses a contest with no patch verdict to answer", () => {
    for (const [given, reached] of [[check({ verdict: "complete" }), bug()], [check(), null]] as const) {
      assert.deepEqual(contestErrors([{ site: listed, reason: "r" }], given, reached), ["a contest answers the patch verdict of the change; there is none to contest"]);
    }
  });

  it("refuses an unlisted site, one already ruled, one contested twice, and an empty reason", () => {
    const ruled = bug("c".repeat(16), 1, { rulings: [{ site: listed, ruling: "NOT_SHARED", issue: null }] });
    assert.deepEqual(contestErrors([{ site: "nope", reason: "r" }], check(), bug()), [`site "nope" is not in this check's SAME OPERATION list`]);
    assert.deepEqual(contestErrors([{ site: listed, reason: "r" }], check(), ruled), [`site ${listed} was already ruled for this bug; a site is ruled once`]);
    assert.deepEqual(contestErrors([{ site: listed, reason: "r" }, { site: listed, reason: "r" }], check(), bug()), [`site ${listed} is contested twice`]);
    assert.deepEqual(contestErrors([{ site: listed, reason: " " }], check(), bug()), [`site "${listed}": the reason is empty`]);
  });
});

describe("validateRuling", () => {
  const open = (issue: number) => (issue === 7 ? "OPEN" : issue === 8 ? "CLOSED" : null);

  it("accepts a ruling whose every evidence cites a line of the tree", () => {
    assert.deepEqual(validateRuling({ ruling: "SHARES", evidence: ["src/load.py:12"] }, located, open), []);
    assert.deepEqual(validateRuling({ ruling: "DEFERRED", issue: 7, evidence: ["src/load.py:12"] }, located, open), []);
  });

  it("needs a deferred ruling's issue, and the issue open and readable", () => {
    assert.deepEqual(validateRuling({ ruling: "DEFERRED", evidence: ["src/load.py:12"] }, located, open), ["a DEFERRED ruling needs the number of an open issue the site moves to"]);
    assert.deepEqual(validateRuling({ ruling: "DEFERRED", issue: 8, evidence: ["src/load.py:12"] }, located, open), ["issue #8 is not open in this repo"]);
    assert.deepEqual(validateRuling({ ruling: "DEFERRED", issue: 9, evidence: ["src/load.py:12"] }, located, open), [
      "issue #9 could not be read: it is not an issue of this repo, or GitHub could not be reached. Name an open issue of this repo",
    ]);
  });

  it("refuses evidence that cites a line the tree lacks, or no line at all", () => {
    assert.deepEqual(validateRuling({ ruling: "SHARES", evidence: ["src/load.py:99"] }, located, open), ["evidence src/load.py:99: src/load.py is not a file of the tree, or has no such line"]);
    assert.deepEqual(validateRuling({ ruling: "NOT_SHARED", evidence: ["it differs"] }, located, open), [`evidence "it differs" names no path:line of the tree`]);
  });
});

describe("settleBugs", () => {
  it("opens a bug for a patch that reaches none, counting the tree and taking the hunks and sites as its ranges", () => {
    const [opened] = settled([], check({ hunks: [range("src/load.py", 20, 2)] }));
    assert.deepEqual(opened.members, [{ tree: TREE, at: AT }]);
    assert.deepEqual(opened.ranges, [range("src/load.py", 20, 2), range("src/load.py", 12, 1)]);
    assert.deepEqual([opened.absorbed, opened.deep, opened.rulings], [[], null, []]);
  });

  it("counts the tree in the bug it reaches, and a tree it counted or absorbed never again", () => {
    assert.equal(settled([bug()])[0].members.length, 2);
    assert.equal(settled([bug("c".repeat(16), 1, { members: [{ tree: TREE, at: AT }] })])[0].members.length, 1);
    assert.equal(settled([bug("c".repeat(16), 1, { absorbed: [{ tree: TREE, at: AT }] })])[0].members.length, 1);
  });

  it("merges the bugs a patch reaches into the one with the higher count, absorbing the other's members, then counts the tree", () => {
    const low = bug("a".repeat(16), 1, { ranges: [range("src/load.py", 11, 1)] });
    const high = bug("b".repeat(16), 3, { ranges: [range("src/load.py", 12, 1)] });
    const after = byId(settled([low, high]));
    assert.deepEqual(Object.keys(after), ["b".repeat(16)]);
    assert.deepEqual(after["b".repeat(16)].members.map((member) => member.tree), [...high.members.map((member) => member.tree), TREE]);
    assert.deepEqual(after["b".repeat(16)].absorbed, low.members);
    assert.equal(after["b".repeat(16)].ranges.length, 2);
  });

  it("merges into the smaller id on a tie", () => {
    assert.deepEqual(Object.keys(byId(settled([bug("b".repeat(16), 2), bug("a".repeat(16), 2)]))), ["a".repeat(16)]);
  });

  it("does not count the tree again in a survivor that held it or absorbed it", () => {
    const counted = bug("a".repeat(16), 1, { members: [{ tree: sha(1), at: AT }, { tree: TREE, at: AT }] });
    assert.equal(byId(settled([counted, bug("b".repeat(16), 1)]))["a".repeat(16)].members.length, 2);
    assert.equal(byId(settled([counted, bug("b".repeat(16), 3)]))["b".repeat(16)].members.length, 3);
  });

  it("keeps a deep sweep's lists on the bug, counting nothing", () => {
    const deep = check({ mode: "deep", callers: [site({ file: "src/save.py", line: 3, function: "main" })] });
    const [after] = settled([bug()], deep);
    assert.deepEqual(after.deep, { same_operation: deep.same_operation, callers: deep.callers });
    assert.equal(after.members.length, 1);
  });

  it("drops the bugs a complete verdict reaches and keeps the others", () => {
    const away = bug("d".repeat(16), 2, { ranges: [range("src/save.py", 3, 1)] });
    assert.deepEqual(settled([bug("a".repeat(16)), bug("b".repeat(16), 3), away], check({ verdict: "complete" })), [away]);
  });

  it("changes nothing it is given", () => {
    const given = [bug()];
    settled(given);
    assert.deepEqual(given, [bug()]);
  });
});

describe("carriedBugs", () => {
  const old = Array.from({ length: 20 }, (_, n) => `line ${n + 1}\n`).join("");
  const without = (first: number, last: number) =>
    old
      .split(/(?<=\n)/)
      .filter((_, n) => n + 1 < first || n + 1 > last)
      .join("");
  async function carry(bugs: Bug[], next: string, file = "src/load.py"): Promise<Bug[]> {
    return carriedBugs(bugs, { [file]: old }, { [file]: next }, new Set(), { [file]: await textHunks(old, next) }, BUDGET);
  }

  it("moves a bug down by the lines added above it", async () => {
    assert.deepEqual((await carry([bug("c".repeat(16), 1, { ranges: [range("src/load.py", 10, 2)] })], `top\ntop2\n${old}`))[0].ranges, [range("src/load.py", 12, 2)]);
  });

  it("leaves the ranges of a file whose text did not change", async () => {
    assert.deepEqual((await carry([bug("c".repeat(16), 1, { ranges: [range("src/load.py", 10, 2)] })], old))[0].ranges, [range("src/load.py", 10, 2)]);
  });

  it("drops a bug whose lines were deleted, moved elsewhere in the file, or whose file is empty now", async () => {
    const lines = old.split(/(?<=\n)/);
    const moved = [...lines.slice(0, 9), ...lines.slice(11), ...lines.slice(9, 11)].join("");
    for (const next of [without(9, 12), moved, ""]) assert.deepEqual(await carry([bug("c".repeat(16), 1, { ranges: [range("src/load.py", 10, 2)] })], next), []);
  });

  it("widens a range measured in empty text to the whole file once the file has text", async () => {
    const file = "src/new.py";
    const carried = carriedBugs([bug("c".repeat(16), 1, { ranges: [range(file, 0, 0)] })], { [file]: "" }, { [file]: "a\nb\nc\n" }, new Set(), { [file]: await textHunks("", "a\nb\nc\n") }, BUDGET);
    assert.deepEqual(carried[0].ranges, [range(file, 1, 3)]);
  });

  it("drops a range in a file that is gone, keeping the bug's ranges in other files", () => {
    const file = "src/new.py";
    const given = [bug("c".repeat(16), 1, { ranges: [range(file, 0, 0)] })];
    assert.equal(carriedBugs(given, { [file]: "" }, { [file]: "" }, new Set(), {}, BUDGET).length, 1);
    assert.deepEqual(carriedBugs(given, { [file]: "" }, { [file]: "" }, new Set([file]), {}, BUDGET), []);
    const texts = { "src/load.py": old, "src/save.py": "x\ny\nz\n" };
    const two = [bug("c".repeat(16), 1, { ranges: [range("src/load.py", 10, 2), range("src/save.py", 3, 1)] })];
    assert.deepEqual(carriedBugs(two, texts, texts, new Set(["src/load.py"]), {}, BUDGET)[0].ranges, [range("src/save.py", 3, 1)]);
  });

  it("keeps a bug's range in another file when one range's lines are deleted", async () => {
    const next = without(9, 12);
    const two = [bug("c".repeat(16), 1, { ranges: [range("src/load.py", 10, 2), range("src/save.py", 3, 1)] })];
    const [kept] = carriedBugs(two, { "src/load.py": old, "src/save.py": "x\ny\nz\n" }, { "src/load.py": next, "src/save.py": "x\ny\nz\n" }, new Set(), { "src/load.py": await textHunks(old, next) }, BUDGET);
    assert.deepEqual(kept.ranges, [range("src/save.py", 3, 1)]);
  });
});
