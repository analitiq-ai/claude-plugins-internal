import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { GitFailed, runGit, trackingRefspec } from "../src/git.ts";
import { GitHubRefused, GitHubUnanswered } from "../src/github.ts";
import { sessionsFolder } from "../src/orchestrator-paths.ts";
import { SessionRecordRefused, writeSessionRecord } from "../src/session-record.ts";
import { storyStop, type StoryStopFacts } from "../src/story-stop.ts";
import { readStoryStopFacts, type StoryStopRead } from "../src/story-stop-facts.ts";
import { fakeGitHub, type FakeCall, type FakeRoutes } from "./support/fake-github.ts";

const REPO = "acme/widgets";
const REPO_ID = "R_widgets";
const BOARD = "https://github.com/orgs/acme/projects/1";
const OTHER_BOARD = "https://github.com/orgs/acme/projects/2";
const WORKTREE_BOARD = "https://github.com/orgs/acme/projects/3";
const BRANCH = "245-us1-retry-an-upload";
const SPEC_FOLDER = "specs/217-rebuild-issue-tackle";
const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];

function settings(board: string): string {
  return `[shared]
validators = []
adr_folders = []
board = "${board}"
session_app_login = "codeworks-session[bot]"
orchestrator_app_login = "codeworks-orchestrator[bot]"
reviewer_app_login = "codeworks-reviewer[bot]"
planner_app_login = "codeworks-planner[bot]"
`;
}

const SHARED = {
  validators: [],
  adr_folders: [],
  board: BOARD,
  session_app_login: "codeworks-session[bot]",
  orchestrator_app_login: "codeworks-orchestrator[bot]",
  reviewer_app_login: "codeworks-reviewer[bot]",
  planner_app_login: "codeworks-planner[bot]",
};

const BASE_FILES = { "README.md": "widgets\n", "codeworks.toml": settings(BOARD), [`${SPEC_FOLDER}/spec.md`]: "# spec\n" };

/**
 * `remote` stands for acme/widgets on GitHub; `checkout` is the main checkout, its origin GitHub's URL, so the fetch
 * the test hands in reads `remote`; `upstream` is another clone, which moves `remote`'s branches.
 */
type Scratch = {
  home: string;
  remote: string;
  upstream: string;
  checkout: string;
  worktree: string;
  sessionId: string;
  fetched: string[][];
  fetch: (refspecs: readonly string[]) => Promise<void>;
};

async function git(at: string, ...args: string[]): Promise<string> {
  return (await runGit(at, [...COMMITTER, ...args])).stdout.trim();
}

async function commit(at: string, files: Readonly<Record<string, string | null>>, message: string): Promise<string> {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) {
      rmSync(join(at, path), { recursive: true, force: true });
      continue;
    }
    mkdirSync(dirname(join(at, path)), { recursive: true });
    writeFileSync(join(at, path), text);
  }
  await git(at, "add", "-A");
  await git(at, "commit", "-q", "--allow-empty", "-m", message);
  return git(at, "rev-parse", "HEAD");
}

/** A remote holding BASE_FILES on main, a main checkout of it with no story branch, and `record`, unless null, as the session's record. */
async function scratch(t: TestContext, record: { repo: string; issue: number } | null = { repo: REPO, issue: 245 }): Promise<Scratch> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "core-story-stop-facts-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  await git(root, "init", "-q", "--bare", "-b", "main", remote);
  const checkout = join(root, "widgets");
  mkdirSync(checkout);
  await git(checkout, "init", "-q", "-b", "main");
  await git(checkout, "remote", "add", "origin", "https://github.com/acme/widgets.git");
  await commit(checkout, BASE_FILES, "base");
  await git(checkout, "push", "-q", remote, "main");
  const upstream = join(root, "upstream");
  await git(root, "clone", "-q", remote, upstream);
  const home = join(root, "home");
  const sessionId = randomUUID();
  if (record !== null) writeSessionRecord(sessionsFolder(home), sessionId, { v: 1, ...record, taken: "claim", at: "2026-11-04T10:00:00Z" });
  const fetched: string[][] = [];
  const fetch = async (refspecs: readonly string[]): Promise<void> => {
    fetched.push([...refspecs]);
    await git(checkout, "fetch", "-q", remote, ...refspecs);
  };
  return { home, remote, upstream, checkout, worktree: join(root, "widgets.worktrees", BRANCH), sessionId, fetched, fetch };
}

/** The story branch, made locally from main with its worktree at `widgets.worktrees/<branch>`. */
async function withWorktree(at: Scratch): Promise<string> {
  await git(at.checkout, "worktree", "add", "-q", "-b", BRANCH, at.worktree, "main");
  return git(at.worktree, "rev-parse", "HEAD");
}

/** `files` committed on the remote's `branch`, made from main when the remote has no such branch. */
async function onRemote(at: Scratch, branch: string, files: Readonly<Record<string, string | null>>): Promise<string> {
  await git(at.upstream, "fetch", "-q", "origin");
  const has = await runGit(at.upstream, ["rev-parse", "--verify", "--quiet", `refs/remotes/origin/${branch}`], [1]);
  await git(at.upstream, "checkout", "-q", "-B", branch, has.code === 0 ? `origin/${branch}` : "origin/main");
  const sha = await commit(at.upstream, files, `${branch} moves`);
  await git(at.upstream, "push", "-q", "origin", `${branch}:${branch}`);
  return sha;
}

type SpecPrNode = { number: number; closed: boolean; merged: boolean; mergeCommit: { oid: string } | null };

type GitHubSide = {
  issue?: { state: "open" | "closed" };
  timeline?: unknown[];
  lane?: string | null;
  parent?: { number: number; repository: { id: string; nameWithOwner: string } } | null;
  branches?: string[];
  pr?: { head: string; closed?: boolean } | null;
  specPrs?: SpecPrNode[];
  defaultBranch?: string;
  /** A read that throws `error` in place of its answer. */
  failing?: { read: "parent" | "branches"; error: Error };
};

function gitHub(side: GitHubSide = {}) {
  const { issue = { state: "open" }, timeline = [], lane = "In progress", branches = [BRANCH], pr = null, specPrs = [], defaultBranch = "main" } = side;
  const parent = side.parent === undefined ? { number: 217, repository: { id: REPO_ID, nameWithOwner: REPO } } : side.parent;
  const failed = (read: "parent" | "branches", answer: unknown): unknown => (side.failing?.read === read ? side.failing.error : answer);
  const prs =
    pr === null
      ? []
      : [{ number: 31, headRefName: BRANCH, headRefOid: pr.head, isCrossRepository: false, closed: pr.closed ?? false, merged: false, mergeCommit: null }];
  const routes: FakeRoutes = {
    rest: {
      "GET /repos/acme/widgets/issues/245": { ...issue, title: "Retry an upload", body: null },
      "GET /repos/acme/widgets": { default_branch: defaultBranch },
      // Answered, so a read of GitHub's copy would show as OTHER_BOARD in the facts, not as a refused call (R7).
      "GET /repos/acme/widgets/contents/codeworks.toml?ref=main": {
        type: "file",
        encoding: "base64",
        content: Buffer.from(settings(OTHER_BOARD)).toString("base64"),
      },
    },
    restPages: {
      "/repos/acme/widgets/git/matching-refs/heads/245-us": failed("branches", branches.map((name) => ({ ref: `refs/heads/${name}` }))),
    },
    graphql: [
      { when: (query) => query.includes("parent"), answer: failed("parent", { repository: { id: REPO_ID, issue: { parent } } }) },
      { when: (query) => !query.includes("issue("), answer: { repository: { id: REPO_ID } } },
    ],
    graphqlPages: [
      { when: (query) => query.includes("timelineItems"), answer: timeline },
      {
        when: (query) => query.includes("projectItems"),
        // The story's card on OTHER_BOARD, the board GitHub's copy names, is In progress.
        answer: [{ project: { url: OTHER_BOARD }, status: { name: "In progress" } }, ...(lane === null ? [] : [{ project: { url: BOARD }, status: { name: lane } }])],
      },
      { when: (query, vars) => query.includes("pullRequests") && vars.branch === BRANCH, answer: prs },
      {
        when: (query, vars) => query.includes("pullRequests") && vars.branch === "217-spec",
        answer: specPrs.map((node) => ({ ...node, headRefName: "217-spec", headRefOid: "e".repeat(40), isCrossRepository: false })),
      },
    ],
  };
  return fakeGitHub(routes);
}

const READS = ["timelineItems", "projectItems", "parent", "pullRequests"];

/** What each call read: a REST path, the GraphQL connection or field it asked for, or "now". */
function asked(calls: readonly FakeCall[]): string[] {
  return calls.map((call) => {
    if (call.kind === "rest" || call.kind === "restPages") return call.path;
    if (call.kind === "now") return "now";
    const read = READS.find((name) => call.query.includes(name)) ?? "repository id";
    return read === "pullRequests" ? `pullRequests ${String(call.vars.branch)}` : read;
  });
}

// smol-toml's tables have no prototype; the facts are compared on their keys and values.
function plain(read: StoryStopRead): StoryStopRead {
  return structuredClone(read);
}

async function read(at: Scratch, github = gitHub(), checkout = at.checkout): Promise<StoryStopRead> {
  return readStoryStopFacts(245, at.sessionId, { reader: github, home: at.home, checkout, fetch: at.fetch });
}

function assertNothingAfterWorktree(facts: StoryStopFacts): void {
  for (const key of ["head", "headVsPr", "merge", "folder"] as const) assert.equal(facts[key], undefined, key);
}

const MAIN_FETCH = [trackingRefspec("main")];
const BRANCH_FETCH = [trackingRefspec(BRANCH)];

describe("readStoryStopFacts: the facts of a story that stops nowhere", () => {
  it("reads every fact, GitHub's in the data model's order, and fetches the default branch, then the story branch", async (t) => {
    const at = await scratch(t);
    const head = await withWorktree(at);
    await git(at.worktree, "push", "-q", at.remote, BRANCH);
    const github = gitHub({ pr: { head } });
    assert.deepEqual(plain(await read(at, github)), {
      main: at.checkout,
      facts: {
        story: 245,
        session: { repo: REPO, issue: 245 },
        origin: REPO,
        shared: SHARED,
        issue: { state: "open", title: "Retry an upload", body: "" },
        done: false,
        lane: "In progress",
        spec: 217,
        branch: { github: BRANCH, local: BRANCH },
        pr: { number: 31, head, closed: false, merged: false },
        worktree: { path: at.worktree, branch: BRANCH, mergeInProgress: false, dirty: [] },
        head,
        headVsPr: "same",
        merge: { needed: false, why: [] },
        folder: { one: SPEC_FOLDER },
      },
    });
    assert.deepEqual(asked(github.calls), [
      "/repos/acme/widgets",
      "/repos/acme/widgets/issues/245",
      "repository id",
      "timelineItems",
      "projectItems",
      "parent",
      "/repos/acme/widgets/git/matching-refs/heads/245-us",
      `pullRequests ${BRANCH}`,
    ]);
    assert.deepEqual(at.fetched, [MAIN_FETCH, BRANCH_FETCH]);
  });

  it("fetches the default branch GitHub names, whatever its name", async (t) => {
    const at = await scratch(t);
    await git(at.checkout, "push", "-q", at.remote, "main:trunk");
    const head = await withWorktree(at);
    await git(at.worktree, "push", "-q", at.remote, BRANCH);
    await read(at, gitHub({ pr: { head }, defaultBranch: "trunk" }));
    assert.deepEqual(at.fetched, [[trackingRefspec("trunk")], BRANCH_FETCH]);
  });

  it("gives the same branch, worktree and merge facts, and the main checkout, from the main checkout and from the story's worktree", async (t) => {
    const at = await scratch(t);
    await withWorktree(at);
    await onRemote(at, "main", { [`${SPEC_FOLDER}/spec.md`]: "# spec, amended\n" });
    const fromMain = await read(at, gitHub({ branches: [] }));
    const fromWorktree = await read(at, gitHub({ branches: [] }), at.worktree);
    assert.equal(fromMain.main, at.checkout);
    assert.equal(fromWorktree.main, at.checkout);
    for (const key of ["branch", "worktree", "merge"] as const) assert.deepEqual(fromWorktree.facts[key], fromMain.facts[key], key);
    assert.equal(fromMain.facts.merge?.needed, true);
  });
});

describe("readStoryStopFacts: stage 1, the session, before any GitHub read or fetch", () => {
  it("reads session: null for a session with no record", async (t) => {
    const at = await scratch(t, null);
    const github = gitHub();
    assert.deepEqual(plain(await read(at, github)), { main: at.checkout, facts: { story: 245, session: null, origin: REPO } });
    assert.deepEqual(github.calls, []);
    assert.deepEqual(at.fetched, []);
  });

  for (const [what, record] of [
    ["another issue", { repo: REPO, issue: 246 }],
    ["another repository", { repo: "acme/other", issue: 245 }],
  ] as const) {
    it(`reads a record for ${what}, the origin from the checkout, and nothing more`, async (t) => {
      const at = await scratch(t, record);
      const github = gitHub();
      assert.deepEqual(plain(await read(at, github)), { main: at.checkout, facts: { story: 245, session: record, origin: REPO } });
      assert.deepEqual(github.calls, []);
      assert.deepEqual(at.fetched, []);
    });
  }

  it("refuses a record that is no session record, naming its file", async (t) => {
    const at = await scratch(t, null);
    const path = join(sessionsFolder(at.home), `${at.sessionId}.json`);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, "{not json");
    const github = gitHub();
    await assert.rejects(read(at, github), (error: unknown) => error instanceof SessionRecordRefused && error.message.includes(path));
    assert.deepEqual(github.calls, []);
    assert.deepEqual(at.fetched, []);
  });
});

describe("readStoryStopFacts: stages 2 and 3, the issue, the lane and the spec's issue", () => {
  it("reads the issue, and stops on a closed one before the lane", async (t) => {
    const at = await scratch(t);
    const github = gitHub({ issue: { state: "closed" } });
    const { facts } = await read(at, github);
    assert.deepEqual(facts.issue, { state: "closed", title: "Retry an upload", body: "" });
    assert.equal(facts.lane, undefined);
    assert.ok(!asked(github.calls).includes("projectItems"));
    assert.deepEqual(at.fetched, [MAIN_FETCH]);
  });

  it("reads done through isDone, and stops on it before the lane", async (t) => {
    const at = await scratch(t);
    const merged = { __typename: "PullRequest", number: 30, headRefName: BRANCH, merged: true, isCrossRepository: false, repository: { id: REPO_ID } };
    const { facts } = await read(at, gitHub({ timeline: [{ __typename: "CrossReferencedEvent", source: merged }] }));
    assert.equal(facts.done, true);
    assert.equal(facts.lane, undefined);
  });

  for (const lane of ["Blocked", null] as const) {
    it(`reads the lane on the board the checkout's HEAD names, not GitHub's copy, and stops on ${lane ?? "no card"} before the spec's issue`, async (t) => {
      const at = await scratch(t);
      const github = gitHub({ lane });
      const { facts } = await read(at, github);
      assert.equal(facts.shared?.board, BOARD);
      assert.equal(facts.lane, lane);
      assert.ok(!asked(github.calls).includes("/repos/acme/widgets/contents/codeworks.toml?ref=main"));
      assert.ok(!asked(github.calls).includes("parent"));
    });
  }

  it("reads the settings at the HEAD of the checkout given, not its uncommitted copy: a worktree's own", async (t) => {
    const at = await scratch(t);
    await withWorktree(at);
    await commit(at.worktree, { "codeworks.toml": settings(WORKTREE_BOARD) }, "another board");
    writeFileSync(join(at.worktree, "codeworks.toml"), settings("https://github.com/orgs/acme/projects/4"));
    const github = gitHub({ branches: [] });
    const { facts } = await read(at, github, at.worktree);
    assert.equal(facts.shared?.board, WORKTREE_BOARD);
    assert.equal(facts.lane, null);
    assert.ok(!asked(github.calls).includes("/repos/acme/widgets/contents/codeworks.toml?ref=main"));
  });

  it("reads a parent in another repository as the spec's issue elsewhere, and stops before the branches", async (t) => {
    const at = await scratch(t);
    const github = gitHub({ parent: { number: 3, repository: { id: "R_other", nameWithOwner: "acme/other" } } });
    const { facts } = await read(at, github);
    assert.ok(typeof facts.spec === "object" && facts.spec.elsewhere.includes("acme/other#3"), JSON.stringify(facts.spec));
    assert.ok(!asked(github.calls).includes("/repos/acme/widgets/git/matching-refs/heads/245-us"));
  });
});

describe("readStoryStopFacts: stage 4, the branches and the worktree", () => {
  it("reads the story PR with B3's closed, and no head relation for a closed one", async (t) => {
    const at = await scratch(t);
    const head = await withWorktree(at);
    await git(at.worktree, "push", "-q", at.remote, BRANCH);
    const { facts } = await read(at, gitHub({ pr: { head, closed: true } }));
    assert.deepEqual(facts.pr, { number: 31, head, closed: true, merged: false });
    assert.equal(facts.headVsPr, undefined);
  });

  it("reads a local branch with no GitHub branch, and its worktree, fetching no branch but the default", async (t) => {
    const at = await scratch(t);
    await withWorktree(at);
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.deepEqual(facts.branch, { github: null, local: BRANCH });
    assert.equal(facts.pr, null);
    assert.equal(facts.worktree?.branch, BRANCH);
    assert.deepEqual(at.fetched, [MAIN_FETCH]);
  });

  it("reads two local story branches as several, and stops before any worktree or branch fetch", async (t) => {
    const at = await scratch(t);
    await git(at.checkout, "branch", BRANCH);
    await git(at.checkout, "branch", "245-us2-cap-retries");
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.ok(facts.branch !== undefined && "several" in facts.branch, JSON.stringify(facts.branch));
    assert.ok(facts.branch.several.includes(BRANCH) && facts.branch.several.includes("245-us2-cap-retries"), facts.branch.several);
    assert.equal(facts.worktree, undefined);
    assert.deepEqual(at.fetched, [MAIN_FETCH]);
  });

  it("reads two GitHub story branches as several", async (t) => {
    const at = await scratch(t);
    const { facts } = await read(at, gitHub({ branches: [BRANCH, "245-us2-cap-retries"] }));
    assert.ok(facts.branch !== undefined && "several" in facts.branch, JSON.stringify(facts.branch));
  });

  it("reads a GitHub branch and another local one, and stops before any worktree or branch fetch", async (t) => {
    const at = await scratch(t);
    await git(at.checkout, "branch", "245-us2-cap-retries");
    const { facts } = await read(at);
    assert.deepEqual(facts.branch, { github: BRANCH, local: "245-us2-cap-retries" });
    assert.equal(facts.worktree, undefined);
    assert.deepEqual(at.fetched, [MAIN_FETCH]);
  });

  it("reads the worktree at the story branch's path on another branch, and stops before the head", async (t) => {
    const at = await scratch(t);
    await git(at.checkout, "branch", BRANCH);
    await git(at.checkout, "worktree", "add", "-q", "-b", "elsewhere", at.worktree, "main");
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.deepEqual(facts.worktree, { path: at.worktree, branch: "elsewhere", mergeInProgress: false, dirty: [] });
    assertNothingAfterWorktree(facts);
  });

  it("reads a detached HEAD at the story branch's path as a worktree on no branch", async (t) => {
    const at = await scratch(t);
    await git(at.checkout, "branch", BRANCH);
    await git(at.checkout, "worktree", "add", "-q", "--detach", at.worktree, "main");
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.deepEqual(facts.worktree, { path: at.worktree, branch: null, mergeInProgress: false, dirty: [] });
    assert.equal(storyStop(facts)?.state, "WORKTREE_ON_OTHER_BRANCH");
  });
});

describe("readStoryStopFacts: stage 5, the worktree's merge state and changes", () => {
  it("reads a merge in progress from MERGE_HEAD, and nothing after it", async (t) => {
    const at = await scratch(t);
    await withWorktree(at);
    await commit(at.worktree, { "README.md": "story\n" }, "story");
    await commit(at.checkout, { "README.md": "main\n" }, "main");
    await runGit(at.worktree, [...COMMITTER, "merge", "-q", "main"], [1]);
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.equal(facts.worktree?.mergeInProgress, true);
    assertNothingAfterWorktree(facts);
  });

  it("reads uncommitted changes from git status, tracked and untracked, and stops before the head", async (t) => {
    const at = await scratch(t);
    await withWorktree(at);
    writeFileSync(join(at.worktree, "README.md"), "changed\n");
    writeFileSync(join(at.worktree, "notes.md"), "new\n");
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.deepEqual(facts.worktree?.dirty, ["README.md", "notes.md"]);
    assertNothingAfterWorktree(facts);
  });
});

describe("readStoryStopFacts: the head the work is on against the PR head", () => {
  for (const relation of ["behind", "ahead", "diverged", "same"] as const) {
    const remoteOnly = relation === "behind" || relation === "diverged";
    it(`reads the worktree's HEAD as ${relation} the PR head${remoteOnly ? ", which is only on the remote until fetched" : ""}`, async (t) => {
      const at = await scratch(t);
      const base = await withWorktree(at);
      await git(at.worktree, "push", "-q", at.remote, BRANCH);
      let prHead = base;
      if (remoteOnly) {
        prHead = await onRemote(at, BRANCH, { "pushed.md": "from elsewhere\n" });
        assert.notEqual((await runGit(at.checkout, ["cat-file", "-e", `${prHead}^{commit}`], [1, 128])).code, 0, "the PR head is local");
      }
      if (relation === "ahead" || relation === "diverged") await commit(at.worktree, { "local.md": "here\n" }, "local");
      const { facts } = await read(at, gitHub({ pr: { head: prHead } }));
      assert.equal(facts.head, await git(at.worktree, "rev-parse", "HEAD"));
      assert.equal(facts.headVsPr, relation);
    });
  }

  for (const relation of ["behind", "diverged"] as const) {
    it(`reads a local branch with no worktree ${relation} the PR head at that branch: HEAD_BEHIND_PR`, async (t) => {
      const at = await scratch(t);
      await git(at.checkout, "branch", BRANCH);
      await git(at.checkout, "push", "-q", at.remote, BRANCH);
      const prHead = await onRemote(at, BRANCH, { "pushed.md": "from elsewhere\n" });
      if (relation === "diverged") {
        await git(at.checkout, "checkout", "-q", BRANCH);
        await commit(at.checkout, { "local.md": "here\n" }, "local");
        await git(at.checkout, "checkout", "-q", "main");
      }
      const github = gitHub({ pr: { head: prHead } });
      const { facts } = await read(at, github);
      assert.equal(facts.worktree, null);
      assert.equal(facts.head, await git(at.checkout, "rev-parse", BRANCH));
      assert.equal(facts.headVsPr, relation);
      assert.equal(storyStop(facts)?.state, "HEAD_BEHIND_PR");
      assert.equal(facts.merge, undefined);
      assert.equal(facts.folder, undefined);
      assert.ok(!asked(github.calls).includes("pullRequests 217-spec"));
    });
  }
});

const SPEC_PR_MERGED = (oid: string): SpecPrNode => ({ number: 40, closed: true, merged: true, mergeCommit: { oid } });
const SPEC_PR_OPEN: SpecPrNode = { number: 41, closed: false, merged: false, mergeCommit: null };

describe("readStoryStopFacts: merge (R9), against the default tip fetched", () => {
  it("is not needed when the default tip is in the head's history, and reads no spec PR", async (t) => {
    const at = await scratch(t);
    await withWorktree(at);
    await commit(at.worktree, { [`${SPEC_FOLDER}/spec.md`]: "# spec, the story's\n" }, "story");
    const github = gitHub({ branches: [] });
    const { facts } = await read(at, github);
    assert.deepEqual(facts.merge, { needed: false, why: [] });
    assert.ok(!asked(github.calls).includes("pullRequests 217-spec"));
  });

  it("is not needed when only an unrelated file differs on the default branch", async (t) => {
    const at = await scratch(t);
    const base = await withWorktree(at);
    await onRemote(at, "main", { "unrelated.md": "x\n" });
    const { facts } = await read(at, gitHub({ branches: [], specPrs: [SPEC_PR_MERGED(base)] }));
    assert.deepEqual(facts.merge, { needed: false, why: [] });
    assert.deepEqual(facts.folder, { one: SPEC_FOLDER });
  });

  it("is needed, naming the PR, when the newest merged spec PR's merge commit is not in the head's history, an older merged one in it and a newer one open", async (t) => {
    const at = await scratch(t);
    const base = await withWorktree(at);
    const oid = await onRemote(at, "main", { "unrelated.md": "x\n" });
    // Listed first, an older merged PR whose merge commit the head holds.
    const older = { ...SPEC_PR_MERGED(base), number: 39 };
    const { facts } = await read(at, gitHub({ branches: [], specPrs: [older, SPEC_PR_OPEN, SPEC_PR_MERGED(oid)] }));
    assert.equal(facts.merge?.needed, true);
    assert.equal(facts.merge?.why.length, 1);
    assert.ok(facts.merge?.why[0].includes("#40"), facts.merge?.why[0]);
    assert.equal(facts.folder, undefined);
  });

  it("throws when the merged spec PR's merge commit is unknown to git", async (t) => {
    const at = await scratch(t);
    await withWorktree(at);
    await onRemote(at, "main", { "unrelated.md": "x\n" });
    await assert.rejects(read(at, gitHub({ branches: [], specPrs: [SPEC_PR_MERGED("c".repeat(40))] })), GitFailed);
  });

  const governing: [what: string, files: Record<string, string | null>, named: string[]][] = [
    ["the spec folder's spec.md changed", { [`${SPEC_FOLDER}/spec.md`]: "# spec, amended\n" }, [`${SPEC_FOLDER}/spec.md`]],
    ["a second specs/217-* added", { "specs/217-second/spec.md": "# another\n" }, ["specs/217-second/spec.md"]],
    ["the spec folder removed", { [SPEC_FOLDER]: null }, [`${SPEC_FOLDER}/spec.md`]],
    ["the spec folder renamed", { [SPEC_FOLDER]: null, "specs/217-renamed/spec.md": "# spec\n" }, [`${SPEC_FOLDER}/spec.md`, "specs/217-renamed/spec.md"]],
    ["an ADR added", { "docs/adr/0001-retry.md": "# ADR\n" }, ["docs/adr"]],
    ["the constitution changed", { ".specify/memory/constitution.md": "# P1\n" }, [".specify/memory"]],
  ];
  for (const [what, files, named] of governing) {
    it(`is needed, naming each path, with ${what} on the default branch`, async (t) => {
      const at = await scratch(t);
      await withWorktree(at);
      await onRemote(at, "main", files);
      const { facts } = await read(at, gitHub({ branches: [] }));
      assert.equal(facts.merge?.needed, true);
      for (const path of named) assert.ok(facts.merge?.why.some((why) => why.includes(path)), `${JSON.stringify(facts.merge?.why)} names ${path}`);
    });
  }

  for (const withPr of [false, true]) {
    it(`is needed, naming the conflict, when the default tip and the head conflict, ${withPr ? "with" : "without"} a PR`, async (t) => {
      const at = await scratch(t);
      await withWorktree(at);
      const head = await commit(at.worktree, { "README.md": "the story's\n" }, "story");
      if (withPr) await git(at.worktree, "push", "-q", at.remote, BRANCH);
      await onRemote(at, "main", { "README.md": "main's\n" });
      const { facts } = await read(at, withPr ? gitHub({ pr: { head } }) : gitHub({ branches: [] }));
      assert.equal(facts.merge?.needed, true);
      assert.ok(facts.merge?.why.some((why) => why.includes("conflict")), JSON.stringify(facts.merge?.why));
    });
  }

  it("with no worktree, is read at the local branch the worktree would start from", async (t) => {
    const at = await scratch(t);
    await git(at.checkout, "checkout", "-q", "-b", BRANCH);
    const head = await commit(at.checkout, { "story.md": "the story's\n" }, "story");
    await git(at.checkout, "checkout", "-q", "main");
    await onRemote(at, "main", { [`${SPEC_FOLDER}/spec.md`]: "# spec, amended\n" });
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.equal(facts.worktree, null);
    assert.equal(facts.head, head);
    assert.equal(facts.merge?.needed, true);
  });
});

describe("readStoryStopFacts: the folder (R10), at the head the work is on", () => {
  const folders: [what: string, files: Record<string, string | null>, folder: unknown][] = [
    ["no specs/", { specs: null }, { noSpecs: true }],
    ["no specs/217-*", { specs: null, "specs/300-other/spec.md": "x" }, { none: true }],
    ["two specs/217-*", { "specs/217-second/spec.md": "x" }, { several: [SPEC_FOLDER, "specs/217-second"].sort() }],
  ];
  for (const [what, files, folder] of folders) {
    it(`reads ${what} at the worktree's HEAD, not main`, async (t) => {
      const at = await scratch(t);
      await withWorktree(at);
      await commit(at.worktree, files, "specs");
      const { facts } = await read(at, gitHub({ branches: [] }));
      assert.deepEqual(facts.folder, folder);
    });
  }

  it("reads it at the fetched default tip when there is no branch anywhere, the head that tip", async (t) => {
    const at = await scratch(t);
    const tip = await onRemote(at, "main", { specs: null });
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.deepEqual(facts.branch, { github: null, local: null });
    assert.equal(facts.worktree, null);
    assert.equal(facts.head, tip);
    assert.deepEqual(facts.merge, { needed: false, why: [] });
    assert.deepEqual(facts.folder, { noSpecs: true });
  });

  it("reads it at the fetched remote-tracking branch for a branch on GitHub only", async (t) => {
    const at = await scratch(t);
    const tip = await onRemote(at, BRANCH, { specs: null });
    const { facts } = await read(at, gitHub({ pr: { head: tip } }));
    assert.deepEqual(facts.branch, { github: BRANCH, local: null });
    assert.equal(facts.worktree, null);
    assert.equal(facts.head, tip);
    assert.equal(facts.headVsPr, "same");
    assert.deepEqual(facts.folder, { noSpecs: true });
    assert.deepEqual(at.fetched, [MAIN_FETCH, BRANCH_FETCH]);
  });

  it("reads it at the local branch when there is one and no worktree", async (t) => {
    const at = await scratch(t);
    await git(at.checkout, "checkout", "-q", "-b", BRANCH);
    await commit(at.checkout, { specs: null }, "no specs");
    await git(at.checkout, "checkout", "-q", "main");
    const { facts } = await read(at, gitHub({ branches: [] }));
    assert.deepEqual(facts.branch, { github: null, local: BRANCH });
    assert.equal(facts.worktree, null);
    assert.deepEqual(facts.folder, { noSpecs: true });
  });
});

describe("readStoryStopFacts rejects with a read GitHub did not answer or refused (FR-009)", () => {
  for (const [which, never] of [
    ["parent", "SPEC_ISSUE_ELSEWHERE"],
    ["branches", "SEVERAL_BRANCHES"],
  ] as const) {
    for (const error of [new GitHubUnanswered("no answer"), new GitHubRefused(502, "Bad Gateway")]) {
      it(`rejects with the ${which} read's ${error.name}, never reading it as ${never}`, async (t) => {
        const at = await scratch(t);
        await assert.rejects(read(at, gitHub({ failing: { read: which, error } })), (thrown: unknown) => thrown === error);
      });
    }
  }
});

describe("readStoryStopFacts writes no branch, worktree or index", () => {
  // Read from disk, as a git status would refresh the index it is checking.
  async function indexes(at: Scratch): Promise<Buffer[]> {
    const checkouts = existsSync(at.worktree) ? [at.checkout, at.worktree] : [at.checkout];
    return Promise.all(checkouts.map(async (checkout) => readFileSync(await git(checkout, "rev-parse", "--path-format=absolute", "--git-path", "index"))));
  }

  for (const [what, setUp] of [
    ["a story with no branch anywhere", async (_at: Scratch) => {}],
    ["a branch on GitHub only", async (at: Scratch) => void (await onRemote(at, BRANCH, { "story.md": "x\n" }))],
    ["a local branch with no worktree", async (at: Scratch) => void (await git(at.checkout, "branch", BRANCH))],
    ["a story with its worktree", async (at: Scratch) => void (await withWorktree(at))],
  ] as const) {
    it(`adds no branch, worktree or index entry for ${what}`, async (t) => {
      const at = await scratch(t);
      await setUp(at);
      // A tracked file whose stat no longer matches the index, its content unchanged: a status that may take the
      // index lock writes the index again for it.
      for (const checkout of existsSync(at.worktree) ? [at.checkout, at.worktree] : [at.checkout]) {
        utimesSync(join(checkout, "README.md"), new Date(2000, 0, 1), new Date(2000, 0, 1));
      }
      const worktrees = () => git(at.checkout, "worktree", "list", "--porcelain");
      const state = async () => ({ heads: await git(at.checkout, "for-each-ref", "refs/heads"), worktrees: await worktrees(), indexes: await indexes(at) });
      const before = await state();
      const github = what === "a branch on GitHub only" ? gitHub() : gitHub({ branches: [] });
      await read(at, github);
      assert.deepEqual(await state(), before);
      for (const call of github.calls) {
        const writes = call.kind === "rest" ? call.method !== "GET" : (call.kind === "graphql" || call.kind === "graphqlPages") && /^\s*mutation\b/.test(call.query);
        assert.ok(!writes, JSON.stringify(call));
      }
    });
  }
});
