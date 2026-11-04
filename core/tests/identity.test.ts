import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";

import { runGit } from "../src/git.ts";
import {
  DerivationError,
  doneFrom,
  isDone,
  issueStory,
  parseBranch,
  pickSpecFolder,
  pickSpecPrs,
  pickStoryBranch,
  pickStoryPr,
  requirement,
  specBranch,
  specFolder,
  specFolderAnswer,
  specIssue,
  specPr,
  specPrs,
  storyPr,
  type IssueClose,
  type PullRequestHead,
  type PullRequestState,
} from "../src/identity.ts";
import { gitTree, NotInTree, type Tree, type TreeEntry } from "../src/tree.ts";
import { fakeGitHub, type FakeCall, type FakeRoutes } from "./support/fake-github.ts";

const REPO = "acme/widgets";
const REPO_ID = "R_widgets";
const BRANCH = "212-us2-retry-budget";
const ORCHESTRATOR_APP = { __typename: "Bot", login: "codeworks-orchestrator" };

function sha(n: number): string {
  return n.toString(16).padStart(40, "0");
}

function derivationError(...named: string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof DerivationError, `expected DerivationError, got ${String(error)}`);
    for (const part of named) assert.ok(error.message.includes(part), `"${part}" not named in: ${error.message}`);
    return true;
  };
}

function inRepo(vars: Record<string, unknown>): boolean {
  return vars.owner === "acme" && vars.name === "widgets";
}

function queries(calls: FakeCall[]): string[] {
  return calls.flatMap((call) => (call.kind === "graphql" || call.kind === "graphqlPages" ? [call.query] : []));
}

/** A tree of the given files at one ref, as `gitTree` and `gitHubTree` answer. */
function memoryTree(files: Record<string, string>, ref = "fixture-ref"): Tree {
  return {
    async listDir(path) {
      const entries = new Map<string, boolean>();
      for (const file of Object.keys(files)) {
        if (!file.startsWith(`${path}/`)) continue;
        const [name, ...below] = file.slice(path.length + 1).split("/");
        entries.set(name, entries.get(name) === true || below.length > 0);
      }
      if (entries.size === 0) throw new NotInTree(path, ref, "directory");
      return [...entries]
        .map(([name, isDir]): TreeEntry => ({ name, isDir }))
        .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    },
    async readText(path) {
      if (!Object.hasOwn(files, path)) throw new NotInTree(path, ref, "file");
      return files[path];
    },
  };
}

function specMd(kind: string, body = "# Feature Specification: retry budget\n"): string {
  return `---\ncodeworks:\n  v: 1\n  kind: ${kind}\n  root_cause:\n    observed: none\n---\n${body}`;
}

describe("specIssue", () => {
  function issueAnswer(parent: unknown): FakeRoutes {
    return {
      graphql: [
        {
          when: (query, vars) => query.includes("parent") && inRepo(vars) && vars.number === 212,
          answer: { repository: { id: REPO_ID, issue: { parent } } },
        },
        {
          when: (query, vars) => query.includes("parent") && inRepo(vars) && vars.number === 145,
          answer: { repository: { id: REPO_ID, issue: { parent: null } } },
        },
      ],
    };
  }

  it("is the story issue's parent when it has one", async () => {
    const reader = fakeGitHub(issueAnswer({ number: 200, repository: { id: REPO_ID, nameWithOwner: REPO } }));
    assert.equal(await specIssue(reader, REPO, 212), 200);
  });

  it("is the story issue itself when it has no parent", async () => {
    const reader = fakeGitHub(issueAnswer(null));
    assert.equal(await specIssue(reader, REPO, 145), 145);
  });

  it("fails naming a parent in another repository", async () => {
    const reader = fakeGitHub(issueAnswer({ number: 200, repository: { id: "R_other", nameWithOwner: "acme/other" } }));
    await assert.rejects(specIssue(reader, REPO, 212), derivationError("212", "acme/other#200"));
  });

  it("reads only the immediate parent, never the parent's parent", async () => {
    const grandparent = { number: 100, repository: { id: REPO_ID, nameWithOwner: REPO } };
    const reader = fakeGitHub(
      issueAnswer({ number: 200, repository: { id: REPO_ID, nameWithOwner: REPO }, parent: grandparent }),
    );
    assert.equal(await specIssue(reader, REPO, 212), 200);
    const asked = queries(reader.calls);
    assert.equal(asked.length, 1);
    assert.equal(asked[0].match(/\bparent\b/g)?.length, 1, asked[0]);
  });
});

describe("pickSpecFolder", () => {
  it("is the one folder named <p>-*", () => {
    const names = ["300-cache-warmup", "20-short", "200-retry-budget", "2000-other"];
    assert.equal(pickSpecFolder(names, 200), "specs/200-retry-budget");
  });

  it("fails naming the folders found when none is named <p>-*", () => {
    assert.throws(() => pickSpecFolder(["300-cache-warmup", "2000-other", "200"], 200), derivationError(
      "200",
      "300-cache-warmup",
      "2000-other",
    ));
  });

  it("fails naming each folder when several are named <p>-*", () => {
    assert.throws(
      () => pickSpecFolder(["300-cache-warmup", "200-retry", "200-retry-budget"], 200),
      derivationError("specs/200-retry", "specs/200-retry-budget"),
    );
  });
});

describe("specFolderAnswer", () => {
  it("is the one folder named <p>-*", () => {
    assert.deepEqual(specFolderAnswer(["300-cache-warmup", "20-short", "200-retry-budget", "2000-other"], 200), {
      one: "specs/200-retry-budget",
    });
  });

  it("is none when no folder is named <p>-*", () => {
    assert.deepEqual(specFolderAnswer(["300-cache-warmup", "2000-other", "200"], 200), { none: true });
    assert.deepEqual(specFolderAnswer([], 200), { none: true });
  });

  it("is several, naming each, when more than one folder is named <p>-*", () => {
    assert.deepEqual(specFolderAnswer(["300-cache-warmup", "200-retry", "200-retry-budget"], 200), {
      several: ["specs/200-retry", "specs/200-retry-budget"],
    });
  });
});

describe("specBranch", () => {
  for (const p of [1, 145, 9007199254740991]) {
    it(`parses back to the spec of #${p}`, () => {
      assert.deepEqual(parseBranch(specBranch(p)), { spec: p });
    });
  }

  for (const p of [0, -1, 1.5]) {
    it(`refuses ${p}, which is no issue number`, () => {
      assert.throws(() => specBranch(p), TypeError);
    });
  }
});

describe("pickSpecPrs", () => {
  function pr(number: number, headRefName: string, over: Partial<PullRequestState> = {}): PullRequestState {
    return { number, headRefName, isCrossRepository: false, closed: false, merged: false, mergeCommit: null, ...over };
  }

  it("is every same-repository PR headed <p>-spec, newest first; a fork's or another head's is not the spec's", () => {
    const prs = [
      pr(150, "145-spec", { closed: true, merged: true, mergeCommit: { oid: sha(150) } }),
      pr(170, "145-spec"),
      pr(160, "145-spec", { closed: true }),
      pr(180, "145-spec", { isCrossRepository: true }),
      pr(190, "145-us1-retry"),
      pr(195, "1450-spec"),
    ];
    assert.deepEqual(pickSpecPrs(prs, 145), [
      { number: 170, state: "open", mergeCommit: null },
      { number: 160, state: "closed", mergeCommit: null },
      { number: 150, state: "merged", mergeCommit: { oid: sha(150) } },
    ]);
  });

  for (const [state, over, mergeCommit] of [
    ["open", {}, null],
    ["closed", { closed: true }, null],
    ["merged", { closed: true, merged: true, mergeCommit: { oid: sha(170) } }, { oid: sha(170) }],
  ] as const) {
    it(`maps a PR that is ${state} to ${state}`, () => {
      assert.deepEqual(pickSpecPrs([pr(170, "145-spec", over)], 145), [{ number: 170, state, mergeCommit }]);
    });
  }

  it("is empty when no same-repository PR is headed <p>-spec", () => {
    assert.deepEqual(pickSpecPrs([], 145), []);
    assert.deepEqual(pickSpecPrs([pr(180, "145-spec", { isCrossRepository: true }), pr(190, "146-spec")], 145), []);
  });
});

describe("specPrs and specPr", () => {
  const nodes = [
    { number: 150, headRefName: "145-spec", isCrossRepository: false, closed: true, merged: true, mergeCommit: { oid: sha(150) } },
    { number: 160, headRefName: "145-spec", isCrossRepository: true, closed: false, merged: false, mergeCommit: null },
    { number: 170, headRefName: "145-spec", isCrossRepository: false, closed: true, merged: false, mergeCommit: null },
  ];
  const reader = () =>
    fakeGitHub({
      graphqlPages: [
        { when: (query, vars) => query.includes("pullRequests") && inRepo(vars) && vars.branch === "145-spec", answer: nodes },
        { when: (query, vars) => query.includes("pullRequests") && inRepo(vars) && vars.branch === "146-spec", answer: [] },
      ],
    });

  it("specPrs reads the PRs headed <p>-spec once and answers every same-repository one, newest first", async () => {
    const client = reader();
    assert.deepEqual(await specPrs(client, REPO, 145), [
      { number: 170, state: "closed", mergeCommit: null },
      { number: 150, state: "merged", mergeCommit: { oid: sha(150) } },
    ]);
    assert.equal(client.calls.length, 1);
  });

  it("specPr answers the newest of them, and null when there is none", async () => {
    assert.deepEqual(await specPr(reader(), REPO, 145), { number: 170, state: "closed", mergeCommit: null });
    assert.equal(await specPr(reader(), REPO, 146), null);
  });
});

describe("specPr's merge commit", () => {
  function onSpecBranch(over: Record<string, unknown>) {
    const node = {
      number: 170,
      headRefName: "145-spec",
      headRefOid: sha(1170),
      isCrossRepository: false,
      closed: false,
      merged: false,
      mergeCommit: null,
      ...over,
    };
    return fakeGitHub({
      graphqlPages: [
        { when: (query, vars) => query.includes("pullRequests") && inRepo(vars) && vars.branch === "145-spec", answer: [node] },
      ],
    });
  }
  const MERGED = { closed: true, merged: true, mergeCommit: { oid: sha(170) } };

  for (const [state, over] of [
    ["open", {}],
    ["closed", { closed: true }],
  ] as const) {
    it(`refuses a PR that is ${state} yet holds a merge commit`, async () => {
      await assert.rejects(specPr(onSpecBranch({ ...over, mergeCommit: { oid: sha(170) } }), REPO, 145), /not the shape asked for/);
    });
  }

  it("is the oid of a merged PR's mergeCommit, not of its head", async () => {
    assert.deepEqual(await specPr(onSpecBranch(MERGED), REPO, 145), {
      number: 170,
      state: "merged",
      mergeCommit: { oid: sha(170) },
    });
  });

  it("refuses a merge commit whose oid is no 40-hex commit id", async () => {
    const client = onSpecBranch({ ...MERGED, mergeCommit: { oid: "HEAD" } });
    await assert.rejects(specPr(client, REPO, 145), /not the shape asked for/);
  });

  it("is read in the one query that reads the PR's merged state", async () => {
    const client = onSpecBranch(MERGED);
    await specPr(client, REPO, 145);
    const asked = queries(client.calls);
    assert.equal(asked.length, 1);
    assert.match(asked[0], /\bmerged\b/);
    assert.match(asked[0], /\bmergeCommit\s*\{\s*oid\s*\}/);
  });
});

describe("specFolder", () => {
  it("picks among the folders of specs/ at the ref; a file is no folder", async () => {
    const tree = memoryTree({
      "specs/300-cache-warmup/spec.md": "x",
      "specs/200-retry-budget/spec.md": "x",
      "specs/200-retry-notes.md": "x",
    });
    assert.equal(await specFolder(tree, 200), "specs/200-retry-budget");
  });

  it("fails as finding none when the ref has no specs/ folder", async () => {
    await assert.rejects(specFolder(memoryTree({ "README.md": "x" }), 200), derivationError("200", "specs"));
  });

  describe("a folder renamed by a rescope", () => {
    let scratch: string;
    let repo: string;
    let beforeRescope: string;
    let afterRescope: string;
    const savedEnv = { HOME: process.env.HOME, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME };
    const COMMITTER = ["-c", "user.name=Dummy Author", "-c", "user.email=dummy@example.invalid"];

    before(async () => {
      scratch = mkdtempSync(join(tmpdir(), "core-identity-"));
      repo = join(scratch, "repo");
      // git reads ignore and attributes files under HOME even with no global config.
      process.env.HOME = join(scratch, "home");
      process.env.XDG_CONFIG_HOME = join(scratch, "home", ".config");
      mkdirSync(join(repo, "specs", "212-retry-budget"), { recursive: true });
      await runGit(repo, ["init", "-q"]);
      writeFileSync(join(repo, "specs", "212-retry-budget", "spec.md"), specMd("feature"));
      await runGit(repo, ["add", "-A"]);
      await runGit(repo, [...COMMITTER, "commit", "-q", "-m", "spec"]);
      beforeRescope = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
      await runGit(repo, ["mv", "specs/212-retry-budget", "specs/200-retry-budget"]);
      await runGit(repo, [...COMMITTER, "commit", "-q", "-m", "rescope"]);
      afterRescope = (await runGit(repo, ["rev-parse", "HEAD"])).stdout.trim();
    });

    after(() => {
      for (const name of ["HOME", "XDG_CONFIG_HOME"] as const) {
        const value = savedEnv[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      rmSync(scratch, { recursive: true, force: true });
    });

    it("is read at the ref asked about", async () => {
      assert.equal(await specFolder(gitTree(repo, beforeRescope), 212), "specs/212-retry-budget");
      await assert.rejects(specFolder(gitTree(repo, beforeRescope), 200), derivationError("200"));
      assert.equal(await specFolder(gitTree(repo, afterRescope), 200), "specs/200-retry-budget");
      await assert.rejects(specFolder(gitTree(repo, afterRescope), 212), derivationError("212"));
    });
  });
});

describe("pickStoryPr", () => {
  function head(number: number, headRefName: string, over: Partial<PullRequestHead> = {}): PullRequestHead {
    return { number, headRefName, headRefOid: sha(number), isCrossRepository: false, merged: false, ...over };
  }

  it("is the newest same-repo PR on the branch; a fork PR of that head name is not the story's", () => {
    const prs = [
      head(251, BRANCH),
      head(213, BRANCH, { merged: true }),
      head(260, BRANCH, { isCrossRepository: true }),
      head(230, BRANCH),
      head(270, "fix-retry"),
    ];
    assert.deepEqual(pickStoryPr(prs, BRANCH), { number: 251, head: sha(251), merged: false });
  });

  it("is null when only a fork PR has the head name", () => {
    assert.equal(pickStoryPr([head(260, BRANCH, { isCrossRepository: true })], BRANCH), null);
  });

  it("is null for a branch that is no story", () => {
    assert.equal(pickStoryPr([head(5, "main")], "main"), null);
    assert.equal(pickStoryPr([head(6, "145-spec")], "145-spec"), null);
  });
});

describe("storyPr", () => {
  const nodes = [
    { number: 213, headRefName: BRANCH, headRefOid: sha(213), isCrossRepository: false, merged: false, body: "first try" },
    { number: 251, headRefName: BRANCH, headRefOid: sha(251), isCrossRepository: false, merged: true, body: "" },
    { number: 230, headRefName: BRANCH, headRefOid: sha(230), isCrossRepository: false, merged: false, body: "" },
    { number: 260, headRefName: BRANCH, headRefOid: sha(260), isCrossRepository: true, merged: false, body: "a fork" },
    { number: 270, headRefName: "fix-retry", headRefOid: sha(270), isCrossRepository: false, merged: true, body: "Closes #212" },
  ];
  const routes: FakeRoutes = {
    graphqlPages: [
      { when: (query, vars) => query.includes("pullRequests") && inRepo(vars) && vars.branch === BRANCH, answer: nodes },
    ],
  };

  it("reads the PRs whose head is the branch and picks the newest same-repo one", async () => {
    assert.deepEqual(await storyPr(fakeGitHub(routes), REPO, BRANCH), { number: 251, head: sha(251), merged: true });
  });

  it("never reads a PR body or its closing references", async () => {
    const reader = fakeGitHub(routes);
    await storyPr(reader, REPO, BRANCH);
    for (const query of queries(reader.calls)) assert.doesNotMatch(query, /\bbody\b|closingIssuesReferences/);
  });

  it("is null, asking GitHub nothing, for a branch that is no story", async () => {
    const reader = fakeGitHub({});
    assert.equal(await storyPr(reader, REPO, "main"), null);
    assert.equal(await storyPr(reader, REPO, "feature/x"), null);
    assert.deepEqual(reader.calls, []);
  });
});

describe("pickStoryBranch", () => {
  it("is the one branch of story <s>; another story's, the spec's or one off the grammar is not", () => {
    const names = ["212-usx", "212-us-retry", "2120-us1-retry", "213-us1-retry", "212-spec", "212-us2-Retry", BRANCH];
    assert.equal(pickStoryBranch(names, 212), BRANCH);
  });

  it("is null when no branch is story <s>'s", () => {
    assert.equal(pickStoryBranch([], 212), null);
    assert.equal(pickStoryBranch(["213-us1-retry", "212-spec"], 212), null);
  });

  it("fails naming each branch when several are story <s>'s, whatever their <k>", () => {
    assert.throws(() => pickStoryBranch(["212-us1-retry", BRANCH], 212), derivationError("#212", "212-us1-retry", BRANCH));
  });
});

describe("issueStory", () => {
  const ref = (branch: string) => ({ ref: `refs/heads/${branch}`, node_id: `REF_${branch}`, object: { sha: sha(1), type: "commit" } });
  const prs = [{ number: 251, headRefName: BRANCH, headRefOid: sha(251), isCrossRepository: false, merged: false }];

  function routes(refs: unknown[], onBranch: unknown[] = prs): FakeRoutes {
    return {
      restPages: { "/repos/acme/widgets/git/matching-refs/heads/212-us": refs },
      graphqlPages: [
        { when: (query, vars) => query.includes("pullRequests") && inRepo(vars) && vars.branch === BRANCH, answer: onBranch },
      ],
    };
  }

  const kinds = (calls: FakeCall[]) => calls.map((call) => call.kind);

  it("reads the branches starting <s>-us, then the story PR on the one that is the story's", async () => {
    const reader = fakeGitHub(routes([ref("212-usx"), ref(BRANCH)]));
    assert.deepEqual(await issueStory(reader, REPO, 212), {
      branch: BRANCH,
      pr: { number: 251, head: sha(251), merged: false },
    });
  });

  it("names the branch with no PR before one is opened", async () => {
    assert.deepEqual(await issueStory(fakeGitHub(routes([ref(BRANCH)], [])), REPO, 212), { branch: BRANCH, pr: null });
  });

  it("is null, reading no PR, when GitHub holds no branch of the story", async () => {
    const reader = fakeGitHub(routes([ref("212-usx")]));
    assert.equal(await issueStory(reader, REPO, 212), null);
    assert.deepEqual(kinds(reader.calls), ["restPages"]);
  });

  it("fails naming each branch, reading no PR, when several are the story's", async () => {
    const reader = fakeGitHub(routes([ref("212-us1-retry"), ref(BRANCH)]));
    await assert.rejects(issueStory(reader, REPO, 212), derivationError("212-us1-retry", BRANCH));
    assert.deepEqual(kinds(reader.calls), ["restPages"]);
  });

  it("refuses an answer naming a ref that is no branch", async () => {
    const reader = fakeGitHub(routes([{ ...ref(BRANCH), ref: `refs/tags/${BRANCH}` }]));
    await assert.rejects(issueStory(reader, REPO, 212), /not the shape asked for/);
  });

  for (const s of [0, -1, 1.5]) {
    it(`refuses ${s}, which is no issue number, asking GitHub nothing`, async () => {
      const reader = fakeGitHub({});
      await assert.rejects(issueStory(reader, REPO, s), TypeError);
      assert.deepEqual(reader.calls, []);
    });
  }
});

describe("requirement", () => {
  const FOLDER = "specs/200-retry-budget";
  const ISSUE_BODY = "Retry a failed upload at most three times.";

  for (const kind of ["feature", "defect"]) {
    it(`is the folder's spec.md for kind ${kind}`, async () => {
      const text = specMd(kind);
      const tree = memoryTree({ [`${FOLDER}/spec.md`]: text });
      assert.deepEqual(await requirement(tree, FOLDER, ISSUE_BODY), { kind, text, source: `${FOLDER}/spec.md` });
    });
  }

  it("is the story issue's body for kind no_spec", async () => {
    const tree = memoryTree({ [`${FOLDER}/spec.md`]: specMd("no_spec", "# Premise only\n") });
    assert.deepEqual(await requirement(tree, FOLDER, ISSUE_BODY), {
      kind: "no_spec",
      text: ISSUE_BODY,
      source: "story issue body",
    });
  });

  it("fails naming the file when spec.md has no facts", async () => {
    const tree = memoryTree({ [`${FOLDER}/spec.md`]: "# Feature Specification: retry budget\n" });
    await assert.rejects(requirement(tree, FOLDER, ISSUE_BODY), derivationError(`${FOLDER}/spec.md`, "no front matter"));
  });

  it("fails naming the file and the error when the facts are refused", async () => {
    const tree = memoryTree({ [`${FOLDER}/spec.md`]: specMd("bug") });
    await assert.rejects(requirement(tree, FOLDER, ISSUE_BODY), derivationError(`${FOLDER}/spec.md`, "kind"));
  });
});

describe("doneFrom", () => {
  it("is done when one of the story's PRs merged", () => {
    assert.equal(doneFrom([{ merged: false }, { merged: true }], []), true);
  });

  it("is not done with no merged PR and no close", () => {
    assert.equal(doneFrom([{ merged: false }], []), false);
  });

  for (const role of ["admin", "maintain", "write"]) {
    it(`is done when a User with ${role} permission closed the issue`, () => {
      assert.equal(doneFrom([], [{ actorType: "User", role }]), true);
    });
  }

  const notAdmin: [string, IssueClose][] = [
    ["a User with triage permission", { actorType: "User", role: "triage" }],
    ["a User with read permission", { actorType: "User", role: "read" }],
    ["a User with no permission", { actorType: "User", role: "none" }],
    ["a User whose permission is unknown", { actorType: "User", role: null }],
    ["an App, whatever its role", { actorType: "Bot", role: "admin" }],
    ["a deleted account", { actorType: null, role: null }],
  ];
  for (const [who, close] of notAdmin) {
    it(`is not done when ${who} closed the issue`, () => {
      assert.equal(doneFrom([{ merged: false }], [close]), false);
    });
  }
});

describe("isDone", () => {
  const user = (login: string) => ({ __typename: "User", login });
  const pr = (number: number, headRefName: string, over: Record<string, unknown> = {}) => ({
    __typename: "PullRequest",
    number,
    headRefName,
    merged: true,
    isCrossRepository: false,
    repository: { id: REPO_ID },
    ...over,
  });
  const closed = (actor: unknown, closer: unknown = null) => ({ __typename: "ClosedEvent", actor, closer });
  const crossReferenced = (source: unknown) => ({ __typename: "CrossReferencedEvent", source });
  const connected = (subject: unknown) => ({ __typename: "ConnectedEvent", subject });

  const ROLES: Record<string, { permission: string; role_name: string }> = {
    alice: { permission: "admin", role_name: "admin" },
    mona: { permission: "write", role_name: "maintain" },
    wes: { permission: "write", role_name: "write" },
    tess: { permission: "read", role_name: "triage" },
    reed: { permission: "read", role_name: "read" },
    nobody: { permission: "none", role_name: "none" },
  };

  function timeline(items: unknown[]): FakeRoutes {
    return {
      graphql: [{ when: (query, vars) => !query.includes("timelineItems") && inRepo(vars), answer: { repository: { id: REPO_ID } } }],
      graphqlPages: [
        { when: (query, vars) => query.includes("timelineItems") && inRepo(vars) && vars.number === 212, answer: items },
      ],
      rest: Object.fromEntries(
        Object.entries(ROLES).map(([login, role]) => [`GET /repos/acme/widgets/collaborators/${login}/permission`, role]),
      ),
    };
  }

  it("is done when the story's PR, the closer, merged", async () => {
    assert.equal(await isDone(fakeGitHub(timeline([closed(ORCHESTRATOR_APP, pr(251, BRANCH))])), REPO, 212), true);
  });

  for (const [login, role] of [
    ["alice", "admin"],
    ["mona", "maintain"],
    ["wes", "write"],
  ]) {
    it(`is done when a User with ${role} permission closed it`, async () => {
      const reader = fakeGitHub(timeline([closed(user(login))]));
      assert.equal(await isDone(reader, REPO, 212), true);
      assert.ok(reader.calls.some((call) => call.kind === "rest" && call.path.includes(`/collaborators/${login}/permission`)));
    });
  }

  for (const [login, role] of [
    ["tess", "triage"],
    ["reed", "read"],
    ["nobody", "no"],
  ]) {
    it(`is not done when a User with ${role} permission closed it`, async () => {
      assert.equal(await isDone(fakeGitHub(timeline([closed(user(login))])), REPO, 212), false);
    });
  }

  it("is not done when a codeworks App closed it with the story's PR unmerged, and an App's permission is never read", async () => {
    const reader = fakeGitHub(timeline([crossReferenced(pr(251, BRANCH, { merged: false })), closed(ORCHESTRATOR_APP)]));
    assert.equal(await isDone(reader, REPO, 212), false);
    assert.ok(reader.calls.every((call) => call.kind !== "rest"));
  });

  it("stays done once reopened: it is read from the close history, never from the issue's state", async () => {
    const reader = fakeGitHub(timeline([closed(user("alice"))]));
    assert.equal(await isDone(reader, REPO, 212), true);
    for (const query of queries(reader.calls)) assert.doesNotMatch(query, /REOPENED_EVENT|\bstate\b|\bclosed\b/);
  });

  for (const [how, item] of [
    ["the ClosedEvent's closer", closed(ORCHESTRATOR_APP, pr(251, BRANCH))],
    ["a CrossReferencedEvent", crossReferenced(pr(251, BRANCH))],
    ["a ConnectedEvent", connected(pr(251, BRANCH))],
  ] as const) {
    it(`is done with a merged PR found only from ${how}, its branch deleted and an App the closer`, async () => {
      const items = item.__typename === "ClosedEvent" ? [item] : [item, closed(ORCHESTRATOR_APP)];
      assert.equal(await isDone(fakeGitHub(timeline(items)), REPO, 212), true);
    });
  }

  for (const [why, candidate] of [
    ["unmerged", pr(251, BRANCH, { merged: false })],
    ["from a fork", pr(251, BRANCH, { isCrossRepository: true })],
    ["in another repository", pr(9, BRANCH, { repository: { id: "R_other" } })],
    ["on another story's branch", pr(251, "213-us2-retry-budget")],
    ["on the spec's branch", pr(251, "212-spec")],
    ["on a branch that is no story", pr(251, "fix-212-retry")],
  ] as const) {
    it(`never counts a timeline PR ${why}`, async () => {
      for (const items of [
        [closed(ORCHESTRATOR_APP, candidate)],
        [crossReferenced(candidate), closed(ORCHESTRATOR_APP, { __typename: "Commit" })],
        [connected(candidate), closed(ORCHESTRATOR_APP)],
      ]) {
        assert.equal(await isDone(fakeGitHub(timeline(items)), REPO, 212), false, JSON.stringify(items));
      }
    });
  }
});
