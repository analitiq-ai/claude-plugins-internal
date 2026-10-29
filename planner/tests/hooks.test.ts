import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { it } from "node:test";

const PLUGIN = new URL("../plugin/", import.meta.url);

// Planner keeps out of the session's environment: its scripts mint the token they need (root ADR-0007 d4).
it("declares no hook", () => {
  assert.equal(existsSync(new URL("hooks", PLUGIN)), false, "planner/plugin/hooks exists");
  const manifest = JSON.parse(readFileSync(new URL(".claude-plugin/plugin.json", PLUGIN), "utf8")) as Record<string, unknown>;
  assert.equal(Object.hasOwn(manifest, "hooks"), false, "plugin.json declares hooks");
});
