import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate as turn } from "node:timers/promises";
import { describe, it } from "node:test";

import { ADR_INSTALL, type AdrAnswer } from "../plugin/core/adr.ts";
import type { ResolvedAdrFolder } from "../plugin/core/adr-folders.ts";
import { couldNotRun } from "../plugin/core/outcomes.ts";
import { brokenRefusal, checkFolders, decisionsOf, notCheckedRefusal, tooBig, type FolderCheck } from "../plugin/lib/round/decisions.ts";

const IN_REPO: ResolvedAdrFolder = { entry: "docs/adr", path: "/work/repo/docs/adr", inside: true, readable: true };
const BESIDE: ResolvedAdrFolder = { entry: "../decisions", path: "/work/decisions", inside: false, readable: true };

const ANSWER: AdrAnswer = {
  governing: [
    { recordId: "0001", title: "Accepted on src" },
    { recordId: "0005", title: "Path and entity" },
  ],
  broken: [
    { file: "docs/adr/0007-no-frontmatter.md", rule: "frontmatter-fence", message: "ADR files must start with a leading --- YAML frontmatter fence" },
    { file: "docs/adr/0006-same-id.md", id: "0006", rule: "unique-id", message: 'ADR id "0006" is used by multiple records' },
  ],
  notices: [{ id: "0004", matcher: 'affects.path "src/**"', message: 'path matcher "src/**" is qualified with repo "acme/other"' }],
};
const QUIET: AdrAnswer = { governing: [], broken: [], notices: [] };
const UNRUN = couldNotRun(BESIDE.entry, "adr check exited 2: boom Next step: fix what adr says.");
const UNREADABLE: ResolvedAdrFolder = { entry: "/srv/adr", path: "/srv/adr", inside: false, readable: false };
const UNREAD = couldNotRun(UNREADABLE.entry, "not a readable folder, so adr was not called. Next step: make it readable.");

describe("checkFolders: one adr answer per listed folder", () => {
  it("asks every folder before any answers, and gives the answers in the folders' order", async () => {
    let open = 0;
    let most = 0;
    const checks = await checkFolders([IN_REPO, BESIDE], async (folder) => {
      open += 1;
      most = Math.max(most, open);
      // The first folder answers last, so an answer in arrival order shows.
      for (let wait = folder === IN_REPO ? 3 : 1; wait > 0; wait -= 1) await turn();
      open -= 1;
      return folder === IN_REPO ? ANSWER : UNRUN;
    });
    assert.equal(most, 2);
    assert.deepEqual(checks, [
      { folder: IN_REPO, answer: ANSWER },
      { folder: BESIDE, answer: UNRUN },
    ]);
  });

  it("asks nothing when no folder is listed", async () => {
    const checks = await checkFolders([], () => assert.fail("asked a folder where none is listed"));
    assert.deepEqual(checks, []);
  });
});

describe("decisionsOf: the round's decisions block, each item labelled by its folder's entry as written (ADR-0022 d2)", () => {
  it("is empty with no folder: nothing governs, and no folder went unchecked", () => {
    assert.deepEqual(decisionsOf([]), { corpora: [], governing: [], notices: [], broken: [], not_checked: [] });
  });

  it("lists the governing records, notices and broken records adr answered, and each folder not checked with its reason", () => {
    const checks: FolderCheck[] = [
      { folder: IN_REPO, answer: ANSWER },
      { folder: BESIDE, answer: UNRUN },
    ];
    assert.deepEqual(decisionsOf(checks), {
      corpora: ["docs/adr"],
      governing: [
        { corpus: "docs/adr", id: "0001", title: "Accepted on src" },
        { corpus: "docs/adr", id: "0005", title: "Path and entity" },
      ],
      notices: [{ corpus: "docs/adr", id: "0004", matcher: 'affects.path "src/**"', reason: 'path matcher "src/**" is qualified with repo "acme/other"' }],
      broken: [
        { corpus: "docs/adr", file: "docs/adr/0007-no-frontmatter.md", rule: "frontmatter-fence", message: "ADR files must start with a leading --- YAML frontmatter fence" },
        { corpus: "docs/adr", file: "docs/adr/0006-same-id.md", id: "0006", rule: "unique-id", message: 'ADR id "0006" is used by multiple records' },
      ],
      not_checked: [{ corpus: "../decisions", reason: UNRUN.reason }],
    });
  });

  it("keeps the same id in two folders as two records", () => {
    const one = (title: string): AdrAnswer => ({ ...QUIET, governing: [{ recordId: "0001", title }] });
    const { governing } = decisionsOf([
      { folder: IN_REPO, answer: one("a") },
      { folder: BESIDE, answer: one("b") },
    ]);
    assert.deepEqual(governing, [
      { corpus: "docs/adr", id: "0001", title: "a" },
      { corpus: "../decisions", id: "0001", title: "b" },
    ]);
  });
});

describe("the decision check's refusals", () => {
  it("too big names the file count, the max_review_files limit and the next step for the round's scope", () => {
    const [full, delta] = [tooBig(51, 50, "full"), tooBig(51, 50, "delta")];
    for (const reason of [full, delta]) {
      assert.match(reason, /^The decision check failed, not the change: /);
      assert.match(reason, /this round reviews 51 files and max_review_files is 50, so no decision was checked/);
    }
    assert.match(full, /Next step: split the PR\.$/);
    assert.match(delta, /Next step: commit in smaller steps and launch after each\.$/);
  });

  it("a folder adr could not check refuses the round, naming each such folder with its reason", () => {
    const reason = notCheckedRefusal([
      { folder: IN_REPO, answer: QUIET },
      { folder: BESIDE, answer: UNRUN },
      { folder: UNREADABLE, answer: UNREAD },
    ]);
    assert.equal(
      reason,
      `The decision check failed, not the change: the decision check could not run, so no round was opened.\n- ${UNRUN.reason}\n- ${UNREAD.reason}`,
    );
    assert.equal(notCheckedRefusal([{ folder: IN_REPO, answer: QUIET }]), null);
  });

  it("a broken record refuses the round with a fix that works where its folder lies", () => {
    const inRepo = brokenRefusal([{ folder: IN_REPO, answer: ANSWER }]);
    assert.match(inRepo ?? "", /^The decision check failed, not the change: adr fails on decision records this change touches\.\n/);
    assert.match(
      inRepo ?? "",
      /- docs\/adr docs\/adr\/0006-same-id\.md \(id 0006\): ADR id "0006" is used by multiple records \(unique-id\)\. Next step: correct the record in this repo, commit and launch again\./,
    );
    assert.match(inRepo ?? "", /- docs\/adr docs\/adr\/0007-no-frontmatter\.md: ADR files must start/);

    const beside = brokenRefusal([{ folder: BESIDE, answer: ANSWER }]);
    assert.match(beside ?? "", /- \.\.\/decisions docs\/adr\/0006-same-id\.md \(id 0006\): .* Next step: correct the record in \/work\/decisions, then launch again\./);
    assert.doesNotMatch(beside ?? "", /commit/);

    assert.equal(brokenRefusal([{ folder: IN_REPO, answer: QUIET }, { folder: BESIDE, answer: UNRUN }]), null);
  });
});

describe("the plugin's README", () => {
  it("gives the install step of the adrkit version core reads", () => {
    assert.ok(readFileSync(new URL("../plugin/README.md", import.meta.url), "utf8").includes(`\`${ADR_INSTALL}\``));
  });
});
