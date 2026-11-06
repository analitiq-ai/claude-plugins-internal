// Anything this script needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs. Type imports are erased, so they load nothing.
import "../lib/guarded.ts";

import type { GitHubClient, Repository } from "../core/github.ts";
import type { SpecPr } from "../core/identity.ts";
import type { Mint } from "../lib/github.ts";
import type { Story, StoryIssue as StoryIssueType } from "../lib/story-plan.ts";

const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
const { join, posix } = await import("node:path");
const { z } = await import("zod");
const { readTaskBlockLabels, taskBlockLabel, TaskBlockLabelRefused } = await import("../core/contracts/tasks.ts");
const { GhFolderRefused } = await import("../core/gh-config.ts");
const { fetchWithGhCredential, GhCredentialRefused, GitFailed, pushWithGhCredential, runGit } = await import("../core/git.ts");
const { answerOf, gitHub, GitHubPartlyAnswered, GitHubRefused, GitHubUnanswered, RemoteRefused } = await import("../core/github.ts");
const { specBranch, specFolderAnswer, specPr } = await import("../core/identity.ts");
const { KeyReadRefused } = await import("../core/keys.ts");
const { SettingsError } = await import("../core/settings.ts");
const { MintError } = await import("../core/tokens.ts");
const { gitTree, isPlainPath, NotInTree } = await import("../core/tree.ts");
const { mintPlannerToken, NoOrigin, originRepository, plannerGitHub, readRepository, readSubIssues, repositoryPath } = await import("../lib/github.ts");
const { ghFolder, readPlannerSettings } = await import("../lib/settings.ts");
const { phasesOf, StoryIssue, storyPlan, subIssueProblem, TasksRefused } = await import("../lib/story-plan.ts");

export type LandIo = {
  /** The checkout's top folder; the spec folder is relative to it. */
  checkout: string;
  connect: (token: string) => GitHubClient;
  /** Fetches each refspec from `repo` into the remote-tracking ref it names. */
  fetch: (repo: Repository, refspecs: readonly string[]) => Promise<void>;
  push: (repo: Repository, refspec: string) => Promise<void>;
  mint: Mint;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

/** The run stops before its first write; each line names the next step. */
class Stopped extends Error {
  readonly lines: readonly string[];

  constructor(lines: readonly string[]) {
    super(lines.join("\n"));
    this.name = "Stopped";
    this.lines = lines;
  }
}

function stop(...lines: string[]): never {
  throw new Stopped(lines);
}

/**
 * `text` with `Story issue: #<n>` directly under each phase heading, `issues[k - 1]` being story k's: a story's
 * phases get its own, phases before the first story's get US1's, and any other its last story phase's. An
 * existing label is replaced.
 */
export function labelTasks(text: string, issues: readonly number[]): string {
  const lines = text.split("\n");
  const labelled = readTaskBlockLabels(text);
  const labelOf = new Map<number, number>();
  let last = issues[0];
  for (const phase of phasesOf(lines)) {
    if (phase.story !== null) last = issues[phase.story - 1];
    if (last === undefined) throw new TypeError(`no issue given for US${phase.story ?? 1}`);
    labelOf.set(phase.line, last);
  }
  const out: string[] = [];
  for (let i = 0; i < lines.length; i++) {
    out.push(lines[i]);
    const issue = labelOf.get(i);
    if (issue === undefined) continue;
    out.push(taskBlockLabel(issue));
    if (labelled.has(lines[i])) i++;
  }
  return out.join("\n");
}

const DECISION_RECORDS = /(^|\/)docs\/adr\//;

/** Whether `path` is one a landing commits: the spec folder's and the decision-record folders' (ADR-0005 d2). */
export function landsWith(specFolder: string): (path: string) => boolean {
  return (path) => path.startsWith(`${specFolder}/`) || DECISION_RECORDS.test(path);
}

const ISSUE_ARGUMENT = /^[1-9][0-9]*$/;
const KINDS: readonly string[] = ["new", "rescope"];
const RESCOPE = "rescope";
const LANDING_A_RESCOPE = "landing a rescope is #178";

type Landing = { p: number; specDir: string; kind: string };

async function landing(args: readonly string[], checkout: string): Promise<Landing | string> {
  if (args.length !== 3) return `land.ts takes <issue> <spec dir> <kind>, not ${JSON.stringify(args)}`;
  const [issue, specDir, kind] = args;
  if (!ISSUE_ARGUMENT.test(issue) || !Number.isSafeInteger(Number(issue))) return `${JSON.stringify(issue)} is no issue number`;
  if (!KINDS.includes(kind)) return `the kind is ${KINDS.join(" or ")}, not ${JSON.stringify(kind)}`;
  if (!isPlainPath(specDir) || posix.basename(posix.dirname(specDir)) !== "specs" || !posix.basename(specDir).startsWith(`${issue}-`)) {
    return `${JSON.stringify(specDir)} is no spec folder of #${issue}: specs/${issue}-<short name>, from the checkout's top folder`;
  }
  if (!existsSync(join(checkout, specDir, "tasks.md"))) return `${specDir}/tasks.md does not exist`;
  // git names every path from the top folder, and the spec folder is compared with them as given.
  if ((await runGit(checkout, ["rev-parse", "--show-prefix"])).stdout.trim() !== "") {
    return `${checkout} is not the top folder of its checkout; run land.ts from there`;
  }
  return { p: Number(issue), specDir, kind };
}

const UserAnswer = z.object({ id: z.number().int().positive() });
const OpenedPr = z.object({ html_url: z.string() });

const REF_QUERY = `query($owner: String!, $name: String!, $qualifiedName: String!) {
  repository(owner: $owner, name: $name) { ref(qualifiedName: $qualifiedName) { name } }
}`;

const RefAnswer = z.object({ repository: z.object({ ref: z.object({ name: z.string() }).nullable() }) });

async function hasBranch(github: GitHubClient, repo: Repository, branch: string): Promise<boolean> {
  const answer = await github.graphql(REF_QUERY, { owner: repo.owner, name: repo.name, qualifiedName: `refs/heads/${branch}` });
  return answerOf(RefAnswer, answer, `branch ${branch} of ${repo.owner}/${repo.name}`).repository.ref !== null;
}

async function folderNames(checkout: string, ref: string, path: string): Promise<string[]> {
  try {
    return (await gitTree(checkout, ref).listDir(path)).filter((entry) => entry.isDir).map((entry) => entry.name);
  } catch (error) {
    // A ref with no specs/ holds no spec folder.
    if (!(error instanceof NotInTree)) throw error;
    return [];
  }
}

type Read = {
  repo: Repository;
  api: string;
  github: GitHubClient;
  base: string;
  /** The spec PR to push to; null when the landing opens one. */
  open: SpecPr | null;
  tasks: string;
  stories: Story[];
  subIssues: StoryIssueType[];
  email: string;
  login: string;
};

// Every read and stop, in contracts/scripts.md's order; nothing here writes but the fetches into origin's refs.
async function read({ p, specDir, kind }: Landing, io: LandIo): Promise<Read> {
  if (kind === RESCOPE) stop(`#${p} is a rescope, which land.ts does not land. Next step: land it by hand; ${LANDING_A_RESCOPE}.`);
  const { checkout } = io;
  const repo = await originRepository(checkout);
  const settings = await readPlannerSettings(checkout);
  const github = await plannerGitHub(repo, settings, io.connect, new Date(), io.mint);
  const name = `${repo.owner}/${repo.name}`;
  const api = repositoryPath(repo);
  const { url, default_branch: base } = await readRepository(github, repo);
  const tracking = `refs/remotes/origin/${base}`;
  await io.fetch(repo, [`+refs/heads/${base}:${tracking}`]);

  const specs = posix.dirname(specDir);
  const project = posix.dirname(specs);
  const fromTop = (path: string) => (project === "." ? path : `${project}/${path}`);
  const here = specFolderAnswer([...new Set([...(await folderNames(checkout, "HEAD", specs)), posix.basename(specDir)])], p);
  if ("several" in here) {
    stop(`#${p} has several spec folders: ${here.several.map(fromTop).join(", ")}. Next step: keep one of them, then land again.`);
  }
  const onBase = specFolderAnswer(await folderNames(checkout, tracking, specs), p);
  if (!("none" in onBase)) {
    const found = "one" in onBase ? [onBase.one] : onBase.several;
    stop(`${found.map(fromTop).join(", ")} of #${p} is already on ${base}. Next step: rescope it; ${LANDING_A_RESCOPE}.`);
  }

  const mergeBase = await runGit(checkout, ["merge-base", "HEAD", tracking], [1]);
  if (mergeBase.code === 1) stop(`HEAD shares no history with origin/${base}. Next step: land from a branch cut from ${base}.`);
  // The index too: the commit takes what is staged.
  const changed = await runGit(checkout, ["diff", "--cached", "--name-only", "-z", "--no-renames", mergeBase.stdout.trim()]);
  const outside = changed.stdout.split("\0").filter((path) => path !== "" && !landsWith(specDir)(path));
  if (outside.length > 0) {
    stop(
      `${outside.join(", ")} changed since ${base}, outside ${specDir} and docs/adr/. ` +
        "Next step: remove them from the branch and the index, or land them in a PR of their own.",
    );
  }

  const branch = specBranch(p);
  const pr = await specPr(github, name, p);
  // A closed PR keeps its head's name once the branch is deleted, and deleting it is the step this stop names; with
  // the branch gone, the landing cuts it again and opens a new spec PR.
  if (pr?.state === "closed" && (await hasBranch(github, repo, branch))) {
    stop(`#${p}'s spec PR #${pr.number} closed unmerged. Next step: delete branch ${branch}, then land again.`);
  }
  if (pr?.state === "merged") {
    stop(`#${p}'s spec PR #${pr.number} merged, so its spec is on the default branch. Next step: rescope it; ${LANDING_A_RESCOPE}.`);
  }
  const open = pr?.state === "open" ? pr : null;
  if (open !== null) {
    // Fetched only now: a branch with no open PR may not exist, and a fetch of it would fail.
    await io.fetch(repo, [`+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    const behind = await runGit(checkout, ["merge-base", "--is-ancestor", `refs/remotes/origin/${branch}`, "HEAD"], [1]);
    if (behind.code === 1) stop(`origin/${branch} holds commits HEAD does not. Next step: check out ${branch}, then land again.`);
  }

  const tasks = readFileSync(join(checkout, specDir, "tasks.md"), "utf8");
  let stories: Story[];
  let labels: ReadonlyMap<string, number>;
  try {
    stories = storyPlan(tasks);
    labels = readTaskBlockLabels(tasks);
  } catch (error) {
    if (!(error instanceof TasksRefused || error instanceof TaskBlockLabelRefused)) throw error;
    // tasks.md is derived (planner ADR-0009 d4) and nothing has landed, so the run is started again, never edited.
    stop(`${error.message}; tasks.md is not a story plan. Next step: remove \`${specDir}\`, then run \`/planner:issue-spec #${p} [<dir>]\` again.`);
  }
  const subIssues = await readSubIssues(github, repo, p);
  const problem = subIssueProblem(subIssues, stories, labels, url);
  if (problem?.kind === "extra") {
    stop(
      `#${p} has ${subIssues.length} sub-issues for ${stories.length} stories; the extra: ${problem.extra.map((n) => `#${n}`).join(", ")}. ` +
        `Next step: remove them from #${p}'s sub-issues.`,
    );
  }
  if (problem?.kind === "foreign") {
    stop(...problem.foreign.map((sub) => `#${p}'s sub-issue ${sub} is in another repository. Next step: remove it from #${p}'s sub-issues.`));
  }
  if (problem?.kind === "misplaced") {
    stop(
      ...problem.misplaced.map(
        ({ position, sub, label }) =>
          `#${p}'s sub-issue ${position} is #${sub}, but tasks.md labels US${position} with #${label}. ` +
          `Next step: order #${p}'s sub-issues so sub-issue ${position} is US${position}'s issue.`,
      ),
    );
  }

  const login = settings.shared.planner_app_login;
  const { id } = answerOf(UserAnswer, await github.rest("GET", `/users/${encodeURIComponent(login)}`), `the user ${login}`);
  return { repo, api, github, base, open, tasks, stories, subIssues, login, email: `${id}+${login}@users.noreply.github.com` };
}

// A re-run finds a story issue only among #p's sub-issues and never adds a missing blocked_by, since an admin may
// have unchained the story on purpose (planner ADR-0010). So a story whose writes stopped partway is the admin's to
// finish, and the error names what is missing.
export class LandingIncomplete extends Error {
  constructor(said: string, reason: Error) {
    super(`${reason.message}. ${said}.`, { cause: reason });
    this.name = "LandingIncomplete";
  }
}

async function storyLink(github: GitHubClient, path: string, body: object, missing: string): Promise<void> {
  try {
    await github.rest("POST", path, body);
  } catch (error) {
    if (!(error instanceof GitHubUnanswered || error instanceof GitHubPartlyAnswered || error instanceof GitHubRefused)) throw error;
    throw new LandingIncomplete(missing, error);
  }
}

async function storyIssues({ p, specDir }: Landing, { api, github, stories, subIssues }: Read): Promise<number[]> {
  if (stories.length === 1) return [p];
  const known: StoryIssueType[] = [...subIssues];
  for (const story of stories.slice(known.length)) {
    const body = { title: `US${story.k}: ${story.title}`, body: `Story ${story.k} of #${p}; its tasks are in ${specDir}/tasks.md.` };
    const created = answerOf(StoryIssue, await github.rest("POST", `${api}/issues`, body), `the issue of US${story.k}`);
    const previous = known.at(-1);
    const after = previous === undefined ? "" : ` and mark it blocked by #${previous.number}`;
    await storyLink(
      github,
      `${api}/issues/${p}/sub_issues`,
      { sub_issue_id: created.id },
      `#${created.number} (US${story.k}) was created but is not among #${p}'s sub-issues. Next step: add it to #${p}'s sub-issues${after}, then land again`,
    );
    if (previous !== undefined) {
      await storyLink(
        github,
        `${api}/issues/${created.number}/dependencies/blocked_by`,
        { issue_id: previous.id },
        `#${created.number} (US${story.k}) is not blocked by #${previous.number}. Next step: mark it blocked by #${previous.number}, then land again`,
      );
    }
    known.push(created);
  }
  return known.map((one) => one.number);
}

async function commitLanding(checkout: string, { p, specDir }: Landing, { login, email }: Read): Promise<void> {
  const status = await runGit(checkout, ["status", "--porcelain=v1", "-z", "--no-renames", "--untracked-files=all"]);
  // Each entry is two status letters, a space, then the path from the top folder.
  const paths = status.stdout.split("\0").filter((entry) => entry !== "").map((entry) => entry.slice(3)).filter(landsWith(specDir));
  if (paths.length > 0) await runGit(checkout, ["--literal-pathspecs", "add", "--all", "--", ...paths]);
  const staged = await runGit(checkout, ["diff", "--cached", "--quiet"], [1]);
  if (staged.code === 0) return;
  // Set in the environment, not as user.name: an admin's GIT_AUTHOR_* or GIT_COMMITTER_* outrank config and would put
  // the admin's name on the App's commit. The checkout's config may sign with the admin's key for the same reason.
  const identity = { GIT_AUTHOR_NAME: login, GIT_AUTHOR_EMAIL: email, GIT_COMMITTER_NAME: login, GIT_COMMITTER_EMAIL: email };
  await runGit(checkout, ["-c", "commit.gpgSign=false", "commit", "--quiet", "-m", `docs(spec): the spec of #${p} and its decision records`], [], identity);
}

async function write(landing: Landing, read: Read, io: LandIo): Promise<void> {
  const { p, specDir } = landing;
  const { repo, api, github, base, open, tasks } = read;
  const issues = await storyIssues(landing, read);
  const labelled = labelTasks(tasks, issues);
  if (labelled !== tasks) writeFileSync(join(io.checkout, specDir, "tasks.md"), labelled);
  await commitLanding(io.checkout, landing, read);
  const branch = specBranch(p);
  await io.push(repo, `HEAD:refs/heads/${branch}`);
  // A draft, with no label: an exempt label counts only from a writer who is no codeworks App.
  const body = { title: `Spec of #${p}`, head: branch, base, draft: true, body: `The spec of #${p}, in \`${specDir}\`, with its decision records.` };
  const url =
    open === null
      ? answerOf(OpenedPr, await github.rest("POST", `${api}/pulls`, body), `the spec PR of #${p}`).html_url
      : `https://github.com/${repo.owner}/${repo.name}/pull/${open.number}`;
  io.stdout(`Spec folder: ${specDir}`);
  io.stdout(`Branch: ${branch}`);
  io.stdout(`Spec PR: ${url}`);
}

/** Exit 0 landed, 1 stopped before any write naming the next step, 2 could not run. */
export async function main(args: readonly string[], io: LandIo): Promise<number> {
  try {
    const given = await landing(args, io.checkout);
    if (typeof given === "string") {
      io.stderr(`planner: ${given}`);
      return 2;
    }
    await write(given, await read(given, io), io);
    return 0;
  } catch (error) {
    if (error instanceof Stopped) {
      for (const line of error.lines) io.stderr(line);
      return 1;
    }
    if (
      !(
        error instanceof GitHubUnanswered ||
        error instanceof GitHubPartlyAnswered ||
        error instanceof GitHubRefused ||
        error instanceof LandingIncomplete ||
        error instanceof SettingsError ||
        error instanceof RemoteRefused ||
        error instanceof NoOrigin ||
        error instanceof GhFolderRefused ||
        error instanceof KeyReadRefused ||
        error instanceof MintError ||
        error instanceof GhCredentialRefused ||
        error instanceof GitFailed
      )
    ) {
      throw error;
    }
    io.stderr(`planner: ${error.message}`);
    return 2;
  }
}

if (import.meta.main) {
  const checkout = process.cwd();
  process.exitCode = await main(process.argv.slice(2), {
    checkout,
    connect: (token) => gitHub(token),
    fetch: (repo, refspecs) => fetchWithGhCredential(checkout, ghFolder(repo), repo, refspecs),
    push: (repo, refspec) => pushWithGhCredential(checkout, ghFolder(repo), repo, refspec),
    mint: mintPlannerToken,
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
