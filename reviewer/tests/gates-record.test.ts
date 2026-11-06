import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { addedFiles, at, commitsAsked, gates, ISSUE, lineage, NOW, reader, releasedHold, REPO, round, SHARED, sha, snapshot, writer } from "../../core/tests/fixtures/state/issue.ts";
import { event, eventCommit, fakeLedger, fileOf, storyDir, storyOf, type FakeLedger } from "../../core/tests/fixtures/state/ledger.ts";
import { fakeGitHub, type FakeGitHub } from "../../core/tests/support/fake-github.ts";
import type { Bug, Lineage } from "../plugin/core/contracts/gates.ts";
import type { Hold, Snapshot } from "../plugin/core/contracts/snapshot.ts";
import { GitFailed } from "../plugin/core/git.ts";
import { readState, type StateReading } from "../plugin/core/state.ts";
import { HoldKind, HoldState, RoundStage } from "../plugin/core/values.ts";
import { bareCopy, fetchFromClone, fromGitHub, type AnchorSources } from "../plugin/lib/check/bare-copy.ts";
import { Words } from "../plugin/lib/check/lineage.ts";
import { CouldNotRun, FIX_THEN_RETRY } from "../plugin/lib/hook-io.ts";
import { GatesBranchMismatch, recordCheck, type CompletedCheck, type GatesRecorder } from "../plugin/lib/round/gates.ts";
import { recordRound } from "../plugin/lib/round/record.ts";
import { AnchorMissing } from "../plugin/lib/rules/anchor.ts";
import { checkRef, claimId, type Claim, type Verdict } from "../plugin/lib/rules/claim.ts";
import { lineageCount } from "../plugin/lib/rules/counts.ts";
import type { ShimCheck } from "../plugin/lib/rules/shim.ts";
import { RunState } from "../plugin/lib/run-state.ts";
import { cloneWith, git } from "./support/git.ts";
import { tempHome, tempSession } from "./support/session.ts";

const { claim, shim } = HoldKind.schema.enum;
const { OPEN } = HoldState.schema.enum;
const { INTERNAL } = RoundStage.schema.enum;

// Not the repository's own values, so a constant in code shows.
const SETTINGS = { claim_hold_at: 2, shim_hold_at: 2, char_diff_budget: 4000 };
const ATTEMPTS = 3;
const ELSEWHERE = 7;
const BRANCH = gates().branch;
const OTHER_BRANCH = `${ISSUE}-us2-logout`;

const FILE = "src/parse.ts";
const QUOTE = "The parser refuses a null header.";
const TEXT_A = ["export function parse(header) {", `  // ${QUOTE}`, '  if (header === null) throw new TypeError("null header");', "  return header.trim();", "}", ""].join("\n");
const GUARD_LINE_A = 3;
const RETURN_LINE_A = 4;
// The fix rewrites the guard and puts two lines above everything, so what it leaves moves down two lines.
const TEXT_H = `// parse.ts\n\n${TEXT_A.replace('if (header === null) throw new TypeError("null header");', 'if (header === null || header === "") throw new TypeError("no header");')}`;
const QUOTE_LINE_A = 2;
const QUOTE_LINE_H = 4;
const RETURN_LINE_H = 6;

const CLAIM_ID = claimId(FILE, QUOTE);
const CLAIM: Claim = { id: CLAIM_ID, hunk: "h1", file: FILE, line: QUOTE_LINE_H, quote: QUOTE, category: "K1" };
const FAILING_CASE = "parse(undefined) returns instead of refusing";
const BROKEN_EVIDENCE = "src/parse.ts:5 tests null alone";
const WRONG_VERDICT: Verdict = {
  verdict: "WRONG",
  basis: "the guard compares with null alone",
  assertions: [
    { text: "the parser has a guard", confirmed: true, evidence: "src/parse.ts:5" },
    { text: "undefined is refused", confirmed: false, evidence: BROKEN_EVIDENCE },
  ],
  failing_case: FAILING_CASE,
};

const BUG_ID = "b1";
const CLAIM_RUN = "wf_claim3";
const SHIM_RUN = "wf_shim";

/** A repository whose first commit `a` holds TEXT_A and whose second, `h`, TEXT_H; `copy` is where both are read. */
type Repo = { copy: string; a: string; h: string; treeH: string };

function repo(t: TestContext): Repo {
  const { clone, head: a } = cloneWith(t, { [FILE]: TEXT_A });
  writeFileSync(join(clone, FILE), TEXT_H);
  git(clone, "commit", "-q", "-am", "header");
  return { copy: clone, a, h: git(clone, "rev-parse", "HEAD"), treeH: git(clone, "rev-parse", "HEAD^{tree}") };
}

/** Anchor sources where only the copy holds commits: the model's clone and GitHub hold none. */
function sources(copy: string): AnchorSources {
  return {
    copy,
    clone: async () => false,
    github: async () => false,
  };
}

/** A ledger holding one commit to another story, so its branch exists, then `state` as the story's. */
function seeded(state: Snapshot | null = null): FakeLedger {
  const ledger = fakeLedger();
  eventCommit(ledger, [event.round(round(1))], { issue: ELSEWHERE });
  if (state !== null) storyOf(ledger, state);
  return ledger;
}

function stateOver(ledger: FakeLedger): RunState {
  return new RunState({ reader: reader({}, ledger), repo: REPO, issue: ISSUE, shared: SHARED, attempts: ATTEMPTS });
}

type Harness = { out: FakeGitHub; recorder: GatesRecorder };

/** A hook run over `ledger`: a new session's, since nothing is kept past a run. */
function harness(r: Repo, ledger: FakeLedger, now = NOW): Harness {
  const out = writer(ledger, now);
  return { out, recorder: { state: stateOver(ledger), writer: async () => out, settings: SETTINGS, sources: sources(r.copy) } };
}

function readStory(ledger: FakeLedger): Promise<StateReading> {
  return readState(reader({}, ledger), REPO, ISSUE, SHARED);
}

function placeOf(text: string, line: number): Lineage["places"][number] {
  const [start, end] = new Words(text).span(line, QUOTE);
  return { start, end, claim: CLAIM_ID };
}

function wrongEntry(tree: string, clock: string): Lineage["chain"][number] {
  return { ref: checkRef(REPO, tree), claim: CLAIM_ID, line: QUOTE_LINE_A, words: QUOTE, ruling: "WRONG", at: at(clock) };
}

function wrongLineage(...trees: string[]): Lineage {
  return lineage(CLAIM_ID, { file: FILE, places: [placeOf(TEXT_A, QUOTE_LINE_A)], chain: trees.map((tree, i) => wrongEntry(tree, `09:1${i}`)) });
}

/** A bug at `line` of FILE, counted in the trees given. */
function bug(line: number, ...trees: string[]): Bug {
  return {
    id: BUG_ID,
    members: trees.map((tree, i) => ({ tree, at: at(`09:2${i}`) })),
    absorbed: [],
    ranges: [{ file: FILE, old_start: line, old_count: 1 }],
    deep: null,
    rulings: [],
  };
}

function claimCheck(r: Repo, fields: Partial<CompletedCheck> = {}): CompletedCheck {
  return { run: CLAIM_RUN, branch: BRANCH, head: r.h, tree: r.treeH, claim: { claims: { [CLAIM_ID]: CLAIM }, verdicts: { [CLAIM_ID]: WRONG_VERDICT } }, ...fields };
}

const PATCH: ShimCheck = { hunks: [{ file: FILE, old_start: GUARD_LINE_A, old_count: 1 }], same_operation: [], callers: [], mode: "sweep", verdict: "patch" };

/** `check` as a shim check of `h` whose base is `a`. */
function shimCheck(r: Repo, check: ShimCheck = PATCH): CompletedCheck {
  return { run: SHIM_RUN, branch: BRANCH, head: r.h, tree: r.treeH, base: r.a, shim: check };
}

function filesOf(out: FakeGitHub): string[] {
  const [commit, ...more] = commitsAsked(out);
  assert.equal(more.length, 0, "one commit");
  return Object.keys(addedFiles(commit)).sort();
}

const gatesFile = (run: string): string => `${storyDir()}/gates.${run}.json`;

/** The story file of the hold event that placed `row`. */
function placedFile({ state, released, released_by, ...placement }: Hold): string {
  return `${storyDir()}/${fileOf(event.hold(placement))}`;
}

describe("recordCheck: a completed check's counts and the holds they reach, in one recordGates commit (qs #5)", () => {
  it("records the WRONG that reaches claim_hold_at with the claim-<id> hold: gates.<run>.json and hold.claim-<id>.<since>.json in one commit", async (t) => {
    const r = repo(t);
    const ledger = seeded(snapshot({ gates: gates({ anchor: r.a, lineages: [wrongLineage(sha(11))] }) }));
    const h = harness(r, ledger);
    await recordCheck(h.recorder, claimCheck(r));

    const reading = await readStory(ledger);
    const [row, ...rows] = reading.snapshot?.holds ?? [];
    assert.equal(rows.length, 0);
    assert.deepEqual(filesOf(h.out), [gatesFile(CLAIM_RUN), placedFile(row)]);
    assert.equal(row.id, `${claim}-${CLAIM_ID}`);
    assert.equal(row.state, OPEN);
    assert.equal(row.since, NOW);
    assert.ok(row.question?.includes(`Failing case: ${FAILING_CASE}`), row.question ?? "");
    assert.ok(row.question?.includes(`Evidence: ${BROKEN_EVIDENCE}`), row.question ?? "");

    const [carried, ...others] = reading.snapshot?.gates?.lineages ?? [];
    assert.equal(others.length, 0);
    assert.equal(lineageCount(carried, null), SETTINGS.claim_hold_at);
    assert.deepEqual(carried.chain.at(-1), { ...wrongEntry(r.treeH, "12:00"), line: QUOTE_LINE_H });
    assert.deepEqual(carried.places, [placeOf(TEXT_H, QUOTE_LINE_H)]);
  });

  it("counts a tree once: the same tree re-checked in a new session adds no count and places no hold again", async (t) => {
    const r = repo(t);
    const ledger = seeded(snapshot({ gates: gates({ anchor: r.a, lineages: [wrongLineage(sha(11))] }) }));
    await recordCheck(harness(r, ledger).recorder, claimCheck(r));
    const again = harness(r, ledger);
    await recordCheck(again.recorder, claimCheck(r, { run: `${CLAIM_RUN}-again` }));

    assert.deepEqual(filesOf(again.out), [gatesFile(`${CLAIM_RUN}-again`)]);
    const [carried] = (await readStory(ledger)).snapshot?.gates?.lineages ?? [];
    assert.equal(lineageCount(carried, null), 2);
    assert.equal(carried.chain.length, 2);
  });

  it("records a run once: the first run asks one commit, its retry in a new session, later, asks none", async (t) => {
    const doc = "docs/parse.md";
    const docQuote = "The parser trims the header.";
    const docText = `# Parse\n\n${docQuote}\n`;
    const { clone, head: a } = cloneWith(t, { [FILE]: TEXT_A, [doc]: docText });
    writeFileSync(join(clone, FILE), `${TEXT_H}// ${docQuote}\n`);
    git(clone, "commit", "-q", "-am", "header");
    const r: Repo = { copy: clone, a, h: git(clone, "rev-parse", "HEAD"), treeH: git(clone, "rev-parse", "HEAD^{tree}") };
    const docClaim = claimId(doc, docQuote);
    const [start, end] = new Words(docText).span(3, docQuote);
    const docLineage = lineage(docClaim, {
      file: doc,
      places: [{ start, end, claim: docClaim }],
      chain: [{ ref: checkRef(REPO, sha(12)), claim: docClaim, line: 3, words: docQuote, ruling: "CORRECT", at: at("09:00") }],
    });
    const ledger = seeded(snapshot({ gates: gates({ anchor: a, lineages: [wrongLineage(sha(11)), docLineage] }) }));
    const minted: Claim = { id: claimId(FILE, docQuote), hunk: "h2", file: FILE, line: 8, quote: docQuote, category: "K1" };
    const check = claimCheck(r, { claim: { claims: { [CLAIM_ID]: CLAIM, [minted.id]: minted }, verdicts: { [CLAIM_ID]: WRONG_VERDICT, [minted.id]: WRONG_VERDICT } } });
    const first = harness(r, ledger);
    await recordCheck(first.recorder, check);
    assert.equal(commitsAsked(first.out).length, 1);

    const retry = harness(r, ledger, at("12:30"));
    await recordCheck(retry.recorder, check);
    assert.equal(commitsAsked(retry.out).length, 0);
  });

  it("asks a split lineage's claim-<id> question with one claim's words, failing case and evidence: of two claims on one line, the one with the larger id", async (t) => {
    const r = repo(t);
    const ledger = seeded(snapshot({ gates: gates({ anchor: r.a, lineages: [wrongLineage(sha(11))] }) }));
    const halves = ["The parser refuses", "a null header."].map((quote, i): [Claim, Verdict] => [
      { id: claimId(FILE, quote), hunk: "h1", file: FILE, line: QUOTE_LINE_H, quote, category: "K1" },
      { ...WRONG_VERDICT, failing_case: `failing case ${i}`, assertions: [{ text: "it refuses", confirmed: false, evidence: `src/parse.ts:${10 + i}` }] },
    ]);
    const check = claimCheck(r, {
      claim: { claims: Object.fromEntries(halves.map(([read]) => [read.id, read])), verdicts: Object.fromEntries(halves.map(([read, verdict]) => [read.id, verdict])) },
    });
    await recordCheck(harness(r, ledger).recorder, check);

    const [row, ...rows] = (await readStory(ledger)).snapshot?.holds ?? [];
    assert.equal(rows.length, 0);
    assert.equal(row.id, `${claim}-${CLAIM_ID}`);
    const [[first, firstVerdict], [last, lastVerdict]] = halves.toSorted(([a], [b]) => (a.id < b.id ? -1 : 1));
    const question = row.question ?? "";
    for (const part of [`"${last.quote}"`, `Failing case: ${lastVerdict.failing_case}`, `Evidence: ${lastVerdict.assertions[0].evidence}`]) {
      assert.ok(question.includes(part), question);
    }
    for (const part of [`"${first.quote}"`, firstVerdict.failing_case ?? "", firstVerdict.assertions[0].evidence]) assert.ok(!question.includes(part), question);
  });

  it("places a released shim-<id> again with the bug's new member, both in one commit", async (t) => {
    const r = repo(t);
    const released = releasedHold(`${shim}-${BUG_ID}`, 901, { since: at("09:30") });
    const ledger = seeded(snapshot({ gates: gates({ anchor: r.a, bugs: [bug(GUARD_LINE_A, sha(21), sha(22))] }), holds: [released] }));
    const h = harness(r, ledger);
    await recordCheck(h.recorder, shimCheck(r));

    const reading = await readStory(ledger);
    const holds = reading.snapshot?.holds ?? [];
    assert.deepEqual(
      holds.map(({ id, state, since }) => [id, state, since]),
      [[`${shim}-${BUG_ID}`, OPEN, NOW]],
    );
    assert.deepEqual(filesOf(h.out), [gatesFile(SHIM_RUN), placedFile(holds[0])]);
    const [settled] = reading.snapshot?.gates?.bugs ?? [];
    assert.deepEqual(
      settled.members.map(({ tree }) => tree),
      [sha(21), sha(22), r.treeH],
    );
  });
});

describe("recordCheck: every check carries the whole section to its head, the new anchor", () => {
  const sectionAtA = (a: string) => gates({ anchor: a, lineages: [wrongLineage(sha(11))], bugs: [bug(RETURN_LINE_A, sha(21))] });
  const sectionAtH = (h: string) => gates({ anchor: h, lineages: [{ ...wrongLineage(sha(11)), places: [placeOf(TEXT_H, QUOTE_LINE_H)] }], bugs: [bug(RETURN_LINE_H, sha(21))] });

  it("a claim check carries the lineages' places and the bugs' ranges to its head", async (t) => {
    const r = repo(t);
    const ledger = seeded(snapshot({ gates: sectionAtA(r.a) }));
    await recordCheck(harness(r, ledger).recorder, claimCheck(r, { claim: { claims: {}, verdicts: {} } }));

    assert.deepEqual((await readStory(ledger)).snapshot?.gates, sectionAtH(r.h));
  });

  it("a shim check carries the lineages' places and the bugs' ranges to its head", async (t) => {
    const r = repo(t);
    const ledger = seeded(snapshot({ gates: sectionAtA(r.a) }));
    await recordCheck(harness(r, ledger).recorder, shimCheck(r, { ...PATCH, hunks: [], verdict: "complete" }));

    assert.deepEqual((await readStory(ledger)).snapshot?.gates, sectionAtH(r.h));
  });
});

describe("recordCheck: refusals (contracts/refusals.md)", () => {
  it("refuses a check on a branch other than the gates' branch, naming both; nothing committed", async (t) => {
    const r = repo(t);
    const h = harness(r, seeded(snapshot({ gates: gates({ anchor: r.a }) })));
    await assert.rejects(recordCheck(h.recorder, claimCheck(r, { branch: OTHER_BRANCH })), (error: unknown) => {
      assert.ok(error instanceof GatesBranchMismatch, String(error));
      assert.ok(error.message.includes(BRANCH), error.message);
      assert.ok(error.message.includes(OTHER_BRANCH), error.message);
      return true;
    });
    assert.equal(commitsAsked(h.out).length, 0);
  });

  it("refuses with AnchorMissing when no source has the anchor and no reset came after the section's times; nothing committed", async (t) => {
    const r = repo(t);
    const h = harness(r, seeded(snapshot({ gates: gates({ anchor: sha(4096), lineages: [wrongLineage(sha(11))] }) })));
    await assert.rejects(recordCheck(h.recorder, claimCheck(r)), AnchorMissing);
    assert.equal(commitsAsked(h.out).length, 0);
  });

  it("refuses as could not run naming the clone, the branch and the anchor when the fetch from the clone fails; nothing committed", async (t) => {
    const r = repo(t);
    const h = harness(r, seeded(snapshot({ gates: gates({ anchor: sha(4096), lineages: [wrongLineage(sha(11))] }) })));
    const copy = await bareCopy(tempSession(t));
    const noRepository = tempHome(t);
    const sources = { copy, clone: (anchor: string) => fetchFromClone(copy, noRepository, anchor), github: async () => false };
    await assert.rejects(recordCheck({ ...h.recorder, sources }, claimCheck(r)), (error: unknown) => {
      assert.ok(error instanceof CouldNotRun, String(error));
      for (const named of [noRepository, BRANCH, sha(4096), FIX_THEN_RETRY]) assert.ok(error.message.includes(named), error.message);
      return true;
    });
    assert.equal(commitsAsked(h.out).length, 0);
  });

  it("refuses as could not run naming GitHub's repository, the branch and the anchor when the fetch of a commit GitHub has fails; nothing committed", async (t) => {
    const r = repo(t);
    const anchor = sha(4096);
    const h = harness(r, seeded(snapshot({ gates: gates({ anchor, lineages: [wrongLineage(sha(11))] }) })));
    const [owner, name] = REPO.split("/");
    const answering = fakeGitHub({ rest: { [`GET /repos/${REPO}/commits/${anchor}`]: { sha: anchor } } });
    const github = fromGitHub(answering, { owner, name }, async () => {
      throw new GitFailed(["fetch"], 128, "fatal: unable to access the repository");
    });
    await assert.rejects(recordCheck({ ...h.recorder, sources: { copy: r.copy, clone: async () => false, github } }, claimCheck(r)), (error: unknown) => {
      assert.ok(error instanceof CouldNotRun, String(error));
      for (const named of [REPO, BRANCH, anchor, FIX_THEN_RETRY]) assert.ok(error.message.includes(named), error.message);
      return true;
    });
    assert.equal(commitsAsked(h.out).length, 0);
  });
});

describe("recordCheck: two writers from one reading (qs #6, FR-020)", () => {
  it("a round written first from the same reading: the gates write asked at the reading's head is asked again at the round's commit, and both are in the fold", async (t) => {
    const r = repo(t);
    const ledger = seeded(snapshot({ gates: gates({ anchor: r.a, lineages: [wrongLineage(sha(11))] }) }));
    const roundOut = writer(ledger);
    const roundState = stateOver(ledger);
    const h = harness(r, ledger);
    await roundState.reading();
    await h.recorder.state.reading();
    const beforeRound = ledger.head;

    const reviewer = "reviewer:code-reviewer";
    const run = "wf_round";
    await recordRound(
      { state: roundState, writer: async () => roundOut, settings: { max_audits: 3, k_topic: 2 } },
      { launched: { stage: INTERNAL, run, head: r.h }, expected: [reviewer], reports: new Map([[reviewer, { findings: [] }]]), assessment: null, findings: [] },
    );
    const afterRound = ledger.head;
    await recordCheck(h.recorder, claimCheck(r));

    const commits = commitsAsked(h.out);
    assert.equal(commits.length, 2);
    assert.equal(commits[0].expectedHeadOid, beforeRound);
    assert.equal(commits[1].expectedHeadOid, afterRound);
    const reading = await readStory(ledger);
    assert.ok(reading.snapshot?.rounds.some((each) => each.run === run));
    assert.equal(reading.snapshot?.gates?.anchor, r.h);
    assert.deepEqual(
      reading.snapshot?.holds.map(({ id, state }) => [id, state]),
      [[`${claim}-${CLAIM_ID}`, OPEN]],
    );
  });
});
