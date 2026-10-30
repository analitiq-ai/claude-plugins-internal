import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it, type TestContext } from "node:test";

import { readGhToken } from "../plugin/core/gh-config.ts";
import { readSessionRecord, writeSessionRecord } from "../plugin/core/session-record.ts";
import { MintError } from "../plugin/core/tokens.ts";
import { run } from "../plugin/hooks/prompt.ts";
import { context, PASS, type HookAnswer } from "../plugin/lib/hook-io.ts";
import { ghFolder, sessionsFolder } from "../plugin/lib/paths.ts";
import { REPO, scratchCheckout } from "./support/checkout.ts";
import { hookDeps, hookInput, storeSessionToken } from "./support/hook-run.ts";
import { EDITED_STATE, GITHUB_NOW, READY_STORY, storyGitHub, writes, type Story } from "./support/story.ts";

const { session_id: SESSION_ID } = JSON.parse(readFileSync(new URL("./fixtures/hooks/user-prompt-submit.json", import.meta.url), "utf8")) as {
  session_id: string;
};

const GRAMMAR = "^/codeworks ([1-9][0-9]*)$";

function prompt(t: TestContext, text: string, story: Story = READY_STORY, options: { tokenMinutes?: number; failing?: Error } = {}) {
  const github = storyGitHub(story);
  const harness = hookDeps(t, github, options.failing === undefined ? {} : { session: options.failing });
  if (options.tokenMinutes !== undefined) storeSessionToken(harness.home, options.tokenMinutes);
  const sessions = sessionsFolder(harness.home);
  const answer = (): Promise<HookAnswer> => run(hookInput("user-prompt-submit.json", { cwd: scratchCheckout(t), prompt: text }), harness.deps);
  return { ...harness, github, answer, record: () => readSessionRecord(sessions, SESSION_ID), sessions };
}

const started = (verb: string) => context("UserPromptSubmit", `[orchestrator] 212 ${verb}: run builder:issue-tackle 212`);

describe("the UserPromptSubmit hook", () => {
  it("mints first, then claims a startable Ready story: In progress, a claim record, and the builder step", async (t) => {
    const { home, github, answer, record, mint } = prompt(t, "/codeworks 212");
    assert.deepEqual(await answer(), started("claimed"));
    assert.equal(readGhToken(ghFolder(home))?.repo, REPO);
    assert.deepEqual(mint.calls.map(({ app }) => app), ["orchestrator", "session"]);
    assert.deepEqual(writes(github.calls), ["lane In progress"]);
    assert.deepEqual(record(), { v: 1, repo: REPO, issue: 212, taken: "claim", at: GITHUB_NOW });
  });

  it("refuses the prompt naming core's cause when the mint fails, writing nothing", async (t) => {
    const { github, answer, record } = prompt(t, "/codeworks 212", READY_STORY, { failing: new MintError("dummy cause") });
    assert.deepEqual(await answer(), { code: 2, stdout: "", stderr: "orchestrator: mint failed: dummy cause\n" });
    assert.deepEqual(writes(github.calls), []);
    assert.equal(record(), null);
  });

  it("resumes a story In progress: no lane written, a resume record", async (t) => {
    const { github, answer, record } = prompt(t, "/codeworks 212", { ...READY_STORY, lane: "In progress" }, { tokenMinutes: 30 });
    assert.deepEqual(await answer(), started("resumed"));
    assert.deepEqual(writes(github.calls), []);
    assert.equal(record()?.taken, "resume");
  });

  it("with a record naming the issue, answers the resume without reading GitHub again", async (t) => {
    const { answer, sessions, connects } = prompt(t, "/codeworks 212", READY_STORY, { tokenMinutes: 30 });
    writeSessionRecord(sessions, SESSION_ID, { v: 1, repo: REPO, issue: 212, taken: "claim", at: GITHUB_NOW });
    assert.deepEqual(await answer(), started("resumed"));
    assert.equal(connects(), 0);
  });

  it("with a record naming another issue, refuses naming it", async (t) => {
    const { answer, sessions, connects } = prompt(t, "/codeworks 212", READY_STORY, { tokenMinutes: 30 });
    writeSessionRecord(sessions, SESSION_ID, { v: 1, repo: REPO, issue: 213, taken: "claim", at: GITHUB_NOW });
    const { code, stderr } = await answer();
    assert.equal(code, 2);
    assert.match(stderr, /^orchestrator: .*acme\/widgets#213/);
    assert.equal(connects(), 0);
  });

  for (const text of ["/codeworks", "/codeworks 0", "/codeworks 0212", "/codeworks #212", "/codeworks 212 now", "/codeworks  212", "/codeworksx 212", "/codeworks 99999999999999999999"]) {
    it(`refuses ${JSON.stringify(text)}, naming the grammar`, async (t) => {
      const { answer, record, connects } = prompt(t, text, READY_STORY, { tokenMinutes: 30 });
      const { code, stderr } = await answer();
      assert.equal(code, 2);
      assert.ok(stderr.includes(GRAMMAR), stderr);
      assert.equal(record(), null);
      assert.equal(connects(), 0);
    });
  }

  it("passes any other prompt, after the mint", async (t) => {
    const { home, answer, record } = prompt(t, "fix the failing test");
    assert.deepEqual(await answer(), PASS);
    assert.equal(readGhToken(ghFolder(home))?.repo, REPO);
    assert.equal(record(), null);
  });

  const refusals: [string, Story, string[], RegExp][] = [
    ["a card in Backlog", { ...READY_STORY, lane: "Backlog" }, [], /#212 is in Backlog/],
    ["no card", { ...READY_STORY, lane: null }, [], /no card/],
    ["a blocker not done", { ...READY_STORY, blockers: [201, 202] }, [], /#202/],
    ["a done story", { ...READY_STORY, doneIssues: [201, 212] }, [], /#212 is done/],
    ["sub-issues", { ...READY_STORY, subIssues: [213] }, ["comment <!-- codeworks:orchestrator-reason parent-212 -->", "lane Blocked"], /#213/],
    [
      "an open spec PR",
      { ...READY_STORY, specPrs: [{ number: 33, closed: false, merged: false }] },
      ["comment <!-- codeworks:orchestrator-reason spec-pr-open-200 -->", "lane Blocked"],
      /#33/,
    ],
    ["no merged spec PR", { ...READY_STORY, specPrs: [] }, ["comment <!-- codeworks:orchestrator-reason spec-pr-unmerged-200 -->", "lane Blocked"], /#200/],
    ["a held state", { ...READY_STORY, comments: [EDITED_STATE] }, ["lane Blocked"], /edited reviewer state/],
    ["a held state In review", { ...READY_STORY, lane: "In review", comments: [EDITED_STATE] }, ["lane Blocked"], /edited reviewer state/],
  ];

  for (const [why, story, written, reason] of refusals) {
    it(`refuses ${why} with its reason, writing ${written.length === 0 ? "nothing" : written.join(" then ")}, and records nothing`, async (t) => {
      const { github, answer, record } = prompt(t, "/codeworks 212", story, { tokenMinutes: 30 });
      const { code, stdout, stderr } = await answer();
      assert.deepEqual([code, stdout], [2, ""]);
      assert.match(stderr, /^orchestrator: /);
      assert.match(stderr, reason);
      assert.deepEqual(writes(github.calls), written);
      assert.equal(record(), null);
    });
  }
});
