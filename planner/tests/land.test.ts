import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { fakeGitHub, type FakeCall, type FakeGitHub } from "../../core/tests/support/fake-github.ts";
import { runGit } from "../plugin/core/git.ts";
import { GitHubUnanswered, type Repository } from "../plugin/core/github.ts";
import { labelTasks, main } from "../plugin/scripts/land.ts";
import {
  git,
  LOGIN,
  output,
  pushFromElsewhere,
  REPO,
  scratchCheckout,
  fakeMint,
  storedToken,
  storeToken,
  tempHome,
  writeCalls,
  writeFiles,
  type Scratch,
} from "./support/checkout.ts";

const P = 7;
const SPEC = "specs/7-retry-budget";
const BRANCH = "7-spec";
const BOT_ID = 4242;
const EMAIL = `${BOT_ID}+${LOGIN}@users.noreply.github.com`;
const API_REPO = "/repos/acme/widgets";
const REPO_URL = "https://api.github.com/repos/acme/widgets";

const STORIES = [
  "User Story 1 - Retry an upload (Priority: P1)",
  "User Story 2 - Cap the retries (Priority: P2)",
  "User Story 3 - Report the budget (Priority: P3)",
];

/** Spec Kit's stock shape: Setup, Foundational, one phase per story, Polish; `labels[i]` goes under heading i. */
function tasksMd(stories: number, labels: readonly (number | null)[] = []): string {
  const phases = [
    { heading: "## Phase 1: Setup", task: "- [ ] T001 Create the folder" },
    { heading: "## Phase 2: Foundational", task: "- [ ] T002 [P] Add the budget type" },
    ...STORIES.slice(0, stories).map((title, i) => ({
      heading: `## Phase ${i + 3}: ${title}`,
      task: `- [ ] T00${i + 3} [P] [US${i + 1}] Do story ${i + 1}\n- [x] T01${i + 3} [US${i + 1}] Test story ${i + 1}`,
    })),
    { heading: `## Phase ${stories + 3}: Polish`, task: "- [ ] T009 Tidy" },
  ];
  const blocks = phases.map(({ heading, task }, i) => {
    const label = labels[i];
    return `${heading}\n${label === undefined || label === null ? "" : `Story issue: #${label}\n`}\n${task}\n`;
  });
  return `# Tasks: retry budget\n\n${blocks.join("\n")}\n## Dependencies & Execution Order\n\n- Setup first\n`;
}

describe("labelTasks", () => {
  it("labels Setup and Foundational with US1's issue, each story phase with its own, Polish with the last's", () => {
    assert.equal(labelTasks(tasksMd(3), [101, 102, 103]), tasksMd(3, [101, 101, 101, 102, 103, 103]));
  });

  it("replaces an existing label line", () => {
    assert.equal(labelTasks(tasksMd(3, [999, null, 101, 888]), [101, 102, 103]), tasksMd(3, [101, 101, 101, 102, 103, 103]));
  });

  it("labels every phase of a one-story spec with that story's issue", () => {
    assert.equal(labelTasks(tasksMd(1), [P]), tasksMd(1, [P, P, P, P]));
  });

  it("returns a labelled text unchanged", () => {
    const labelled = tasksMd(3, [101, 101, 101, 102, 103, 103]);
    assert.equal(labelTasks(labelled, [101, 102, 103]), labelled);
  });
});

type Issue = { id: number; number: number; title: string; repository_url: string };
type Pr = { number: number; headRefName: string; isCrossRepository: boolean; closed: boolean; merged: boolean };

/** What GitHub holds across runs: each run gets a fresh fake recording its own calls over this one state. */
type GitHubState = {
  issues: Issue[];
  subIssues: Issue[];
  blockedBy: { issue: number; blocker: number }[];
  prs: Pr[];
  next: number;
  /** The error a sub_issues or blocked_by write meets, for a landing GitHub stops answering partway through. */
  unanswered?: (call: FakeCall) => GitHubUnanswered | undefined;
};

function gitHubState(over: Partial<GitHubState> = {}): GitHubState {
  return { issues: [], subIssues: [], blockedBy: [], prs: [], next: 101, ...over };
}

function issue(number: number, title = `US: #${number}`, repositoryUrl = REPO_URL): Issue {
  return { id: 9000 + number, number, title, repository_url: repositoryUrl };
}

function pr(number: number, over: Partial<Pr> = {}): Pr {
  return { number, headRefName: BRANCH, isCrossRepository: false, closed: false, merged: false, ...over };
}

function bodyOf(call: FakeCall): Record<string, unknown> {
  assert.equal(call.kind, "rest");
  return (call as { body: Record<string, unknown> }).body;
}

// The bare repository stands in for github.com, so the branches GitHub answers for are the ones it holds.
function githubOf(state: GitHubState, bare: string): FakeGitHub {
  const rest: Record<string, unknown> = {
    [`GET ${API_REPO}`]: { full_name: "acme/widgets", url: REPO_URL, default_branch: "main" },
    [`GET /users/${encodeURIComponent(LOGIN)}`]: { login: LOGIN, id: BOT_ID },
    [`POST ${API_REPO}/issues`]: (call: FakeCall) => {
      const created = issue(state.next++, String(bodyOf(call).title));
      state.issues.push(created);
      return { id: created.id, number: created.number, html_url: `https://github.com/acme/widgets/issues/${created.number}` };
    },
    [`POST ${API_REPO}/issues/${P}/sub_issues`]: (call: FakeCall) => {
      const unanswered = state.unanswered?.(call);
      if (unanswered !== undefined) throw unanswered;
      const child = state.issues.find((one) => one.id === bodyOf(call).sub_issue_id);
      assert.ok(child, `sub_issue_id ${String(bodyOf(call).sub_issue_id)} is no issue`);
      state.subIssues.push(child);
      return { id: 9000 + P, number: P };
    },
    [`POST ${API_REPO}/pulls`]: (call: FakeCall) => {
      const opened = pr(50, { headRefName: String(bodyOf(call).head) });
      state.prs.push(opened);
      return { number: opened.number, html_url: `https://github.com/acme/widgets/pull/${opened.number}` };
    },
  };
  for (let number = 101; number < 110; number++) {
    rest[`POST ${API_REPO}/issues/${number}/dependencies/blocked_by`] = (call: FakeCall) => {
      const unanswered = state.unanswered?.(call);
      if (unanswered !== undefined) throw unanswered;
      const blocker = [...state.issues, ...state.subIssues].find((one) => one.id === bodyOf(call).issue_id);
      assert.ok(blocker, `issue_id ${String(bodyOf(call).issue_id)} is no issue`);
      state.blockedBy.push({ issue: number, blocker: blocker.number });
      return { id: blocker.id, number: blocker.number };
    };
  }
  return fakeGitHub({
    rest,
    graphql: [
      {
        when: (query, vars) => query.includes("ref(qualifiedName:") && vars.owner === "acme" && vars.name === "widgets",
        answer: (call: FakeCall) => {
          if (call.kind !== "graphql") throw new TypeError(`a ref is read by graphql, not ${call.kind}`);
          const qualifiedName = String(call.vars.qualifiedName);
          const held = git(bare, "for-each-ref", "--format=%(refname)", qualifiedName).trim() === qualifiedName;
          return { repository: { ref: held ? { name: qualifiedName.replace(/^refs\/heads\//, "") } : null } };
        },
      },
    ],
    restPages: {
      [`${API_REPO}/issues/${P}/sub_issues`]: () => state.subIssues.map(({ id, number, title, repository_url }) => ({ id, number, title, repository_url })),
    },
    graphqlPages: [
      {
        when: (query, vars) => query.includes("pullRequests") && vars.owner === "acme" && vars.name === "widgets" && vars.branch === BRANCH,
        answer: () => state.prs,
      },
    ],
  });
}

type World = Scratch & { tasks: string };

/**
 * A checkout as a completed run leaves it: the spec folder and two decision records written and unstaged, beside
 * a tracked file edited and a stray file, neither of which is the spec's.
 */
const IDENTITY_VARIABLES = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const;

// An admin's shell may name the admin in these, and git ranks them above any config, so the App's commit must
// not depend on their absence.
function adminIdentity(t: TestContext): void {
  const saved = Object.fromEntries(IDENTITY_VARIABLES.map((name) => [name, process.env[name]]));
  for (const name of IDENTITY_VARIABLES) process.env[name] = name.endsWith("EMAIL") ? "admin@example.test" : "Dummy Admin";
  t.after(() => {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });
}

/** `onMain` is on the default branch, so it is at the merge base too. */
function world(t: TestContext, tasks = tasksMd(3), onMain: Readonly<Record<string, string>> = {}): World {
  tempHome(t);
  adminIdentity(t);
  const scratch = scratchCheckout(t, { "README.md": "widgets\n", ...onMain });
  writeFiles(scratch.checkout, {
    [`${SPEC}/spec.md`]: "# Feature Specification: retry budget\n",
    [`${SPEC}/plan.md`]: "# Plan\n",
    [`${SPEC}/tasks.md`]: tasks,
    "docs/adr/0001-retry-at-most-three-times.md": "# ADR-0001\n",
    "planner/docs/adr/0011-count-retries-per-upload.md": "# ADR-0011\n",
    "README.md": "widgets, edited\n",
    "notes.txt": "a stray file\n",
  });
  storeToken(60);
  return { ...scratch, tasks };
}

type Run = {
  code: number;
  stdout: string[];
  stderr: string[];
  calls: FakeCall[];
  pushes: { repo: Repository; refspec: string }[];
  mints: string[];
};

async function land(w: World, state: GitHubState, args: string[] = [String(P), SPEC, "new"]): Promise<Run> {
  const github = githubOf(state, w.bare);
  const stdout = output();
  const stderr = output();
  const pushes: Run["pushes"] = [];
  const minting = fakeMint();
  const code = await main(args, {
    checkout: w.checkout,
    connect: (given) => {
      assert.equal(given, storedToken(), "connected with a token other than the one in planner's folder");
      return github;
    },
    mint: minting.mint,
    // The bare repository stands in for github.com, which the real fetch and push reach with gh's token.
    fetch: async (repo, refspecs) => {
      assert.deepEqual(repo, REPO);
      await runGit(w.checkout, ["fetch", "-q", w.bare, ...refspecs]);
    },
    push: async (repo, refspec) => {
      pushes.push({ repo, refspec });
      await runGit(w.checkout, ["push", "-q", w.bare, refspec]);
    },
    stdout: stdout.write,
    stderr: stderr.write,
  });
  return { code, stdout: stdout.lines, stderr: stderr.lines, calls: github.calls, pushes, mints: minting.calls };
}

const head = (dir: string) => git(dir, "rev-parse", "HEAD").trim();
const tasksIn = (w: World) => readFileSync(join(w.checkout, SPEC, "tasks.md"), "utf8");
const writes = (run: Run) => writeCalls(run.calls).map((call) => (call.kind === "rest" ? `${call.method} ${call.path} ${JSON.stringify(call.body)}` : call.kind));

describe("land.ts <issue> <spec dir> <kind>: a landing", () => {
  it("of three stories creates US1-US3 as #p's sub-issues, chains them, labels tasks.md, commits as the App, pushes and opens one draft PR", async (t) => {
    const w = world(t);
    const state = gitHubState();
    const run = await land(w, state);
    assert.equal(run.code, 0, run.stderr.join("\n"));

    assert.deepEqual(writes(run), [
      `POST ${API_REPO}/issues {"title":"US1: ${STORIES[0]}","body":"Story 1 of #7; its tasks are in ${SPEC}/tasks.md."}`,
      `POST ${API_REPO}/issues/7/sub_issues {"sub_issue_id":9101}`,
      `POST ${API_REPO}/issues {"title":"US2: ${STORIES[1]}","body":"Story 2 of #7; its tasks are in ${SPEC}/tasks.md."}`,
      `POST ${API_REPO}/issues/7/sub_issues {"sub_issue_id":9102}`,
      `POST ${API_REPO}/issues/102/dependencies/blocked_by {"issue_id":9101}`,
      `POST ${API_REPO}/issues {"title":"US3: ${STORIES[2]}","body":"Story 3 of #7; its tasks are in ${SPEC}/tasks.md."}`,
      `POST ${API_REPO}/issues/7/sub_issues {"sub_issue_id":9103}`,
      `POST ${API_REPO}/issues/103/dependencies/blocked_by {"issue_id":9102}`,
      `POST ${API_REPO}/pulls {"title":"Spec of #7","head":"7-spec","base":"main","draft":true,"body":"The spec of #7, in \`${SPEC}\`, with its decision records."}`,
    ]);
    assert.deepEqual(state.blockedBy, [
      { issue: 102, blocker: 101 },
      { issue: 103, blocker: 102 },
    ]);
    assert.equal(tasksIn(w), tasksMd(3, [101, 101, 101, 102, 103, 103]));

    assert.deepEqual(run.pushes, [{ repo: REPO, refspec: `HEAD:refs/heads/${BRANCH}` }]);
    assert.equal(git(w.bare, "rev-parse", BRANCH).trim(), head(w.checkout));
    assert.deepEqual(git(w.bare, "diff", "--name-only", "main", BRANCH).trim().split("\n"), [
      "docs/adr/0001-retry-at-most-three-times.md",
      "planner/docs/adr/0011-count-retries-per-upload.md",
      `${SPEC}/plan.md`,
      `${SPEC}/spec.md`,
      `${SPEC}/tasks.md`,
    ]);
    assert.equal(git(w.bare, "show", `${BRANCH}:${SPEC}/tasks.md`), tasksIn(w));
    assert.equal(git(w.bare, "log", "-1", "--format=%an%n%ae%n%cn%n%ce", BRANCH), `${LOGIN}\n${EMAIL}\n${LOGIN}\n${EMAIL}\n`);
    assert.equal(git(w.bare, "rev-list", "--count", `main..${BRANCH}`).trim(), "1");

    assert.deepEqual(run.stdout.slice(-3), [`Spec folder: ${SPEC}`, `Branch: ${BRANCH}`, "Spec PR: https://github.com/acme/widgets/pull/50"]);
  });

  it("of one story creates no issue and labels every phase with #p", async (t) => {
    const w = world(t, tasksMd(1));
    const state = gitHubState();
    const run = await land(w, state);
    assert.equal(run.code, 0, run.stderr.join("\n"));
    assert.deepEqual(
      writes(run).map((call) => call.split(" ").slice(0, 2).join(" ")),
      [`POST ${API_REPO}/pulls`],
    );
    assert.equal(tasksIn(w), tasksMd(1, [P, P, P, P]));
    assert.equal(git(w.bare, "show", `${BRANCH}:${SPEC}/tasks.md`), tasksMd(1, [P, P, P, P]));
  });

  it("with the spec PR open pushes to its branch and opens no PR", async (t) => {
    const w = world(t);
    git(w.bare, "branch", BRANCH, "main");
    const state = gitHubState({ subIssues: [issue(101), issue(102), issue(103)], prs: [pr(60)] });
    const run = await land(w, state);
    assert.equal(run.code, 0, run.stderr.join("\n"));
    assert.deepEqual(writes(run), []);
    assert.deepEqual(run.pushes, [{ repo: REPO, refspec: `HEAD:refs/heads/${BRANCH}` }]);
    assert.equal(git(w.bare, "rev-parse", BRANCH).trim(), head(w.checkout));
    assert.deepEqual(run.stdout.slice(-3), [`Spec folder: ${SPEC}`, `Branch: ${BRANCH}`, "Spec PR: https://github.com/acme/widgets/pull/60"]);
  });

  it("with the spec PR closed unmerged and its branch deleted cuts the branch again and opens a new draft PR", async (t) => {
    const w = world(t);
    const state = gitHubState({ prs: [pr(40, { closed: true })] });
    const run = await land(w, state);
    assert.equal(run.code, 0, run.stderr.join("\n"));
    assert.equal(writes(run).filter((call) => call.startsWith(`POST ${API_REPO}/pulls `)).length, 1);
    assert.deepEqual(run.pushes, [{ repo: REPO, refspec: `HEAD:refs/heads/${BRANCH}` }]);
    assert.equal(git(w.bare, "rev-parse", BRANCH).trim(), head(w.checkout));
    assert.deepEqual(run.stdout.slice(-3), [`Spec folder: ${SPEC}`, `Branch: ${BRANCH}`, "Spec PR: https://github.com/acme/widgets/pull/50"]);
  });

  it("run again creates nothing, keeps every number and commits nothing", async (t) => {
    const w = world(t);
    const state = gitHubState();
    assert.equal((await land(w, state)).code, 0);
    const landed = head(w.checkout);
    const labelled = tasksIn(w);

    const again = await land(w, state);
    assert.equal(again.code, 0, again.stderr.join("\n"));
    assert.deepEqual(writes(again), []);
    assert.deepEqual(state.issues.map((one) => one.number), [101, 102, 103]);
    assert.equal(tasksIn(w), labelled);
    assert.equal(head(w.checkout), landed);
    assert.equal(git(w.bare, "rev-parse", BRANCH).trim(), landed);
    assert.deepEqual(again.stdout.slice(-3), [`Spec folder: ${SPEC}`, `Branch: ${BRANCH}`, "Spec PR: https://github.com/acme/widgets/pull/50"]);
  });

  it("creates only the missing stories, chaining the first new one to the last that exists", async (t) => {
    const w = world(t, tasksMd(3, [101, 101, 101]));
    const state = gitHubState({ subIssues: [issue(101)], next: 102 });
    const run = await land(w, state);
    assert.equal(run.code, 0, run.stderr.join("\n"));
    assert.deepEqual(
      writes(run).filter((call) => call.includes("/issues")).map((call) => call.split(" ").slice(0, 2).join(" ")),
      [
        `POST ${API_REPO}/issues`,
        `POST ${API_REPO}/issues/7/sub_issues`,
        `POST ${API_REPO}/issues/102/dependencies/blocked_by`,
        `POST ${API_REPO}/issues`,
        `POST ${API_REPO}/issues/7/sub_issues`,
        `POST ${API_REPO}/issues/103/dependencies/blocked_by`,
      ],
    );
    assert.deepEqual(state.blockedBy, [
      { issue: 102, blocker: 101 },
      { issue: 103, blocker: 102 },
    ]);
  });
});

describe("land.ts mints planner's token", () => {
  it("once when the stored token has 9 minutes left, and lands with the new one", async (t) => {
    const w = world(t, tasksMd(1));
    storeToken(9);
    const run = await land(w, gitHubState());
    assert.equal(run.code, 0, run.stderr.join("\n"));
    assert.deepEqual(run.mints, ["424242 acme/widgets"]);
  });

  it("never while the stored token has 11 minutes left", async (t) => {
    const w = world(t, tasksMd(1));
    storeToken(11);
    const run = await land(w, gitHubState());
    assert.equal(run.code, 0, run.stderr.join("\n"));
    assert.deepEqual(run.mints, []);
  });
});

describe("land.ts stops before its first write, exiting 1 and naming the next step", () => {
  function assertStops(w: World, run: Run, named: readonly string[]): void {
    assert.equal(run.code, 1, `exit ${run.code}: ${run.stderr.join("\n")}`);
    assert.deepEqual(writes(run), [], "a write call was made");
    assert.deepEqual(run.pushes, [], "a push was made");
    assert.ok(run.stderr.length > 0, "no line names the next step");
    for (const line of run.stderr) assert.match(line, /Next step: /);
    for (const part of named) assert.ok(run.stderr.join("\n").includes(part), `stderr does not name ${part}: ${run.stderr.join("\n")}`);
    assert.equal(git(w.checkout, "rev-list", "--count", "HEAD").trim(), "1", "a commit was made");
    assert.equal(git(w.checkout, "diff", "--cached", "--name-only"), "", "a path was staged");
    assert.equal(tasksIn(w), w.tasks, "tasks.md was written");
  }

  it("for kind rescope, naming #178", async (t) => {
    const w = world(t);
    const run = await land(w, gitHubState(), [String(P), SPEC, "rescope"]);
    assertStops(w, run, ["#178"]);
  });

  it("for several specs/<p>-* folders once the spec folder is in, naming them", async (t) => {
    // Unchanged since the merge base, so the stop after this one names specs/7-older alone, never the spec folder.
    const w = world(t, tasksMd(3), { "specs/7-older/spec.md": "# older\n" });
    const run = await land(w, gitHubState());
    assertStops(w, run, ["specs/7-older", SPEC]);
  });

  it("for a spec folder of #p already on the default branch, naming it", async (t) => {
    const w = world(t);
    pushFromElsewhere(w, "main", "main", { "specs/7-earlier/spec.md": "# earlier\n" });
    const run = await land(w, gitHubState());
    assertStops(w, run, ["specs/7-earlier", "#178"]);
  });

  it("for paths committed or staged since the merge base outside the spec folder and docs/adr/, naming them", async (t) => {
    const w = world(t);
    git(w.checkout, "commit", "-q", "-am", "edit the readme");
    writeFiles(w.checkout, { "src/app.ts": "export {};\n" });
    git(w.checkout, "add", "src/app.ts");
    const run = await land(w, gitHubState());
    assert.equal(run.code, 1, run.stderr.join("\n"));
    assert.deepEqual(writes(run), []);
    assert.deepEqual(run.pushes, []);
    for (const path of ["README.md", "src/app.ts"]) assert.ok(run.stderr.join("\n").includes(path), run.stderr.join("\n"));
    assert.ok(!run.stderr.join("\n").includes("notes.txt"), "a stray file that is not committed was named");
  });

  it("for a spec PR closed unmerged whose branch exists, naming the branch to delete", async (t) => {
    const w = world(t);
    git(w.bare, "branch", BRANCH, "main");
    const run = await land(w, gitHubState({ prs: [pr(40, { closed: true })] }));
    assertStops(w, run, [`delete branch ${BRANCH}`]);
  });

  it("for a spec PR merged, saying the spec is on the default branch and naming #178", async (t) => {
    const w = world(t);
    const run = await land(w, gitHubState({ prs: [pr(40, { closed: true, merged: true })] }));
    assertStops(w, run, ["default branch", "#178"]);
  });

  it("for an open spec PR whose origin/<p>-spec is not an ancestor of HEAD, naming the branch to check out", async (t) => {
    const w = world(t);
    pushFromElsewhere(w, "main", BRANCH, { [`${SPEC}/spec.md`]: "# written elsewhere\n" });
    const run = await land(w, gitHubState({ prs: [pr(60)] }));
    assertStops(w, run, [`check out ${BRANCH}`]);
  });

  it("for more sub-issues than stories, naming the extra ones", async (t) => {
    const w = world(t);
    const run = await land(w, gitHubState({ subIssues: [issue(101), issue(102), issue(103), issue(104), issue(105)] }));
    assertStops(w, run, ["#104", "#105"]);
  });

  it("for a one-story spec whose #p has sub-issues, naming them", async (t) => {
    const w = world(t, tasksMd(1));
    const run = await land(w, gitHubState({ subIssues: [issue(101), issue(102)] }));
    assertStops(w, run, ["#101", "#102"]);
  });

  it("for a sub-issue in another repository, naming it", async (t) => {
    const w = world(t);
    const foreign = issue(102, "US: elsewhere", "https://api.github.com/repos/acme/gadgets");
    const run = await land(w, gitHubState({ subIssues: [issue(101), foreign] }));
    assertStops(w, run, ["acme/gadgets#102"]);
  });

  it("for a sub-issue at position i other than the issue tasks.md labels US<i+1> with, naming both", async (t) => {
    const w = world(t, tasksMd(3, [101, 101, 101, 102, 103, 103]));
    const run = await land(w, gitHubState({ subIssues: [issue(101), issue(120), issue(103)] }));
    assertStops(w, run, ["#120", "#102", "US2"]);
  });
});

describe("land.ts could not run, exiting 2", () => {
  it("when a story issue was created but not added to #p's sub-issues, naming the issue and both links to make", async (t) => {
    const w = world(t);
    const state = gitHubState({ unanswered: (call) => (bodyOf(call).sub_issue_id === 9102 ? new GitHubUnanswered("dummy: the connection closed") : undefined) });
    const run = await land(w, state);
    assert.equal(run.code, 2, run.stderr.join("\n"));
    assert.deepEqual(state.issues.map((one) => one.number), [101, 102]);
    assert.deepEqual(state.subIssues.map((one) => one.number), [101]);
    const said = run.stderr.join("\n");
    for (const part of ["#102", "US2", "#7's sub-issues", "blocked by #101", "dummy: the connection closed", "Next step:"]) {
      assert.ok(said.includes(part), `stderr does not name ${part}: ${said}`);
    }
    assert.deepEqual(run.pushes, []);
  });

  it("when a story issue is #p's sub-issue but not blocked by the story before it, naming both", async (t) => {
    const w = world(t);
    const state = gitHubState({ unanswered: (call) => (call.kind === "rest" && call.path === `${API_REPO}/issues/102/dependencies/blocked_by` ? new GitHubUnanswered("dummy: the connection closed") : undefined) });
    const run = await land(w, state);
    assert.equal(run.code, 2, run.stderr.join("\n"));
    assert.deepEqual(state.subIssues.map((one) => one.number), [101, 102]);
    assert.deepEqual(state.blockedBy, []);
    const said = run.stderr.join("\n");
    for (const part of ["#102", "US2", "blocked by #101", "dummy: the connection closed", "Next step:"]) {
      assert.ok(said.includes(part), `stderr does not name ${part}: ${said}`);
    }
    assert.ok(!said.includes("sub-issues"), said);
    assert.deepEqual(run.pushes, []);
  });


  for (const args of [["7", SPEC], ["7", SPEC, "fresh"], ["0", SPEC, "new"], ["7", "specs/8-other", "new"], ["7", "docs/7-retry-budget", "new"], ["7", "specs/7-absent", "new"]]) {
    it(`for the arguments ${JSON.stringify(args)}, calling no GitHub`, async (t) => {
      const w = world(t);
      // Folders that hold a tasks.md but are no spec folder of #7, so only the spec dir's shape refuses them.
      writeFiles(w.checkout, { "specs/8-other/tasks.md": tasksMd(3), "docs/7-retry-budget/tasks.md": tasksMd(3) });
      const run = await land(w, gitHubState(), args);
      assert.equal(run.code, 2, run.stderr.join("\n"));
      assert.deepEqual(run.calls, []);
    });
  }
});
