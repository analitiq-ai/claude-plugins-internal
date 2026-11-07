import { homedir } from "node:os";
import { isAbsolute } from "node:path";
import { text } from "node:stream/consumers";
import { z } from "zod";

import type { Session } from "../core/commit-pass.ts";
import { tamperId } from "../core/contracts/ledger.ts";
import { GhCredentialRefused } from "../core/git.ts";
import { GitHubPartlyAnswered, GitHubRefused, GitHubUnanswered } from "../core/github.ts";
import { KeyReadRefused } from "../core/keys.ts";
import { BoardNotVisible, LedgerMissing, StateWriteUnsigned } from "../core/state.ts";
import { MintError } from "../core/tokens.ts";
import { CloneFetchFailed, GitHubFetchFailed } from "./check/bare-copy.ts";
import { appendGateLog, type GateLogEntry } from "./session.ts";
import type { ReviewerSettings } from "./settings.ts";

/** A step the hook could not take, refused in every mode: a check that did not run found nothing a mode could let past. */
export class CouldNotRun extends Error {
  constructor(cause: string, next: string, options?: ErrorOptions) {
    super(`could not run: ${cause}; ${next}`, options);
    this.name = "CouldNotRun";
  }
}

/** The next step of a could-not-run that a later hook run may get past as it stands. */
export const RETRY = "retry the step";

/** The next step of a could-not-run that holds until what it names is fixed. */
export const FIX_THEN_RETRY = "fix what it names, then retry the step";

const HELD_UNTIL_FIXED = [GitHubPartlyAnswered, GitHubRefused, GhCredentialRefused, MintError, KeyReadRefused, BoardNotVisible, CloneFetchFailed, GitHubFetchFailed];

/** The next step of the could-not-run `failure` makes, or null when it makes none. */
export function nextStepOf(failure: unknown): string | null {
  if (failure instanceof GitHubUnanswered) return RETRY;
  if (failure instanceof LedgerMissing) return "retry the step once it exists";
  if (failure instanceof StateWriteUnsigned) return `${tamperId(failure.oid)} holds the story until ${failure.release}`;
  return HELD_UNTIL_FIXED.some((named) => failure instanceof named) ? FIX_THEN_RETRY : null;
}

/** `failure` as a could-not-run, its cause put after `what` when given; `failure` itself when it has no next step. */
export function couldNotRunOf(failure: unknown, what?: string): unknown {
  const next = nextStepOf(failure);
  if (next === null) return failure;
  const { message } = failure as Error;
  return new CouldNotRun(what === undefined ? message : `${what}: ${message}`, next, { cause: failure });
}

/** `call`'s value; its failure as `couldNotRunOf` makes it. */
export async function orCouldNotRun<T>(call: Promise<T>, what?: string): Promise<T> {
  try {
    return await call;
  } catch (error) {
    throw couldNotRunOf(error, what);
  }
}

/** The hook input is not one this hook can read. */
export class HookInputRefused extends Error {
  constructor(why: string) {
    super(why);
    this.name = "HookInputRefused";
  }
}

const EVENTS = ["PreToolUse", "PostToolUse", "UserPromptSubmit", "SubagentStart", "SubagentStop", "SessionStart"] as const;
export type HookEvent = (typeof EVENTS)[number];

// Not strict: Claude Code adds fields of its own (transcript_path, tool_input, …). The session id names the session's
// folder.
const Input = z.object({
  session_id: z.uuid(),
  cwd: z.string().refine(isAbsolute, "not an absolute path"),
  hook_event_name: z.enum(EVENTS),
});
export type HookInput = z.infer<typeof Input>;

export function readInput(events: readonly HookEvent[], stdin: string): HookInput {
  let document: unknown;
  try {
    document = JSON.parse(stdin);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new HookInputRefused(`the hook input is not JSON: ${error.message}`);
  }
  const ofEvents = Input.extend({
    hook_event_name: z.enum(EVENTS).refine((event) => events.includes(event), `not ${events.join(" or ")}`),
  });
  const parsed = ofEvents.safeParse(document);
  if (!parsed.success) throw new HookInputRefused(`the hook input: ${z.prettifyError(parsed.error)}`);
  return parsed.data;
}

export type HookAnswer = { code: 0 | 2; stdout: string; stderr: string };

export const PASS: HookAnswer = { code: 0, stdout: "", stderr: "" };

// Claude Code shows a refusal's stderr as one message, so a reason of several lines is folded into one.
function deny(reason: string): HookAnswer {
  return { code: 2, stdout: "", stderr: `reviewer: ${reason.trim().replace(/\s*\n\s*/g, " ")}\n` };
}

/** One hook run: the event it answers, the session whose folder holds its gate.log, when it started, and its clock. */
export type HookRun = { event: HookEvent; session: Session; started: Date; now: () => Date };

function log(run: HookRun, since: Date, entry: Pick<GateLogEntry, "call" | "outcome" | "oid" | "reason">): void {
  const at = run.now();
  appendGateLog(run.session, { at: at.toISOString(), event: run.event, ...entry, ms: at.getTime() - since.getTime() });
}

export type Modes = Pick<ReviewerSettings, "mode" | "claim_checks" | "shim_checks" | "decision_checks">;

// A refusal blocks only when every setting governing it enforces; otherwise it is recorded as would_deny.
function refuseUnder(governing: readonly (keyof Modes)[], run: HookRun, modes: Modes, call: string, reason: string): HookAnswer {
  const denies = governing.every((key) => modes[key] === "enforce");
  log(run, run.started, { call, outcome: denies ? "deny" : "would_deny", reason });
  return denies ? deny(reason) : PASS;
}

/** A refusal that answers to mode alone. */
export function refuse(run: HookRun, modes: Modes, call: string, reason: string): HookAnswer {
  return refuseUnder(["mode"], run, modes, call, reason);
}

export function refuseClaim(run: HookRun, modes: Modes, call: string, reason: string): HookAnswer {
  return refuseUnder(["mode", "claim_checks"], run, modes, call, reason);
}

export function refuseShim(run: HookRun, modes: Modes, call: string, reason: string): HookAnswer {
  return refuseUnder(["mode", "shim_checks"], run, modes, call, reason);
}

export function refuseDecision(run: HookRun, modes: Modes, call: string, reason: string): HookAnswer {
  return refuseUnder(["mode", "decision_checks"], run, modes, call, reason);
}

/** A refusal in every mode: a tamper, a missing ledger, every could-not-run and every ADR-0012 d1 refusal. */
export function block(run: HookRun, call: string, reason: string): HookAnswer {
  log(run, run.started, { call, outcome: "deny", reason });
  return deny(reason);
}

/**
 * `write`, a core write, logged with its latency and the oid it committed, as unchanged when `oidOf` gives null for
 * a write that committed nothing, or with what it threw.
 */
export async function traced<T>(run: HookRun, call: string, write: () => Promise<T>, oidOf: (done: T) => string | null): Promise<T> {
  const before = run.now();
  let done: T;
  try {
    done = await write();
  } catch (error) {
    const failure = error instanceof Error ? error : new Error(String(error));
    log(run, before, { call, outcome: failure.name, reason: failure.message });
    throw error;
  }
  const oid = oidOf(done);
  log(run, before, oid === null ? { call, outcome: "unchanged" } : { call, outcome: "written", oid });
  return done;
}

/** `handle`'s answer, or the block of a step it could not take; any other failure fails the hook. */
export async function refusing(run: HookRun, call: string, handle: () => Promise<HookAnswer>): Promise<HookAnswer> {
  try {
    return await handle();
  } catch (error) {
    if (!(error instanceof CouldNotRun)) throw error;
    return block(run, call, error.message);
  }
}

/** The home folder a hook acts under, and its clock. */
export type HookDeps = { home: string; now: () => Date };

/** `handle`'s answer to an input of one of `events`; an input that cannot be read is denied, with no session to log under. */
export async function answerHook(
  events: readonly HookEvent[],
  stdin: string,
  deps: HookDeps,
  handle: (input: HookInput, run: HookRun) => Promise<HookAnswer>,
): Promise<HookAnswer> {
  let input: HookInput;
  try {
    input = readInput(events, stdin);
  } catch (error) {
    if (!(error instanceof HookInputRefused)) throw error;
    return deny(error.message);
  }
  const run: HookRun = { event: input.hook_event_name, session: { home: deps.home, id: input.session_id }, started: deps.now(), now: deps.now };
  return refusing(run, input.hook_event_name, () => handle(input, run));
}

/** Runs a hook entry's `run` on this process's stdin against the real machine, and exits with its answer. */
export async function runHook(run: (stdin: string, deps: HookDeps) => Promise<HookAnswer>): Promise<void> {
  const { code, stdout, stderr } = await run(await text(process.stdin), { home: homedir(), now: () => new Date() });
  process.stdout.write(stdout);
  process.stderr.write(stderr);
  process.exitCode = code;
}
