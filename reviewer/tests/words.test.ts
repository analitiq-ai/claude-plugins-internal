import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { plain, words } from "../plugin/lib/rules/words.ts";

describe("words", () => {
  it("gives each word with the offsets that slice it from the text", () => {
    const text = "  # The validator\n  rejects  an\n\n// empty list";
    const found = words(text);
    assert.deepEqual(
      found.map(({ word }) => word),
      ["The", "validator", "rejects", "an", "empty", "list"],
    );
    for (const { word, start, end } of found) assert.equal(text.slice(start, end), word);
  });

  it("leaves out a comment mark at a line's start that a space or the line's end follows", () => {
    assert.equal(plain("# a\n// b\n/** c\n * d\n */\n-- e\n> f\n; g\n<!-- h\n#\n"), "a b c d e f g h");
  });

  it("keeps the characters a word starts with that a comment mark is made of", () => {
    const starts = ["#123", "//x", "/*x", "*.ts", "*/x", "--verbose", ">=5", ";x", "<!--x", "**Bold**", "---"];
    assert.equal(plain(starts.map((word) => `${word} y\n`).join("")), starts.map((word) => `${word} y`).join(" "));
  });

  it("leaves a comment mark inside a line as a word", () => {
    assert.equal(plain("a # b\n> c"), "a # b c");
  });
});
