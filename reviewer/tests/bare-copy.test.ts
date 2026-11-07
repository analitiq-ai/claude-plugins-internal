import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { fakeGitHub } from "../../core/tests/support/fake-github.ts";
import { sessionFolder } from "../plugin/core/commit-pass.ts";
import { GitHubRefused } from "../plugin/core/github.ts";
import { bareCopy, fetchFromClone, fileAt, fromGitHub, holdsCommit } from "../plugin/lib/check/bare-copy.ts";
import { cloneWith, git } from "./support/git.ts";
import { tempHome, tempSession } from "./support/session.ts";

const REPO = { owner: "acme", name: "widgets" };
const ABSENT = "1234567890123456789012345678901234567890";

type GitRun = { pwd: string; gitDir: string; args: string[] };

/** The git commands `run` starts itself, through a `git` first on PATH that logs each; git's own children are not among them. */
async function gitRunsOf(t: TestContext, run: () => Promise<unknown>): Promise<GitRun[]> {
  const real = execFileSync("sh", ["-c", "command -v git"], { encoding: "utf8" }).trim();
  const folder = tempHome(t);
  const log = join(folder, "git.log");
  writeFileSync(join(folder, "git"), `#!/bin/sh\nprintf '%s\\t' "$PWD" "\${GIT_DIR-}" "$@" >> '${log}'\nprintf '\\n' >> '${log}'\nexec '${real}' "$@"\n`, { mode: 0o700 });
  const path = process.env.PATH;
  process.env.PATH = `${folder}:${path}`;
  try {
    await run();
  } finally {
    process.env.PATH = path;
  }
  return readFileSync(log, "utf8")
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [pwd, gitDir, ...args] = line.split("\t");
      // Every field ends in a tab, so the last split is empty.
      return { pwd, gitDir, args: args.slice(0, -1) };
    });
}

describe("bareCopy (R13)", () => {
  it("is created on first use at <session>/repo.git, bare, and kept by the next use", async (t) => {
    const session = tempSession(t);
    const copy = await bareCopy(session);
    assert.equal(copy, join(sessionFolder(session), "repo.git"));
    assert.equal(git(copy, "rev-parse", "--is-bare-repository"), "true");
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    await fetchFromClone(copy, clone, head);
    assert.equal(await bareCopy(session), copy);
    assert.equal(await holdsCommit(copy, head), true);
  });
});

describe("fetchFromClone and holdsCommit", () => {
  it("takes a commit by its sha into the copy's own refs", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    assert.equal(await holdsCommit(copy, head), false);
    await fetchFromClone(copy, clone, head);
    assert.equal(await holdsCommit(copy, head), true);
    assert.equal(git(copy, "rev-parse", `refs/anchors/${head}`), head);
  });

  it("takes a commit no branch of the clone points at", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    git(clone, "commit", "-q", "--allow-empty", "-m", "later");
    const later = git(clone, "rev-parse", "HEAD");
    git(clone, "reset", "-q", "--hard", head);
    await fetchFromClone(copy, clone, later);
    assert.equal(await holdsCommit(copy, later), true);
  });

  it("answers false for a sha the clone lacks", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone } = cloneWith(t, { "a.md": "a\n" });
    assert.equal(await fetchFromClone(copy, clone, ABSENT), false);
    assert.equal(await holdsCommit(copy, ABSENT), false);
  });

  it("runs each git command of its own in the copy, naming the clone only as the fetch's remote, whether the clone has the sha or not (ADR-0021 d6)", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    const runs = await gitRunsOf(t, async () => [await fetchFromClone(copy, clone, head), await fetchFromClone(copy, clone, ABSENT)]);
    const fetchInCopy = { inClone: false, gitDir: "", at: ["-C", copy], fetch: true, namingClone: [clone] };
    assert.deepEqual(
      runs.map(({ pwd, gitDir, args }) => ({ inClone: pwd.startsWith(clone), gitDir, at: args.slice(0, 2), fetch: args.includes("fetch"), namingClone: args.filter((arg) => arg.includes(clone)) })),
      [fetchInCopy, fetchInCopy],
    );
  });

  it("holds no commit for a sha that names another kind of object", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    await fetchFromClone(copy, clone, head);
    assert.equal(await holdsCommit(copy, git(copy, "rev-parse", `${head}:a.md`)), false);
  });
});

describe("fileAt", () => {
  it("reads a file's text at a commit the copy holds, a name git would read as magic taken as a name, and null for a path that is no file there", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone, head } = cloneWith(t, { "a*b.md": "glob\n", "aXb.md": "plain\n", "docs/guide.md": "guide\n", ":(top)a.md": "magic\n" });
    await fetchFromClone(copy, clone, head);
    assert.equal(await fileAt(copy, head, "a*b.md"), "glob\n");
    assert.equal(await fileAt(copy, head, "docs/guide.md"), "guide\n");
    assert.equal(await fileAt(copy, head, ":(top)a.md"), "magic\n");
    assert.equal(await fileAt(copy, head, "a?b.md"), null);
    assert.equal(await fileAt(copy, head, "docs"), null);
    assert.equal(await fileAt(copy, head, "missing.md"), null);
  });
});

describe("fromGitHub", () => {
  const path = `GET /repos/acme/widgets/commits/${ABSENT}`;

  it("fetches a commit GitHub has into the copy's own ref", async () => {
    const fetched: string[][] = [];
    const reader = fakeGitHub({ rest: { [path]: { sha: ABSENT } } });
    const found = await fromGitHub(reader, REPO, async (refspecs) => void fetched.push([...refspecs]))(ABSENT);
    assert.equal(found, true);
    assert.deepEqual(fetched, [[`${ABSENT}:refs/anchors/${ABSENT}`]]);
  });

  it("answers no, fetching nothing, when GitHub answers 422, as it does for a sha no commit of the repository has", async () => {
    const fetched: string[][] = [];
    const reader = fakeGitHub({ rest: { [path]: new GitHubRefused(422, `No commit found for SHA: ${ABSENT}`) } });
    assert.equal(await fromGitHub(reader, REPO, async (refspecs) => void fetched.push([...refspecs]))(ABSENT), false);
    assert.deepEqual(fetched, []);
  });
});
