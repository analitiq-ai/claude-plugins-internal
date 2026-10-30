import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { describe, it, type TestContext } from "node:test";

import { fakeGitHub } from "../../core/tests/support/fake-github.ts";
import { MintError } from "../plugin/core/tokens.ts";
import { orchestratorClient } from "../plugin/lib/app-token.ts";
import { APP_ID, fakeMintToken, REPO, tempHome } from "./support/checkout.ts";

const MINUTE = 60 * 1000;
const COMMENTS = "/repos/acme/widgets/issues/7/comments";

function harness(failure?: Error) {
  let clock = new Date("2026-10-30T12:00:00Z");
  const now = () => clock;
  const mint = fakeMintToken(now, failure);
  const github = fakeGitHub({ rest: { [`POST ${COMMENTS}`]: {} } });
  // The token each write went out with, in order.
  const usedTokens: string[] = [];
  const client = orchestratorClient(REPO, APP_ID, {
    now,
    mintToken: mint.mintToken,
    connect: (token) => ({ ...github, rest: (...args) => (usedTokens.push(token), github.rest(...args)) }),
  });
  const write = () => client.rest("POST", COMMENTS, { body: "dummy" });
  const advance = (minutes: number) => (clock = new Date(clock.getTime() + minutes * MINUTE));
  return { mint, client, write, advance, usedTokens };
}

describe("orchestratorClient", () => {
  it("mints the orchestrator App's token through core with orchestrator-app.pem at its first call, not before", async () => {
    const { mint, write } = harness();
    assert.deepEqual(mint.calls, []);
    await write();
    assert.deepEqual(mint.calls, [{ app: "orchestrator", appId: APP_ID, keyFile: "orchestrator-app.pem", plugin: "orchestrator", repo: REPO }]);
  });

  it("writes with the held token while at least 10 minutes are left", async () => {
    const { mint, write, advance, usedTokens } = harness();
    await write();
    advance(50);
    await write();
    assert.equal(mint.calls.length, 1);
    assert.equal(usedTokens.length, 2);
    assert.equal(usedTokens[1], usedTokens[0]);
  });

  it("mints again before a write once under 10 minutes are left, and writes with the new token", async () => {
    const { mint, write, advance, usedTokens } = harness();
    await write();
    advance(51);
    await write();
    assert.equal(mint.calls.length, 2);
    assert.notEqual(usedTokens[1], usedTokens[0]);
  });

  it("mints once for calls made together, first and again", async () => {
    const { mint, write, advance } = harness();
    await Promise.all([write(), write(), write()]);
    assert.equal(mint.calls.length, 1);
    advance(51);
    await Promise.all([write(), write(), write()]);
    assert.equal(mint.calls.length, 2);
  });

  it("holds the token in memory: nothing appears under HOME", async (t: TestContext) => {
    const home = tempHome(t);
    const before = process.env.HOME;
    process.env.HOME = home;
    t.after(() => (process.env.HOME = before));
    const { write, advance } = harness();
    await write();
    advance(51);
    await write();
    assert.deepEqual(readdirSync(home), []);
  });

  it("lets a failed mint through, and writes nothing", async () => {
    const { write, usedTokens } = harness(new MintError("dummy cause"));
    await assert.rejects(write(), MintError);
    assert.deepEqual(usedTokens, []);
  });
});
