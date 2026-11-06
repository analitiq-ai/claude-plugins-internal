import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PathRefused } from "../src/contracts/decision-check.ts";
import { readTaskBlockLabels, readTaskLine, readTaskPaths, taskBlockLabel, TaskBlockLabelRefused, TaskLineRefused } from "../src/contracts/tasks.ts";

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
  it("reads the k of each [US<k>] among the tags after the task id, once, not one in the description", () => {
    assert.deepEqual(readTaskLine("- [ ] T012 [P] [US1] Retry, as [US2] asked"), { stories: [1] });
    assert.deepEqual(readTaskLine("- [x] T013 [US2] [P] Cap"), { stories: [2] });
    assert.deepEqual(readTaskLine("- [X] T014 Tidy"), { stories: [] });
    assert.deepEqual(readTaskLine("- [ ] T015 [US1] [P] [US2] [US1] Both"), { stories: [1, 2] });
  });

  for (const line of ["  - [ ] T004 [US1] indented", "- [ ] [US1] no task id", "- [] T001 [US1] no checkbox", "T001 [US1] no checkbox"]) {
    it(`is null for ${JSON.stringify(line)}, which is no task line`, () => {
      assert.equal(readTaskLine(line), null);
    });
  }

  it("reads [US0] as no story tag", () => {
    assert.deepEqual(readTaskLine("- [ ] T001 [US0] Seed"), { stories: [] });
  });
});

describe("readTaskPaths", () => {
  const rootFiles = new Set(["codeworks.toml", "new.toml"]);
  const tasks = [
    "# Tasks: retry budget",
    "",
    "Run `npm --prefix core test` before and after.",
    "",
    "## Phase 1: Setup",
    "Story issue: #12",
    "",
    "- [ ] T001 Create `core/src/retry.ts` and list it in `codeworks.toml`",
    "",
    "## Phase 2: User Story 1 - Retry an upload (Priority: P1)",
    "",
    "- [x] T002 [US1] Retry once in `core/src/retry.ts`, see https://example.test/x and `adr check`",
    "- [X] T003 [P] [US1] Add `new.toml` and `README.md`",
    "  - [ ] T004 [US1] an indented line is no task line: `core/src/indented.ts`",
    "- [ ] not a task `core/src/untasked.ts`",
    "",
    "## Dependencies",
    "",
    "- [ ] T005 Wire `planner/plugin/scripts/x.ts`",
  ].join("\n");

  it("reads each task line's backticked paths with its line, artifact tasks and story", () => {
    assert.deepEqual(readTaskPaths(tasks, rootFiles), [
      { path: "core/src/retry.ts", artifact: "tasks", line: 8, story: "Phase 1: Setup" },
      { path: "codeworks.toml", artifact: "tasks", line: 8, story: "Phase 1: Setup" },
      { path: "core/src/retry.ts", artifact: "tasks", line: 12, story: "US1" },
      { path: "new.toml", artifact: "tasks", line: 13, story: "US1" },
      { path: "planner/plugin/scripts/x.ts", artifact: "tasks", line: 19, story: "Dependencies" },
    ]);
  });

  it("is [] for a tasks.md whose task lines name no path", () => {
    assert.deepEqual(readTaskPaths("## Phase 1: Setup\n\n- [ ] T001 Run `adr check`\n", rootFiles), []);
  });

  for (const span of ["a/{b,c}.ts", "a/*.ts"]) {
    it(`refuses ${span} as PathRefused naming tasks.md:<line>`, () => {
      assert.throws(
        () => readTaskPaths(`## Phase 1: Setup\n\n- [ ] T001 Change \`${span}\`\n`, rootFiles),
        (error: unknown) => {
          assert.ok(error instanceof PathRefused, String(error));
          assert.ok(error.message.includes("tasks.md:3"), error.message);
          assert.ok(error.message.includes(JSON.stringify(span)), error.message);
          return true;
        },
      );
    });
  }

  it("refuses a task line tagged with two stories, naming tasks.md:<line> and both", () => {
    assert.throws(
      () => readTaskPaths("## Phase 3: Retry\n\n- [ ] T001 [US1] [US2] Create `core/src/a.ts`\n", rootFiles),
      (error: unknown) => {
        assert.ok(error instanceof TaskLineRefused, String(error));
        assert.ok(error.message.startsWith("tasks.md:3: ") && error.message.includes("US1 and US2"), error.message);
        return true;
      },
    );
  });

  it("refuses a task line above every ## heading, naming tasks.md:<line>", () => {
    assert.throws(
      () => readTaskPaths("# Tasks\n- [ ] T001 Create `core/src/a.ts`\n## Phase 1: Setup\n", rootFiles),
      (error: unknown) => {
        assert.ok(error instanceof TaskLineRefused, String(error));
        assert.ok(error.message.includes("tasks.md:2"), error.message);
        return true;
      },
    );
  });
});
