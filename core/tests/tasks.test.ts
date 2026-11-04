import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { readTaskBlockLabels, readTaskLine, storyTasks, taskBlockLabel, TaskBlockLabelRefused, TaskLineRefused, type StoryTask } from "../src/contracts/tasks.ts";

describe("taskBlockLabel", () => {
  it("is the line Story issue: #<n>", () => {
    assert.equal(taskBlockLabel(12), "Story issue: #12");
  });

  for (const n of [0, -3, 2.5]) {
    it(`refuses ${n}, which is no issue number`, () => {
      assert.throws(() => taskBlockLabel(n), TypeError);
    });
  }
});

describe("readTaskBlockLabels", () => {
  it("maps each phase heading line to the issue on the line directly under it", () => {
    const text = [
      "# Tasks: retry budget",
      "",
      "## Phase 1: Setup",
      "Story issue: #12",
      "",
      "- [ ] T001 Create the folder",
      "",
      "## Phase 2: User Story 1 - Retry an upload (Priority: P1)",
      "Story issue: #13",
      "",
      "- [ ] T002 [US1] Retry once",
      "",
      "## Phase 3: Polish",
      "",
      "- [ ] T003 Tidy",
    ].join("\n");
    assert.deepEqual(
      readTaskBlockLabels(text),
      new Map([
        ["## Phase 1: Setup", 12],
        ["## Phase 2: User Story 1 - Retry an upload (Priority: P1)", 13],
      ]),
    );
  });

  it("is the label of the last line of the text when a phase heading ends it", () => {
    assert.deepEqual(readTaskBlockLabels("## Phase 1: Setup\nStory issue: #4"), new Map([["## Phase 1: Setup", 4]]));
  });

  it("ignores a label that is not directly under a phase heading", () => {
    const text = [
      "## Phase 1: Setup",
      "",
      "Story issue: #12",
      "- [ ] T001 Story issue: #13",
      "## Dependencies & Execution Order",
      "Story issue: #14",
      "### Phase 1 notes",
      "Story issue: #15",
    ].join("\n");
    assert.deepEqual(readTaskBlockLabels(text), new Map());
  });

  for (const line of ["Story issue: 12", "Story issue: #", "Story issue: #012", "Story issue: #12 and #13", "Story issue:  #12", "Story issue: #twelve"]) {
    it(`refuses ${JSON.stringify(line)} under a phase heading, naming the line`, () => {
      assert.throws(
        () => readTaskBlockLabels(`## Phase 1: Setup\n${line}\n`),
        (error: unknown) => {
          assert.ok(error instanceof TaskBlockLabelRefused, String(error));
          assert.ok(error.message.includes(JSON.stringify(line)), error.message);
          assert.ok(error.message.includes("## Phase 1: Setup"), error.message);
          return true;
        },
      );
    });
  }

  it("reads back what taskBlockLabel writes", () => {
    assert.deepEqual(readTaskBlockLabels(`## Phase 3: Polish\n${taskBlockLabel(908)}\n`), new Map([["## Phase 3: Polish", 908]]));
  });
});

describe("readTaskLine", () => {
  it("reads id, tick and [US<k>] story of a task line, [X] and indented ones included", () => {
    const cases: [string, ReturnType<typeof readTaskLine>][] = [
      ["- [ ] T001 Create the folder", { id: "T001", ticked: false, story: null }],
      ["- [x] T002 [P] [US1] Test one retry", { id: "T002", ticked: true, story: 1 }],
      ["- [X] T003 [US2] Cap at three", { id: "T003", ticked: true, story: 2 }],
      ["    - [ ] T1005 [US12] Log each retry", { id: "T1005", ticked: false, story: 12 }],
    ];
    for (const [line, expected] of cases) assert.deepEqual(readTaskLine(line), expected, line);
  });

  it("is null for a line that is no task", () => {
    for (const line of ["", "**Goal**: retry once, as T010 says", "- [P] tasks = different files, no dependencies", "- [ ] T12 Retry with a two-digit id"]) {
      assert.equal(readTaskLine(line), null, line);
    }
  });

  it("reads [US0], [US01] and [us1] as no tag", () => {
    for (const tag of ["[US0]", "[US01]", "[us1]"]) assert.deepEqual(readTaskLine(`- [ ] T010 ${tag} Retry once`), { id: "T010", ticked: false, story: null }, tag);
  });

  it("reads the same tag twice as that story", () => {
    assert.deepEqual(readTaskLine("- [ ] T010 [US2] Retry, as [US2] does"), { id: "T010", ticked: false, story: 2 });
  });

  it("refuses a line tagged with two different stories as TaskLineRefused naming the line", () => {
    const line = "- [ ] T010 [US1] [US2] Retry once";
    assert.throws(
      () => readTaskLine(line),
      (error: unknown) => {
        assert.ok(error instanceof TaskLineRefused, String(error));
        assert.ok(error.message.includes(JSON.stringify(line)), error.message);
        return true;
      },
    );
  });
});

describe("storyTasks", () => {
  const text = [
    "# Tasks: retry budget",
    "",
    "- [ ] T000 [US1] Retry before any phase",
    "",
    "## Phase 1: Setup",
    "Story issue: #12",
    "",
    "- [ ] T001 Create the folder",
    "",
    "## Phase 2: User Story 1 - Retry an upload (Priority: P1)",
    "Story issue: #13",
    "",
    "- [x] T002 [P] [US1] Test one retry",
    "- [ ] T003 Retry once",
    "- [X] T007 [US1] Retry twice, ticked by Spec Kit's implement",
    "  - [ ] T008 [US1] Retry an indented task",
    "",
    "## Phase 3: User Story 2 - Cap the retries (Priority: P2)",
    "Story issue: #14",
    "",
    "- [ ] T004 [US2] Cap at three",
    "",
    "## Phase 4: User Story 12 - Log the retries (Priority: P3)",
    "Story issue: #13",
    "",
    "- [ ] T1005 [US12] Log each retry",
    "",
    "## Phase 5: Polish",
    "",
    "- [ ] T006 Tidy",
  ].join("\n");

  it("reads each line readTaskLine reads as a task in every block labelled #<s>, [X] and indented ones included, with the line as written, in order", () => {
    const expected: StoryTask[] = [
      { id: "T002", ticked: true, story: 1, line: "- [x] T002 [P] [US1] Test one retry" },
      { id: "T003", ticked: false, story: null, line: "- [ ] T003 Retry once" },
      { id: "T007", ticked: true, story: 1, line: "- [X] T007 [US1] Retry twice, ticked by Spec Kit's implement" },
      { id: "T008", ticked: false, story: 1, line: "  - [ ] T008 [US1] Retry an indented task" },
      { id: "T1005", ticked: false, story: 12, line: "- [ ] T1005 [US12] Log each retry" },
    ];
    assert.deepEqual(storyTasks(text, 13), expected);
  });

  it("gives each task line to the issue of its own block only, and a line outside a labelled block to none", () => {
    assert.deepEqual(
      [12, 13, 14].map((s) => storyTasks(text, s).map((task) => task.id)),
      [["T001"], ["T002", "T003", "T007", "T008", "T1005"], ["T004"]],
    );
  });

  it("excludes the lines of a labelled block that are no task", () => {
    const block = [
      "## Phase 1: User Story 1 - Retry an upload (Priority: P1)",
      "Story issue: #13",
      "",
      "**Goal**: retry once, as T010 says",
      "- [research](research.md) says why",
      "- [P] tasks = different files, no dependencies",
      "- [ ] T010 [US1] Retry once",
    ].join("\n");
    assert.deepEqual(storyTasks(block, 13).map((task) => task.id), ["T010"]);
  });

  it("refuses a task line of a labelled block tagged with two different stories, as TaskLineRefused", () => {
    const block = ["## Phase 1: User Story 1 - Retry an upload (Priority: P1)", "Story issue: #13", "", "- [ ] T010 [US1] [US2] Retry once"].join("\n");
    assert.throws(() => storyTasks(block, 13), TaskLineRefused);
  });

  it("ends a labelled block at a ## section that is no phase, not at a ### heading", () => {
    const block = [
      "## Phase 3: User Story 1 - Retry an upload (Priority: P1)",
      "Story issue: #13",
      "",
      "### Tests for User Story 1",
      "",
      "- [ ] T010 [P] [US1] Test one retry",
      "",
      "### Implementation for User Story 1",
      "",
      "- [ ] T011 [US1] Retry once",
      "",
      "## Dependencies & Execution Order",
      "",
      "- [ ] T012 [US1] Retry after the phases",
    ].join("\n");
    assert.deepEqual(storyTasks(block, 13).map((task) => task.id), ["T010", "T011"]);
  });

  it("reads each block's label from under its own heading when phases repeat a heading", () => {
    const repeated = [
      "## Phase 1: Setup",
      "Story issue: #12",
      "",
      "- [ ] T001 Create the folder",
      "",
      "## Phase 1: Setup",
      "Story issue: #13",
      "",
      "- [ ] T002 Retry once",
      "",
      "## Phase 1: Setup",
      "",
      "- [ ] T003 Tidy",
    ].join("\n");
    assert.deepEqual(
      [12, 13].map((s) => storyTasks(repeated, s).map((task) => task.id)),
      [["T001"], ["T002"]],
    );
  });

  it("is [] when no block is labelled #<s>", () => {
    assert.deepEqual(storyTasks(text, 99), []);
    assert.deepEqual(storyTasks("## Phase 1: Setup\n\n- [ ] T001 Create the folder", 13), []);
  });

  describe("under a malformed label", () => {
    const malformed = [
      "## Phase 1: Setup",
      "Story issue: #12",
      "",
      "- [ ] T001 Create the folder",
      "",
      "## Phase 2: User Story 1 - Retry an upload (Priority: P1)",
      "Story issue: 13",
      "",
      "- [ ] T002 [US1] Retry once",
    ].join("\n");

    it("refuses the block meant for #13 as TaskBlockLabelRefused, never as no tasks", () => {
      assert.throws(() => storyTasks(malformed, 13), TaskBlockLabelRefused);
    });

    it("refuses #12's well-labelled block too: one malformed label refuses the whole text", () => {
      assert.throws(() => storyTasks(malformed, 12), TaskBlockLabelRefused);
    });
  });

  for (const s of [0, -1, 2.5, Number.MAX_SAFE_INTEGER + 1]) {
    it(`refuses ${s}, which is no issue number`, () => {
      assert.throws(() => storyTasks(text, s), TypeError);
    });
  }
});
