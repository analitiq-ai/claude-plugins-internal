import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { after, before, describe, it } from "node:test";

import { attests, governingDiff, passingRounds, releasedByComment } from "../src/attest.ts";
import type { Hold, Round, Snapshot } from "../src/contracts/snapshot.ts";
import { GitFailed, runGit } from "../src/git.ts";
import type { StateCause } from "../src/state.ts";

const SPEC = "specs/212-widgets";
const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];
const ABSENT = "f".repeat(40);

function at(clock: string): string {
  return `2026-10-28T${clock}:00Z`;
}

function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

function round(fields: Partial<Round> = {}): Round {
  return { stage: "INTERNAL", n: 1, head: sha(1), result: "CLEAN", verdict: null, root_cause: null, at: at("10:00"), ...fields };
}

function releasedHold(fields: Partial<Hold> = {}): Hold {
  return {
    id: "pushback-212",
    kind: "pushback",
    state: "RELEASED",
    since: at("09:00"),
    released: at("10:05"),
    released_by: { comment: 9001, reset: false },
    question: null,
    spec_pr: null,
    ...fields,
  };
}

function snapshot(rounds: Round[], holds: Hold[] = []): Snapshot {
  return { v: 1, rounds, holds, pushbacks: [], rulings: [] };
}

function reading(state: Snapshot | null, causes: StateCause[] = []) {
  return { snapshot: state, held: causes.length > 0, causes };
}

describe("passingRounds", () => {
  it("lists INTERNAL and AUDIT rounds CLEAN, or DIRTY with CONVERGED_PUSHBACK, newest first, never GITHUB", () => {
    const passing = [
      round({ stage: "INTERNAL", n: 1 }),
      round({ stage: "INTERNAL", n: 3, result: "DIRTY", verdict: "CONVERGED_PUSHBACK" }),
      round({ stage: "AUDIT", n: 1 }),
      round({ stage: "AUDIT", n: 2, result: "DIRTY", verdict: "CONVERGED_PUSHBACK" }),
    ];
    const rounds = [
      passing[0],
      round({ stage: "INTERNAL", n: 2, result: "DIRTY", verdict: "PATCH" }),
      passing[1],
      round({ stage: "GITHUB", n: 1 }),
      round({ stage: "INTERNAL", n: 4, result: "INCOMPLETE" }),
      passing[2],
      round({ stage: "GITHUB", n: 2, result: "DIRTY", verdict: "CONVERGED_PUSHBACK" }),
      round({ stage: "AUDIT", n: 3, result: "DIRTY", verdict: "ESCALATE" }),
      passing[3],
    ];
    assert.deepEqual(passingRounds(snapshot(rounds)), passing.toReversed());
  });

  it("lists nothing for a snapshot with no rounds", () => {
    assert.deepEqual(passingRounds(snapshot([])), []);
  });
});

type Listed = [type: "blob" | "tree", object: string, path: string];

// `ls-tree -r -t -z`: one NUL-terminated record per object, trees included.
function listing(...entries: Listed[]): string {
  return entries.map(([type, object, path]) => `${type === "tree" ? "040000" : "100644"} ${type} ${object}\t${path}\0`).join("");
}

const BASE: Listed[] = [
  ["tree", sha(10), ".specify"],
  ["tree", sha(11), ".specify/memory"],
  ["blob", sha(12), ".specify/memory/x.md"],
  ["tree", sha(13), "docs"],
  ["tree", sha(14), "docs/adr"],
  ["blob", sha(15), "docs/adr/x.md"],
  ["tree", sha(16), "plugin/docs/adr"],
  ["blob", sha(17), `${SPEC}/spec.md`],
  ["blob", sha(18), `${SPEC}/plan.md`],
  ["blob", sha(19), "specs/300-other/spec.md"],
  ["tree", sha(20), "docs/adrs"],
  ["tree", sha(21), "xdocs/adr"],
  ["tree", sha(22), "plugin/.specify/memory"],
  ["blob", sha(23), "notes/docs/adr"],
  ["blob", sha(24), "README.md"],
];

function changed(path: string, object = sha(99)): Listed[] {
  return BASE.map(([type, old, listed]) => [type, listed === path ? object : old, listed]);
}

function without(path: string): Listed[] {
  return BASE.filter(([, , listed]) => listed !== path);
}

describe("governingDiff", () => {
  it("names nothing when the governing objects are the same", () => {
    assert.deepEqual(governingDiff(listing(...BASE), listing(...BASE), SPEC), []);
  });

  for (const path of [`${SPEC}/spec.md`, "docs/adr", "plugin/docs/adr", ".specify/memory"]) {
    it(`names ${path} when its object differs`, () => {
      assert.deepEqual(governingDiff(listing(...BASE), listing(...changed(path)), SPEC), [path]);
    });

    it(`names ${path} when it is at only one of the two`, () => {
      assert.deepEqual(governingDiff(listing(...BASE), listing(...without(path)), SPEC), [path]);
      assert.deepEqual(governingDiff(listing(...without(path)), listing(...BASE), SPEC), [path]);
    });
  }

  it("names every governing path that differs, in path order", () => {
    // Only the round holds .specify/memory, so it comes after the base's paths unless the answer is sorted.
    const atBase = without(".specify/memory");
    const atRound = changed("docs/adr").map(([type, object, path]): Listed => [
      type,
      path === `${SPEC}/spec.md` ? sha(98) : object,
      path,
    ]);
    assert.deepEqual(governingDiff(listing(...atBase), listing(...atRound), SPEC), [
      ".specify/memory",
      "docs/adr",
      `${SPEC}/spec.md`,
    ]);
  });

  for (const path of [
    `${SPEC}/plan.md`,
    "specs/300-other/spec.md",
    "docs/adr/x.md",
    ".specify/memory/x.md",
    "docs",
    "docs/adrs",
    "xdocs/adr",
    "plugin/.specify/memory",
    "notes/docs/adr",
    "README.md",
  ]) {
    it(`names nothing for ${path}, changed or one-sided`, () => {
      assert.deepEqual(governingDiff(listing(...BASE), listing(...changed(path)), SPEC), []);
      assert.deepEqual(governingDiff(listing(...BASE), listing(...without(path)), SPEC), []);
    });
  }

  it("refuses a spec folder that is not a plain path inside the tree", () => {
    for (const folder of ["", `${SPEC}/`, `/${SPEC}`, "specs//212-widgets", "specs/../212-widgets", "./specs"]) {
      assert.throws(() => governingDiff(listing(...BASE), listing(...BASE), folder), TypeError, JSON.stringify(folder));
    }
  });

  it("refuses a listing record ls-tree does not document", () => {
    assert.throws(() => governingDiff("not a record\0", listing(...BASE), SPEC), /ls-tree/);
  });
});

describe("releasedByComment", () => {
  const atTen = round({ at: at("10:00") });

  it("names a hold released by a comment after the round's at", () => {
    const hold = releasedHold({ released: at("10:01") });
    assert.deepEqual(releasedByComment(snapshot([atTen], [hold]), atTen), hold);
  });

  it("names none for a hold released by a reset", () => {
    const hold = releasedHold({ released: at("10:01"), released_by: { comment: 9001, reset: true } });
    assert.equal(releasedByComment(snapshot([atTen], [hold]), atTen), null);
  });

  it("names none for a release in the round's second or before it", () => {
    for (const released of [at("10:00"), at("09:59")]) {
      assert.equal(releasedByComment(snapshot([atTen], [releasedHold({ released })]), atTen), null, released);
    }
  });

  it("names none for an open hold", () => {
    const open = releasedHold({ state: "OPEN", since: at("10:30"), released: null, released_by: null });
    assert.equal(releasedByComment(snapshot([atTen], [open]), atTen), null);
  });
});

describe("attests, in a scratch repository", () => {
  const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
  let scratch: string;
  let repo: string;
  const commits: Record<string, string> = {};

  async function git(args: string[], answers: number[] = []): Promise<string> {
    return (await runGit(repo, args, answers)).stdout.trim();
  }

  function write(files: Record<string, string>): void {
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(repo, path)), { recursive: true });
      writeFileSync(join(repo, path), text);
    }
  }

  async function commit(message: string, files: Record<string, string>): Promise<string> {
    write(files);
    await git(["add", "-A"]);
    await git([...COMMITTER, "commit", "-q", "-m", message]);
    return git(["rev-parse", "HEAD"]);
  }

  async function branch(name: string, from: string): Promise<void> {
    await git(["switch", "-q", "-c", name, from]);
  }

  before(async () => {
    scratch = mkdtempSync(join(tmpdir(), "core-attest-"));
    repo = join(scratch, "repo");
    const home = join(scratch, "home");
    mkdirSync(repo);
    mkdirSync(home);
    // Git reads ignore and attribute files under HOME even with no global config; keep it off the real one.
    process.env.HOME = home;
    process.env.XDG_CONFIG_HOME = join(home, ".config");

    await git(["init", "-q", "-b", "main"]);
    commits.root = await commit("root", {
      [`${SPEC}/spec.md`]: "spec\n",
      "specs/300-other/spec.md": "other spec\n",
      "docs/adr/x.md": "adr\n",
      "plugin/docs/adr/x.md": "plugin adr\n",
      ".specify/memory/x.md": "memory\n",
      "src/app.txt": "root\n",
      "README.md": "readme\n",
    });

    await branch("story", commits.root);
    commits.a = await commit("a", { "src/app.txt": "a\n" });
    commits.b = await commit("b", { "src/app.txt": "b\n" });
    await branch("spec-edited", commits.b);
    commits.specEdited = await commit("edit the spec", { [`${SPEC}/spec.md`]: "edited on the branch\n" });

    await branch("rewritten", commits.root);
    await commit("a again", { "src/app.txt": "a, rewritten\n" });
    commits.rewritten = await commit("b again", { "src/app.txt": "b, rewritten\n" });

    for (const [name, path] of [
      ["spec", `${SPEC}/spec.md`],
      ["adr", "docs/adr/x.md"],
      ["plugin-adr", "plugin/docs/adr/x.md"],
      ["memory", ".specify/memory/x.md"],
    ]) {
      await branch(`base-${name}`, commits.root);
      await commit(`change ${path}`, { [path]: "changed on base\n" });
    }
    await branch("base-other", commits.root);
    await commit("change other files", { "README.md": "changed on base\n", "specs/300-other/spec.md": "changed\n" });

    await branch("base-moved", commits.root);
    await commit("move base", { "README.md": "moved\n" });
    await branch("merged", commits.b);
    await git([...COMMITTER, "merge", "-q", "--no-edit", "base-moved"]);
    commits.merged = await git(["rev-parse", "HEAD"]);
    await branch("amended", commits.merged);
    write({ "src/app.txt": "slipped into the merge\n" });
    await git(["add", "-A"]);
    await git([...COMMITTER, "commit", "-q", "--amend", "--no-edit"]);
    commits.amended = await git(["rev-parse", "HEAD"]);
    await branch("base-side", commits.root);
    await commit("a side file", { "src/side.txt": "side\n" });
    await branch("octopus", commits.b);
    await git([...COMMITTER, "merge", "-q", "--no-edit", "base-moved", "base-side"]);
    commits.octopus = await git(["rev-parse", "HEAD"]);

    await branch("base-conflicting", commits.root);
    await commit("conflict with the story", { "src/app.txt": "base's line\n" });
    await branch("resolved", commits.b);
    await git([...COMMITTER, "merge", "-q", "--no-edit", "base-conflicting"], [1]);
    write({ "src/app.txt": "resolved by hand\n" });
    await git(["add", "-A"]);
    await git([...COMMITTER, "commit", "-q", "--no-edit"]);
    commits.resolved = await git(["rev-parse", "HEAD"]);
  });

  after(() => {
    for (const [name, value] of Object.entries(savedEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(scratch, { recursive: true, force: true });
  });

  function cleanAtA(fields: Partial<Round> = {}): Round {
    return round({ head: commits.a, at: at("10:00"), ...fields });
  }

  it("attests an INTERNAL CLEAN round at A with B on top, a later GITHUB DIRTY round at B counting against nothing", async () => {
    const githubDirtyAtB = round({ stage: "GITHUB", head: commits.b, result: "DIRTY", verdict: "PATCH", at: at("10:10") });
    assert.deepEqual(await attests(repo, reading(snapshot([cleanAtA(), githubDirtyAtB])), commits.b, "main", SPEC), {
      attested: true,
      reason: null,
    });
  });

  it("attests a round at the head itself", async () => {
    const atB = round({ head: commits.b });
    assert.equal((await attests(repo, reading(snapshot([atB])), commits.b, "main", SPEC)).attested, true);
  });

  it("does not attest when history was rewritten without A", async () => {
    const answer = await attests(repo, reading(snapshot([cleanAtA()])), commits.rewritten, "main", SPEC);
    assert.equal(answer.attested, false);
    assert.match(answer.reason ?? "", /no passing round/);
  });

  it("reads a round commit the clone lacks as not in history and tries the next passing round", async () => {
    const rounds = [cleanAtA(), round({ n: 2, head: ABSENT, at: at("10:10") })];
    assert.deepEqual(await attests(repo, reading(snapshot(rounds)), commits.b, "main", SPEC), {
      attested: true,
      reason: null,
    });
  });

  it("never counts a GITHUB round", async () => {
    const answer = await attests(repo, reading(snapshot([round({ stage: "GITHUB", head: commits.b })])), commits.b, "main", SPEC);
    assert.equal(answer.attested, false);
    assert.match(answer.reason ?? "", /no passing round/);
  });

  for (const [name, path] of [
    ["spec", `${SPEC}/spec.md`],
    ["adr", "docs/adr"],
    ["plugin-adr", "plugin/docs/adr"],
    ["memory", ".specify/memory"],
  ]) {
    it(`does not attest when base changed ${path} since A, naming it`, async () => {
      const answer = await attests(repo, reading(snapshot([cleanAtA()])), commits.b, `base-${name}`, SPEC);
      assert.equal(answer.attested, false);
      assert.ok(answer.reason?.includes(path), answer.reason ?? "no reason");
    });
  }

  it("attests when base changed only other files since A", async () => {
    assert.deepEqual(await attests(repo, reading(snapshot([cleanAtA()])), commits.b, "base-other", SPEC), {
      attested: true,
      reason: null,
    });
  });

  it("decides on the newest passing round in history, never an older one once it lapses", async () => {
    const rounds = [cleanAtA(), round({ n: 2, head: commits.specEdited, at: at("10:10") })];
    const answer = await attests(repo, reading(snapshot(rounds)), commits.specEdited, "main", SPEC);
    assert.equal(answer.attested, false);
    assert.ok(answer.reason?.includes(`${SPEC}/spec.md`), answer.reason ?? "no reason");
  });

  it("attests over a merge of base into the branch as git made it", async () => {
    assert.deepEqual(await attests(repo, reading(snapshot([cleanAtA()])), commits.merged, "base-moved", SPEC), {
      attested: true,
      reason: null,
    });
  });

  it("does not attest over an amended merge, naming it", async () => {
    const answer = await attests(repo, reading(snapshot([cleanAtA()])), commits.amended, "base-moved", SPEC);
    assert.equal(answer.attested, false);
    assert.ok(answer.reason?.includes(commits.amended), answer.reason ?? "no reason");
  });

  it("does not attest over a merge of more than two parents, which merge-tree cannot remake, naming it", async () => {
    const answer = await attests(repo, reading(snapshot([cleanAtA()])), commits.octopus, "base-moved", SPEC);
    assert.equal(answer.attested, false);
    assert.ok(answer.reason?.includes(commits.octopus), answer.reason ?? "no reason");
  });

  it("does not attest over a merge resolved from a conflict, naming it", async () => {
    const answer = await attests(repo, reading(snapshot([cleanAtA()])), commits.resolved, "base-conflicting", SPEC);
    assert.equal(answer.attested, false);
    assert.ok(answer.reason?.includes(commits.resolved), answer.reason ?? "no reason");
    // Read as a conflict, not only as a tree that differs: a resolution that kept git's own result would not differ.
    assert.match(answer.reason ?? "", /conflict/);
  });

  it("does not attest after a hold released by a comment after A's round, naming the hold", async () => {
    const state = snapshot([cleanAtA()], [releasedHold({ released: at("10:05") })]);
    const answer = await attests(repo, reading(state), commits.b, "main", SPEC);
    assert.equal(answer.attested, false);
    assert.match(answer.reason ?? "", /pushback-212/);
  });

  it("attests after a hold released by a reset", async () => {
    const state = snapshot([cleanAtA()], [releasedHold({ released: at("10:05"), released_by: { comment: 9001, reset: true } })]);
    assert.deepEqual(await attests(repo, reading(state), commits.b, "main", SPEC), { attested: true, reason: null });
  });

  it("does not attest a held story, naming the cause", async () => {
    const answer = await attests(
      repo,
      reading(snapshot([cleanAtA()]), [{ cause: "open_hold", id: "escalation-212" }]),
      commits.b,
      "main",
      SPEC,
    );
    assert.equal(answer.attested, false);
    assert.match(answer.reason ?? "", /escalation-212/);
  });

  it("does not attest with no state", async () => {
    const answer = await attests(repo, reading(null), commits.b, "main", SPEC);
    assert.equal(answer.attested, false);
    assert.match(answer.reason ?? "", /no state/);
  });

  it("throws GitFailed for a head or a base the clone lacks", async () => {
    const state = reading(snapshot([cleanAtA()]));
    await assert.rejects(attests(repo, state, ABSENT, "main", SPEC), GitFailed);
    await assert.rejects(attests(repo, state, commits.b, "absent-base", SPEC), GitFailed);
  });
});
