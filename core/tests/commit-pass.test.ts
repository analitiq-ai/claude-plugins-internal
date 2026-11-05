import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chmodSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";
import { z } from "zod";

import { CommitPassesRefused, type PassedRange, readCommitPasses, recordCommitPasses, type Session, setReviewerOff } from "../src/commit-pass.ts";
import { CommitPasses } from "../src/contracts/commit-pass.ts";

const REPO = "acme/widgets";
const A = "a".repeat(40);
const B = "b".repeat(40);
const B2 = "c".repeat(40);
const C = "d".repeat(40);
const AT_1 = "2026-10-30T12:00:00Z";
const AT_2 = "2026-10-30T12:05:00Z";
const AT_3 = "2026-10-30T12:10:00Z";

function withoutPrototype(entries: CommitPasses["branches"]): CommitPasses["branches"] {
  return Object.assign(Object.create(null), entries);
}

const EXAMPLE: CommitPasses = {
  v: 1,
  repository: REPO,
  off: false,
  branches: withoutPrototype({
    "42-us1-login": { issue: 42, head: { sha: B, range_from: A, at: AT_1 }, passes: [{ sha: B, range_from: A, at: AT_1 }] },
  }),
};

function session(t: TestContext): Session {
  const home = mkdtempSync(join(tmpdir(), "core-commit-pass-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  return { home, id: randomUUID() };
}

function folderOf({ home, id }: Session): string {
  return join(home, ".local/state/codeworks/reviewer/sessions", id);
}

function fileOf(each: Session): string {
  return join(folderOf(each), "commit-passes.json");
}

function modeOf(path: string): number {
  return statSync(path).mode & 0o777;
}

function pass(sha: string, range_from: string, at: string) {
  return { sha, range_from, at };
}

describe("CommitPasses", () => {
  it("accepts the contract's record", () => {
    assert.deepEqual(CommitPasses.parse(EXAMPLE), EXAMPLE);
  });

  const branch = EXAMPLE.branches["42-us1-login"];
  const refused: [string, unknown][] = [
    ["v 2", { ...EXAMPLE, v: 2 }],
    ["a key the contract lacks", { ...EXAMPLE, session: "x" }],
    ["no off", { v: 1, repository: REPO, branches: {} }],
    ["a repository without its owner", { ...EXAMPLE, repository: "widgets" }],
    ["issue 0", { ...EXAMPLE, branches: { "42-us1-login": { ...branch, issue: 0 } } }],
    ["a sha of 39 characters", { ...EXAMPLE, branches: { "42-us1-login": { ...branch, head: pass(B.slice(1), A, AT_1), passes: [pass(B.slice(1), A, AT_1)] } } }],
    ["a time with milliseconds", { ...EXAMPLE, branches: { "42-us1-login": { ...branch, head: pass(B, A, "2026-10-30T12:00:00.000Z") } } }],
    ["a sha twice in passes", { ...EXAMPLE, branches: { "42-us1-login": { ...branch, passes: [pass(B, A, AT_1), pass(B, A, AT_2)] } } }],
    ["a head whose sha is not in passes", { ...EXAMPLE, branches: { "42-us1-login": { ...branch, head: pass(C, A, AT_1) } } }],
    ["a branch named __proto__", { ...EXAMPLE, branches: JSON.parse(`{"__proto__": ${JSON.stringify(branch)}}`) }],
  ];
  for (const [what, record] of refused) {
    it(`refuses ${what}`, () => {
      assert.equal(CommitPasses.safeParse(record).success, false);
    });
  }
});

describe("readCommitPasses", () => {
  it("answers null when the session has no record", (t) => {
    assert.equal(readCommitPasses(session(t)), null);
  });

  for (const [what, text] of [
    ["text that is not JSON", "{"],
    ["JSON that is not the contract's", JSON.stringify({ ...EXAMPLE, v: 2 })],
  ]) {
    it(`throws CommitPassesRefused naming the file for ${what}`, (t) => {
      const each = session(t);
      mkdirSync(folderOf(each), { recursive: true });
      writeFileSync(fileOf(each), text);
      assert.throws(() => readCommitPasses(each), (error: unknown) => error instanceof CommitPassesRefused && error.path === fileOf(each));
    });
  }

  it("reads a branch the record lacks as undefined, even one named like an Object member", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    const record = readCommitPasses(each);
    assert.ok(record !== null);
    assert.deepEqual(Object.keys(record.branches), ["42-us1-login"]);
    for (const name of ["constructor", "toString", "hasOwnProperty", "__proto__"]) {
      assert.equal(record.branches[name], undefined, name);
    }
  });

  for (const id of ["not-a-uuid", "../x"]) {
    it(`refuses the session id ${id}, which is not a UUID`, (t) => {
      assert.throws(() => readCommitPasses({ ...session(t), id }), TypeError);
    });
  }
});

describe("recordCommitPasses", () => {
  it("writes the first pass of a branch as its head and its one pass", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    assert.deepEqual(readCommitPasses(each), EXAMPLE);
  });

  it("appends every sha of the range not already there, oldest to newest, and sets head to the range's head", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B, B2, C], at: AT_2 });
    assert.deepEqual(readCommitPasses(each)?.branches["42-us1-login"], {
      issue: 42,
      head: pass(C, A, AT_2),
      passes: [pass(B, A, AT_1), pass(B2, A, AT_2), pass(C, A, AT_2)],
    });
  });

  it("sets head on a pass of a sha already in passes: GitHub at A, pass B, amend to B′ and pass, restore B and pass → head B", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B2], at: AT_2 });
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_3 });
    assert.deepEqual(readCommitPasses(each)?.branches["42-us1-login"], {
      issue: 42,
      head: pass(B, A, AT_3),
      passes: [pass(B, A, AT_1), pass(B2, A, AT_2)],
    });
  });

  it("keeps a newest pass per branch: claims #42 then #43 in one session", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    recordCommitPasses(each, { repository: REPO, issue: 43, branch: "43-us1-other", from: A, shas: [C], at: AT_2 });
    const branches = readCommitPasses(each)?.branches;
    assert.deepEqual(branches?.["42-us1-login"].head, pass(B, A, AT_1));
    assert.deepEqual(branches?.["43-us1-other"], { issue: 43, head: pass(C, A, AT_2), passes: [pass(C, A, AT_2)] });
  });

  it("refuses a repository differing from the file's, leaving the file as it was", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    assert.throws(
      () => recordCommitPasses(each, { repository: "acme/other", issue: 42, branch: "42-us1-login", from: A, shas: [C], at: AT_2 }),
      CommitPassesRefused,
    );
    assert.deepEqual(readCommitPasses(each), EXAMPLE);
  });

  it("refuses an issue differing from the branch entry's, leaving the file as it was", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    assert.throws(
      () => recordCommitPasses(each, { repository: REPO, issue: 43, branch: "42-us1-login", from: A, shas: [C], at: AT_2 }),
      CommitPassesRefused,
    );
    assert.deepEqual(readCommitPasses(each), EXAMPLE);
  });

  it("refuses a range of no commit, which has no head", (t) => {
    const each = session(t);
    assert.throws(() => recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [], at: AT_1 }), CommitPassesRefused);
    assert.equal(readCommitPasses(each), null);
  });

  it("refuses a branch named __proto__, writing no file", (t) => {
    const each = session(t);
    assert.throws(() => recordCommitPasses(each, { repository: REPO, issue: 42, branch: "__proto__", from: A, shas: [B], at: AT_1 }), z.ZodError);
    assert.equal(readCommitPasses(each), null);
  });

  it("keeps a branch named constructor, a name Object.prototype also holds", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "constructor", from: A, shas: [B], at: AT_1 });
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "constructor", from: A, shas: [C], at: AT_2 });
    assert.deepEqual(
      readCommitPasses(each)?.branches,
      withoutPrototype({ constructor: { issue: 42, head: pass(C, A, AT_2), passes: [pass(B, A, AT_1), pass(C, A, AT_2)] } }),
    );
  });

  const malformed: [string, Partial<PassedRange>][] = [
    ["a base that is no sha", { from: "main" }],
    ["a sha of 39 characters", { shas: [B.slice(1)] }],
    ["a time with no zone", { at: "2026-10-30T12:00:00" }],
    ["issue 0", { issue: 0 }],
    ["a repository without its owner", { repository: "widgets" }],
  ];
  for (const [what, change] of malformed) {
    it(`refuses a pass with ${what}, writing no file`, (t) => {
      const each = session(t);
      assert.throws(() => recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1, ...change }), z.ZodError);
      assert.equal(readCommitPasses(each), null);
    });
  }

  it("refuses a malformed pass over a record, leaving the file's bytes as they were", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    const before = readFileSync(fileOf(each), "utf8");
    assert.throws(() => recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: "main", shas: [C], at: AT_2 }), z.ZodError);
    assert.equal(readFileSync(fileOf(each), "utf8"), before);
  });

  it("writes the file 0600 in a folder made 0700 even when it exists, replacing the file by rename and leaving no temp file", (t) => {
    const each = session(t);
    mkdirSync(folderOf(each), { recursive: true, mode: 0o755 });
    chmodSync(folderOf(each), 0o755);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 });
    const first = statSync(fileOf(each)).ino;
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [C], at: AT_2 });
    assert.equal(modeOf(folderOf(each)), 0o700);
    assert.equal(modeOf(fileOf(each)), 0o600);
    assert.notEqual(statSync(fileOf(each)).ino, first);
    assert.deepEqual(readdirSync(folderOf(each)), ["commit-passes.json"]);
  });
});

const writers: [string, (each: Session) => void][] = [
  ["recordCommitPasses", (each) => recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B], at: AT_1 })],
  ["setReviewerOff", (each) => setReviewerOff(each, REPO, true)],
];
for (const [name, write] of writers) {
  describe(name, () => {
    for (const [what, text] of [
      ["text that is not JSON", "{"],
      ["JSON that is not the contract's", JSON.stringify({ ...EXAMPLE, v: 2 })],
    ]) {
      it(`throws CommitPassesRefused over a file of ${what}, leaving its bytes as they were`, (t) => {
        const each = session(t);
        mkdirSync(folderOf(each), { recursive: true });
        writeFileSync(fileOf(each), text);
        assert.throws(() => write(each), CommitPassesRefused);
        assert.equal(readFileSync(fileOf(each), "utf8"), text);
      });
    }
  });
}

describe("setReviewerOff", () => {
  it("refuses a repository without its owner, writing no file", (t) => {
    const each = session(t);
    assert.throws(() => setReviewerOff(each, "widgets", true), z.ZodError);
    assert.equal(readCommitPasses(each), null);
  });

  it("creates the session's record with no branch when it has none", (t) => {
    const each = session(t);
    setReviewerOff(each, REPO, true);
    assert.deepEqual(readCommitPasses(each), { v: 1, repository: REPO, off: true, branches: withoutPrototype({}) });
    assert.equal(modeOf(fileOf(each)), 0o600);
  });

  it("sets and clears off, keeping every branch's passes", (t) => {
    const each = session(t);
    recordCommitPasses(each, { repository: REPO, issue: 42, branch: "42-us1-login", from: A, shas: [B, B2], at: AT_1 });
    recordCommitPasses(each, { repository: REPO, issue: 43, branch: "43-us1-other", from: A, shas: [C], at: AT_2 });
    const before = readCommitPasses(each);
    assert.ok(before !== null);
    setReviewerOff(each, REPO, true);
    assert.deepEqual(readCommitPasses(each), { ...before, off: true });
    setReviewerOff(each, REPO, false);
    assert.deepEqual(readCommitPasses(each), before);
  });

  it("refuses a repository differing from the file's, leaving the file as it was", (t) => {
    const each = session(t);
    setReviewerOff(each, REPO, false);
    const before = readFileSync(fileOf(each), "utf8");
    assert.throws(() => setReviewerOff(each, "acme/other", true), CommitPassesRefused);
    assert.equal(readFileSync(fileOf(each), "utf8"), before);
  });
});
