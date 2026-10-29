import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { laneOf, LaneRefused } from "../src/board.ts";
import { GitHubUnanswered } from "../src/github.ts";
import { Lane } from "../src/values.ts";
import { fakeGitHub, type FakeAnswer } from "./support/fake-github.ts";

const REPO = "acme/widgets";
const BOARD = "https://github.com/orgs/acme/projects/1";
const OTHER_BOARD = "https://github.com/orgs/acme/projects/2";

function card(url: string, status: string | null): unknown {
  return { project: { url }, status: status === null ? null : { name: status } };
}

// The issue's project items, every page, as GitHub answers them for #7 of acme/widgets alone.
function itemsOf(answer: FakeAnswer) {
  return fakeGitHub({
    graphqlPages: [
      {
        when: (query, vars) =>
          query.includes("projectItems") && vars.owner === "acme" && vars.name === "widgets" && vars.number === 7,
        answer,
      },
    ],
  });
}

describe("laneOf", () => {
  for (const lane of Lane.schema.options) {
    it(`is ${lane} for a card in ${lane} on the board`, async () => {
      assert.equal(await laneOf(itemsOf([card(BOARD, lane)]), REPO, 7, BOARD), lane);
    });
  }

  it("reads the card on the board, not one on another project", async () => {
    const reader = itemsOf([card(OTHER_BOARD, Lane.schema.enum.Ready), card(BOARD, Lane.schema.enum.Blocked)]);
    assert.equal(await laneOf(reader, REPO, 7, BOARD), Lane.schema.enum.Blocked);
  });

  it("is null for an issue with no card on the board", async () => {
    assert.equal(await laneOf(itemsOf([]), REPO, 7, BOARD), null);
    assert.equal(await laneOf(itemsOf([card(OTHER_BOARD, Lane.schema.enum.Backlog)]), REPO, 7, BOARD), null);
  });

  for (const [what, status] of [
    ["a status outside the lanes", "Triage"],
    ["no status", null],
  ] as const) {
    it(`refuses a card on the board with ${what}, naming the board and the status`, async () => {
      await assert.rejects(laneOf(itemsOf([card(BOARD, status)]), REPO, 7, BOARD), (error: unknown) => {
        assert.ok(error instanceof LaneRefused, String(error));
        assert.ok(error.message.includes(BOARD), error.message);
        assert.ok(error.message.includes(JSON.stringify(status)), error.message);
        return true;
      });
    });
  }

  it("lets GitHubUnanswered through when GitHub does not answer", async () => {
    await assert.rejects(laneOf(itemsOf(new GitHubUnanswered("dummy: no answer")), REPO, 7, BOARD), GitHubUnanswered);
  });
});
