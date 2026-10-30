import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { laneOf, LaneRefused, moveCard } from "../src/board.ts";
import { GitHubUnanswered } from "../src/github.ts";
import { Lane } from "../src/values.ts";
import { fakeGitHub, type FakeAnswer, type FakeGitHub } from "./support/fake-github.ts";

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

describe("moveCard", () => {
  const OPTIONS = Lane.schema.options.map((name, index) => ({ id: `option-${index}`, name }));

  function optionOf(lane: Lane): string {
    const option = OPTIONS.find(({ name }) => name === lane);
    assert.ok(option !== undefined, lane);
    return option.id;
  }

  // A card as the move reads it: its item, its project and that project's Status field, each by its node id.
  function movable(url: string, item: string, statusField: unknown = { id: `status-of-${item}`, options: OPTIONS }): unknown {
    return { id: item, project: { id: `project-of-${item}`, url, statusField } };
  }

  function writerOf(items: FakeAnswer, write: FakeAnswer = { updateProjectV2ItemFieldValue: { projectV2Item: { id: "PVTI_board" } } }) {
    return fakeGitHub({
      graphqlPages: [
        {
          when: (query, vars) =>
            query.includes("projectItems") && vars.owner === "acme" && vars.name === "widgets" && vars.number === 7,
          answer: items,
        },
      ],
      graphql: [{ when: (query) => query.includes("updateProjectV2ItemFieldValue"), answer: write }],
    });
  }

  function writes(writer: FakeGitHub): unknown[] {
    return writer.calls.flatMap((call) => (call.kind === "graphql" ? [call.vars] : []));
  }

  for (const lane of Lane.schema.options) {
    it(`writes ${lane}'s option to the Status field of the card on the board, not on another project`, async () => {
      const writer = writerOf([movable(OTHER_BOARD, "PVTI_other"), { id: "PVTI_hidden", project: null }, movable(BOARD, "PVTI_board")]);
      await moveCard(writer, REPO, 7, BOARD, lane);
      assert.deepEqual(writes(writer), [
        { project: "project-of-PVTI_board", item: "PVTI_board", field: "status-of-PVTI_board", option: optionOf(lane) },
      ]);
    });
  }

  for (const [what, items] of [
    ["no card at all", []],
    ["a card on another project only", [movable(OTHER_BOARD, "PVTI_other")]],
    ["a card on a project the writer cannot see only", [{ id: "PVTI_hidden", project: null }]],
  ] as const) {
    it(`refuses as LaneRefused an issue with ${what}, naming the issue and the board, and writes nothing`, async () => {
      const writer = writerOf(items);
      await assert.rejects(moveCard(writer, REPO, 7, BOARD, Lane.schema.enum["In progress"]), (error: unknown) => {
        assert.ok(error instanceof LaneRefused, String(error));
        assert.ok(error.message.includes(`${REPO}#7`), error.message);
        assert.ok(error.message.includes(BOARD), error.message);
        return true;
      });
      assert.deepEqual(writes(writer), []);
    });
  }

  for (const [what, statusField] of [
    ["no option for the lane", { id: "status-of-PVTI_board", options: OPTIONS.filter(({ name }) => name !== Lane.schema.enum.Blocked) }],
    ["a Status field of another type", {}],
    ["no Status field", null],
  ] as const) {
    it(`refuses as LaneRefused a board with ${what}, naming the board and the lane, and writes nothing`, async () => {
      const writer = writerOf([movable(BOARD, "PVTI_board", statusField)]);
      await assert.rejects(moveCard(writer, REPO, 7, BOARD, Lane.schema.enum.Blocked), (error: unknown) => {
        assert.ok(error instanceof LaneRefused, String(error));
        assert.ok(error.message.includes(BOARD), error.message);
        assert.ok(error.message.includes(JSON.stringify(Lane.schema.enum.Blocked)), error.message);
        return true;
      });
      assert.deepEqual(writes(writer), []);
    });
  }

  it("lets GitHubUnanswered through when GitHub does not answer the read, and writes nothing", async () => {
    const writer = writerOf(new GitHubUnanswered("dummy: no answer"));
    await assert.rejects(moveCard(writer, REPO, 7, BOARD, Lane.schema.enum["In progress"]), GitHubUnanswered);
    assert.deepEqual(writes(writer), []);
  });

  it("lets GitHubUnanswered through when GitHub does not answer the write", async () => {
    const writer = writerOf([movable(BOARD, "PVTI_board")], new GitHubUnanswered("dummy: no answer"));
    await assert.rejects(moveCard(writer, REPO, 7, BOARD, Lane.schema.enum["In progress"]), GitHubUnanswered);
  });
});
