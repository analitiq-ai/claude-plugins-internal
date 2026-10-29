// gh as the planner App, for a planner script that is not TypeScript (R9): new_issue.py runs its gh calls through
// this. Anything it needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs.
import "../lib/guarded.ts";

const { spawnSync } = await import("node:child_process");
const { GH_TOKEN_VARIABLES, GhFolderRefused } = await import("../core/gh-config.ts");
const { GitHubRefused, GitHubUnanswered, RemoteRefused } = await import("../core/github.ts");
const { KeyReadRefused } = await import("../core/keys.ts");
const { SettingsError } = await import("../core/settings.ts");
const { MintError } = await import("../core/tokens.ts");
const { mintPlannerToken, NoOrigin, originRepository, plannerToken } = await import("../lib/github.ts");
const { ghFolder, readPlannerSettings } = await import("../lib/settings.ts");

const checkout = process.cwd();
let folder: string;
try {
  const repo = await originRepository(checkout);
  await plannerToken(repo, await readPlannerSettings(checkout), new Date(), mintPlannerToken);
  folder = ghFolder(repo);
} catch (error) {
  if (
    !(
      error instanceof GitHubUnanswered ||
      error instanceof GitHubRefused ||
      error instanceof SettingsError ||
      error instanceof RemoteRefused ||
      error instanceof NoOrigin ||
      error instanceof GhFolderRefused ||
      error instanceof KeyReadRefused ||
      error instanceof MintError
    )
  ) {
    throw error;
  }
  process.stderr.write(`planner: ${error.message}\n`);
  process.exit(2);
}

// gh reads any of these before its config folder, so the admin's token would act instead of the App's.
const env: NodeJS.ProcessEnv = { ...process.env, GH_CONFIG_DIR: folder };
for (const name of GH_TOKEN_VARIABLES) delete env[name];
const gh = spawnSync("gh", process.argv.slice(2), { stdio: "inherit", env });
if (gh.error) throw gh.error;
if (gh.status === null) throw new Error(`gh ended on ${gh.signal}`);
process.exitCode = gh.status;
