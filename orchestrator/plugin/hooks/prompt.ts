// Anything this hook needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs. Type imports are erased, so they load nothing.
import "../lib/guarded.ts";

import type { HookAnswer, HookDeps } from "../lib/hook-io.ts";

const { readSessionRecord } = await import("../core/session-record.ts");
const { context, PASS, readInput, refuse, refusing, runHook } = await import("../lib/hook-io.ts");
const { sessionsFolder } = await import("../core/orchestrator-paths.ts");
const { originRepository } = await import("../core/git.ts");
const { ensureSessionToken } = await import("../lib/session-token.ts");
const { orchestratorOnGitHub } = await import("../lib/settings.ts");
const { applyStart, decideStart, gatherStartFacts } = await import("../lib/start.ts");

// The prompt is matched as typed (R20); a number past the safe integers names no issue GitHub could hold.
const GRAMMAR = "^/codeworks ([1-9][0-9]*)$";

const step = (issue: number, how: "claimed" | "resumed") =>
  context("UserPromptSubmit", `[orchestrator] ${issue} ${how}: run builder:issue-tackle ${issue}`);

/** UserPromptSubmit: mints the session token, then claims or resumes the issue `/codeworks <s>` names (FR-011–FR-014). */
export function run(stdin: string, deps: HookDeps): Promise<HookAnswer> {
  return refusing(async () => {
    const input = readInput("UserPromptSubmit", stdin);
    const repo = await originRepository(input.cwd);
    const onGitHub = orchestratorOnGitHub(input.cwd, repo, deps);
    await ensureSessionToken(repo, deps.now(), { ...deps, onGitHub });
    if (!input.prompt.startsWith("/codeworks")) return PASS;

    const named = new RegExp(GRAMMAR).exec(input.prompt);
    const issue = named === null ? Number.NaN : Number(named[1]);
    if (!Number.isSafeInteger(issue)) return refuse(`a /codeworks prompt is /codeworks <issue number>, matching ${GRAMMAR}`);

    const sessions = sessionsFolder(deps.home);
    const record = readSessionRecord(sessions, input.session_id);
    if (record !== null) {
      if (record.repo !== repo || record.issue !== issue) {
        return refuse(`this session took ${record.repo}#${record.issue}: one session builds one issue; start a new session for ${repo}#${issue}`);
      }
      return step(issue, "resumed");
    }

    const { client, settled } = await onGitHub();
    const decision = decideStart(issue, await gatherStartFacts(client, repo, issue, settled.shared));
    await applyStart(decision, { client, repo, issue, shared: settled.shared, sessions, sessionId: input.session_id });
    if (decision.decision === "refuse") return refuse(decision.reason);
    return step(issue, decision.decision === "start" ? "claimed" : "resumed");
  });
}

if (import.meta.main) await runHook(run);
