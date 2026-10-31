import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { it } from "node:test";

const COMMAND = new URL("../plugin/commands/codeworks.md", import.meta.url);

// R20: the command exists so `/codeworks <issue>` reaches the hook as typed; every fact comes from the hook.
it("makes /codeworks a command whose body only defers to the hook's [orchestrator] context", () => {
  const [, frontmatter, body] = /^---\n([\s\S]*?)\n---\n([\s\S]*)$/.exec(readFileSync(COMMAND, "utf8")) ?? [];
  assert.ok(frontmatter !== undefined, "no frontmatter");
  assert.match(frontmatter, /^description: \S/m);
  assert.match(frontmatter, /^argument-hint: <issue>$/m);
  assert.match(body, /\[orchestrator\]/);
  assert.doesNotMatch(body, /\$ARGUMENTS|\d/);
});
