import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { parseBranch, storyBranchName } from "../src/identity.ts";
import { readParameterViolations } from "./source-scan.ts";

const identitySource = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "identity.ts");

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

// Asserting the round trip here makes every case that calls this assert it too (R8).
function slugOf(s: number, k: number, title: string): string {
  const name = storyBranchName(s, k, title);
  const slug = name.slice(`${s}-us${k}-`.length);
  assert.deepEqual(parseBranch(name), { story: s, k, slug });
  return slug;
}

for (const [what, title, slug] of [
  ["a /", "fix/ci: retry the push", "fix-ci-retry-the-push"],
  ["..", "../../etc/passwd", "etc-passwd"],
  // ſ matches [a-z] under a case-insensitive Unicode regex, yet stays ſ when lowercased.
  ["unicode", "Café ☕ naïve ſtraße 日本語", "caf-na-ve-tra-e"],
  ["uppercase", "RETRY The PUSH", "retry-the-push"],
  ["digits", "Bump zod to 4.6.7", "bump-zod-to-4-6-7"],
  ["runs of punctuation", "retry!!! the -- push???  (again)...", "retry-the-push-again"],
  ["300 characters", "retry the push ".repeat(20), "retry-the-push-retry-the-push-retry-the"],
  ["41 letters", "a".repeat(41), "a".repeat(40)],
]) {
  test(`a title with ${what} gives the slug ${slug}`, () => {
    assert.equal(slugOf(245, 1, title), slug);
  });
}

for (const title of ["", "...", "/../", "!? -- ?!", "()[]{}<>"]) {
  test(`${JSON.stringify(title)} gives the slug story`, () => {
    assert.equal(slugOf(245, 1, title), "story");
  });
}

test("a 40-character cut that lands on - drops it", () => {
  assert.equal(slugOf(245, 1, `${"a".repeat(39)} ${"b".repeat(20)}`), "a".repeat(39));
});

for (const [s, k] of [
  [1, 1],
  [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
]) {
  test(`s = ${s} and k = ${k} are taken, and the name parses back to them`, () => {
    assert.deepEqual(parseBranch(storyBranchName(s, k, "retry the push")), { story: s, k, slug: "retry-the-push" });
  });
}

// TypeError, as specBranch refuses a p that is no issue number.
for (const n of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
  test(`s = ${n} is refused, as no issue number`, () => {
    assert.throws(() => storyBranchName(n, 1, "retry the push"), {name: "TypeError", message: `not an issue number: ${n}`});
  });

  test(`k = ${n} is refused, as no US<k> story index`, () => {
    assert.throws(() => storyBranchName(245, n, "retry the push"), {name: "TypeError", message: `not a US<k> story index: ${n}`});
  });
}

test("storyBranchName takes no key reader: only GitHub's client and plain values", () => {
  assert.deepEqual(readParameterViolations(readFileSync(identitySource, "utf8"), "src/identity.ts", "storyBranchName"), []);
});
