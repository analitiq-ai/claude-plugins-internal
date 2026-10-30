import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

import { ALLOWED_PLUGINS, REQUIRED_SETTINGS, UNCHECKED_FOLDERS, UNCHECKED_SETTINGS } from "../src/keys.ts";

const SECURITY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "SECURITY.md");

function section5Block(markdown: string): Record<string, unknown> {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## 5. "));
  assert.notEqual(start, -1, "SECURITY.md has no §5");
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => line.startsWith("## "));
  const section = (end === -1 ? after : after.slice(0, end)).join("\n");
  const blocks = [...section.matchAll(/^```json\n([\s\S]*?)\n```$/gm)];
  assert.equal(blocks.length, 1, "SECURITY.md §5 holds one JSON block");
  return JSON.parse(blocks[0][1]);
}

type Entry = { setting: string; value: unknown };

// A list's items are entries of their own: the table requires a list to hold items, not to equal §5's.
function entries(node: Record<string, unknown>, prefix = ""): Entry[] {
  return Object.entries(node).flatMap(([key, value]): Entry[] => {
    const setting = `${prefix}${key}`;
    if (Array.isArray(value)) {
      return value.length === 0 ? [{ setting, value }] : value.map((item) => ({ setting, value: item }));
    }
    if (typeof value === "object" && value !== null) return entries(value as Record<string, unknown>, `${setting}.`);
    return [{ setting, value }];
  });
}

// §5's `<V>/keys`, `<V>/state` and `<V>/orchestrator` read as `<K>`, `<S>` and `<O>`, `/<V>` being a permission
// rule's absolute form of the same folder.
function asTableWrites(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value
    .replace(/\/?<V>\/keys/g, "<K>")
    .replace(/\/?<V>\/state/g, "<S>")
    .replace(/\/?<V>\/orchestrator/g, "<O>");
}

function under(setting: string, parent: string): boolean {
  return setting === parent || setting.startsWith(`${parent}.`);
}

function unchecked({ setting, value }: Entry): boolean {
  if (Object.keys(UNCHECKED_SETTINGS).some((parent) => under(setting, parent))) return true;
  return typeof value === "string" && Object.keys(UNCHECKED_FOLDERS).some((folder) => value.includes(folder));
}

function required({ setting, value }: Entry): boolean {
  const row = REQUIRED_SETTINGS.find((candidate) => candidate.setting === setting);
  if (row === undefined) return false;
  if ("equals" in row) return isDeepStrictEqual(row.equals, value);
  if ("equalsPath" in row) return row.equalsPath === value;
  const items: readonly string[] = "holdsPaths" in row ? row.holdsPaths : row.holdsRules;
  return typeof value === "string" && items.includes(value);
}

function strays(block: Record<string, unknown>): string[] {
  return entries(block)
    .filter((entry) => !under(entry.setting, "enabledPlugins"))
    .map((entry) => ({ setting: entry.setting, value: asTableWrites(entry.value) }))
    .filter((entry) => !unchecked(entry) && !required(entry))
    .map(({ setting, value }) => `§5 ${setting}: ${JSON.stringify(value)} is in neither keys.ts's table nor its exceptions`);
}

// An exception no §5 entry falls under excuses nothing today, and would let an entry §5 adds under it later in
// unchecked.
function unused(block: Record<string, unknown>): string[] {
  const all = entries(block);
  const settings = Object.keys(UNCHECKED_SETTINGS).filter((parent) => !all.some(({ setting }) => under(setting, parent)));
  const folders = Object.keys(UNCHECKED_FOLDERS).filter(
    (folder) => !all.some(({ value }) => typeof value === "string" && value.includes(folder)),
  );
  return [...settings, ...folders].map((exception) => `keys.ts's exception ${JSON.stringify(exception)} matches no entry of §5`);
}

function enabled(block: Record<string, unknown>): string[] {
  const plugins = (block.enabledPlugins ?? {}) as Record<string, unknown>;
  return Object.entries(plugins)
    .filter(([, on]) => on === true)
    .map(([name]) => name)
    .sort();
}

describe("keys.ts against SECURITY.md §5", () => {
  const block = section5Block(readFileSync(SECURITY, "utf8"));

  it("holds every entry of §5's JSON block in its required settings or its named exceptions", () => {
    assert.deepEqual(strays(block), []);
  });

  it("uses every exception it names", () => {
    assert.deepEqual(unused(block), []);
  });

  it("names an exception no entry of §5 falls under", () => {
    const changed = structuredClone(block) as { sandbox: { network: Record<string, unknown> } };
    delete changed.sandbox.network.allowedDomains;
    assert.deepEqual(unused(changed), [`keys.ts's exception "sandbox.network.allowedDomains" matches no entry of §5`]);
  });

  it("allows exactly the plugins §5's enabledPlugins enables", () => {
    assert.deepEqual([...ALLOWED_PLUGINS].sort(), enabled(block));
  });

  it("names an entry §5 adds, one whose value differs, and one a list adds", () => {
    const changed = structuredClone(block) as {
      sandbox: Record<string, unknown>;
      permissions: { deny: string[] };
    };
    changed.sandbox.enabled = false;
    changed.sandbox.newSetting = true;
    changed.permissions.deny.push("Edit(**/new/**)");
    const stray = (entry: string) => `§5 ${entry} is in neither keys.ts's table nor its exceptions`;
    assert.deepEqual(strays(changed), [
      stray("sandbox.enabled: false"),
      stray("sandbox.newSetting: true"),
      stray('permissions.deny: "Edit(**/new/**)"'),
    ]);
  });

  it("reads <V>/orchestrator as the orchestrator's folder and names a GH_CONFIG_DIR written from ~", () => {
    const changed = structuredClone(block) as {
      sandbox: { filesystem: { denyWrite: string[] } };
      permissions: { deny: string[] };
      env: Record<string, string>;
    };
    changed.sandbox.filesystem.denyWrite.push("<V>/orchestrator");
    changed.permissions.deny.push("Edit(/<V>/orchestrator/**)");
    changed.env.GH_CONFIG_DIR = "<V>/orchestrator/gh";
    assert.deepEqual(strays(changed), []);
    changed.env.GH_CONFIG_DIR = "~/.local/state/codeworks/orchestrator/gh";
    assert.deepEqual(strays(changed), [
      `§5 env.GH_CONFIG_DIR: "~/.local/state/codeworks/orchestrator/gh" is in neither keys.ts's table nor its exceptions`,
    ]);
  });
});
