import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const HOOKS = new URL("../plugin/hooks/hooks.json", import.meta.url);
const TOKEN = { type: "command", command: "node ${CLAUDE_PLUGIN_ROOT}/hooks/token.ts", onFailure: "block" };

it("runs token.ts on SessionStart and before every Bash call, blocking on its failure", () => {
  assert.deepEqual(JSON.parse(readFileSync(HOOKS, "utf8")), {
    hooks: {
      SessionStart: [{ hooks: [TOKEN] }],
      PreToolUse: [{ matcher: "Bash", hooks: [TOKEN] }],
    },
  });
});
