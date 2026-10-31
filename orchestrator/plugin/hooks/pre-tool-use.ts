// Anything this hook needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs. Type imports are erased, so they load nothing.
import "../lib/guarded.ts";

import type { HookAnswer, HookDeps } from "../lib/hook-io.ts";

const { PASS, readInput, refusing, runHook } = await import("../lib/hook-io.ts");
const { ensureSessionToken, originRepository } = await import("../lib/session-token.ts");
const { orchestratorOnGitHub } = await import("../lib/settings.ts");

/** PreToolUse on Bash, the one tool that reaches GitHub with the session token: mints it first when due (FR-011). */
export function run(stdin: string, deps: HookDeps): Promise<HookAnswer> {
  return refusing(async () => {
    const { cwd } = readInput("PreToolUse", stdin);
    const repo = await originRepository(cwd);
    await ensureSessionToken(repo, deps.now(), { ...deps, onGitHub: orchestratorOnGitHub(cwd, repo, deps) });
    return PASS;
  });
}

if (import.meta.main) await runHook(run);
