import assert from "node:assert/strict";
import { describe, it, type TestContext } from "node:test";

import { at, round, sha } from "../../core/tests/fixtures/state/issue.ts";
import { RoundResult, RoundStage, RoundVerdict } from "../plugin/core/values.ts";
import { assessmentSchema } from "../plugin/lib/round/assess.ts";
import {
  reviewedHeads,
  roundFacts,
  type FactsSettings,
  type FindingUnderReview,
  type ReviewedRound,
  type RoundFacts,
  type Spot,
} from "../plugin/lib/rules/facts.ts";
import { admissibleVerdicts } from "../plugin/lib/rules/rounds.ts";
import { fixHistory, type CommitChanges, type FixHistory, type LineRange } from "../plugin/lib/worktree.ts";
import { featureRepo, git, numbered, type FeatureRepo } from "./support/git.ts";

const { INTERNAL, GITHUB } = RoundStage.schema.enum;
const { CLEAN, DIRTY, INCOMPLETE } = RoundResult.schema.enum;
const { PATCH, CLASS_FIX, REDESIGN, CONVERGED_PUSHBACK } = RoundVerdict.schema.enum;

// None is the repository's own value, so a constant in code shows.
const SETTINGS: FactsSettings = { edits_before_redesign: 2, near_fix_lines: 1, same_unit_lines: 2 };

function reviewed(n: number, findings: Spot[], fields: Partial<ReviewedRound> = {}): ReviewedRound {
  return { ...round(n, { result: DIRTY, verdict: PATCH }), ...fields, findings };
}

const spot = (file: string | null, line: number | null): Spot => ({ file, line });

function finding(id: string, file: string | null, line: number | null, text = "the reader accepts an empty name"): FindingUnderReview {
  return { id, file, line, text };
}

/** A commit of a fix range; a pair is a rename, from its first name to its second. */
function commit(sha: string, ...changes: (string | [from: string, to: string])[]): CommitChanges {
  return { sha, changes: changes.map((change) => (typeof change === "string" ? { path: change, from: null } : { path: change[1], from: change[0] })) };
}

function history(ranges: CommitChanges[][], fixLines: [string, LineRange[]][] = []): FixHistory {
  return { ranges, fixLines: new Map(fixLines), originalAdditions: 0, fixAdditions: 0 };
}

function factsOf(rounds: ReviewedRound[], findings: FindingUnderReview[], fixes: FixHistory, floor: string | null = null): RoundFacts {
  const n = 1 + rounds.filter(({ stage }) => stage === INTERNAL).length;
  return roundFacts({ rounds, round: { stage: INTERNAL, n, findings }, floor, history: fixes }, SETTINGS);
}

describe("reviewedHeads", () => {
  it("gives each head once however many rounds in a row reviewed it", () => {
    const heads = [1, 1, 1, 2, 1].map((n) => ({ head: sha(n) }));
    assert.deepEqual(reviewedHeads(heads), [sha(1), sha(2), sha(1)]);
  });
});

describe("roundFacts: each finding's flags", () => {
  it("puts a finding on fix lines within near_fix_lines of a line a fix wrote, and not past it", () => {
    const fixes = history([[commit("f1", "b.py")]], [["b.py", [[10, 10]]]]);
    const findings = [finding("on-9", "b.py", 9), finding("on-11", "b.py", 11), finding("off-8", "b.py", 8), finding("off-12", "b.py", 12), finding("other", "c.py", 10)];
    const facts = factsOf([reviewed(1, [])], findings, fixes);
    assert.deepEqual(
      Object.entries(facts.findings).map(([id, flags]) => [id, flags.on_fix_lines]),
      [["on-9", true], ["on-11", true], ["off-8", false], ["off-12", false], ["other", false]],
    );
  });

  it("repeats a unit within same_unit_lines of an earlier round's finding on that file, the file followed across a rename", () => {
    const rounds = [reviewed(1, [spot("b.py", 20)]), reviewed(2, [spot("x.py", 1)])];
    const fixes = history([[commit("f1", ["b.py", "c.py"])], []]);
    const findings = [finding("near", "c.py", 22), finding("near-before", "c.py", 18), finding("past", "c.py", 23), finding("old-name", "b.py", 20)];
    const facts = factsOf(rounds, findings, fixes);
    assert.deepEqual(
      Object.entries(facts.findings).map(([id, flags]) => [id, flags.repeat_unit]),
      [["near", true], ["near-before", true], ["past", false], ["old-name", false]],
    );
  });

  it("finds a prior fix cited where the text names an earlier fix, a regression, what introduced it or what no longer holds", () => {
    const texts: [string, boolean][] = [
      ["the previous fix broke the reader", true],
      ["a regression in the parser", true],
      ["introduced by the round 2 change", true],
      ["the guard no longer runs", true],
      ["the Recent Commit dropped a check", true],
      ["fix the parser", false],
      ["this is a new defect", false],
    ];
    const facts = factsOf([], texts.map(([text], index) => finding(`f-${index}`, "b.py", 1, text)), history([]));
    assert.deepEqual(Object.values(facts.findings).map((flags) => flags.cites_prior_fix), texts.map(([, cites]) => cites));
  });

  it("puts a finding that names no line, or no file, on nothing, and an earlier one with no line or no file repeats nothing", () => {
    const fixes = history([[commit("f1", "b.py")]], [["b.py", [[1, 30]]]]);
    const earlier = [spot("b.py", null), spot(null, null), spot(null, 5)];
    const findings = [finding("whole", "b.py", null), finding("none", null, null), finding("fileless", null, 5), finding("lined", "b.py", 5)];
    const facts = factsOf([reviewed(1, earlier)], findings, fixes);
    assert.deepEqual(facts.findings, {
      whole: { on_fix_lines: false, repeat_unit: false, cites_prior_fix: false },
      none: { on_fix_lines: false, repeat_unit: false, cites_prior_fix: false },
      fileless: { on_fix_lines: false, repeat_unit: false, cites_prior_fix: false },
      lined: { on_fix_lines: true, repeat_unit: false, cites_prior_fix: false },
    });
  });
});

describe("roundFacts: the finding counts and the burden of proof", () => {
  const FLOOR = at("10:00");
  const many = (count: number): Spot[] => Array.from({ length: count }, (_, index) => spot("b.py", 100 * (index + 1)));
  const rounds = [
    reviewed(1, many(3), { at: at("09:00") }),
    reviewed(2, many(2), { at: at("10:30") }),
    reviewed(3, [], { at: at("10:40"), result: INCOMPLETE, verdict: null }),
    reviewed(1, many(5), { at: at("10:50"), stage: GITHUB, head: sha(4) }),
  ];
  const fixes = history([[], [], [], []]);

  it("counts the findings of the stage's rounds that completed after the admin floor, and compares the round with the last", () => {
    const clean = [...rounds, reviewed(4, [], { at: at("10:55"), result: CLEAN, verdict: null, head: sha(5) })];
    const notFalling = factsOf(clean, [finding("f", "b.py", 1)], history([[], [], [], [], []]), FLOOR);
    assert.deepEqual([notFalling.finding_counts_of_earlier_rounds, notFalling.count_not_falling], [[2, 0], true]);

    const falling = factsOf(rounds, [finding("f", "b.py", 1)], fixes, FLOOR);
    assert.deepEqual([falling.finding_counts_of_earlier_rounds, falling.count_not_falling], [[2], false]);
  });

  it("carries the burden when the count is not falling and a finding is flagged", () => {
    const facts = factsOf(rounds, [finding("f", "b.py", 1, "the previous fix broke it"), finding("g", "c.py", 1)], fixes, FLOOR);
    assert.deepEqual([facts.count_not_falling, facts.burden], [true, true]);
  });

  it("carries none in the stage's first round, when the count falls, or when no finding is flagged", () => {
    const flagged = [finding("f", "b.py", 1, "the previous fix broke it")];
    assert.equal(factsOf([], flagged, history([])).burden, false);
    assert.equal(factsOf(rounds, flagged, fixes, FLOOR).burden, false);
    assert.equal(factsOf(rounds, [finding("f", "b.py", 1), finding("g", "c.py", 1)], fixes, FLOOR).burden, false);
  });
});

describe("roundFacts: each file's edits since its reset (ADR-0018)", () => {
  const ROUND_1 = { at: "round 1", head: sha(1) } as const;

  it("counts the rounds' fixes that touched a file since round 1, however many commits one round's fix took", () => {
    const fixes = history([[commit("c1", "b.py"), commit("c2", "b.py"), commit("c3", "c.py")], [commit("c4", "b.py")]]);
    const facts = factsOf([reviewed(1, []), reviewed(2, [])], [], fixes);
    assert.deepEqual(facts.edits_since_reset, { "b.py": { edits: 2, reset: ROUND_1 }, "c.py": { edits: 1, reset: ROUND_1 } });
  });

  it("follows a file across renames to its name at the head under review", () => {
    const fixes = history([[commit("c1", "b.py")], [commit("c2", ["b.py", "c.py"])], [commit("c3", "c.py")]]);
    const facts = factsOf([reviewed(1, []), reviewed(2, []), reviewed(3, [])], [], fixes);
    assert.deepEqual(facts.edits_since_reset, { "c.py": { edits: 3, reset: ROUND_1 } });
  });

  it("restarts at the last settled round's head: a CLEAN round, or one ruled CONVERGED_PUSHBACK", () => {
    const fixes = history([[commit("c1", "b.py")], [commit("c2", "b.py")], [commit("c3", "b.py")]]);
    const clean: Partial<ReviewedRound> = { result: CLEAN, verdict: null };
    const pushedBack: Partial<ReviewedRound> = { verdict: CONVERGED_PUSHBACK };
    for (const [earlier, settled] of [[{}, clean], [{}, pushedBack], [pushedBack, clean], [clean, pushedBack]]) {
      const facts = factsOf([reviewed(1, [], earlier), reviewed(2, [], settled), reviewed(3, [])], [], fixes);
      assert.deepEqual(facts.edits_since_reset, { "b.py": { edits: 2, reset: { at: "settled round", stage: INTERNAL, n: 2, head: sha(2) } } });
    }
  });

  it("restarts a file's count after the commit that closed its last REDESIGN finding, naming that commit", () => {
    const rounds = [reviewed(1, [spot("b.py", 1)], { verdict: REDESIGN }), reviewed(2, [spot("b.py", 3)], { verdict: REDESIGN }), reviewed(3, [])];
    const fixes = history([[commit("c1", "b.py")], [commit("c2", "b.py"), commit("c3", "b.py"), commit("c4", "c.py")], [commit("c5", "b.py", "c.py")]]);
    assert.deepEqual(factsOf(rounds, [], fixes).edits_since_reset, {
      "b.py": { edits: 1, reset: { at: "REDESIGN closed", stage: INTERNAL, n: 2, commit: "c3" } },
      "c.py": { edits: 2, reset: ROUND_1 },
    });
  });

  it("follows a REDESIGN finding's file across a rename", () => {
    const rounds = [reviewed(1, [spot("b.py", 1)], { verdict: REDESIGN }), reviewed(2, [])];
    const fixes = history([[commit("c1", ["b.py", "c.py"])], [commit("c2", "c.py")]]);
    assert.deepEqual(factsOf(rounds, [], fixes).edits_since_reset, {
      "c.py": { edits: 1, reset: { at: "REDESIGN closed", stage: INTERNAL, n: 1, commit: "c1" } },
    });
  });

  it("resets nothing for a REDESIGN whose fixes did not touch the file", () => {
    const rounds = [reviewed(1, []), reviewed(2, [spot("b.py", 1)], { verdict: REDESIGN }), reviewed(3, [])];
    const fixes = history([[commit("c1", "b.py")], [commit("c2", "c.py")], [commit("c3", "b.py")]]);
    assert.deepEqual(factsOf(rounds, [], fixes).edits_since_reset["b.py"], { edits: 2, reset: ROUND_1 });
  });

  it("takes a settled round over the REDESIGN closed before its head", () => {
    const rounds = [reviewed(1, [spot("b.py", 1)], { verdict: REDESIGN }), reviewed(2, [], { result: CLEAN, verdict: null }), reviewed(3, [])];
    const fixes = history([[commit("c1", "b.py")], [commit("c2", "b.py")], [commit("c3", "b.py")]]);
    assert.deepEqual(factsOf(rounds, [], fixes).edits_since_reset["b.py"], {
      edits: 2,
      reset: { at: "settled round", stage: INTERNAL, n: 2, head: sha(2) },
    });
  });

  it("names the files at or over edits_before_redesign, and is churned only when a finding of the round names one", () => {
    const rounds = [reviewed(1, []), reviewed(2, []), reviewed(3, [])];
    // b.py's edits are over the bar, d.py's at it, c.py's under it.
    const fixes = history([[commit("c1", "b.py", "c.py")], [commit("c2", "b.py", "d.py")], [commit("c3", "b.py", "d.py")]]);
    const elsewhere = factsOf(rounds, [finding("f", "c.py", 1)], fixes);
    assert.deepEqual([elsewhere.files_over_edit_bar, elsewhere.churned], [["b.py", "d.py"], false]);
    for (const file of ["b.py", "d.py"]) assert.equal(factsOf(rounds, [finding("f", file, 1)], fixes).churned, true, file);
  });

  it("refuses a fix history whose ranges do not match the heads the rounds reviewed", () => {
    assert.throws(() => factsOf([reviewed(1, []), reviewed(2, [])], [], history([[]])), /1 ranges for the 2 heads/);
    assert.throws(() => factsOf([reviewed(1, [])], [], history([[], []])), /2 ranges for the 1 heads/);
  });
});

describe("roundFacts over a real branch", () => {
  const B = numbered("b", 20);
  // b.py's line 5 split in two.
  const FIXED = B.replace("b4\n", "fixed-a\nfixed-b\n");

  async function factsAt(root: string, rounds: ReviewedRound[], findings: FindingUnderReview[]): Promise<RoundFacts> {
    const head = git(root, "rev-parse", "HEAD");
    const fixes = await fixHistory(root, reviewedHeads(rounds), head, git(root, "merge-base", head, "main"));
    return factsOf(rounds, findings, fixes);
  }

  /** Main rewrites a.py lines 11-13, one commit each, and the branch merges main. */
  function mainEditsMerged({ root, commit: commitFiles }: FeatureRepo): void {
    git(root, "checkout", "-q", "main");
    let text = numbered("line", 30);
    for (const index of [0, 1, 2]) {
      text = text.replace(`line${10 + index}\n`, `main${index}\n`);
      commitFiles({ "a.py": text }, `main ${index}`);
    }
    git(root, "checkout", "-q", "feat");
    git(root, "merge", "-q", "--no-edit", "main");
  }

  function firstRound(t: TestContext): { repo: FeatureRepo; rounds: ReviewedRound[] } {
    const repo = featureRepo(t);
    const head = repo.commit({ "b.py": B }, "feat: b");
    return { repo, rounds: [reviewed(1, [spot("b.py", 5)], { head })] };
  }

  it("shifts the burden of proof onto a second round landing on lines a fix wrote", async (t) => {
    const { repo, rounds } = firstRound(t);
    repo.commit({ "b.py": FIXED }, "fix: b");
    const facts = await factsAt(repo.root, rounds, [finding("code-reviewer-1", "b.py", 6)]);
    assert.equal(facts.count_not_falling, true);
    assert.deepEqual(facts.findings["code-reviewer-1"], { on_fix_lines: true, repeat_unit: true, cites_prior_fix: false });
    assert.equal(facts.burden, true);
    assert.deepEqual([facts.original_additions, facts.fix_additions], [20, 2]);
  });

  it("counts nothing the base branch wrote: no fix line, no fix addition, no edit", async (t) => {
    const { repo, rounds } = firstRound(t);
    mainEditsMerged(repo);
    repo.commit({ "b.py": FIXED }, "fix: b");
    const facts = await factsAt(repo.root, rounds, [finding("on-main", "a.py", 11), finding("on-fix", "b.py", 6)]);
    assert.deepEqual([facts.findings["on-main"].on_fix_lines, facts.findings["on-fix"].on_fix_lines], [false, true]);
    assert.deepEqual([facts.original_additions, facts.fix_additions], [20, 2]);
    assert.deepEqual(Object.keys(facts.edits_since_reset), ["b.py"]);
  });

  it("counts no commit made before round 1's head as an edit", async (t) => {
    const repo = featureRepo(t);
    repo.commit({ "b.py": "-1\n" }, "feat: b, first draft");
    const head = repo.commit({ "b.py": "0\n" }, "feat: b");
    repo.commit({ "b.py": "1\n" }, "fix");
    const facts = await factsAt(repo.root, [reviewed(1, [spot("b.py", 1)], { head })], [finding("f", "b.py", 1)]);
    assert.deepEqual(facts.edits_since_reset, { "b.py": { edits: 1, reset: { at: "round 1", head } } });
  });

  it("counts rounds' fixes, not commits, and offers a round churned by them no PATCH or CLASS_FIX", async (t) => {
    const repo = featureRepo(t);
    const first = repo.commit({ "b.py": "0\n" }, "feat: b");
    for (const fix of ["1", "2", "3"]) repo.commit({ "b.py": `${fix}\n` }, `fix ${fix}`);
    const rounds = [reviewed(1, [spot("b.py", 1)], { head: first })];
    const once = await factsAt(repo.root, rounds, [finding("f", "b.py", 1)]);
    assert.deepEqual([once.edits_since_reset["b.py"].edits, once.churned], [1, false]);

    rounds.push(reviewed(2, [spot("b.py", 1)], { head: git(repo.root, "rev-parse", "HEAD") }));
    repo.commit({ "b.py": "4\n" }, "fix 4");
    const twice = await factsAt(repo.root, rounds, [finding("f", "b.py", 1)]);
    assert.deepEqual([twice.edits_since_reset["b.py"].edits, twice.files_over_edit_bar, twice.churned], [2, ["b.py"], true]);

    const offered = (facts: RoundFacts): unknown => assessmentSchema("r", admissibleVerdicts(facts.churned)).properties?.round_verdict;
    assert.deepEqual(offered(once), { type: "string", enum: [PATCH, CLASS_FIX, REDESIGN, "RESHAPE_SPEC", CONVERGED_PUSHBACK, "ESCALATE"] });
    assert.deepEqual(offered(twice), { type: "string", enum: [REDESIGN, "RESHAPE_SPEC", CONVERGED_PUSHBACK, "ESCALATE"] });
  });
});
