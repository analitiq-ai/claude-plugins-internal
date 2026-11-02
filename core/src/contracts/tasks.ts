import { assertIssueNumber } from "../github.ts";

// tasks.md's task-block label (planner ADR-0008 d2): planner writes it, reviewer grades ticks by it (reviewer
// ADR-0010), so its grammar has this one home.
const LABEL_PREFIX = "Story issue:";
const LABEL = /^Story issue: #([1-9][0-9]*)$/;
const PHASE_HEADING = /^## Phase \S/;
// `[ ]` and `[x]` only: reviewer ADR-0010 d1 names a tick as `[ ]` flipped to `[x]`.
const TASK_LINE = /^- \[([ x])\] (T[0-9]{3,})(?= |$)/;
const STORY_TAG = /\[US([1-9][0-9]*)\]/;

export type StoryTask = { id: string; ticked: boolean; story: number | null; line: string };

/** A line under a phase heading that opens as a label but is not one: read as no label, it would be written twice. */
export class TaskBlockLabelRefused extends Error {
  constructor(heading: string, line: string) {
    super(`tasks.md: ${JSON.stringify(line)} under "${heading}" is no task-block label, which reads "${LABEL_PREFIX} #<n>"`);
    this.name = "TaskBlockLabelRefused";
  }
}

/** Spec Kit's `## Phase <n>: <title>`, the heading each task block opens with. */
export function isPhaseHeading(line: string): boolean {
  return PHASE_HEADING.test(line);
}

export function taskBlockLabel(issue: number): string {
  assertIssueNumber(issue);
  return `${LABEL_PREFIX} #${issue}`;
}

/** The issue labelled on `under`, the line directly under `heading`; null when `under` does not open as a label. */
function labelUnder(heading: string, under: string | undefined): number | null {
  if (under === undefined || !under.startsWith(LABEL_PREFIX)) return null;
  const label = LABEL.exec(under);
  if (label === null) throw new TaskBlockLabelRefused(heading, under);
  return Number(label[1]);
}

/** Each phase heading line labelled on the line directly under it, mapped to the label's issue. */
export function readTaskBlockLabels(text: string): ReadonlyMap<string, number> {
  const lines = text.split("\n");
  const labels = new Map<string, number>();
  lines.forEach((heading, i) => {
    if (!isPhaseHeading(heading)) return;
    const issue = labelUnder(heading, lines[i + 1]);
    if (issue !== null) labels.set(heading, issue);
  });
  return labels;
}

/**
 * Each task line of every phase block labelled `#<s>`, in file order. A section that is no phase ends a block.
 * Each block's label is read under its own heading, never looked up by heading text, which two phases can share.
 */
export function storyTasks(text: string, s: number): StoryTask[] {
  assertIssueNumber(s);
  const lines = text.split("\n");
  const tasks: StoryTask[] = [];
  let inStory = false;
  lines.forEach((line, i) => {
    if (isPhaseHeading(line)) inStory = labelUnder(line, lines[i + 1]) === s;
    else if (line.startsWith("## ")) inStory = false;
    else if (inStory) {
      const task = TASK_LINE.exec(line);
      if (task === null) return;
      const tag = STORY_TAG.exec(line);
      tasks.push({ id: task[2], ticked: task[1] === "x", story: tag === null ? null : Number(tag[1]), line });
    }
  });
  return tasks;
}
