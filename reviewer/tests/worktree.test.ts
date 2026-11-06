import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { textHunks } from "../plugin/lib/worktree.ts";

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
