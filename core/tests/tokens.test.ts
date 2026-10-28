import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { describe, it, type TestContext } from "node:test";
import { inspect } from "node:util";

import { GitHubRefused, GitHubUnanswered } from "../src/github.ts";
import { KeyReadRefused, type Machine } from "../src/keys.ts";
import { APP_PERMISSIONS, type App, MintError, mintToken } from "../src/tokens.ts";

const HOME = "/home/dummy";
const UID = 1000;
const KEYS = `${HOME}/.config/codeworks`;
const APP_ID = 424242;
const REPO = "acme/widgets";
const INSTALLATION = 9001;
const TOKEN_VALUE = "ghs_dummy0000000000000000000000000000";
const APPS = Object.keys(APP_PERMISSIONS) as App[];

const FILE = 0o100000;

// GitHub hands out an App's private key as PKCS#1 PEM.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const KEY_PEM = Buffer.from(privateKey.export({ type: "pkcs1", format: "pem" }));

function enoent(path: string): NodeJS.ErrnoException {
  return Object.assign(new Error(`ENOENT: no such file or directory, stat '${path}'`), { code: "ENOENT" });
}

/**
 * A Linux machine with no managed settings, holding `planner-app.pem` at 0600 unless `key` is null. Planner's read
 * of that file is the one read keys.ts makes without managed settings (keys.test.ts grades the gate), so it lets
 * every App's mint run here: the App and its key file are separate arguments.
 */
function machine(key: Buffer | null = KEY_PEM): Machine {
  const keyPath = `${KEYS}/planner-app.pem`;
  const stat = (path: string) => {
    if (path === keyPath && key !== null) return { uid: UID, mode: FILE | 0o600 };
    throw enoent(path);
  };
  return {
    platform: "linux",
    uid: UID,
    home: HOME,
    stat,
    lstat: stat,
    readText: (path) => {
      throw enoent(path);
    },
    readBytes: (path) => {
      stat(path);
      return key as Buffer;
    },
  };
}

type Seen = { method: string; url: string; authorization: string | undefined; body: string };
type TokenRequest = { repositories: string[]; permissions: Record<string, string> };

function reply(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}

// GitHub writes `expires_at` in whole seconds.
function iso(ms: number): string {
  return new Date(ms).toISOString().replace(/\.\d{3}Z$/, "Z");
}

/** What GitHub grants when it grants what was asked: one hour from `now`, the repositories and permissions named. */
function granted(asked: TokenRequest, now = Date.now()): Record<string, unknown> {
  return {
    token: TOKEN_VALUE,
    expires_at: iso(Math.floor(now / 1000) * 1000 + 3_600_000),
    permissions: asked.permissions,
    repository_selection: "selected",
    repositories: asked.repositories.map((name) => ({ name, full_name: `acme/${name}` })),
  };
}

type Answers = {
  installation?: (res: ServerResponse) => void;
  /** `now` is GitHub's clock. */
  token?: (asked: TokenRequest, now: number) => unknown;
  rateLimit?: (res: ServerResponse) => void;
  /** How far GitHub's clock runs ahead of the machine's; behind when negative. */
  aheadMs?: number;
};

const MINT_CALLS = [`GET /repos/${REPO}/installation`, `POST /app/installations/${INSTALLATION}/access_tokens`];
const CLOCK_CALL = "GET /rate_limit";

function call({ method, url }: Seen): string {
  return `${method} ${url}`;
}

/** A local GitHub answering a mint's calls and the read of its clock, `granted` unless `answers` says otherwise. */
async function serve(t: TestContext, answers: Answers = {}): Promise<{ api: string; seen: Seen[] }> {
  const seen: Seen[] = [];
  const server = createServer((req, res) => {
    const now = Date.now() + (answers.aheadMs ?? 0);
    res.setHeader("date", new Date(now).toUTCString());
    let body = "";
    req.setEncoding("utf8");
    req.on("data", (chunk: string) => {
      body += chunk;
    });
    req.on("end", () => {
      const one = { method: req.method ?? "", url: req.url ?? "", authorization: req.headers.authorization, body };
      seen.push(one);
      if (one.method === "GET" && one.url === `/repos/${REPO}/installation`) {
        if (answers.installation) answers.installation(res);
        else reply(res, 200, { id: INSTALLATION, app_id: APP_ID });
      } else if (one.method === "POST" && one.url === `/app/installations/${INSTALLATION}/access_tokens`) {
        reply(res, 201, (answers.token ?? granted)(JSON.parse(body) as TokenRequest, now));
      } else if (call(one) === CLOCK_CALL) {
        if (answers.rateLimit) answers.rateLimit(res);
        else reply(res, 200, { resources: {}, rate: {} });
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
  const { port } = server.address() as AddressInfo;
  return { api: `http://127.0.0.1:${port}`, seen };
}

function mint(app: App, api: string, onMachine: Machine = machine()) {
  return mintToken(app, APP_ID, "planner-app.pem", "planner", REPO, { api, machine: onMachine });
}

type Jwt = { header: Record<string, unknown>; payload: Record<string, unknown>; verified: boolean; raw: string };

function jwtOf(seen: Seen): Jwt {
  const raw = (seen.authorization ?? "").replace(/^Bearer /, "");
  const [header, payload, signature] = raw.split(".");
  const decode = (part: string) => JSON.parse(Buffer.from(part, "base64url").toString("utf8")) as Record<string, unknown>;
  return {
    header: decode(header),
    payload: decode(payload),
    verified: verify("sha256", Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, "base64url")),
    raw,
  };
}

/** The mint's calls carried the App's own JWT, signed by its key, and the clock's read the token: nothing else was tried. */
function assertOnlyItsOwnCredentials(seen: Seen[]): void {
  for (const one of seen) {
    if (call(one) === CLOCK_CALL) {
      assert.ok(one.authorization?.startsWith(`Bearer ${TOKEN_VALUE}`), `${CLOCK_CALL} carries no minted token`);
      continue;
    }
    assert.match(one.authorization ?? "", /^Bearer [\w-]+\.[\w-]+\.[\w-]+$/, call(one));
    const jwt = jwtOf(one);
    assert.equal(jwt.verified, true, `${one.method} ${one.url} carries a JWT the App's key did not sign`);
    assert.equal(jwt.payload.iss, APP_ID);
  }
}

function assertNoCredentialShown(error: unknown, seen: Seen[]): void {
  const shown = inspect(error, { depth: Infinity });
  assert.equal(shown.includes(TOKEN_VALUE), false, "the error shows the token value");
  for (const one of seen.filter((one) => call(one) !== CLOCK_CALL)) {
    assert.equal(shown.includes(jwtOf(one).raw), false, "the error shows the App's JWT");
  }
}

async function failure(minting: Promise<unknown>): Promise<unknown> {
  return minting.then(
    () => assert.fail("a token was minted"),
    (error: unknown) => error,
  );
}

/** The mint threw MintError, every reason in its message, no credential in it, after the mint's calls and the clock's read alone. */
async function refusal(minting: Promise<unknown>, seen: Seen[], ...parts: (string | RegExp)[]): Promise<MintError> {
  const error = await failure(minting);
  assert.ok(error instanceof MintError, inspect(error));
  for (const part of parts) {
    if (typeof part === "string") assert.ok(error.message.includes(part), `${error.message} does not name ${part}`);
    else assert.match(error.message, part);
  }
  assert.deepEqual(seen.map(call), [...MINT_CALLS, CLOCK_CALL]);
  assertOnlyItsOwnCredentials(seen);
  assertNoCredentialShown(error, seen);
  return error;
}

describe("mintToken's request", () => {
  it("signs an RS256 JWT with the App's key: iat now - 60 s, exp now + 9 min, iss the App ID", async (t) => {
    const { api, seen } = await serve(t);
    const before = Math.floor(Date.now() / 1000);
    await mint("reviewer", api);
    const after = Math.floor(Date.now() / 1000);

    assert.equal(seen.length, 3);
    const jwt = jwtOf(seen[0]);
    assert.deepEqual(jwt.header, { alg: "RS256", typ: "JWT" });
    assert.equal(jwt.verified, true);
    const { iat, exp, iss } = jwt.payload as { iat: number; exp: number; iss: number };
    assert.ok(iat >= before - 60 && iat <= after - 60, `iat ${iat} is not ${before} - 60 to ${after} - 60`);
    assert.equal(exp, iat + 60 + 9 * 60);
    assert.equal(iss, APP_ID);
    assert.deepEqual(Object.keys(jwt.payload).sort(), ["exp", "iat", "iss"]);
    assert.equal(seen[1].authorization, seen[0].authorization);
  });

  for (const app of APPS) {
    it(`asks for the ${app} App's token for one repository with exactly its permission set`, async (t) => {
      const { api, seen } = await serve(t);
      const minted = await mint(app, api);

      assert.deepEqual(seen.map(call), [...MINT_CALLS, CLOCK_CALL]);
      assertOnlyItsOwnCredentials(seen);
      assert.deepEqual(JSON.parse(seen[1].body), { repositories: ["widgets"], permissions: APP_PERMISSIONS[app] });
      assert.equal(minted.value, TOKEN_VALUE);
      assert.equal(minted.app, app);
      assert.equal(minted.repo, REPO);
      assert.deepEqual(minted.permissions, APP_PERMISSIONS[app]);
      const away = Date.parse(minted.expires_at) - Date.now();
      assert.ok(away > 3_590_000 && away <= 3_600_000, `expires ${away} ms away, not within the hour`);
    });
  }

  it("takes an answer that adds metadata: read, which GitHub may list unasked", async (t) => {
    const { api } = await serve(t, {
      token: (asked) => ({ ...granted(asked), permissions: { ...asked.permissions, metadata: "read" } }),
    });
    const minted = await mint("reviewer", api);
    assert.deepEqual(minted.permissions, { issues: "write", metadata: "read" });
  });

  it("takes the repository named in GitHub's own case", async (t) => {
    const { api } = await serve(t, {
      token: (asked) => ({ ...granted(asked), repositories: [{ name: "Widgets", full_name: "Acme/Widgets" }] }),
    });
    assert.equal((await mint("reviewer", api)).repo, REPO);
  });

  it("caches nothing: a second mint is a second exchange and a fresh token (AS3)", async (t) => {
    let n = 0;
    const { api, seen } = await serve(t, {
      token: (asked) => ({ ...granted(asked), token: `${TOKEN_VALUE}${++n}` }),
    });
    const first = await mint("session", api);
    const second = await mint("session", api);
    assert.equal(seen.length, 6);
    assert.notEqual(first.value, second.value);
  });

  // GitHub writes expires_at by its own clock, which the machine's may trail by more than the exchange takes.
  for (const aheadMs of [2_000, 5 * 60_000]) {
    it(`takes a one-hour token while the machine's clock runs ${aheadMs / 1000} s behind GitHub's`, async (t) => {
      const { api, seen } = await serve(t, { aheadMs });
      const minted = await mint("reviewer", api);
      assert.equal(minted.value, TOKEN_VALUE);
      assert.deepEqual(seen.map(call), [...MINT_CALLS, CLOCK_CALL]);
    });
  }
});

describe("mintToken refuses an answer", () => {
  it("naming another repository", async (t) => {
    const { api, seen } = await serve(t, {
      token: (asked) => ({ ...granted(asked), repositories: [{ name: "other", full_name: "acme/other" }] }),
    });
    await refusal(mint("reviewer", api), seen, "acme/other");
  });

  it("naming a second repository beside the one asked", async (t) => {
    const { api, seen } = await serve(t, {
      token: (asked) => ({
        ...granted(asked),
        repositories: [
          { name: "widgets", full_name: REPO },
          { name: "other", full_name: "acme/other" },
        ],
      }),
    });
    await refusal(mint("reviewer", api), seen, "acme/other");
  });

  it("naming no repository", async (t) => {
    const { api, seen } = await serve(t, { token: (asked) => ({ ...granted(asked), repositories: [] }) });
    await refusal(mint("reviewer", api), seen, REPO);
  });

  it("with expires_at over one hour away", async (t) => {
    const late = iso(Date.now() + 3_600_000 + 60_000);
    const { api, seen } = await serve(t, { token: (asked) => ({ ...granted(asked), expires_at: late }) });
    await refusal(mint("reviewer", api), seen, "expires_at", late);
  });

  it("with expires_at over one hour away by GitHub's clock, though not by the machine's, which runs ahead", async (t) => {
    let late = "";
    const { api, seen } = await serve(t, {
      aheadMs: -5 * 60_000,
      token: (asked, now) => {
        late = iso(now + 3_600_000 + 60_000);
        return { ...granted(asked, now), expires_at: late };
      },
    });
    await refusal(mint("reviewer", api), seen, "expires_at", late);
  });

  it("lacking a requested permission", async (t) => {
    const { api, seen } = await serve(t, {
      token: (asked) => {
        const { contents: _dropped, ...rest } = asked.permissions;
        return { ...granted(asked), permissions: rest };
      },
    });
    await refusal(mint("session", api), seen, /lacks contents: read/);
  });

  it("lowering a requested permission", async (t) => {
    const { api, seen } = await serve(t, {
      token: (asked) => ({ ...granted(asked), permissions: { ...asked.permissions, workflows: "read" } }),
    });
    await refusal(mint("orchestrator", api), seen, /workflows: read, not write/);
  });

  it("raising a requested permission: the token carries exactly the App's set (AS1)", async (t) => {
    const { api, seen } = await serve(t, {
      token: (asked) => ({ ...granted(asked), permissions: { ...asked.permissions, contents: "write" } }),
    });
    await refusal(mint("session", api), seen, /contents: write, not read/);
  });

  it("adding a permission not asked for", async (t) => {
    const { api, seen } = await serve(t, {
      token: (asked) => ({ ...granted(asked), permissions: { ...asked.permissions, contents: "read" } }),
    });
    await refusal(mint("reviewer", api), seen, /adds contents: read/);
  });

  it("adding metadata at any level but read", async (t) => {
    const { api, seen } = await serve(t, {
      token: (asked) => ({ ...granted(asked), permissions: { ...asked.permissions, metadata: "write" } }),
    });
    await refusal(mint("reviewer", api), seen, /adds metadata: write/);
  });

  it("naming every cause at once", async (t) => {
    const late = iso(Date.now() + 2 * 3_600_000);
    const { api, seen } = await serve(t, {
      token: (asked) => ({
        ...granted(asked),
        expires_at: late,
        repositories: [{ name: "other", full_name: "acme/other" }],
        permissions: { contents: "write" },
      }),
    });
    await refusal(mint("reviewer", api), seen, "acme/other", late, /lacks issues: write/, /adds contents: write/);
  });
});

describe("a failed mint names its cause and tries no other credential", () => {
  it('names "not installed on <repo>" when GitHub has no installation for it', async (t) => {
    const saved = { GH_TOKEN: process.env.GH_TOKEN, GITHUB_TOKEN: process.env.GITHUB_TOKEN };
    process.env.GH_TOKEN = "dummy-ambient-gh-token";
    process.env.GITHUB_TOKEN = "dummy-ambient-github-token";
    t.after(() => {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
    });
    const { api, seen } = await serve(t, { installation: (res) => reply(res, 404, { message: "Not Found" }) });

    const error = await failure(mint("reviewer", api));
    assert.ok(error instanceof MintError, inspect(error));
    assert.match(error.message, /not installed on acme\/widgets/);
    assert.deepEqual(seen.map(call), [MINT_CALLS[0]]);
    assertOnlyItsOwnCredentials(seen);
    assertNoCredentialShown(error, seen);
  });

  for (const [status, thrown] of [
    [401, GitHubRefused],
    [503, GitHubUnanswered],
  ] as const) {
    it(`lets the client's ${thrown.name} for a ${status} through, trying nothing else`, async (t) => {
      const { api, seen } = await serve(t, {
        installation: (res) => reply(res, status, { message: "A JSON web token could not be decoded" }),
      });
      const error = await failure(mint("reviewer", api));
      assert.ok(error instanceof thrown, inspect(error));
      assert.equal(seen.length, 1);
      assertOnlyItsOwnCredentials(seen);
      assertNoCredentialShown(error, seen);
    });
  }

  it("lets the client's GitHubUnanswered for GitHub's clock through, showing no token", async (t) => {
    const { api, seen } = await serve(t, { rateLimit: (res) => reply(res, 503, { message: "Service Unavailable" }) });
    const error = await failure(mint("reviewer", api));
    assert.ok(error instanceof GitHubUnanswered, inspect(error));
    assert.deepEqual(seen.map(call), [...MINT_CALLS, CLOCK_CALL]);
    assertOnlyItsOwnCredentials(seen);
    assertNoCredentialShown(error, seen);
  });

  it("names a missing key's path, sending nothing", async (t) => {
    const { api, seen } = await serve(t);
    const error = await failure(mint("reviewer", api, machine(null)));
    assert.ok(error instanceof Error);
    assert.ok(error.message.includes(`${KEYS}/planner-app.pem`), error.message);
    assert.equal(seen.length, 0);
  });

  it("reads the key through readKey: a refused read throws KeyReadRefused, sending nothing", async (t) => {
    const { api, seen } = await serve(t);
    const error = await failure(
      mintToken("reviewer", APP_ID, "reviewer-app.pem", "reviewer", REPO, { api, machine: machine() }),
    );
    assert.ok(error instanceof KeyReadRefused, inspect(error));
    assert.equal(error.path, `${KEYS}/reviewer-app.pem`);
    assert.ok(error.message.includes("/etc/claude-code/managed-settings.json does not exist"), error.message);
    assert.equal(seen.length, 0);
  });

  it("names a key file that holds no private key, sending nothing", async (t) => {
    const { api, seen } = await serve(t);
    const error = await failure(mint("reviewer", api, machine(Buffer.from("not a key\n"))));
    assert.ok(error instanceof MintError, inspect(error));
    assert.match(error.message, /planner-app\.pem/);
    assert.equal(seen.length, 0);
  });

  it("refuses an App it holds no permission set for, an App ID that is no ID and a repo that is no owner/name", async (t) => {
    const { api, seen } = await serve(t);
    const where = { api, machine: machine() };
    for (const app of ["admin", "toString"]) {
      await assert.rejects(mintToken(app as App, APP_ID, "planner-app.pem", "planner", REPO, where), {
        name: "TypeError",
        message: new RegExp(app),
      });
    }
    for (const appId of [0, -1, 1.5, Number.NaN, "424242" as unknown as number]) {
      await assert.rejects(mintToken("reviewer", appId, "planner-app.pem", "planner", REPO, where), TypeError);
    }
    await assert.rejects(mintToken("reviewer", APP_ID, "planner-app.pem", "planner", "acme", where), TypeError);
    assert.equal(seen.length, 0);
  });
});
