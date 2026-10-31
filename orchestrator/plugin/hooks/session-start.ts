// Anything this hook needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs. Type imports are erased, so they load nothing.
import "../lib/guarded.ts";

import type { HookAnswer, HookDeps } from "../lib/hook-io.ts";

const { PASS, readInput, refusalOf, refusing, runHook } = await import("../lib/hook-io.ts");
const { keyOf, postKeyed } = await import("../lib/keyed.ts");
const { ensureSessionToken, originRepository } = await import("../lib/session-token.ts");
const { orchestratorOnGitHub } = await import("../lib/settings.ts");

/** SessionStart: mints the session token (FR-010). */
export function run(stdin: string, deps: HookDeps): Promise<HookAnswer> {
  return refusing(async () => {
    const { cwd } = readInput("SessionStart", stdin);
    const repo = await originRepository(cwd);
    const onGitHub = orchestratorOnGitHub(cwd, repo, deps);
    try {
      await ensureSessionToken(repo, deps.now(), { ...deps, onGitHub });
    } catch (error) {
      const cause = refusalOf(error);
      if (cause === null) throw error;
      // SessionStart cannot block, and its failure names no issue, so the cause goes on the status issue (FR-008).
      const { client, settled } = await onGitHub();
      const { status_issue } = settled.orchestrator;
      await postKeyed(client, repo, status_issue, keyOf("session-start", cause), cause, settled.shared.orchestrator_app_login);
    }
    return PASS;
  });
}

if (import.meta.main) await runHook(run);
