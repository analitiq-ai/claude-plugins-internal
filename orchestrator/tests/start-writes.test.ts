import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { describe, it, type TestContext } from "node:test";

import { GitHubUnanswered } from "../plugin/core/github.ts";
import { sessionsFolder } from "../plugin/core/orchestrator-paths.ts";
import { readSessionRecord } from "../plugin/core/session-record.ts";
import { applyStart, type StartDecision } from "../plugin/lib/start.ts";
import { REPO, tempHome } from "./support/checkout.ts";
import { GITHUB_NOW, READY_STORY, SHARED, storyGitHub, writes } from "./support/story.ts";

const S = READY_STORY.story;
const REASON = "#200's spec PR #33 is open: merge or close it, then an admin moves #212 to Ready";

function harness(t: TestContext, overrides: Parameters<typeof storyGitHub>[1] = {}, story = READY_STORY) {
  const sessions = sessionsFolder(tempHome(t));
  const sessionId = randomUUID();
  const client = storyGitHub(story, overrides);
  const apply = (decision: StartDecision) => applyStart(decision, { client, repo: REPO, issue: S, shared: SHARED, sessions, sessionId });
  return { client, apply, record: () => readSessionRecord(sessions, sessionId), sessions };
}

describe("applyStart", () => {
  it("on a start moves the card to In progress, then records the claim at GitHub's time", async (t) => {
    let recordAtMove: unknown = "not moved";
    const { client, apply, record } = harness(t, {
      moveCard: () => ((recordAtMove = record()), { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_1" } } }),
    });
    await apply({ decision: "start" });
    assert.deepEqual(writes(client.calls), ["lane In progress"]);
    assert.equal(recordAtMove, null);
    assert.deepEqual(record(), { v: 1, repo: REPO, issue: S, taken: "claim", at: GITHUB_NOW });
  });

  it("on a resume writes no lane and no comment, and records the resume", async (t) => {
    const { client, apply, record } = harness(t);
    await apply({ decision: "resume" });
    assert.deepEqual(writes(client.calls), []);
    assert.deepEqual(record(), { v: 1, repo: REPO, issue: S, taken: "resume", at: GITHUB_NOW });
  });

  it("on a keyed refusal posts the reason, then moves the card to Blocked, and records nothing", async (t) => {
    const { client, apply, record } = harness(t);
    await apply({ decision: "refuse", reason: REASON, key: "spec-pr-open-200", blocked: true });
    assert.deepEqual(writes(client.calls), ["comment <!-- codeworks:orchestrator-reason spec-pr-open-200 -->", "lane Blocked"]);
    assert.equal(record(), null);
  });

  it("on a keyed refusal already handled posts nothing and still moves the card to Blocked", async (t) => {
    const handled = {
      databaseId: 901,
      author: { __typename: "Bot", login: "codeworks-orchestrator" },
      body: `<!-- codeworks:orchestrator-reason spec-pr-open-200 -->\n${REASON}`,
      createdAt: "2026-10-29T10:00:00Z",
      lastEditedAt: null,
      url: "https://github.com/acme/widgets/issues/212#issuecomment-901",
    };
    const { client, apply } = harness(t, {}, { ...READY_STORY, comments: [handled] });
    await apply({ decision: "refuse", reason: REASON, key: "spec-pr-open-200", blocked: true });
    assert.deepEqual(writes(client.calls), ["lane Blocked"]);
  });

  it("on a refusal over holds moves the card to Blocked with no comment", async (t) => {
    const { client, apply, record } = harness(t);
    await apply({ decision: "refuse", reason: "#212 is held by open hold h1", key: null, blocked: true });
    assert.deepEqual(writes(client.calls), ["lane Blocked"]);
    assert.equal(record(), null);
  });

  it("on a refusal that writes nothing writes nothing", async (t) => {
    const { client, apply, record, sessions } = harness(t);
    await apply({ decision: "refuse", reason: "#212 is in Backlog", key: null, blocked: false });
    assert.deepEqual(writes(client.calls), []);
    assert.equal(record(), null);
    assert.equal(existsSync(sessions), false);
  });

  it("leaves no record when the lane write fails", async (t) => {
    const { apply, record } = harness(t, { moveCard: new GitHubUnanswered("dummy: no answer") });
    await assert.rejects(apply({ decision: "start" }), GitHubUnanswered);
    assert.equal(record(), null);
  });
});
