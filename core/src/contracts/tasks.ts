import { assertIssueNumber } from "../github.ts";
import { CheckedArtifact } from "../values.ts";
import { type ArtifactPath, artifactPath, PathRefused } from "./decision-check.ts";

// tasks.md's grammar has this one home: the task-block label (planner ADR-0008 d2), which planner writes and
// reviewer grades ticks by (reviewer ADR-0010), and the task lines planner's ADR check reads paths from (planner
// ADR-0009, artifact-grammar.md).
const LABEL_PREFIX = "Story issue:";
const LABEL = /^Story issue: #([1-9][0-9]*)$/;
const PHASE_HEADING = /^## Phase \S/;
const HEADING = "## ";
const TASK_LINE = /^- \[[ xX]\] T[0-9]+\b/;
const STORY_TAG = /\[US([1-9][0-9]*)\]/g;
const SPAN = /`([^`]+)`/g;

const lineOf = (line: number): string => `tasks.md:${line}`;

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

/** A task line tasks.md's grammar refuses, other than for a span `artifactPath` refuses. */
export class TaskLineRefused extends Error {
  readonly at: string;
  readonly why: string;

  constructor(line: number, why: string) {
    super(`${lineOf(line)}: ${why}`);
    this.name = "TaskLineRefused";
    this.at = lineOf(line);
    this.why = why;
  }
}

/** Spec Kit's `## Phase <n>: <title>`, the heading each task block opens with. */
export function isPhaseHeading(line: string): boolean {
  return PHASE_HEADING.test(line);
}

/** A line opening `- [ ] T<n>` or `- [x] T<n>`, in any case of x. */
export function isTaskLine(line: string): boolean {
  return TASK_LINE.test(line);
}

/** Each story `line` is tagged with, `k` of each `[US<k>]`, in order. */
export function storyTags(line: string): number[] {
  return [...line.matchAll(STORY_TAG)].map(([, k]) => Number(k));
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

/** Pure: each task line's paths (artifact-grammar.md), `story` its `[US<k>]` tag, else the text, without `## `, of the
 *  last phase heading above it. Throws PathRefused at `tasks.md:<line>`, and TaskLineRefused for a task line above
 *  every phase heading. */
export function readTaskPaths(tasksText: string, rootFiles: ReadonlySet<string>): ArtifactPath[] {
  const paths: ArtifactPath[] = [];
  let phase: string | null = null;
  for (const [i, line] of tasksText.split("\n").entries()) {
    if (isPhaseHeading(line)) phase = line.slice(HEADING.length);
    if (!isTaskLine(line)) continue;
    const at = i + 1;
    if (phase === null) throw new TaskLineRefused(at, "a task line above every phase heading");
    const [k] = storyTags(line);
    const story = k === undefined ? phase : `US${k}`;
    for (const [, span] of line.matchAll(SPAN)) {
      const path = spanPath(span, rootFiles, at);
      if (path !== null) paths.push({ path, artifact: CheckedArtifact.schema.enum.tasks, line: at, story });
    }
  }
  return paths;
}

function spanPath(span: string, rootFiles: ReadonlySet<string>, line: number): string | null {
  try {
    return artifactPath(span, rootFiles);
  } catch (error) {
    if (!(error instanceof PathRefused)) throw error;
    throw new PathRefused(error.span, error.why, lineOf(line));
  }
}
