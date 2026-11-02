import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import { readTaskBlockLabels, storyTasks, taskBlockLabel, TaskBlockLabelRefused, type StoryTask } from "../src/contracts/tasks.ts";
import { readParameterViolations } from "./source-scan.ts";

const core = join(dirname(fileURLToPath(import.meta.url)), "..");
const tasksModule = join(core, "src", "contracts", "tasks.ts");

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

  it("reads id, tick, [US<k>] story and the line as written of each task line in every block labelled #<s>, in order", () => {
    const expected: StoryTask[] = [
      { id: "T002", ticked: true, story: 1, line: "- [x] T002 [P] [US1] Test one retry" },
      { id: "T003", ticked: false, story: null, line: "- [ ] T003 Retry once" },
      { id: "T1005", ticked: false, story: 12, line: "- [ ] T1005 [US12] Log each retry" },
    ];
    assert.deepEqual(storyTasks(text, 13), expected);
  });

  it("gives each task line to the issue of its own block only, and a line outside a labelled block to none", () => {
    assert.deepEqual(
      [12, 13, 14].map((s) => storyTasks(text, s).map((task) => task.id)),
      [["T001"], ["T002", "T003", "T1005"], ["T004"]],
    );
  });

  it("excludes the lines of a labelled block that are no task line, a T id of under 3 digits among them", () => {
    const block = [
      "## Phase 1: User Story 1 - Retry an upload (Priority: P1)",
      "Story issue: #13",
      "",
      "**Goal**: retry once, as T010 says",
      "- [ ] Retry with no task id",
      "- T011 [US1] Retry with no checkbox",
      "- [ ] T12 [US1] Retry under a two-digit id",
      "- [ ] T010 [US1] Retry once",
    ].join("\n");
    assert.deepEqual(storyTasks(block, 13).map((task) => task.id), ["T010"]);
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

  it("takes no key reader: only GitHub's client and plain values", () => {
    assert.deepEqual(readParameterViolations(readFileSync(tasksModule, "utf8"), relative(core, tasksModule), "storyTasks"), []);
  });
});
