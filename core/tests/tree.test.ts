import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { GitFailed, runGit } from "../src/git.ts";
import { GitHubMisanswered, GitHubPartlyAnswered, GitHubRefused, GitHubUnanswered } from "../src/github.ts";
import { gitHubTree, gitTree, NotInTree, type Tree, type TreeEntry } from "../src/tree.ts";
import { fakeGitHub, type FakeRoutes } from "./support/fake-github.ts";

const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];
const ODD_NAME = 'say "hi"\tthere.md';
// A gitlink needs no object behind it, so a dummy id stands in for a vendored repository's commit.
const DUMMY_COMMIT = "0123456789abcdef0123456789abcdef01234567";

// What `specs/` holds at the first commit, as either tree must list it.
const SPECS_AT_FIRST: TreeEntry[] = [
  { name: "200-retry", isDir: true },
  { name: "200-retry-notes.md", isDir: false },
  { name: "201-notes.md", isDir: false },
  { name: "link", isDir: false },
  { name: ODD_NAME, isDir: false },
  { name: "vendored", isDir: false },
];

const INVALID_PATHS = ["", "/codeworks.toml", "specs/", "specs//spec.md", "./codeworks.toml", "specs/../codeworks.toml"];

let scratch: string;
let repo: string;
let first: string;
const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };

function restoreEnv(name: keyof typeof savedEnv): void {
  const value = savedEnv[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

function notInTree(path: string, ref: string): (error: unknown) => boolean {
  return (error) => {
    assert.ok(error instanceof NotInTree, `expected NotInTree, got ${String(error)}`);
    assert.equal(error.path, path);
    assert.equal(error.ref, ref);
    assert.ok(error.message.includes(path) && error.message.includes(ref), error.message);
    return true;
  };
}

before(async () => {
  scratch = mkdtempSync(join(tmpdir(), "core-tree-"));
  repo = join(scratch, "repo");
  const home = join(scratch, "home");
  mkdirSync(join(repo, "specs", "200-retry"), { recursive: true });
  mkdirSync(home);
  // runGit passes its own environment on to git, so this is how a user's global config reaches the child.
  writeFileSync(join(home, ".gitconfig"), "[[[ not a config file\n");
  process.env.HOME = home;
  process.env.XDG_CONFIG_HOME = join(home, ".config");

  await runGit(repo, ["init", "-q"]);
  writeFileSync(join(repo, "codeworks.toml"), "[shared]\nvalidators = []\n");
  writeFileSync(join(repo, ":!odd.md"), "a name git would read as pathspec magic\n");
  writeFileSync(join(repo, "specs", "200-retry", "spec.md"), "# Retry, as first written\n");
  writeFileSync(join(repo, "specs", "201-notes.md"), "a file named like a spec folder\n");
  // Git orders this file before the `200-retry` folder, as if the folder were `200-retry/`.
  writeFileSync(join(repo, "specs", "200-retry-notes.md"), "dummy\n");
  writeFileSync(join(repo, "specs", ODD_NAME), "dummy\n");
  symlinkSync("200-retry/spec.md", join(repo, "specs", "link"));
  await runGit(repo, ["add", "-A"]);
  await runGit(repo, ["update-index", "--add", "--cacheinfo", `160000,${DUMMY_COMMIT},specs/vendored`]);
  await runGit(repo, [...COMMITTER, "commit", "-q", "-m", "first"]);
  first = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();

  await runGit(repo, ["mv", "specs/200-retry", "specs/200-retry-budget"]);
  writeFileSync(join(repo, "specs", "200-retry-budget", "spec.md"), "# Retry budget, after the rescope\n");
  // Not `add -A`: the gitlink has no folder in the working tree, so that would stage its deletion.
  await runGit(repo, ["add", "specs/200-retry-budget/spec.md"]);
  await runGit(repo, [...COMMITTER, "commit", "-q", "-m", "rescope"]);
  writeFileSync(join(repo, "specs", "200-retry-budget", "spec.md"), "# not committed\n");
});

after(() => {
  restoreEnv("HOME");
  restoreEnv("XDG_CONFIG_HOME");
  rmSync(scratch, { recursive: true, force: true });
});

describe("gitTree", () => {
  it("lists a directory at the ref, a directory only where git holds a tree", async () => {
    assert.deepEqual(await gitTree(repo, first).listDir("specs"), SPECS_AT_FIRST);
  });

  it("reads a folder renamed by a rescope at the ref asked about", async () => {
    const atHead = (await gitTree(repo, "HEAD").listDir("specs")).map((entry) => entry.name);
    assert.deepEqual(atHead, ["200-retry-budget", "200-retry-notes.md", "201-notes.md", "link", ODD_NAME, "vendored"]);
  });

  it("reads a file's text as committed at the ref, not as the working tree holds it", async () => {
    assert.equal(await gitTree(repo, first).readText("specs/200-retry/spec.md"), "# Retry, as first written\n");
    assert.equal(await gitTree(repo, "HEAD").readText("specs/200-retry-budget/spec.md"), "# Retry budget, after the rescope\n");
  });

  it("throws NotInTree naming path and ref for a path the ref does not hold", async () => {
    const head = gitTree(repo, "HEAD");
    await assert.rejects(head.readText("specs/200-retry/spec.md"), notInTree("specs/200-retry/spec.md", "HEAD"));
    await assert.rejects(head.listDir("specs/200-retry"), notInTree("specs/200-retry", "HEAD"));
    await assert.rejects(head.readText("codeworks.toml/spec.md"), notInTree("codeworks.toml/spec.md", "HEAD"));
  });

  it("throws NotInTree for a path of the other kind: a directory, a symlink or a gitlink is no file", async () => {
    const tree = gitTree(repo, first);
    await assert.rejects(tree.readText("specs"), notInTree("specs", first));
    await assert.rejects(tree.readText("specs/link"), notInTree("specs/link", first));
    await assert.rejects(tree.readText("specs/vendored"), notInTree("specs/vendored", first));
    await assert.rejects(tree.listDir("codeworks.toml"), notInTree("codeworks.toml", first));
    await assert.rejects(tree.listDir("specs/vendored"), notInTree("specs/vendored", first));
  });

  it("reads a path literally: a name that looks like pathspec magic is a name", async () => {
    const head = gitTree(repo, "HEAD");
    assert.equal(await head.readText(":!odd.md"), "a name git would read as pathspec magic\n");
    await assert.rejects(head.readText(":/codeworks.toml"), notInTree(":/codeworks.toml", "HEAD"));
  });

  it("throws GitFailed, not NotInTree, for a ref that does not resolve", async () => {
    await assert.rejects(gitTree(repo, "refs/heads/absent").readText("codeworks.toml"), (error: unknown) => {
      assert.ok(error instanceof GitFailed);
      assert.equal(error.code, 128);
      return true;
    });
  });

  it("passes a ref starting with a dash to git as a ref, not an option", async () => {
    // Read as an option, `--name-only` would make the path after `--` the tree-ish and list HEAD's names.
    await assert.rejects(gitTree(repo, "--name-only").listDir("HEAD"), (error: unknown) => {
      assert.ok(error instanceof GitFailed);
      assert.equal(error.code, 128);
      return true;
    });
  });

  it("reads through runGit: a global config git cannot parse is never read", async () => {
    const env: NodeJS.ProcessEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1" };
    delete env.GIT_CONFIG_GLOBAL;
    assert.throws(
      () => execFileSync("git", ["-C", repo, "ls-tree", "HEAD"], { env, stdio: "pipe" }),
      "fixture: plain git fails on the temp HOME's .gitconfig",
    );
    assert.equal(await gitTree(repo, "HEAD").readText("codeworks.toml"), "[shared]\nvalidators = []\n");
  });

  it("refuses an empty ref and a path that is not a plain relative path", async () => {
    assert.throws(() => gitTree(repo, ""), TypeError);
    const tree = gitTree(repo, "HEAD");
    for (const path of INVALID_PATHS) {
      await assert.rejects(tree.readText(path), TypeError, `readText(${JSON.stringify(path)})`);
      await assert.rejects(tree.listDir(path), TypeError, `listDir(${JSON.stringify(path)})`);
    }
  });
});

const REPO = "example-org/example-repo";
const REF = "feature/retry";
const CONTENTS = "/repos/example-org/example-repo/contents";
const AT_REF = "?ref=feature%2Fretry";

// GitHub wraps the base64 of a file's content at 60 characters.
function fileAnswer(path: string, text: string): unknown {
  const content = (Buffer.from(text, "utf8").toString("base64").match(/.{1,60}/g) ?? []).join("\n");
  return { type: "file", encoding: "base64", size: Buffer.byteLength(text), name: path.split("/").at(-1), path, content };
}

function listing(entries: Array<[name: string, type: string]>): unknown {
  return entries.map(([name, type]) => ({ name, type, path: `specs/${name}` }));
}

function misanswered(pattern: RegExp): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof GitHubMisanswered, `expected GitHubMisanswered, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  };
}

// No GitHubUnanswered: GitHub gives the same part on every run, so a retry alone never reads the rest.
function partlyAnswered(pattern: RegExp): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof GitHubPartlyAnswered && !(error instanceof GitHubUnanswered), `expected GitHubPartlyAnswered, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  };
}

function treeOver(rest: FakeRoutes["rest"]): { tree: Tree; calls: ReturnType<typeof fakeGitHub>["calls"] } {
  const client = fakeGitHub({ rest });
  return { tree: gitHubTree(client, REPO, REF), calls: client.calls };
}

function get(path: string): { kind: "rest"; method: string; path: string; body: undefined } {
  return { kind: "rest", method: "GET", path, body: undefined };
}

describe("gitHubTree", () => {
  it("reads a file's text from the contents API at the ref", async () => {
    const text = "# Retry\n\n".concat("A line long enough to wrap the base64 over several lines. ".repeat(4), "\n");
    const path = `${CONTENTS}/specs/200-retry/spec.md${AT_REF}`;
    const { tree, calls } = treeOver({ [`GET ${path}`]: fileAnswer("specs/200-retry/spec.md", text) });
    assert.equal(await tree.readText("specs/200-retry/spec.md"), text);
    assert.deepEqual(calls, [get(path)]);
  });

  it("encodes each path segment and the ref into the request", async () => {
    const path = `${CONTENTS}/specs/notes%20%231%3F.md${AT_REF}`;
    const { tree } = treeOver({ [`GET ${path}`]: fileAnswer("specs/notes #1?.md", "dummy\n") });
    assert.equal(await tree.readText("specs/notes #1?.md"), "dummy\n");
  });

  it("lists a directory as gitTree lists the same tree", async () => {
    const answer = listing([
      ["vendored", "submodule"],
      [ODD_NAME, "file"],
      ["link", "symlink"],
      ["201-notes.md", "file"],
      ["200-retry", "dir"],
      ["200-retry-notes.md", "file"],
    ]);
    const { tree } = treeOver({ [`GET ${CONTENTS}/specs${AT_REF}`]: answer });
    assert.deepEqual(await tree.listDir("specs"), SPECS_AT_FIRST);
  });

  it("throws NotInTree for a path of the other kind", async () => {
    const { tree } = treeOver({
      [`GET ${CONTENTS}/specs${AT_REF}`]: listing([["200-retry", "dir"]]),
      [`GET ${CONTENTS}/codeworks.toml${AT_REF}`]: fileAnswer("codeworks.toml", "[shared]\n"),
      [`GET ${CONTENTS}/specs/link${AT_REF}`]: { type: "symlink", target: "200-retry/spec.md", path: "specs/link" },
      [`GET ${CONTENTS}/specs/vendored${AT_REF}`]: { type: "submodule", submodule_git_url: "https://example.invalid/x.git" },
    });
    await assert.rejects(tree.readText("specs"), notInTree("specs", REF));
    await assert.rejects(tree.listDir("codeworks.toml"), notInTree("codeworks.toml", REF));
    await assert.rejects(tree.readText("specs/link"), notInTree("specs/link", REF));
    await assert.rejects(tree.readText("specs/vendored"), notInTree("specs/vendored", REF));
  });

  it("throws NotInTree for a 404 when the root reads at the ref", async () => {
    const { tree, calls } = treeOver({
      [`GET ${CONTENTS}/codeworks.toml${AT_REF}`]: new GitHubRefused(404, "Not Found"),
      [`GET ${CONTENTS}${AT_REF}`]: listing([["specs", "dir"]]),
    });
    await assert.rejects(tree.readText("codeworks.toml"), notInTree("codeworks.toml", REF));
    assert.deepEqual(calls, [get(`${CONTENTS}/codeworks.toml${AT_REF}`), get(`${CONTENTS}${AT_REF}`)]);
  });

  it("lets the root's refusal through for a 404 when the root does not read either", async () => {
    const unseen = new GitHubRefused(404, `GET ${CONTENTS}${AT_REF}: 404 No commit found for the ref ${REF}`);
    const { tree } = treeOver({
      [`GET ${CONTENTS}/specs${AT_REF}`]: new GitHubRefused(404, "Not Found"),
      [`GET ${CONTENTS}${AT_REF}`]: unseen,
    });
    await assert.rejects(tree.listDir("specs"), (error: unknown) => error === unseen);
  });

  it("lets no answer and any other refusal through untouched, with no second call", async () => {
    const unanswered = new GitHubUnanswered("no answer within 15000 ms");
    const forbidden = new GitHubRefused(403, "Resource not accessible by integration");
    const { tree, calls } = treeOver({
      [`GET ${CONTENTS}/codeworks.toml${AT_REF}`]: unanswered,
      [`GET ${CONTENTS}/specs${AT_REF}`]: forbidden,
    });
    await assert.rejects(tree.readText("codeworks.toml"), (error: unknown) => error === unanswered);
    await assert.rejects(tree.listDir("specs"), (error: unknown) => error === forbidden);
    assert.equal(calls.length, 2);
  });

  it("refuses a file the contents API gives without its content, rather than reading it as empty", async () => {
    const { tree } = treeOver({
      [`GET ${CONTENTS}/specs/huge.md${AT_REF}`]: { type: "file", encoding: "none", content: "", path: "specs/huge.md" },
    });
    await assert.rejects(tree.readText("specs/huge.md"), partlyAnswered(/specs\/huge\.md/));
  });

  it("refuses a listing at the contents API's 1000-entry cap, which may be cut short", async () => {
    const full = Array.from({ length: 1000 }, (_, i): [string, string] => [`${i}-dummy`, "dir"]);
    const { tree } = treeOver({ [`GET ${CONTENTS}/specs${AT_REF}`]: listing(full) });
    await assert.rejects(tree.listDir("specs"), partlyAnswered(/1000/));
  });

  it("refuses a listing whose entry is not the shape asked as GitHubMisanswered", async () => {
    const { tree } = treeOver({ [`GET ${CONTENTS}/specs${AT_REF}`]: [{ type: "dir" }] });
    await assert.rejects(tree.listDir("specs"), misanswered(/specs/));
  });

  for (const [what, answer] of [
    ["an item with no type", { path: "specs/spec.md" }],
    ["a file with no encoding", { type: "file", content: "", path: "specs/spec.md" }],
  ] as const) {
    it(`refuses ${what} as GitHubMisanswered`, async () => {
      const { tree } = treeOver({ [`GET ${CONTENTS}/specs/spec.md${AT_REF}`]: answer });
      await assert.rejects(tree.readText("specs/spec.md"), misanswered(/specs\/spec\.md/));
    });
  }

  it("refuses an empty ref, a repo that is not owner/name, and a path that is not a plain relative path", async () => {
    const client = fakeGitHub({});
    assert.throws(() => gitHubTree(client, REPO, ""), TypeError);
    for (const repo of ["example-org", "example-org/example-repo/x", "../example-repo", "example-org/..", "/example-repo"]) {
      assert.throws(() => gitHubTree(client, repo, REF), TypeError, repo);
    }
    const tree = gitHubTree(client, REPO, REF);
    for (const path of INVALID_PATHS) {
      await assert.rejects(tree.readText(path), TypeError, `readText(${JSON.stringify(path)})`);
      await assert.rejects(tree.listDir(path), TypeError, `listDir(${JSON.stringify(path)})`);
    }
    assert.deepEqual(client.calls, []);
  });
});
