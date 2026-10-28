import assert from "node:assert/strict";
import { test } from "node:test";

import { parseBranch } from "../src/identity.ts";

test("a story branch gives its issue, and carries k and the slug unchecked", () => {
  assert.deepEqual(parseBranch("212-us2-retry-budget"), { story: 212, k: 2, slug: "retry-budget" });
});

test("a spec branch gives the spec's issue", () => {
  assert.deepEqual(parseBranch("145-spec"), { spec: 145 });
});

// The spec's edge cases, then the edges each part of the grammar draws.
for (const name of [
  "main",
  "feature/x",
  "212-us-retry",
  "0212-us2-x",
  "212-us2-",
  "212-spec-x",
  "0145-spec",
  "212-us0-x",
  "212-us02-x",
  "212-us2-Retry",
  "212-us2-retry--budget",
  "212-us2-retry_budget",
  "212-us2-retry-budget\n",
  "refs/heads/212-us2-retry-budget",
  "",
]) {
  test(`${JSON.stringify(name)} is no story and no spec`, () => {
    assert.equal(parseBranch(name), null);
  });
}
