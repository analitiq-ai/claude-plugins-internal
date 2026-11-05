import { basename, dirname } from "node:path";
import { text } from "node:stream/consumers";

/**
 * PreToolUse on Write and Edit (hooks.json): a spec folder's plan.md or tasks.md gets this reminder as context
 * beside the write's result; every other Write or Edit passes (#309). Context, not a gate (constitution, Delivery
 * Workflow): the hook never exits 2, loads no package and reaches no key or GitHub, and its registration says
 * `onFailure: continue`, so nothing it does holds up a call — the session-wide token hook was dropped on
 * 2026-10-29 for refusing every Bash call when its mint failed (#194, root ADR-0007 option G). No core code runs
 * here, so there is nothing for root ADR-0009 d4's guard to guard.
 */
export const STORY_IS_ONE_PR =
  "planner: a user story is one branch and one PR (org ADR-0003 d2). Its issue admits one story branch, " +
  "<s>-us<k>-<slug> (root ADR-0005 d1); the PR on it closes the story issue from creation (builder ADR-0003 d1), " +
  "and the story is done at that PR's merge (root ADR-0005 d5), so a story planned as several PRs is done at the " +
  "first. Plan no PR under a story: a part of a story that must land at another time is its own story, with its " +
  "own issue (planner ADR-0010 d1) and its own phase in tasks.md (planner ADR-0008 d2).";

const SPEC_DOCUMENTS: ReadonlySet<string> = new Set(["plan.md", "tasks.md"]);

// Any folder named `specs`, at any depth: a session's cwd is often a subfolder or a worktree, so the checkout root
// is not known here without git. The spec folder's own name is not parsed: core maps an issue to its folder (root
// ADR-0005 d2), never a folder to its issue, and this hook is not where a folder-to-issue reading starts.
function isSpecDocument(file: string): boolean {
  return SPEC_DOCUMENTS.has(basename(file)) && basename(dirname(dirname(file))) === "specs";
}

// The registration decides the event and the tools; the hook reads the one field it needs, which Claude Code
// sends absolute for Write and Edit.
function filePathOf(input: unknown): string | undefined {
  const toolInput = (input as { tool_input?: { file_path?: unknown } } | null)?.tool_input;
  return typeof toolInput?.file_path === "string" ? toolInput.file_path : undefined;
}

/** What the hook writes and exits with: 0 with the reminder or nothing, 1 with why it could not read its input. */
export type HookAnswer = { code: 0 | 1; stdout: string; stderr: string };

const PASS: HookAnswer = { code: 0, stdout: "", stderr: "" };

function context(reminder: string): HookAnswer {
  const output = { hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: reminder } };
  return { code: 0, stdout: `${JSON.stringify(output)}\n`, stderr: "" };
}

// Exit 1 is a non-blocking hook error: Claude Code shows the reason as a hook error and lets the call go on.
function report(reason: string): HookAnswer {
  return { code: 1, stdout: "", stderr: `planner: ${reason}\n` };
}

export function run(stdin: string): HookAnswer {
  let input: unknown;
  try {
    input = JSON.parse(stdin);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return report(`the PreToolUse input is not JSON: ${error.message}`);
  }
  const file = filePathOf(input);
  if (file === undefined) return report("the PreToolUse input has no tool_input.file_path");
  return isSpecDocument(file) ? context(STORY_IS_ONE_PR) : PASS;
}

if (import.meta.main) {
  const { code, stdout, stderr } = run(await text(process.stdin));
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = code;
}
