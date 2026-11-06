import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { commitsAsked, ISSUE, OTHER_PROJECT, REPO, reader, round, SHARED, writer, type Issue } from "../../core/tests/fixtures/state/issue.ts";
import { event, eventCommit, fakeLedger, type FakeLedger } from "../../core/tests/fixtures/state/ledger.ts";
import { importSpecifiers } from "../../core/tests/source-scan.ts";
import { fakeGitHub, type FakeGitHub } from "../../core/tests/support/fake-github.ts";
import type { Snapshot } from "../plugin/core/contracts/snapshot.ts";
import { GitHubRefused, GitHubUnanswered, type GitHubClient } from "../plugin/core/github.ts";
import { emptySnapshot } from "../plugin/core/ledger-fold.ts";
import { tamperId } from "../plugin/core/contracts/ledger.ts";
import { StateWriteUnsigned, writeState, type StateReading } from "../plugin/core/state.ts";
import { CouldNotRun } from "../plugin/lib/hook-io.ts";
import { RunState } from "../plugin/lib/run-state.ts";

const ELSEWHERE = 7;
const ATTEMPTS = 3;
const RETRY = "retry the step";
const FIX_THEN_RETRY = "fix what it names, then retry the step";

type Harness = { ledger: FakeLedger; read: FakeGitHub; out: FakeGitHub; state: RunState; decided: StateReading[] };

/** A ledger holding one commit to another story, read as the session App reads it, and the run's state over it. */
function harness({ issue = {}, attempts = ATTEMPTS, ledger = seeded() }: { issue?: Issue; attempts?: number; ledger?: FakeLedger } = {}): Harness {
  const read = reader(issue, ledger);
  const state = new RunState({ reader: read, repo: REPO, issue: ISSUE, shared: SHARED, attempts });
  return { ledger, read, out: writer(ledger), state, decided: [] };
}

/** The run's state over a reader other than the ledger's. */
function over(reader: GitHubClient): RunState {
  return new RunState({ reader, repo: REPO, issue: ISSUE, shared: SHARED, attempts: ATTEMPTS });
}

/** A reader every call of which throws `failure`. */
function failing(failure: Error): GitHubClient {
  const fail = async (): Promise<never> => {
    throw failure;
  };
  return { rest: fail, restPages: fail, graphql: fail, graphqlPages: fail, now: fail };
}

/** A reader whose every answer is not the shape asked. */
function misanswering(): GitHubClient {
  const any = () => true;
  return fakeGitHub({
    graphql: [{ when: any, answer: { repository: "dummy" } }],
    graphqlPages: [{ when: any, answer: "dummy" }],
    restPagesMatching: [{ when: any, answer: "dummy" }],
  });
}

function seeded(): FakeLedger {
  const ledger = fakeLedger();
  eventCommit(ledger, [event.round(round(1))], { issue: ELSEWHERE });
  return ledger;
}

let landed = 1;

/** A commit to another story's directory. */
function landElsewhere(ledger: FakeLedger): string {
  landed += 1;
  return eventCommit(ledger, [event.round(round(landed))], { issue: ELSEWHERE });
}

/** The story's state with one more round: what each decide here concludes. */
function nextRound(h: Harness) {
  return (reading: StateReading): Snapshot => {
    h.decided.push(reading);
    const current = reading.snapshot ?? emptySnapshot();
    return { ...current, rounds: [...current.rounds, round(current.rounds.length + 1)] };
  };
}

function writeRound(h: Harness) {
  return (reading: StateReading, next: Snapshot) => writeState(h.read, h.out, REPO, ISSUE, SHARED, reading, next, []);
}

/** How many times the story was folded: each fold reads the issue's comments once. */
function folds(read: FakeGitHub): number {
  return read.calls.filter((call) => (call.kind === "graphql" || call.kind === "graphqlPages") && /\bcomments\(/.test(call.query)).length;
}

function roundsOn(h: Harness): number[] {
  return (h.decided.at(-1)?.snapshot?.rounds ?? []).map(({ n }) => n);
}

function couldNotRunNaming(...named: string[]): (error: unknown) => true {
  return (error) => {
    assert.ok(error instanceof CouldNotRun, String(error));
    for (const part of named) assert.ok(error.message.includes(part), error.message);
    return true;
  };
}

/** As couldNotRunNaming, and its next step is `next`. */
function couldNotRunThen(next: string, ...named: string[]): (error: unknown) => true {
  return (error) => {
    couldNotRunNaming(...named)(error);
    assert.ok((error as Error).message.endsWith(`; ${next}`), (error as Error).message);
    return true;
  };
}

describe("RunState (R3, data-model State write step)", () => {
  it("reads state once for the run and decides each later step on the reading the last write returned", async () => {
    const h = harness();
    const first = await h.state.step(nextRound(h), writeRound(h));
    const second = await h.state.step(nextRound(h), writeRound(h));
    assert.equal(folds(h.read), 1);
    assert.equal(h.decided[1], first);
    assert.equal(second.head, h.ledger.head);
    assert.deepEqual(second.snapshot?.rounds.map(({ n }) => n), [1, 2]);
    assert.equal(await h.state.reading(), second);
  });

  it("on StateStale with the story untouched since the reading's head, re-points head and retries the same write, deciding and folding once (qs #27)", async () => {
    const h = harness();
    const decide = nextRound(h);
    const moved: string[] = [];
    const advanced = await h.state.step(
      (reading) => (moved.length === 0 && moved.push(landElsewhere(h.ledger)), decide(reading)),
      writeRound(h),
    );
    assert.equal(h.decided.length, 1);
    assert.equal(folds(h.read), 1);
    const commits = commitsAsked(h.out);
    assert.equal(commits.length, 2);
    assert.equal(commits[1].expectedHeadOid, moved[0]);
    assert.deepEqual({ ...commits[1], expectedHeadOid: commits[0].expectedHeadOid }, commits[0]);
    assert.equal(advanced.head, h.ledger.head);
    assert.deepEqual(advanced.snapshot?.rounds.map(({ n }) => n), [1]);
  });

  it("on StateStale with the story touched, reads again and decides the step again on what landed", async () => {
    const h = harness();
    const decide = nextRound(h);
    const moved: string[] = [];
    const advanced = await h.state.step(
      (reading) => (moved.length === 0 && moved.push(eventCommit(h.ledger, [event.round(round(1))])), decide(reading)),
      writeRound(h),
    );
    assert.equal(h.decided.length, 2);
    assert.equal(folds(h.read), 2);
    assert.equal(h.decided[1].head, moved[0]);
    assert.deepEqual(roundsOn(h), [1]);
    assert.deepEqual(advanced.snapshot?.rounds.map(({ n }) => n), [1, 2]);
  });

  it("awaits an async decide, and on StateStale with the story touched awaits it again on what landed", async () => {
    const h = harness();
    const decide = nextRound(h);
    const moved: string[] = [];
    const advanced = await h.state.step(
      async (reading) => (moved.length === 0 && moved.push(eventCommit(h.ledger, [event.round(round(1))])), decide(reading)),
      writeRound(h),
    );
    assert.equal(h.decided.length, 2);
    assert.equal(h.decided[1].head, moved[0]);
    assert.deepEqual(advanced.snapshot?.rounds.map(({ n }) => n), [1, 2]);
  });

  for (const attempts of [2, 4]) {
    it(`refuses as could not run when ledger moved on each of state_write_attempts = ${attempts} attempts`, async () => {
      const h = harness({ attempts });
      const write = writeRound(h);
      await assert.rejects(
        h.state.step(nextRound(h), (reading, next) => (landElsewhere(h.ledger), write(reading, next))),
        couldNotRunNaming("`ledger` kept moving", "retry the step"),
      );
      assert.equal(commitsAsked(h.out).length, attempts);
    });
  }

  it("refuses as could not run when the served repo has no ledger branch, naming orchestrator README.md step 6", async () => {
    const h = harness({ ledger: fakeLedger({ exists: false }) });
    await assert.rejects(h.state.reading(), couldNotRunNaming("orchestrator README.md step 6"));
    await assert.rejects(h.state.step(nextRound(h), writeRound(h)), couldNotRunNaming("orchestrator README.md step 6"));
    assert.equal(h.decided.length, 0);
  });

  it("refuses as could not run when the reader sees no item of the issue on the board, naming the board, next fix it", async () => {
    const h = harness({ issue: { items: [OTHER_PROJECT] } });
    await assert.rejects(h.state.reading(), couldNotRunThen(FIX_THEN_RETRY, SHARED.board));
  });

  it("refuses as could not run when the write's commit is not GitHub-signed, naming the commit, next the release of the tamper it is", async () => {
    const h = harness();
    h.ledger.nextSignature = null;
    await assert.rejects(h.state.step(nextRound(h), writeRound(h)), (error: unknown) => {
      const oid = String(h.ledger.head);
      couldNotRunNaming(oid)(error);
      const unsigned = (error as Error).cause;
      assert.ok(unsigned instanceof StateWriteUnsigned, `expected the cause StateWriteUnsigned, got ${String(unsigned)}`);
      assert.match(unsigned.release, new RegExp(`Ready move on ${SHARED.board}`));
      return couldNotRunThen(`${tamperId(oid)} holds the story until ${unsigned.release}`)(error);
    });
  });

  it("refuses as could not run when GitHub refuses the reader, on the reading and on a step, next fix it", async () => {
    const refused = new GitHubRefused(401, "POST /graphql: 401 Bad credentials");
    const state = over(failing(refused));
    await assert.rejects(state.reading(), couldNotRunThen(FIX_THEN_RETRY, refused.message));
    await assert.rejects(
      state.step(() => assert.fail("decided with no reading"), () => assert.fail("wrote with no reading")),
      couldNotRunThen(FIX_THEN_RETRY, refused.message),
    );
  });

  it("refuses as could not run when GitHub refuses the write's commit and ledger has not moved, next fix it", async () => {
    const h = harness();
    const refused = new GitHubRefused(403, "POST /graphql: Resource not accessible by integration");
    h.ledger.refuseNext = refused;
    await assert.rejects(h.state.step(nextRound(h), writeRound(h)), couldNotRunThen(FIX_THEN_RETRY, refused.message));
  });

  it("refuses as could not run when GitHub's answer is not the shape asked, on the reading and on a step, next retry", async () => {
    const state = over(misanswering());
    await assert.rejects(state.reading(), couldNotRunThen(RETRY, "not the shape asked"));
    await assert.rejects(
      state.step(() => assert.fail("decided with no reading"), () => assert.fail("wrote with no reading")),
      couldNotRunThen(RETRY, "not the shape asked"),
    );
  });

  it("refuses as could not run when GitHub does not answer, naming what it was asked", async () => {
    const h = harness();
    const unanswered = new GitHubUnanswered("POST /graphql: no answer within 30 s");
    h.ledger.refuseNext = unanswered;
    await assert.rejects(h.state.step(nextRound(h), writeRound(h)), couldNotRunThen(RETRY, unanswered.message));
  });

  it("writes nothing to disk: run-state.ts imports no file system module", () => {
    const file = new URL("../plugin/lib/run-state.ts", import.meta.url);
    const specifiers = importSpecifiers(readFileSync(file, "utf8"), "run-state.ts").map(({ specifier }) => specifier);
    assert.deepEqual(
      specifiers.filter((specifier) => /^(node:)?fs(\/|$)/.test(specifier)),
      [],
    );
  });
});
