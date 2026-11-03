import {readdirSync} from "node:fs";
import {join} from "node:path";

type Token = {kind: "string" | "word" | "punct" | "other"; value: string; line: number};

export type StringLiteral = {value: string; line: number};
export type ImportSpecifier = {specifier: string; line: number};

// After any other word, or after `)`, `]` or `}`, a `/` divides.
const WORDS_BEFORE_REGEX = new Set([
  "return", "typeof", "instanceof", "in", "of", "new", "delete", "void", "throw", "case", "do", "else", "yield",
  "await",
]);
const WORD_CHAR = /[\p{ID_Continue}$]/u;

export function moduleFiles(root: string): string[] {
  return readdirSync(root, {recursive: true, withFileTypes: true})
    .filter((entry) => entry.isFile() && /\.[cm]?[jt]s$/.test(entry.name))
    .map((entry) => join(entry.parentPath, entry.name))
    .sort();
}

// A line-by-line pattern would read a quote inside a comment or a regex literal (`/rel="next"/`) as the start of
// a string and misread the rest of the file, so the source is tokenized. A token the scanner cannot close
// throws rather than scanning on in the wrong state.
function tokens(source: string, file: string): Token[] {
  const out: Token[] = [];
  // One entry per template substitution still open: the depth of `{` opened inside it.
  const substitutions: number[] = [];
  let i = 0;
  let line = 1;

  const fail = (what: string, at: number): never => {
    throw new Error(`cannot scan ${file}:${at}: unterminated ${what}`);
  };
  const regexMayStart = (): boolean => {
    const prev = out.at(-1);
    if (prev === undefined) return true;
    if (prev.kind === "punct") return !")]}".includes(prev.value);
    if (prev.kind === "word") return WORDS_BEFORE_REGEX.has(prev.value);
    return false;
  };
  const readTemplateSpan = (startLine: number): {text: string; substitution: boolean} => {
    let text = "";
    for (;;) {
      if (i >= source.length) fail("template literal", startLine);
      const c = source[i];
      if (c === "\\") {
        if (source[i + 1] === "\n") line++;
        text += source.slice(i, i + 2);
        i += 2;
      } else if (c === "`") {
        i++;
        return {text, substitution: false};
      } else if (c === "$" && source[i + 1] === "{") {
        i += 2;
        return {text, substitution: true};
      } else {
        if (c === "\n") line++;
        text += c;
        i++;
      }
    }
  };
  while (i < source.length) {
    const c = source[i];
    const startLine = line;
    if (c === "\n") {
      line++;
      i++;
    } else if (/\s/.test(c)) {
      i++;
    } else if (c === "/" && source[i + 1] === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (c === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2);
      if (end === -1) fail("comment", startLine);
      line += source.slice(i, end).split("\n").length - 1;
      i = end + 2;
    } else if (c === "'" || c === '"') {
      let value = "";
      i++;
      for (;;) {
        const d = source[i];
        if (d === undefined || d === "\n") fail("string", startLine);
        if (d === c) break;
        if (d === "\\") {
          if (source[i + 1] === "\n") line++;
          value += source.slice(i, i + 2);
          i += 2;
        } else {
          value += d;
          i++;
        }
      }
      i++;
      out.push({kind: "string", value, line: startLine});
    } else if (c === "`" || (c === "}" && substitutions.at(-1) === 0)) {
      // Only a template opened and closed with no substitution is a whole quoted string.
      const opened = c === "`";
      if (!opened) substitutions.pop();
      i++;
      const span = readTemplateSpan(startLine);
      if (span.substitution) {
        substitutions.push(0);
        out.push({kind: "punct", value: "${", line: startLine});
      } else if (opened) {
        out.push({kind: "string", value: span.text, line: startLine});
      } else {
        out.push({kind: "other", value: "`", line: startLine});
      }
    } else if (c === "/" && regexMayStart()) {
      let inClass = false;
      i++;
      for (;;) {
        const d = source[i];
        if (d === undefined || d === "\n" || (d === "\\" && source[i + 1] === "\n")) {
          fail("regular expression", startLine);
        }
        if (d === "\\") {
          i += 2;
          continue;
        }
        i++;
        if (d === "[") inClass = true;
        else if (d === "]") inClass = false;
        else if (d === "/" && !inClass) break;
      }
      while (i < source.length && WORD_CHAR.test(source[i])) i++;
      out.push({kind: "other", value: "/", line: startLine});
    } else if (WORD_CHAR.test(c)) {
      let end = i;
      while (end < source.length && WORD_CHAR.test(source[end])) end++;
      out.push({kind: "word", value: source.slice(i, end), line: startLine});
      i = end;
    } else {
      if (substitutions.length > 0 && c === "{") substitutions[substitutions.length - 1]++;
      if (substitutions.length > 0 && c === "}") substitutions[substitutions.length - 1]--;
      out.push({kind: "punct", value: c, line: startLine});
      i++;
    }
  }
  if (substitutions.length > 0) fail("template literal", line);
  return out;
}

// A template literal with no substitution counts: it is as much a quoted string as '…' and "…".
export function stringLiterals(text: string, file: string): StringLiteral[] {
  return tokens(text, file)
    .filter((token) => token.kind === "string")
    .map(({value, line}) => ({value, line}));
}

// `require("x")` counts beside the import forms: through `createRequire` it loads code as an import does.
export function importSpecifiers(text: string, file: string): ImportSpecifier[] {
  const all = tokens(text, file);
  const is = (token: Token | undefined, kind: Token["kind"], value: string): boolean =>
    token?.kind === kind && token.value === value;
  return all.flatMap((token, n) => {
    if (token.kind !== "string") return [];
    const [before3, before2, before1] = [all[n - 3], all[n - 2], all[n - 1]];
    const specifier =
      is(before1, "word", "from") ||
      (is(before1, "word", "import") && !is(before2, "punct", ".")) ||
      (is(before1, "punct", "(") &&
        (is(before2, "word", "import") || is(before2, "word", "require")) &&
        !is(before3, "punct", "."));
    return specifier ? [{specifier: token.value, line: token.line}] : [];
  });
}
