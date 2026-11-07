import type { z } from "zod";

import type { SpecFolderRead, StoryPr } from "./identity.ts";
import type { Shared } from "./settings.ts";
import { Lane, valueSet } from "./values.ts";

// In core, as spec FR-025 has builder's step script and the orchestrator's Stop hook call one stop rule.
export const StopState = valueSet({
  NO_SESSION_RECORD: "the session has no record, so no issue was started in it",
  OTHER_SESSION_ISSUE: "the session's record is for another issue",
  OTHER_REPOSITORY: "the session's record is for another repository than the checkout's origin",
  CLOSED: "the story issue is closed",
  DONE: "the story is done",
  LANE: "the story's card is in Backlog or Blocked",
  NO_CARD: "the story issue has no card on the board",
  SPEC_ISSUE_ELSEWHERE: "the story's spec issue is in another repository",
  SEVERAL_BRANCHES: "the story has more than one branch, on GitHub or locally",
  BRANCH_MISMATCH: "the story's branch on GitHub and its local branch differ",
  WORKTREE_ON_OTHER_BRANCH: "the story branch's worktree path holds another branch",
  NO_SPECS: "the head the work is on has no specs/ folder",
  NO_SPEC_FOLDER: "the head the work is on has no specs/<p>-* folder",
  SEVERAL_SPEC_FOLDERS: "the head the work is on has more than one specs/<p>-* folder",
  HEAD_BEHIND_PR: "the head the work is on is behind or diverged from the open story PR's head",
  UNCOMMITTED_CHANGES: "the story's worktree has uncommitted changes and no merge in progress",
});
export type StopState = z.infer<typeof StopState.schema>;

export type StoryStop = { state: StopState; reason: string };

export type StoryWorktree = { path: string; branch: string | null; mergeInProgress: boolean; dirty: string[] };

export type HeadVsPr = "same" | "ahead" | "behind" | "diverged";

export type MergeNeed = { needed: boolean; why: string[] };

/**
 * The facts of data-model stages 1-7 and 9, read in the order the rule decides them. A fact after the stage that
 * stopped, after a merge in progress, or after a due merge, is absent.
 */
export type StoryStopFacts = {
  story: number;
  session: { repo: string; issue: number } | null;
  /** `owner/name` of the checkout's origin. */
  origin: string;
  shared?: Shared;
  issue?: { state: "open" | "closed"; title: string; body: string };
  done?: boolean;
  lane?: Lane | null;
  /** The spec's issue `p`, or what was found when its parent is in another repository. */
  spec?: number | { elsewhere: string };
  branch?: { github: string | null; local: string | null } | { several: string };
  pr?: StoryPr | null;
  /** Null when there is no story branch, or git lists no worktree at `../<main checkout>.worktrees/<branch>`. */
  worktree?: StoryWorktree | null;
  /** The head the work is on: the worktree's HEAD, or the ref the worktree would start from (R16). */
  head?: string;
  headVsPr?: HeadVsPr;
  merge?: MergeNeed;
  folder?: SpecFolderRead;
};

/** The first stop the facts reach in the data model's order, or null when they reach none. */
export function storyStop(facts: StoryStopFacts): StoryStop | null {
  const s = `#${facts.story}`;
  const open = facts.pr?.closed === false ? facts.pr : null;
  const stop = (state: StopState, why: string): StoryStop => ({
    state,
    reason: `${state}: ${why}${open === null ? "" : `; story PR #${open.number} is open`}`,
  });

  const { session } = facts;
  if (session === null) return stop("NO_SESSION_RECORD", `this session has no session record, so ${s} was not started in it`);
  if (session.issue !== facts.story) return stop("OTHER_SESSION_ISSUE", `this session's record is for #${session.issue}, not ${s}`);
  if (session.repo !== facts.origin) {
    return stop("OTHER_REPOSITORY", `this session's record for ${s} is in ${session.repo}, but the checkout's origin is ${facts.origin}`);
  }

  if (facts.done === true) return stop("DONE", `${s} is done`);
  if (facts.issue?.state === "closed") return stop("CLOSED", `${s} is closed`);

  if (facts.lane === null) return stop("NO_CARD", `${s} has no card on ${facts.shared?.board}`);
  if (facts.lane === Lane.schema.enum.Backlog || facts.lane === Lane.schema.enum.Blocked) return stop("LANE", `${s}'s card is in ${facts.lane}`);
  if (typeof facts.spec === "object") return stop("SPEC_ISSUE_ELSEWHERE", `${s}'s spec issue is ${facts.spec.elsewhere}`);

  const { branch, worktree } = facts;
  if (branch === undefined) return null;
  if ("several" in branch) return stop("SEVERAL_BRANCHES", `${s} has several story branches: ${branch.several}`);
  if (branch.github !== null && branch.local !== null && branch.github !== branch.local) {
    return stop("BRANCH_MISMATCH", `${s}'s story branch is ${branch.github} on GitHub but ${branch.local} locally`);
  }
  const name = branch.github ?? branch.local;
  if (worktree === undefined) return null;
  if (worktree !== null) {
    if (worktree.branch !== name) {
      return stop("WORKTREE_ON_OTHER_BRANCH", `${s}'s worktree ${worktree.path} is on ${worktree.branch ?? "a detached HEAD"}, not ${name}`);
    }
    if (worktree.mergeInProgress) return null;
    if (worktree.dirty.length > 0) {
      return stop("UNCOMMITTED_CHANGES", `${s}'s worktree ${worktree.path} has uncommitted changes: ${worktree.dirty.join(", ")}`);
    }
  }

  // A merge onto a head behind the PR's could not be pushed without force (builder ADR-0004 d1).
  if (open !== null && (facts.headVsPr === "behind" || facts.headVsPr === "diverged")) {
    const relation = facts.headVsPr === "behind" ? "is behind" : "has diverged from";
    return stop("HEAD_BEHIND_PR", `${s}'s local head ${facts.head} ${relation} story PR #${open.number}'s head ${open.head}`);
  }
  // A due merge is builder's step, and may clear a folder stop.
  if (facts.merge === undefined || facts.merge.needed) return null;

  const { folder } = facts;
  if (folder === undefined) return null;
  const at = name === null ? `the default branch at ${facts.head}` : `branch ${name}`;
  if ("noSpecs" in folder) return stop("NO_SPECS", `${s}'s ${at} has no specs/ folder`);
  if ("several" in folder) {
    return stop("SEVERAL_SPEC_FOLDERS", `${s}'s ${at} has several spec folders of #${facts.spec}: ${folder.several.join(", ")}`);
  }
  if (!("one" in folder)) return stop("NO_SPEC_FOLDER", `${s}'s ${at} has no specs/${facts.spec}-* folder`);
  return null;
}
