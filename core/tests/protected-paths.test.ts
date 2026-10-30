import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { protectedPaths } from "../src/protected-paths.ts";

// Each changed file, and the protected path it touches (orchestrator ADR-0004 d4).
const AT_ROOT = [
  ["codeworks.toml", "codeworks.toml"],
  [".github/workflows/tests.yml", ".github"],
  [".claude/settings.json", ".claude"],
  [".specify/memory/constitution.md", ".specify/memory"],
  ["docs/adr/0001-widgets.md", "docs/adr"],
  ["AGENTS.md", "AGENTS.md"],
  ["CLAUDE.md", "CLAUDE.md"],
];

describe("protectedPaths", () => {
  for (const [changed, touched] of AT_ROOT) {
    it(`names ${touched} for ${changed}`, () => {
      assert.deepEqual(protectedPaths([changed]), [touched]);
    });

    it(`names ${touched} below the root`, () => {
      assert.deepEqual(protectedPaths([`widgets/plugin/${changed}`]), [`widgets/plugin/${touched}`]);
    });
  }

  for (const [changed, touched] of [
    ["CODEWORKS.TOML", "CODEWORKS.TOML"],
    [".GitHub/workflows/tests.yml", ".GitHub"],
    [".Claude/settings.json", ".Claude"],
    [".SPECIFY/Memory/constitution.md", ".SPECIFY/Memory"],
    ["widgets/Docs/ADR/0001-widgets.md", "widgets/Docs/ADR"],
    ["agents.md", "agents.md"],
    ["widgets/Claude.MD", "widgets/Claude.MD"],
  ]) {
    it(`names ${touched}, spelt as the PR spells it, for ${changed}`, () => {
      assert.deepEqual(protectedPaths([changed]), [touched]);
    });
  }

  // ſ upper-cases to S and the Kelvin sign lower-cases to k, so each is one of those letters in another case.
  for (const [changed, touched] of [
    [".ſpecify/memory/constitution.md", ".ſpecify/memory"],
    ["codeworKs.toml", "codeworKs.toml"],
  ]) {
    it(`names ${touched} for ${changed}`, () => {
      assert.deepEqual(protectedPaths([changed]), [touched]);
    });
  }

  for (const changed of [
    "README.md",
    "specs/212-widgets/spec.md",
    "docs/adr.md",
    "docs/adr-notes/0001.md",
    "docs/widgets/adr/0001.md",
    "adr/0001.md",
    ".specify/templates/spec-template.md",
    "memory/notes.md",
    ".github-old/workflows/tests.yml",
    "widgets.claude/settings.json",
    "XCLAUDE.md",
    "CLAUDE.md.bak",
    "codeworks.toml.example",
    "validators/deepsource/.deepsource.toml",
  ]) {
    it(`names nothing for ${changed}`, () => {
      assert.deepEqual(protectedPaths([changed]), []);
    });
  }

  it("names nothing when nothing changed", () => {
    assert.deepEqual(protectedPaths([]), []);
  });

  it("names each protected path once, in path order", () => {
    const changed = ["src/widgets.ts", "docs/adr/0002.md", ".github/workflows/b.yml", "docs/adr/0001.md", ".github/workflows/a.yml"];
    assert.deepEqual(protectedPaths(changed), [".github", "docs/adr"]);
  });

  it("names the outermost protected path a file lies under", () => {
    assert.deepEqual(protectedPaths([".claude/docs/adr/0001.md"]), [".claude"]);
  });

  it("refuses a changed file that is not a plain path inside the tree", () => {
    for (const changed of ["", "/CLAUDE.md", "docs//adr/0001.md", "docs/./adr/0001.md", "../CLAUDE.md", ".github/"]) {
      assert.throws(() => protectedPaths([changed]), TypeError, JSON.stringify(changed));
    }
  });
});
