import assert from "node:assert/strict";
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { fakeGitHub } from "../../core/tests/support/fake-github.ts";
import { GhFolderRefused, readGhToken, writeGhToken } from "../plugin/core/gh-config.ts";
import { GitFailed } from "../plugin/core/git.ts";
import { RemoteRefused } from "../plugin/core/github.ts";
import { MintError } from "../plugin/core/tokens.ts";
import { ghFolder } from "../plugin/lib/paths.ts";
import { ensureSessionToken, originRepository } from "../plugin/lib/session-token.ts";
import { settleSettings, type OnGitHub } from "../plugin/lib/settings.ts";
import {
  APP_ID,
  contentsAnswer,
  fakeMintToken,
  git,
  REPO,
  scratchCheckout,
  SESSION_APP_ID,
  SESSION_LOGIN,
  SETTINGS,
  tempHome,
} from "./support/checkout.ts";

const NOW = new Date("2026-10-30T12:00:00Z");
const MINUTE = 60 * 1000;

async function settled(): Promise<OnGitHub> {
  const client = fakeGitHub({ rest: { "GET /repos/acme/widgets/contents/codeworks.toml?ref=main": contentsAnswer(SETTINGS) } });
  return { client, settled: await settleSettings(client, REPO, "main", { app_id: APP_ID, session_app_id: SESSION_APP_ID }) };
}

function harness(t: TestContext, failure?: Error) {
  const home = tempHome(t);
  const mint = fakeMintToken(() => NOW, failure);
  let asked = 0;
  const deps = {
    home,
    mintToken: mint.mintToken,
    onGitHub: () => ((asked += 1), settled()),
  };
  return { home, folder: ghFolder(home), mint, deps, asked: () => asked };
}

/** Stores a session token for `repo` expiring `minutes` after NOW. */
function store(folder: string, repo: string, minutes: number): string {
  const value = crypto.randomUUID();
  const expires_at = new Date(NOW.getTime() + minutes * MINUTE).toISOString().replace(/\.\d{3}Z$/, "Z");
  writeGhToken(folder, { value, app: "session", repo, expires_at, permissions: {} }, SESSION_LOGIN);
  return value;
}

describe("originRepository", () => {
  it("is the GitHub repository the checkout's origin names", async (t) => {
    assert.equal(await originRepository(scratchCheckout(t)), REPO);
  });

  it("refuses a checkout with no origin, naming it", async (t) => {
    const checkout = scratchCheckout(t);
    git(checkout, "remote", "remove", "origin");
    await assert.rejects(originRepository(checkout), (error: unknown) => error instanceof GitFailed && /origin/.test(error.message));
  });

  it("refuses an origin that is not a github.com repository", async (t) => {
    const checkout = scratchCheckout(t);
    git(checkout, "remote", "set-url", "origin", "https://example.invalid/acme/widgets.git");
    await assert.rejects(originRepository(checkout), RemoteRefused);
  });
});

describe("ensureSessionToken", () => {
  it("mints the session App's token for the one repository into an empty gh folder", async (t) => {
    const { home, folder, mint, deps, asked } = harness(t);
    await ensureSessionToken(REPO, NOW, deps);
    assert.equal(asked(), 1);
    assert.deepEqual(mint.calls, [{ app: "session", appId: SESSION_APP_ID, keyFile: "session-app.pem", plugin: "orchestrator", repo: REPO }]);
    const stored = readGhToken(folder);
    assert.equal(stored?.repo, REPO);
    assert.equal(stored?.expires_at, "2026-10-30T13:00:00Z");
    assert.match(readFileSync(join(folder, "hosts.yml"), "utf8"), new RegExp(`user: ${SESSION_LOGIN.replace(/[[\]]/g, "\\$&")}`));
    assert.equal(statSync(folder).mode & 0o777, 0o700);
    for (const file of readdirSync(folder)) assert.equal(statSync(join(folder, file)).mode & 0o777, 0o600, file);
    assert.deepEqual(readdirSync(join(home, ".local", "state", "codeworks", "orchestrator")), ["gh"]);
  });

  it("with the stored token for the repository and 10 minutes or more left, calls GitHub and reads settings not at all", async (t) => {
    const { folder, mint, deps, asked } = harness(t);
    const value = store(folder, REPO, 10);
    await ensureSessionToken(REPO, NOW, deps);
    assert.equal(asked(), 0);
    assert.deepEqual(mint.calls, []);
    assert.equal(readGhToken(folder)?.value, value);
  });

  for (const [why, repo, minutes] of [
    ["under 10 minutes left", REPO, 9],
    ["a token for another repository", "acme/gadgets", 60],
  ] as const) {
    it(`mints again over ${why}`, async (t) => {
      const { folder, mint, deps } = harness(t);
      const value = store(folder, repo, minutes);
      await ensureSessionToken(REPO, NOW, deps);
      assert.equal(mint.calls.length, 1);
      assert.notEqual(readGhToken(folder)?.value, value);
      assert.equal(readGhToken(folder)?.repo, REPO);
    });
  }

  it("lets a failed mint through with core's cause, writing nothing and trying no other credential", async (t) => {
    const { folder, mint, deps } = harness(t, new MintError("dummy cause"));
    const value = store(folder, REPO, 5);
    await assert.rejects(ensureSessionToken(REPO, NOW, deps), /mint failed: dummy cause/);
    assert.equal(mint.calls.length, 1);
    assert.equal(readGhToken(folder)?.value, value);
  });

  it("lets a gh folder core refuses through, minting nothing", async (t) => {
    const { folder, mint, deps, asked } = harness(t);
    mkdirSync(folder, { recursive: true, mode: 0o700 });
    writeFileSync(join(folder, "codeworks-token.json"), `${JSON.stringify({ repo: REPO, expires_at: "2026-10-30T13:00:00Z" })}\n`);
    await assert.rejects(ensureSessionToken(REPO, NOW, deps), GhFolderRefused);
    assert.deepEqual(mint.calls, []);
    assert.equal(asked(), 0);
  });
});
