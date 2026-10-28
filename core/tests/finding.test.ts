import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { Finding } from "../src/contracts/finding.ts";

type Fields = Record<string, unknown>;

function finding(fields: Fields = {}): Fields {
  return {
    source: "fixture",
    key: "fixture:F1",
    author: "fixture-bot[bot]",
    file: "src/app.ts",
    line: 12,
    text: "the retry budget is never reset",
    thread_id: null,
    resolvable: false,
    trusted_comments: [],
    latest_trusted_comment_id: null,
    ...fields,
  };
}

function threadFinding(fields: Fields = {}): Fields {
  return finding({
    source: "threads",
    key: "thread:PRRT_1",
    author: "alice",
    thread_id: "PRRT_1",
    resolvable: true,
    trusted_comments: [
      { id: "PRRC_1", author: "alice", body: "the retry budget is never reset" },
      { id: "PRRC_3", author: "carol", body: "still so at this head" },
    ],
    latest_trusted_comment_id: "PRRC_3",
    ...fields,
  });
}

function accepted(value: Fields): void {
  const parsed = Finding.safeParse(value);
  if (!parsed.success) assert.fail(z.prettifyError(parsed.error));
  assert.deepEqual(parsed.data, value);
}

// Every issue's path is compared, so a refusal for any other reason than the one named fails the test.
function refusedAt(value: Fields, ...paths: PropertyKey[][]): void {
  const parsed = Finding.safeParse(value);
  if (parsed.success) assert.fail("accepted");
  assert.deepEqual(
    parsed.error.issues.map((issue) => issue.path),
    paths,
    z.prettifyError(parsed.error),
  );
}

test("a module's finding with no thread is accepted as written", () => {
  accepted(finding());
});

test("a thread's finding is accepted as written", () => {
  accepted(threadFinding());
});

test("a required check's finding, with no file and no line, is accepted as written", () => {
  accepted(
    finding({
      source: "required-checks",
      key: "required-check:build",
      author: "github-actions",
      file: null,
      line: null,
      text: "build concluded failure",
    }),
  );
});

test("source is a FindingSource", () => {
  for (const source of ["threads", "required-checks", "fixture", "a-1"]) accepted(finding({ source }));
  for (const source of ["Fixture", "bad_name", "1x", "-x", "", 7, null]) refusedAt(finding({ source }), ["source"]);
});

test("key is non-empty", () => {
  refusedAt(finding({ key: "" }), ["key"]);
});

test("line is an integer of at least 1, or null", () => {
  accepted(finding({ line: 1 }));
  accepted(finding({ line: null }));
  for (const line of [0, -1, 1.5]) refusedAt(finding({ line }), ["line"]);
});

test("resolvable is true exactly when thread_id is set", () => {
  refusedAt(finding({ resolvable: true }), ["resolvable"]);
  refusedAt(threadFinding({ resolvable: false }), ["resolvable"]);
});

test("latest_trusted_comment_id is set exactly when thread_id is set", () => {
  refusedAt(finding({ latest_trusted_comment_id: "PRRC_1" }), ["latest_trusted_comment_id"]);
  refusedAt(threadFinding({ latest_trusted_comment_id: null }), ["latest_trusted_comment_id"]);
});

test("trusted_comments is empty without a thread", () => {
  refusedAt(finding({ trusted_comments: [{ id: "PRRC_1", author: "alice", body: "dummy" }] }), ["trusted_comments"]);
});

test("a finding with every thread field dropped but thread_id is refused at each of them", () => {
  refusedAt(
    threadFinding({ resolvable: false, trusted_comments: [], latest_trusted_comment_id: null }),
    ["resolvable"],
    ["latest_trusted_comment_id"],
  );
});

test("an unknown key is refused, in the finding and in a trusted comment", () => {
  refusedAt(finding({ ruling: "FIX" }), []);
  refusedAt(
    threadFinding({ trusted_comments: [{ id: "PRRC_1", author: "alice", body: "dummy", url: "dummy" }] }),
    ["trusted_comments", 0],
  );
});
