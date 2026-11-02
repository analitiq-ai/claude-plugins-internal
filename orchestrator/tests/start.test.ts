import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DerivationError } from "../plugin/core/identity.ts";
import type { StateReading } from "../plugin/core/state.ts";
import type { Lane } from "../plugin/core/values.ts";
import { decideStart, gatherStartFacts, type CardFacts, type StartDecision } from "../plugin/lib/start.ts";
import { REPO } from "./support/checkout.ts";
import { EDITED_STATE, READY_STORY, SHARED, SPEC_MERGE_COMMIT, storyGitHub } from "./support/story.ts";

const S = 212;

const NO_STATE: StateReading = {
  snapshot: null,
  comment_url: null,
  rebuilt: false,
  held: false,
  causes: [],
  newest_round: null,
  pushed_back: new Map(),
  releasable: [],
  tamper_released: false,
  startable: true,
  reset: null,
};

const HELD: StateReading = {
  ...NO_STATE,
  held: true,
  causes: [{ cause: "tampered" }, { cause: "open_hold", id: "h1" }],
  startable: false,
};

// Every start rule holds; each case breaks one.
const STARTABLE: CardFacts = {
  lane: "Ready",
  blockers: [{ issue: 201, done: true }],
  specIssue: 200,
  specPrs: [{ number: 31, state: "merged", mergeCommit: SPEC_MERGE_COMMIT }],
  subIssues: [],
  done: false,
  state: NO_STATE,
};

function decide(facts: Partial<CardFacts>): StartDecision {
  return decideStart(S, { ...STARTABLE, ...facts });
}

function refusal(decision: StartDecision) {
  assert.equal(decision.decision, "refuse");
  return decision as Extract<StartDecision, { decision: "refuse" }>;
}

describe("decideStart", () => {
  it("starts a Ready story whose blockers are done, with a merged spec PR, no sub-issues, not done, and startable", () => {
    assert.deepEqual(decide({}), { decision: "start" });
    assert.deepEqual(decide({ blockers: [], specIssue: S }), { decision: "start" });
  });

  it("starts a Ready story whose newest spec PR is closed unmerged over an older merged one", () => {
    assert.deepEqual(decide({ specPrs: [{ number: 35, state: "closed", mergeCommit: null }, { number: 31, state: "merged", mergeCommit: SPEC_MERGE_COMMIT }] }), { decision: "start" });
  });

  it("starts over open holds a start releases, since the reading still answers startable", () => {
    assert.deepEqual(decide({ state: { ...HELD, startable: true } }), { decision: "start" });
  });

  for (const lane of ["In progress", "In review"] as const) {
    it(`resumes ${lane} whose state is not held, writing no lane`, () => {
      assert.deepEqual(decide({ lane }), { decision: "resume" });
    });

    it(`refuses ${lane} whose state is held, moving it to Blocked with no comment and naming the holds`, () => {
      const decision = refusal(decide({ lane, state: HELD }));
      assert.equal(decision.blocked, true);
      assert.equal(decision.key, null);
      assert.match(decision.reason, /h1/);
      assert.match(decision.reason, /edited/);
    });
  }

  it("refuses a Ready story that is not startable, moving it to Blocked with no comment and naming the holds", () => {
    const decision = refusal(decide({ state: HELD }));
    assert.equal(decision.blocked, true);
    assert.equal(decision.key, null);
    assert.match(decision.reason, /h1/);
  });

  it("refuses a Ready story with a spec PR open over a merged one, posting spec-pr-open-<p> naming it, then moving it to Blocked", () => {
    const decision = refusal(decide({ specPrs: [{ number: 33, state: "open", mergeCommit: null }, { number: 31, state: "merged", mergeCommit: SPEC_MERGE_COMMIT }] }));
    assert.equal(decision.key, "spec-pr-open-200");
    assert.equal(decision.blocked, true);
    assert.match(decision.reason, /#33/);
    assert.doesNotMatch(decision.reason, /#31/);
  });

  for (const specPrs of [[], [{ number: 35, state: "closed" as const, mergeCommit: null }, { number: 33, state: "closed" as const, mergeCommit: null }]]) {
    it(`refuses a Ready story with no merged spec PR (${specPrs.length} closed), posting spec-pr-unmerged-<p>`, () => {
      const decision = refusal(decide({ specPrs }));
      assert.equal(decision.key, "spec-pr-unmerged-200");
      assert.equal(decision.blocked, true);
      assert.match(decision.reason, /#200/);
    });
  }

  it("refuses a Ready story with sub-issues, posting parent-<s> naming them, then moving it to Blocked", () => {
    const decision = refusal(decide({ subIssues: [213, 214] }));
    assert.equal(decision.key, `parent-${S}`);
    assert.equal(decision.blocked, true);
    assert.match(decision.reason, /#213, #214/);
  });

  for (const lane of ["Backlog", "Blocked", "Done"] as const satisfies Lane[]) {
    it(`refuses a card in ${lane}, writing nothing and naming the lane`, () => {
      const decision = refusal(decide({ lane }));
      assert.deepEqual([decision.key, decision.blocked], [null, false]);
      assert.match(decision.reason, new RegExp(lane));
    });
  }

  it("refuses an issue with no card on the board, writing nothing", () => {
    const decision = refusal(decideStart(S, { lane: null }));
    assert.deepEqual([decision.key, decision.blocked], [null, false]);
    assert.match(decision.reason, /no card/);
  });

  it("refuses a Ready story with a blocker not done, writing nothing and naming it", () => {
    const decision = refusal(decide({ blockers: [{ issue: 201, done: true }, { issue: 202, done: false }] }));
    assert.deepEqual([decision.key, decision.blocked], [null, false]);
    assert.match(decision.reason, /#202/);
    assert.doesNotMatch(decision.reason, /#201/);
  });

  it("refuses a Ready story that is done, writing nothing", () => {
    const decision = refusal(decide({ done: true }));
    assert.deepEqual([decision.key, decision.blocked], [null, false]);
    assert.match(decision.reason, /done/);
  });

  it("refuses a rule that writes nothing before one that writes, and a parent before its spec PR", () => {
    const allBroken = { subIssues: [213], specPrs: [], state: HELD };
    assert.equal(refusal(decide({ ...allBroken, done: true })).blocked, false);
    assert.equal(refusal(decide({ ...allBroken, blockers: [{ issue: 202, done: false }] })).blocked, false);
    assert.equal(refusal(decide(allBroken)).key, `parent-${S}`);
    assert.equal(refusal(decide({ specPrs: [], state: HELD })).key, "spec-pr-unmerged-200");
  });
});

describe("gatherStartFacts", () => {
  const stateReads = (client: ReturnType<typeof storyGitHub>) =>
    client.calls.filter((call) => call.kind === "graphqlPages" && call.query.includes("comments(")).length;

  it("reads the lane, each blocker done or not, the spec's issue and every spec PR newest first, the sub-issues, done, and the state", async () => {
    const client = storyGitHub({ ...READY_STORY, blockers: [201, 202], specPrs: [{ number: 31, closed: true, merged: true, mergeCommit: SPEC_MERGE_COMMIT }, { number: 33, closed: false, merged: false, mergeCommit: null }] });
    const facts = await gatherStartFacts(client, REPO, 212, SHARED);
    assert.ok(facts.lane !== null);
    const { state, ...rest } = facts as CardFacts;
    assert.deepEqual(rest, {
      lane: "Ready",
      blockers: [
        { issue: 201, done: true },
        { issue: 202, done: false },
      ],
      specIssue: 200,
      specPrs: [
        { number: 33, state: "open", mergeCommit: null },
        { number: 31, state: "merged", mergeCommit: SPEC_MERGE_COMMIT },
      ],
      subIssues: [],
      done: false,
    });
    assert.deepEqual([state.held, state.startable], [false, true]);
  });

  it("reads the story as its own spec's issue when it has no parent", async () => {
    const facts = (await gatherStartFacts(storyGitHub({ ...READY_STORY, parent: null }), REPO, 212, SHARED)) as CardFacts;
    assert.equal(facts.specIssue, 212);
  });

  it("reads the state once, held when core reads it so", async () => {
    const client = storyGitHub({ ...READY_STORY, comments: [EDITED_STATE] });
    const facts = (await gatherStartFacts(client, REPO, 212, SHARED)) as CardFacts;
    assert.deepEqual([facts.state.held, facts.state.startable], [true, false]);
    assert.equal(stateReads(client), 1);
  });

  it("reads nothing past the lane of an issue with no card on the board", async () => {
    const client = storyGitHub({ ...READY_STORY, lane: null });
    assert.deepEqual(await gatherStartFacts(client, REPO, 212, SHARED), { lane: null });
    assert.equal(client.calls.length, 1);
  });

  it("lets a fact core cannot derive through", async () => {
    const client = storyGitHub(READY_STORY);
    const foreign = { number: 7, repository: { id: "R_gadgets", nameWithOwner: "acme/gadgets" } };
    await assert.rejects(
      gatherStartFacts(
        { ...client, graphqlPages: async (query, vars, path) => (query.includes("blockedBy(") ? [foreign] : client.graphqlPages(query, vars, path)) },
        REPO,
        212,
        SHARED,
      ),
      DerivationError,
    );
  });
});
