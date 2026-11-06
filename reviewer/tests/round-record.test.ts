import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { addedFiles, at, commitsAsked, ISSUE, NOW, pushbackRuling, REPO, reader, round, SHARED, sha, snapshot, writer } from "../../core/tests/fixtures/state/issue.ts";
import { event, eventCommit, fakeLedger, fileOf, invalidCommit, storyDir, storyOf, type FakeLedger } from "../../core/tests/fixtures/state/ledger.ts";
import { importSpecifiers } from "../../core/tests/source-scan.ts";
import type { FakeGitHub } from "../../core/tests/support/fake-github.ts";
import { attests } from "../plugin/core/attest.ts";
import type { Finding } from "../plugin/core/contracts/finding.ts";
import { tamperId } from "../plugin/core/contracts/ledger.ts";
import type { Ruling, Snapshot } from "../plugin/core/contracts/snapshot.ts";
import { runGit } from "../plugin/core/git.ts";
import type { GitHubClient } from "../plugin/core/github.ts";
import { specBranch } from "../plugin/core/identity.ts";
import { readState, StateWriteRefused, type StateReading } from "../plugin/core/state.ts";
import { CoreSource, FindingRuling, HoldKind, HoldState, REQUIRED_CHECKS_SOURCE, RoundResult, RoundStage, RoundVerdict } from "../plugin/core/values.ts";
import { CouldNotRun } from "../plugin/lib/hook-io.ts";
import { DECISION_REVIEWER, recordRound, recordSpecPrRescope, type DecidedRun, type Recorder } from "../plugin/lib/round/record.ts";
import { RESHAPE_SPEC, type AssessedFinding, type Assessment, type AssessorVerdict } from "../plugin/lib/rules/rounds.ts";
import { RunState } from "../plugin/lib/run-state.ts";

const { INTERNAL, GITHUB, AUDIT } = RoundStage.schema.enum;
const { CLEAN, DIRTY, INCOMPLETE } = RoundResult.schema.enum;
const { PATCH, RESCOPE, ESCALATE, CONVERGED_PUSHBACK } = RoundVerdict.schema.enum;
const { FIX, PUSH_BACK, DEFER } = FindingRuling.schema.enum;
const { escalation, rescope, pushback, audit } = HoldKind.schema.enum;
const { OPEN } = HoldState.schema.enum;

// Not the repository's own values, so a constant in code shows.
const SETTINGS = { max_audits: 3, k_topic: 2 };

const ATTEMPTS = 3;
const ELSEWHERE = 7;
const CODE_REVIEWER = "reviewer:code-reviewer";
const EXPECTED = [CODE_REVIEWER, DECISION_REVIEWER];
const RUN = "wf_1a2b3c";
const ROUND_FILE = `${storyDir()}/${fileOf(event.round(round(1, { run: RUN })))}`;
const SPEC_ISSUE = 200;
const BOT = "chatgpt-codex-connector[bot]";

type Harness = { ledger: FakeLedger; out: FakeGitHub; recorder: Recorder };

/** A ledger holding one commit to another story, so its branch exists before the story's first event. */
function seeded(state: Snapshot | null = null): FakeLedger {
  const ledger = fakeLedger();
  eventCommit(ledger, [event.round(round(1))], { issue: ELSEWHERE });
  if (state !== null) storyOf(ledger, state);
  return ledger;
}

function stateOver(read: GitHubClient): RunState {
  return new RunState({ reader: read, repo: REPO, issue: ISSUE, shared: SHARED, attempts: ATTEMPTS });
}

/** A hook run's recorder over `ledger`, read as the session App reads it and written by the reviewer App's client. */
function harness(ledger: FakeLedger = seeded(), read: GitHubClient = reader({}, ledger)): Harness {
  const out = writer(ledger);
  return { ledger, out, recorder: { state: stateOver(read), writer: async () => out, settings: SETTINGS } };
}

function readStory(ledger: FakeLedger): Promise<StateReading> {
  return readState(reader({}, ledger), REPO, ISSUE, SHARED);
}

function holdsOf(reading: StateReading) {
  return reading.snapshot?.holds ?? [];
}

type Reports = DecidedRun["reports"];

function reportsOf(found: Partial<Record<string, string[]>> = {}): Reports {
  return new Map(EXPECTED.map((type) => [type, { findings: (found[type] ?? []).map((id) => ({ id })) }]));
}

function decided(fields: Partial<DecidedRun> = {}): DecidedRun {
  return { launched: { stage: INTERNAL, run: RUN, head: sha(700) }, expected: EXPECTED, reports: reportsOf(), assessment: null, findings: [], ...fields };
}

type Ruled = Pick<AssessedFinding, "id" | "verdict" | "reason">;

/** An assessment ruling `findings`, each of kind defect with its reason as its mechanism. */
function assessment(findings: Ruled[], round_verdict: AssessorVerdict): Assessment {
  return {
    findings: findings.map((each) => ({ ...each, kind: "defect", spec_ref: "n/a", mechanism: each.reason })),
    round_verdict,
    user_decision: null,
    rationale: "the spec names two owners for the header",
  };
}

/** An agents' round whose code reviewer found what `assessed` rules. */
function dirty(assessed: Assessment, fields: Partial<DecidedRun> = {}): DecidedRun {
  return decided({ reports: reportsOf({ [CODE_REVIEWER]: assessed.findings.map(({ id }) => id) }), assessment: assessed, ...fields });
}

const escalated = dirty(assessment([{ id: "F1", verdict: ESCALATE, reason: "the spec names two owners" }], ESCALATE));

describe("recordRound: one commit per decided run (qs #1, #2, #23)", () => {
  const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  const SPEC = `specs/${ISSUE}-widgets`;
  let scratch: string;
  let checkout: string;
  let head: string;

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "reviewer-record-"));
    checkout = join(scratch, "repo");
    const home = join(scratch, "home");
    mkdirSync(join(checkout, SPEC), { recursive: true });
    mkdirSync(home);
    // Git reads ignore and attribute files under HOME even with no global config; keep it off the real one.
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, ".config");
    writeFileSync(join(checkout, SPEC, "spec.md"), "spec\n");
    const git = async (args: string[]) => (await runGit(checkout, args)).stdout.trim();
    await git(["init", "-q", "-b", "main"]);
    await git(["add", "-A"]);
    await git(["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid", "commit", "-q", "-m", "root"]);
    head = await git(["rev-parse", "HEAD"]);
  });

  after(() => {
    process.env.HOME = savedEnv.HOME;
    process.env.XDG_CONFIG_HOME = savedEnv.XDG_CONFIG_HOME;
    rmSync(scratch, { recursive: true, force: true });
  });

  it("records a CLEAN round in one commit at the head it read, adding only round.<run>.json, and the round attests its head", async () => {
    const earlier = round(1, { run: "wf_earlier" });
    const h = harness(seeded(snapshot({ rounds: [earlier] })));
    const read = h.ledger.head;
    await recordRound(h.recorder, decided({ launched: { stage: INTERNAL, run: RUN, head } }));

    const [commit, ...more] = commitsAsked(h.out);
    assert.equal(more.length, 0);
    assert.equal(commit.expectedHeadOid, read);
    assert.deepEqual(Object.keys(addedFiles(commit)), [ROUND_FILE]);
    assert.equal(commit.fileChanges.deletions, undefined);

    const reading = await readStory(h.ledger);
    assert.deepEqual(reading.snapshot?.rounds, [earlier, { stage: INTERNAL, n: 2, run: RUN, head, result: CLEAN, verdict: null, root_cause: null, at: NOW }]);
    assert.deepEqual(await attests(checkout, reading, head, head, SPEC), { attested: true, reason: null });
  });

  it("records an ESCALATE round and its escalation-<issue> hold in one commit, and the story reads held", async () => {
    const h = harness();
    await recordRound(h.recorder, escalated);

    const [commit, ...more] = commitsAsked(h.out);
    assert.equal(more.length, 0);
    const files = Object.keys(addedFiles(commit));
    assert.equal(files.length, 2, files.join(", "));
    assert.ok(files.includes(ROUND_FILE), files.join(", "));
    assert.ok(
      files.some((file) => file.startsWith(`${storyDir()}/hold.${escalation}-${ISSUE}.`)),
      files.join(", "),
    );

    const reading = await readStory(h.ledger);
    assert.equal(reading.newest_round?.verdict, ESCALATE);
    assert.equal(reading.held, true);
    assert.deepEqual(reading.causes, [{ cause: "open_hold", id: `${escalation}-${ISSUE}` }]);
    const [row] = holdsOf(reading);
    assert.equal(row.state, OPEN);
    assert.equal(row.since, NOW);
    assert.match(row.question ?? "", /F1 was ruled ESCALATE: the spec names two owners/);
  });

  it("asks the reviewer client for ledger commits and GitHub's clock alone: no issue or PR comment", async () => {
    const h = harness();
    await recordRound(h.recorder, escalated);
    // commitsAsked fails on any call but a ledger commit or the clock.
    assert.equal(commitsAsked(h.out).length, 1);
  });

  it("records a run once: the same run recorded again commits nothing", async () => {
    const h = harness();
    const seededCommits = h.ledger.commits.length;
    await recordRound(h.recorder, escalated);
    const commits = h.ledger.commits.length;
    assert.equal(commits, seededCommits + 1);
    await recordRound(harness(h.ledger).recorder, escalated);
    assert.equal(h.ledger.commits.length, commits);
  });
});

describe("recordRound: refusals (qs #3, #4, #7, #8)", () => {
  it("refuses while an invalid commit stands under the story, naming it, the file it leaves and its release; nothing committed", async () => {
    const ledger = seeded();
    const oid = invalidCommit(ledger, { put: { "round.forged.json": "{}" } });
    const h = harness(ledger);
    await assert.rejects(recordRound(h.recorder, decided()), (error: unknown) => {
      assert.ok(error instanceof StateWriteRefused, String(error));
      assert.ok(error.message.includes(oid), error.message);
      assert.ok(error.message.includes(`${storyDir()}/round.forged.json`), error.message);
      assert.match(error.message, /deletion/);
      assert.ok(error.message.includes(`a Ready move on ${SHARED.board}`), error.message);
      assert.match(error.message, /an admin's comment/);
      return true;
    });
    assert.equal(commitsAsked(h.out).length, 0);
  });

  it("a hold it placed reads OPEN in a new session's state, and record.ts imports neither a file system module nor session.ts", async () => {
    const h = harness();
    await recordRound(h.recorder, escalated);
    const reading = await stateOver(reader({}, h.ledger)).reading();
    assert.deepEqual(
      holdsOf(reading).map(({ id, state }) => [id, state]),
      [[`${escalation}-${ISSUE}`, OPEN]],
    );
    const file = new URL("../plugin/lib/round/record.ts", import.meta.url);
    const specifiers = importSpecifiers(readFileSync(file, "utf8"), "record.ts").map(({ specifier }) => specifier);
    assert.deepEqual(
      specifiers.filter((specifier) => /^(node:)?fs(\/|$)/.test(specifier) || specifier.endsWith("/session.ts")),
      [],
    );
  });

  it("refuses as could not run naming the commit when GitHub does not sign it, which then holds the story", async () => {
    const h = harness();
    h.ledger.nextSignature = null;
    await assert.rejects(recordRound(h.recorder, decided()), (error: unknown) => {
      assert.ok(error instanceof CouldNotRun, String(error));
      assert.ok(error.message.includes(String(h.ledger.head)), error.message);
      return true;
    });
    assert.equal(commitsAsked(h.out).length, 1);
    const reading = await readStory(h.ledger);
    const tamper = tamperId(String(h.ledger.head));
    assert.deepEqual(
      reading.tamper.map(({ id }) => id),
      [tamper],
    );
    assert.equal(reading.held, true);
    assert.deepEqual(
      reading.causes.map(({ cause, id }) => [cause, id]),
      [["tampered", tamper]],
    );
  });

  it("refuses as could not run naming orchestrator README.md step 6 when there is no ledger branch; nothing created", async () => {
    const ledger = fakeLedger({ exists: false });
    const h = harness(ledger);
    await assert.rejects(recordRound(h.recorder, decided()), (error: unknown) => {
      assert.ok(error instanceof CouldNotRun, String(error));
      assert.match(error.message, /orchestrator README\.md step 6/);
      return true;
    });
    assert.equal(commitsAsked(h.out).length, 0);
    assert.equal(ledger.commits.length, 0);
  });
});

describe("recordRound: an agents' round's result, verdict and holds (ADR-0021 d4, ADR-0013 d4–d5)", () => {
  it("records INCOMPLETE, with no verdict and no hold, while an expected reviewer is silent", async () => {
    const h = harness();
    await recordRound(h.recorder, decided({ reports: new Map([[CODE_REVIEWER, { findings: [] }]]) }));
    const reading = await readStory(h.ledger);
    assert.deepEqual([reading.newest_round?.result, reading.newest_round?.verdict], [INCOMPLETE, null]);
    assert.deepEqual(holdsOf(reading), []);
  });

  it("records INCOMPLETE while the assessor of a round with findings is silent", async () => {
    const h = harness();
    await recordRound(h.recorder, decided({ reports: reportsOf({ [CODE_REVIEWER]: ["F1"] }), assessment: null }));
    assert.equal((await readStory(h.ledger)).newest_round?.result, INCOMPLETE);
  });

  it("records the assessor's fixing verdict and places no hold when a finding is ruled FIX", async () => {
    const h = harness();
    await recordRound(h.recorder, dirty(assessment([{ id: "F1", verdict: FIX, reason: "the parser takes null" }], PATCH)));
    const reading = await readStory(h.ledger);
    assert.deepEqual([reading.newest_round?.result, reading.newest_round?.verdict], [DIRTY, PATCH]);
    assert.deepEqual(holdsOf(reading), []);
  });

  for (const ruling of [PUSH_BACK, DEFER]) {
    it(`escalates a departure the decision reviewer reported and the assessor ruled ${ruling}`, async () => {
      const h = harness();
      const assessed = assessment([{ id: "D1", verdict: ruling, reason: "the ADR is old" }], CONVERGED_PUSHBACK);
      await recordRound(h.recorder, decided({ reports: reportsOf({ [DECISION_REVIEWER]: ["D1"] }), assessment: assessed }));
      const reading = await readStory(h.ledger);
      assert.equal(reading.newest_round?.verdict, ESCALATE);
      assert.match(holdsOf(reading)[0]?.question ?? "", /ADR departure D1/);
    });
  }

  it("does not escalate a departure ruled FIX, nor another reviewer's finding ruled PUSH_BACK", async () => {
    const fixed = harness();
    const ruledFix = assessment([{ id: "D1", verdict: FIX, reason: "the code departs" }], PATCH);
    await recordRound(fixed.recorder, decided({ reports: reportsOf({ [DECISION_REVIEWER]: ["D1"] }), assessment: ruledFix }));
    assert.equal((await readStory(fixed.ledger)).newest_round?.verdict, PATCH);

    const other = harness();
    const pushedBack = assessment([{ id: "F1", verdict: PUSH_BACK, reason: "not real" }], CONVERGED_PUSHBACK);
    await recordRound(other.recorder, decided({ reports: reportsOf({ [CODE_REVIEWER]: ["F1"] }), assessment: pushedBack }));
    const reading = await readStory(other.ledger);
    assert.equal(reading.newest_round?.verdict, CONVERGED_PUSHBACK);
    assert.deepEqual(holdsOf(reading), []);
  });

  it("records RESCOPE for RESHAPE_SPEC and places rescope-<issue> with its question and no spec PR", async () => {
    const h = harness();
    await recordRound(h.recorder, dirty(assessment([{ id: "F1", verdict: PUSH_BACK, reason: "the spec is silent" }], RESHAPE_SPEC)));
    const reading = await readStory(h.ledger);
    assert.equal(reading.newest_round?.verdict, RESCOPE);
    const [row] = holdsOf(reading);
    assert.deepEqual([row.id, row.state, row.spec_pr], [`${rescope}-${ISSUE}`, OPEN, null]);
    assert.match(row.question ?? "", /rescoped/);
    assert.match(row.question ?? "", /the spec names two owners for the header/);
  });

  describe("audit-<issue> at the max_audits-th unconverged audit", () => {
    const internal = [1, 2].map((n) => round(n, { run: `wf_internal-${n}`, result: DIRTY, verdict: PATCH }));
    const audits = (count: number) =>
      Array.from({ length: count }, (_, i) => round(i + 1, { stage: AUDIT, run: `wf_audit-${i + 1}`, result: DIRTY, verdict: PATCH, at: at("10:00") }));
    const audited = dirty(assessment([{ id: "F1", verdict: FIX, reason: "a second parser" }], PATCH), {
      launched: { stage: AUDIT, run: RUN, head: sha(700) },
    });

    it("places it on the max_audits-th, numbering the round after its own stage's rounds alone", async () => {
      const h = harness(seeded(snapshot({ rounds: [...internal, ...audits(SETTINGS.max_audits - 1)] })));
      await recordRound(h.recorder, audited);
      const reading = await readStory(h.ledger);
      assert.deepEqual([reading.newest_round?.stage, reading.newest_round?.n], [AUDIT, SETTINGS.max_audits]);
      assert.deepEqual(
        holdsOf(reading).map(({ id }) => id),
        [`${audit}-${ISSUE}`],
      );
    });

    it("places nothing before it", async () => {
      const h = harness(seeded(snapshot({ rounds: [...internal, ...audits(SETTINGS.max_audits - 2)] })));
      await recordRound(h.recorder, audited);
      assert.deepEqual(holdsOf(await readStory(h.ledger)), []);
    });
  });
});

/** A trusted reviewer's thread `id`, its latest trusted comment `comment`, as core's threads module reads it. */
function thread(id: string, comment: string): Finding {
  return {
    source: CoreSource.enum.threads,
    key: `thread:${id}`,
    author: BOT,
    file: "src/parse.ts",
    line: 4,
    text: "the parser takes a null header",
    thread_id: id,
    resolvable: true,
    trusted_comments: [{ id: comment, author: BOT, body: "the parser takes a null header" }],
    latest_trusted_comment_id: comment,
  };
}

/** A required check failing at the head, as core's required-checks module reads it. */
function failingCheck(name: string): Finding {
  return {
    source: REQUIRED_CHECKS_SOURCE,
    key: `required-check:${name}`,
    author: "github-actions",
    file: null,
    line: null,
    text: `the required check ${name} concluded failure`,
    thread_id: null,
    resolvable: false,
    trusted_comments: [],
    latest_trusted_comment_id: null,
  };
}

/** A github round opened on `findings`, each ruled as `rulings` says, with its key as its id in the assessment. */
function githubRound(findings: Finding[], rulings: Record<string, AssessedFinding["verdict"]>, verdict: AssessorVerdict): DecidedRun {
  const assessed = findings.map(({ key }) => ({ id: key, verdict: rulings[key], reason: `ruled ${rulings[key]} on the evidence` }));
  return decided({ launched: { stage: GITHUB, run: RUN, head: sha(700) }, expected: [], reports: new Map(), findings, assessment: assessment(assessed, verdict) });
}

describe("recordRound: a github round's rulings, pushbacks and holds (ADR-0016, ADR-0013 d4)", () => {
  const T1 = thread("PRRT_1", "IC_1");
  const CI = failingCheck("ci");

  it("records a ruling per finding, its reply only where a thread carries it, and a pushback per pushed-back finding with no thread", async () => {
    const h = harness();
    const LINT = failingCheck("lint");
    await recordRound(h.recorder, githubRound([T1, CI, LINT], { [T1.key]: PUSH_BACK, [CI.key]: PUSH_BACK, [LINT.key]: FIX }, PATCH));
    const reading = await readStory(h.ledger);
    const ruledAt = { stage: GITHUB, n: 1 };
    // The ledger files a ruling under its key's hash, so a reading lists one round's rulings in no key order.
    const byKey = (rulings: readonly Ruling[]) => rulings.toSorted((a, b) => a.key.localeCompare(b.key));
    assert.deepEqual(byKey(reading.snapshot?.rulings ?? []), byKey([
      { key: T1.key, round: ruledAt, ruling: PUSH_BACK, latest_trusted_comment_id: "IC_1", reply: `ruled ${PUSH_BACK} on the evidence`, commits: [] },
      { key: CI.key, round: ruledAt, ruling: PUSH_BACK, latest_trusted_comment_id: null, reply: null, commits: [] },
      { key: LINT.key, round: ruledAt, ruling: FIX, latest_trusted_comment_id: null, reply: null, commits: [] },
    ]));
    assert.deepEqual(reading.snapshot?.pushbacks, [{ key: CI.key, round: ruledAt }]);
    assert.deepEqual(holdsOf(reading), []);
  });

  it("places pushback-<issue> when the round rules no FIX while a required check fails at the head", async () => {
    const h = harness();
    await recordRound(h.recorder, githubRound([T1, CI], { [T1.key]: PUSH_BACK, [CI.key]: PUSH_BACK }, CONVERGED_PUSHBACK));
    const reading = await readStory(h.ledger);
    assert.equal(reading.newest_round?.verdict, CONVERGED_PUSHBACK);
    assert.deepEqual(
      holdsOf(reading).map(({ id, state }) => [id, state]),
      [[`${pushback}-${ISSUE}`, OPEN]],
    );
  });

  it("places no pushback hold when every finding pushed back is a thread, which the replies resolve", async () => {
    const h = harness();
    await recordRound(h.recorder, githubRound([T1], { [T1.key]: PUSH_BACK }, CONVERGED_PUSHBACK));
    assert.deepEqual(holdsOf(await readStory(h.ledger)), []);
  });

  it("escalates, naming the thread, when a trusted reply comes after k_topic rulings of it", async () => {
    const githubRounds = [1, 2].map((n) => round(n, { stage: GITHUB, run: `wf_github-${n}`, result: DIRTY, verdict: CONVERGED_PUSHBACK }));
    const ruled = (n: number): Ruling => ({ ...pushbackRuling(T1.key, n), round: { stage: GITHUB, n }, latest_trusted_comment_id: `IC_${n}` });
    const h = harness(seeded(snapshot({ rounds: githubRounds, rulings: [ruled(1), ruled(2)] })));
    const answered = thread("PRRT_1", "IC_3");
    await recordRound(h.recorder, githubRound([answered], { [answered.key]: PUSH_BACK }, CONVERGED_PUSHBACK));
    const reading = await readStory(h.ledger);
    assert.equal(reading.newest_round?.verdict, ESCALATE);
    const [row] = holdsOf(reading);
    assert.equal(row.id, `${escalation}-${ISSUE}`);
    assert.ok((row.question ?? "").includes(answered.key), row.question ?? "");
  });
});

describe("recordRound: an assessment that does not rule exactly the round's findings is refused; nothing committed", () => {
  const T1 = thread("PRRT_1", "IC_1");
  const CI = failingCheck("ci");
  const github = decided({ launched: { stage: GITHUB, run: RUN, head: sha(700) }, expected: [], reports: new Map(), findings: [T1, CI] });
  const ruling = (id: string): Ruled => ({ id, verdict: FIX, reason: "fixed" });
  const cases: [string, DecidedRun][] = [
    ["a github round's ruling of a finding it does not hold", { ...github, assessment: assessment([ruling(T1.key), ruling(CI.key), ruling("thread:PRRT_9")], PATCH) }],
    ["a github round's finding left unruled", { ...github, assessment: assessment([ruling(T1.key)], PATCH) }],
    ["an agents' round's ruling of a finding no reviewer reported", dirty(assessment([ruling("F1")], PATCH), { reports: reportsOf({ [CODE_REVIEWER]: ["F2"] }) })],
  ];

  for (const [what, run] of cases) {
    it(what, async () => {
      const h = harness();
      await assert.rejects(recordRound(h.recorder, run), TypeError);
      assert.equal(commitsAsked(h.out).length, 0);
    });
  }
});

type SpecPrNode = { number: number; closed: boolean; merged: boolean };

/** `base`, with the story's spec issue answered as `SPEC_ISSUE` and that spec's branch's PRs as `prs`. */
function withSpecPrs(base: GitHubClient, prs: SpecPrNode[]): GitHubClient {
  const repository = { id: "R_1", nameWithOwner: REPO };
  return {
    rest: (method, path, body) => base.rest(method, path, body),
    restPages: (path) => base.restPages(path),
    now: () => base.now(),
    graphql: async (query, vars) =>
      /\bparent\s*\{/.test(query) && vars.number === ISSUE
        ? { repository: { id: repository.id, issue: { parent: { number: SPEC_ISSUE, repository } } } }
        : base.graphql(query, vars),
    graphqlPages: async (query, vars, path) =>
      /\bpullRequests\(headRefName:/.test(query) && vars.branch === specBranch(SPEC_ISSUE)
        ? prs.map((pr) => ({ ...pr, headRefName: specBranch(SPEC_ISSUE), headRefOid: sha(pr.number), isCrossRepository: false }))
        : base.graphqlPages(query, vars, path),
  };
}

describe("recordSpecPrRescope (ADR-0013 d5)", () => {
  it("places rescope-<issue> recording the spec PR it sees open, with no question, once per spec PR", async () => {
    const ledger = seeded();
    const prs = [{ number: 301, closed: false, merged: false }];
    await recordSpecPrRescope(harness(ledger, withSpecPrs(reader({}, ledger), prs)).recorder);
    const [row] = holdsOf(await readStory(ledger));
    assert.deepEqual([row.id, row.state, row.spec_pr, row.question], [`${rescope}-${ISSUE}`, OPEN, 301, null]);

    const commits = ledger.commits.length;
    await recordSpecPrRescope(harness(ledger, withSpecPrs(reader({}, ledger), prs)).recorder);
    assert.equal(ledger.commits.length, commits);
  });

  const none: [string, SpecPrNode[]][] = [
    ["no spec PR", []],
    ["a closed spec PR", [{ number: 301, closed: true, merged: false }]],
    ["a merged spec PR", [{ number: 301, closed: true, merged: true }]],
  ];
  for (const [what, prs] of none) {
    it(`places nothing for ${what}`, async () => {
      const ledger = seeded();
      const h = harness(ledger, withSpecPrs(reader({}, ledger), prs));
      await recordSpecPrRescope(h.recorder);
      assert.equal(commitsAsked(h.out).length, 0);
    });
  }
});
