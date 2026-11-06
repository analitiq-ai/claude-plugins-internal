import type { Finding } from "../contracts/finding.ts";
import { ownerAndName, repositoryPath, type GitHubClient } from "../github.ts";
import { couldNotRun, type CouldNotRun } from "../outcomes.ts";
import type { Shared } from "../settings.ts";
import { CheckOutcome } from "../values.ts";
import { assertAsked } from "./contract.ts";
import { checkRuns, findingOf, moduleCheckName, newestRunBy, requiredChecks, runReading } from "./required-checks.ts";
import { threadsModule, type ProviderLogins } from "./threads.ts";

const { FAIL, COULD_NOT_RUN } = CheckOutcome.schema.enum;

/** COULD_NOT_RUN throws its reason: returned as an empty list, it would read as nothing found. */
function findingsOrThrow(answer: Finding[] | CouldNotRun): Finding[] {
  if ("outcome" in answer) throw new Error(answer.reason);
  return answer;
}

// A run that could not run is never a pass (root ADR-0004 d1).
async function moduleFindings(reader: GitHubClient, at: string, head: string, module: string, orchestratorLogin: string): Promise<Finding[] | CouldNotRun> {
  const name = moduleCheckName(module);
  const run = newestRunBy(await checkRuns(reader, at, head, name), orchestratorLogin);
  if (run === undefined) return [];
  const reading = runReading(run);
  if (reading.outcome === COULD_NOT_RUN) return couldNotRun(module, `${name} concluded ${reading.state}`);
  return reading.outcome === FAIL ? [findingOf({ name, ...reading }, module, `module-review:${module}`)] : [];
}

/**
 * The head's findings: the required checks' and the threads', and only when both are empty, one for each
 * `[shared] validators` module whose `<module>-review` run by the orchestrator's App failed. A COULD_NOT_RUN of any
 * of them throws.
 */
export async function prFindings(
  reader: GitHubClient,
  repo: string,
  pr: number,
  head: string,
  settings: Shared,
  logins: ProviderLogins,
): Promise<Finding[]> {
  // Before either reader starts, so neither reads for a head the other refuses.
  assertAsked(repo, pr, head);
  // requiredChecks reads the modules' names alone, to leave their check runs to this read.
  const modules = { modules: new Map(settings.validators.map((module) => [module, module] as const)) };
  const [checks, threads] = await Promise.all([
    requiredChecks(settings, reader, modules).findings(repo, pr, head),
    threadsModule(settings, reader, logins).findings(repo, pr, head),
  ]);
  const found = [...findingsOrThrow(checks), ...findingsOrThrow(threads)];
  if (found.length > 0) return found;
  const at = repositoryPath(ownerAndName(repo));
  const fromModules = await Promise.all(
    settings.validators.map((module) => moduleFindings(reader, at, head, module, settings.orchestrator_app_login)),
  );
  return fromModules.flatMap(findingsOrThrow);
}
