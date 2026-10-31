import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import { importSpecifiers, moduleFiles } from "../../core/tests/source-scan.ts";

const COMPONENT = fileURLToPath(new URL("../", import.meta.url));
const PLUGIN = fileURLToPath(new URL("../plugin/", import.meta.url));
const CORE_PACKAGE = new URL("../../core/package.json", import.meta.url);
const GUARD = "lib/guarded.ts";

type Manifest = { dependencies?: Record<string, string>; devDependencies?: unknown };
type Lockfile = { lockfileVersion?: unknown; packages?: Record<string, { version?: unknown }> };

function readJson<T>(path: string | URL): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const corePins = readJson<Manifest>(CORE_PACKAGE).dependencies ?? {};

function hookEntries(root: string): string[] {
  const hooks = join(root, "hooks");
  if (!existsSync(hooks)) return [];
  return readdirSync(hooks)
    .filter((name) => name.endsWith(".ts"))
    .sort()
    .map((name) => `hooks/${name}`);
}

function inside(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

describe("the plugin's carrier shape", () => {
  it("links core to ../../core/src as a symlink, not a copy", () => {
    const link = `${PLUGIN}core`;
    assert.ok(lstatSync(link).isSymbolicLink(), `${link} is not a symlink`);
    assert.equal(readlinkSync(link), "../../core/src");
  });

  // An install fetches every package the lockfile holds into the plugin, so a development package would ship.
  it("pins exactly core's runtime packages and declares no devDependencies", () => {
    const manifest = readJson<Manifest>(`${PLUGIN}package.json`);
    assert.deepEqual(manifest.dependencies, corePins);
    assert.equal(Object.hasOwn(manifest, "devDependencies"), false);
  });

  it("locks each pin at core's version in a v3 lockfile", () => {
    const lock = readJson<Lockfile>(`${PLUGIN}package-lock.json`);
    assert.equal(lock.lockfileVersion, 3);
    for (const [name, version] of Object.entries(corePins)) {
      assert.equal(lock.packages?.[`node_modules/${name}`]?.version, version, name);
    }
  });
});

// A static import or re-export starting a line; `import type` is erased before Node runs the file, so it loads nothing.
const STATIC_IMPORT = /^(?:import|export)\s+(?!type\s)(?:[^;]*?\bfrom\s*)?["']([^"']+)["']/gm;

describe("the guard comes first (FR-002)", () => {
  it("every hook entry file statically imports ../lib/guarded.ts and nothing else", () => {
    for (const entry of hookEntries(PLUGIN)) {
      const text = readFileSync(join(PLUGIN, entry), "utf8");
      const imports = [...text.matchAll(STATIC_IMPORT)].map((match) => match[1]);
      assert.deepEqual(imports, ["../lib/guarded.ts"], entry);
    }
  });

  type Copy = { root: string; home: string };

  function run({ root, home }: Copy, entry: string) {
    return spawnSync(process.execPath, [join(root, entry)], {
      input: "{}",
      env: { PATH: process.env.PATH, HOME: home },
      encoding: "utf8",
    });
  }

  // The plugin as an install leaves it: the `core` link dereferenced, its packages installed. They are copied
  // from the plugin's own node_modules rather than fetched again, so the test makes no network call.
  function installedCopy(t: TestContext): Copy {
    assert.ok(existsSync(join(PLUGIN, "node_modules")), `${PLUGIN}node_modules is missing: run npm ci in orchestrator/plugin`);
    // realpath: Node reports the guard's URL with symlinks resolved, and the root it names is compared against it.
    const tmp = realpathSync(mkdtempSync(join(tmpdir(), "orchestrator-guarded-")));
    t.after(() => rmSync(tmp, { recursive: true, force: true }));
    const root = join(tmp, "orchestrator");
    // Not fs.cpSync: its `dereference` copies a link below the top folder as a link, so `core` would still reach the
    // repository's core/src and its node_modules.
    const copy = spawnSync("cp", ["-rL", PLUGIN, root], { encoding: "utf8" });
    assert.equal(copy.status, 0, `cp -rL ${PLUGIN} ${root}: ${copy.stderr}`);
    const home = join(tmp, "home");
    mkdirSync(home);
    return { root, home };
  }

  it("with every package installed: the guard passes and each hook goes on to read its input", (t) => {
    const copy = installedCopy(t);
    const guard = run(copy, GUARD);
    assert.equal(guard.status, 0, guard.stderr);
    assert.equal(guard.stdout + guard.stderr, "");
    for (const entry of hookEntries(copy.root)) {
      const hook = run(copy, entry);
      assert.equal(hook.status, 2, `${entry}: ${hook.stderr}`);
      assert.match(hook.stderr, /^orchestrator: /, entry);
    }
  });

  it("with zod removed: the guard and every hook exit 2 naming zod and the plugin folder, and write nothing", (t) => {
    const copy = installedCopy(t);
    rmSync(join(copy.root, "node_modules", "zod"), { recursive: true });
    for (const entry of [GUARD, ...hookEntries(copy.root)]) {
      const refused = run(copy, entry);
      assert.equal(refused.status, 2, `${entry}: ${refused.stderr}`);
      assert.equal(refused.stderr, `core dependency zod is not installed in ${copy.root}\n`, entry);
      assert.equal(refused.stdout, "", entry);
      assert.deepEqual(readdirSync(copy.home), [], `${entry} wrote under HOME`);
    }
  });
});

describe("the plugin imports only core and itself (FR-003, FR-003a)", () => {
  const dependencies = new Set(Object.keys(corePins));

  function allowed(specifier: string, file: string): boolean {
    if (specifier.startsWith("node:")) return true;
    if (specifier.startsWith("./") || specifier.startsWith("../")) return inside(PLUGIN, resolve(dirname(file), specifier));
    return dependencies.has(specifier);
  }

  it("resolves every import, in every form, inside orchestrator/plugin, core reached through its link", () => {
    const own = moduleFiles(PLUGIN).filter((file) => {
      const [top] = relative(PLUGIN, file).split(sep);
      return top !== "core" && top !== "node_modules";
    });
    assert.ok(own.some((file) => file.endsWith(GUARD)), `no ${GUARD} among ${own.join(", ")}`);
    const violations = own.flatMap((file) =>
      importSpecifiers(readFileSync(file, "utf8"), relative(PLUGIN, file))
        .filter(({ specifier }) => !allowed(specifier, file))
        .map(({ specifier, line }) => `${relative(PLUGIN, file)}:${line} imports "${specifier}"`),
    );
    assert.deepEqual(violations, []);
  });

  it("holds no Python file", () => {
    const python = readdirSync(COMPONENT, { recursive: true, withFileTypes: true })
      .map((entry) => relative(COMPONENT, join(entry.parentPath, entry.name)))
      .filter((path) => path.endsWith(".py") && !path.split(sep).includes("node_modules"));
    assert.deepEqual(python, []);
  });
});
