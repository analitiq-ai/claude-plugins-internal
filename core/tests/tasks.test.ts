import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PathRefused } from "../src/contracts/decision-check.ts";
import { readTaskBlockLabels, readTaskPaths, taskBlockLabel, TaskBlockLabelRefused, TaskLineRefused } from "../src/contracts/tasks.ts";

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

// Spec 177, US3 (T030): artifact-grammar.md's tasks.md task lines, each story per core.md's readTaskPaths.
describe("readTaskPaths", () => {
  const ROOT_FILES: ReadonlySet<string> = new Set(["codeworks.toml", "README.md"]);

  function refusedAt(line: number, ...named: string[]): (error: unknown) => true {
    return (error) => {
      assert.ok(error instanceof Error, String(error));
      for (const name of [`tasks.md:${line}`, ...named]) assert.ok(error.message.includes(name), `${name} not named: ${error.message}`);
      return true;
    };
  }

  it("reads each backticked PATH of every task line, open or ticked, as the tasks' with its line and story", () => {
    const text = [
      "# Tasks: retry budget", //                                                        1
      "", //                                                                             2
      "## Phase 1: Setup", //                                                            3
      "", //                                                                             4
      "- [ ] T001 Create `core/src/budget.ts` and `core/tests/budget.test.ts`", //       5
      "", //                                                                             6
      "## Phase 3: User Story 2 - Cap the retries (Priority: P2)", //                    7
      "- [x] T002 [P] [US2] Cap in `core/src/budget.ts`", //                             8
      "- [X] T003 [US2] Test the cap in `core/tests/budget.test.ts`", //                 9
      "", //                                                                             10
      "## Phase 4: Polish", //                                                           11
      "- [ ] T004 Tidy `planner/plugin/lib/x.ts`", //                                    12
    ].join("\n");
    assert.deepEqual(readTaskPaths(text, ROOT_FILES), [
      { path: "core/src/budget.ts", artifact: "tasks", line: 5, story: "Phase 1: Setup" },
      { path: "core/tests/budget.test.ts", artifact: "tasks", line: 5, story: "Phase 1: Setup" },
      { path: "core/src/budget.ts", artifact: "tasks", line: 8, story: "US2" },
      { path: "core/tests/budget.test.ts", artifact: "tasks", line: 9, story: "US2" },
      { path: "planner/plugin/lib/x.ts", artifact: "tasks", line: 12, story: "Phase 4: Polish" },
    ]);
  });

  it("reads a root file rootFiles holds as a path, and a command, a URL or another root word as none", () => {
    const text = [
      "## Phase 2: Foundational",
      "- [ ] T001 Add the key to `codeworks.toml`, run `adr check`, see `https://github.com/acme/widgets/issues/7`",
      "- [ ] T002 Bump `package.json`",
    ].join("\n");
    assert.deepEqual(readTaskPaths(text, ROOT_FILES), [
      { path: "codeworks.toml", artifact: "tasks", line: 2, story: "Phase 2: Foundational" },
    ]);
  });

  it("ignores every line that is no task line, backticked paths and all", () => {
    const text = [
      "# Tasks: `core/src/title.ts`",
      "Prose naming `core/src/prose.ts` before any heading",
      "## Phase 1: Setup",
      "Prose naming `core/src/under.ts`",
      "- A bullet naming `core/src/bullet.ts`",
      "- [ ] A box with no task id naming `core/src/box.ts`",
      "## Dependencies & Execution Order",
      "- Setup names `core/src/after.ts`",
    ].join("\n");
    assert.deepEqual(readTaskPaths(text, ROOT_FILES), []);
  });

  for (const span of ["a/{b,c}.ts", "a/*.ts"]) {
    it(`refuses ${JSON.stringify(span)} as PathRefused at tasks.md:<line>, naming it`, () => {
      const text = ["## Phase 1: Setup", "", `- [ ] T001 Write \`${span}\``].join("\n");
      assert.throws(
        () => readTaskPaths(text, ROOT_FILES),
        (error: unknown) => {
          assert.ok(error instanceof PathRefused, String(error));
          return refusedAt(3, span)(error);
        },
      );
    });
  }

  const ABOVE_EVERY_PHASE = "a task line above every phase heading";

  it("refuses a task line above every ## heading, under the title, naming tasks.md:<line>", () => {
    const text = ["# Tasks: retry budget", "", "- [ ] T001 Create `core/src/budget.ts`", "## Phase 1: Setup"].join("\n");
    assert.throws(() => readTaskPaths(text, ROOT_FILES), refusedAt(3, ABOVE_EVERY_PHASE));
  });

  it("refuses a task line under a ## heading that is no phase heading, above every phase heading", () => {
    const text = [
      "# Tasks: retry budget", //                               1
      "", //                                                    2
      "## Format: `[ID] [P?] [Story] Description`", //          3
      "", //                                                    4
      "- [ ] T001 Create `core/src/budget.ts`", //              5
      "", //                                                    6
      "## Phase 1: Setup", //                                   7
    ].join("\n");
    assert.throws(
      () => readTaskPaths(text, ROOT_FILES),
      (error: unknown) => {
        assert.ok(error instanceof TaskLineRefused, String(error));
        return refusedAt(5, ABOVE_EVERY_PHASE)(error);
      },
    );
  });

  it("gives an untagged task under a later ## heading that is no phase heading the last phase heading as its story", () => {
    const text = [
      "## Phase 3: User Story 1",
      "- [ ] T003 [US1] Write `core/src/one.ts`",
      "",
      "## Phase 4: Polish",
      "- [ ] T004 Tidy `planner/plugin/lib/x.ts`",
      "",
      "## Dependencies & Execution Order",
      "- [ ] T005 Order `core/src/order.ts`",
    ].join("\n");
    assert.deepEqual(readTaskPaths(text, ROOT_FILES), [
      { path: "core/src/one.ts", artifact: "tasks", line: 2, story: "US1" },
      { path: "planner/plugin/lib/x.ts", artifact: "tasks", line: 5, story: "Phase 4: Polish" },
      { path: "core/src/order.ts", artifact: "tasks", line: 8, story: "Phase 4: Polish" },
    ]);
  });

  it("reads a task line naming no path as no path", () => {
    assert.deepEqual(readTaskPaths("## Phase 1: Setup\n- [ ] T001 Think it over\n", ROOT_FILES), []);
  });
});
