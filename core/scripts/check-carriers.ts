// CI's check on every plugin carrying core. With `version` pinned, a plugin
// update delivers nothing until the version changes, so a change to what a carrier ships without a bump never
// reaches users, and two carriers in one session would run different cores.
import { lstatSync, readdirSync, readFileSync, readlinkSync, type Stats } from "node:fs";
import { join } from "node:path";
import { parseArgs } from "node:util";

import { runGit } from "../src/git.ts";

export type Pins = Readonly<Record<string, string>>;

// A file that is absent is null.
export type CarrierFiles = {
  // Where `<plugin>/core` points; null when it is not a symlink.
  link: string | null;
  packageJson: string | null;
  packageLock: string | null;
  pluginJson: string | null;
};

export type Carrier = { plugin: string; head: CarrierFiles; basePluginJson: string | null };

export type CarriersChange = {
  // From the merge base to HEAD; a moved file is listed under both its paths.
  changedPaths: readonly string[];
  corePins: Pins;
  // Null when core/package.json is absent at the base.
  baseCorePins: Pins | null;
  carriers: readonly Carrier[];
};

export type CarrierFailure = { carrier: string; file: string; expected: string; found: string };

const CORE_LINK = "../../core/src";
const CORE_SRC = "core/src/";
const CORE_PACKAGE_JSON = "core/package.json";
const PLUGIN_JSON = ".claude-plugin/plugin.json";

type JsonRead = { object: Record<string, unknown> } | { problem: string };

function readJson(text: string | null): JsonRead {
  if (text === null) return { problem: "no file" };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return { problem: `invalid JSON: ${(error as SyntaxError).message}` };
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) return { problem: "not a JSON object" };
  return { object: value as Record<string, unknown> };
}

function lookup(object: Record<string, unknown>, path: readonly string[]): unknown {
  let value: unknown = object;
  for (const key of path) {
    if (typeof value !== "object" || value === null || Array.isArray(value) || !Object.hasOwn(value, key)) return undefined;
    value = (value as Record<string, unknown>)[key];
  }
  return value;
}

function pathName([first, ...rest]: readonly string[]): string {
  return first + rest.map((key) => `[${JSON.stringify(key)}]`).join("");
}

function found(json: JsonRead, path: readonly string[]): string {
  if ("problem" in json) return json.problem;
  const value = lookup(json.object, path);
  return value === undefined ? `no ${pathName(path)}` : `${pathName(path)} = ${JSON.stringify(value)}`;
}

function versionOf(json: JsonRead): string | null {
  if ("problem" in json) return null;
  const version = lookup(json.object, ["version"]);
  return typeof version === "string" ? version : null;
}

function samePins(base: Pins | null, head: Pins): boolean {
  if (base === null) return false;
  const names = Object.keys(head);
  return Object.keys(base).length === names.length && names.every((name) => base[name] === head[name]);
}

// Only core/src and core's runtime pins reach a plugin, so only they need a release; a test edit does not.
function shipsCoreChange(change: CarriersChange): boolean {
  return (
    change.changedPaths.some((path) => path.startsWith(CORE_SRC)) ||
    (change.changedPaths.includes(CORE_PACKAGE_JSON) && !samePins(change.baseCorePins, change.corePins))
  );
}

export function checkCarriers(change: CarriersChange): CarrierFailure[] {
  const failures: CarrierFailure[] = [];
  const pinNames = Object.keys(change.corePins).sort();
  const bumpNeeded = shipsCoreChange(change);

  for (const { plugin, head, basePluginJson } of change.carriers) {
    const fail = (file: string, expected: string, actual: string): void => {
      failures.push({ carrier: plugin, file: `${plugin}/${file}`, expected, found: actual });
    };
    const expect = (file: string, json: JsonRead, path: readonly string[], value: string | number): void => {
      if ("object" in json && lookup(json.object, path) === value) return;
      fail(file, `${pathName(path)} = ${JSON.stringify(value)}`, found(json, path));
    };

    if (head.link !== CORE_LINK) fail("core", CORE_LINK, head.link ?? "not a symlink");

    const packageJson = readJson(head.packageJson);
    expect("package.json", packageJson, ["type"], "module");
    for (const name of pinNames) expect("package.json", packageJson, ["dependencies", name], change.corePins[name]);

    const packageLock = readJson(head.packageLock);
    expect("package-lock.json", packageLock, ["lockfileVersion"], 3);
    for (const name of pinNames) {
      expect("package-lock.json", packageLock, ["packages", `node_modules/${name}`, "version"], change.corePins[name]);
    }

    if (!bumpNeeded) continue;
    const pluginJson = readJson(head.pluginJson);
    const headVersion = versionOf(pluginJson);
    const baseVersion = versionOf(readJson(basePluginJson));
    // No version at all is no bump: without one, nothing says the carrier released this change.
    if (headVersion !== null && headVersion !== baseVersion) continue;
    const expected = baseVersion === null ? "a version" : `version other than ${JSON.stringify(baseVersion)}`;
    fail(PLUGIN_JSON, expected, found(pluginJson, ["version"]));
  }
  return failures;
}

export function describeFailure(failure: CarrierFailure): string {
  return `${failure.carrier}: ${failure.file}: expected ${failure.expected}, found ${failure.found}`;
}

function isAbsent(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "ENOENT" || code === "ENOTDIR";
}

function entryAt(path: string): Stats | null {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isAbsent(error)) return null;
    throw error;
  }
}

function readTextIfPresent(path: string): string | null {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (isAbsent(error)) return null;
    throw error;
  }
}

// Any entry at `*/plugin/core` makes a carrier, so a copied core folder fails the link check instead of passing
// unseen.
function findCarriers(repo: string): string[] {
  return readdirSync(repo, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entryAt(join(repo, entry.name, "plugin", "core")) !== null)
    .map((entry) => `${entry.name}/plugin`)
    .sort();
}

export function readCarrierFiles(dir: string): CarrierFiles {
  const core = join(dir, "core");
  return {
    link: entryAt(core)?.isSymbolicLink() === true ? readlinkSync(core) : null,
    packageJson: readTextIfPresent(join(dir, "package.json")),
    packageLock: readTextIfPresent(join(dir, "package-lock.json")),
    pluginJson: readTextIfPresent(join(dir, PLUGIN_JSON)),
  };
}

export function pinsOf(text: string, source: string): Pins {
  const dependencies: unknown = (JSON.parse(text) as { dependencies?: unknown }).dependencies ?? {};
  if (
    typeof dependencies !== "object" ||
    dependencies === null ||
    Array.isArray(dependencies) ||
    !Object.values(dependencies).every((version) => typeof version === "string")
  ) {
    throw new Error(`${source}: dependencies is not an object of versions`);
  }
  return dependencies as Pins;
}

// `show` exits 128 alike for a path absent at the base and for a real failure, so `ls-tree` says which exist.
async function readAtBase(repo: string, base: string, paths: readonly string[]): Promise<Map<string, string>> {
  const listed = await runGit(repo, ["ls-tree", "--name-only", "-z", "--end-of-options", base, "--", ...paths]);
  const texts = new Map<string, string>();
  for (const path of listed.stdout.split("\0").filter((name) => name !== "")) {
    texts.set(path, (await runGit(repo, ["show", "--end-of-options", `${base}:${path}`])).stdout);
  }
  return texts;
}

export async function readCarriersChange(repo: string, base: string): Promise<CarriersChange> {
  // The changed paths and the base's files come from one commit, the one `<base>...HEAD` diffs from: on a branch
  // behind its base, the base's tip holds versions and pins the branch never had.
  const mergeBase = (await runGit(repo, ["merge-base", "--end-of-options", base, "HEAD"])).stdout.trim();
  // Without --no-renames a file moved out of core/src is listed only under its new path.
  const diff = await runGit(repo, ["diff", "--name-only", "--no-renames", "-z", "--end-of-options", mergeBase, "HEAD"]);
  const plugins = findCarriers(repo);
  const atBase = await readAtBase(repo, mergeBase, [CORE_PACKAGE_JSON, ...plugins.map((plugin) => `${plugin}/${PLUGIN_JSON}`)]);
  const baseCorePackage = atBase.get(CORE_PACKAGE_JSON);
  return {
    changedPaths: diff.stdout.split("\0").filter((path) => path !== ""),
    corePins: pinsOf(readFileSync(join(repo, CORE_PACKAGE_JSON), "utf8"), CORE_PACKAGE_JSON),
    baseCorePins: baseCorePackage === undefined ? null : pinsOf(baseCorePackage, `${mergeBase}:${CORE_PACKAGE_JSON}`),
    carriers: plugins.map((plugin) => ({
      plugin,
      head: readCarrierFiles(join(repo, plugin)),
      basePluginJson: atBase.get(`${plugin}/${PLUGIN_JSON}`) ?? null,
    })),
  };
}

const USAGE = "usage: node scripts/check-carriers.ts --base <ref>\n";

function isParseArgsError(error: unknown): error is TypeError {
  return error instanceof TypeError && (error as NodeJS.ErrnoException).code?.startsWith("ERR_PARSE_ARGS_") === true;
}

async function main(args: string[]): Promise<number> {
  let base: string | undefined;
  try {
    base = parseArgs({ args, options: { base: { type: "string" } } }).values.base;
  } catch (error) {
    if (!isParseArgsError(error)) throw error;
    process.stderr.write(`${error.message}\n`);
  }
  // An empty base would diff HEAD against itself and pass every carrier.
  if (base === undefined || base === "") {
    process.stderr.write(USAGE);
    return 2;
  }
  const repo = (await runGit(process.cwd(), ["rev-parse", "--show-toplevel"])).stdout.trim();
  const change = await readCarriersChange(repo, base);
  const failures = checkCarriers(change);
  for (const failure of failures) process.stderr.write(`${describeFailure(failure)}\n`);
  process.stdout.write(`${change.carriers.length} carriers checked against ${base}, ${failures.length} failures\n`);
  return failures.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exitCode = await main(process.argv.slice(2));
