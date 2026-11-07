import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { lstatSync, readFileSync, readlinkSync } from "node:fs";
import { basename, dirname, extname, join, sep } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

const PLUGIN = fileURLToPath(new URL("../plugin/", import.meta.url));
const MARKETPLACE = new URL("../../.claude-plugin/marketplace.json", import.meta.url);
const OWN = basename(dirname(PLUGIN));

// The plugin's tracked files, relative to it: what an install copies.
function shipped(): string[] {
  return execFileSync("git", ["ls-files", "-z", "--", "."], { cwd: PLUGIN, encoding: "utf8" })
    .split("\0")
    .filter((file) => file !== "");
}

// What git holds for a tracked path: a link's target (the `core` link is one), else the file's text.
function trackedText(file: string): string {
  const path = join(PLUGIN, file);
  return lstatSync(path).isSymbolicLink() ? readlinkSync(path) : readFileSync(path, "utf8");
}

// Each line of a fenced block, and each inline span. A fence is matched first: read as three inline delimiters,
// it leaves one backtick over and pairs every later span the wrong way round.
function codeIn(markdown: string): string[] {
  return [...markdown.matchAll(/^[ \t]*```[^\n]*\n([\s\S]*?)^[ \t]*```|`([^`]+)`/gm)].flatMap(([, block, span]) =>
    block === undefined ? [span] : block.split("\n"),
  );
}

const skillFiles = shipped().filter((file) => {
  const parts = file.split(sep);
  return parts.length === 3 && parts[0] === "skills" && parts[2] === "SKILL.md";
});

describe("what the skills read", () => {
  it("ships at least one skill", () => {
    assert.notDeepEqual(skillFiles, []);
  });

  // Each names a second source for the spec: planner's issue-spec skill, the spec-location comment, or a read of
  // comments (`gh issue view --comments`, a `/comments` API path).
  const secondSources = ["issue-spec", "speclocation", "SPECLOC", "location comment", "--comments", "/comments"];
  it(`names none of ${secondSources.map((named) => JSON.stringify(named)).join(", ")}`, () => {
    for (const skill of skillFiles) {
      const text = trackedText(skill);
      for (const named of secondSources) {
        assert.ok(!text.includes(named), `${skill} names ${named}`);
      }
    }
  });

  // A `$(...)` inside another command's arguments does not stop the shell when it fails: the command runs on an
  // empty value (`git diff ...HEAD` is an empty diff; `gh --repo ""` picks another remote's repo).
  it("reads every value on its own, as `name=$(...)`, never inside another command's arguments", () => {
    const readOnItsOwn = /^\s*\w+=\$\(/;
    for (const skill of skillFiles) {
      for (const command of codeIn(trackedText(skill))) {
        if (!command.includes("$(")) continue;
        assert.ok(readOnItsOwn.test(command) && command.split("$(").length === 2, `${skill}: ${command}`);
      }
    }
  });
});

// A skill, workflow or agent of a codeworks plugin is called as `<plugin>:<name>`.
const pluginNames = (JSON.parse(readFileSync(MARKETPLACE, "utf8")) as { plugins: { name: string }[] }).plugins.map(
  ({ name }) => name,
);
const COMMAND = new RegExp(`\\b(?:${pluginNames.join("|")}):[\\w-]+`, "g");

// Per file, the other plugins' commands it may name: issue-tackle launches reviewer's round once the code is done;
// root-cause-check sets itself apart from auditor's audit, naming it without calling it.
const ALLOWED: Readonly<Record<string, ReadonlySet<string>>> = {
  "skills/issue-tackle/SKILL.md": new Set(["reviewer:review-round"]),
  "skills/root-cause-check/SKILL.md": new Set(["auditor:pr-audit"]),
};

function commands(files: readonly string[]): Set<string> {
  const names = new Set<string>();
  for (const file of files) {
    const parts = file.split(sep);
    if (parts[0] === "skills" && basename(file) === "SKILL.md") names.add(parts[1]);
    else if ((parts[0] === "workflows" && extname(file) === ".js") || (parts[0] === "agents" && extname(file) === ".md")) {
      names.add(basename(file, extname(file)));
    }
  }
  return new Set([...names].map((name) => `${OWN}:${name}`));
}

describe("builder's commands and dependencies (builder ADR-0002 d1)", () => {
  it("declares no plugin dependency in its manifest", () => {
    const manifest: object = JSON.parse(trackedText(".claude-plugin/plugin.json"));
    assert.equal(Object.hasOwn(manifest, "dependencies"), false);
  });

  it("ships issue-tackle and root-cause-check", () => {
    assert.deepEqual(commands(shipped()), new Set(["builder:issue-tackle", "builder:root-cause-check"]));
  });

  it("names no codeworks plugin's command it does not ship, but the ones each file is allowed", () => {
    const files = shipped();
    const own = commands(files);
    const unshipped = Object.fromEntries(
      files
        .map((file) => [file, [...trackedText(file).matchAll(COMMAND)].map(([command]) => command)] as const)
        .map(([file, named]) => [file, [...new Set(named)].filter((c) => !own.has(c) && !ALLOWED[file]?.has(c))] as const)
        .filter(([, found]) => found.length > 0),
    );
    assert.deepEqual(unshipped, {});
  });
});
