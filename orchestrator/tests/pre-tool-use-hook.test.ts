import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readGhToken } from "../plugin/core/gh-config.ts";
import { KeyReadRefused } from "../plugin/core/keys.ts";
import { MintError } from "../plugin/core/tokens.ts";
import { run } from "../plugin/hooks/pre-tool-use.ts";
import { PASS } from "../plugin/lib/hook-io.ts";
import { ghFolder } from "../plugin/lib/paths.ts";
import { REPO, scratchCheckout } from "./support/checkout.ts";
import { hookDeps, hookInput, storeSessionToken } from "./support/hook-run.ts";
import { READY_STORY, storyGitHub } from "./support/story.ts";

// PreToolUse's input is UserPromptSubmit's common fields with its own event and tool.
function bashCall(cwd: string): string {
  return hookInput("user-prompt-submit.json", { cwd, hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: { command: "gh pr list" } });
}

describe("the PreToolUse hook on Bash", () => {
  it("with 10 minutes or more left, mints nothing and calls GitHub not at all", async (t) => {
    const { home, deps, mint, connects } = hookDeps(t, storyGitHub(READY_STORY));
    const value = storeSessionToken(home, 10);
    assert.deepEqual(await run(bashCall(scratchCheckout(t)), deps), PASS);
    assert.deepEqual(mint.calls, []);
    assert.equal(connects(), 0);
    assert.equal(readGhToken(ghFolder(home))?.value, value);
  });

  it("with under 10 minutes left, writes a new token before the call runs", async (t) => {
    const { home, deps, mint } = hookDeps(t, storyGitHub(READY_STORY));
    const value = storeSessionToken(home, 9);
    assert.deepEqual(await run(bashCall(scratchCheckout(t)), deps), PASS);
    assert.deepEqual(mint.calls.map(({ app }) => app), ["orchestrator", "session"]);
    const stored = readGhToken(ghFolder(home));
    assert.notEqual(stored?.value, value);
    assert.equal(stored?.repo, REPO);
  });

  it("refuses the call naming core's cause when the mint fails, keeping the stored token", async (t) => {
    const { home, deps } = hookDeps(t, storyGitHub(READY_STORY), { session: new MintError("dummy cause") });
    const value = storeSessionToken(home, 9);
    assert.deepEqual(await run(bashCall(scratchCheckout(t)), deps), { code: 2, stdout: "", stderr: "orchestrator: mint failed: dummy cause\n" });
    assert.equal(readGhToken(ghFolder(home))?.value, value);
  });

  // US1 #6: core's refusal of a missing key, as readKey answers it.
  it("refuses the call naming the key's path when there is no key", async (t) => {
    const key = "/home/dummy/.config/codeworks/session-app.pem";
    const { deps } = hookDeps(t, storyGitHub(READY_STORY), { session: new KeyReadRefused(key, ["does not exist"]) });
    assert.deepEqual(await run(bashCall(scratchCheckout(t)), deps), { code: 2, stdout: "", stderr: `orchestrator: ${key}: does not exist\n` });
  });
});
