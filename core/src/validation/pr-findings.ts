import { z } from "zod";

import { Finding } from "../contracts/finding.ts";
import { answerOf, ownerAndName, type GitHubClient } from "../github.ts";
import { outcomeOf, type CouldNotRun } from "../outcomes.ts";
import type { Shared } from "../settings.ts";
import { CheckOutcome } from "../values.ts";
import { assertAsked } from "./contract.ts";
import { CheckRun, checkRuns, moduleCheckName, newestRunBy, repositoryPath, requiredChecks } from "./required-checks.ts";
import { threadsModule, type ProviderLogins } from "./threads.ts";

const { PASS, FAIL } = CheckOutcome.schema.enum;

const ModuleRun = CheckRun.extend({ output: z.object({ text: z.string().nullable() }) });

// No package is loaded, since a package's deps read keys that only hooks may read (root ADR-0008 d4). So no provider
// login is known, and the threads module trusts a provider only where `trusted_reviewers` lists it.
const NO_PROVIDER_LOGINS: ProviderLogins = { logins: new Set() };

/** COULD_NOT_RUN throws its reason: returned as an empty list, it would read as nothing found. */
function findingsOrThrow(answer: Finding[] | CouldNotRun): Finding[] {
  if ("outcome" in answer) throw new Error(answer.reason);
  return answer;
}

function writtenFindings(text: string | null, where: string): Finding[] {
  if (text === null) throw new Error(`${where} carries no findings`);
  let written: unknown;
  try {
    written = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new Error(`${where} carries findings that are not JSON: ${error.message}`, { cause: error });
  }
  return answerOf(z.array(Finding), written, where);
}

async function moduleFindings(reader: GitHubClient, at: string, head: string, module: string, orchestratorLogin: string): Promise<Finding[]> {
  const name = moduleCheckName(module);
  const run = newestRunBy(await checkRuns(reader, at, head, name, ModuleRun), orchestratorLogin);
  if (run === undefined) throw new Error(`module ${module}: no ${name} check run by ${orchestratorLogin} at ${head}`);
  // Read from a run still pending, an empty list would pass a head the module never read.
  const outcome = outcomeOf(run);
  if (outcome !== PASS && outcome !== FAIL) {
    throw new Error(`module ${module}: ${name} at ${head} is ${run.conclusion ?? run.status}, no reading of the head`);
  }
  return writtenFindings(run.output.text, `the ${name} check run of module ${module} at ${head}`);
}

/**
 * The head's findings from the required checks, each `[shared] validators` module's check run and the threads. A
 * module's run absent or pending throws, and so does the required checks' or the threads' COULD_NOT_RUN.
 */
export async function prFindings(reader: GitHubClient, repo: string, pr: number, head: string, settings: Shared): Promise<Finding[]> {
  // The modules' reads put `head` in a REST path, and run beside requiredChecks' own assertion, not after it.
  assertAsked(repo, pr, head);
  const at = repositoryPath(ownerAndName(repo));
  // requiredChecks reads the modules' names alone, to leave their check runs to this read.
  const modules = { modules: new Map(settings.validators.map((module) => [module, module] as const)) };
  const [checks, fromModules, threads] = await Promise.all([
    requiredChecks(settings, reader, modules).findings(repo, pr, head),
    Promise.all(settings.validators.map((module) => moduleFindings(reader, at, head, module, settings.orchestrator_app_login))),
    threadsModule(settings, reader, NO_PROVIDER_LOGINS).findings(repo, pr, head),
  ]);
  return [...findingsOrThrow(checks), ...fromModules.flat(), ...findingsOrThrow(threads)];
}
