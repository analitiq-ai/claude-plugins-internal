import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { APP_PERMISSIONS } from "../src/tokens.ts";

const SECURITY = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "SECURITY.md");

// §3 names a permission as GitHub's settings page does; a token request names it by GitHub's API key.
// A name missing here fails the read, so §3 cannot grant one the table does not map.
const API_KEYS: Record<string, Record<string, string>> = {
  "Repository permissions": {
    metadata: "metadata",
    contents: "contents",
    "pull requests": "pull_requests",
    issues: "issues",
    checks: "checks",
    statuses: "statuses",
    actions: "actions",
    workflows: "workflows",
  },
  "Organization permissions": { projects: "organization_projects" },
};

function cells(line: string): string[] {
  return line.split("|").slice(1, -1).map((cell) => cell.trim());
}

/** One column's grants: `a, b: level` clauses, `none`, or `no write`, which the clauses must bear out. */
function grants(cell: string, column: string, app: string): Record<string, string> {
  const keys = API_KEYS[column];
  const out: Record<string, string> = {};
  const clauses = cell.split(";").map((clause) => clause.trim());
  for (const clause of clauses) {
    if (clause === "none" || clause === "no write") continue;
    const granted = /^(.+):\s*(read|write)$/.exec(clause);
    assert.ok(granted, `§3 ${app} ${column}: ${JSON.stringify(clause)} is no grant`);
    for (const name of granted[1].split(",").map((part) => part.trim())) {
      assert.ok(Object.hasOwn(keys, name), `§3 ${app} ${column}: ${JSON.stringify(name)} has no API key`);
      out[keys[name]] = granted[2];
    }
  }
  if (clauses.includes("no write")) {
    assert.ok(!Object.values(out).includes("write"), `§3 ${app} ${column} says "no write" and grants a write`);
  }
  return out;
}

/** §3's identity table, each App by its name without the `codeworks-` prefix, its grants under API keys. */
function section3Sets(markdown: string): Record<string, Record<string, string>> {
  const lines = markdown.split("\n");
  const start = lines.findIndex((line) => line.startsWith("## 3. "));
  assert.notEqual(start, -1, "SECURITY.md has no §3");
  const after = lines.slice(start + 1);
  const end = after.findIndex((line) => line.startsWith("## "));
  const table = (end === -1 ? after : after.slice(0, end)).filter((line) => line.startsWith("|"));
  assert.ok(table.length > 2, "SECURITY.md §3 holds no table");
  const header = cells(table[0]);
  const columns = Object.keys(API_KEYS).map((column) => {
    const at = header.indexOf(column);
    assert.notEqual(at, -1, `§3's table has no ${column} column`);
    return { column, at };
  });
  const sets: Record<string, Record<string, string>> = {};
  for (const row of table.slice(2).map(cells)) {
    const app = row[0].replace(/^`codeworks-(.+)`$/, "$1");
    sets[app] = Object.assign({}, ...columns.map(({ column, at }) => grants(row[at], column, app)));
  }
  return sets;
}

describe("tokens.ts's permission sets against SECURITY.md §3", () => {
  const markdown = readFileSync(SECURITY, "utf8");

  it("holds each of §3's Apps with exactly §3's permissions under GitHub's API keys", () => {
    assert.deepEqual(section3Sets(markdown), APP_PERMISSIONS);
  });

  it("gives the orchestrator App workflows: write", () => {
    assert.equal(APP_PERMISSIONS.orchestrator.workflows, "write");
  });

  it("fails on a name §3 grants that has no API key", () => {
    const added = markdown.replace("issues, checks, statuses, actions: read", "issues, checks, statuses, secrets: read");
    assert.notEqual(added, markdown, "§3's session row changed: the fixture edit no longer applies");
    assert.throws(() => section3Sets(added), /"secrets" has no API key/);
  });

  it("reads the level §3 writes, so a changed level differs from tokens.ts's", () => {
    const changed = markdown.replace("| issues: write | none |", "| issues: read | none |");
    assert.notEqual(changed, markdown, "§3's reviewer row changed: the fixture edit no longer applies");
    assert.deepEqual(section3Sets(changed).reviewer, { issues: "read" });
  });
});
