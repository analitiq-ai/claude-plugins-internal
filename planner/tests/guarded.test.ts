import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin", import.meta.url));

let home: string;

before(() => {
  home = mkdtempSync(join(tmpdir(), "planner-guarded-home-"));
});

after(() => {
  rmSync(home, { recursive: true, force: true });
});

// `npm test` hands the runner's npm_config_* (its cache and user config among them) to its children, which would
// point this npm back at the real HOME.
function isolatedEnv(): NodeJS.ProcessEnv {
  const inherited = Object.entries(process.env).filter(([name]) => !name.toLowerCase().startsWith("npm_config_"));
  return {
    ...Object.fromEntries(inherited),
    HOME: home,
    XDG_CONFIG_HOME: join(home, ".config"),
    npm_config_globalconfig: join(home, "npmrc"),
  };
}

// The plugin as an install leaves it: the `core` link dereferenced, the lockfile's packages installed.
function installedCopy(t: TestContext): string {
  // realpath: Node reports the guard's URL with symlinks resolved, and the root it names is compared against it.
  const tmp = realpathSync(mkdtempSync(join(tmpdir(), "planner-guarded-")));
  t.after(() => rmSync(tmp, { recursive: true, force: true }));
  const root = join(tmp, "planner");
  // Not fs.cpSync: its `dereference` copies a link below the top folder as a link, so `core` would still reach the
  // repository's core/src and its node_modules.
  const copy = spawnSync("cp", ["-rL", PLUGIN, root], { encoding: "utf8" });
  assert.equal(copy.status, 0, `cp -rL ${PLUGIN} ${root}: ${copy.stderr}`);
  const install = spawnSync("npm", ["ci", "--no-audit", "--no-fund"], { cwd: root, env: isolatedEnv(), encoding: "utf8" });
  assert.equal(install.status, 0, `npm ci in ${root}: ${install.stderr}`);
  return root;
}

// With no argument: preflight.ts refuses it without reaching git or GitHub.
function runPreflight(root: string) {
  return spawnSync(process.execPath, [join(root, "scripts", "preflight.ts")], { env: isolatedEnv(), encoding: "utf8" });
}

// preflight.ts loads every module it needs before it reads its arguments, so a refusal of them shows each one was found.
it("with every package installed: preflight.ts gets past the guard and refuses a missing argument", (t) => {
  const run = runPreflight(installedCopy(t));
  assert.equal(run.status, 2, run.stderr);
  assert.match(run.stderr, /^planner: preflight\.ts takes one argument, /);
  assert.equal(run.stdout, "");
});

it("with zod removed: preflight.ts exits 2 naming zod and the plugin folder, and prints nothing on stdout", (t) => {
  const root = installedCopy(t);
  rmSync(join(root, "node_modules", "zod"), { recursive: true });
  const run = runPreflight(root);
  assert.equal(run.status, 2, run.stderr);
  assert.equal(run.stderr, `core dependency zod is not installed in ${root}\n`);
  assert.equal(run.stdout, "");
});
