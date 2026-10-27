import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it, type TestContext } from "node:test";
import { fileURLToPath } from "node:url";

import {
  type Carrier,
  type CarrierFiles,
  type CarriersChange,
  checkCarriers,
  describeFailure,
  readCarriersChange,
} from "../scripts/check-carriers.ts";
import { GitFailed, runGit } from "../src/git.ts";

const PINS = { "smol-toml": "1.9.1", yaml: "2.9.1", zod: "4.6.7" };

function lockText(pins: Record<string, string>, lockfileVersion = 3): string {
  const installed = Object.entries(pins).map(([name, version]) => [`node_modules/${name}`, { version }]);
  return JSON.stringify({ lockfileVersion, packages: { "": { dependencies: pins }, ...Object.fromEntries(installed) } });
}

function headFiles(overrides: Partial<CarrierFiles> = {}, pins: Record<string, string> = PINS): CarrierFiles {
  return {
    link: "../../core/src",
    packageJson: JSON.stringify({ name: "x", type: "module", dependencies: pins }),
    packageLock: lockText(pins),
    pluginJson: JSON.stringify({ name: "x", version: "1.0.0" }),
    ...overrides,
  };
}

function carrier(overrides: Partial<CarrierFiles> = {}, basePluginJson: string | null = headFiles().pluginJson): Carrier {
  return { plugin: "x/plugin", head: headFiles(overrides), basePluginJson };
}

function change(overrides: Partial<CarriersChange> = {}): CarriersChange {
  return { changedPaths: [], corePins: PINS, baseCorePins: PINS, carriers: [carrier()], ...overrides };
}

const BUMPED = JSON.stringify({ name: "x", version: "1.0.1" });
const CORE_CHANGE = ["core/src/identity.ts"];

describe("checkCarriers: link, module type, pins and lockfile", () => {
  it("passes a carrier holding everything core's pins ask for", () => {
    assert.deepEqual(checkCarriers(change()), []);
  });

  it("passes when there is no carrier", () => {
    assert.deepEqual(checkCarriers(change({ changedPaths: CORE_CHANGE, carriers: [] })), []);
  });

  it("fails a core link that does not point at ../../core/src", () => {
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ link: "../core/src" })] })), [
      { carrier: "x/plugin", file: "x/plugin/core", expected: "../../core/src", found: "../core/src" },
    ]);
  });

  it("fails a core that is not a symlink", () => {
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ link: null })] })), [
      { carrier: "x/plugin", file: "x/plugin/core", expected: "../../core/src", found: "not a symlink" },
    ]);
  });

  it("fails a package.json without \"type\": \"module\"", () => {
    const untyped = JSON.stringify({ dependencies: PINS });
    const commonjs = JSON.stringify({ type: "commonjs", dependencies: PINS });
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ packageJson: untyped })] })), [
      { carrier: "x/plugin", file: "x/plugin/package.json", expected: 'type = "module"', found: "no type" },
    ]);
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ packageJson: commonjs })] })), [
      { carrier: "x/plugin", file: "x/plugin/package.json", expected: 'type = "module"', found: 'type = "commonjs"' },
    ]);
  });

  it("fails a core pin missing from package.json or at another version", () => {
    const { zod: _zod, ...withoutZod } = PINS;
    const missing = JSON.stringify({ type: "module", dependencies: withoutZod });
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ packageJson: missing })] })), [
      {
        carrier: "x/plugin",
        file: "x/plugin/package.json",
        expected: 'dependencies["zod"] = "4.6.7"',
        found: 'no dependencies["zod"]',
      },
    ]);
    for (const other of ["4.6.6", "^4.6.7"]) {
      const moved = JSON.stringify({ type: "module", dependencies: { ...PINS, zod: other } });
      assert.deepEqual(checkCarriers(change({ carriers: [carrier({ packageJson: moved })] })), [
        {
          carrier: "x/plugin",
          file: "x/plugin/package.json",
          expected: 'dependencies["zod"] = "4.6.7"',
          found: `dependencies["zod"] = "${other}"`,
        },
      ]);
    }
  });

  it("fails every value a missing or unreadable package.json should hold, naming why", () => {
    const failures = checkCarriers(change({ carriers: [carrier({ packageJson: null })] }));
    assert.deepEqual(
      failures.map((failure) => failure.expected),
      ['type = "module"', 'dependencies["smol-toml"] = "1.9.1"', 'dependencies["yaml"] = "2.9.1"', 'dependencies["zod"] = "4.6.7"'],
    );
    assert.ok(failures.every((failure) => failure.file === "x/plugin/package.json" && failure.found === "no file"));

    const [notJson] = checkCarriers(change({ carriers: [carrier({ packageJson: "{ not json" })] }));
    assert.match(notJson.found, /^invalid JSON: /);
    const [notObject] = checkCarriers(change({ carriers: [carrier({ packageJson: "[]" })] }));
    assert.equal(notObject.found, "not a JSON object");
  });

  it("fails a missing lockfile", () => {
    const failures = checkCarriers(change({ carriers: [carrier({ packageLock: null })] }));
    assert.deepEqual(
      failures.map((failure) => failure.expected),
      [
        "lockfileVersion = 3",
        'packages["node_modules/smol-toml"]["version"] = "1.9.1"',
        'packages["node_modules/yaml"]["version"] = "2.9.1"',
        'packages["node_modules/zod"]["version"] = "4.6.7"',
      ],
    );
    assert.ok(failures.every((failure) => failure.file === "x/plugin/package-lock.json" && failure.found === "no file"));
  });

  it("fails a lockfile that is not v3", () => {
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ packageLock: lockText(PINS, 2) })] })), [
      {
        carrier: "x/plugin",
        file: "x/plugin/package-lock.json",
        expected: "lockfileVersion = 3",
        found: "lockfileVersion = 2",
      },
    ]);
  });

  it("fails a lockfile pinning a core dependency at another version, or not at all", () => {
    const moved = lockText({ ...PINS, zod: "4.6.6" });
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ packageLock: moved })] })), [
      {
        carrier: "x/plugin",
        file: "x/plugin/package-lock.json",
        expected: 'packages["node_modules/zod"]["version"] = "4.6.7"',
        found: 'packages["node_modules/zod"]["version"] = "4.6.6"',
      },
    ]);
    const { zod: _zod, ...withoutZod } = PINS;
    assert.deepEqual(checkCarriers(change({ carriers: [carrier({ packageLock: lockText(withoutZod) })] })), [
      {
        carrier: "x/plugin",
        file: "x/plugin/package-lock.json",
        expected: 'packages["node_modules/zod"]["version"] = "4.6.7"',
        found: 'no packages["node_modules/zod"]["version"]',
      },
    ]);
  });
});

describe("checkCarriers: the version bump", () => {
  const PLUGIN_JSON = "x/plugin/.claude-plugin/plugin.json";

  it("fails a change to core/src/** when the carrier's version equals the base's", () => {
    assert.deepEqual(checkCarriers(change({ changedPaths: ["README.md", ...CORE_CHANGE] })), [
      { carrier: "x/plugin", file: PLUGIN_JSON, expected: 'version other than "1.0.0"', found: 'version = "1.0.0"' },
    ]);
  });

  it("passes a change to core/src/** when the carrier bumps its version", () => {
    assert.deepEqual(checkCarriers(change({ changedPaths: CORE_CHANGE, carriers: [carrier({ pluginJson: BUMPED })] })), []);
  });

  it("fails a change to core/package.json dependencies when the carrier's version equals the base's", () => {
    const moved = { ...PINS, zod: "4.6.8" };
    const following: Carrier = { plugin: "x/plugin", head: headFiles({}, moved), basePluginJson: headFiles().pluginJson };
    const failures = checkCarriers(
      change({ changedPaths: ["core/package.json"], corePins: moved, baseCorePins: PINS, carriers: [following] }),
    );
    assert.deepEqual(failures, [
      { carrier: "x/plugin", file: PLUGIN_JSON, expected: 'version other than "1.0.0"', found: 'version = "1.0.0"' },
    ]);
  });

  it("counts core/package.json absent at the base as a change to its dependencies", () => {
    assert.equal(checkCarriers(change({ changedPaths: ["core/package.json"], baseCorePins: null })).length, 1);
  });

  it("needs no bump for a change to core/package.json that leaves dependencies as they were", () => {
    assert.deepEqual(checkCarriers(change({ changedPaths: ["core/package.json"] })), []);
  });

  it("needs no bump for a test-only change, or any change outside core/src and core's dependencies", () => {
    const paths = ["core/tests/identity.test.ts", "core/scripts/write-schemas.ts", "core/schemas/spec-facts.schema.json"];
    assert.deepEqual(checkCarriers(change({ changedPaths: [...paths, "core/srcs/x.ts", "reviewer/plugin/x.py"] })), []);
  });

  it("passes a carrier new since the base that holds a version", () => {
    assert.deepEqual(checkCarriers(change({ changedPaths: CORE_CHANGE, carriers: [carrier({}, null)] })), []);
  });

  it("fails a carrier whose plugin.json holds no version on a core change, new or not", () => {
    const unversioned = JSON.stringify({ name: "x" });
    assert.deepEqual(
      checkCarriers(change({ changedPaths: CORE_CHANGE, carriers: [carrier({ pluginJson: unversioned }, null)] })),
      [{ carrier: "x/plugin", file: PLUGIN_JSON, expected: "a version", found: "no version" }],
    );
    assert.deepEqual(checkCarriers(change({ changedPaths: CORE_CHANGE, carriers: [carrier({ pluginJson: null })] })), [
      { carrier: "x/plugin", file: PLUGIN_JSON, expected: 'version other than "1.0.0"', found: "no file" },
    ]);
  });

  it("names only the carrier that did not bump", () => {
    const bumped: Carrier = { plugin: "a/plugin", head: headFiles({ pluginJson: BUMPED }), basePluginJson: headFiles().pluginJson };
    const stale: Carrier = { plugin: "b/plugin", head: headFiles(), basePluginJson: headFiles().pluginJson };
    const failures = checkCarriers(change({ changedPaths: CORE_CHANGE, carriers: [bumped, stale] }));
    assert.deepEqual(
      failures.map((failure) => [failure.carrier, failure.file]),
      [["b/plugin", "b/plugin/.claude-plugin/plugin.json"]],
    );
  });
});

describe("describeFailure", () => {
  it("names the carrier, the file and the expected value", () => {
    const [failure] = checkCarriers(change({ carriers: [carrier({ link: "../core/src" })] }));
    assert.equal(describeFailure(failure), "x/plugin: x/plugin/core: expected ../../core/src, found ../core/src");
  });
});

const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];
const SCRIPT = fileURLToPath(new URL("../scripts/check-carriers.ts", import.meta.url));

let home: string;
const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

function restoreEnv(name: keyof typeof savedEnv): void {
  const value = savedEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

// git reads ignore and attributes files under HOME even with no global config, and the spawned script inherits
// this environment.
before(() => {
  home = mkdtempSync(join(tmpdir(), "core-carriers-home-"));
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");
});

after(() => {
  restoreEnv("HOME");
  restoreEnv("XDG_CONFIG_HOME");
  rmSync(home, { recursive: true, force: true });
});

function write(repo: string, path: string, text: string): void {
  mkdirSync(dirname(join(repo, path)), { recursive: true });
  writeFileSync(join(repo, path), text);
}

function addCarrier(repo: string, plugin: string, version: string): void {
  mkdirSync(join(repo, plugin), { recursive: true });
  symlinkSync("../../core/src", join(repo, plugin, "core"));
  write(repo, `${plugin}/package.json`, JSON.stringify({ type: "module", dependencies: PINS }));
  write(repo, `${plugin}/package-lock.json`, lockText(PINS));
  write(repo, `${plugin}/.claude-plugin/plugin.json`, JSON.stringify({ name: "x", version }));
}

async function commit(repo: string, message: string): Promise<void> {
  await runGit(repo, ["add", "-A"]);
  await runGit(repo, [...COMMITTER, "commit", "-q", "-m", message]);
}

// A repository on `main` holding core and one carrier, x/plugin, at version 1.0.0.
async function scratchRepo(t: TestContext): Promise<string> {
  const repo = mkdtempSync(join(tmpdir(), "core-carriers-"));
  t.after(() => rmSync(repo, { recursive: true, force: true }));
  await runGit(repo, ["init", "-q", "-b", "main"]);
  write(repo, "core/package.json", JSON.stringify({ type: "module", dependencies: PINS, devDependencies: {} }));
  write(repo, "core/src/identity.ts", "export const story = 1;\n");
  addCarrier(repo, "x/plugin", "1.0.0");
  await commit(repo, "core and a carrier");
  return repo;
}

describe("readCarriersChange on a scratch repository", () => {
  it("against a base ref: reads changed paths, core's pins at both ends and each carrier, new ones included", async (t) => {
    const repo = await scratchRepo(t);
    await runGit(repo, ["checkout", "-q", "-b", "212-us2-retry-budget"]);
    write(repo, "core/src/identity.ts", "export const story = 2;\n");
    addCarrier(repo, "y/plugin", "0.1.0");
    await commit(repo, "core change, a new carrier, no bump of x");

    const read = await readCarriersChange(repo, "main");
    assert.deepEqual([...read.changedPaths].sort(), [
      "core/src/identity.ts",
      "y/plugin/.claude-plugin/plugin.json",
      "y/plugin/core",
      "y/plugin/package-lock.json",
      "y/plugin/package.json",
    ]);
    assert.deepEqual(read.corePins, PINS);
    assert.deepEqual(read.baseCorePins, PINS);
    assert.deepEqual(read.carriers, [
      {
        plugin: "x/plugin",
        head: headFiles({ packageJson: JSON.stringify({ type: "module", dependencies: PINS }) }),
        basePluginJson: JSON.stringify({ name: "x", version: "1.0.0" }),
      },
      {
        plugin: "y/plugin",
        head: headFiles({
          packageJson: JSON.stringify({ type: "module", dependencies: PINS }),
          pluginJson: JSON.stringify({ name: "x", version: "0.1.0" }),
        }),
        basePluginJson: null,
      },
    ]);
    assert.deepEqual(checkCarriers(read), [
      {
        carrier: "x/plugin",
        file: "x/plugin/.claude-plugin/plugin.json",
        expected: 'version other than "1.0.0"',
        found: 'version = "1.0.0"',
      },
    ]);

    write(repo, "x/plugin/.claude-plugin/plugin.json", JSON.stringify({ name: "x", version: "1.0.1" }));
    await commit(repo, "bump x");
    assert.deepEqual(checkCarriers(await readCarriersChange(repo, "main")), []);
  });

  it("against a base that moved on since the branch: reads the base's files at the merge base, not its tip", async (t) => {
    const repo = await scratchRepo(t);
    await runGit(repo, ["checkout", "-q", "-b", "212-us1-x"]);
    await runGit(repo, ["checkout", "-q", "main"]);
    const moved = { ...PINS, zod: "4.6.8" };
    write(repo, "core/package.json", JSON.stringify({ type: "module", dependencies: moved, devDependencies: {} }));
    write(repo, "x/plugin/package.json", JSON.stringify({ type: "module", dependencies: moved }));
    write(repo, "x/plugin/package-lock.json", lockText(moved));
    write(repo, "x/plugin/.claude-plugin/plugin.json", JSON.stringify({ name: "x", version: "1.0.1" }));
    await commit(repo, "main moves zod and bumps x");
    await runGit(repo, ["checkout", "-q", "212-us1-x"]);

    write(repo, "core/package.json", JSON.stringify({ type: "module", dependencies: PINS, devDependencies: {}, scripts: {} }));
    await commit(repo, "core scripts only");
    const scriptsOnly = await readCarriersChange(repo, "main");
    assert.deepEqual(scriptsOnly.baseCorePins, PINS);
    assert.deepEqual(checkCarriers(scriptsOnly), []);

    write(repo, "core/src/identity.ts", "export const story = 2;\n");
    await commit(repo, "core change, no bump of x");
    assert.deepEqual(checkCarriers(await readCarriersChange(repo, "main")), [
      {
        carrier: "x/plugin",
        file: "x/plugin/.claude-plugin/plugin.json",
        expected: 'version other than "1.0.0"',
        found: 'version = "1.0.0"',
      },
    ]);
  });

  it("against HEAD~1: a pushed core change without a bump fails, a test-only change after it passes", async (t) => {
    const repo = await scratchRepo(t);
    write(repo, "core/src/identity.ts", "export const story = 2;\n");
    await commit(repo, "core change, no bump");
    const read = await readCarriersChange(repo, "HEAD~1");
    assert.deepEqual(read.changedPaths, ["core/src/identity.ts"]);
    assert.deepEqual(
      checkCarriers(read).map((failure) => failure.carrier),
      ["x/plugin"],
    );

    write(repo, "core/tests/identity.test.ts", "// dummy\n");
    await commit(repo, "test-only change");
    assert.deepEqual(checkCarriers(await readCarriersChange(repo, "HEAD~1")), []);
  });

  it("lists a file moved out of core/src under its old path too", async (t) => {
    const repo = await scratchRepo(t);
    await runGit(repo, ["mv", "core/src/identity.ts", "core/identity.ts"]);
    await commit(repo, "move a file out of core/src");
    assert.deepEqual([...(await readCarriersChange(repo, "HEAD~1")).changedPaths].sort(), [
      "core/identity.ts",
      "core/src/identity.ts",
    ]);
  });

  it("reads core/package.json and a carrier absent at the base as null", async (t) => {
    const repo = mkdtempSync(join(tmpdir(), "core-carriers-"));
    t.after(() => rmSync(repo, { recursive: true, force: true }));
    await runGit(repo, ["init", "-q", "-b", "main"]);
    write(repo, "README.md", "dummy\n");
    await commit(repo, "before core");
    write(repo, "core/package.json", JSON.stringify({ type: "module", dependencies: PINS }));
    write(repo, "core/src/identity.ts", "export const story = 1;\n");
    addCarrier(repo, "x/plugin", "1.0.0");
    await commit(repo, "core and a carrier");

    const read = await readCarriersChange(repo, "HEAD~1");
    assert.equal(read.baseCorePins, null);
    assert.equal(read.carriers[0].basePluginJson, null);
    assert.deepEqual(checkCarriers(read), []);
  });

  it("reads a core that is a folder, not a link, as link null; a plugin that is a file holds no carrier", async (t) => {
    const repo = await scratchRepo(t);
    write(repo, "z/plugin/core/identity.ts", "export const story = 1;\n");
    write(repo, "docs/plugin", "dummy\n");
    await commit(repo, "a copied core");
    const read = await readCarriersChange(repo, "HEAD~1");
    assert.deepEqual(
      read.carriers.map((found) => [found.plugin, found.head.link]),
      [
        ["x/plugin", "../../core/src"],
        ["z/plugin", null],
      ],
    );
  });

  it("throws GitFailed for a base git cannot resolve, and never reads a base as an option", async (t) => {
    const repo = await scratchRepo(t);
    await assert.rejects(readCarriersChange(repo, "no-such-ref"), GitFailed);
    const written = join(repo, "written");
    await assert.rejects(readCarriersChange(repo, `--output=${written}`), GitFailed);
    assert.equal(existsSync(`${written}...HEAD`), false);
  });
});

describe("node scripts/check-carriers.ts --base <ref>", () => {
  function run(cwd: string, args: string[]) {
    return spawnSync(process.execPath, [SCRIPT, ...args], { cwd, encoding: "utf8" });
  }

  it("exits 1 naming each failure, and 0 once the carrier bumps", async (t) => {
    const repo = await scratchRepo(t);
    write(repo, "core/src/identity.ts", "export const story = 2;\n");
    await commit(repo, "core change, no bump");
    const failing = run(join(repo, "core"), ["--base", "HEAD~1"]);
    assert.equal(failing.status, 1, failing.stderr);
    assert.equal(
      failing.stderr,
      'x/plugin: x/plugin/.claude-plugin/plugin.json: expected version other than "1.0.0", found version = "1.0.0"\n',
    );

    write(repo, "x/plugin/.claude-plugin/plugin.json", JSON.stringify({ name: "x", version: "1.0.1" }));
    await runGit(repo, ["add", "-A"]);
    await runGit(repo, [...COMMITTER, "commit", "-q", "--amend", "--no-edit"]);
    const passing = run(join(repo, "core"), ["--base", "HEAD~1"]);
    assert.equal(passing.status, 0, passing.stderr);
    assert.equal(passing.stderr, "");
  });

  it("exits 2 with its usage when --base is missing or anything else is given", async (t) => {
    const repo = await scratchRepo(t);
    for (const args of [[], ["--base"], ["--base="], ["--bse", "main"], ["--base", "main", "extra"]]) {
      const answer = run(repo, args);
      assert.equal(answer.status, 2, `${args.join(" ")}: ${answer.stderr}`);
      assert.match(answer.stderr, /usage: node scripts\/check-carriers\.ts --base <ref>/);
    }
  });
});
