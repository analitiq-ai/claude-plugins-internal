import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/", import.meta.url));
const GUARD = "lib/guarded.ts";
// The input each entry answers; the guard reads none, so any will do.
const INPUT_OF: Record<string, string> = {
  [GUARD]: "pre-tool-use.json",
  "hooks/post-tool-use.ts": "post-tool-use.json",
  "hooks/pre-tool-use.ts": "pre-tool-use.json",
  "hooks/session-start.ts": "session-start.json",
  "hooks/subagent.ts": "subagent-start.json",
  "hooks/user-prompt-submit.ts": "user-prompt-submit.json",
};

type Copy = { root: string; home: string };

function hookEntries(root: string): string[] {
  return readdirSync(join(root, "hooks"))
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => `hooks/${name}`);
}

// The plugin as an install leaves it: the `core` link dereferenced, its packages installed. They are copied from the
// plugin's own node_modules rather than fetched again, so the test makes no network call.
function installedCopy(t: TestContext): Copy {
  assert.ok(existsSync(join(PLUGIN, "node_modules")), `${PLUGIN}node_modules is missing: run npm ci in reviewer/plugin`);
  // realpath: Node reports the guard's URL with symlinks resolved, and the root it names is compared against it.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "reviewer-guarded-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const root = join(tmp, "reviewer");
  // Not fs.cpSync: its `dereference` copies a link below the top folder as a link, so `core` would still reach the
  // repository's core/src and its node_modules.
  const copy = spawnSync("cp", ["-rL", PLUGIN, root], { encoding: "utf8" });
  assert.equal(copy.status, 0, `cp -rL ${PLUGIN} ${root}: ${copy.stderr}`);
  const home = join(tmp, "home");
  mkdirSync(home);
  return { root, home };
}

function run({ root, home }: Copy, entry: string) {
  return spawnSync(process.execPath, [join(root, entry)], {
    input: readFileSync(new URL(`./fixtures/hooks/${INPUT_OF[entry]}`, import.meta.url), "utf8"),
    env: { PATH: process.env.PATH, HOME: home },
    encoding: "utf8",
  });
}

describe("the guard every reviewer hook imports first, in an installed copy", () => {
  it("with every package installed: the guard passes silently and each hook allows its input", (t) => {
    const copy = installedCopy(t);
    assert.deepEqual([GUARD, ...hookEntries(copy.root)], Object.keys(INPUT_OF));
    for (const entry of [GUARD, ...hookEntries(copy.root)]) {
      const passed = run(copy, entry);
      assert.equal(passed.status, 0, `${entry}: ${passed.stderr}`);
      assert.equal(passed.stdout + passed.stderr, "", entry);
    }
  });

  // zod is a package core needs; diff-match-patch one only reviewer pins, so the guard reads the carrier's own list.
  for (const name of ["zod", "diff-match-patch"]) {
    it(`with ${name} removed: the guard and every hook exit 2 naming ${name} and the plugin folder, and write nothing`, (t) => {
      const copy = installedCopy(t);
      rmSync(join(copy.root, "node_modules", name), { recursive: true });
      for (const entry of [GUARD, ...hookEntries(copy.root)]) {
        const refused = run(copy, entry);
        assert.equal(refused.status, 2, `${entry}: ${refused.stderr}`);
        assert.equal(refused.stderr, `core dependency ${name} is not installed in ${copy.root}\n`, entry);
        assert.equal(refused.stdout, "", entry);
        assert.deepEqual(readdirSync(copy.home), [], `${entry} wrote under HOME`);
      }
    });
  }
});
