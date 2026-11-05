import { z } from "zod";

import type { Finding } from "../contracts/finding.ts";
import { answerOf, GitHubMisanswered, ownerAndName, type GitHubClient } from "../github.ts";
import { couldNotRun, couldNotRunIfUnanswered, outcomeOf, type CouldNotRun, type StatusAnswer } from "../outcomes.ts";
import type { Shared } from "../settings.ts";
import { CheckOutcome, REQUIRED_CHECKS_SOURCE as SOURCE } from "../values.ts";
import { assertAsked } from "./contract.ts";

const { PENDING, PASS, FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;

type Outcome = StatusAnswer["outcome"];

// The orchestrator writes these check runs from this reader's answers, so requiring them here would make a check
// wait on itself (orchestrator ADR-0007 d2).
const INTERNAL_REVIEW = "internal-review";

const PULL_REQUEST_QUERY = `query($owner: String!, $name: String!, $number: Int!) {
  repository(owner: $owner, name: $name) { pullRequest(number: $number) { baseRefName headRefOid mergeable } }
}`;

const Mergeable = z.enum(["MERGEABLE", "CONFLICTING", "UNKNOWN"]);
const { CONFLICTING, UNKNOWN } = Mergeable.enum;

const PullRequest = z.object({ baseRefName: z.string().min(1), headRefOid: z.string(), mergeable: Mergeable });
type PullRequest = z.infer<typeof PullRequest>;

const PullRequestAnswer = z.object({ repository: z.object({ pullRequest: PullRequest }) });

const REQUIRED_STATUS_CHECKS = "required_status_checks";

const Rules = z.array(z.object({ type: z.string(), parameters: z.unknown().optional() }));

const RequiredCheck = z.object({ context: z.string().min(1), integration_id: z.int().optional() });
type RequiredCheck = z.infer<typeof RequiredCheck>;

const RequiredStatusChecks = z.object({ required_status_checks: z.array(RequiredCheck) });

// A check run's `app` and a status's `creator` are null once that App or account is gone.
const CheckRun = z.object({
  name: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
  app: z.object({ id: z.int(), slug: z.string() }).nullable(),
});
type CheckRun = z.infer<typeof CheckRun>;

const CheckRuns = z.object({ total_count: z.int().min(0), check_runs: z.array(CheckRun) });

const CommitStatus = z.object({ context: z.string(), state: z.string(), creator: z.object({ login: z.string() }).nullable() });
type CommitStatus = z.infer<typeof CommitStatus>;

const PER_PAGE = 100;

/** One check run or status of a required check; `state` is GitHub's, null when there is none. */
type Reading = { outcome: Outcome; state: string | null; author: string | null };
type CheckReading = Reading & { name: string };
type PullRequestReading = { pullRequest: PullRequest; checks: readonly [CheckReading, ...CheckReading[]] };

export type RequiredChecks = {
  status(repo: string, pr: number, head: string): Promise<StatusAnswer>;
  findings(repo: string, pr: number, head: string): Promise<Finding[] | CouldNotRun>;
};

/** The loaded modules, by name; `Validators` from `loadValidators` is one. */
export type LoadedModules = { modules: ReadonlyMap<string, unknown> };

// One order, for one check's readings and for the reader's checks alike: any FAIL, else any COULD_NOT_RUN, else
// any PENDING; PASS only when every one passed.
const PRECEDENCE: readonly Outcome[] = [FAIL, COULD_NOT_RUN, PENDING];

function isNonEmpty<T>(list: readonly T[]): list is readonly [T, ...T[]] {
  return list.length > 0;
}

function worst<T extends { outcome: Outcome }>(graded: readonly [T, ...T[]]): T {
  for (const outcome of PRECEDENCE) {
    const found = graded.find((one) => one.outcome === outcome);
    if (found !== undefined) return found;
  }
  return graded[0];
}

function described(checks: readonly CheckReading[]): string {
  return checks.map((check) => `${check.name} (${check.state ?? "no check run or status"})`).join(", ");
}

function requiredOf(rules: z.infer<typeof Rules>, where: string): RequiredCheck[] {
  return rules.flatMap((rule) =>
    rule.type === REQUIRED_STATUS_CHECKS ? answerOf(RequiredStatusChecks, rule.parameters, where).required_status_checks : [],
  );
}

function runReading(run: CheckRun): Reading {
  return { outcome: outcomeOf(run), state: run.conclusion ?? run.status, author: run.app?.slug ?? null };
}

function statusReading(status: CommitStatus): Reading {
  return { outcome: outcomeOf(status), state: status.state, author: status.creator?.login ?? null };
}

// A status is matched by context alone, whatever App the rule pins: the statuses API names no App, and GitHub's
// merge gate stays final.
function checkReading(check: RequiredCheck, runs: readonly CheckRun[], newestStatus: ReadonlyMap<string, CommitStatus>): CheckReading {
  const readings = runs
    .filter((run) => run.name === check.context && (check.integration_id === undefined || run.app?.id === check.integration_id))
    .map(runReading);
  const status = newestStatus.get(check.context);
  if (status !== undefined) readings.push(statusReading(status));
  const deciding = isNonEmpty(readings) ? worst(readings) : { outcome: outcomeOf(undefined), state: null, author: null };
  return { name: check.context, ...deciding };
}

async function checkRuns(reader: GitHubClient, at: string, head: string, name: string): Promise<CheckRun[]> {
  const path = `${at}/commits/${head}/check-runs?check_name=${encodeURIComponent(name)}&filter=latest&per_page=${PER_PAGE}`;
  const answer = answerOf(CheckRuns, await reader.rest("GET", path), `the check runs ${name} at ${head}`);
  // The client's restPages reads lists, and check runs come wrapped. One name at one head, latest only, is a run
  // per check suite, well inside a page; past one, a part read as the whole could pass a head a run failed.
  if (answer.check_runs.length < answer.total_count) {
    throw new GitHubMisanswered(`GET ${path}: ${answer.total_count} check runs, more than the ${answer.check_runs.length} one page gave`);
  }
  return answer.check_runs;
}

async function newestStatuses(reader: GitHubClient, at: string, head: string): Promise<Map<string, CommitStatus>> {
  const statuses = answerOf(
    z.array(CommitStatus),
    await reader.restPages(`${at}/commits/${head}/statuses?per_page=${PER_PAGE}`),
    `the commit statuses at ${head}`,
  );
  // GitHub lists a ref's statuses newest first, so a context's first is its current one.
  const newest = new Map<string, CommitStatus>();
  for (const status of statuses) if (!newest.has(status.context)) newest.set(status.context, status);
  return newest;
}

/** The required-checks reader: no `trigger`, never SILENT; the orchestrator times a missing or pending check. */
export function requiredChecks(_shared: Shared, reader: GitHubClient, validators: LoadedModules): RequiredChecks {
  const ownChecks: ReadonlySet<string> = new Set([INTERNAL_REVIEW, ...[...validators.modules.keys()].map((name) => `${name}-review`)]);

  async function readChecks(repo: string, pr: number, head: string): Promise<PullRequestReading | CouldNotRun> {
    const where = ownerAndName(repo);
    const answered = await reader.graphql(PULL_REQUEST_QUERY, { ...where, number: pr });
    const { pullRequest } = answerOf(PullRequestAnswer, answered, `${repo}#${pr}`).repository;
    const base = pullRequest.baseRefName;
    const at = `/repos/${encodeURIComponent(where.owner)}/${encodeURIComponent(where.name)}`;
    const rulesWhere = `the rules of ${repo} branch ${base}`;
    const rules = answerOf(Rules, await reader.restPages(`${at}/rules/branches/${encodeURIComponent(base)}?per_page=${PER_PAGE}`), rulesWhere);
    const required = requiredOf(rules, rulesWhere).filter((check) => !ownChecks.has(check.context));
    // Read as PASS, a branch requiring nothing else would let a head merge that no check read.
    if (!isNonEmpty(required)) return couldNotRun(SOURCE, `the rules of ${base} require no check but ${[...ownChecks].join(", ")}`);

    const names = [...new Set(required.map((check) => check.context))];
    const [runs, newest] = await Promise.all([
      Promise.all(names.map((name) => checkRuns(reader, at, head, name))),
      newestStatuses(reader, at, head),
    ]);
    const allRuns = runs.flat();
    const pinRead = (check: RequiredCheck): CheckReading => checkReading(check, allRuns, newest);
    // Rulesets may require one name more than once, pinned to different Apps or none: every pin must hold, and the
    // name is still one check, with one finding key.
    const atHead = (name: string): CheckReading => {
      const [pin, ...more] = required.filter((check) => check.context === name);
      return worst([pinRead(pin), ...more.map(pinRead)]);
    };
    const [first, ...rest] = names;
    return { pullRequest, checks: [atHead(first), ...rest.map(atHead)] };
  }

  // GitHub's no-answer is this reader's check outcome at its own boundary.
  async function read(repo: string, pr: number, head: string): Promise<PullRequestReading | CouldNotRun> {
    assertAsked(repo, pr, head);
    try {
      return await readChecks(repo, pr, head);
    } catch (error) {
      return couldNotRunIfUnanswered(SOURCE, error);
    }
  }

  return {
    async status(repo, pr, head) {
      const answer = await read(repo, pr, head);
      if ("outcome" in answer) return answer;
      const { checks } = answer;
      const { outcome } = worst(checks);
      return { outcome, reason: outcome === PASS ? null : `${SOURCE}: ${described(checks.filter((check) => check.outcome === outcome))}` };
    },

    async findings(repo, pr, head) {
      const answer = await read(repo, pr, head);
      if ("outcome" in answer) return answer;
      const unrun = answer.checks.filter((check) => check.outcome === COULD_NOT_RUN);
      if (unrun.length > 0) return couldNotRun(SOURCE, described(unrun));
      const conflict = conflictAt(answer.pullRequest, repo, pr, head);
      if (!Array.isArray(conflict)) return conflict;
      return [...answer.checks.filter((check) => check.outcome === FAIL).map(findingOf), ...conflict];
    },
  };
}

// A conflict stops the merge as a failed check does, and this is core's one read of the merge gate (root ADR-0003
// d6), so it is this reader's finding; status stays the checks alone, which GREEN is (orchestrator ADR-0007 d2).
// GitHub computes mergeability for the current head only, and only once asked.
function conflictAt(pullRequest: PullRequest, repo: string, pr: number, head: string): Finding[] | CouldNotRun {
  const base = pullRequest.baseRefName;
  if (pullRequest.headRefOid !== head) {
    return couldNotRun(SOURCE, `GitHub's mergeability of ${repo}#${pr} is of ${pullRequest.headRefOid}, not ${head}`);
  }
  if (pullRequest.mergeable === UNKNOWN) return couldNotRun(SOURCE, `GitHub has not yet computed whether ${repo}#${pr} conflicts with ${base}`);
  return pullRequest.mergeable === CONFLICTING ? [conflictFinding(base)] : [];
}

function conflictFinding(base: string): Finding {
  return {
    source: SOURCE,
    key: `conflict:${base}`,
    // GitHub finds a conflict, so no account is its author.
    author: "",
    file: null,
    line: null,
    text: `the PR conflicts with its base branch ${base}`,
    thread_id: null,
    resolvable: false,
    trusted_comments: [],
    latest_trusted_comment_id: null,
  };
}

function findingOf(check: CheckReading): Finding {
  return {
    source: SOURCE,
    key: `required-check:${check.name}`,
    // Finding.author is a string; a run or status whose App or account is gone names nobody.
    author: check.author ?? "",
    file: null,
    line: null,
    text: `the required check ${check.name} concluded ${check.state}`,
    thread_id: null,
    resolvable: false,
    trusted_comments: [],
    latest_trusted_comment_id: null,
  };
}
