import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { addedFiles, at, commitsAsked, gates, ISSUE, lineage, NOW, reader, releasedHold, REPO, round, SHARED, sha, snapshot, writer } from "../../core/tests/fixtures/state/issue.ts";
import { event, eventCommit, fakeLedger, fileOf, storyDir, storyOf, type FakeLedger } from "../../core/tests/fixtures/state/ledger.ts";
import { fakeGitHub, type FakeGitHub } from "../../core/tests/support/fake-github.ts";
import type { Bug, Lineage } from "../plugin/core/contracts/gates.ts";
import type { Hold, Snapshot } from "../plugin/core/contracts/snapshot.ts";
import { GhCredentialRefused, GitFailed } from "../plugin/core/git.ts";
import { GitHubRefused, GitHubUnanswered } from "../plugin/core/github.ts";
import { readState, type StateReading } from "../plugin/core/state.ts";
import { HoldKind, HoldState, RoundStage } from "../plugin/core/values.ts";
import { fetchFromClone, fromGitHub, type AnchorSources } from "../plugin/lib/check/bare-copy.ts";
import { Words } from "../plugin/lib/check/lineage.ts";
import { CouldNotRun, FIX_THEN_RETRY, RETRY } from "../plugin/lib/hook-io.ts";
import { GatesBranchMismatch, recordCheck, type CompletedCheck, type GatesRecorder } from "../plugin/lib/round/gates.ts";
import { recordRound } from "../plugin/lib/round/record.ts";
import { AnchorMissing } from "../plugin/lib/rules/anchor.ts";
import { checkRef, claimId, type Claim, type Verdict } from "../plugin/lib/rules/claim.ts";
import { lineageCount } from "../plugin/lib/rules/counts.ts";
import type { ShimCheck } from "../plugin/lib/rules/shim.ts";
import { RunState } from "../plugin/lib/run-state.ts";
import { cloneWith, git } from "./support/git.ts";
import { tempHome } from "./support/session.ts";

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

  it("asks a split lineage's claim-<id> question with one claim's line, words, failing case and evidence: of two claims, the one on the later line, though its id is the smaller", async (t) => {
    const r = repo(t);
    const ledger = seeded(snapshot({ gates: gates({ anchor: r.a, lineages: [wrongLineage(sha(11))] }) }));
    const wrongClaim = (quote: string, line: number, i: number): [Claim, Verdict] => [
      { id: claimId(FILE, quote), hunk: "h1", file: FILE, line, quote, category: "K1" },
      { ...WRONG_VERDICT, failing_case: `failing case ${i}`, assertions: [{ text: "it refuses", confirmed: false, evidence: `src/parse.ts:${10 + i}` }] },
    ];
    const [smaller, larger] = ["The parser refuses", "a null header."].toSorted((p, q) => (claimId(FILE, p) < claimId(FILE, q) ? -1 : 1));
    // Both halves stand on QUOTE_LINE_H; a claim's words are looked for from its line on, so one line above still finds them.
    const later = wrongClaim(smaller, QUOTE_LINE_H, 0);
    const earlier = wrongClaim(larger, QUOTE_LINE_H - 1, 1);
    const check = claimCheck(r, {
      claim: { claims: { [later[0].id]: later[0], [earlier[0].id]: earlier[0] }, verdicts: { [later[0].id]: later[1], [earlier[0].id]: earlier[1] } },
    });
    await recordCheck(harness(r, ledger).recorder, check);

    const [row, ...rows] = (await readStory(ledger)).snapshot?.holds ?? [];
    assert.equal(rows.length, 0);
    assert.equal(row.id, `${claim}-${CLAIM_ID}`);
    const question = row.question ?? "";
    for (const part of [`"${later[0].quote}" (${FILE}:${QUOTE_LINE_H})`, `Failing case: ${later[1].failing_case}`, `Evidence: ${later[1].assertions[0].evidence}`]) {
      assert.ok(question.includes(part), question);
    }
    for (const part of [`"${earlier[0].quote}"`, `${FILE}:${QUOTE_LINE_H - 1}`, earlier[1].failing_case ?? "", earlier[1].assertions[0].evidence]) {
      assert.ok(!question.includes(part), question);
    }
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

});

const TAKEN = "the section is carried to the head";
const MISSING = "AnchorMissing";
const RAW = "its TypeError, not a could-not-run";
const ANCHOR = sha(4096);
const UNABLE = `fatal: unable to access 'https://github.com/${REPO}/': `;
const NOT_ASKED = async (): Promise<boolean> => assert.fail("GitHub was asked");
const GITHUB_LACKS = new GitHubRefused(422, "No commit found for SHA");

/** A clone with FILE as commit `a` has it, in a commit of its own the copy lacks. */
const elsewhere = (t: TestContext) => cloneWith(t, { [FILE]: TEXT_A, "elsewhere.md": "elsewhere\n" });

/** `fromGitHub` over a GitHub answering the read of commit `anchor` with `answer`, its git fetch made by `fetch`. */
function gitHubOf(anchor: string, answer: unknown, fetch: (refspecs: readonly string[]) => Promise<void> = async () => assert.fail("GitHub fetched")) {
  const [owner, name] = REPO.split("/");
  return fromGitHub(fakeGitHub({ rest: { [`GET /repos/${REPO}/commits/${anchor}`]: answer } }), { owner, name }, fetch);
}

const failingFetch = (failure: Error) => async (): Promise<void> => {
  throw failure;
};

type Arranged = { anchor: string; sources: AnchorSources; named?: string[] };

/** The anchor only GitHub is asked for, the clone lacking it. */
function onGitHub(r: Repo, answer: unknown, fetch?: (refspecs: readonly string[]) => Promise<void>): Arranged {
  return { anchor: ANCHOR, named: fetch === undefined ? [] : [REPO, ANCHOR], sources: { copy: r.copy, clone: async () => false, github: gitHubOf(ANCHOR, answer, fetch) } };
}

/** Per source and what it answers: the check recorded, AnchorMissing, or the could-not-run's next step (contracts/refusals.md). */
const ANCHOR_ROWS: { what: string; outcome: string; arrange: (t: TestContext, r: Repo) => Arranged }[] = [
  {
    what: "the model's clone has the anchor",
    outcome: TAKEN,
    arrange: (t, r) => {
      const { clone, head } = elsewhere(t);
      return { anchor: head, sources: { copy: r.copy, clone: (anchor) => fetchFromClone(r.copy, clone, anchor), github: NOT_ASKED } };
    },
  },
  {
    what: "the clone lacks the anchor and GitHub has it",
    outcome: TAKEN,
    arrange: (t, r) => {
      const { clone, head } = elsewhere(t);
      const lacking = cloneWith(t, { "a.md": "a\n" }).clone;
      const fetch = async (refspecs: readonly string[]) => void git(r.copy, "fetch", "-q", clone, ...refspecs);
      return { anchor: head, sources: { copy: r.copy, clone: (anchor) => fetchFromClone(r.copy, lacking, anchor), github: gitHubOf(head, { sha: head }, fetch) } };
    },
  },
  {
    what: "the clone and GitHub lack the anchor",
    outcome: MISSING,
    arrange: (t, r) => {
      const lacking = cloneWith(t, { "a.md": "a\n" }).clone;
      return { anchor: ANCHOR, sources: { copy: r.copy, clone: (anchor) => fetchFromClone(r.copy, lacking, anchor), github: gitHubOf(ANCHOR, GITHUB_LACKS) } };
    },
  },
  {
    what: "the clone holds the anchor's sha as a file's blob and GitHub lacks it",
    outcome: MISSING,
    arrange: (t, r) => {
      const { clone, head } = elsewhere(t);
      const blob = git(clone, "rev-parse", `${head}:elsewhere.md`);
      return { anchor: blob, sources: { copy: r.copy, clone: (anchor) => fetchFromClone(r.copy, clone, anchor), github: gitHubOf(blob, GITHUB_LACKS) } };
    },
  },
  {
    what: "the clone is no repository, and GitHub is not asked",
    outcome: FIX_THEN_RETRY,
    arrange: (t, r) => {
      const noRepository = tempHome(t);
      return { anchor: ANCHOR, named: [noRepository, ANCHOR], sources: { copy: r.copy, clone: (anchor) => fetchFromClone(r.copy, noRepository, anchor), github: NOT_ASKED } };
    },
  },
  { what: "GitHub does not answer the read of the commit", outcome: RETRY, arrange: (_t, r) => onGitHub(r, new GitHubUnanswered("timed out")) },
  ...[403, 404].map((status) => ({
    what: `GitHub answers the read of the commit ${status}`,
    outcome: FIX_THEN_RETRY,
    arrange: (_t: TestContext, r: Repo) => onGitHub(r, new GitHubRefused(status, "refused")),
  })),
  // Each fails as git words it under LC_ALL=C.
  ...(
    [
      ["reaches no host", `${UNABLE}Could not resolve host: github.com`, RETRY],
      ["is answered 503", `${UNABLE}The requested URL returned error: 503`, RETRY],
      ["is answered 429", `${UNABLE}The requested URL returned error: 429`, RETRY],
      ["is answered 403", `${UNABLE}The requested URL returned error: 403`, FIX_THEN_RETRY],
      ["is answered 401", `fatal: Authentication failed for 'https://github.com/${REPO}/'`, FIX_THEN_RETRY],
      ["is answered 401 with no credential to send", "fatal: could not read Username for 'https://github.com': terminal prompts disabled", FIX_THEN_RETRY],
      ["is answered 404", `remote: Repository not found.\nfatal: repository 'https://github.com/${REPO}/' not found`, FIX_THEN_RETRY],
    ] as const
  ).map(([answered, stderr, outcome]) => ({
    what: `the fetch from GitHub ${answered}`,
    outcome,
    arrange: (_t: TestContext, r: Repo) => onGitHub(r, { sha: ANCHOR }, failingFetch(new GitFailed(["fetch"], 128, stderr))),
  })),
  {
    what: "the fetch from GitHub throws GhCredentialRefused",
    outcome: FIX_THEN_RETRY,
    // GhCredentialRefused reaches the could-not-run as core words it.
    arrange: (_t, r) => ({ ...onGitHub(r, { sha: ANCHOR }, failingFetch(new GhCredentialRefused("sets http.extraheader, a header sent beside gh's token"))), named: [] }),
  },
  { what: "the fetch from GitHub throws a TypeError", outcome: RAW, arrange: (_t, r) => onGitHub(r, { sha: ANCHOR }, failingFetch(new TypeError("a bug in the fetch"))) },
  {
    what: "the model's clone is no absolute path, and GitHub is not asked",
    outcome: RAW,
    arrange: (_t, r) => ({ anchor: ANCHOR, sources: { copy: r.copy, clone: (anchor) => fetchFromClone(r.copy, "relative/clone", anchor), github: NOT_ASKED } }),
  },
];

describe("recordCheck: where the anchor is found, and the refusal when it is not (contracts/gates-snapshot.md §Anchor); a refusal commits nothing", () => {
  for (const { what, outcome, arrange } of ANCHOR_ROWS) {
    it(`${what}: ${outcome}`, async (t) => {
      const r = repo(t);
      const { anchor, sources, named = [] } = arrange(t, r);
      const ledger = seeded(snapshot({ gates: gates({ anchor, lineages: [wrongLineage(sha(11))] }) }));
      const h = harness(r, ledger);
      const recorded = recordCheck({ ...h.recorder, sources }, claimCheck(r));
      if (outcome === TAKEN) {
        await recorded;
        assert.equal((await readStory(ledger)).snapshot?.gates?.anchor, r.h);
        return;
      }
      await assert.rejects(recorded, (error: unknown) => {
        if (outcome === MISSING) {
          assert.ok(error instanceof AnchorMissing, String(error));
          return true;
        }
        if (outcome === RAW) {
          assert.ok(error instanceof TypeError, String(error));
          assert.equal(git(r.copy, "for-each-ref", "refs/anchors/"), "");
          return true;
        }
        assert.ok(error instanceof CouldNotRun, String(error));
        assert.ok(error.message.endsWith(`; ${outcome}`), error.message);
        for (const part of [BRANCH, ...named]) assert.ok(error.message.includes(part), error.message);
        return true;
      });
      assert.equal(commitsAsked(h.out).length, 0);
    });
  }
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
