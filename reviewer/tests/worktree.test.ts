import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { addedLines, additions, commitsBetween, fixHistory, mergedTree, textHunks } from "../plugin/lib/worktree.ts";
import { featureRepo, git, numbered } from "./support/git.ts";

const OLD = "one\ntwo\nthree\nfour\n";
const NEW = "one\n2\nthree\nfour\nfive\n";

describe("textHunks", () => {
  it("gives the hunks git gives between the two texts, a line count git leaves out being 1", async () => {
    assert.deepEqual(await textHunks(OLD, NEW), [
      { old_start: 2, old_count: 1, new_start: 2, new_count: 1 },
      { old_start: 4, old_count: 0, new_start: 5, new_count: 1 },
    ]);
  });

  it("gives a pure deletion no new lines, starting at the line it follows", async () => {
    assert.deepEqual(await textHunks("a\nb\nc\n", "a\nc\n"), [{ old_start: 2, old_count: 1, new_start: 1, new_count: 0 }]);
  });

  it("gives identical texts no hunk", async () => {
    assert.deepEqual(await textHunks(OLD, OLD), []);
  });

  it("numbers lines as git does: at \\n only, a last line with no \\n counted", async () => {
    assert.deepEqual(await textHunks("a\r\nb\r\n", "a\r\nc\r\n"), [{ old_start: 2, old_count: 1, new_start: 2, new_count: 1 }]);
    assert.deepEqual(await textHunks("a\nb", "a\nc"), [{ old_start: 2, old_count: 1, new_start: 2, new_count: 1 }]);
    assert.deepEqual(await textHunks("a\rb\n", "a\rc\n"), [{ old_start: 1, old_count: 1, new_start: 1, new_count: 1 }]);
  });

  it("diffs a text holding a NUL byte by its lines, as git would not diff a binary file", async () => {
    assert.deepEqual(await textHunks("a\0\nb\n", "a\0\nc\n"), [{ old_start: 2, old_count: 1, new_start: 2, new_count: 1 }]);
  });
});

/** The branch reviewed at `head`; main moved on to `base`; the branch merged main and committed `tip`. */
function diverged(t: TestContext) {
  const repo = featureRepo(t);
  const head = repo.commit({ "b.py": "x\n" }, "feat: b");
  git(repo.root, "checkout", "-q", "main");
  const base = repo.commit({ "m.py": "m\n" }, "merged elsewhere");
  git(repo.root, "checkout", "-q", "feat");
  git(repo.root, "merge", "-q", "--no-edit", "main");
  const tip = repo.commit({ "n.py": "n\n" }, "feat: n");
  return { root: repo.root, head, base, tip };
}

describe("mergedTree: the head as it would be once it merged the base", () => {
  it("holds what the base branch brought in, so a diff from it to the branch's tip shows only the branch's own work", async (t) => {
    const { root, head, base, tip } = diverged(t);
    assert.equal(git(root, "diff", "--name-only", head, tip), "m.py\nn.py");
    assert.equal(git(root, "diff", "--name-only", await mergedTree(root, head, base), tip), "n.py");
  });

  it("is the head's own tree for a base the head already carries", async (t) => {
    const repo = featureRepo(t);
    const head = repo.commit({ "b.py": "x\n" }, "feat: b");
    assert.equal(await mergedTree(repo.root, head, git(repo.root, "rev-parse", "main")), git(repo.root, "rev-parse", `${head}^{tree}`));
  });

  it("leaves a conflict between git's merge-style markers, whatever merge.conflictStyle the repository sets", async (t) => {
    const repo = featureRepo(t);
    const head = repo.commit({ "b.py": "feat\n" }, "feat: b");
    git(repo.root, "checkout", "-q", "main");
    const base = repo.commit({ "b.py": "main\n" }, "b elsewhere");
    git(repo.root, "checkout", "-q", "feat");
    for (const style of [null, "diff3", "zdiff3"]) {
      if (style !== null) git(repo.root, "config", "merge.conflictStyle", style);
      const tree = await mergedTree(repo.root, head, base);
      assert.equal(git(repo.root, "cat-file", "-p", `${tree}:b.py`), `<<<<<<< ${head}\nfeat\n=======\nmain\n>>>>>>> ${base}`, String(style));
    }
  });

  it("gives the tree of a repository with sha256 objects", async (t) => {
    const { root } = featureRepo(t, "--object-format=sha256");
    const head = git(root, "rev-parse", "HEAD");
    assert.equal(head.length, 64);
    assert.equal(await mergedTree(root, head, head), git(root, "rev-parse", "HEAD^{tree}"));
  });

  // git exits 1 for a rev it cannot merge as for a conflict, and writes no tree.
  it("refuses a head git cannot merge, naming it", async (t) => {
    const { root } = featureRepo(t);
    const unknown = `${"0".repeat(39)}1`;
    await assert.rejects(mergedTree(root, unknown, git(root, "rev-parse", "main")), new RegExp(`merge-tree .*${unknown}.* wrote no tree id`));
  });
});

const B = numbered("b", 20);
// b.py's line 5 split in two.
const FIXED = B.replace("b4\n", "fixed-a\nfixed-b\n");

describe("addedLines: per path, the lines the later side holds and the earlier does not", () => {
  it("gives the line ranges an edit wrote, and nothing for a file that only lost lines", async (t) => {
    const repo = featureRepo(t);
    const before = repo.commit({ "b.py": B, "c.py": numbered("c", 5) }, "feat");
    const after = repo.commit({ "b.py": FIXED, "c.py": numbered("c", 4) }, "fix");
    assert.deepEqual(await addedLines(repo.root, before, after), new Map([["b.py", [[5, 6]]]]));
  });

  it("diffs a moved file against its old self, so only the lines the move edited are added", async (t) => {
    const repo = featureRepo(t);
    const before = repo.commit({ "b.py": B }, "feat");
    git(repo.root, "mv", "b.py", "c.py");
    const after = repo.commit({ "c.py": B.replace("b10\n", "moved\n") }, "move");
    assert.deepEqual(await addedLines(repo.root, before, after), new Map([["c.py", [[11, 11]]]]));
  });
});

describe("additions: how many lines the later side adds", () => {
  it("counts every added line, a binary file adding none", async (t) => {
    const repo = featureRepo(t);
    const before = git(repo.root, "rev-parse", "HEAD");
    const after = repo.commit({ "b.py": numbered("b", 3), "c.bin": "\0\u0001\n", "a.py": numbered("line", 30).replace("line7\n", "seven\n") }, "add");
    assert.equal(await additions(repo.root, before, after), 4);
  });
});

describe("commitsBetween: the commits one rev has and two others do not", () => {
  it("lists them oldest first with the paths each changed and a rename's old name, leaving out merges and the excluded rev's commits", async (t) => {
    const repo = featureRepo(t);
    const from = repo.commit({ "b.py": "b\n" }, "feat: b");
    git(repo.root, "checkout", "-q", "main");
    const base = repo.commit({ "m.py": "m\n" }, "merged elsewhere");
    git(repo.root, "checkout", "-q", "feat");
    const one = repo.commit({ "c.py": "c\n" }, "c");
    git(repo.root, "merge", "-q", "--no-edit", "main");
    git(repo.root, "mv", "b.py", "d.py");
    const two = repo.commit({}, "move");
    const three = repo.commit({}, "empty");
    const four = repo.commit({ "d.py": "b\nmore\n" }, "edit");
    assert.deepEqual(await commitsBetween(repo.root, from, four, base), [
      { sha: one, changes: [{ path: "c.py", from: null }] },
      { sha: two, changes: [{ path: "d.py", from: "b.py" }] },
      { sha: three, changes: [] },
      { sha: four, changes: [{ path: "d.py", from: null }] },
    ]);
  });
});

describe("names git would quote, and a name holding a glob character", () => {
  // git C-quotes a name holding a byte outside ASCII, a control character, a quote or a backslash.
  const NAMES = ["café.py", 'say "hi".md', "back\\slash.md", "tab\there.md", "new\nline.md", "with space.md", "star*.md", "starfish.md"];

  it("are each read as the file's own name", async (t) => {
    const repo = featureRepo(t);
    const before = git(repo.root, "rev-parse", "HEAD");
    const after = repo.commit(Object.fromEntries(NAMES.map((name) => [name, "one\n"])), "add");
    assert.deepEqual(await addedLines(repo.root, before, after), new Map(NAMES.map((name) => [name, [[1, 1]]])));
    const [only] = await commitsBetween(repo.root, before, after, before);
    assert.deepEqual(only.changes.map(({ path }) => path).toSorted(), NAMES.toSorted());
  });
});

/**
 * Round 1 reviewed `first`, round 2 `second`; the branch then merged main, resolving a conflict on a.py line 4 to
 * main's original line, moved two files at once, edited one of them and added a submodule.
 */
function reviewedTwice(t: TestContext) {
  const repo = featureRepo(t);
  const { root } = repo;
  const first = repo.commit({ "b.py": B, "a.py": numbered("line", 30).replace("line3\n", "feat3\n") }, "feat: b");
  const second = repo.commit({ "b.py": FIXED, "c.py": "c\n" }, "fix 1");
  git(root, "checkout", "-q", "main");
  repo.commit({ "a.py": numbered("line", 30).replace("line3\n", "main3\n").replace("line20\n", "main20\n") }, "main edits a.py");
  git(root, "checkout", "-q", "feat");
  assert.throws(() => git(root, "merge", "-q", "--no-edit", "main"));
  writeFileSync(join(root, "a.py"), numbered("line", 30).replace("line20\n", "main20\n"));
  repo.commit({}, "merge main");
  git(root, "mv", "b.py", "d.py");
  git(root, "mv", "c.py", "e.py");
  repo.commit({}, "move b and c");
  repo.commit({ "d.py": FIXED.replace("b15\n", "fifteen\n"), "z.py": "z\n" }, "fix 2");
  git(root, "update-index", "--add", "--cacheinfo", `160000,${first},sub`);
  git(root, "commit", "-q", "-m", "add sub");
  const head = git(root, "rev-parse", "HEAD");
  return { root, first, second, head, base: git(root, "merge-base", head, "main") };
}

describe("fixHistory: what git says about the fixes made since round 1", () => {
  it("splits the fixes by the heads reviewed and leaves out what the base branch brought in", async (t) => {
    const { root, first, second, head, base } = reviewedTwice(t);
    const history = await fixHistory(root, [first, second], head, base);
    assert.deepEqual(
      history.ranges.map((range) => range.map(({ changes }) => changes)),
      [
        [[{ path: "b.py", from: null }, { path: "c.py", from: null }]],
        [
          [
            { path: "d.py", from: "b.py" },
            { path: "e.py", from: "c.py" },
          ],
          [
            { path: "d.py", from: null },
            { path: "z.py", from: null },
          ],
          [{ path: "sub", from: null }],
        ],
      ],
    );
    assert.deepEqual(
      history.fixLines,
      new Map([
        ["a.py", [[4, 4]]],
        ["d.py", [[5, 6], [17, 17]]],
        ["e.py", [[1, 1]]],
        ["z.py", [[1, 1]]],
        ["sub", [[1, 1]]],
      ]),
    );
    assert.deepEqual([history.originalAdditions, history.fixAdditions], [21, 7]);
  });

  it("gives no range and no fix line before round 1", async (t) => {
    const repo = featureRepo(t);
    const head = repo.commit({ "b.py": B }, "feat: b");
    assert.deepEqual(await fixHistory(repo.root, [], head, git(repo.root, "rev-parse", "main")), {
      ranges: [],
      fixLines: new Map(),
      originalAdditions: 20,
      fixAdditions: 0,
    });
  });

  // Each rewrites what git prints for a diff or a log, or how it merges, unless the read pins it.
  const SETTINGS: Record<string, [key: string, value: string][]> = {
    "color.ui": [["color.ui", "always"]],
    "color.diff": [["color.diff", "always"]],
    "diff.external": [["diff.external", "echo rewritten"]],
    textconv: [["diff.shout.textconv", "sed 1d"]],
    "diff.noprefix": [["diff.noprefix", "true"]],
    "diff.interHunkContext": [["diff.interHunkContext", "5"]],
    "diff.submodule": [["diff.submodule", "diff"]],
    "diff.ignoreSubmodules": [["diff.ignoreSubmodules", "all"]],
    "diff.renames=false": [["diff.renames", "false"]],
    "diff.renames=copies": [["diff.renames", "copies"]],
    "diff.renameLimit": [["diff.renameLimit", "1"]],
    "diff.context": [["diff.context", "5"]],
    "diff.suppressBlankEmpty": [["diff.suppressBlankEmpty", "true"]],
    "diff.orderFile": [["diff.orderFile", ".git/order"]],
    "diff.algorithm": [["diff.algorithm", "histogram"]],
    "diff.indentHeuristic": [["diff.indentHeuristic", "false"]],
    "log.showSignature": [["log.showSignature", "true"]],
    "merge.conflictStyle": [["merge.conflictStyle", "diff3"]],
  };

  it("reads the same under each of these git configs of the repository", async (t) => {
    const { root, first, second, head, base } = reviewedTwice(t);
    // The driver the textconv setting names, and the reverse of git's own file order for the orderFile setting.
    writeFileSync(join(root, ".git", "info", "attributes"), "*.py diff=shout\n");
    writeFileSync(join(root, ".git", "order"), "z.py\nsub\ne.py\nd.py\nc.py\nb.py\na.py\n");
    const read = () => fixHistory(root, [first, second], head, base);
    const plain = await read();
    for (const [name, config] of Object.entries(SETTINGS)) {
      for (const [key, value] of config) git(root, "config", key, value);
      try {
        assert.deepEqual(await read(), plain, name);
      } finally {
        for (const [key] of config) git(root, "config", "--unset", key);
      }
    }
  });
});
