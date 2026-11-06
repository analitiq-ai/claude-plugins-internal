import assert from "node:assert/strict";
import { existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";

import { sessionFolder, type Session } from "../plugin/core/commit-pass.ts";
import { correctMemo, type CorrectMemo, MemoRefused, readMemo, type ReadMemo, recordCorrect, recordRead } from "../plugin/lib/check/claim.ts";
import { tempSession } from "./support/session.ts";

const PATCH = "145e3cc0dc6c33a0fe33b1599033369dd88e1a5a";
const CLAIM = "0123456789abcdef";
const READ: ReadMemo = { brief: "the reader brief", kind: "PROSE", claims: [{ offset: 0, quote: "The validator rejects an empty list", category: "K1" }] };
const CORRECT: CorrectMemo = {
  category: "K1",
  evidence_blobs: { "validator.py": "b".repeat(40) },
  verdict: { verdict: "CORRECT", basis: "b", assertions: [{ text: "it rejects an empty list", confirmed: true, evidence: "validator.py:2" }] },
};

const memos = (session: Session): string => join(sessionFolder(session), "memos");
const modeOf = (path: string): number => statSync(path).mode & 0o777;

function plant(session: Session, name: string, text: string): string {
  mkdirSync(memos(session), { recursive: true });
  const path = join(memos(session), name);
  writeFileSync(path, text);
  return path;
}

function refusedFor(path: string, why: RegExp) {
  return (error: unknown): boolean => error instanceof MemoRefused && error.path === path && why.test(error.message);
}

describe("claim memos (FR-017)", () => {
  it("keeps a reader's answer by its hunk's patch id in memos/read-<patch id>.json, a 0600 file in a 0700 folder", (t) => {
    const session = tempSession(t);
    recordRead(session, PATCH, READ);
    assert.deepEqual(readMemo(session, PATCH), READ);
    assert.deepEqual(readdirSync(memos(session)), [`read-${PATCH}.json`]);
    assert.equal(modeOf(memos(session)), 0o700);
    assert.equal(modeOf(join(memos(session), `read-${PATCH}.json`)), 0o600);
  });

  it("keeps a CORRECT verdict by its claim id in memos/correct-<claim id>.json", (t) => {
    const session = tempSession(t);
    recordCorrect(session, CLAIM, CORRECT);
    assert.deepEqual(correctMemo(session, CLAIM), CORRECT);
    assert.deepEqual(readdirSync(memos(session)), [`correct-${CLAIM}.json`]);
  });

  it("reads null for a key with no memo, the memos folder absent or not", (t) => {
    const session = tempSession(t);
    assert.equal(readMemo(session, PATCH), null);
    assert.equal(correctMemo(session, CLAIM), null);
    recordRead(session, "a".repeat(40), READ);
    assert.equal(readMemo(session, PATCH), null);
  });

  it("replaces a memo recorded again under its key", (t) => {
    const session = tempSession(t);
    recordRead(session, PATCH, READ);
    const again: ReadMemo = { ...READ, brief: "a newer brief", claims: [] };
    recordRead(session, PATCH, again);
    assert.deepEqual(readMemo(session, PATCH), again);
  });

  it("refuses a memo file that is not JSON, or not a memo, naming the file", (t) => {
    const session = tempSession(t);
    const read = plant(session, `read-${PATCH}.json`, "{");
    assert.throws(() => readMemo(session, PATCH), refusedFor(read, /not JSON/));
    plant(session, `read-${PATCH}.json`, JSON.stringify({ ...READ, kind: "TEXT" }));
    assert.throws(() => readMemo(session, PATCH), refusedFor(read, /kind/));
    const correct = plant(session, `correct-${CLAIM}.json`, JSON.stringify({ ...CORRECT, verdict: { ...CORRECT.verdict, verdict: "WRONG" } }));
    assert.throws(() => correctMemo(session, CLAIM), refusedFor(correct, /verdict/));
  });

  it("refuses to record what is not a memo, writing nothing", (t) => {
    const session = tempSession(t);
    assert.throws(() => recordCorrect(session, CLAIM, { ...CORRECT, verdict: { ...CORRECT.verdict, verdict: "WRONG" } }), { name: "ZodError" });
    assert.throws(() => recordCorrect(session, CLAIM, { ...CORRECT, category: "K3" as CorrectMemo["category"] }), { name: "ZodError" });
    assert.throws(() => recordRead(session, PATCH, { ...READ, claims: [{ ...READ.claims[0], offset: -1 }] }), { name: "ZodError" });
    assert.equal(existsSync(memos(session)), false);
  });

  it("refuses a key that is not a patch id or a claim id, and writes nothing", (t) => {
    const session = tempSession(t);
    for (const key of ["../x", PATCH.toUpperCase(), PATCH.slice(1), ""]) {
      assert.throws(() => readMemo(session, key), TypeError, key);
      assert.throws(() => recordRead(session, key, READ), TypeError, key);
    }
    for (const key of ["../x", CLAIM.toUpperCase(), `${CLAIM}0`, ""]) {
      assert.throws(() => correctMemo(session, key), TypeError, key);
      assert.throws(() => recordCorrect(session, key, CORRECT), TypeError, key);
    }
    assert.equal(existsSync(memos(session)), false);
  });
});
