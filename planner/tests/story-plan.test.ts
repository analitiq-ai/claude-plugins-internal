import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { storyPlan, TasksRefused } from "../plugin/lib/story-plan.ts";

// The plan check's ask step reads task lines through core's readTaskLine (R5); the story plan must count the same
// lines as tasks, and the same tag as a task's story.
const PLAN = [
  "# Tasks: retry budget",
  "",
  "## Phase 1: User Story 1 - Retry an upload (Priority: P1)",
  "",
  "- [ ] T001 [US1] Retry once, as [US2] will cap",
  "  - [ ] T002 [US2] an indented line is no task line",
  "- [ ] [US2] neither is a line with no task id",
  "",
  "## Phase 2: User Story 2 - Cap the retries (Priority: P2)",
  "",
  "- [ ] T003 [US2] Cap",
  "",
].join("\n");

describe("storyPlan", () => {
  it("takes a task's story from the tags after its id alone, and skips an indented line and one with no task id", () => {
    assert.deepEqual(
      storyPlan(PLAN).map((story) => story.k),
      [1, 2],
    );
  });

  it("refuses a phase whose task lines are tagged with two stories", () => {
    assert.throws(() => storyPlan(PLAN.replace("- [ ] T003 [US2] Cap", "- [ ] T003 [US2] Cap\n- [ ] T004 [US1] Retry")), TasksRefused);
  });
});
