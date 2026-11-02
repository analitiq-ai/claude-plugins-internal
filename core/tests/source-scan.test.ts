import assert from "node:assert/strict";
import {test} from "node:test";

import {readParameterViolations} from "./source-scan.ts";

test("the read-parameter check names each parameter of another type or none, past a comment, an arrow and a default", () => {
  const text = [
    "// export function readKeyed(reader: GitHubClient): void {}",
    "export async function readKeyed(",
    "  reader: GitHubClient, // one (comment)",
    "  machine: Machine,",
    "  onPage: (page: readonly number[]) => void,",
    '  folder = "x",',
    "  s: number,",
    "): Promise<void> {}",
  ].join("\n");
  assert.deepEqual(readParameterViolations(text, "src/in-memory.ts", "readKeyed"), [
    "src/in-memory.ts:4 readKeyed takes machine: Machine",
    "src/in-memory.ts:5 readKeyed takes onPage: (page:readonly number[])=>void",
    "src/in-memory.ts:6 readKeyed takes folder with no type",
  ]);
});

test("the read-parameter check names a function the file does not export", () => {
  const text = "function readKeyed(reader: GitHubClient): void {}";
  assert.deepEqual(readParameterViolations(text, "src/in-memory.ts", "readKeyed"), ["src/in-memory.ts exports no function readKeyed"]);
});
