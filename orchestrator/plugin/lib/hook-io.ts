import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { text } from "node:stream/consumers";
import { z } from "zod";

import { LaneRefused } from "../core/board.ts";
import { GhFolderRefused } from "../core/gh-config.ts";
import { GitFailed } from "../core/git.ts";
import { gitHub, GitHubPartlyAnswered, GitHubRefused, GitHubUnanswered, RemoteRefused, type GitHubClient } from "../core/github.ts";
import { DerivationError } from "../core/identity.ts";
import { KeyReadRefused } from "../core/keys.ts";
import { SessionRecordRefused } from "../core/session-record.ts";
import { SettingsError } from "../core/settings.ts";
import { BoardNotVisible, LedgerMissing } from "../core/state.ts";
import { mintToken, MintError } from "../core/tokens.ts";

/** The hook input does not hold, or does not type, a field the hook reads. */
export class HookInputRefused extends Error {
  constructor(why: string) {
    super(why);
    this.name = "HookInputRefused";
  }
}

// The session id names the session's record file, and the cwd is the checkout every git call runs in.
const common = { session_id: z.uuid(), cwd: z.string().refine(isAbsolute, "not an absolute path") };

// Not strict: Claude Code adds fields of its own (transcript_path, prompt_id, permission_mode, …).
const INPUTS = {
  SessionStart: z.object({ ...common, hook_event_name: z.literal("SessionStart") }),
  UserPromptSubmit: z.object({ ...common, hook_event_name: z.literal("UserPromptSubmit"), prompt: z.string() }),
  PreToolUse: z.object({ ...common, hook_event_name: z.literal("PreToolUse"), tool_name: z.literal("Bash") }),
  Stop: z.object({
    ...common,
    hook_event_name: z.literal("Stop"),
    background_tasks: z.array(z.object({ type: z.string(), status: z.string() })).optional(),
  }),
};

export type HookEvent = keyof typeof INPUTS;
export type HookInput<Event extends HookEvent> = z.infer<(typeof INPUTS)[Event]>;

export function readInput<Event extends HookEvent>(event: Event, stdin: string): HookInput<Event> {
  let document: unknown;
  try {
    document = JSON.parse(stdin);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HookInputRefused(`the ${event} input is not JSON: ${error.message}`);
  }
  const parsed = INPUTS[event].safeParse(document);
  if (!parsed.success) throw new HookInputRefused(`the ${event} input: ${z.prettifyError(parsed.error)}`);
  return parsed.data as HookInput<Event>;
}

export type HookAnswer = { code: 0 | 2; stdout: string; stderr: string };

export const PASS: HookAnswer = { code: 0, stdout: "", stderr: "" };

// Claude Code shows a refusal's stderr as one message, so a reason of several lines is folded into one.
export function refuse(reason: string): HookAnswer {
  return { code: 2, stdout: "", stderr: `orchestrator: ${reason.trim().replace(/\s*\n\s*/g, " ")}\n` };
}

export function context(event: HookEvent, text: string): HookAnswer {
  return { code: 0, stdout: `${JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: text } })}\n`, stderr: "" };
}

const NAMED_FAILURES = [
  HookInputRefused,
  MintError,
  KeyReadRefused,
  GhFolderRefused,
  GitHubRefused,
  GitHubUnanswered,
  GitHubPartlyAnswered,
  SettingsError,
  RemoteRefused,
  GitFailed,
  LaneRefused,
  DerivationError,
  BoardNotVisible,
  LedgerMissing,
  SessionRecordRefused,
];

/** The message of a failure core names a cause for, which a hook refuses with; null for one it crashes on. */
export function refusalOf(error: unknown): string | null {
  return NAMED_FAILURES.some((failure) => error instanceof failure) ? (error as Error).message : null;
}

/** `hook`'s answer, or the refusal of a failure core names a cause for; any other failure crashes the hook. */
export async function refusing(hook: () => Promise<HookAnswer>): Promise<HookAnswer> {
  try {
    return await hook();
  } catch (error) {
    const reason = refusalOf(error);
    if (reason === null) throw error;
    return refuse(reason);
  }
}

/** The machine and GitHub a hook acts on; a test hands in a temp home, a clock, and fakes of the rest. */
export type HookDeps = {
  home: string;
  now: () => Date;
  mintToken: typeof mintToken;
  connect: (token: string) => GitHubClient;
};

/** Runs a hook entry's `run` on this process's stdin against the real machine and GitHub, and exits with its answer. */
export async function runHook(run: (stdin: string, deps: HookDeps) => Promise<HookAnswer>): Promise<void> {
  const { code, stdout, stderr } = await run(await text(process.stdin), {
    home: homedir(),
    now: () => new Date(),
    mintToken,
    connect: (token) => gitHub(token),
  });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = code;
}
