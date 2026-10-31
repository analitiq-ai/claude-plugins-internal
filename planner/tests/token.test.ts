import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { generateKeyPairSync, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const GH_TS = fileURLToPath(new URL("../plugin/scripts/gh.ts", import.meta.url));
const GITHUB_AT = fileURLToPath(new URL("./support/github-at.ts", import.meta.url));

const APP_ID = 424242;
const OWNER = "acme";
const NAME = "widgets";
const INSTALLATION = 9001;
const LOGIN = "codeworks-planner[bot]";
const MINTED = "ghs_dummyminted00000000000000000000000";
const SEEDED = "ghs_dummyseeded00000000000000000000000";
const AMBIENT = "dummy-ambient-gh-token";
const TOKEN_VARIABLES = ["GH_TOKEN", "GITHUB_TOKEN", "GH_ENTERPRISE_TOKEN", "GITHUB_ENTERPRISE_TOKEN"];
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

// GitHub hands out an App's private key as PKCS#1 PEM.
const KEY_PEM = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs1", format: "pem" });

type Seen = { method: string; url: string; authorization: string; body: string };
type ScriptRun = { status: number | null; stdout: string; stderr: string };
type GhRun = { argv: string[]; stdin: string; configDir: string | null; tokens: string[] };

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
  folder: string;
  seen: Seen[];
  calls: () => string[];
  /** Each run of the stand-in gh, in order. */
  ghRuns: () => GhRun[];
  run: (args: readonly string[], options?: { stdin?: string; ghExit?: number }) => Promise<ScriptRun>;
};

type WorldOptions = {
  settings?: string | null;
  origin?: string | null;
  key?: boolean;
  /** Answers the installation lookup; a 200 naming INSTALLATION when absent. */
  installation?: (res: ServerResponse) => void;
};

// gh's stand-in keeps what each run was handed: its arguments, its stdin, the config folder and which of the token
// variables gh reads before that folder it could see.
const STAND_IN_GH = `#!${process.execPath}
const fs = require("node:fs");
const stdin = fs.readFileSync(0, "utf8");
const tokens = ${JSON.stringify(TOKEN_VARIABLES)}.filter((name) => name in process.env);
const run = { argv: process.argv.slice(2), stdin, configDir: process.env.GH_CONFIG_DIR ?? null, tokens };
fs.appendFileSync(process.env.STAND_IN_GH_LOG, JSON.stringify(run) + "\\n");
process.stdout.write("stand-in gh output\\n");
process.exitCode = Number(process.env.STAND_IN_GH_EXIT);
`;

async function world(t: TestContext, options: WorldOptions = {}): Promise<World> {
  const root = mkdtempSync(join(tmpdir(), "planner-token-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const checkout = join(root, "checkout");
  const bin = join(root, "bin");
  const ghLog = join(root, "gh.log");
  mkdirSync(home);
  mkdirSync(checkout);
  mkdirSync(bin);
  writeFileSync(join(bin, "gh"), STAND_IN_GH, { mode: 0o755 });

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
    folder: join(home, ".local", "state", "codeworks", "planner", OWNER, NAME, "gh"),
    seen,
    calls: () => seen.map((one) => `${one.method} ${one.url}`),
    ghRuns: () =>
      existsSync(ghLog)
        ? readFileSync(ghLog, "utf8")
            .trimEnd()
            .split("\n")
            .map((line) => JSON.parse(line) as GhRun)
        : [],
    run: (args, runOptions = {}) =>
      runScript(
        {
          // Nothing of this process's environment but PATH, behind the stand-in gh.
          PATH: `${bin}${delimiter}${process.env.PATH}`,
          HOME: home,
          XDG_CONFIG_HOME: join(home, ".config"),
          XDG_STATE_HOME: join(home, ".local", "state"),
          XDG_DATA_HOME: join(home, ".local", "share"),
          XDG_CACHE_HOME: join(home, ".cache"),
          PLANNER_TEST_GITHUB_API: api,
          STAND_IN_GH_LOG: ghLog,
          STAND_IN_GH_EXIT: String(runOptions.ghExit ?? 0),
          // The admin's own tokens, exported in the session: gh.ts must hand gh none of them.
          ...Object.fromEntries(TOKEN_VARIABLES.map((name) => [name, AMBIENT])),
        },
        checkout,
        args,
        runOptions.stdin ?? "",
      ),
  };
}

/** gh.ts as new_issue.py runs it, from the checkout; neither token value ever reaches its stdout or stderr. */
function runScript(env: NodeJS.ProcessEnv, cwd: string, args: readonly string[], stdin: string): Promise<ScriptRun> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["--import", GITHUB_AT, GH_TS, ...args], { env, cwd });
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
        assert.equal(`${stdout}${stderr}`.includes(token), false, "gh.ts printed a token");
      }
      resolve({ status, stdout, stderr });
    });
    child.stdin.end(stdin);
  });
}

/** A folder as an earlier run left it: gh's hosts.yml and the token's repository and expiry. */
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

/** Exit 2, the cause named, nothing minted, no folder written and gh never run. */
function assertRefused(w: World, run: ScriptRun, ...named: string[]): void {
  assert.equal(run.status, 2, `exit ${run.status}: ${run.stderr}`);
  assert.equal(run.stdout, "");
  for (const part of named) assert.ok(run.stderr.includes(part), `stderr does not name ${part}: ${run.stderr}`);
  assert.equal(existsSync(w.folder), false, "the folder was written");
  assert.deepEqual(w.ghRuns(), [], "gh ran");
}

const ISSUE_CREATE = ["issue", "create", "--repo", `${OWNER}/${NAME}`, "--title", "dummy", "--body-file", "-"];

describe("gh.ts <gh args>", () => {
  it("mints the planner App's token for the one repository, writes planner's folder and runs gh with it and with no token variable", async (t) => {
    const w = await world(t);
    const run = await w.run(ISSUE_CREATE, { stdin: "dummy body" });

    assert.equal(run.status, 0, run.stderr);
    assert.equal(run.stdout, "stand-in gh output\n");
    assert.deepEqual(w.calls(), MINT_CALLS);
    assert.deepEqual(JSON.parse(w.seen[1].body), { repositories: [NAME], permissions: PLANNER_PERMISSIONS });
    assertOnlyPlannerCredentials(w.seen);
    const stored = await storedToken(w.folder);
    assert.equal(stored?.value, MINTED);
    assert.equal(stored?.repo, `${OWNER}/${NAME}`);
    assert.deepEqual(w.ghRuns(), [{ argv: ISSUE_CREATE, stdin: "dummy body", configDir: w.folder, tokens: [] }]);
  });

  it("replaces a stored token of another repository", async (t) => {
    const w = await world(t);
    seedToken(w.folder, `${OWNER}/other`, iso(Date.now() + 50 * 60_000));
    assert.equal((await w.run(["auth", "status"])).status, 0);
    assert.deepEqual(w.calls(), MINT_CALLS);
    assert.equal((await storedToken(w.folder))?.repo, `${OWNER}/${NAME}`);
  });

  it("mints nothing with 11 minutes left, and mints once with 9", async (t) => {
    const w = await world(t);
    seedToken(w.folder, `${OWNER}/${NAME}`, iso(Date.now() + 11 * 60_000));
    assert.equal((await w.run(["auth", "status"])).status, 0);
    assert.deepEqual(w.calls(), []);
    assert.equal((await storedToken(w.folder))?.value, SEEDED);

    seedToken(w.folder, `${OWNER}/${NAME}`, iso(Date.now() + 9 * 60_000));
    assert.equal((await w.run(["auth", "status"])).status, 0);
    assert.deepEqual(w.calls(), MINT_CALLS);
    assertOnlyPlannerCredentials(w.seen);
    assert.equal((await storedToken(w.folder))?.value, MINTED);
    assert.equal(w.ghRuns().length, 2);
  });

  it("exits with gh's exit code", async (t) => {
    const w = await world(t);
    const run = await w.run(["issue", "view", "1"], { ghExit: 3 });
    assert.equal(run.status, 3, run.stderr);
    assert.equal(run.stdout, "stand-in gh output\n");
  });
});

describe("gh.ts exits 2 naming the cause, mints nothing and runs no gh", () => {
  const cases: [string, WorldOptions, string[]][] = [
    ["a missing codeworks.toml", { settings: null }, ["codeworks.toml"]],
    ["a [planner] with an unknown key", { settings: `${SETTINGS}app_login = "${LOGIN}"\n` }, ["codeworks.toml [planner]", "app_login"]],
    ["an origin that is not GitHub", { origin: "https://gitlab.com/acme/widgets.git" }, ["https://gitlab.com/acme/widgets.git"]],
    ["no origin", { origin: null }, ["origin"]],
  ];
  for (const [what, options, named] of cases) {
    it(what, async (t) => {
      const w = await world(t, options);
      assertRefused(w, await w.run(["auth", "status"]), ...named);
      assert.deepEqual(w.calls(), []);
    });
  }

  it("an origin holding a credential, named without it", async (t) => {
    const secret = randomUUID();
    const w = await world(t, { origin: `https://x-access-token:${secret}@github.com/${OWNER}/${NAME}.git` });
    const run = await w.run(["auth", "status"]);
    assertRefused(w, run, `github.com/${OWNER}/${NAME}.git`);
    assert.ok(!run.stderr.includes(secret), "stderr holds the origin's credential");
    assert.deepEqual(w.calls(), []);
  });

  for (const [what, status, named] of [
    ["a mint GitHub refuses", 404, "not installed on acme/widgets"],
    ["a mint GitHub does not answer", 503, "503"],
  ] as const) {
    it(`${what}, with core's reason after the one call`, async (t) => {
      const w = await world(t, { installation: (res) => reply(res, status, { message: "dummy refusal" }) });
      assertRefused(w, await w.run(["auth", "status"]), named);
      assert.deepEqual(w.calls(), [MINT_CALLS[0]]);
      assertOnlyPlannerCredentials(w.seen);
    });
  }
});

it("gh.ts with no key refuses naming the key's path, minting nothing, writing no folder and running no gh", async (t) => {
  const w = await world(t, { key: false });
  assertRefused(w, await w.run(["auth", "status"]), `${join(w.home, ".config", "codeworks", "planner-app.pem")}: does not exist`);
  assert.deepEqual(w.calls(), []);
});
