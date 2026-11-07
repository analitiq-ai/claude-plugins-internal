import assert from "node:assert/strict";
import { lstatSync, readdirSync, readFileSync, readlinkSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { describe, it } from "node:test";
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

describe("what the plugin imports (FR-019)", () => {
  const dependencies = new Set(Object.keys(corePins));

  function allowed(specifier: string, file: string): boolean {
    if (specifier.startsWith("node:")) return true;
    if (specifier.startsWith("./") || specifier.startsWith("../")) return inside(PLUGIN, resolve(dirname(file), specifier));
    return dependencies.has(specifier);
  }

  it("resolves every import statement, import() and direct require() to node:, a core pin, or a path inside builder/plugin", () => {
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
});

it("holds no Python file under builder/, node_modules aside (FR-021)", () => {
  const python = readdirSync(COMPONENT, { recursive: true, withFileTypes: true })
    .map((entry) => relative(COMPONENT, join(entry.parentPath, entry.name)))
    .filter((path) => path.endsWith(".py") && !path.split(sep).includes("node_modules"));
  assert.deepEqual(python, []);
});
