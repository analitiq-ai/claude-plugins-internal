// The checks landing makes of tasks.md and of the spec issue's sub-issues, pure, so the check loop's stories step
// makes the same ones land.ts does (R15).
import { z } from "zod";

import { isPhaseHeading, isTaskLine, readTaskBlockLabels, storyTags, TaskBlockLabelRefused } from "../core/contracts/tasks.ts";

/** tasks.md is not in the shape the story plan is read from. */
export class TasksRefused extends Error {
  readonly why: string;

  constructor(why: string) {
    super(`tasks.md: ${why}`);
    this.name = "TasksRefused";
    this.why = why;
  }
}

const PHASE_TITLE = /^## Phase [^:]*: (.+)$/;

type Phase = { line: number; heading: string; story: number | null };

// A story's phases are told apart by their tasks' tags, never by heading words. A section that is no phase
// ends the one before it, so its lines are no phase's.
export function phasesOf(lines: readonly string[]): Phase[] {
  const phases: Phase[] = [];
  let current: Phase | null = null;
  for (const [i, line] of lines.entries()) {
    if (isPhaseHeading(line)) {
      // Labels are read back by heading, so two phases under one heading could not be told apart.
      if (phases.some((phase) => phase.heading === line)) throw new TasksRefused(`two phases are headed "${line}"`);
      current = { line: i, heading: line, story: null };
      phases.push(current);
    } else if (line.startsWith("## ")) {
      current = null;
    } else if (isTaskLine(line)) {
      for (const k of storyTags(line)) {
        if (current === null) throw new TasksRefused(`${JSON.stringify(line)} is tagged US${k} outside any phase`);
        if (current.story !== null && current.story !== k) {
          throw new TasksRefused(`"${current.heading}" holds tasks of US${current.story} and US${k}`);
        }
        current.story = k;
      }
    }
  }
  const order = phases.flatMap((phase) => (phase.story === null ? [] : [phase.story]));
  const outOfOrder = order.findIndex((k, i) => i > 0 && k < order[i - 1]);
  if (outOfOrder !== -1) throw new TasksRefused(`a US${order[outOfOrder]} phase comes after a US${order[outOfOrder - 1]} one`);
  return phases;
}

export type Story = { k: number; title: string; heading: string };

/** The stories of tasks.md, US1 first, each named by the heading of its first phase. */
export function storyPlan(text: string): Story[] {
  const phases = phasesOf(text.split("\n"));
  const stories: Story[] = [];
  for (const phase of phases) {
    if (phase.story === null || stories.some((story) => story.k === phase.story)) continue;
    if (phase.story !== stories.length + 1) throw new TasksRefused(`US${phase.story} has tasks, but US${stories.length + 1} has none`);
    stories.push({ k: phase.story, title: PHASE_TITLE.exec(phase.heading)?.[1] ?? phase.heading.slice("## ".length), heading: phase.heading });
  }
  if (stories.length === 0) throw new TasksRefused("no task is tagged [US<k>]");
  return stories;
}

export type StoryPlan = { stories: Story[]; labels: ReadonlyMap<string, number> };

/** tasks.md's stories and the issue each phase's task-block label names; TasksRefused when either does not read. */
export function readStoryPlan(text: string): StoryPlan {
  try {
    return { stories: storyPlan(text), labels: readTaskBlockLabels(text) };
  } catch (error) {
    if (!(error instanceof TaskBlockLabelRefused)) throw error;
    throw new TasksRefused(error.why);
  }
}

export const StoryIssue = z.object({ id: z.number().int().positive(), number: z.number().int().positive() });
export type StoryIssue = z.infer<typeof StoryIssue>;
// GitHub lets a sub-issue come from another repository, whose number would name a different issue in tasks.md.
export const SubIssue = StoryIssue.extend({ repository_url: z.string() });
export type SubIssue = z.infer<typeof SubIssue>;

/** What is wrong when the spec issue has more sub-issues than story issues, naming the ones past them; null when it
 *  has none. A one-story spec's story is the spec issue itself, so it has no story issue and each sub-issue is extra. */
export function extraSubIssues(subIssues: readonly StoryIssue[], stories: readonly Story[]): string | null {
  const extra = subIssues.slice(stories.length > 1 ? stories.length : 0);
  if (extra.length === 0) return null;
  return `${subIssues.length} sub-issues for ${stories.length} stories; the extra: ${extra.map((one) => `#${one.number}`).join(", ")}`;
}

/** What is wrong with each sub-issue that is not in the repository `repositoryUrl` names. */
export function foreignSubIssues(subIssues: readonly SubIssue[], repositoryUrl: string): string[] {
  return subIssues
    .filter((one) => one.repository_url !== repositoryUrl)
    .map((one) => `sub-issue ${one.repository_url.split("/repos/").at(-1)}#${one.number} is in another repository`);
}

/** Each sub-issue at position i whose number is not the one tasks.md labels US<i> with: its position and what is
 *  wrong, naming both issues. */
export function misplacedSubIssues(
  subIssues: readonly StoryIssue[],
  stories: readonly Story[],
  labels: ReadonlyMap<string, number>,
): { position: number; what: string }[] {
  return subIssues.flatMap((sub, i) => {
    const story = stories[i];
    const label = story === undefined ? undefined : labels.get(story.heading);
    if (label === undefined || label === sub.number) return [];
    return [{ position: i + 1, what: `sub-issue ${i + 1} is #${sub.number}, but tasks.md labels US${i + 1} with #${label}` }];
  });
}
