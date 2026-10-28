import assert from "node:assert/strict";
import {readFileSync, readdirSync} from "node:fs";
import {dirname, isAbsolute, join, relative, resolve, sep} from "node:path";
import {test} from "node:test";
import {fileURLToPath} from "node:url";
import {importSpecifiers, moduleFiles} from "./source-scan.ts";

const core = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = join(core, "tests", "fixtures", "boundary");

// The folders Claude Code reads as a plugin's components: core ships inside a plugin, so one would add a
// command or hook to every carrier.
const PLUGIN_COMPONENT_FOLDERS = new Set(["commands", "skills", "agents", "hooks", "bin", ".claude-plugin"]);

function readPackage(root: string): {bin?: unknown; dependencies?: Record<string, string>} {
  return JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
}

function insideFolder(folder: string, path: string): boolean {
  const rel = relative(folder, path);
  return rel !== ".." && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function importAllowed(specifier: string, file: string, src: string, dependencies: Set<string>): boolean {
  if (specifier.startsWith("node:")) return true;
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return insideFolder(src, resolve(dirname(file), specifier));
  }
  return dependencies.has(specifier);
}

function importViolations(root: string): string[] {
  const src = join(root, "src");
  const dependencies = new Set(Object.keys(readPackage(root).dependencies ?? {}));
  return moduleFiles(src).flatMap((file) =>
    importSpecifiers(readFileSync(file, "utf8"), relative(root, file))
      .filter(({specifier}) => !importAllowed(specifier, file, src, dependencies))
      .map(({specifier, line}) => `${relative(root, file)}:${line} imports "${specifier}"`),
  );
}

function binViolations(root: string): string[] {
  return "bin" in readPackage(root) ? ['package.json has "bin"'] : [];
}

function componentFolderViolations(root: string): string[] {
  return readdirSync(join(root, "src"), {recursive: true, withFileTypes: true})
    .filter((entry) => PLUGIN_COMPONENT_FOLDERS.has(entry.name))
    .map((entry) => `${relative(root, join(entry.parentPath, entry.name))} is a plugin component folder`)
    .sort();
}

test("core/src imports only node:*, its own files and core's runtime dependencies", () => {
  assert.deepEqual(importViolations(core), []);
});

test("the import check names each import from outside src, in every import form", () => {
  assert.deepEqual(importViolations(fixture), [
    'src/outside.ts:1 imports "../../reviewer/x.ts"',
    'src/outside.ts:2 imports "../../reviewer/types.ts"',
    'src/outside.ts:3 imports "../../orchestrator/rule.ts"',
    'src/outside.ts:4 imports "not-a-dependency"',
    'src/outside.ts:5 imports "../../builder/late.ts"',
    'src/outside.ts:6 imports "../../planner/required.ts"',
  ]);
});

test("core/package.json has no bin", () => {
  assert.deepEqual(binViolations(core), []);
});

test("the bin check refuses a package.json with a bin", () => {
  assert.deepEqual(binViolations(fixture), ['package.json has "bin"']);
});

test("core/src holds no plugin component folder", () => {
  assert.deepEqual(componentFolderViolations(core), []);
});

test("the component-folder check refuses a commands/ folder in src", () => {
  assert.deepEqual(componentFolderViolations(fixture), ["src/commands is a plugin component folder"]);
});
