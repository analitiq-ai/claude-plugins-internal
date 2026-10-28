import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { Finding } from "../src/contracts/finding.ts";
import { GitHubUnanswered, type GitHubClient } from "../src/github.ts";
import { KeyReadRefused, type Machine } from "../src/keys.ts";
import type { CouldNotRun, StatusAnswer } from "../src/outcomes.ts";
import type { Shared } from "../src/settings.ts";
import {
  findings,
  loadValidators,
  status,
  trigger,
  ValidatorLoadError,
  type Module,
  type Validators,
} from "../src/validation/contract.ts";
import { reset, script } from "./fixtures/validators/fixture/index.ts";
import { fakeGitHub, type FakeAnswer, type FakeGitHub } from "./support/fake-github.ts";

const DIR = fileURLToPath(new URL("./fixtures/validators/", import.meta.url));

const REPO = "acme/widgets";
const PR = 31;
const HEAD = "a".repeat(40);
const OTHER_HEAD = "b".repeat(40);

const SHARED: Shared = {
  validators: ["fixture"],
  trusted_reviewers: ["alice"],
  board: "https://github.com/orgs/example-org/projects/1",
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};
const APP_LOGINS = [
  SHARED.session_app_login,
  SHARED.orchestrator_app_login,
  SHARED.reviewer_app_login,
  SHARED.planner_app_login,
];

// review_timeout's default, 30 minutes, counted from a start the caller passes.
const TIMEOUT = 1800;
const SINCE = "2026-10-28T10:00:00Z";
const AT_TIMEOUT = "2026-10-28T10:30:00Z";
const BEFORE_TIMEOUT = "2026-10-28T10:29:59Z";
const WINDOW = { timeoutSeconds: TIMEOUT, since: SINCE };

type Author = { __typename: string; login: string };

// GraphQL names an App as a `Bot` by its bare login.
const FIXTURE_BOT: Author = { __typename: "Bot", login: "fixture-bot" };
const ALICE: Author = { __typename: "User", login: "alice" };

function threadNode(thread: string, author: Author, body: string) {
  return {
    id: `PRRT_${thread}`,
    isResolved: false,
    path: "src/app.ts",
    line: 12,
    comments: {
      nodes: [{ id: `PRRC_${thread}_1`, author, body, url: `https://github.com/${REPO}/pull/${PR}#discussion_${thread}` }],
      pageInfo: { hasNextPage: false },
    },
  };
}

const PROVIDER_THREAD = threadNode("fixture", FIXTURE_BOT, "the retry budget is never reset");
const ALICE_THREAD = threadNode("alice", ALICE, "the cache key leaves out the tenant");

const PROVIDER_FINDING: Finding = {
  source: "fixture",
  key: "thread:PRRT_fixture",
  author: "fixture-bot[bot]",
  file: "src/app.ts",
  line: 12,
  text: "the retry budget is never reset",
  thread_id: "PRRT_fixture",
  resolvable: true,
  trusted_comments: [{ id: "PRRC_fixture_1", author: "fixture-bot[bot]", body: "the retry budget is never reset" }],
  latest_trusted_comment_id: "PRRC_fixture_1",
};

// A provider's item that is no thread, keyed `<module>:<id>`.
const ITEM: Finding = {
  source: "fixture",
  key: "fixture:issue-7",
  author: "fixture-bot[bot]",
  file: "src/app.ts",
  line: 3,
  text: "an unchecked index",
  thread_id: null,
  resolvable: false,
  trusted_comments: [],
  latest_trusted_comment_id: null,
};

function reader({ threads = [] as FakeAnswer, now = BEFORE_TIMEOUT as FakeAnswer } = {}): FakeGitHub {
  return fakeGitHub({
    graphqlPages: [{ when: (query) => query.includes("reviewThreads"), answer: threads }],
    now,
  });
}

// A writer whose clock, were it read for SILENT, would give the other answer from the reader's.
function writer(): FakeGitHub {
  return fakeGitHub({ now: SINCE });
}

async function load(
  validators: string[],
  clients: { reader?: GitHubClient; writer?: GitHubClient; plugin?: string; machine?: Machine } = {},
): Promise<Validators> {
  return loadValidators({ ...SHARED, validators }, DIR, {
    reader: clients.reader ?? reader(),
    writer: clients.writer ?? writer(),
    plugin: clients.plugin ?? "reviewer",
    machine: clients.machine,
  });
}

async function fixtureModule(clients: Parameters<typeof load>[1] = {}): Promise<Module> {
  const module = (await load(["fixture"], clients)).modules.get("fixture");
  assert.ok(module !== undefined);
  return module;
}

async function refusal(validators: string[]): Promise<ValidatorLoadError> {
  try {
    await load(validators);
  } catch (error) {
    assert.ok(error instanceof ValidatorLoadError, `expected ValidatorLoadError, got ${String(error)}`);
    return error;
  }
  assert.fail(`loading ${JSON.stringify(validators)} did not throw`);
}

function assertCouldNotRun(answer: StatusAnswer | Finding[] | CouldNotRun | undefined, why: RegExp): void {
  assert.ok(answer !== undefined && !Array.isArray(answer), `expected COULD_NOT_RUN, got ${JSON.stringify(answer)}`);
  assert.equal(answer.outcome, "COULD_NOT_RUN");
  assert.ok(answer.reason !== null);
  assert.match(answer.reason, /^fixture: /, "the reason names the module");
  assert.match(answer.reason, why);
}

beforeEach(() => {
  reset();
});

describe("loading the packages [shared] validators lists", () => {
  it("loads the fixture as the one module, its provider's logins among the validators' logins", async () => {
    const validators = await load(["fixture"]);
    assert.deepEqual([...validators.modules.keys()], ["fixture"]);
    assert.deepEqual(validators.logins, new Set(["fixture-bot[bot]"]));
  });

  it("loads nothing, and refuses nothing, for an empty list", async () => {
    const validators = await load([]);
    assert.equal(validators.modules.size, 0);
    assert.equal(validators.logins.size, 0);
  });

  it("opens each package once and calls none of its functions while loading", async () => {
    await load(["fixture"]);
    assert.equal(script.opened.length, 1);
    assert.deepEqual(script.calls, []);
  });

  it("refuses a listed name with no package folder, naming it", async () => {
    const error = await refusal(["nope"]);
    assert.equal(error.entry, "nope");
    assert.match(error.message, /"nope"/);
    assert.match(error.why, /no package folder/);
  });

  for (const name of ["Bad_Name", "threads", "required-checks"]) {
    it(`refuses ${JSON.stringify(name)}, outside the module-name grammar, before looking for a folder`, async () => {
      const error = await refusal([name]);
      assert.equal(error.entry, name);
      assert.match(error.message, new RegExp(`"${name}"`));
      assert.match(error.why, /not a module name/);
    });
  }

  it("refuses a package whose open returns no status, naming the part", async () => {
    const error = await refusal(["no-status"]);
    assert.equal(error.entry, "no-status");
    assert.match(error.why, /status/);
  });

  it("refuses a package whose logins is not a list, naming the export", async () => {
    const error = await refusal(["bad-logins"]);
    assert.equal(error.entry, "bad-logins");
    assert.match(error.why, /logins/);
  });

  it("refuses a package folder with no index.ts", async () => {
    const dir = mkdtempSync(join(tmpdir(), "core-validators-"));
    try {
      mkdirSync(join(dir, "empty"));
      await assert.rejects(
        loadValidators({ ...SHARED, validators: ["empty"] }, dir, { reader: reader(), writer: writer(), plugin: "reviewer" }),
        (error) => error instanceof ValidatorLoadError && error.entry === "empty" && /index\.ts/.test(error.why),
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("refuses the list at its first bad entry, after the good ones", async () => {
    const error = await refusal(["fixture", "nope"]);
    assert.equal(error.entry, "nope");
  });

  it("hands open the caller's reader and writer", async () => {
    const [ownReader, ownWriter] = [reader(), writer()];
    await load(["fixture"], { reader: ownReader, writer: ownWriter });
    const [deps] = script.opened;
    assert.equal(deps.reader, ownReader);
    assert.equal(deps.writer, ownWriter);
  });

  describe("hands open a readKey bound to the caller's plugin", () => {
    const home = "/home/dummy";
    const keyBytes = Buffer.from("-----BEGIN DUMMY KEY-----\n");
    const notFound = (path: string): never => {
      throw Object.assign(new Error(`ENOENT: ${path}`), { code: "ENOENT" });
    };
    // Every read goes through this machine, so no test reads /etc or a real home folder. The key itself is
    // owner-only; the managed settings file is absent.
    const machine: Machine = {
      platform: "linux",
      uid: 1000,
      home,
      stat: (path) => (path === `${home}/.config/codeworks/planner-app.pem` ? { uid: 1000, mode: 0o100600 } : notFound(path)),
      lstat: notFound,
      readText: notFound,
      readBytes: (path) => (path === `${home}/.config/codeworks/planner-app.pem` ? keyBytes : notFound(path)),
    };

    it("reads planner's own key, the one read exempt from the managed settings, when the caller is planner", async () => {
      await load(["fixture"], { plugin: "planner", machine });
      assert.deepEqual(script.opened[0].readKey("planner-app.pem"), keyBytes);
    });

    it("holds the same read to the managed settings when the caller is another plugin", async () => {
      await load(["fixture"], { plugin: "reviewer", machine });
      assert.throws(
        () => script.opened[0].readKey("planner-app.pem"),
        (error) => error instanceof KeyReadRefused && /managed-settings\.json does not exist/.test(error.message),
      );
    });
  });

  describe("hands open providerThreads", () => {
    it("gives the unresolved threads its own logins started as findings with its name as source", async () => {
      const client = reader({ threads: [PROVIDER_THREAD, ALICE_THREAD] });
      await load(["fixture"], { reader: client });
      assert.deepEqual(await script.opened[0].providerThreads(REPO, PR), [PROVIDER_FINDING]);
      const [call] = client.calls;
      assert.ok(call.kind === "graphqlPages");
      assert.deepEqual(call.vars, { owner: "acme", name: "widgets", number: PR });
    });
  });
});

describe("a status is PASS or FAIL only for the head asked", () => {
  for (const outcome of ["PASS", "FAIL"]) {
    it(`gives ${outcome} naming the head asked as ${outcome}, with the package's reason`, async () => {
      script.status = { answer: { outcome, head: HEAD, reason: "read at the head" } };
      const module = await fixtureModule();
      assert.deepEqual(await status(module, REPO, PR, HEAD, WINDOW), { outcome, reason: "read at the head" });
      assert.deepEqual(script.calls, [{ fn: "status", repo: REPO, pr: PR, head: HEAD }]);
    });

    it(`gives ${outcome} naming another head as PENDING`, async () => {
      script.status = { answer: { outcome, head: OTHER_HEAD, reason: null } };
      const answer = await status(await fixtureModule(), REPO, PR, HEAD, WINDOW);
      assert.equal(answer.outcome, "PENDING");
    });

    it(`gives ${outcome} naming no head as PENDING`, async () => {
      script.status = { answer: { outcome, head: null, reason: null } };
      const answer = await status(await fixtureModule(), REPO, PR, HEAD, WINDOW);
      assert.equal(answer.outcome, "PENDING");
    });
  }

  it("gives WAIVED as WAIVED, with the package's reason, whatever head it names", async () => {
    script.status = { answer: { outcome: "WAIVED", head: null, reason: "out of credits" } };
    assert.deepEqual(await status(await fixtureModule(), REPO, PR, HEAD, WINDOW), {
      outcome: "WAIVED",
      reason: "out of credits",
    });
  });

  it("gives WAIVED with no reason as WAIVED, with a reason naming the module", async () => {
    script.status = { answer: { outcome: "WAIVED", head: null, reason: null } };
    const answer = await status(await fixtureModule(), REPO, PR, HEAD, WINDOW);
    assert.equal(answer.outcome, "WAIVED");
    assert.ok(answer.reason !== null && answer.reason.startsWith("fixture"));
  });
});

describe("a PENDING module is SILENT once the timeout has run from the caller's start", () => {
  it("is SILENT when now − since reaches timeoutSeconds", async () => {
    script.status = { answer: { outcome: "PENDING", head: null, reason: null } };
    const answer = await status(await fixtureModule({ reader: reader({ now: AT_TIMEOUT }) }), REPO, PR, HEAD, WINDOW);
    assert.equal(answer.outcome, "SILENT");
    assert.ok(answer.reason !== null && answer.reason.startsWith("fixture"));
  });

  it("is PENDING a second before", async () => {
    script.status = { answer: { outcome: "PENDING", head: null, reason: "queued" } };
    const answer = await status(await fixtureModule({ reader: reader({ now: BEFORE_TIMEOUT }) }), REPO, PR, HEAD, WINDOW);
    assert.deepEqual(answer, { outcome: "PENDING", reason: "queued" });
  });

  it("is SILENT for a verdict on another head once the timeout has run", async () => {
    script.status = { answer: { outcome: "PASS", head: OTHER_HEAD, reason: null } };
    const answer = await status(await fixtureModule({ reader: reader({ now: AT_TIMEOUT }) }), REPO, PR, HEAD, WINDOW);
    assert.equal(answer.outcome, "SILENT");
  });

  it("reads now() from the module's client, GitHub's clock, not from the writer", async () => {
    script.status = { answer: { outcome: "PENDING", head: null, reason: null } };
    const ownReader = reader({ now: AT_TIMEOUT });
    const ownWriter = writer();
    const answer = await status(await fixtureModule({ reader: ownReader, writer: ownWriter }), REPO, PR, HEAD, WINDOW);
    assert.equal(answer.outcome, "SILENT");
    assert.deepEqual(ownReader.calls, [{ kind: "now" }]);
    assert.deepEqual(ownWriter.calls, []);
  });
});

describe("no answer, a throw or a refused answer is COULD_NOT_RUN, naming the module and the error", () => {
  const throws: [string, unknown, RegExp][] = [
    ["an Error", new Error("the provider is down"), /the provider is down/],
    ["GitHubUnanswered", new GitHubUnanswered("GET /repos/acme/widgets: no answer"), /no answer/],
    ["a value that is no Error", "boom", /boom/],
  ];

  for (const [what, thrown, why] of throws) {
    it(`is COULD_NOT_RUN from trigger when it throws ${what}`, async () => {
      script.trigger = { throws: thrown };
      assertCouldNotRun(await trigger(await fixtureModule(), REPO, PR, HEAD), why);
    });

    it(`is COULD_NOT_RUN from status when it throws ${what}`, async () => {
      script.status = { throws: thrown };
      assertCouldNotRun(await status(await fixtureModule(), REPO, PR, HEAD, WINDOW), why);
    });

    it(`is COULD_NOT_RUN from findings when it throws ${what}`, async () => {
      script.findings = { throws: thrown };
      assertCouldNotRun(await findings(await fixtureModule(), REPO, PR, HEAD), why);
    });
  }

  it("answers nothing from trigger when it returns, and lets a second call for one head reach the package", async () => {
    const module = await fixtureModule();
    assert.equal(await trigger(module, REPO, PR, HEAD), undefined);
    assert.equal(await trigger(module, REPO, PR, HEAD), undefined);
    assert.deepEqual(script.calls, [
      { fn: "trigger", repo: REPO, pr: PR, head: HEAD },
      { fn: "trigger", repo: REPO, pr: PR, head: HEAD },
    ]);
  });

  for (const outcome of ["SILENT", "COULD_NOT_RUN", "MAYBE"]) {
    it(`is COULD_NOT_RUN for a status outcome outside the four: ${outcome}`, async () => {
      script.status = { answer: { outcome, head: HEAD, reason: "said so" } };
      assertCouldNotRun(await status(await fixtureModule(), REPO, PR, HEAD, WINDOW), /outcome/);
    });
  }

  it("is COULD_NOT_RUN for a status answer missing its head", async () => {
    script.status = { answer: { outcome: "PASS", reason: null } };
    assertCouldNotRun(await status(await fixtureModule(), REPO, PR, HEAD, WINDOW), /head/);
  });

  it("is COULD_NOT_RUN for a status whose head is no commit sha", async () => {
    script.status = { answer: { outcome: "PASS", head: HEAD.slice(0, 7), reason: null } };
    assertCouldNotRun(await status(await fixtureModule(), REPO, PR, HEAD, WINDOW), /head/);
  });

  it("is COULD_NOT_RUN from a PENDING status when GitHub's clock gives no answer", async () => {
    script.status = { answer: { outcome: "PENDING", head: null, reason: null } };
    const silentClock = reader({ now: new GitHubUnanswered("GET /rate_limit: no answer") });
    assertCouldNotRun(await status(await fixtureModule({ reader: silentClock }), REPO, PR, HEAD, WINDOW), /no answer/);
  });

  it("is COULD_NOT_RUN from findings when GitHub gives no answer to its provider's threads", async () => {
    const module = await fixtureModule({ reader: reader({ threads: new GitHubUnanswered("POST /graphql: no answer") }) });
    assertCouldNotRun(await findings(module, REPO, PR, HEAD), /no answer/);
  });

  it("is COULD_NOT_RUN for a finding the Findings contract refuses", async () => {
    script.findings = { answer: [{ ...ITEM, resolvable: true }] };
    assertCouldNotRun(await findings(await fixtureModule(), REPO, PR, HEAD), /resolvable/);
  });

  for (const source of ["other", "threads", "required-checks"]) {
    it(`is COULD_NOT_RUN for a finding whose source is ${source}, not the module's name`, async () => {
      script.findings = { answer: [ITEM, { ...ITEM, key: "fixture:issue-8", source }] };
      assertCouldNotRun(await findings(await fixtureModule(), REPO, PR, HEAD), new RegExp(`"${source}"`));
    });
  }

  it("is COULD_NOT_RUN for a findings answer that is not a list", async () => {
    script.findings = { answer: { findings: [ITEM] } };
    assertCouldNotRun(await findings(await fixtureModule(), REPO, PR, HEAD), /not a list/);
  });
});

describe("findings: the package's items and its provider's threads", () => {
  it("gives the package's own items and its provider's unresolved threads, each a valid finding", async () => {
    script.findings = { answer: [ITEM] };
    const module = await fixtureModule({ reader: reader({ threads: [PROVIDER_THREAD, ALICE_THREAD] }) });
    assert.deepEqual(await findings(module, REPO, PR, HEAD), [ITEM, PROVIDER_FINDING]);
    assert.deepEqual(script.calls, [{ fn: "findings", repo: REPO, pr: PR, head: HEAD }]);
  });

  it("gives an empty list only when the package found nothing", async () => {
    assert.deepEqual(await findings(await fixtureModule(), REPO, PR, HEAD), []);
  });

  it("gives each provider's thread by its own module alone, another provider's reply carried as trusted", async () => {
    const secondBot: Author = { __typename: "Bot", login: "second-bot" };
    const answered = threadNode("fixture", FIXTURE_BOT, "the retry budget is never reset");
    answered.comments.nodes.push({ id: "PRRC_fixture_2", author: secondBot, body: "confirmed", url: "https://example.test/2" });
    const client = reader({ threads: [answered, threadNode("second", secondBot, "an unclosed handle")] });
    const validators = await load(["fixture", "second"], { reader: client });
    assert.deepEqual(validators.logins, new Set(["fixture-bot[bot]", "second-bot[bot]"]));

    const [fixture, second] = [validators.modules.get("fixture"), validators.modules.get("second")];
    assert.ok(fixture !== undefined && second !== undefined);
    const fromFixture = await findings(fixture, REPO, PR, HEAD);
    const fromSecond = await findings(second, REPO, PR, HEAD);
    assert.ok(Array.isArray(fromFixture) && Array.isArray(fromSecond));
    assert.deepEqual(fromFixture.map((finding) => finding.thread_id), ["PRRT_fixture"]);
    assert.deepEqual(fromSecond.map((finding) => [finding.source, finding.thread_id]), [["second", "PRRT_second"]]);
    assert.deepEqual(fromFixture[0].trusted_comments.map((comment) => comment.id), ["PRRC_fixture_1", "PRRC_fixture_2"]);
  });
});

describe("a finding on a thread a codeworks App started is dropped", () => {
  for (const app of APP_LOGINS) {
    it(`drops the thread ${app} started and keeps the rest`, async () => {
      const appThread: Finding = {
        ...PROVIDER_FINDING,
        key: "thread:PRRT_app",
        author: app,
        thread_id: "PRRT_app",
        trusted_comments: [{ id: "PRRC_app_1", author: app, body: "a codeworks App's thread" }],
        latest_trusted_comment_id: "PRRC_app_1",
      };
      script.findings = { answer: [appThread, ITEM] };
      assert.deepEqual(await findings(await fixtureModule(), REPO, PR, HEAD), [ITEM]);
    });
  }
});

describe("the caller's head, repository, PR and window are checked before any package is called", () => {
  const asks: [string, string, number, string][] = [
    ["a head that is no commit sha", REPO, PR, "main"],
    ["a repository that is no owner/name", "widgets", PR, HEAD],
    ["a PR that is no issue number", REPO, 0, HEAD],
  ];

  for (const [what, repo, pr, head] of asks) {
    it(`throws for ${what}`, async () => {
      const module = await fixtureModule();
      await assert.rejects(trigger(module, repo, pr, head), TypeError);
      await assert.rejects(status(module, repo, pr, head, WINDOW), TypeError);
      await assert.rejects(findings(module, repo, pr, head), TypeError);
      assert.deepEqual(script.calls, []);
    });
  }

  for (const [what, window] of [
    ["a since that is not GitHub's time", { timeoutSeconds: TIMEOUT, since: "yesterday" }],
    ["a timeout that is not a positive number of seconds", { timeoutSeconds: 0, since: SINCE }],
  ] as const) {
    it(`throws from status for ${what}`, async () => {
      await assert.rejects(status(await fixtureModule(), REPO, PR, HEAD, window), TypeError);
      assert.deepEqual(script.calls, []);
    });
  }
});
