import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { moduleFiles } from "../../core/tests/source-scan.ts";

const PLUGIN = fileURLToPath(new URL("../plugin", import.meta.url));
const STEP = "scripts/step.ts";

const scripts = moduleFiles(join(PLUGIN, "scripts")).map((file) => relative(PLUGIN, file));

// The guard checks the plugin's own pins, so those are the packages to remove.
const pinned = Object.keys(
  (JSON.parse(readFileSync(join(PLUGIN, "package.json"), "utf8")) as { dependencies?: Record<string, string> })
    .dependencies ?? {},
);

type Copy = { root: string; home: string };

// The plugin as an install leaves it: the `core` link dereferenced, its packages installed. They are copied from the
// plugin's own node_modules rather than fetched again, so the test makes no network call.
function installedCopy(t: TestContext): Copy {
  assert.ok(existsSync(join(PLUGIN, "node_modules")), `${PLUGIN}/node_modules is missing: run npm ci in builder/plugin`);
  // realpath: Node reports the guard's URL with symlinks resolved, and the root it names is compared against it.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "builder-guarded-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const root = join(tmp, "builder");
  // Not fs.cpSync: its `dereference` copies a link below the top folder as a link, so `core` would still reach the
  // repository's core/src and its node_modules.
  const copy = spawnSync("cp", ["-rL", PLUGIN, root], { encoding: "utf8" });
  assert.equal(copy.status, 0, `cp -rL ${PLUGIN} ${root}: ${copy.stderr}`);
  const home = join(tmp, "home");
  mkdirSync(home);
  return { root, home };
}

function run({ root, home }: Copy, script: string) {
  return spawnSync(process.execPath, [join(root, script)], { env: { PATH: process.env.PATH, HOME: home }, encoding: "utf8" });
}

it("with every package installed: step.ts gets past the guard to its own refusal", (t) => {
  const result = run(installedCopy(t), STEP);
  assert.equal(result.status, 2, result.stderr);
  assert.equal(result.stderr, "builder: step.ts is not built yet\n");
  assert.equal(result.stdout, "");
});

// Node links a script's static imports before it runs any of them, so a script that reaches the removed package by
// a static route fails to load and never prints the guard's line, whatever the import's form.
for (const name of pinned) {
  it(`with ${name} removed: each script under scripts/ exits 2, its only output the guard's line naming ${name} and the plugin folder, and writes nothing under HOME`, (t) => {
    assert.ok(scripts.includes(STEP), `no ${STEP} among ${scripts.join(", ")}`);
    const copy = installedCopy(t);
    rmSync(join(copy.root, "node_modules", name), { recursive: true });
    for (const script of scripts) {
      const result = run(copy, script);
      assert.equal(result.status, 2, `${script}: ${result.stderr}`);
      assert.equal(result.stderr, `core dependency ${name} is not installed in ${copy.root}\n`, script);
      assert.equal(result.stdout, "", script);
      assert.deepEqual(readdirSync(copy.home), [], `${script} wrote under HOME`);
    }
  });
}
