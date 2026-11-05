import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const HOOKS = new URL("../plugin/hooks/hooks.json", import.meta.url);

// The root is quoted: a plugin path holding a space would otherwise split the command, and with onFailure block
// the hook that cannot start holds every call it is registered on.
const command = (file: string) => ({ type: "command", command: `node "\${CLAUDE_PLUGIN_ROOT}/hooks/${file}"`, onFailure: "block" });

// contracts/hooks.md's table, Story 1's rows.
it("registers each Story 1 hook with the contract's matcher, file, timeout and onFailure", () => {
  assert.deepEqual(JSON.parse(readFileSync(HOOKS, "utf8")), {
    hooks: {
      SessionStart: [{ hooks: [{ ...command("session-start.ts"), timeout: 60 }] }],
      UserPromptSubmit: [{ hooks: [{ ...command("prompt.ts"), timeout: 120 }] }],
      PreToolUse: [{ matcher: "Bash", hooks: [{ ...command("pre-tool-use.ts"), timeout: 60 }] }],
    },
  });
});
