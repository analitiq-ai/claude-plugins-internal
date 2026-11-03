import assert from "node:assert/strict";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { after, before, describe, it } from "node:test";

import { checkAdrFolder } from "../src/adr.ts";
import { adrFolders, type ResolvedAdrFolder } from "../src/adr-folders.ts";
import { GitFailed, runGit } from "../src/git.ts";
import { SettingsError, SHARED_SECTION, type Shared } from "../src/settings.ts";
import { SHARED } from "./fixtures/state/issue.ts";

// The cases named after a test of reviewer/tests/test_adrkit.py port its Corpora and BrokenRecordPlacements (R2).
// Not ported: test_an_empty_org_setting_is_unset and the env-var half of
// test_an_org_setting_that_is_no_absolute_readable_folder_could_not_run, as no folder comes from an environment
// variable any more (root ADR-0002 d3); its unreadable half is AS3 here and checkAdrFolder's in adr.test.ts.

const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];
const BRANCH = "275-us2-spec";
const ORG_ENTRY = "../org/docs/adr";
const MISSING_ENTRY = "../missing/docs/adr";
const FILE_ENTRY = "docs/notes.md";
const THROUGH_FILE_ENTRY = `${FILE_ENTRY}/adr`;
const ON_THE_BRANCH_ONLY = "0002-added-by-the-spec-branch.md";
const FAR = 10_000_000; // ms: a deadline no test reaches
const RECORDS = new URL("./fixtures/adr/corpus/", import.meta.url);
const NEEDS_LOCKED_UNREADABLE = { skip: process.getuid?.() === 0 && "root reads a chmod 000 folder" };

/** BrokenRecordPlacements.CASES: each broken record's file, the fixture it is written from, and the id adrkit names. */
const BROKEN = [
  { what: "duplicate id", name: "0001-dup.md", from: "0001-accepted-on-src.md", id: "0001" },
  { what: "no frontmatter", name: "0002-bare.md", from: "0007-no-frontmatter.md", id: undefined },
];

let scratch: string;
let main: string;
let worktree: string;
let org: string;
let absolute: string;
let locked: string;
let loop: string;

function listing(adr_folders: string[]): Shared {
  return { ...SHARED, adr_folders };
}

function readableEntries(): string[] {
  return [ORG_ENTRY, "docs/adr", absolute];
}

function everyEntry(): string[] {
  return [ORG_ENTRY, "docs/adr", absolute, MISSING_ENTRY, locked, FILE_ENTRY, THROUGH_FILE_ENTRY, join(loop, "adr")];
}

/** What `everyEntry()` resolves to from `checkout`. */
function resolvedFrom(checkout: string): ResolvedAdrFolder[] {
  return [
    { entry: ORG_ENTRY, path: org, inside: false, readable: true },
    { entry: "docs/adr", path: join(checkout, "docs", "adr"), inside: true, readable: true },
    { entry: absolute, path: absolute, inside: false, readable: true },
    { entry: MISSING_ENTRY, path: join(scratch, "missing", "docs", "adr"), inside: false, readable: false },
    { entry: locked, path: locked, inside: false, readable: false },
    { entry: FILE_ENTRY, path: join(checkout, "docs", "notes.md"), inside: true, readable: false },
    { entry: THROUGH_FILE_ENTRY, path: join(checkout, "docs", "notes.md", "adr"), inside: true, readable: false },
    { entry: join(loop, "adr"), path: join(loop, "adr"), inside: false, readable: false },
  ];
}

function sameFolderRefused(...entries: string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof SettingsError, `expected SettingsError, got ${String(error)}`);
    assert.equal(error.where, SHARED_SECTION);
    // Quoted, as the refusal names an entry: the resolved path it also names holds an entry's text unquoted.
    for (const entry of entries) assert.ok(error.message.includes(JSON.stringify(entry)), `${entry} not named: ${error.message}`);
    return true;
  };
}

async function commitAll(root: string, message: string): Promise<void> {
  await runGit(root, ["add", "-A"]);
  await runGit(root, [...COMMITTER, "commit", "-q", "-m", message]);
}

/** A repository of its own at `<scratch>/<name>/demo`, as test_adrkit.py's Repo sets one up for each test. */
async function freshRepo(name: string): Promise<string> {
  const root = join(scratch, name, "demo");
  mkdirSync(root, { recursive: true });
  await runGit(root, ["init", "-q", "-b", "main"]);
  writeFileSync(join(root, "a.py"), "base\n");
  await commitAll(root, "base");
  return root;
}

function record(folder: string, name: string, from = "0001-accepted-on-src.md"): void {
  mkdirSync(folder, { recursive: true });
  copyFileSync(new URL(from, RECORDS), join(folder, name));
}

/** BrokenRecordPlacements.broken_in: `entry`, read from `checkout`, is the folder `corpus` inside the repo at `root`,
 *  and adr check of it names a changed record adrkit fails on, wherever the folder sits and however it is reached. */
async function brokenIn(root: string, corpus: string, entry: string, checkout = root): Promise<void> {
  record(corpus, "0001-a.md");
  for (const { name } of BROKEN) writeFileSync(join(corpus, name), "placeholder\n");
  await commitAll(root, "records");

  const resolved = await adrFolders(checkout, listing([entry]));
  assert.deepEqual(resolved, [{ entry, path: realpathSync(corpus), inside: true, readable: true }]);

  const cwd = realpathSync(root);
  for (const { what, name, from, id } of BROKEN) {
    record(corpus, name, from);
    const changed = relative(cwd, join(realpathSync(corpus), name));
    const answer = await checkAdrFolder(cwd, resolved[0], [changed], FAR);
    assert.ok("broken" in answer, `${what}: ${JSON.stringify(answer)}`);
    assert.deepEqual(
      answer.broken.map((broken) => [broken.file, broken.id]),
      [[changed, id]],
      what,
    );
    writeFileSync(join(corpus, name), "placeholder\n");
  }
}

before(async () => {
  // git answers with real paths, so a temp dir reached through a symlink would never compare equal.
  scratch = realpathSync(mkdtempSync(join(tmpdir(), "core-adr-folders-")));
  main = join(scratch, "repo");
  worktree = join(scratch, "repo.worktrees", BRANCH);
  org = join(scratch, "org", "docs", "adr");
  absolute = join(scratch, "absolute", "adr");
  locked = join(scratch, "locked", "adr");
  loop = join(scratch, "loop");

  mkdirSync(join(main, "docs", "adr"), { recursive: true });
  writeFileSync(join(main, "docs", "adr", "0001-on-main.md"), "dummy record\n");
  // Read and search bits set, so being a file is all that makes it no readable folder.
  writeFileSync(join(main, "docs", "notes.md"), "a file where a folder is listed\n", { mode: 0o755 });
  await runGit(main, ["init", "-q", "-b", "main"]);
  await commitAll(main, "first");
  await runGit(main, ["worktree", "add", "-q", "-b", BRANCH, worktree]);
  writeFileSync(join(worktree, "docs", "adr", ON_THE_BRANCH_ONLY), "dummy record\n");
  await commitAll(worktree, "the spec branch adds a record");

  mkdirSync(org, { recursive: true });
  mkdirSync(absolute, { recursive: true });
  mkdirSync(locked, { recursive: true });
  chmodSync(locked, 0o000);
  symlinkSync(loop, loop);
});

after(() => {
  // Absent when before() failed first; the scratch folder is removed all the same.
  if (existsSync(locked)) chmodSync(locked, 0o755);
  rmSync(scratch, { recursive: true, force: true });
});

describe("adrFolders", () => {
  it("resolves every entry, in list order, called from the main checkout itself", NEEDS_LOCKED_UNREADABLE, async () => {
    assert.deepEqual(await adrFolders(main, listing(everyEntry())), resolvedFrom(main));
  });

  it("resolves every entry, in list order, from a worktree", NEEDS_LOCKED_UNREADABLE, async () => {
    assert.deepEqual(await adrFolders(worktree, listing(everyEntry())), resolvedFrom(worktree));
  });

  it("resolves a folder beside the repo to one absolute path, outside it, from the main checkout and a worktree (AS1)", async () => {
    const expected = [{ entry: ORG_ENTRY, path: org, inside: false, readable: true }];
    assert.deepEqual(await adrFolders(main, listing([ORG_ENTRY])), expected);
    assert.deepEqual(await adrFolders(worktree, listing([ORG_ENTRY])), expected);
  });

  it("resolves an in-repo folder in each checkout, so the worktree's holds the record its branch adds (AS2)", async () => {
    const [fromWorktree] = await adrFolders(worktree, listing(["docs/adr"]));
    assert.deepEqual(fromWorktree, { entry: "docs/adr", path: join(worktree, "docs", "adr"), inside: true, readable: true });
    assert.ok(existsSync(join(fromWorktree.path, ON_THE_BRANCH_ONLY)));

    const [fromMain] = await adrFolders(main, listing(["docs/adr"]));
    assert.deepEqual(fromMain, { entry: "docs/adr", path: join(main, "docs", "adr"), inside: true, readable: true });
    assert.ok(!existsSync(join(fromMain.path, ON_THE_BRANCH_ONLY)));
  });

  it("returns a missing folder, an unreadable one, a file, a path through a file and one through a symlink to itself as not readable, by entry and resolved path, the others unchanged (AS3)", NEEDS_LOCKED_UNREADABLE, async () => {
    const every = await adrFolders(worktree, listing(everyEntry()));
    const readable = await adrFolders(worktree, listing(readableEntries()));
    assert.deepEqual(every.slice(0, readable.length), readable);
    assert.deepEqual(every.slice(readable.length), [
      { entry: MISSING_ENTRY, path: join(scratch, "missing", "docs", "adr"), inside: false, readable: false },
      { entry: locked, path: locked, inside: false, readable: false },
      { entry: FILE_ENTRY, path: join(worktree, "docs", "notes.md"), inside: true, readable: false },
      { entry: THROUGH_FILE_ENTRY, path: join(worktree, "docs", "notes.md", "adr"), inside: true, readable: false },
      { entry: join(loop, "adr"), path: join(loop, "adr"), inside: false, readable: false },
    ]);
  });

  it("returns a missing absolute entry as its normalised path, not readable (AS3)", async () => {
    const gone = join(scratch, "gone", "adr");
    // Written by hand: join would normalise them.
    for (const entry of [`${gone}/`, `${scratch}/gone/x/../adr`]) {
      assert.deepEqual(await adrFolders(main, listing([entry])), [{ entry, path: gone, inside: false, readable: false }]);
    }
  });

  it("refuses [shared] when a missing absolute entry is listed with its normalised form, naming both", async () => {
    const gone = join(scratch, "gone", "adr");
    await assert.rejects(adrFolders(main, listing([`${gone}/`, gone])), sameFolderRefused(`${gone}/`, gone));
  });

  it("refuses [shared] when an entry and the absolute path of the same folder are both listed, naming both", async () => {
    const same = join(main, "docs", "adr");
    await assert.rejects(adrFolders(main, listing(["docs/adr", same])), sameFolderRefused("docs/adr", same));
  });

  it("returns no folder for an empty list (AS5)", async () => {
    assert.deepEqual(await adrFolders(main, listing([])), []);
  });

  it("throws GitFailed when the checkout is in no git repository", async () => {
    const outside = join(scratch, "not-a-repo");
    mkdirSync(outside, { recursive: true });
    // The machine's temp folder may lie in a git work tree, which git would find above the scratch folder.
    const ceiling = process.env.GIT_CEILING_DIRECTORIES;
    process.env.GIT_CEILING_DIRECTORIES = scratch;
    try {
      await assert.rejects(adrFolders(outside, listing([ORG_ENTRY])), GitFailed);
    } finally {
      if (ceiling === undefined) delete process.env.GIT_CEILING_DIRECTORIES;
      else process.env.GIT_CEILING_DIRECTORIES = ceiling;
    }
  });

  // test_repo_corpora_are_labelled_by_their_path_from_the_root
  it("labels an in-repo folder by its entry as written", async () => {
    const root = await freshRepo("labels-in-repo");
    record(join(root, "dev", "x", "docs", "adr"), "0001-a.md");
    record(join(root, "docs", "adr"), "0001-a.md");
    await commitAll(root, "records");
    assert.deepEqual(await adrFolders(root, listing(["dev/x/docs/adr", "docs/adr"])), [
      { entry: "dev/x/docs/adr", path: join(root, "dev", "x", "docs", "adr"), inside: true, readable: true },
      { entry: "docs/adr", path: join(root, "docs", "adr"), inside: true, readable: true },
    ]);
  });

  // test_the_org_corpus_is_labelled_by_the_setting
  it("labels a folder outside the repo by its entry as written", async () => {
    const root = await freshRepo("labels-outside");
    const outside = join(scratch, "labels-outside", "engineering", "docs", "adr");
    record(outside, "0001-a.md");
    assert.deepEqual(await adrFolders(root, listing([outside])), [{ entry: outside, path: outside, inside: false, readable: true }]);
  });

  // test_a_folder_both_reach_is_one_corpus_the_orgs: a folder two entries reach is refused, naming both (Edge Cases).
  it("refuses [shared] when two entries reach one folder, one through a symlink, naming both", async () => {
    const root = await freshRepo("both-reach");
    record(join(root, "docs", "adr"), "0001-a.md");
    await commitAll(root, "records");
    const link = join(scratch, "both-reach", "org-link");
    symlinkSync(join(root, "docs"), link);
    await assert.rejects(adrFolders(root, listing(["docs/adr", `${link}/adr`])), sameFolderRefused("docs/adr", `${link}/adr`));
  });

  // test_a_nested_repo_corpus
  it("resolves a nested in-repo folder so adr check sees a changed broken record in it", async () => {
    const root = await freshRepo("nested");
    await brokenIn(root, join(root, "dev", "x", "docs", "adr"), "dev/x/docs/adr");
  });

  // test_an_org_corpus_inside_the_checkout
  it("resolves an absolute entry inside the checkout as inside, so adr check sees a changed broken record in it", async () => {
    const root = await freshRepo("absolute-inside");
    const corpus = join(root, "org", "docs", "adr");
    await brokenIn(root, corpus, corpus);
  });

  // test_an_org_corpus_reached_through_a_symlink
  it("resolves an entry reached through a symlink to its real path, inside, so adr check sees a changed broken record in it", async () => {
    const root = await freshRepo("symlinked-folder");
    const link = join(scratch, "symlinked-folder", "org-link");
    mkdirSync(join(root, "org"));
    symlinkSync(join(root, "org"), link);
    await brokenIn(root, join(root, "org", "docs", "adr"), `${link}/docs/adr`);
  });

  // test_the_checkout_root_given_through_a_symlink_with_the_org_corpus_named_by_its_real_path
  it("resolves from a checkout given through a symlink, an entry named by its real path inside, so adr check sees a changed broken record in it", async () => {
    const root = await freshRepo("symlinked-checkout");
    const link = join(scratch, "symlinked-checkout", "root-link");
    symlinkSync(root, link);
    const corpus = join(root, "org", "docs", "adr");
    await brokenIn(root, corpus, corpus, link);
  });
});
