// Anything this hook needs past the guard is loaded with `await import(...)`: a static import would be evaluated
// before the guard runs. Type imports are erased, so they load nothing.
import "../lib/guarded.ts";

import type { HookAnswer, HookDeps } from "../lib/hook-io.ts";

const { answerHook, PASS, runHook } = await import("../lib/hook-io.ts");

/** SubagentStart and SubagentStop: allows every input it can read. */
export function run(stdin: string, deps: HookDeps): Promise<HookAnswer> {
  return answerHook(["SubagentStart", "SubagentStop"], stdin, deps, async () => PASS);
}

if (import.meta.main) await runHook(run);
