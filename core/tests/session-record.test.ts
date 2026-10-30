import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { SessionRecord } from "../src/contracts/session-record.ts";
import { readSessionRecord, SessionRecordRefused, writeSessionRecord } from "../src/session-record.ts";

const RECORD: SessionRecord = { v: 1, repo: "acme/widgets", issue: 212, taken: "claim", at: "2026-10-30T12:00:00Z" };

function scratch(t: TestContext): string {
  const root = mkdtempSync(join(tmpdir(), "core-session-record-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

describe("SessionRecord", () => {
  it("accepts the contract's record, taken by a claim or a resume", () => {
    assert.deepEqual(SessionRecord.parse(RECORD), RECORD);
    assert.deepEqual(SessionRecord.parse({ ...RECORD, taken: "resume" }), { ...RECORD, taken: "resume" });
  });

  const refused: [string, unknown][] = [
    ["v 2", { ...RECORD, v: 2 }],
    ["v as text", { ...RECORD, v: "1" }],
    ["a key the contract lacks", { ...RECORD, branch: "212-us1-claim" }],
    ["no at", { v: 1, repo: "acme/widgets", issue: 212, taken: "claim" }],
    ["a repository without its owner", { ...RECORD, repo: "widgets" }],
    ["a repository of three parts", { ...RECORD, repo: "acme/widgets/x" }],
    ["a repository with a .. segment", { ...RECORD, repo: "acme/.." }],
    ["an empty owner", { ...RECORD, repo: "/widgets" }],
    ["issue 0", { ...RECORD, issue: 0 }],
    ["a negative issue", { ...RECORD, issue: -3 }],
    ["a fractional issue", { ...RECORD, issue: 1.5 }],
    ["an issue as text", { ...RECORD, issue: "212" }],
    ["taken by a start", { ...RECORD, taken: "start" }],
    ["taken in upper case", { ...RECORD, taken: "CLAIM" }],
    ["a time with milliseconds", { ...RECORD, at: "2026-10-30T12:00:00.000Z" }],
    ["a time with no zone", { ...RECORD, at: "2026-10-30T12:00:00" }],
    ["a date alone", { ...RECORD, at: "2026-10-30" }],
  ];
  for (const [what, record] of refused) {
    it(`refuses ${what}`, () => {
      assert.equal(SessionRecord.safeParse(record).success, false);
    });
  }
});

describe("writeSessionRecord and readSessionRecord", () => {
  it("round-trip the record under <session id>.json", (t) => {
    const folder = join(scratch(t), "sessions");
    const sessionId = randomUUID();
    writeSessionRecord(folder, sessionId, RECORD);
    assert.deepEqual(readSessionRecord(folder, sessionId), RECORD);
    assert.deepEqual(JSON.parse(readFileSync(join(folder, `${sessionId}.json`), "utf8")), RECORD);
  });

  it("write the file 0600 and leave no temp file beside it", (t) => {
    const folder = join(scratch(t), "state", "sessions");
    const sessionId = randomUUID();
    writeSessionRecord(folder, sessionId, RECORD);
    assert.equal(modeOf(join(folder, `${sessionId}.json`)), 0o600);
    assert.deepEqual(readdirSync(folder), [`${sessionId}.json`]);
  });

  it("refuse a second write, leaving the first and no temp file", (t) => {
    const folder = join(scratch(t), "sessions");
    const sessionId = randomUUID();
    writeSessionRecord(folder, sessionId, RECORD);
    assert.throws(
      () => writeSessionRecord(folder, sessionId, { ...RECORD, issue: 213, taken: "resume" }),
      (error: unknown) => (error as NodeJS.ErrnoException).code === "EEXIST",
    );
    assert.deepEqual(readSessionRecord(folder, sessionId), RECORD);
    assert.deepEqual(readdirSync(folder), [`${sessionId}.json`]);
  });

  it("keep each session's record apart", (t) => {
    const folder = join(scratch(t), "sessions");
    const [first, second] = [randomUUID(), randomUUID()];
    writeSessionRecord(folder, first, RECORD);
    writeSessionRecord(folder, second, { ...RECORD, issue: 213, taken: "resume" });
    assert.deepEqual(readSessionRecord(folder, first), RECORD);
    assert.deepEqual(readSessionRecord(folder, second), { ...RECORD, issue: 213, taken: "resume" });
  });

  it("refuse to write a record outside the contract, writing nothing", (t) => {
    const folder = join(scratch(t), "sessions");
    const sessionId = randomUUID();
    assert.throws(() => writeSessionRecord(folder, sessionId, { ...RECORD, issue: 0 }));
    assert.equal(existsSync(join(folder, `${sessionId}.json`)), false);
  });

  for (const sessionId of ["", "session", "../escape", `${randomUUID()}/x`, `${randomUUID()}.json`, randomUUID().replace(/-/g, "")]) {
    it(`refuse the session id ${JSON.stringify(sessionId)} on write and read, writing nothing`, (t) => {
      const root = scratch(t);
      const folder = join(root, "sessions");
      assert.throws(() => writeSessionRecord(folder, sessionId, RECORD), TypeError);
      assert.throws(() => readSessionRecord(folder, sessionId), TypeError);
      assert.deepEqual(readdirSync(root), []);
    });
  }

  it("read an absent record as null", (t) => {
    const folder = join(scratch(t), "sessions");
    assert.equal(readSessionRecord(folder, randomUUID()), null);
    mkdirSync(folder);
    assert.equal(readSessionRecord(folder, randomUUID()), null);
  });

  const invalid: [string, string][] = [
    ["not JSON", "{\"v\": 1,"],
    ["outside the contract", `${JSON.stringify({ ...RECORD, taken: "start" })}\n`],
    ["empty", ""],
  ];
  for (const [what, text] of invalid) {
    it(`refuse a record that is ${what}, naming the file and leaving it`, (t) => {
      const folder = join(scratch(t), "sessions");
      mkdirSync(folder);
      const sessionId = randomUUID();
      const path = join(folder, `${sessionId}.json`);
      writeFileSync(path, text, { mode: 0o600 });
      assert.throws(() => readSessionRecord(folder, sessionId), (error: unknown) => {
        assert.ok(error instanceof SessionRecordRefused);
        assert.ok(error.message.includes(path), error.message);
        return true;
      });
      assert.equal(readFileSync(path, "utf8"), text);
    });
  }
});
