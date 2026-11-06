import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Finding } from "../src/contracts/finding.ts";
import { GitHubUnanswered } from "../src/github.ts";
import type { Shared } from "../src/settings.ts";
import { FindingsCouldNotRun, prFindings } from "../src/validation/pr-findings.ts";
import { threadsModule, type ProviderLogins } from "../src/validation/threads.ts";
import { importSpecifiers } from "./source-scan.ts";
import { fakeGitHub, type FakeAnswer, type FakeGitHub } from "./support/fake-github.ts";

const SOURCE = fileURLToPath(new URL("../src/validation/pr-findings.ts", import.meta.url));
const KEYS = fileURLToPath(new URL("../src/keys.ts", import.meta.url));

const REPO = "acme/widgets";
const PR = 31;
const HEAD = "a".repeat(40);

const SETTINGS: Shared = {
  validators: ["codex", "coderabbit"],
  adr_folders: [],
  trusted_reviewers: ["alice"],
  board: "https://github.com/orgs/example-org/projects/1",
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};

const CODEX_LOGIN = "chatgpt-codex-connector[bot]";
const LOGINS: ProviderLogins = { logins: new Set([CODEX_LOGIN]) };

type App = { id: number; slug: string };
// A check run's `app` gives the slug; `orchestrator_app_login` is the same App's REST login, `<slug>[bot]`.
const ORCHESTRATOR: App = { id: 77, slug: "codeworks-orchestrator" };
const ACTIONS: App = { id: 15368, slug: "github-actions" };
const IMPOSTOR: App = { id: 999, slug: "impostor" };

const ALICE_FINDING: Finding = {
  source: "threads",
  key: "thread:PRRT_alice",
  author: "alice",
  file: "src/app.ts",
  line: 12,
  text: "the cache key leaves out the tenant",
  thread_id: "PRRT_alice",
  resolvable: true,
  trusted_comments: [{ id: "PRRC_alice_1", author: "alice", body: "the cache key leaves out the tenant" }],
  latest_trusted_comment_id: "PRRC_alice_1",
};

type Author = { __typename: string; login: string };
const ALICE: Author = { __typename: "User", login: "alice" };
const CODEX_BOT: Author = { __typename: "Bot", login: "chatgpt-codex-connector" };

function thread(id: string, path: string, line: number, ...comments: [author: Author, body: string][]) {
  return {
    id,
    isResolved: false,
    path,
    line,
    comments: {
      nodes: comments.map(([author, body], i) => ({
        id: `${id.replace("PRRT", "PRRC")}_${i + 1}`,
        author,
        body,
        url: `https://github.com/${REPO}/pull/${PR}#discussion_r${i + 1}`,
      })),
      pageInfo: { hasNextPage: false },
    },
  };
}

const ALICE_THREAD = thread("PRRT_alice", "src/app.ts", 12, [ALICE, "the cache key leaves out the tenant"]);

function requiredCheckFinding(name: string, author: string): Finding {
  return {
    source: "required-checks",
    key: `required-check:${name}`,
    author,
    file: null,
    line: null,
    text: `the required check ${name} concluded failure`,
    thread_id: null,
    resolvable: false,
    trusted_comments: [],
    latest_trusted_comment_id: null,
  };
}

function moduleFinding(module: string): Finding {
  return {
    ...requiredCheckFinding(`${module}-review`, SETTINGS.orchestrator_app_login),
    source: module,
    key: `module-review:${module}`,
  };
}

let runIds = 0;

function run(name: string, conclusion: string | null, { status = "completed", app = ORCHESTRATOR } = {}) {
  runIds += 1;
  return { id: runIds, name, head_sha: HEAD, status, conclusion, app };
}

// A served repo's ruleset requires CI, internal-review and each module's <module>-review (SECURITY.md).
const RULES = [
  {
    type: "required_status_checks",
    ruleset_source_type: "Repository",
    ruleset_source: REPO,
    ruleset_id: 7,
    parameters: {
      strict_required_status_checks_policy: false,
      required_status_checks: ["ci", "internal-review", "codex-review", "coderabbit-review"].map((context) => ({ context })),
    },
  },
];

const RULES_PATH = "/repos/acme/widgets/rules/branches/main?per_page=100";
const STATUSES_PATH = `/repos/acme/widgets/commits/${HEAD}/statuses?per_page=100`;
const runsPath = (name: string): string =>
  `/repos/acme/widgets/commits/${HEAD}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest&per_page=100`;

/** Check runs by the name asked, or the error their read throws; a name with no entry is never read, so a read of it throws. */
type Runs = Record<string, ReturnType<typeof run>[] | Error>;

function reader(runs: Runs, threads: FakeAnswer = []): FakeGitHub {
  return fakeGitHub({
    graphql: [
      {
        when: (query) => query.includes("baseRefName"),
        answer: { repository: { pullRequest: { baseRefName: "main", headRefOid: HEAD, mergeable: "MERGEABLE" } } },
      },
    ],
    graphqlPages: [{ when: (query) => query.includes("reviewThreads"), answer: threads }],
    restPages: { [RULES_PATH]: RULES, [STATUSES_PATH]: [] },
    rest: Object.fromEntries(
      Object.entries(runs).map(([name, list]) => [
        `GET ${runsPath(name)}`,
        list instanceof Error ? list : { total_count: list.length, check_runs: list },
      ]),
    ),
  });
}

function readRuns(client: FakeGitHub): string[] {
  return client.calls.flatMap((call) => (call.kind === "rest" && call.path.includes("/check-runs?") ? [call.path] : []));
}

const CI_PASSED = run("ci", "success", { app: ACTIONS });
const CI_FAILED = run("ci", "failure", { app: ACTIONS });
const CI_FINDING = requiredCheckFinding("ci", `${ACTIONS.slug}[bot]`);

function findingsCouldNotRun(reason: RegExp): (thrown: unknown) => boolean {
  return (thrown) => thrown instanceof FindingsCouldNotRun && reason.test(thrown.message);
}

describe("prFindings: the required checks' and the threads' findings first", () => {
  it("returns a red required check's finding and a trusted thread's, reading no <module>-review", async () => {
    const client = reader({ ci: [CI_FAILED] }, [ALICE_THREAD]);
    const findings = await prFindings(client, REPO, PR, HEAD, SETTINGS, LOGINS);
    for (const finding of findings) assert.equal(Finding.safeParse(finding).success, true, JSON.stringify(finding));
    assert.deepEqual(findings, [CI_FINDING, ALICE_FINDING]);
    assert.deepEqual(readRuns(client), [runsPath("ci")]);
  });

  it("returns a red required check's finding alone when there is no thread, reading no <module>-review", async () => {
    const client = reader({ ci: [CI_FAILED] });
    assert.deepEqual(await prFindings(client, REPO, PR, HEAD, SETTINGS, LOGINS), [CI_FINDING]);
    assert.deepEqual(readRuns(client), [runsPath("ci")]);
  });

  it("returns a trusted thread's finding alone when every check passed, reading no <module>-review", async () => {
    const client = reader({ ci: [CI_PASSED] }, [ALICE_THREAD]);
    assert.deepEqual(await prFindings(client, REPO, PR, HEAD, SETTINGS, LOGINS), [ALICE_FINDING]);
    assert.deepEqual(readRuns(client), [runsPath("ci")]);
  });
});

describe("prFindings: with no required-check or thread finding, each [shared] validators module's <module>-review by the orchestrator's App", () => {
  it("reads a failed run as its module's one finding, with no thread", async () => {
    const findings = await prFindings(
      reader({ ci: [CI_PASSED], "codex-review": [run("codex-review", "failure")], "coderabbit-review": [run("coderabbit-review", "success")] }),
      REPO,
      PR,
      HEAD,
      SETTINGS,
      LOGINS,
    );
    for (const finding of findings) assert.equal(Finding.safeParse(finding).success, true, JSON.stringify(finding));
    assert.deepEqual(findings, [moduleFinding("codex")]);
  });

  for (const validators of [
    ["codex", "coderabbit"],
    ["coderabbit", "codex"],
  ]) {
    it(`reads each failed module's run, in [shared] validators order: ${validators.join(", ")}`, async () => {
      const runs = { ci: [CI_PASSED], "codex-review": [run("codex-review", "failure")], "coderabbit-review": [run("coderabbit-review", "failure")] };
      const findings = await prFindings(reader(runs), REPO, PR, HEAD, { ...SETTINGS, validators }, LOGINS);
      assert.deepEqual(findings, validators.map((module) => moduleFinding(module)));
    });
  }

  const none: [string, ReturnType<typeof run>[]][] = [
    ["passed", [run("codex-review", "success")]],
    ["queued", [run("codex-review", null, { status: "queued" })]],
    ["in progress", [run("codex-review", null, { status: "in_progress" })]],
    ["absent", []],
  ];
  for (const [what, codexRuns] of none) {
    it(`reads a run ${what} as no finding: nothing to do`, async () => {
      const runs = { ci: [CI_PASSED], "codex-review": codexRuns, "coderabbit-review": [] };
      assert.deepEqual(await prFindings(reader(runs), REPO, PR, HEAD, SETTINGS, LOGINS), []);
    });
  }

  it("ignores a run by another App: its failure is no finding, and the orchestrator's own run is the one read", async () => {
    const impostorOnly = { ci: [CI_PASSED], "codex-review": [run("codex-review", "failure", { app: IMPOSTOR })], "coderabbit-review": [] };
    assert.deepEqual(await prFindings(reader(impostorOnly), REPO, PR, HEAD, SETTINGS, LOGINS), []);
    // The impostor's run is the newer, and passed.
    const both = {
      ci: [CI_PASSED],
      "codex-review": [run("codex-review", "failure"), run("codex-review", "success", { app: IMPOSTOR })],
      "coderabbit-review": [],
    };
    assert.deepEqual(await prFindings(reader(both), REPO, PR, HEAD, SETTINGS, LOGINS), [moduleFinding("codex")]);
  });

  it("reads the modules [shared] validators lists and no other: an unlisted module's <module>-review is a required check", async () => {
    const shared = { ...SETTINGS, validators: ["codex"] };
    const failedCoderabbit = { ci: [CI_PASSED], "coderabbit-review": [run("coderabbit-review", "failure")] };
    assert.deepEqual(await prFindings(reader(failedCoderabbit), REPO, PR, HEAD, shared, LOGINS), [
      requiredCheckFinding("coderabbit-review", SETTINGS.orchestrator_app_login),
    ]);
    const client = reader({ ci: [CI_PASSED], "codex-review": [run("codex-review", "failure")], "coderabbit-review": [] });
    assert.deepEqual(await prFindings(client, REPO, PR, HEAD, shared, LOGINS), [moduleFinding("codex")]);
  });
});

describe("prFindings: throws FindingsCouldNotRun naming the read, never returning []", () => {
  for (const conclusion of ["cancelled", "timed_out", "stale"]) {
    it(`throws a module's reason when its <module>-review run concluded ${conclusion}, never reading it as a pass`, async () => {
      const runs = { ci: [CI_PASSED], "codex-review": [run("codex-review", conclusion)], "coderabbit-review": [] };
      await assert.rejects(prFindings(reader(runs), REPO, PR, HEAD, SETTINGS, LOGINS), findingsCouldNotRun(new RegExp(`^codex: codex-review concluded ${conclusion}$`)));
    });
  }

  it("throws a module's reason when GitHub gives no answer for its check runs, never reading it as no finding", async () => {
    const runs = { ci: [CI_PASSED], "codex-review": new GitHubUnanswered("the check runs"), "coderabbit-review": [] };
    await assert.rejects(prFindings(reader(runs), REPO, PR, HEAD, SETTINGS, LOGINS), findingsCouldNotRun(/^codex: the check runs$/));
  });

  it("throws required-checks' reason when the rules require no check but its own", async () => {
    const onlyOwn = fakeGitHub({
      graphql: [
        {
          when: (query) => query.includes("baseRefName"),
          answer: { repository: { pullRequest: { baseRefName: "main", headRefOid: HEAD, mergeable: "MERGEABLE" } } },
        },
      ],
      graphqlPages: [{ when: (query) => query.includes("reviewThreads"), answer: [] }],
      restPages: { [RULES_PATH]: [{ type: "required_status_checks", parameters: { required_status_checks: [{ context: "internal-review" }] } }] },
    });
    await assert.rejects(prFindings(onlyOwn, REPO, PR, HEAD, SETTINGS, LOGINS), findingsCouldNotRun(/^required-checks: the rules of main require no check but internal-review/));
  });

  it("throws threads' reason when GitHub gives no answer for the threads", async () => {
    const client = reader({ ci: [CI_PASSED] }, new GitHubUnanswered("the review threads"));
    await assert.rejects(prFindings(client, REPO, PR, HEAD, SETTINGS, LOGINS), findingsCouldNotRun(/^threads: the review threads$/));
  });
});

describe("prFindings: the threads as threadsModule reads them given the same logins", () => {
  it("leaves a provider's thread to its module and carries a provider's reply as trusted", async () => {
    const answered = thread("PRRT_alice", "src/app.ts", 12, [ALICE, "the cache key leaves out the tenant"], [CODEX_BOT, "confirmed"]);
    const threads = [answered, thread("PRRT_codex", "src/retry.ts", 3, [CODEX_BOT, "the retry budget is never reset"])];
    const findings = await prFindings(reader({ ci: [CI_PASSED] }, threads), REPO, PR, HEAD, SETTINGS, LOGINS);
    const direct = await threadsModule(SETTINGS, reader({}, threads), LOGINS).findings(REPO, PR, HEAD);
    assert.deepEqual(findings, direct);
    assert.deepEqual(
      findings.map((finding) => [finding.thread_id, finding.trusted_comments.map((comment) => comment.author)]),
      [["PRRT_alice", ["alice", CODEX_LOGIN]]],
    );
  });
});

describe("prFindings: with [shared] required_checks set", () => {
  it("grades each listed check and no other, and reads no rules (#174 R22)", async () => {
    const client = reader({
      lint: [run("lint", "failure", { app: ACTIONS })],
      build: [run("build", "failure", { app: ACTIONS })],
      ci: [CI_FAILED],
    });
    const findings = await prFindings(client, REPO, PR, HEAD, { ...SETTINGS, required_checks: ["lint", "build"] }, LOGINS);
    assert.deepEqual(findings, [requiredCheckFinding("lint", `${ACTIONS.slug}[bot]`), requiredCheckFinding("build", `${ACTIONS.slug}[bot]`)]);
    assert.deepEqual(readRuns(client), [runsPath("lint"), runsPath("build")]);
    assert.ok(!client.calls.some((call) => call.kind === "restPages" && call.path === RULES_PATH));
  });
});

describe("prFindings: what it is asked", () => {
  it("refuses a head that is not a commit sha before any GitHub read", async () => {
    const client = reader({});
    await assert.rejects(prFindings(client, REPO, PR, "main", SETTINGS, LOGINS), TypeError);
    assert.deepEqual(client.calls, []);
  });
});

describe("the source of pr-findings.ts", () => {
  it("names neither loadValidators nor readKey, and imports nothing from keys.ts: no validator package is opened", () => {
    const text = readFileSync(SOURCE, "utf8");
    assert.doesNotMatch(text, /\b(?:loadValidators|readKey)\b/);
    const fromKeys = importSpecifiers(text, "src/validation/pr-findings.ts").filter(
      ({ specifier }) => resolve(dirname(SOURCE), specifier) === KEYS,
    );
    assert.deepEqual(fromKeys, []);
  });
});
