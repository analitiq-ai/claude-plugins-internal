import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { fakeGitHub, type FakeAnswer } from "../../core/tests/support/fake-github.ts";
import { readGhToken } from "../plugin/core/gh-config.ts";
import { MintError } from "../plugin/core/tokens.ts";
import { run } from "../plugin/hooks/session-start.ts";
import { PASS } from "../plugin/lib/hook-io.ts";
import { ghFolder } from "../plugin/lib/paths.ts";
import { contentsAnswer, REPO, scratchCheckout, SETTINGS, STATUS_ISSUE } from "./support/checkout.ts";
import { hookDeps, hookInput, storeSessionToken } from "./support/hook-run.ts";
import { writes } from "./support/story.ts";

const CAUSE_KEY = "session-start-mint-failed-dummy-cause";

// GitHub as SessionStart reads it: the settings at the default branch, and the status issue's comments.
function statusGitHub(comments: FakeAnswer = []) {
  return fakeGitHub({
    rest: {
      "GET /repos/acme/widgets": { default_branch: "main" },
      "GET /repos/acme/widgets/contents/codeworks.toml?ref=main": contentsAnswer(SETTINGS),
      [`POST /repos/acme/widgets/issues/${STATUS_ISSUE}/comments`]: {},
    },
    graphqlPages: [{ when: (query, vars) => query.includes("comments(") && vars.number === STATUS_ISSUE, answer: comments }],
  });
}

describe("the SessionStart hook", () => {
  it("leaves a session token for the checkout's repository in the gh folder", async (t) => {
    const { home, deps, mint } = hookDeps(t, statusGitHub());
    assert.deepEqual(await run(hookInput("session-start.json", { cwd: scratchCheckout(t) }), deps), PASS);
    assert.equal(readGhToken(ghFolder(home))?.repo, REPO);
    assert.deepEqual(mint.calls.map(({ app }) => app), ["orchestrator", "session"]);
  });

  it("with a stored token that will do, mints nothing and calls GitHub not at all", async (t) => {
    const { home, deps, mint, connects } = hookDeps(t, statusGitHub());
    storeSessionToken(home, 30);
    assert.deepEqual(await run(hookInput("session-start.json", { cwd: scratchCheckout(t) }), deps), PASS);
    assert.deepEqual(mint.calls, []);
    assert.equal(connects(), 0);
  });

  it("on a failed mint posts the cause on the status issue under its key, and exits 0", async (t) => {
    const github = statusGitHub();
    const { deps } = hookDeps(t, github, { session: new MintError("dummy cause") });
    assert.deepEqual(await run(hookInput("session-start.json", { cwd: scratchCheckout(t) }), deps), PASS);
    assert.deepEqual(writes(github.calls), [`comment <!-- codeworks:orchestrator-reason ${CAUSE_KEY} -->`]);
    const post = github.calls.find((call) => call.kind === "rest" && call.method === "POST");
    assert.ok(post?.kind === "rest");
    assert.match((post.body as { body: string }).body, /\nmint failed: dummy cause$/);
  });

  it("posts a cause already on the status issue no second time", async (t) => {
    const handled = {
      databaseId: 902,
      author: { __typename: "Bot", login: "codeworks-orchestrator" },
      body: `<!-- codeworks:orchestrator-reason ${CAUSE_KEY} -->\nmint failed: dummy cause`,
      createdAt: "2026-10-29T10:00:00Z",
      lastEditedAt: null,
      url: "https://github.com/acme/widgets/issues/1#issuecomment-902",
    };
    const github = statusGitHub([handled]);
    const { deps } = hookDeps(t, github, { session: new MintError("dummy cause") });
    assert.deepEqual(await run(hookInput("session-start.json", { cwd: scratchCheckout(t) }), deps), PASS);
    assert.deepEqual(writes(github.calls), []);
  });

  it("refuses, naming core's cause, a failure before it can read the status issue", async (t) => {
    const github = statusGitHub();
    const { home, deps } = hookDeps(t, github, { orchestrator: new MintError("dummy cause") });
    const answer = await run(hookInput("session-start.json", { cwd: scratchCheckout(t) }), deps);
    assert.deepEqual(answer, { code: 2, stdout: "", stderr: "orchestrator: mint failed: dummy cause\n" });
    assert.equal(readGhToken(ghFolder(home)), null);
  });
});
