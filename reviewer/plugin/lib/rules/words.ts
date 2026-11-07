/** A word of a text and where it stands: `start` its first character's offset, `end` one past its last. */
export type Word = { word: string; start: number; end: number };

// A mark counts only when a space or the line's end follows it, so `*.ts`, `--verbose` and `#123` keep their characters.
const COMMENT_MARK = /^\s*(?:#+|\/\/+|\/\*+|\*+\/?|--|>|;+|<!--)(?:\s|$)/;
const WORD = /\S+/g;

/** Each word of `text` with its offsets, a comment mark at a line's start left out. */
export function words(text: string): Word[] {
  const found: Word[] = [];
  let lineStart = 0;
  for (const line of text.split("\n")) {
    const from = COMMENT_MARK.exec(line)?.[0].length ?? 0;
    for (const match of line.slice(from).matchAll(WORD)) {
      const start = lineStart + from + match.index;
      found.push({ word: match[0], start, end: start + match[0].length });
    }
    lineStart += line.length + 1;
  }
  return found;
}

/** The words `words` finds in `text`, one space between each two. */
export function plain(text: string): string {
  return words(text)
    .map(({ word }) => word)
    .join(" ");
}
