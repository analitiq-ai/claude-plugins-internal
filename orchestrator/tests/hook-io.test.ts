import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { LaneRefused } from "../plugin/core/board.ts";
import { GhFolderRefused } from "../plugin/core/gh-config.ts";
import { GitFailed } from "../plugin/core/git.ts";
import { GitHubMisanswered, GitHubPartlyAnswered, GitHubRefused, GitHubUnanswered, RemoteRefused } from "../plugin/core/github.ts";
import { DerivationError } from "../plugin/core/identity.ts";
import { KeyReadRefused } from "../plugin/core/keys.ts";
import { SessionRecordRefused } from "../plugin/core/session-record.ts";
import { SettingsError } from "../plugin/core/settings.ts";
import { BoardNotVisible, LedgerMissing } from "../plugin/core/state.ts";
import { MintError } from "../plugin/core/tokens.ts";
import { context, HookInputRefused, PASS, readInput, refusalOf, refuse, refusing } from "../plugin/lib/hook-io.ts";

const PROMPT_INPUT = readFileSync(new URL("./fixtures/hooks/user-prompt-submit.json", import.meta.url), "utf8");
const { session_id, cwd } = JSON.parse(PROMPT_INPUT) as { session_id: string; cwd: string };

function input(fields: Record<string, unknown>): string {
  return JSON.stringify({ session_id, cwd, ...fields });
}

function refusedNaming(stdin: string, event: Parameters<typeof readInput>[0], named: string): void {
  assert.throws(
    () => readInput(event, stdin),
    (error: unknown) => {
      assert.ok(error instanceof HookInputRefused, String(error));
      assert.ok(error.message.includes(named), error.message);
      return true;
    },
  );
}

describe("readInput", () => {
  it("reads the recorded UserPromptSubmit input, the fields Claude Code adds besides", () => {
    assert.deepEqual(readInput("UserPromptSubmit", PROMPT_INPUT), {
      session_id,
      cwd,
      hook_event_name: "UserPromptSubmit",
      prompt: "/codeworks 212",
    });
  });

  it("reads SessionStart, PreToolUse on Bash, and Stop with and without background_tasks", () => {
    assert.equal(readInput("SessionStart", input({ hook_event_name: "SessionStart", source: "startup" })).session_id, session_id);
    assert.equal(readInput("PreToolUse", input({ hook_event_name: "PreToolUse", tool_name: "Bash" })).tool_name, "Bash");
    assert.equal(readInput("Stop", input({ hook_event_name: "Stop" })).background_tasks, undefined);
    const tasks = [{ type: "workflow", status: "running", id: "dummy" }];
    assert.deepEqual(readInput("Stop", input({ hook_event_name: "Stop", background_tasks: tasks })).background_tasks, [
      { type: "workflow", status: "running" },
    ]);
  });

  it("refuses a session_id that is not a UUID, since it names the session's record file", () => {
    refusedNaming(input({ hook_event_name: "SessionStart", session_id: "../escape" }), "SessionStart", "session_id");
  });

  it("refuses a cwd that is not an absolute path", () => {
    refusedNaming(input({ hook_event_name: "SessionStart", cwd: "work/repo" }), "SessionStart", "cwd");
  });

  it("refuses an input of another event than the one the file serves", () => {
    refusedNaming(PROMPT_INPUT, "PreToolUse", "hook_event_name");
  });

  it("refuses a UserPromptSubmit whose prompt is missing or not a string", () => {
    refusedNaming(input({ hook_event_name: "UserPromptSubmit" }), "UserPromptSubmit", "prompt");
    refusedNaming(input({ hook_event_name: "UserPromptSubmit", prompt: 212 }), "UserPromptSubmit", "prompt");
  });

  it("refuses a PreToolUse on any tool but Bash", () => {
    refusedNaming(input({ hook_event_name: "PreToolUse", tool_name: "Read" }), "PreToolUse", "tool_name");
  });

  it("refuses background_tasks that are not a list of {type, status}", () => {
    refusedNaming(input({ hook_event_name: "Stop", background_tasks: [{ type: "workflow" }] }), "Stop", "background_tasks");
    refusedNaming(input({ hook_event_name: "Stop", background_tasks: "workflow" }), "Stop", "background_tasks");
  });

  it("refuses stdin that is not JSON, naming the event", () => {
    refusedNaming("/codeworks 212", "UserPromptSubmit", "UserPromptSubmit");
  });
});

describe("refuse and context", () => {
  it("a refusal exits 2 with exactly one stderr line prefixed orchestrator: and nothing on stdout", () => {
    assert.deepEqual(refuse("#212 is held"), { code: 2, stdout: "", stderr: "orchestrator: #212 is held\n" });
  });

  it("a refusal folds a reason of several lines into one", () => {
    const { stderr } = refuse("codeworks.toml [orchestrator]: ✖ Invalid input\n  → at app_id\n");
    assert.equal(stderr, "orchestrator: codeworks.toml [orchestrator]: ✖ Invalid input → at app_id\n");
  });

  it("context exits 0 with the hook's additionalContext as its JSON output", () => {
    const answer = context("UserPromptSubmit", "[orchestrator] 212 claimed: run builder:issue-tackle 212");
    assert.equal(answer.code, 0);
    assert.equal(answer.stderr, "");
    assert.deepEqual(JSON.parse(answer.stdout), {
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: "[orchestrator] 212 claimed: run builder:issue-tackle 212",
      },
    });
  });
});

describe("refusalOf", () => {
  const named = [
    new MintError("dummy cause"),
    new KeyReadRefused("/home/dummy/.config/codeworks/session-app.pem", ["dummy reason"]),
    new GhFolderRefused("/home/dummy/.local/state/codeworks/orchestrator/gh", "dummy why"),
    new GitHubRefused(403, "dummy refusal"),
    new GitHubUnanswered("dummy: no answer"),
    new GitHubMisanswered("dummy: not the shape asked"),
    new GitHubPartlyAnswered("dummy: answered in part"),
    new SettingsError("codeworks.toml [orchestrator]", "dummy why"),
    new RemoteRefused("https://example.invalid/acme/widgets", "dummy why"),
    new HookInputRefused("dummy why"),
    new GitFailed(["remote", "get-url", "origin"], 2, "error: No such remote 'origin'\n"),
    new LaneRefused("dummy why"),
    new DerivationError("the blockers of acme/widgets#212", "in another repository: acme/gadgets#7"),
    new BoardNotVisible("https://github.com/orgs/acme/projects/1"),
    new LedgerMissing("acme/widgets"),
    new SessionRecordRefused("/home/dummy/.local/state/codeworks/orchestrator/sessions/dummy.json", "dummy why"),
  ];

  for (const error of named) {
    it(`names a ${error.name} by its message`, () => {
      assert.equal(refusalOf(error), error.message);
    });
  }

  it("names nothing else, so the hook crashes on it", () => {
    assert.equal(refusalOf(new TypeError("dummy")), null);
    assert.equal(refusalOf("dummy"), null);
  });
});

describe("refusing", () => {
  it("answers what the hook answers", async () => {
    assert.deepEqual(await refusing(async () => PASS), PASS);
  });

  it("refuses a failure core names a cause for, by its message", async () => {
    assert.deepEqual(await refusing(async () => Promise.reject(new MintError("dummy cause"))), refuse("mint failed: dummy cause"));
  });

  it("lets any other failure through, so the hook crashes", async () => {
    await assert.rejects(refusing(async () => Promise.reject(new TypeError("dummy"))), TypeError);
  });
});
