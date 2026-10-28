import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Finding } from "../src/contracts/finding.ts";
import { GitHubRefused } from "../src/github.ts";
import type { CouldNotRun, StatusAnswer } from "../src/outcomes.ts";
import type { Shared } from "../src/settings.ts";
import { loadValidators, type Validators } from "../src/validation/contract.ts";
import { requiredChecks } from "../src/validation/required-checks.ts";
import { fakeGitHub, type FakeAnswer, type FakeGitHub } from "./support/fake-github.ts";

const DIR = fileURLToPath(new URL("./fixtures/validators/", import.meta.url));

const REPO = "acme/widgets";
const PR = 31;
const HEAD = "a".repeat(40);

const SHARED: Shared = {
  validators: ["fixture"],
  trusted_reviewers: ["alice"],
  board: "https://github.com/orgs/example-org/projects/1",
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};

type App = { id: number; slug: string };
const ACTIONS: App = { id: 15368, slug: "github-actions" };
const IMPOSTOR: App = { id: 999, slug: "impostor" };

type RequiredCheck = { context: string; integration_id?: number };

function requiring(...checks: RequiredCheck[]) {
  return {
    type: "required_status_checks",
    ruleset_source_type: "Repository",
    ruleset_source: REPO,
    ruleset_id: 7,
    parameters: { strict_required_status_checks_policy: false, required_status_checks: checks },
  };
}

// A rule of another type, which holds no required check.
const NO_DELETION = { type: "deletion", ruleset_source_type: "Repository", ruleset_source: REPO, ruleset_id: 7 };

let runIds = 0;

function run(name: string, conclusion: string | null, { status = "completed", app = ACTIONS as App | null } = {}) {
  runIds += 1;
  return { id: runIds, name, head_sha: HEAD, status, conclusion, app };
}

function commitStatus(context: string, state: string, creator: string | null = "deploy-bot[bot]") {
  return { context, state, creator: creator === null ? null : { login: creator } };
}

const rulesPath = (base: string): string => `/repos/acme/widgets/rules/branches/${encodeURIComponent(base)}?per_page=100`;
const runsPath = (name: string): string =>
  `/repos/acme/widgets/commits/${HEAD}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest&per_page=100`;
const STATUSES_PATH = `/repos/acme/widgets/commits/${HEAD}/statuses?per_page=100`;

type Recorded = {
  base?: string;
  rules: FakeAnswer;
  /** Check runs by the name asked; a name with no entry is never read, so a read of it throws. */
  runs?: Record<string, ReturnType<typeof run>[]>;
  statuses?: FakeAnswer;
};

function reader({ base = "main", rules, runs = {}, statuses = [] }: Recorded): FakeGitHub {
  return fakeGitHub({
    graphql: [{ when: (query) => query.includes("baseRefName"), answer: { repository: { pullRequest: { baseRefName: base } } } }],
    restPages: { [rulesPath(base)]: rules, [STATUSES_PATH]: statuses },
    rest: Object.fromEntries(
      Object.entries(runs).map(([name, list]) => [`GET ${runsPath(name)}`, { total_count: list.length, check_runs: list }]),
    ),
  });
}

let validators: Validators;

before(async () => {
  validators = await loadValidators(SHARED, DIR, { reader: fakeGitHub({}), writer: fakeGitHub({}), plugin: "reviewer" });
});

async function answers(recorded: Recorded): Promise<{ status: StatusAnswer; findings: Finding[] | CouldNotRun; client: FakeGitHub }> {
  const client = reader(recorded);
  const checks = requiredChecks(SHARED, client, validators);
  return { status: await checks.status(REPO, PR, HEAD), findings: await checks.findings(REPO, PR, HEAD), client };
}

// A set: status and findings each read GitHub afresh.
function readPaths(client: FakeGitHub): Set<string> {
  return new Set(client.calls.flatMap((call) => (call.kind === "rest" || call.kind === "restPages" ? [call.path] : [])));
}

function assertCouldNotRun(answer: StatusAnswer | Finding[] | CouldNotRun, why: RegExp): void {
  assert.ok(!Array.isArray(answer), `expected COULD_NOT_RUN, got ${JSON.stringify(answer)}`);
  assert.equal(answer.outcome, "COULD_NOT_RUN");
  assert.ok(answer.reason !== null);
  assert.match(answer.reason, /^required-checks: /, "the reason names the reader");
  assert.match(answer.reason, why);
}

describe("the required checks come from the rules of the PR's base branch", () => {
  it("reads the base from the PR, then that branch's effective rules", async () => {
    const { status, client } = await answers({ base: "release", rules: [requiring({ context: "ci" })], runs: { ci: [run("ci", "success")] } });
    assert.deepEqual(status, { outcome: "PASS", reason: null });
    const [baseRead, rulesRead] = client.calls;
    assert.ok(baseRead.kind === "graphql");
    assert.deepEqual(baseRead.vars, { owner: "acme", name: "widgets", number: PR });
    assert.deepEqual(rulesRead, { kind: "restPages", path: rulesPath("release") });
  });

  it("puts a base branch with a slash into the rules path as one segment", async () => {
    const { client } = await answers({ base: "release/1.0", rules: [requiring({ context: "ci" })], runs: { ci: [run("ci", "success")] } });
    assert.ok(readPaths(client).has("/repos/acme/widgets/rules/branches/release%2F1.0?per_page=100"));
  });

  it("takes every required_status_checks rule, from every ruleset, and no other rule", async () => {
    const { status, findings } = await answers({
      rules: [NO_DELETION, requiring({ context: "ci" }), requiring({ context: "lint" })],
      runs: { ci: [run("ci", "success")], lint: [run("lint", "failure")] },
    });
    assert.equal(status.outcome, "FAIL");
    assert.ok(Array.isArray(findings));
    assert.deepEqual(findings.map((finding) => finding.key), ["required-check:lint"]);
  });

  it("AS6: leaves out internal-review and a loaded module's <module>-review, reading neither", async () => {
    const { status, client } = await answers({
      rules: [requiring({ context: "internal-review" }, { context: "fixture-review" }, { context: "ci" })],
      runs: { ci: [run("ci", "success")] },
    });
    assert.deepEqual(status, { outcome: "PASS", reason: null });
    assert.deepEqual(readPaths(client), new Set([rulesPath("main"), runsPath("ci"), STATUSES_PATH]));
  });

  it("keeps the <module>-review of a module that is not loaded", async () => {
    const { status } = await answers({ rules: [requiring({ context: "second-review" })], runs: { "second-review": [] } });
    assert.equal(status.outcome, "PENDING");
  });

  const nothingElse: [string, FakeAnswer][] = [
    ["only internal-review and fixture-review", [requiring({ context: "internal-review" }, { context: "fixture-review" })]],
    ["no required_status_checks rule", [NO_DELETION]],
    ["no rule at all", []],
  ];
  for (const [what, rules] of nothingElse) {
    it(`AS9: with ${what}, status and findings are COULD_NOT_RUN, and no check is read`, async () => {
      const { status, findings, client } = await answers({ rules });
      assertCouldNotRun(status, /main/);
      assertCouldNotRun(findings, /main/);
      assert.deepEqual(readPaths(client), new Set([rulesPath("main")]));
    });
  }
});

describe("a required check is matched at the head asked", () => {
  it("among check runs by its exact name", async () => {
    const { status } = await answers({
      rules: [requiring({ context: "ci" })],
      runs: { ci: [run("ci-nightly", "failure"), run("ci", "success")] },
    });
    assert.deepEqual(status, { outcome: "PASS", reason: null });
  });

  it("among check runs by name and App id when the rule pins integration_id", async () => {
    const pinned = requiring({ context: "ci", integration_id: ACTIONS.id });
    const ownPass = await answers({
      rules: [pinned],
      runs: { ci: [run("ci", "failure", { app: IMPOSTOR }), run("ci", "success", { app: ACTIONS })] },
    });
    assert.equal(ownPass.status.outcome, "PASS");

    const otherAppOnly = await answers({ rules: [pinned], runs: { ci: [run("ci", "success", { app: IMPOSTOR })] } });
    assert.equal(otherAppOnly.status.outcome, "PENDING");
  });

  it("among commit statuses by context, the newest status of that context", async () => {
    const { status } = await answers({
      rules: [requiring({ context: "deploy" })],
      runs: { deploy: [] },
      statuses: [commitStatus("deploy", "success"), commitStatus("deploy", "failure"), commitStatus("other", "failure")],
    });
    assert.deepEqual(status, { outcome: "PASS", reason: null });
  });

  it("among commit statuses by context alone, where the rule pins an App", async () => {
    const { status } = await answers({
      rules: [requiring({ context: "deploy", integration_id: ACTIONS.id })],
      runs: { deploy: [] },
      statuses: [commitStatus("deploy", "failure")],
    });
    assert.equal(status.outcome, "FAIL");
  });

  it("a check with neither a check run nor a status is PENDING, naming it", async () => {
    const { status, findings } = await answers({ rules: [requiring({ context: "ci" })], runs: { ci: [] } });
    assert.equal(status.outcome, "PENDING");
    assert.ok(status.reason !== null && status.reason.includes("ci"));
    assert.deepEqual(findings, []);
  });

  it("refuses a check-runs answer holding more runs than it gave, never reading part as the whole", async () => {
    const client = fakeGitHub({
      graphql: [{ when: (query) => query.includes("baseRefName"), answer: { repository: { pullRequest: { baseRefName: "main" } } } }],
      restPages: { [rulesPath("main")]: [requiring({ context: "ci" })], [STATUSES_PATH]: [] },
      rest: { [`GET ${runsPath("ci")}`]: { total_count: 101, check_runs: [run("ci", "success")] } },
    });
    await assert.rejects(requiredChecks(SHARED, client, validators).status(REPO, PR, HEAD), /101/);
  });
});

describe("AS6: a failed required check is one finding naming the check and its conclusion", () => {
  it("a check run concluded failure", async () => {
    const { findings } = await answers({ rules: [requiring({ context: "ci" })], runs: { ci: [run("ci", "failure")] } });
    assert.ok(Array.isArray(findings));
    assert.equal(findings.length, 1);
    const [finding] = findings;
    assert.equal(Finding.safeParse(finding).success, true);
    assert.deepEqual({ ...finding, text: undefined }, {
      source: "required-checks",
      key: "required-check:ci",
      author: "github-actions",
      file: null,
      line: null,
      text: undefined,
      thread_id: null,
      resolvable: false,
      trusted_comments: [],
      latest_trusted_comment_id: null,
    });
    assert.match(finding.text, /\bci\b/);
    assert.match(finding.text, /\bfailure\b/);
  });

  it("a commit status in failure, by its creator", async () => {
    const { findings } = await answers({
      rules: [requiring({ context: "deploy" })],
      runs: { deploy: [] },
      statuses: [commitStatus("deploy", "failure")],
    });
    assert.ok(Array.isArray(findings));
    assert.deepEqual(
      findings.map((finding) => [finding.key, finding.author]),
      [["required-check:deploy", "deploy-bot[bot]"]],
    );
    assert.match(findings[0].text, /\bdeploy\b.*\bfailure\b/);
  });

  it("one finding per failed check, none for a passing or pending one", async () => {
    const { findings } = await answers({
      rules: [requiring({ context: "ci" }, { context: "lint" }, { context: "docs" }, { context: "e2e" })],
      runs: {
        ci: [run("ci", "failure")],
        lint: [run("lint", "failure")],
        docs: [run("docs", "success")],
        e2e: [run("e2e", null, { status: "in_progress" })],
      },
    });
    assert.ok(Array.isArray(findings));
    assert.deepEqual(findings.map((finding) => finding.key), ["required-check:ci", "required-check:lint"]);
  });

  it("findings are COULD_NOT_RUN naming the checks when any check could not run, a failure beside it", async () => {
    const { findings } = await answers({
      rules: [requiring({ context: "ci" }, { context: "lint" })],
      runs: { ci: [run("ci", "failure")], lint: [run("lint", "cancelled")] },
    });
    assertCouldNotRun(findings, /\blint\b/);
  });
});

describe("status: any FAIL, else any COULD_NOT_RUN, all PASS, else PENDING", () => {
  const RULES = [requiring({ context: "a" }, { context: "b" }, { context: "c" })];
  const table: [string, Record<string, ReturnType<typeof run>[]>, string][] = [
    ["a failure beside a check that could not run", { a: [run("a", "failure")], b: [run("b", "timed_out")], c: [] }, "FAIL"],
    ["a check that could not run beside a pending one", { a: [run("a", "success")], b: [run("b", "cancelled")], c: [] }, "COULD_NOT_RUN"],
    ["every check passing, neutral and skipped among them", { a: [run("a", "success")], b: [run("b", "neutral")], c: [run("c", "skipped")] }, "PASS"],
    ["a pending check beside passing ones", { a: [run("a", "success")], b: [run("b", null, { status: "queued" })], c: [run("c", "success")] }, "PENDING"],
    ["one check's runs: a failure beside a pass", { a: [run("a", "success"), run("a", "failure")], b: [run("b", "success")], c: [run("c", "success")] }, "FAIL"],
  ];
  for (const [what, runs, outcome] of table) {
    it(`${what} is ${outcome}`, async () => {
      const { status } = await answers({ rules: RULES, runs });
      assert.equal(status.outcome, outcome);
      if (outcome === "PASS") assert.equal(status.reason, null);
      else assert.ok(status.reason !== null && status.reason.startsWith("required-checks: "));
    });
  }

  it("is never SILENT and reads no clock: a check pending however long stays PENDING", async () => {
    const { status, client } = await answers({ rules: [requiring({ context: "ci" })], runs: { ci: [run("ci", null, { status: "queued" })] } });
    assert.equal(status.outcome, "PENDING");
    assert.ok(client.calls.every((call) => call.kind !== "now"));
  });

  it("has no trigger", () => {
    assert.deepEqual(Object.keys(requiredChecks(SHARED, fakeGitHub({}), validators)).sort(), ["findings", "status"]);
  });
});

describe("what is not a check outcome propagates", () => {
  it("a refusal from GitHub, such as no PR, throws", async () => {
    const client = fakeGitHub({ graphql: [{ when: () => true, answer: new GitHubRefused(200, "POST /graphql: Could not resolve to a PullRequest") }] });
    await assert.rejects(requiredChecks(SHARED, client, validators).status(REPO, PR, HEAD), GitHubRefused);
    await assert.rejects(requiredChecks(SHARED, client, validators).findings(REPO, PR, HEAD), GitHubRefused);
  });

  const asks: [string, string, number, string][] = [
    ["a head that is no commit sha", REPO, PR, "../../pulls"],
    ["a repository that is no owner/name", "widgets", PR, HEAD],
    ["a PR that is no issue number", REPO, 0, HEAD],
  ];
  for (const [what, repo, pr, head] of asks) {
    it(`${what} throws before any read`, async () => {
      const client = reader({ rules: [requiring({ context: "ci" })], runs: { ci: [] } });
      const checks = requiredChecks(SHARED, client, validators);
      await assert.rejects(checks.status(repo, pr, head), TypeError);
      await assert.rejects(checks.findings(repo, pr, head), TypeError);
      assert.deepEqual(client.calls, []);
    });
  }
});
