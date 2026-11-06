import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { fakeGitHub } from "../../core/tests/support/fake-github.ts";
import { Time } from "../plugin/core/contracts/scalars.ts";
import { writeGhToken } from "../plugin/core/gh-config.ts";
import { answerOf, GitHubRefused, GitHubUnanswered, type GitHubClient } from "../plugin/core/github.ts";
import { KeyReadRefused } from "../plugin/core/keys.ts";
import { ghFolder } from "../plugin/core/orchestrator-paths.ts";
import { MintError, type App, type MintedToken } from "../plugin/core/tokens.ts";
import { reviewerWriter, sessionReader } from "../plugin/lib/github.ts";
import { CouldNotRun } from "../plugin/lib/hook-io.ts";
import { tempHome } from "./support/session.ts";

const REPO = "acme/widgets";
const APP_ID = 7654321;
const RETRY = "retry the step";
const FIX_THEN_RETRY = "fix what it names, then retry the step";
const AFTER_SESSION_MINT = "make a Bash call or send a prompt, on which the orchestrator mints the session token, then retry the step";
const EXPIRES_AT = "2026-10-30T13:00:00Z";
// An hour before the stored token expires: well inside what core lets a token be used for.
const NOW = new Date("2026-10-30T12:00:00Z");

type MintCall = { app: App; appId: number; keyFile: string; plugin: string; repo: string };

function fakeMint(failure?: Error) {
  const calls: MintCall[] = [];
  const mintToken = async (app: App, appId: number, keyFile: string, plugin: string, repo: string): Promise<MintedToken> => {
    calls.push({ app, appId, keyFile, plugin, repo });
    if (failure !== undefined) throw failure;
    return { value: randomUUID(), app, repo, expires_at: "2026-10-30T13:00:00Z", permissions: { contents: "write" } };
  };
  return { calls, mintToken };
}

function recordingConnect() {
  const tokens: string[] = [];
  const client = fakeGitHub({});
  return { tokens, connect: (token: string): GitHubClient => (tokens.push(token), client), client };
}

function storeSessionToken(home: string, repo = REPO): string {
  const value = randomUUID();
  writeGhToken(ghFolder(home), { value, app: "session", repo, expires_at: EXPIRES_AT, permissions: {} }, "codeworks-session[bot]");
  return value;
}

/** What core throws for a GitHub answer that is not the shape asked. */
function misanswer(): Error {
  try {
    answerOf(Time, {}, "the expires_at of POST /app/installations/1/access_tokens");
  } catch (error) {
    return error as Error;
  }
  throw new Error("answerOf took an answer not of the shape asked");
}

function couldNotRunNaming(...named: string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof CouldNotRun, String(error));
    for (const part of named) assert.ok(error.message.includes(part), error.message);
    return true;
  };
}

/** As couldNotRunNaming, and its next step is `next`. */
function couldNotRunThen(next: string, ...named: string[]): (error: unknown) => true {
  return (error) => {
    couldNotRunNaming(...named)(error);
    assert.ok((error as Error).message.endsWith(`; ${next}`), (error as Error).message);
    return true;
  };
}

describe("sessionReader (R2)", () => {
  it("connects with the session token the orchestrator keeps in its gh folder", (t) => {
    const home = tempHome(t);
    const value = storeSessionToken(home);
    const { tokens, connect, client } = recordingConnect();
    assert.equal(sessionReader({ home, repo: REPO, now: NOW, connect }), client);
    assert.deepEqual(tokens, [value]);
  });

  // The orchestrator mints the session token on a Bash call or a prompt, when core's needsMint says it must.
  it("refuses as could not run when the gh folder holds no token, naming the folder, next a call on which the orchestrator mints it", (t) => {
    const home = tempHome(t);
    const { tokens, connect } = recordingConnect();
    assert.throws(() => sessionReader({ home, repo: REPO, now: NOW, connect }), couldNotRunThen(AFTER_SESSION_MINT, ghFolder(home)));
    assert.deepEqual(tokens, []);
  });

  it("refuses as could not run when the stored token is for another repository, naming the folder and this repository, next a call on which the orchestrator mints it", (t) => {
    const home = tempHome(t);
    storeSessionToken(home, "acme/other");
    const { tokens, connect } = recordingConnect();
    assert.throws(() => sessionReader({ home, repo: REPO, now: NOW, connect }), couldNotRunThen(AFTER_SESSION_MINT, ghFolder(home), REPO));
    assert.deepEqual(tokens, []);
  });

  for (const [what, now] of [
    ["expires within core's refresh margin", new Date(Date.parse(EXPIRES_AT) - 60_000)],
    ["has expired", new Date(Date.parse(EXPIRES_AT) + 60_000)],
  ] as const) {
    it(`refuses as could not run when the stored token ${what}, naming the folder, next a call on which the orchestrator mints it`, (t) => {
      const home = tempHome(t);
      storeSessionToken(home);
      const { tokens, connect } = recordingConnect();
      assert.throws(() => sessionReader({ home, repo: REPO, now, connect }), couldNotRunThen(AFTER_SESSION_MINT, ghFolder(home)));
      assert.deepEqual(tokens, []);
    });
  }

  it("refuses as could not run when the gh folder holds hosts.yml without codeworks-token.json, naming the folder", (t) => {
    const home = tempHome(t);
    mkdirSync(ghFolder(home), { recursive: true });
    writeFileSync(join(ghFolder(home), "hosts.yml"), "github.com:\n  oauth_token: dummy\n");
    const { tokens, connect } = recordingConnect();
    assert.throws(() => sessionReader({ home, repo: REPO, now: NOW, connect }), couldNotRunNaming(ghFolder(home)));
    assert.deepEqual(tokens, []);
  });

  it("refuses as could not run when codeworks-token.json is not JSON, naming the folder", (t) => {
    const home = tempHome(t);
    storeSessionToken(home);
    writeFileSync(join(ghFolder(home), "codeworks-token.json"), "{");
    const { tokens, connect } = recordingConnect();
    assert.throws(() => sessionReader({ home, repo: REPO, now: NOW, connect }), couldNotRunNaming(ghFolder(home)));
    assert.deepEqual(tokens, []);
  });
});

describe("reviewerWriter (R2)", () => {
  function writerOf(failure?: Error) {
    const mint = fakeMint(failure);
    const recorded = recordingConnect();
    const writer = reviewerWriter(REPO, APP_ID, { mintToken: mint.mintToken, connect: recorded.connect });
    return { mint, recorded, writer };
  }

  it("mints nothing until a write asks for the writer", () => {
    const { mint } = writerOf();
    assert.deepEqual(mint.calls, []);
  });

  it("mints the reviewer App's token for the repository once, however many writes in the run ask", async () => {
    const { mint, recorded, writer } = writerOf();
    const clients = await Promise.all([writer(), writer()]);
    clients.push(await writer());
    assert.deepEqual(mint.calls, [{ app: "reviewer", appId: APP_ID, keyFile: "reviewer-app.pem", plugin: "reviewer", repo: REPO }]);
    assert.equal(recorded.tokens.length, 1);
    for (const client of clients) assert.equal(client, recorded.client);
  });

  it("keeps no token across runs: each run's writer mints its own", async () => {
    const { mint, recorded } = writerOf();
    for (let run = 0; run < 2; run += 1) await reviewerWriter(REPO, APP_ID, { mintToken: mint.mintToken, connect: recorded.connect })();
    assert.equal(mint.calls.length, 2);
    assert.equal(recorded.tokens.length, 2);
    assert.notEqual(recorded.tokens[0], recorded.tokens[1]);
  });

  for (const [what, failure, next] of [
    ["MintError", new MintError("the reviewer App is not installed on acme/widgets"), FIX_THEN_RETRY],
    ["KeyReadRefused", new KeyReadRefused("/home/dummy/.config/codeworks/reviewer-app.pem", ["no managed settings name reviewer"]), FIX_THEN_RETRY],
    ["GitHubRefused", new GitHubRefused(401, "POST /app/installations/1/access_tokens: A JSON web token could not be decoded"), FIX_THEN_RETRY],
    ["GitHubUnanswered", new GitHubUnanswered("POST /app/installations/1/access_tokens: timed out"), RETRY],
    ["an answer not of the shape asked", misanswer(), RETRY],
  ] as const) {
    it(`refuses as could not run on a mint that throws ${what}, naming its message, next "${next}"`, async () => {
      const { recorded, writer } = writerOf(failure);
      await assert.rejects(writer(), couldNotRunThen(next, failure.message));
      assert.deepEqual(recorded.tokens, []);
    });
  }
});
