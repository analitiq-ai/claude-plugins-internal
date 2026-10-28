// Anything this hook needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs.
import "../lib/guarded.ts";

const { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } = await import("node:fs");
const { dirname, isAbsolute } = await import("node:path");
const { z } = await import("zod");
const { GH_TOKEN_VARIABLES, needsMint, readGhToken, writeGhToken } = await import("../core/gh-config.ts");
const { runGit } = await import("../core/git.ts");
const { GitHubRefused, GitHubUnanswered, RemoteRefused, repositoryOfRemote } = await import("../core/github.ts");
const { KeyReadRefused } = await import("../core/keys.ts");
const { SettingsError } = await import("../core/settings.ts");
const { MintError, mintToken } = await import("../core/tokens.ts");
const { ghFolder, readPlannerSettings, sessionRecord } = await import("../lib/settings.ts");

// Claude Code sends more fields than these; the hook acts on these alone.
const HookInput = z.object({
  hook_event_name: z.enum(["SessionStart", "PreToolUse"]),
  cwd: z.string().refine(isAbsolute, "not an absolute path"),
  // It names a file under planner's state folder, so nothing but a UUID may reach the path.
  session_id: z.uuid(),
});

function refuse(reason: string): never {
  process.stderr.write(`${reason}\n`);
  process.exit(2);
}

function hookInput(text: string) {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    refuse(`planner: the hook's input is not JSON: ${error.message}`);
  }
  const parsed = HookInput.safeParse(document);
  if (!parsed.success) refuse(`planner: the hook's input is refused: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

function sessionEnvFile(): string {
  const file = process.env.CLAUDE_ENV_FILE;
  if (file === undefined || file === "") {
    refuse("planner: CLAUDE_ENV_FILE is not set, so this session's gh cannot be pointed at planner's gh folder");
  }
  return file;
}

async function originOf(checkout: string): Promise<string> {
  // git exits 2 for a remote the checkout does not have.
  const { code, stdout } = await runGit(checkout, ["remote", "get-url", "origin"], [2]);
  if (code === 2) refuse(`planner: ${checkout} has no remote origin, so there is no repository to mint a token for`);
  return stdout.trim();
}

// The repository's part of the folder is GitHub's characters only; the home folder is the admin's, and may hold a quote.
function shellQuoted(text: string): string {
  return `'${text.replaceAll("'", `'\\''`)}'`;
}

const input = hookInput(readFileSync(0, "utf8"));
// Claude Code goes on with a session whose SessionStart hook failed, so each Bash call checks that the start
// finished: the start deletes this record first and writes it last. A resumed session runs the start again.
const record = sessionRecord(input.session_id);
if (input.hook_event_name === "SessionStart") rmSync(record, { force: true });
else if (!existsSync(record)) refuse("planner: this session's start failed; start a new session");
// Read before the mint, which a start with nowhere to write the session's environment would waste.
const envFile = input.hook_event_name === "SessionStart" ? sessionEnvFile() : null;

try {
  const { shared, planner } = await readPlannerSettings(input.cwd);
  const repository = repositoryOfRemote(await originOf(input.cwd));
  const repo = `${repository.owner}/${repository.name}`;
  const folder = ghFolder(repository);
  if (needsMint(readGhToken(folder), repo, new Date())) {
    const token = await mintToken("planner", planner.app_id, "planner-app.pem", "planner", repo);
    writeGhToken(folder, token, shared.planner_app_login);
  }
  if (envFile !== null) {
    appendFileSync(envFile, `export GH_CONFIG_DIR=${shellQuoted(folder)}\nunset ${GH_TOKEN_VARIABLES.join(" ")}\n`);
    mkdirSync(dirname(record), { recursive: true, mode: 0o700 });
    writeFileSync(record, "");
  }
} catch (error) {
  if (
    !(
      error instanceof KeyReadRefused ||
      error instanceof MintError ||
      error instanceof GitHubRefused ||
      error instanceof GitHubUnanswered ||
      error instanceof SettingsError ||
      error instanceof RemoteRefused
    )
  ) {
    throw error;
  }
  refuse(error.message);
}
