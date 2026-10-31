import { z } from "zod";

import { answerOf, ownerAndName, type GitHubClient } from "../core/github.ts";
import { readSection, readSettings, SETTINGS_FILE, SettingsError, type Shared } from "../core/settings.ts";
import { gitHubTree, gitTree } from "../core/tree.ts";
import { orchestratorClient, type AppTokenDeps } from "./app-token.ts";

const AppId = z.int().min(1);

// Story 1's keys; each later story adds the keys it reads (FR-007).
export const OrchestratorSettings = z.strictObject({ app_id: AppId, session_app_id: AppId, status_issue: z.int().min(1) });
export type OrchestratorSettings = z.infer<typeof OrchestratorSettings>;

// Not strict: every other key is read from GitHub, so HEAD's are not judged.
const AppIds = z.object({ app_id: AppId, session_app_id: AppId });
export type AppIds = z.infer<typeof AppIds>;

const ORCHESTRATOR_SECTION = `${SETTINGS_FILE} [orchestrator]`;

export type Settled = { shared: Shared; orchestrator: OrchestratorSettings };

function sectionOf<Schema extends z.ZodType>(schema: Schema, section: unknown): z.output<Schema> {
  const parsed = schema.safeParse(section);
  if (!parsed.success) throw new SettingsError(ORCHESTRATOR_SECTION, z.prettifyError(parsed.error), { cause: parsed.error });
  return parsed.data;
}

/**
 * The App IDs a hook mints with before it can read GitHub. The model can rewrite the checkout's refs, so nothing
 * else is taken from HEAD; a forged ID fails the mint, or `settleSettings`'s compare after it (research R5).
 */
export async function bootstrapAppIds(checkout: string): Promise<AppIds> {
  const { app_id, session_app_id } = sectionOf(AppIds, await readSection(gitTree(checkout, "HEAD"), "orchestrator"));
  return { app_id, session_app_id };
}

/** `codeworks.toml` at `ref` on GitHub, the one source of every key (root ADR-0002 d3–d4). */
export async function settleSettings(client: GitHubClient, repo: string, ref: string, bootstrapped: AppIds): Promise<Settled> {
  const settings = await readSettings(gitHubTree(client, repo, ref));
  const orchestrator = sectionOf(OrchestratorSettings, settings.section("orchestrator"));
  for (const key of ["app_id", "session_app_id"] as const) {
    if (orchestrator[key] !== bootstrapped[key]) {
      throw new SettingsError(ORCHESTRATOR_SECTION, `${key} is ${orchestrator[key]} at ${ref} on GitHub but ${bootstrapped[key]} at the checkout's HEAD`);
    }
  }
  return { shared: settings.shared, orchestrator };
}

const RepositoryAnswer = z.object({ default_branch: z.string().min(1) });

/** The ref of work with no PR, a claim's among it (root ADR-0002 d4). */
export async function defaultBranch(reader: GitHubClient, repo: string): Promise<string> {
  const { owner, name } = ownerAndName(repo);
  const answer = await reader.rest("GET", `/repos/${owner}/${name}`);
  return answerOf(RepositoryAnswer, answer, `the default branch of ${repo}`).default_branch;
}

export type OnGitHub = { client: GitHubClient; settled: Settled };

/**
 * The orchestrator App's client on `repo` and the settings it settles at the default branch (R5), read at the first
 * ask and shared by every later one: a hook run asks only when it acts.
 */
export function orchestratorOnGitHub(checkout: string, repo: string, deps: AppTokenDeps): () => Promise<OnGitHub> {
  let reading: Promise<OnGitHub> | null = null;
  async function read(): Promise<OnGitHub> {
    const appIds = await bootstrapAppIds(checkout);
    const client = orchestratorClient(repo, appIds.app_id, deps);
    return { client, settled: await settleSettings(client, repo, await defaultBranch(client, repo), appIds) };
  }
  return () => (reading ??= read());
}
