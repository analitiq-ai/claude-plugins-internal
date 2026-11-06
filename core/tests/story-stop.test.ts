import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import type { StoryPr } from "../src/identity.ts";
import type { Shared } from "../src/settings.ts";
import { StopState, storyStop, type StoryStopFacts } from "../src/story-stop.ts";
import { importSpecifiers } from "./source-scan.ts";

const SOURCE = fileURLToPath(new URL("../src/story-stop.ts", import.meta.url));
const GITHUB = fileURLToPath(new URL("../src/github.ts", import.meta.url));

const BOARD = "https://github.com/orgs/acme/projects/1";
const BRANCH = "245-us1-retry-an-upload";
const WORKTREE = "/work/widgets.worktrees/245-us1-retry-an-upload";
const PR: StoryPr = { number: 31, head: "b".repeat(40), closed: false, merged: false };
const LOCAL_HEAD = "a".repeat(40);
const SHARED: Shared = {
  validators: [],
  adr_folders: [],
  board: BOARD,
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};
const MERGE_DUE = { needed: true, why: ["specs/217-rebuild-issue-tackle/spec.md differs on main"] };

/** Every fact read, none of which stops: the story's PR is open and its head is the local head. */
function facts(over: Partial<StoryStopFacts> = {}): StoryStopFacts {
  return {
    story: 245,
    session: { repo: "acme/widgets", issue: 245 },
    origin: "acme/widgets",
    issue: { state: "open", title: "Retry an upload", body: "" },
    done: false,
    shared: SHARED,
    lane: "In progress",
    spec: 217,
    branch: { github: BRANCH, local: BRANCH },
    pr: PR,
    worktree: { path: WORKTREE, branch: BRANCH, mergeInProgress: false, dirty: [] },
    head: PR.head,
    headVsPr: "same",
    merge: { needed: false, why: [] },
    folder: { one: "specs/217-rebuild-issue-tackle" },
    ...over,
  };
}

const worktree = (over: Partial<NonNullable<StoryStopFacts["worktree"]>>) => ({ path: WORKTREE, branch: BRANCH, mergeInProgress: false, dirty: [], ...over });

// In the data model's Decision order.
const stops: [state: StopState, why: string, over: Partial<StoryStopFacts>, named: string[]][] = [
  ["NO_SESSION_RECORD", "a session with no record", { session: null }, []],
  ["OTHER_SESSION_ISSUE", "a record for another issue", { session: { repo: "acme/widgets", issue: 246 } }, ["#246"]],
  ["OTHER_REPOSITORY", "a record for another repository", { session: { repo: "acme/other", issue: 245 } }, ["acme/other", "acme/widgets"]],
  ["DONE", "a done story", { done: true }, []],
  ["CLOSED", "a closed issue", { issue: { state: "closed", title: "Retry an upload", body: "" } }, []],
  ["NO_CARD", "no card on the board", { lane: null }, [BOARD]],
  ["LANE", "a card in Backlog", { lane: "Backlog" }, ["Backlog"]],
  ["LANE", "a card in Blocked", { lane: "Blocked" }, ["Blocked"]],
  ["SPEC_ISSUE_ELSEWHERE", "a parent in another repository", { spec: { elsewhere: "its parent acme/other#3, in another repository" } }, ["acme/other#3"]],
  ["SEVERAL_BRANCHES", "two story branches", { branch: { several: "245-us1-retry, 245-us2-cap" } }, ["245-us1-retry, 245-us2-cap"]],
  ["BRANCH_MISMATCH", "a GitHub branch and another local one", { branch: { github: BRANCH, local: "245-us2-cap" } }, [BRANCH, "245-us2-cap"]],
  ["WORKTREE_ON_OTHER_BRANCH", "the worktree on another branch", { worktree: worktree({ branch: "main" }) }, [WORKTREE, "main", BRANCH]],
  ["UNCOMMITTED_CHANGES", "uncommitted changes", { worktree: worktree({ dirty: ["core/src/a.ts", "notes.md"] }) }, [WORKTREE, "core/src/a.ts", "notes.md"]],
  ["UNCOMMITTED_CHANGES", "uncommitted changes, with no PR given", { pr: null, headVsPr: undefined, worktree: worktree({ dirty: ["notes.md"] }) }, ["notes.md"]],
  ["HEAD_BEHIND_PR", "a local head behind the PR head", { head: LOCAL_HEAD, headVsPr: "behind" }, [LOCAL_HEAD, PR.head]],
  ["HEAD_BEHIND_PR", "a local head diverged from the PR head", { head: LOCAL_HEAD, headVsPr: "diverged" }, [LOCAL_HEAD, PR.head]],
  ["NO_SPECS", "no specs/ at HEAD", { folder: { noSpecs: true } }, [BRANCH, "specs/"]],
  ["NO_SPEC_FOLDER", "no specs/<p>-* at HEAD", { folder: { none: true } }, [BRANCH, "specs/217-*"]],
  ["SEVERAL_SPEC_FOLDERS", "two specs/<p>-* at HEAD", { folder: { several: ["specs/217-a", "specs/217-b"] } }, ["specs/217-a", "specs/217-b"]],
];

describe("StopState", () => {
  it("is the 16 stops of the data model, in its order", () => {
    assert.deepEqual(StopState.schema.options, [
      "NO_SESSION_RECORD",
      "OTHER_SESSION_ISSUE",
      "OTHER_REPOSITORY",
      "CLOSED",
      "DONE",
      "LANE",
      "NO_CARD",
      "SPEC_ISSUE_ELSEWHERE",
      "SEVERAL_BRANCHES",
      "BRANCH_MISMATCH",
      "WORKTREE_ON_OTHER_BRANCH",
      "NO_SPECS",
      "NO_SPEC_FOLDER",
      "SEVERAL_SPEC_FOLDERS",
      "HEAD_BEHIND_PR",
      "UNCOMMITTED_CHANGES",
    ]);
  });

  it("has a case below for each of its values", () => {
    assert.deepEqual(new Set(stops.map(([state]) => state)), new Set(StopState.schema.options));
  });
});

describe("storyStop", () => {
  for (const [state, why, over, named] of stops) {
    const given = facts(over);
    it(`is ${state} for ${why}, its reason naming the state, #245, what it found and any open story PR`, () => {
      const stop = storyStop(given);
      assert.ok(stop !== null, "a stop");
      assert.equal(stop.state, state);
      for (const name of [state, "#245", ...named]) assert.ok(stop.reason.includes(name), `${JSON.stringify(stop.reason)} names ${name}`);
      assert.equal(stop.reason.includes("#31"), given.pr !== null, stop.reason);
    });
  }

  it("names no planning command in any reason", () => {
    for (const [, , over] of stops) assert.doesNotMatch(storyStop(facts(over))?.reason ?? "", /speckit|\/plan|\/specify|issue-spec/);
  });

  it("is null for facts that reach no stop", () => {
    assert.equal(storyStop(facts()), null);
  });

  it("is null for a local head ahead of the PR head, and for a closed PR whatever the heads", () => {
    assert.equal(storyStop(facts({ head: LOCAL_HEAD, headVsPr: "ahead" })), null);
    for (const headVsPr of [undefined, "same", "ahead", "behind", "diverged"] as const) {
      assert.equal(storyStop(facts({ pr: { ...PR, closed: true }, head: LOCAL_HEAD, headVsPr })), null, headVsPr);
    }
  });

  it("is null for a merge in progress, with or without uncommitted files and with any later stop's facts: the merge is a step, not a stop", () => {
    const later = stops.slice(stops.findLastIndex(([state]) => state === "UNCOMMITTED_CHANGES") + 1);
    for (const dirty of [[], ["core/src/a.ts", "notes.md"]]) {
      const merging = worktree({ mergeInProgress: true, dirty });
      assert.equal(storyStop(facts({ worktree: merging })), null, JSON.stringify(dirty));
      for (const [state, , over] of later) assert.equal(storyStop(facts({ ...over, worktree: merging })), null, state);
    }
  });

  it("is null when a merge is due, whatever the folder: stage 6 before stage 7", () => {
    assert.equal(storyStop(facts({ merge: MERGE_DUE })), null);
    for (const folder of [{ noSpecs: true as const }, { none: true as const }, { several: ["specs/217-a", "specs/217-b"] }]) {
      assert.equal(storyStop(facts({ merge: MERGE_DUE, folder })), null, JSON.stringify(folder));
    }
  });

  it("is HEAD_BEHIND_PR for a due merge onto a head behind or diverged from the open PR's: stage 9's stop before stage 6", () => {
    for (const headVsPr of ["behind", "diverged"] as const) {
      assert.equal(storyStop(facts({ head: LOCAL_HEAD, headVsPr, merge: MERGE_DUE }))?.state, "HEAD_BEHIND_PR", headVsPr);
    }
  });

  it("decides stages 9, 6 and 7 at the ref the worktree would start from when there is no worktree", () => {
    const cut = facts({ branch: { github: null, local: null }, pr: null, worktree: null, headVsPr: undefined });
    assert.equal(storyStop(cut), null);
    assert.equal(storyStop({ ...cut, merge: MERGE_DUE, folder: { none: true } }), null);
    const noFolder = storyStop({ ...cut, folder: { none: true } });
    assert.ok(noFolder !== null);
    assert.equal(noFolder.state, "NO_SPEC_FOLDER");
    for (const name of ["#245", "specs/217-*", PR.head]) assert.ok(noFolder.reason.includes(name), `${noFolder.reason} names ${name}`);
    for (const branch of [{ github: BRANCH, local: null }, { github: BRANCH, local: BRANCH }, { github: null, local: BRANCH }]) {
      const at = facts({ branch, worktree: null });
      assert.equal(storyStop(at), null, JSON.stringify(branch));
      assert.equal(storyStop({ ...at, head: LOCAL_HEAD, headVsPr: "behind" })?.state, "HEAD_BEHIND_PR", JSON.stringify(branch));
      assert.equal(storyStop({ ...at, folder: { noSpecs: true } })?.state, "NO_SPECS", JSON.stringify(branch));
    }
  });

  it("decides in the data model's Decision order: of two stops whose facts hold together, the earlier", () => {
    for (const [i, [earlier, , first]] of stops.entries()) {
      for (const [later, , second] of stops.slice(i + 1)) {
        // Of two stops read from one fact, only the session's issue and repository, and the worktree's branch and
        // changes, can both hold: those two pairs are checked below.
        if (Object.keys(first).some((key) => key in second)) continue;
        assert.equal(storyStop(facts({ ...second, ...first }))?.state, earlier, `${earlier} before ${later}`);
      }
    }
    assert.equal(storyStop(facts({ session: { repo: "acme/other", issue: 246 } }))?.state, "OTHER_SESSION_ISSUE");
    assert.equal(storyStop(facts({ worktree: worktree({ branch: "main", dirty: ["a"] }) }))?.state, "WORKTREE_ON_OTHER_BRANCH");
  });
});

describe("the source of story-stop.ts", () => {
  it("imports neither node:fs, node:child_process nor github.ts: the rule reads nothing", () => {
    const imported = importSpecifiers(readFileSync(SOURCE, "utf8"), "src/story-stop.ts").map(({ specifier }) => specifier);
    const reads = imported.filter(
      (specifier) => /^(node:)?(fs|child_process)(\/|$)/.test(specifier) || (specifier.startsWith(".") && resolve(dirname(SOURCE), specifier) === GITHUB),
    );
    assert.deepEqual(reads, []);
  });
});
