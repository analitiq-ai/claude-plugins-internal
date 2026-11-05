import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { importSpecifiers } from "../../core/tests/source-scan.ts";
import { type HookAnswer, run, STORY_IS_ONE_PR } from "../plugin/hooks/pre-tool-use.ts";

const PLUGIN = new URL("../plugin/", import.meta.url);
const FOLDER = "/home/admin/work/repo/specs/217-rebuild-issue-tackle";

// The entry file hooks.json registers, so a renamed file fails here and not as a hook error on every Write.
function registeredHook(): string {
  const registration = JSON.parse(readFileSync(new URL("hooks/hooks.json", PLUGIN), "utf8")) as {
    hooks: { PreToolUse: { hooks: { command: string }[] }[] };
  };
  const command = registration.hooks.PreToolUse[0].hooks[0].command;
  const file = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/(.+)"$/.exec(command)?.[1];
  assert.ok(file !== undefined, `the registered command is ${command}`);
  return fileURLToPath(new URL(file, PLUGIN));
}

const HOOK = registeredHook();

// A PreToolUse input as Claude Code sends it for a file tool: file_path arrives absolute.
function fileCall(tool: string, file_path: string, fields: Record<string, unknown> = {}): string {
  return JSON.stringify({
    session_id: "315ad922-f2f9-4e13-8101-acdad2093cfc",
    transcript_path: "/home/admin/.claude/projects/-home-admin-work-repo/315ad922-f2f9-4e13-8101-acdad2093cfc.jsonl",
    cwd: "/home/admin/work/repo",
    permission_mode: "default",
    hook_event_name: "PreToolUse",
    tool_name: tool,
    tool_input: { file_path, content: "# Plan\n" },
    tool_use_id: "toolu_01ABC123",
    ...fields,
  });
}

// Whole answers, written here rather than taken from the hook: a key beside additionalContext (permissionDecision,
// decision) would turn context into a ruling, and a pass that wrote anything would be read as output.
const REMINDED: HookAnswer = {
  code: 0,
  stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: STORY_IS_ONE_PR } })}\n`,
  stderr: "",
};
const PASSED: HookAnswer = { code: 0, stdout: "", stderr: "" };

describe("the PreToolUse hook on Write and Edit", () => {
  it("answers a Write of a spec folder's plan.md with the reminder as context and nothing else", () => {
    assert.deepEqual(run(fileCall("Write", `${FOLDER}/plan.md`)), REMINDED);
  });

  it("says that a story is one PR and that a part landing later is its own story", () => {
    assert.match(STORY_IS_ONE_PR, /one branch and one PR/);
    assert.match(STORY_IS_ONE_PR, /its own story/);
  });

  it("answers an Edit of a spec folder's tasks.md the same", () => {
    const edit = fileCall("Edit", `${FOLDER}/tasks.md`, { tool_input: { file_path: `${FOLDER}/tasks.md`, old_string: "a", new_string: "b" } });
    assert.deepEqual(run(edit), REMINDED);
  });

  for (const [what, path] of [
    ["the spec folder's spec.md", `${FOLDER}/spec.md`],
    ["a plan.md outside specs/", "/home/admin/work/repo/plan.md"],
    ["a plan.md directly in specs/", "/home/admin/work/repo/specs/plan.md"],
    ["a plan.md deeper in the spec folder", `${FOLDER}/critiques/plan.md`],
    ["a plan.md under a folder whose name merely ends in specs", "/home/admin/work/repo/myspecs/217-x/plan.md"],
    ["a file named like plan.md with more", `${FOLDER}/plan.md.bak`],
  ]) {
    it(`passes ${what} with no output`, () => {
      assert.deepEqual(run(fileCall("Write", path)), PASSED);
    });
  }

  // The parser's own words follow the cause: they differ by Node version, so only the cause is pinned.
  it("reports an input that is not JSON with exit 1, which does not block the call", () => {
    const answer = run("{");
    assert.equal(answer.code, 1);
    assert.equal(answer.stdout, "");
    assert.match(answer.stderr, /^planner: the PreToolUse input is not JSON: .+\n$/);
  });

  const UNREADABLE: [string, Record<string, unknown>][] = [
    ["without a file_path", { content: "" }],
    ["whose file_path is not a string", { file_path: 5 }],
  ];
  for (const [what, tool_input] of UNREADABLE) {
    it(`reports a file call ${what}`, () => {
      assert.deepEqual(run(fileCall("Write", `${FOLDER}/plan.md`, { tool_input })), {
        code: 1,
        stdout: "",
        stderr: "planner: the PreToolUse input has no tool_input.file_path\n",
      });
    });
  }
});

describe("the hook's entry file", () => {
  // Node's own modules alone: the hook runs on an install whose packages never arrived, and cannot reach core's
  // keys or GitHub.
  it("imports nothing but node: modules", () => {
    const specifiers = importSpecifiers(readFileSync(HOOK, "utf8"), HOOK).map(({ specifier }) => specifier);
    assert.deepEqual(specifiers, ["node:path", "node:stream/consumers"]);
  });

  // The parent's PATH and nothing else of its environment: a NODE_OPTIONS of the machine would land on stderr.
  function hook(stdin: string): HookAnswer {
    const ran = spawnSync(process.execPath, [HOOK], { input: stdin, encoding: "utf8", timeout: 10_000, env: { PATH: process.env.PATH } });
    assert.equal(ran.error, undefined);
    assert.ok(ran.status === 0 || ran.status === 1, `exit ${ran.status}: ${ran.stderr}`);
    return { code: ran.status, stdout: ran.stdout, stderr: ran.stderr };
  }

  it("run as a process, writes the reminder for a spec folder's plan.md and exits 0", () => {
    assert.deepEqual(hook(fileCall("Write", `${FOLDER}/plan.md`)), REMINDED);
  });

  it("run as a process, writes nothing for another file and exits 0", () => {
    assert.deepEqual(hook(fileCall("Write", `${FOLDER}/spec.md`)), PASSED);
  });

  it("run as a process on an empty stdin, reports on stderr and exits 1", () => {
    const answer = hook("");
    assert.equal(answer.code, 1);
    assert.equal(answer.stdout, "");
    assert.match(answer.stderr, /^planner: the PreToolUse input is not JSON: .+\n$/);
  });
});
