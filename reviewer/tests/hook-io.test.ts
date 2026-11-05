import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, type TestContext } from "node:test";

import { sessionFolder } from "../plugin/core/commit-pass.ts";
import { tamperId } from "../plugin/core/contracts/ledger.ts";
import { GitHubMisanswered, GitHubRefused, GitHubUnanswered } from "../plugin/core/github.ts";
import { KeyReadRefused } from "../plugin/core/keys.ts";
import { BoardNotVisible, LedgerMissing, StateStale, StateWriteRefused, StateWriteUnsigned } from "../plugin/core/state.ts";
import { MintError } from "../plugin/core/tokens.ts";
import {
  block,
  CouldNotRun,
  FIX_THEN_RETRY,
  HookInputRefused,
  nextStepOf,
  PASS,
  readInput,
  refuse,
  refuseClaim,
  refuseDecision,
  refuseShim,
  refusing,
  RETRY,
  traced,
  type HookAnswer,
  type HookEvent,
  type HookRun,
  type Modes,
} from "../plugin/lib/hook-io.ts";
import type { GateLogEntry } from "../plugin/lib/session.ts";
import { gateLog, SESSION_ID, tempSession } from "./support/session.ts";

const STARTED = new Date("2026-10-30T12:00:00.000Z");
const TICK_MS = 7;

const ENFORCE: Modes = { mode: "enforce", claim_checks: "enforce", shim_checks: "enforce", decision_checks: "enforce" };
const LOG: Modes = { mode: "log", claim_checks: "log", shim_checks: "log", decision_checks: "log" };

/** A run that started at STARTED, on a clock each read of which is TICK_MS later than the one before. */
function hookRun(t: TestContext, event: HookEvent = "PreToolUse"): HookRun {
  let ticks = 0;
  const now = () => new Date(STARTED.getTime() + (ticks += 1) * TICK_MS);
  return { event, session: tempSession(t), started: STARTED, now };
}

function tick(n: number): string {
  return new Date(STARTED.getTime() + n * TICK_MS).toISOString();
}

const DENIED: HookAnswer = { code: 2, stdout: "", stderr: "reviewer: the claim check is pending for 1a2b3c4..5d6e7f8; launch claim-check\n" };
const REASON = "the claim check is pending for 1a2b3c4..5d6e7f8; launch claim-check";

function refusalLogged(outcome: GateLogEntry["outcome"]): GateLogEntry[] {
  return [{ at: tick(1), event: "PreToolUse", call: "Bash", outcome, reason: REASON, ms: TICK_MS }];
}

function sample(name: string): string {
  return readFileSync(new URL(`./fixtures/hooks/${name}.json`, import.meta.url), "utf8");
}

describe("refuse: a refusal that answers to mode alone", () => {
  it("under enforce denies with its reason and logs deny, the call and its latency", (t) => {
    const run = hookRun(t);
    assert.deepEqual(refuse(run, ENFORCE, "Bash", REASON), DENIED);
    assert.deepEqual(gateLog(run.session), refusalLogged("deny"));
  });

  it("under log does not block, and logs would_deny", (t) => {
    const run = hookRun(t);
    assert.deepEqual(refuse(run, LOG, "Bash", REASON), PASS);
    assert.deepEqual(gateLog(run.session), refusalLogged("would_deny"));
  });

  it("answers to mode alone: the per-check settings do not lift it", (t) => {
    const run = hookRun(t);
    assert.deepEqual(refuse(run, { ...LOG, mode: "enforce" }, "Bash", REASON), DENIED);
  });

  it("folds a reason of several lines into one", (t) => {
    const answer = refuse(hookRun(t), ENFORCE, "Bash", "first line\n  second line\n");
    assert.equal(answer.stderr, "reviewer: first line second line\n");
  });
});

describe("block: a tamper, a missing ledger, every could-not-run and every ADR-0012 d1 refusal", () => {
  it("denies with its reason and logs deny", (t) => {
    const run = hookRun(t);
    assert.deepEqual(block(run, "Bash", REASON), DENIED);
    assert.deepEqual(gateLog(run.session), refusalLogged("deny"));
  });
});

describe("a check's refusal answers to mode and to its own setting", () => {
  for (const [name, check, key] of [
    ["claim", refuseClaim, "claim_checks"],
    ["shim", refuseShim, "shim_checks"],
    ["decision", refuseDecision, "decision_checks"],
  ] as const) {
    for (const others of [LOG, ENFORCE]) {
      it(`the ${name} check denies when mode and ${key} both enforce and the other checks are ${others.mode}`, (t) => {
        const run = hookRun(t);
        assert.deepEqual(check(run, { ...others, mode: "enforce", [key]: "enforce" }, "Bash", REASON), DENIED);
        assert.deepEqual(gateLog(run.session), refusalLogged("deny"));
      });
    }

    it(`the ${name} check only logs would_deny when ${key} is log`, (t) => {
      const run = hookRun(t);
      assert.deepEqual(check(run, { ...ENFORCE, [key]: "log" }, "Bash", REASON), PASS);
      assert.deepEqual(gateLog(run.session), refusalLogged("would_deny"));
    });

    it(`the ${name} check only logs would_deny when mode is log`, (t) => {
      const run = hookRun(t);
      assert.deepEqual(check(run, { ...ENFORCE, mode: "log" }, "Bash", REASON), PASS);
      assert.deepEqual(gateLog(run.session), refusalLogged("would_deny"));
    });
  }
});

describe("traced: every core write", () => {
  const OID = "c".repeat(40);

  it("logs the call, the oid it wrote and the write's latency, and returns what the write returned", async (t) => {
    const run = hookRun(t, "PostToolUse");
    const reading = { head: OID };
    assert.equal(await traced(run, "writeState", async () => reading, (done) => done.head), reading);
    assert.deepEqual(gateLog(run.session), [{ at: tick(2), event: "PostToolUse", call: "writeState", outcome: "written", oid: OID, ms: TICK_MS }]);
  });

  it("logs a write that committed nothing as unchanged, with no oid", async (t) => {
    const run = hookRun(t, "PostToolUse");
    const reading = { head: OID };
    assert.equal(await traced(run, "writeState", async () => reading, () => null), reading);
    assert.deepEqual(gateLog(run.session), [{ at: tick(2), event: "PostToolUse", call: "writeState", outcome: "unchanged", ms: TICK_MS }]);
  });

  it("logs a failed write's error name and message as its outcome, and rethrows the error", async (t) => {
    const run = hookRun(t, "PostToolUse");
    const failure = new CouldNotRun("ledger moved", "retry the step");
    await assert.rejects(
      traced(run, "recordGates", () => Promise.reject(failure), () => OID),
      (error) => error === failure,
    );
    assert.deepEqual(gateLog(run.session), [
      { at: tick(2), event: "PostToolUse", call: "recordGates", outcome: "CouldNotRun", reason: failure.message, ms: TICK_MS },
    ]);
  });
});

describe("nextStepOf", () => {
  const OID = "d".repeat(40);
  const RELEASE = "a Ready move on the board and an admin's comment, both after 2026-10-30T12:00:00Z, then the claim";

  for (const [failure, next] of [
    [new GitHubUnanswered("POST /graphql: no answer within 15000 ms"), RETRY],
    [new GitHubMisanswered("GitHub's answer for the ref of ledger is not the shape asked for"), RETRY],
    [new GitHubRefused(401, "POST /graphql: 401 Bad credentials"), FIX_THEN_RETRY],
    [new MintError("the reviewer App is not installed on acme/widgets"), FIX_THEN_RETRY],
    [new KeyReadRefused("/home/dummy/.config/codeworks/reviewer-app.pem", ["no managed settings name reviewer"]), FIX_THEN_RETRY],
    [new BoardNotVisible("https://github.com/orgs/example-org/projects/1"), FIX_THEN_RETRY],
    [new LedgerMissing("acme/widgets"), "retry the step once it exists"],
    [new StateWriteUnsigned(OID, RELEASE), `${tamperId(OID)} holds the story until ${RELEASE}`],
  ] as const) {
    it(`${failure.name}: ${next}`, () => {
      assert.equal(nextStepOf(failure), next);
    });
  }

  // A stale write is the run's own to retry, a refused write the step's own to answer, and anything else core's defect.
  for (const failure of [new StateStale("a".repeat(40), "b".repeat(40)), new StateWriteRefused("dummy", null), new TypeError("dummy"), "dummy"]) {
    it(`${failure instanceof Error ? failure.name : typeof failure}: no next step`, () => {
      assert.equal(nextStepOf(failure), null);
    });
  }
});

describe("refusing", () => {
  it("passes the handler's answer through and logs nothing", async (t) => {
    const run = hookRun(t);
    const answer: HookAnswer = { code: 0, stdout: "dummy\n", stderr: "" };
    assert.equal(await refusing(run, "Bash", async () => answer), answer);
    assert.equal(existsSync(join(sessionFolder(run.session), "gate.log")), false);
  });

  it("denies a could-not-run, naming it, and logs deny", async (t) => {
    const run = hookRun(t);
    const failure = new CouldNotRun("the reviewer App's token was refused", "retry the step");
    assert.equal(failure.message, "could not run: the reviewer App's token was refused; retry the step");
    assert.deepEqual(await refusing(run, "Bash", () => Promise.reject(failure)), {
      code: 2,
      stdout: "",
      stderr: `reviewer: ${failure.message}\n`,
    });
    assert.deepEqual(gateLog(run.session), [{ at: tick(1), event: "PreToolUse", call: "Bash", outcome: "deny", reason: failure.message, ms: TICK_MS }]);
  });

  it("lets any other failure through, so the hook fails rather than answer for it", async (t) => {
    const failure = new TypeError("dummy");
    await assert.rejects(refusing(hookRun(t), "Bash", () => Promise.reject(failure)), (error) => error === failure);
  });
});

describe("readInput", () => {
  for (const [name, event] of [
    ["pre-tool-use", "PreToolUse"],
    ["post-tool-use", "PostToolUse"],
    ["user-prompt-submit", "UserPromptSubmit"],
    ["subagent-start", "SubagentStart"],
    ["subagent-stop", "SubagentStop"],
    ["session-start", "SessionStart"],
  ] as const) {
    it(`reads the session, the checkout and the event of a ${event} input, the fields Claude Code adds besides`, () => {
      assert.deepEqual(readInput([event], sample(name)), { session_id: SESSION_ID, cwd: "/home/agent/work/repo", hook_event_name: event });
    });
  }

  for (const [name, event] of [
    ["subagent-start", "SubagentStart"],
    ["subagent-stop", "SubagentStop"],
  ] as const) {
    it(`reads a ${event} input when given both Subagent events`, () => {
      assert.deepEqual(readInput(["SubagentStart", "SubagentStop"], sample(name)), {
        session_id: SESSION_ID,
        cwd: "/home/agent/work/repo",
        hook_event_name: event,
      });
    });
  }

  for (const [what, stdin, named] of [
    ["an input that is not JSON", "{", "not JSON"],
    ["another event's input", sample("session-start"), "hook_event_name"],
    ["a session_id that is not a UUID, since it names the session's folder", JSON.stringify({ ...JSON.parse(sample("pre-tool-use")), session_id: "../escape" }), "session_id"],
    ["a cwd that is not an absolute path", JSON.stringify({ ...JSON.parse(sample("pre-tool-use")), cwd: "work/repo" }), "cwd"],
  ]) {
    it(`refuses ${what}`, () => {
      assert.throws(
        () => readInput(["PreToolUse"], stdin),
        (error: unknown) => {
          assert.ok(error instanceof HookInputRefused, String(error));
          assert.ok(error.message.includes(named), error.message);
          return true;
        },
      );
    });
  }
});
