import { Buffer } from "node:buffer";
import { z } from "zod";

import { runGit } from "./git.ts";
import { GitHubRefused, ownerAndName, type GitHubClient } from "./github.ts";

export type TreeEntry = { name: string; isDir: boolean };

/**
 * The files of one ref. A path is relative to the root and `/`-separated, with no empty, `.` or `..` segment.
 * A path the ref does not hold, or holds as the other kind, throws `NotInTree`; a ref or repository that cannot be
 * read throws the transport's own error.
 */
export type Tree = {
  /** The entries directly inside the directory at `path`, ordered by name. */
  listDir(path: string): Promise<TreeEntry[]>;
  /** The UTF-8 text of the regular file at `path`; a symlink or a submodule is no file. */
  readText(path: string): Promise<string>;
};

type Wanted = "file" | "directory";

export class NotInTree extends Error {
  readonly path: string;
  readonly ref: string;

  constructor(path: string, ref: string, wanted: Wanted) {
    super(`${ref} has no ${wanted} at ${path}`);
    this.name = "NotInTree";
    this.path = path;
    this.ref = ref;
  }
}

function isPlainPath(text: string): boolean {
  return text.split("/").every((segment) => segment !== "" && segment !== "." && segment !== "..");
}

// Both trees refuse the same paths: git would read `..` from the working directory, and fetch would resolve it
// into another API endpoint.
function assertTreePath(path: string): void {
  if (!isPlainPath(path)) throw new TypeError(`not a path inside a tree: ${JSON.stringify(path)}`);
}

// GitHub reads an empty ref as the default branch, which is not the ref the caller asked about.
function assertRef(ref: string): void {
  if (ref === "") throw new TypeError("a tree needs a ref; an empty one names none");
}

// Git orders a tree as if each directory's name ended in `/`, GitHub by name: one order for both.
function byName(entries: TreeEntry[]): TreeEntry[] {
  return entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

type LsTreeRecord = { mode: string; type: string; object: string; name: string };

const LS_TREE_RECORD = /^([0-7]{6}) ([a-z]+) ([0-9a-f]+)\t(.+)$/s;
// A symlink is a blob too, whose text is its target's path.
const SYMLINK_MODE = "120000";

function lsTreeRecords(stdout: string): LsTreeRecord[] {
  return stdout
    .split("\0")
    .filter((record) => record !== "")
    .map((record) => {
      const fields = LS_TREE_RECORD.exec(record);
      if (fields === null) throw new Error(`git ls-tree gave a record it does not document: ${JSON.stringify(record)}`);
      const [, mode, type, object, name] = fields;
      return { mode, type, object, name };
    });
}

export function gitTree(checkout: string, ref: string): Tree {
  assertRef(ref);

  async function entryAt(path: string): Promise<LsTreeRecord | undefined> {
    assertTreePath(path);
    // A path is a name, never a pattern or magic such as `:/`, and a ref is never read as an option.
    const args = ["--literal-pathspecs", "ls-tree", "-z", "--full-tree", "--end-of-options", ref, "--", path];
    return lsTreeRecords((await runGit(checkout, args)).stdout).find((record) => record.name === path);
  }

  return {
    async listDir(path) {
      const found = await entryAt(path);
      if (found?.type !== "tree") throw new NotInTree(path, ref, "directory");
      const { stdout } = await runGit(checkout, ["ls-tree", "-z", found.object]);
      return byName(lsTreeRecords(stdout).map((record) => ({ name: record.name, isDir: record.type === "tree" })));
    },

    async readText(path) {
      const found = await entryAt(path);
      if (found?.type !== "blob" || found.mode === SYMLINK_MODE) throw new NotInTree(path, ref, "file");
      return (await runGit(checkout, ["cat-file", "blob", found.object])).stdout;
    },
  };
}

// The contents API lists at most this many entries of a directory and says nothing of the rest.
const CONTENTS_LISTING_CAP = 1000;

const ContentsListing = z.array(z.object({ name: z.string(), type: z.string() }));
const ContentsItem = z.object({ type: z.string() });
const ContentsFile = z.object({ encoding: z.string(), content: z.string() });

export function gitHubTree(client: GitHubClient, repo: string, ref: string): Tree {
  assertRef(ref);
  const { owner, name } = ownerAndName(repo);
  const root = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/contents`;
  const atRef = `?ref=${encodeURIComponent(ref)}`;

  async function contentsAt(path: string, wanted: Wanted): Promise<unknown> {
    assertTreePath(path);
    try {
      return await client.rest("GET", `${root}/${path.split("/").map(encodeURIComponent).join("/")}${atRef}`);
    } catch (error) {
      if (!(error instanceof GitHubRefused) || error.status !== 404) throw error;
      // GitHub answers 404 alike for a missing path and for a repository or ref the token cannot read. Once the
      // root reads at the ref, only the path is left missing; when it does not, its refusal names the cause.
      await client.rest("GET", `${root}${atRef}`);
      throw new NotInTree(path, ref, wanted);
    }
  }

  return {
    async listDir(path) {
      const answer = await contentsAt(path, "directory");
      if (!Array.isArray(answer)) throw new NotInTree(path, ref, "directory");
      const entries = ContentsListing.parse(answer);
      if (entries.length >= CONTENTS_LISTING_CAP) {
        throw new Error(
          `${repo} ${path} at ${ref}: the contents API lists at most ${CONTENTS_LISTING_CAP} entries, so this listing may be cut short`,
        );
      }
      return byName(entries.map((entry) => ({ name: entry.name, isDir: entry.type === "dir" })));
    },

    async readText(path) {
      const answer = await contentsAt(path, "file");
      if (Array.isArray(answer) || ContentsItem.parse(answer).type !== "file") throw new NotInTree(path, ref, "file");
      const file = ContentsFile.parse(answer);
      // Over 1 MB the contents API answers with encoding `none` and an empty content.
      if (file.encoding !== "base64") {
        throw new Error(`${repo} ${path} at ${ref}: the contents API gave it without its content (encoding ${file.encoding})`);
      }
      return Buffer.from(file.content, "base64").toString("utf8");
    },
  };
}
