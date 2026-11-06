import assert from "node:assert/strict";
import { join } from "node:path";
import { describe, it } from "node:test";

import { fakeGitHub } from "../../core/tests/support/fake-github.ts";
import { sessionFolder } from "../plugin/core/commit-pass.ts";
import { GitFailed } from "../plugin/core/git.ts";
import { GitHubRefused, GitHubUnanswered } from "../plugin/core/github.ts";
import { bareCopy, fetchFromClone, fileAt, fromGitHub, holdsCommit } from "../plugin/lib/check/bare-copy.ts";
import { cloneWith, git } from "./support/git.ts";
import { tempHome, tempSession } from "./support/session.ts";

const REPO = { owner: "acme", name: "widgets" };
const ABSENT = "1234567890123456789012345678901234567890";

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

  it("answers false for a sha the clone lacks, and fails as git fails for a clone that is no repository", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone } = cloneWith(t, { "a.md": "a\n" });
    assert.equal(await fetchFromClone(copy, clone, ABSENT), false);
    await assert.rejects(fetchFromClone(copy, tempHome(t), ABSENT), GitFailed);
    assert.equal(await holdsCommit(copy, ABSENT), false);
  });

  it("holds no commit for a sha that names another kind of object", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone, head } = cloneWith(t, { "a.md": "a\n" });
    await fetchFromClone(copy, clone, head);
    assert.equal(await holdsCommit(copy, git(copy, "rev-parse", `${head}:a.md`)), false);
  });
});

describe("fileAt", () => {
  it("reads a file's text at a commit the copy holds, and null for a path that is no file there", async (t) => {
    const copy = await bareCopy(tempSession(t));
    const { clone, head } = cloneWith(t, { "a*b.md": "glob\n", "aXb.md": "plain\n", "docs/guide.md": "guide\n" });
    await fetchFromClone(copy, clone, head);
    assert.equal(await fileAt(copy, head, "a*b.md"), "glob\n");
    assert.equal(await fileAt(copy, head, "docs/guide.md"), "guide\n");
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

  for (const failure of [new GitHubRefused(404, "Not Found"), new GitHubRefused(403, "Forbidden"), new GitHubUnanswered("timed out")]) {
    it(`throws ${failure.name} ${failure.message}: no answer is not an absent commit`, async () => {
      const reader = fakeGitHub({ rest: { [path]: failure } });
      await assert.rejects(fromGitHub(reader, REPO, async () => undefined)(ABSENT), failure);
    });
  }
});
