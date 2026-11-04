import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Finding } from "../src/contracts/finding.ts";
import type { Shared } from "../src/settings.ts";
import { prFindings } from "../src/validation/pr-findings.ts";
import { importSpecifiers } from "./source-scan.ts";
import { fakeGitHub, type FakeGitHub } from "./support/fake-github.ts";

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

type App = { id: number; slug: string };
// A check run's `app` gives the slug; `orchestrator_app_login` is the same App's REST login, `<slug>[bot]`.
const ORCHESTRATOR: App = { id: 77, slug: "codeworks-orchestrator" };
const ACTIONS: App = { id: 15368, slug: "github-actions" };
const IMPOSTOR: App = { id: 999, slug: "impostor" };

const CODEX_FINDING: Finding = {
  source: "codex",
  key: "thread:PRRT_codex",
  author: "chatgpt-codex-connector[bot]",
  file: "src/retry.ts",
  line: 3,
  text: "the retry budget is never reset",
  thread_id: "PRRT_codex",
  resolvable: true,
  trusted_comments: [{ id: "PRRC_codex_1", author: "chatgpt-codex-connector[bot]", body: "the retry budget is never reset" }],
  latest_trusted_comment_id: "PRRC_codex_1",
};

const CODERABBIT_FINDING: Finding = {
  source: "coderabbit",
  key: "coderabbit:src/cache.ts:8",
  author: "coderabbitai[bot]",
  file: "src/cache.ts",
  line: 8,
  text: "the cache key leaves out the locale",
  thread_id: null,
  resolvable: false,
  trusted_comments: [],
  latest_trusted_comment_id: null,
};

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

const ALICE_THREAD = {
  id: "PRRT_alice",
  isResolved: false,
  path: "src/app.ts",
  line: 12,
  comments: {
    nodes: [
      {
        id: "PRRC_alice_1",
        author: { __typename: "User", login: "alice" },
        body: "the cache key leaves out the tenant",
        url: `https://github.com/${REPO}/pull/${PR}#discussion_r1`,
      },
    ],
    pageInfo: { hasNextPage: false },
  },
};

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

let runIds = 0;

function run(name: string, conclusion: string | null, { status = "completed", app = ORCHESTRATOR, findings = [] as Finding[] } = {}) {
  runIds += 1;
  return {
    id: runIds,
    name,
    head_sha: HEAD,
    status,
    conclusion,
    app,
    output: { title: conclusion ?? status, summary: "", text: JSON.stringify(findings) },
  };
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

/** Check runs by the name asked; a name with no entry is never read, so a read of it throws. */
type Runs = Record<string, ReturnType<typeof run>[]>;

function reader(runs: Runs): FakeGitHub {
  return fakeGitHub({
    graphql: [
      {
        when: (query) => query.includes("baseRefName"),
        answer: { repository: { pullRequest: { baseRefName: "main", headRefOid: HEAD, mergeable: "MERGEABLE" } } },
      },
    ],
    graphqlPages: [{ when: (query) => query.includes("reviewThreads"), answer: [ALICE_THREAD] }],
    restPages: { [RULES_PATH]: RULES, [STATUSES_PATH]: [] },
    rest: Object.fromEntries(
      Object.entries(runs).map(([name, list]) => [`GET ${runsPath(name)}`, { total_count: list.length, check_runs: list }]),
    ),
  });
}

function read(runs: Runs, settings: Shared = SETTINGS): Promise<Finding[]> {
  return prFindings(reader(runs), REPO, PR, HEAD, settings);
}

// T016 names the sources, not an order across them, so findings are compared in one order.
function inKeyOrder(findings: readonly Finding[]): Finding[] {
  return [...findings].sort((a, b) => `${a.source} ${a.key}`.localeCompare(`${b.source} ${b.key}`));
}

async function assertThrowsNaming(answer: Promise<Finding[]>, module: string, other: string): Promise<void> {
  await assert.rejects(answer, (error: unknown) => {
    assert.ok(error instanceof Error, `expected an Error, got ${String(error)}`);
    // The fake's refusal of an unrouted read quotes its path, which names the module too.
    assert.doesNotMatch(error.message, /^fake GitHub/);
    assert.match(error.message, new RegExp(`\\b${module}\\b`));
    assert.doesNotMatch(error.message, new RegExp(`\\b${other}\\b`));
    return true;
  });
}

const CI_PASSED = run("ci", "success", { app: ACTIONS });
const CODERABBIT_PASSED = run("coderabbit-review", "success");

describe("prFindings reads the head's findings from the required checks, the modules' check runs and the threads", () => {
  it("returns the required checks' findings, each module's from its <module>-review by the orchestrator's App, and the threads module's", async () => {
    const findings = await read({
      ci: [run("ci", "failure", { app: ACTIONS })],
      "codex-review": [run("codex-review", "failure", { findings: [CODEX_FINDING] })],
      "coderabbit-review": [run("coderabbit-review", "failure", { findings: [CODERABBIT_FINDING] })],
    });
    for (const finding of findings) assert.equal(Finding.safeParse(finding).success, true, JSON.stringify(finding));
    assert.deepEqual(
      inKeyOrder(findings),
      inKeyOrder([requiredCheckFinding("ci", `${ACTIONS.slug}[bot]`), CODEX_FINDING, CODERABBIT_FINDING, ALICE_FINDING]),
    );
  });
});

describe("a module's <module>-review absent or pending at the head throws naming the module", () => {
  for (const [module, other] of [["codex", "coderabbit"], ["coderabbit", "codex"]]) {
    const unread: [string, ReturnType<typeof run>[]][] = [
      ["absent", []],
      ["queued", [run(`${module}-review`, null, { status: "queued" })]],
      ["in progress", [run(`${module}-review`, null, { status: "in_progress" })]],
    ];
    for (const [what, moduleRuns] of unread) {
      it(`with ${module}-review ${what}, throws naming ${module}, never returning []`, async () => {
        const runs = { ci: [CI_PASSED], [`${module}-review`]: moduleRuns, [`${other}-review`]: [run(`${other}-review`, "success")] };
        await assertThrowsNaming(read(runs), module, other);
      });
    }
  }
});

describe("a codex-review check run by another App is ignored", () => {
  it("throws naming codex when its only codex-review is another App's", async () => {
    await assertThrowsNaming(
      read({
        ci: [CI_PASSED],
        "codex-review": [run("codex-review", "success", { app: IMPOSTOR })],
        "coderabbit-review": [CODERABBIT_PASSED],
      }),
      "codex",
      "coderabbit",
    );
  });

  it("leaves out the findings in another App's codex-review", async () => {
    const findings = await read({
      ci: [CI_PASSED],
      "codex-review": [run("codex-review", "failure", { app: IMPOSTOR, findings: [CODEX_FINDING] }), run("codex-review", "success")],
      "coderabbit-review": [CODERABBIT_PASSED],
    });
    assert.deepEqual(findings, [ALICE_FINDING]);
  });
});

describe("a <module>-review whose module [shared] validators does not list", () => {
  it("reads as a module only a [shared] validators entry: an unlisted module's <module>-review is graded as a required check", async () => {
    const findings = await read(
      {
        ci: [CI_PASSED],
        "codex-review": [run("codex-review", "failure", { findings: [CODEX_FINDING] })],
        "coderabbit-review": [run("coderabbit-review", "failure", { findings: [CODERABBIT_FINDING] })],
      },
      { ...SETTINGS, validators: ["codex"] },
    );
    assert.deepEqual(
      inKeyOrder(findings),
      inKeyOrder([CODEX_FINDING, requiredCheckFinding("coderabbit-review", SETTINGS.orchestrator_app_login), ALICE_FINDING]),
    );
  });
});

describe("the source of pr-findings.ts", () => {
  it("names neither loadValidators nor readKey, and imports nothing from keys.ts", () => {
    const text = readFileSync(SOURCE, "utf8");
    assert.doesNotMatch(text, /\b(?:loadValidators|readKey)\b/);
    const fromKeys = importSpecifiers(text, "src/validation/pr-findings.ts").filter(
      ({ specifier }) => resolve(dirname(SOURCE), specifier) === KEYS,
    );
    assert.deepEqual(fromKeys, []);
  });
});
