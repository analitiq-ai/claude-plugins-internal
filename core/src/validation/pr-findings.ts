import type { Finding } from "../contracts/finding.ts";
import { ownerAndName, repositoryPath, type GitHubClient } from "../github.ts";
import { couldNotRun, couldNotRunIfUnread, type CouldNotRun } from "../outcomes.ts";
import type { Shared } from "../settings.ts";
import { CheckOutcome } from "../values.ts";
import { assertAsked } from "./contract.ts";
import { checkRuns, findingOf, moduleCheckName, newestRunBy, requiredChecks, runReading } from "./required-checks.ts";
import { threadsModule, type ProviderLogins } from "./threads.ts";

const { FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;

/**
 * The COULD_NOT_RUN of a source prFindings reads (required-checks, threads or a module), whatever made it: GitHub not
 * answering, a run concluding cancelled, settings that leave no check to read. The message is its reason; `cause` is
 * GitHub's error when that is why. A refused read is no COULD_NOT_RUN: GitHubRefused passes through.
 */
export class FindingsCouldNotRun extends Error {
  readonly source: string;

  constructor({ source, reason, cause }: CouldNotRun) {
    super(reason, cause === undefined ? undefined : { cause });
    this.name = "FindingsCouldNotRun";
    this.source = source;
  }
}

// Returned as an empty list, a COULD_NOT_RUN would read as nothing found.
function findingsOrThrow(answer: Finding[] | CouldNotRun): Finding[] {
  if ("outcome" in answer) throw new FindingsCouldNotRun(answer);
  return answer;
}

// A run that could not run is never a pass (root ADR-0004 d1).
async function readModule(reader: GitHubClient, at: string, head: string, module: string, orchestratorLogin: string): Promise<Finding[] | CouldNotRun> {
  const name = moduleCheckName(module);
  const run = newestRunBy(await checkRuns(reader, at, head, name), orchestratorLogin);
  if (run === undefined) return [];
  const reading = runReading(run);
  if (reading.outcome === COULD_NOT_RUN) return couldNotRun(module, `${name} concluded ${reading.state}`);
  return reading.outcome === FAIL ? [findingOf({ name, ...reading }, module, `module-review:${module}`)] : [];
}

// GitHub's no answer, or its answer in part, is the module's outcome at its own boundary, as it is required-checks'
// and threads'.
async function moduleFindings(reader: GitHubClient, at: string, head: string, module: string, orchestratorLogin: string): Promise<Finding[] | CouldNotRun> {
  try {
    return await readModule(reader, at, head, module, orchestratorLogin);
  } catch (error) {
    return couldNotRunIfUnread(module, error);
  }
}

/**
 * The head's findings: the required checks' and the threads', and only when both are empty, one for each
 * `[shared] validators` module whose `<module>-review` run by the orchestrator's App failed. A COULD_NOT_RUN of any
 * of them throws FindingsCouldNotRun.
 */
export async function prFindings(
  reader: GitHubClient,
  repo: string,
  pr: number,
  head: string,
  settings: Shared,
  logins: ProviderLogins,
): Promise<Finding[]> {
  // The head is checked and both readers made before any read starts, so a refusal leaves no read running.
  assertAsked(repo, pr, head);
  const sources = [requiredChecks(settings, reader), threadsModule(settings, reader, logins)];
  const found = (await Promise.all(sources.map((source) => source.findings(repo, pr, head)))).flatMap(findingsOrThrow);
  if (found.length > 0) return found;
  const at = repositoryPath(ownerAndName(repo));
  const fromModules = await Promise.all(
    settings.validators.map((module) => moduleFindings(reader, at, head, module, settings.orchestrator_app_login)),
  );
  return fromModules.flatMap(findingsOrThrow);
}
