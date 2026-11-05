import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { tempHome } from "./support/session.ts";

const PLUGIN = fileURLToPath(new URL("../plugin/", import.meta.url));

// Each entry and the samples of the events it is for (contracts/hooks.md).
const ENTRIES: Record<string, string[]> = {
  "pre-tool-use.ts": ["pre-tool-use"],
  "post-tool-use.ts": ["post-tool-use"],
  "user-prompt-submit.ts": ["user-prompt-submit"],
  "subagent.ts": ["subagent-start", "subagent-stop"],
  "session-start.ts": ["session-start"],
};

function sample(name: string): string {
  return readFileSync(new URL(`./fixtures/hooks/${name}.json`, import.meta.url), "utf8");
}

function runEntry(entry: string, input: string, home: string) {
  return spawnSync(process.execPath, [join(PLUGIN, "hooks", entry)], {
    input,
    env: { PATH: process.env.PATH, HOME: home },
    encoding: "utf8",
  });
}

// A static import or re-export starting a line; `import type` is erased before Node runs the file, so it loads nothing.
const STATIC_IMPORT = /^(?:import|export)\s+(?!type\s)(?:[^;]*?\bfrom\s*)?["']([^"']+)["']/gm;

describe("reviewer's TS hook entries, unregistered until the cutover", () => {
  it("are the only .ts files in hooks/", () => {
    const entries = readdirSync(join(PLUGIN, "hooks")).filter((name) => name.endsWith(".ts"));
    assert.deepEqual(entries.sort(), Object.keys(ENTRIES).sort());
  });

  for (const [entry, samples] of Object.entries(ENTRIES)) {
    for (const name of samples) {
      it(`${entry} allows a ${name} input, saying nothing and writing nothing under HOME`, (t) => {
        const home = tempHome(t);
        const run = runEntry(entry, sample(name), home);
        assert.equal(run.status, 0, run.stderr);
        assert.equal(run.stdout, "");
        assert.equal(run.stderr, "");
        assert.deepEqual(readdirSync(home), []);
      });
    }

    it(`${entry} denies an input that is not JSON, naming reviewer`, (t) => {
      const run = runEntry(entry, "{", tempHome(t));
      assert.equal(run.status, 2);
      assert.match(run.stderr, /^reviewer: .*not JSON/);
    });

    it(`${entry} statically imports ../lib/guarded.ts and nothing else, so the guard runs before any package loads`, () => {
      const text = readFileSync(join(PLUGIN, "hooks", entry), "utf8");
      assert.deepEqual([...text.matchAll(STATIC_IMPORT)].map((match) => match[1]), ["../lib/guarded.ts"]);
    });
  }

  it("are named by no command in hooks/hooks.json yet", () => {
    const registered = readFileSync(join(PLUGIN, "hooks", "hooks.json"), "utf8");
    assert.doesNotMatch(registered, /\.ts\b/);
  });
});
