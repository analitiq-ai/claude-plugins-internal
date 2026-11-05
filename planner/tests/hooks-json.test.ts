import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const PLUGIN = new URL("../plugin/", import.meta.url);

function readJson(path: string): unknown {
  return JSON.parse(readFileSync(new URL(path, PLUGIN), "utf8"));
}

// One registration, Write|Edit alone, `onFailure: "continue"` said outright: "block" would let a hook failure hold
// up the call the hook was only to give context to, and the field left unset blocks a shell-form hook's exit 1 on
// Windows without Git Bash. A SessionStart or PreToolUse:Bash entry would be the token hook the admin dropped on
// 2026-10-29 (#194) back. The plugin root is quoted: a path holding a space would otherwise split the command.
it("registers the reminder hook on Write and Edit alone, with no failure of it holding up a call", () => {
  assert.deepEqual(readJson("hooks/hooks.json"), {
    hooks: {
      PreToolUse: [
        {
          matcher: "Write|Edit",
          hooks: [
            {
              type: "command",
              command: "node \"${CLAUDE_PLUGIN_ROOT}/hooks/pre-tool-use.ts\"",
              timeout: 10,
              onFailure: "continue",
            },
          ],
        },
      ],
    },
  });
});

it("declares its hooks in the default hooks file, not in plugin.json", () => {
  assert.equal(Object.hasOwn(readJson(".claude-plugin/plugin.json") as object, "hooks"), false);
});
