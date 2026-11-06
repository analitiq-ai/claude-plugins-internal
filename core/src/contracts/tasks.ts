import { assertIssueNumber } from "../github.ts";
import { CheckedArtifact } from "../values.ts";
import { type ArtifactPath, artifactPath, PathRefused } from "./decision-check.ts";

// tasks.md's task-block label (planner ADR-0008 d2): planner writes it, reviewer grades ticks by it (reviewer
// ADR-0010), so its grammar has this one home.
const LABEL_PREFIX = "Story issue:";
const LABEL = /^Story issue: #([1-9][0-9]*)$/;
const PHASE_HEADING = /^## Phase \S/;

/** A line under a phase heading that opens as a label but is not one: read as no label, it would be written twice. */
export class TaskBlockLabelRefused extends Error {
  readonly why: string;
  constructor(heading: string, line: string) {
    const why = `${JSON.stringify(line)} under "${heading}" is no task-block label, which reads "${LABEL_PREFIX} #<n>"`;
    super(`tasks.md: ${why}`);
    this.name = "TaskBlockLabelRefused";
    this.why = why;
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

/** Each phase heading line labelled on the line directly under it, mapped to the label's issue. */
export function readTaskBlockLabels(text: string): ReadonlyMap<string, number> {
  const lines = text.split("\n");
  const labels = new Map<string, number>();
  lines.forEach((heading, i) => {
    const under = lines[i + 1];
    if (!isPhaseHeading(heading) || under === undefined || !under.startsWith(LABEL_PREFIX)) return;
    const label = LABEL.exec(under);
    if (label === null) throw new TaskBlockLabelRefused(heading, under);
    labels.set(heading, Number(label[1]));
  });
  return labels;
}

/** A task line the check cannot place under a story. */
export class TaskLineRefused extends Error {
  readonly where: string;
  readonly why: string;
  constructor(line: number, why: string) {
    super(`tasks.md:${line}: ${why}`);
    this.name = "TaskLineRefused";
    this.where = `tasks.md:${line}`;
    this.why = why;
  }
}

// `- [ ] T012 [P] [US1] …`: the tags follow the task id, so a `[US2]` in the description names no story.
const TASK_LINE = /^- \[[ xX]\] T[0-9]+((?: \[[^\]]+\])*)/;
const STORY_TAG = /\[(US[0-9]+)\]/;
const BACKTICK_SPAN = /`([^`]+)`/g;
const HEADING = "## ";

/** Each task line's paths, one per backticked span `artifactPath` reads as a path; its story is its `[US<k>]` tag,
 *  else the `## ` heading above it. */
export function readTaskPaths(tasksText: string, rootFiles: ReadonlySet<string>): ArtifactPath[] {
  const paths: ArtifactPath[] = [];
  let heading: string | null = null;
  tasksText.split("\n").forEach((text, i) => {
    const line = i + 1;
    if (text.startsWith(HEADING)) heading = text.slice(HEADING.length);
    const task = TASK_LINE.exec(text);
    if (task === null) return;
    if (heading === null) throw new TaskLineRefused(line, `a task line above every "${HEADING}" heading belongs to no story`);
    const story = STORY_TAG.exec(task[1])?.[1] ?? heading;
    for (const [, span] of text.matchAll(BACKTICK_SPAN)) {
      let path: string | null;
      try {
        path = artifactPath(span, rootFiles);
      } catch (error) {
        if (!(error instanceof PathRefused)) throw error;
        throw new PathRefused(error.span, error.why, `tasks.md:${line}`);
      }
      if (path !== null) paths.push({ path, artifact: CheckedArtifact.schema.enum.tasks, line, story });
    }
  });
  return paths;
}
