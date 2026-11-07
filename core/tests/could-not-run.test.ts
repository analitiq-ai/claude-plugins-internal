import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import type { Finding } from "../src/contracts/finding.ts";
import { gitHub, GitHubUnanswered, type GitHubClient } from "../src/github.ts";
import type { CouldNotRun, StatusAnswer } from "../src/outcomes.ts";
import type { Shared } from "../src/settings.ts";
import { findings, loadValidators, status } from "../src/validation/contract.ts";
import { requiredChecks } from "../src/validation/required-checks.ts";
import { reset, script } from "./fixtures/validators/fixture/index.ts";
import { fakeGitHub, type FakeAnswer } from "./support/fake-github.ts";

// Every "did not answer", `error` or throwing-module input gives COULD_NOT_RUN from both status and
// findings, never PASS, FAIL or an empty list.

const DIR = fileURLToPath(new URL("./fixtures/validators/", import.meta.url));

const REPO = "acme/widgets";
const PR = 31;
const HEAD = "a".repeat(40);
const WINDOW = { timeoutSeconds: 1800, since: "2026-10-28T10:00:00Z" };

const SHARED: Shared = {
  validators: ["fixture"],
  adr_folders: [],
  trusted_reviewers: ["alice"],
  board: "https://github.com/orgs/example-org/projects/1",
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};

const BASE_ANSWER = { repository: { pullRequest: { baseRefName: "main", headRefOid: HEAD, mergeable: "MERGEABLE" } } };
const RULES_PATH = "/repos/acme/widgets/rules/branches/main?per_page=100";
const RUNS_PATH = `/repos/acme/widgets/commits/${HEAD}/check-runs?check_name=ci&filter=latest&per_page=100`;
const STATUSES_PATH = `/repos/acme/widgets/commits/${HEAD}/statuses?per_page=100`;
const RULES = [
  {
    type: "required_status_checks",
    ruleset_source_type: "Repository",
    ruleset_source: REPO,
    ruleset_id: 7,
    parameters: { strict_required_status_checks_policy: false, required_status_checks: [{ context: "ci" }] },
  },
];

const ACTIONS = { id: 15368, slug: "github-actions" };
const NO_ANSWER = new GitHubUnanswered("GET: no answer within 15000 ms");

type Recorded = { base?: FakeAnswer; rules?: FakeAnswer; runs?: FakeAnswer; statuses?: FakeAnswer };

function recorded({ base = BASE_ANSWER, rules = RULES, runs = [], statuses = [] }: Recorded): GitHubClient {
  return fakeGitHub({
    graphql: [{ when: (query) => query.includes("baseRefName"), answer: base }],
    restPages: { [RULES_PATH]: rules, [STATUSES_PATH]: statuses },
    rest: { [`GET ${RUNS_PATH}`]: runs instanceof Error ? runs : { total_count: (runs as unknown[]).length, check_runs: runs } },
  });
}

function concluded(conclusion: string) {
  return [{ id: 1, name: "ci", head_sha: HEAD, status: "completed", conclusion, app: ACTIONS }];
}

type Answers = { status: StatusAnswer; findings: Finding[] | CouldNotRun };

async function fromRequiredChecks(client: GitHubClient): Promise<Answers> {
  const checks = requiredChecks(SHARED, client);
  return { status: await checks.status(REPO, PR, HEAD), findings: await checks.findings(REPO, PR, HEAD) };
}

// A local GitHub replaying recorded answers through the real client, so GitHub's own no-answer signals reach the
// reader as the client reads them.
async function served(t: TestContext, answer: (method: string, url: string, res: ServerResponse) => void): Promise<GitHubClient> {
  const server = createServer((req, res) => {
    req.resume();
    req.on("end", () => answer(req.method ?? "", req.url ?? "", res));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const { port } = server.address() as AddressInfo;
  return gitHub("dummy-token-0000", `http://127.0.0.1:${port}`);
}

function reply(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  res.writeHead(status, { "content-type": "application/json", ...headers });
  res.end(JSON.stringify(body));
}

async function fromFixture(): Promise<Answers> {
  const module = (await loadValidators(SHARED, DIR, { reader: fakeGitHub({}), writer: fakeGitHub({}), plugin: "reviewer" })).modules.get("fixture");
  assert.ok(module !== undefined);
  return { status: await status(module, REPO, PR, HEAD, WINDOW), findings: await findings(module, REPO, PR, HEAD) };
}

const TABLE: [string, (t: TestContext) => Promise<Answers>][] = [
  ["the required-checks reader: a check run concluded error", () => fromRequiredChecks(recorded({ runs: concluded("error") }))],
  ["the required-checks reader: a check run concluded cancelled", () => fromRequiredChecks(recorded({ runs: concluded("cancelled") }))],
  ["the required-checks reader: a check run concluded timed_out", () => fromRequiredChecks(recorded({ runs: concluded("timed_out") }))],
  [
    "the required-checks reader: a commit status in error",
    () => fromRequiredChecks(recorded({ statuses: [{ context: "ci", state: "error", creator: { login: "ci-bot[bot]" } }] })),
  ],
  ["the required-checks reader: GitHubUnanswered reading the PR's base", () => fromRequiredChecks(recorded({ base: NO_ANSWER }))],
  ["the required-checks reader: GitHubUnanswered reading the rules", () => fromRequiredChecks(recorded({ rules: NO_ANSWER }))],
  ["the required-checks reader: GitHubUnanswered reading the check runs", () => fromRequiredChecks(recorded({ runs: NO_ANSWER }))],
  ["the required-checks reader: GitHubUnanswered reading the statuses", () => fromRequiredChecks(recorded({ statuses: NO_ANSWER }))],
  [
    "the required-checks reader: a GraphQL RATE_LIMITED",
    async (t) =>
      fromRequiredChecks(
        await served(t, (_method, _url, res) =>
          reply(res, 200, { data: null, errors: [{ type: "RATE_LIMITED", message: "API rate limit exceeded" }] }),
        ),
      ),
  ],
  [
    "the required-checks reader: a REST rate limit, 403 with x-ratelimit-remaining 0",
    async (t) =>
      fromRequiredChecks(
        await served(t, (method, url, res) =>
          method === "POST" && url === "/graphql"
            ? reply(res, 200, { data: BASE_ANSWER })
            : reply(res, 403, { message: "API rate limit exceeded" }, { "x-ratelimit-remaining": "0" }),
        ),
      ),
  ],
  [
    "core's answers over the fixture package: it throws GitHubUnanswered",
    () => {
      script.status = { throws: NO_ANSWER };
      script.findings = { throws: NO_ANSWER };
      return fromFixture();
    },
  ],
  [
    "core's answers over the fixture package: it throws an Error",
    () => {
      script.status = { throws: new Error("the provider is down") };
      script.findings = { throws: new Error("the provider is down") };
      return fromFixture();
    },
  ],
];

beforeEach(() => {
  reset();
});

describe("could not run is COULD_NOT_RUN from both status and findings", () => {
  for (const [what, answers] of TABLE) {
    it(what, async (t) => {
      const answered = await answers(t);
      assert.equal(answered.status.outcome, "COULD_NOT_RUN", `status: ${JSON.stringify(answered.status)}`);
      assert.ok(answered.status.reason !== null && answered.status.reason.length > 0, "status names why");
      assert.ok(!Array.isArray(answered.findings), `findings: ${JSON.stringify(answered.findings)}`);
      assert.equal(answered.findings.outcome, "COULD_NOT_RUN");
      assert.ok(answered.findings.reason.length > 0, "findings name why");
    });
  }
});
