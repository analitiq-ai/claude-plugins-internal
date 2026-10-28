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

function runHook(root: string) {
  return spawnSync(process.execPath, [join(root, "hooks", "token.ts")], {
    input: "{}",
    env: isolatedEnv(),
    encoding: "utf8",
  });
}

it("with every package installed: token.ts exits 0 and prints nothing", (t) => {
  const hook = runHook(installedCopy(t));
  assert.equal(hook.status, 0, hook.stderr);
  assert.equal(hook.stdout, "");
});

it("with zod removed: token.ts exits 2 naming zod and the plugin folder, and prints nothing on stdout", (t) => {
  const root = installedCopy(t);
  rmSync(join(root, "node_modules", "zod"), { recursive: true });
  const hook = runHook(root);
  assert.equal(hook.status, 2, hook.stderr);
  assert.equal(hook.stderr, `core dependency zod is not installed in ${root}\n`);
  assert.equal(hook.stdout, "");
});
