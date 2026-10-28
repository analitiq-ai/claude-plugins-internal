import assert from "node:assert/strict";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { it } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/", import.meta.url));
const CORE_PACKAGE = new URL("../../core/package.json", import.meta.url);

type Manifest = { dependencies?: Record<string, string>; devDependencies?: unknown };
type Lockfile = { lockfileVersion?: unknown; packages?: Record<string, { version?: unknown }> };

function readJson<T>(path: string | URL): T {
  return JSON.parse(readFileSync(path, "utf8")) as T;
}

const corePins = readJson<Manifest>(CORE_PACKAGE).dependencies ?? {};

it("links core to ../../core/src as a symlink, not a copy", () => {
  const link = `${PLUGIN}core`;
  assert.ok(lstatSync(link).isSymbolicLink(), `${link} is not a symlink`);
  assert.equal(readlinkSync(link), "../../core/src-T014");
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
