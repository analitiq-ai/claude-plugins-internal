// Anything this script needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs. Type imports are erased, so they load nothing.
import "../lib/guarded.ts";

import type { GitHubClient, Repository } from "../core/github.ts";
import type { SpecPr } from "../core/identity.ts";

const { existsSync, readFileSync, writeFileSync } = await import("node:fs");
const { join, posix } = await import("node:path");
const { z } = await import("zod");
const { isPhaseHeading, readTaskBlockLabels, taskBlockLabel, TaskBlockLabelRefused } = await import("../core/contracts/tasks.ts");
const { GhFolderRefused } = await import("../core/gh-config.ts");
const { fetchWithGhCredential, GhCredentialRefused, GitFailed, pushWithGhCredential, runGit } = await import("../core/git.ts");
const { answerOf, gitHub, GitHubRefused, GitHubUnanswered, RemoteRefused } = await import("../core/github.ts");
const { specBranch, specFolderAnswer, specPr } = await import("../core/identity.ts");
const { SettingsError } = await import("../core/settings.ts");
const { gitTree, isPlainPath, NotInTree } = await import("../core/tree.ts");
const { NoOrigin, originRepository, plannerGitHub, StaleToken } = await import("../lib/github.ts");
const { ghFolder, readPlannerSettings } = await import("../lib/settings.ts");

export type LandIo = {
  /** The checkout's top folder; the spec folder is relative to it. */
  checkout: string;
  connect: (token: string) => GitHubClient;
  /** Fetches each refspec from `repo` into the remote-tracking ref it names. */
  fetch: (repo: Repository, refspecs: readonly string[]) => Promise<void>;
  push: (repo: Repository, refspec: string) => Promise<void>;
  stdout: (line: string) => void;
  stderr: (line: string) => void;
};

/** tasks.md is not in the shape the story plan is read from. */
class TasksRefused extends Error {
  constructor(reason: string) {
    super(`tasks.md: ${reason}`);
    this.name = "TasksRefused";
  }
}

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

const TASK_LINE = /^\s*- \[[ xX]\] /;
const STORY_TAG = /\[US([1-9][0-9]*)\]/g;
const PHASE_TITLE = /^## Phase [^:]*: (.+)$/;

type Phase = { line: number; heading: string; story: number | null };

// A story's phases are told apart by their tasks' tags, never by heading words (R16). A section that is no phase
// ends the one before it, so its lines are no phase's.
function phasesOf(lines: readonly string[]): Phase[] {
  const phases: Phase[] = [];
  let current: Phase | null = null;
  for (const [i, line] of lines.entries()) {
    if (isPhaseHeading(line)) {
      // Labels are read back by heading, so two phases under one heading could not be told apart.
      if (phases.some((phase) => phase.heading === line)) throw new TasksRefused(`two phases are headed "${line}"`);
      current = { line: i, heading: line, story: null };
      phases.push(current);
    } else if (line.startsWith("## ")) {
      current = null;
    } else if (TASK_LINE.test(line)) {
      for (const [, k] of line.matchAll(STORY_TAG)) {
        if (current === null) throw new TasksRefused(`${JSON.stringify(line)} is tagged US${k} outside any phase`);
        if (current.story !== null && current.story !== Number(k)) {
          throw new TasksRefused(`"${current.heading}" holds tasks of US${current.story} and US${k}`);
        }
        current.story = Number(k);
      }
    }
  }
  const order = phases.flatMap((phase) => (phase.story === null ? [] : [phase.story]));
  const outOfOrder = order.findIndex((k, i) => i > 0 && k < order[i - 1]);
  if (outOfOrder !== -1) throw new TasksRefused(`a US${order[outOfOrder]} phase comes after a US${order[outOfOrder - 1]} one`);
  return phases;
}

export type Story = { k: number; title: string; heading: string };

/** The stories of tasks.md, US1 first, each named by the heading of its first phase (R15). */
export function storyPlan(text: string): Story[] {
  const phases = phasesOf(text.split("\n"));
  const stories: Story[] = [];
  for (const phase of phases) {
    if (phase.story === null || stories.some((story) => story.k === phase.story)) continue;
    if (phase.story !== stories.length + 1) throw new TasksRefused(`US${phase.story} has tasks, but US${stories.length + 1} has none`);
    stories.push({ k: phase.story, title: PHASE_TITLE.exec(phase.heading)?.[1] ?? phase.heading.slice("## ".length), heading: phase.heading });
  }
  if (stories.length === 0) throw new TasksRefused("no task is tagged [US<k>]");
  return stories;
}

/**
 * `text` with `Story issue: #<n>` directly under each phase heading, `issues[k - 1]` being story k's: a story's
 * phases get its own, phases before the first story's get US1's, and any other its last story phase's (R16). An
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

const StoryIssue = z.object({ id: z.number().int().positive(), number: z.number().int().positive() });
type StoryIssue = ReturnType<typeof StoryIssue.parse>;

/** Each sub-issue at position i whose number is not the one tasks.md labels US<i+1> with, as the line naming both. */
export function misplacedSubIssues(subIssues: readonly StoryIssue[], stories: readonly Story[], labels: ReadonlyMap<string, number>): string[] {
  return subIssues.flatMap((sub, i) => {
    const story = stories[i];
    const label = story === undefined ? undefined : labels.get(story.heading);
    if (label === undefined || label === sub.number) return [];
    return [`sub-issue ${i + 1} is #${sub.number}, but tasks.md labels US${i + 1} with #${label}`];
  });
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

const RepositoryAnswer = z.object({ default_branch: z.string().min(1) });
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
  subIssues: StoryIssue[];
  email: string;
  login: string;
};

// Every read and stop, in contracts/scripts.md's order; nothing here writes but the fetches into origin's refs.
async function read({ p, specDir, kind }: Landing, io: LandIo): Promise<Read> {
  if (kind === RESCOPE) stop(`#${p} is a rescope, which land.ts does not land. Next step: land it by hand; ${LANDING_A_RESCOPE}.`);
  const { checkout } = io;
  const repo = await originRepository(checkout);
  const { shared } = await readPlannerSettings(checkout);
  const github = plannerGitHub(repo, io.connect, new Date());
  const name = `${repo.owner}/${repo.name}`;
  const api = `/repos/${encodeURIComponent(repo.owner)}/${encodeURIComponent(repo.name)}`;
  const base = answerOf(RepositoryAnswer, await github.rest("GET", api), name).default_branch;
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
  const stories = storyPlan(tasks);
  const labels = readTaskBlockLabels(tasks);
  let subIssues: StoryIssue[] = [];
  if (stories.length > 1) {
    subIssues = answerOf(z.array(StoryIssue), await github.restPages(`${api}/issues/${p}/sub_issues`), `the sub-issues of ${name}#${p}`);
    const extra = subIssues.slice(stories.length);
    if (extra.length > 0) {
      stop(
        `#${p} has ${subIssues.length} sub-issues for ${stories.length} stories; the extra: ${extra.map((one) => `#${one.number}`).join(", ")}. ` +
          `Next step: remove them from #${p}'s sub-issues, or add their stories to tasks.md.`,
      );
    }
    const misplaced = misplacedSubIssues(subIssues, stories, labels);
    if (misplaced.length > 0) {
      stop(...misplaced.map((line) => `#${p}'s ${line}. Next step: make tasks.md's label and #${p}'s sub-issue name the same issue.`));
    }
  }

  const login = shared.planner_app_login;
  const { id } = answerOf(UserAnswer, await github.rest("GET", `/users/${encodeURIComponent(login)}`), `the user ${login}`);
  return { repo, api, github, base, open, tasks, stories, subIssues, login, email: `${id}+${login}@users.noreply.github.com` };
}

async function storyIssues({ p, specDir }: Landing, { api, github, stories, subIssues }: Read): Promise<number[]> {
  if (stories.length === 1) return [p];
  const known = [...subIssues];
  for (const story of stories.slice(known.length)) {
    const body = { title: `US${story.k}: ${story.title}`, body: `Story ${story.k} of #${p}; its tasks are in ${specDir}/tasks.md.` };
    const created = answerOf(StoryIssue, await github.rest("POST", `${api}/issues`, body), `the issue of US${story.k}`);
    await github.rest("POST", `${api}/issues/${p}/sub_issues`, { sub_issue_id: created.id });
    const previous = known.at(-1);
    if (previous !== undefined) await github.rest("POST", `${api}/issues/${created.number}/dependencies/blocked_by`, { issue_id: previous.id });
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
  // A draft, with no label: an exempt label counts only from a writer who is no codeworks App (FR-014).
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
    if (error instanceof TasksRefused || error instanceof TaskBlockLabelRefused) {
      io.stderr(`${error.message}. Next step: correct the spec folder's tasks.md, then land again.`);
      return 1;
    }
    if (
      !(
        error instanceof GitHubUnanswered ||
        error instanceof GitHubRefused ||
        error instanceof SettingsError ||
        error instanceof RemoteRefused ||
        error instanceof NoOrigin ||
        error instanceof GhFolderRefused ||
        error instanceof StaleToken ||
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
    stdout: (line) => process.stdout.write(`${line}\n`),
    stderr: (line) => process.stderr.write(`${line}\n`),
  });
}
