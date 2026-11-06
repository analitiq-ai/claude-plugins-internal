import { z } from "zod";

import { isPhaseHeading } from "../core/contracts/tasks.ts";

// The checks landing makes of tasks.md, which the plan check's stories step makes too (R15): one set of functions,
// so the two cannot disagree on what a story plan is.

/** tasks.md is not in the shape the story plan is read from. */
export class TasksRefused extends Error {
  readonly why: string;
  constructor(why: string) {
    super(`tasks.md: ${why}`);
    this.name = "TasksRefused";
    this.why = why;
  }
}

const TASK_LINE = /^\s*- \[[ xX]\] /;
const STORY_TAG = /\[US([1-9][0-9]*)\]/g;
const PHASE_TITLE = /^## Phase [^:]*: (.+)$/;

export type Phase = { line: number; heading: string; story: number | null };

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
    } else if (TASK_LINE.test(line)) {
      for (const [, k] of line.matchAll(STORY_TAG)) {
        if (current === null) throw new TasksRefused(`${JSON.stringify(line)} is tagged US${k} outside any phase`);
        if (current.story !== null && current.story !== Number(k)) {
          throw new TasksRefused(`"${current.heading}" holds tasks of US${current.story} and US${k}`);
        }
        current.story = Number(k);
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

export const StoryIssue = z.object({ id: z.number().int().positive(), number: z.number().int().positive() });
export type StoryIssue = z.infer<typeof StoryIssue>;
// GitHub lets a sub-issue come from another repository, whose number would name a different issue in tasks.md.
export const SubIssue = StoryIssue.extend({ repository_url: z.string() });
export type SubIssue = z.infer<typeof SubIssue>;

/** The first kind of sub-issue problem the spec issue has, in landing's order, or null. */
export type SubIssueProblem =
  | { kind: "extra"; extra: number[] }
  | { kind: "foreign"; foreign: string[] }
  | { kind: "misplaced"; misplaced: { position: number; sub: number; label: number }[] };

/**
 * `subIssues` against the story plan: more than its stories (a one-story spec's story is the spec issue itself, so
 * it has none), any in a repository other than `repositoryUrl`, or one at position i other than the issue tasks.md
 * labels US<i+1> with.
 */
export function subIssueProblem(
  subIssues: readonly SubIssue[],
  stories: readonly Story[],
  labels: ReadonlyMap<string, number>,
  repositoryUrl: string,
): SubIssueProblem | null {
  const extra = subIssues.slice(stories.length > 1 ? stories.length : 0);
  if (extra.length > 0) return { kind: "extra", extra: extra.map((one) => one.number) };
  const foreign = subIssues.filter((one) => one.repository_url !== repositoryUrl);
  if (foreign.length > 0) return { kind: "foreign", foreign: foreign.map((one) => `${one.repository_url.split("/repos/").at(-1)}#${one.number}`) };
  const misplaced = subIssues.flatMap((sub, i) => {
    const story = stories[i];
    const label = story === undefined ? undefined : labels.get(story.heading);
    return label === undefined || label === sub.number ? [] : [{ position: i + 1, sub: sub.number, label }];
  });
  return misplaced.length > 0 ? { kind: "misplaced", misplaced } : null;
}
