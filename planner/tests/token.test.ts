import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const TOKEN_TS = fileURLToPath(new URL("../plugin/hooks/token.ts", import.meta.url));
const GITHUB_AT = fileURLToPath(new URL("./support/github-at.ts", import.meta.url));

const APP_ID = 424242;
const OWNER = "acme";
const NAME = "widgets";
const INSTALLATION = 9001;
const LOGIN = "codeworks-planner[bot]";
const MINTED = "ghs_dummyminted00000000000000000000000";
const SEEDED = "ghs_dummyseeded00000000000000000000000";
const AMBIENT = "dummy-ambient-gh-token";
const PLANNER_PERMISSIONS = { contents: "write", pull_requests: "write", issues: "write", organization_projects: "read" };

const MINT_CALLS = [
  `GET /repos/${OWNER}/${NAME}/installation`,
  `POST /app/installations/${INSTALLATION}/access_tokens`,
  "GET /rate_limit",
];

const SETTINGS = `[shared]
board = "https://github.com/orgs/${OWNER}/projects/1"
validators = []
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "${LOGIN}"

[planner]
app_id = ${APP_ID}
`;

const ENV_LINES = (folder: string) =>
  `export GH_CONFIG_DIR='${folder}'\nunset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN\n`;

const FAILED_START = "planner: this session's start failed; start a new session\n";

// GitHub hands out an App's private key as PKCS#1 PEM.
const KEY_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });

type Seen = { method: string; url: string; authorization: string; body: string };
type HookRun = { status: number | null; stdout: string; stderr: string };
type Event = "SessionStart" | "PreToolUse";

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// GitHub writes `expires_at` in whole seconds.
function iso(ms: number): string {
  return new Date(Math.floor(ms / 1000) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
}

type World = {
  home: string;
  checkout: string;
  envFile: string;
  folder: string;
  record: (session: string) => string;
  seen: Seen[];
  calls: () => string[];
  run: (event: Event, session: string, options?: { envFile?: boolean; sessionId?: string }) => Promise<HookRun>;
};

type WorldOptions = {
  settings?: string | null;
  origin?: string | null;
  key?: boolean;
  /** Answers the installation lookup; a 200 naming INSTALLATION when absent. */
  installation?: (res: ServerResponse) => void;
};

async function world(t: TestContext, options: WorldOptions = {}): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "planner-token-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const checkout = join(root, "checkout");
  const envFile = join(root, "claude-env");
  mkdirSync(home);
  mkdirSync(checkout);

  if (options.key !== false) {
    mkdirSync(join(home, ".config", "codeworks"), { recursive: true, mode: 0o700 });
    writeFileSync(join(home, ".config", "codeworks", "planner-app.pem"), KEY_PEM, { mode: 0o600 });
  }

  const git = (...args: string[]) =>
    execFileSync("git", ["-C", checkout, "-c", "user.name=Dummy", "-c", "user.email=dummy@example.invalid", ...args], {
      env: { PATH: process.env.PATH, HOME: home, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    });
  git("init", "-q");
  const origin = options.origin === undefined ? `git@github.com:${OWNER}/${NAME}.git` : options.origin;
  if (origin !== null) git("remote", "add", "origin", origin);
  const settings = options.settings === undefined ? SETTINGS : options.settings;
  if (settings !== null) {
    writeFileSync(join(checkout, "codeworks.toml"), settings);
    git("add", "codeworks.toml");
  }
  git("commit", "-q", "--allow-empty", "-m", "dummy");

  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    res.setHeader("date", new Date().toUTCString());
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const one = { method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization ?? "", body };
      seen.push(one);
      const call = `${one.method} ${one.url}`;
      if (call === MINT_CALLS[0]) {
        if (options.installation) options.installation(res);
        else reply(res, 200, { id: INSTALLATION, app_id: APP_ID });
      } else if (call === MINT_CALLS[1]) {
        const asked = JSON.parse(body) as { repositories: string[]; permissions: Record<string, string> };
        reply(res, 201, {
          token: MINTED,
          expires_at: iso(Date.now() + 3_600_000),
          permissions: asked.permissions,
          repository_selection: "selected",
          repositories: asked.repositories.map((name) => ({ name, full_name: `${OWNER}/${name}` })),
        });
      } else if (call === MINT_CALLS[2]) {
        reply(res, 200, { resources: {}, rate: {} });
      } else {
        reply(res, 404, { message: "Not Found" });
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(
    () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  );
  const api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  return {
    home,
    checkout,
    envFile,
    folder: join(home, ".local", "state", "codeworks", "planner", OWNER, NAME, "gh"),
    record: (session) => join(home, ".local", "state", "codeworks", "planner", "sessions", session),
    seen,
    calls: () => seen.map((one) => `${one.method} ${one.url}`),
    run: (event, session, runOptions = {}) =>
      runHook(
        {
          // Nothing of this process's environment but PATH: inside a Claude Code session it holds the real CLAUDE_ENV_FILE.
          PATH: process.env.PATH,
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_STATE_HOME: join(home, ".local", "state"),
          XDG_DATA_HOME: join(home, ".local", "share"),
          XDG_CACHE_HOME: join(home, ".cache"),
          PLANNER_TEST_GITHUB_API: api,
          GH_TOKEN: AMBIENT,
          ...(event === "SessionStart" && runOptions.envFile !== false ? { CLAUDE_ENV_FILE: envFile } : {}),
        },
        checkout,
        {
          session_id: runOptions.sessionId ?? session,
          transcript_path: join(root, "transcript.jsonl"),
          cwd: checkout,
          hook_event_name: event,
          ...(event === "SessionStart"
            ? { source: "startup" }
            : { tool_name: "Bash", tool_input: { command: "gh issue view 1" } }),
        },
      ),
  };
}

/** The hook as Claude Code runs it, its input on stdin; neither token value ever reaches its stdout or stderr. */
function runHook(env: NodeJS.ProcessEnv, cwd: string, input: unknown): Promise<HookRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", GITHUB_AT, TOKEN_TS], { env, cwd });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => {
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (status) => {
      for (const token of [MINTED, SEEDED]) {
        assert.equal(`${stdout}${stderr}`.includes(token), false, "the hook printed a token");
      }
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(JSON.stringify(input));
  });
}

/** A folder as an earlier session left it: gh's hosts.yml and the token's repository and expiry. */
function seedToken(folder: string, repo: string, expiresAt: string): void {
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  writeFileSync(join(folder, "hosts.yml"), `github.com:\n  oauth_token: ${SEEDED}\n  user: ${LOGIN}\n  git_protocol: https\n`, {
    mode: 0o600,
  });
  writeFileSync(join(folder, "codeworks-token.json"), JSON.stringify({ repo, expires_at: expiresAt }), { mode: 0o600 });
}

async function storedToken(folder: string) {
  const { readGhToken } = await import("../plugin/core/gh-config.ts");
  return readGhToken(folder);
}

/** Each mint call carried the App's JWT and the clock's read the minted token: the admin's GH_TOKEN went nowhere. */
function assertOnlyPlannerCredentials(seen: readonly Seen[]): void {
  for (const one of seen) {
    assert.equal(one.authorization.includes(AMBIENT), false, `${one.method} ${one.url} carried the ambient GH_TOKEN`);
    if (one.url === "/rate_limit") assert.equal(one.authorization, `Bearer ${MINTED}`);
    else assert.match(one.authorization, /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, `${one.method} ${one.url}`);
  }
}

function assertSucceeded(run: HookRun): void {
  assert.equal(run.status, 0, run.stderr);
  assert.equal(run.stdout, "");
}

function assertBlocked(run: HookRun, ...named: string[]): void {
  assert.equal(run.status, 2, `exit ${run.status}: ${run.stderr}`);
  assert.equal(run.stdout, "");
  for (const part of named) assert.ok(run.stderr.includes(part), `stderr does not name ${part}: ${run.stderr}`);
}

describe("SessionStart", () => {
  it("mints the planner App's token for the one repository, writes planner's folder and points the session's gh at it", async (t) => {
    const w = await world(t);
    writeFileSync(w.envFile, "export DUMMY_EARLIER=1\n");
    const session = randomUUID();

    assertSucceeded(await w.run("SessionStart", session));

    assert.deepEqual(w.calls(), MINT_CALLS);
    assert.deepEqual(JSON.parse(w.seen[1].body), { repositories: [NAME], permissions: PLANNER_PERMISSIONS });
    assertOnlyPlannerCredentials(w.seen);
    const stored = await storedToken(w.folder);
    assert.equal(stored?.value, MINTED);
    assert.equal(stored?.repo, `${OWNER}/${NAME}`);
    assert.equal(readFileSync(w.envFile, "utf8"), `export DUMMY_EARLIER=1\n${ENV_LINES(w.folder)}`);
    assert.ok(existsSync(w.record(session)), "no record of the session's start");
  });

  it("replaces a stored token of another repository", async (t) => {
    const w = await world(t);
    seedToken(w.folder, `${OWNER}/other`, iso(Date.now() + 50 * 60_000));

    assertSucceeded(await w.run("SessionStart", randomUUID()));

    assert.deepEqual(w.calls(), MINT_CALLS);
    assert.equal((await storedToken(w.folder))?.repo, `${OWNER}/${NAME}`);
  });
});

describe("PreToolUse", () => {
  it("mints nothing with 11 minutes left, and mints once with 9", async (t) => {
    const w = await world(t);
    const session = randomUUID();
    assertSucceeded(await w.run("SessionStart", session));
    const envFile = readFileSync(w.envFile, "utf8");

    seedToken(w.folder, `${OWNER}/${NAME}`, iso(Date.now() + 11 * 60_000));
    assertSucceeded(await w.run("PreToolUse", session));
    assert.deepEqual(w.calls(), MINT_CALLS);
    assert.equal((await storedToken(w.folder))?.value, SEEDED);

    seedToken(w.folder, `${OWNER}/${NAME}`, iso(Date.now() + 9 * 60_000));
    assertSucceeded(await w.run("PreToolUse", session));
    assert.deepEqual(w.calls(), [...MINT_CALLS, ...MINT_CALLS]);
    assertOnlyPlannerCredentials(w.seen);
    assert.equal((await storedToken(w.folder))?.value, MINTED);
    assert.equal(readFileSync(w.envFile, "utf8"), envFile);
  });

  it("in a session with no record of its start exits 2 naming the failed start, minting nothing", async (t) => {
    const w = await world(t);
    const run = await w.run("PreToolUse", randomUUID());
    assertBlocked(run);
    assert.equal(run.stderr, FAILED_START);
    assert.deepEqual(w.calls(), []);
  });
});

describe("a refused start exits 2 naming the cause, mints nothing and leaves no record", () => {
  const cases: [string, WorldOptions, (w: World) => string[], { envFile?: boolean }?][] = [
    ["a missing codeworks.toml", { settings: null }, () => ["codeworks.toml"]],
    [
      "a [planner] with an unknown key",
      { settings: `${SETTINGS}app_login = "${LOGIN}"\n` },
      () => ["codeworks.toml [planner]", "app_login"],
    ],
    ["an origin that is not GitHub", { origin: "https://gitlab.com/acme/widgets.git" }, () => ["https://gitlab.com/acme/widgets.git"]],
    ["no origin", { origin: null }, () => ["origin"]],
    ["an unset CLAUDE_ENV_FILE", {}, () => ["CLAUDE_ENV_FILE"], { envFile: false }],
  ];
  for (const [what, options, named, runOptions] of cases) {
    it(what, async (t) => {
      const w = await world(t, options);
      const session = randomUUID();
      assertBlocked(await w.run("SessionStart", session, runOptions), ...named(w));
      assert.deepEqual(w.calls(), []);
      assert.equal(existsSync(w.folder), false, "the folder was written");
      assert.equal(existsSync(w.record(session)), false, "the failed start left a record");
    });
  }

  it("an origin holding a credential, named without it", async (t) => {
    const secret = "ghp_dummySECRET123";
    const w = await world(t, { origin: `https://x-access-token:${secret}@github.com/${OWNER}/${NAME}.git` });
    const session = randomUUID();
    const run = await w.run("SessionStart", session);
    assertBlocked(run, `github.com/${OWNER}/${NAME}.git`);
    assert.ok(!run.stderr.includes(secret), "stderr holds the origin's credential");
    assert.deepEqual(w.calls(), []);
    assert.equal(existsSync(w.folder), false, "the folder was written");
    assert.equal(existsSync(w.record(session)), false, "the failed start left a record");
  });
});

// Core names no error for an absent key: the read's own error, naming the path, goes through the hook's re-throw,
// and "onFailure": "block" blocks on exit 1 as it does on 2.
it("a missing key exits 1 naming the key's path, minting nothing and leaving no folder and no record", async (t) => {
  const w = await world(t, { key: false });
  const session = randomUUID();
  const run = await w.run("SessionStart", session);
  assert.equal(run.status, 1, `exit ${run.status}: ${run.stderr}`);
  assert.equal(run.stdout, "");
  const key = join(w.home, ".config", "codeworks", "planner-app.pem");
  assert.ok(run.stderr.includes(key), `stderr does not name ${key}: ${run.stderr}`);
  assert.deepEqual(w.calls(), []);
  assert.equal(existsSync(w.folder), false, "the folder was written");
  assert.equal(existsSync(w.record(session)), false, "the failed start left a record");
});

describe("a mint GitHub refuses or does not answer", () => {
  for (const [what, status, named] of [
    ["refused", 404, "not installed on acme/widgets"],
    ["unanswered", 503, "503"],
  ] as const) {
    it(`${what}: exits 2 with core's reason after the one call, writing no folder and no record`, async (t) => {
      const w = await world(t, { installation: (res) => reply(res, status, { message: "dummy refusal" }) });
      const session = randomUUID();
      assertBlocked(await w.run("SessionStart", session), named);
      assert.deepEqual(w.calls(), [MINT_CALLS[0]]);
      assertOnlyPlannerCredentials(w.seen);
      assert.equal(existsSync(w.folder), false, "the folder was written");
      assert.equal(existsSync(w.record(session)), false, "the failed start left a record");
    });
  }

  it("at SessionStart leaves no record, and the session's next PreToolUse exits 2", async (t) => {
    const w = await world(t, { installation: (res) => reply(res, 404, { message: "Not Found" }) });
    const session = randomUUID();
    assertBlocked(await w.run("SessionStart", session));
    const next = await w.run("PreToolUse", session);
    assertBlocked(next);
    assert.equal(next.stderr, FAILED_START);
    assert.deepEqual(w.calls(), [MINT_CALLS[0]]);
  });

  it("at a second SessionStart removes the record the first wrote", async (t) => {
    let refuse = false;
    const w = await world(t, {
      installation: (res) => (refuse ? reply(res, 404, { message: "Not Found" }) : reply(res, 200, { id: INSTALLATION })),
    });
    const session = randomUUID();
    assertSucceeded(await w.run("SessionStart", session));
    assert.ok(existsSync(w.record(session)));

    seedToken(w.folder, `${OWNER}/${NAME}`, iso(Date.now() + 9 * 60_000));
    refuse = true;
    assertBlocked(await w.run("SessionStart", session), "not installed on acme/widgets");
    assert.equal(existsSync(w.record(session)), false, "the refused start kept the earlier record");
    assert.equal((await w.run("PreToolUse", session)).stderr, FAILED_START);
  });
});

it("a session_id that is not a UUID exits 2, minting nothing", async (t) => {
  const w = await world(t);
  const run = await w.run("SessionStart", randomUUID(), { sessionId: "../../dummy" });
  assertBlocked(run, "session_id");
  assert.deepEqual(w.calls(), []);
  assert.equal(existsSync(w.envFile), false, "the session's environment was written");
});
