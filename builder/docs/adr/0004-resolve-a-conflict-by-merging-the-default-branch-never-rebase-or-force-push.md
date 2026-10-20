---
schemaVersion: 0.2.0
id: "0004"
title: "Resolve a conflict by merging the default branch, never rebase or force-push"
status: draft
date: 2026-10-20
deciders: []
tags: [git, merge, conflict, story-branch, rescope]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0003"]
affects:
  - type: path
    pattern: "builder/plugin/skills/issue-tackle/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0010-keep-a-story-branch-off-its-spec-folder-but-ticks-in-its-issue-s-task-block-grad.md"
    label: "reviewer ADR-0010: Keep a story branch off its spec folder but ticks in its issue's task block; grade each round at the reviewed commit"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/planner/docs/adr/0009-check-the-plan-against-the-governing-decision-logs-before-critique.md"
    label: "planner ADR-0009: Check the plan against the governing decision logs before critique"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0009-the-orchestrator-squash-merges-on-github-s-gate-and-the-codex-verdict.md"
    label: "orchestrator ADR-0009: The orchestrator squash-merges on GitHub's gate and the Codex verdict"
---

# ADR-0004: Resolve a conflict by merging the default branch, never rebase or force-push

## Context

A story branch falls behind the default branch as other stories and spec PRs merge. A conflict blocks its
merge. A rescope's spec PR may edit `tasks.md` lines the story has ticked, and may carry records that govern
the story (planner ADR-0009). Story PRs are squash-merged (orchestrator ADR-0009), so a branch's own history
never reaches the default branch. reviewer records each round's verdict at the head it reviewed.

## Decision

1. We will resolve a conflict on a story branch by merging the default branch into it, and never rebase or
   force-push the branch.
2. We will merge the default branch into a story branch at its next launch after a spec PR of its spec's
   issue merged, so the story is built and reviewed against the spec and records in force. A new spec.md
   that merge brings releases the story's rescope hold (reviewer ADR-0013). The merge runs before the
   spec-folder check (ADR-0002), which then finds the folder the new spec names.
3. We will resolve, in that merge, a tick that conflicts with a rescope's `tasks.md` edit.

## Options considered

### Option A: Merge the default branch into the story branch (chosen)

Every commit and every head a round was recorded at stays on the branch.

### Option B: Rebase onto the default branch and force-push

Rejected: it rewrites the heads rounds were recorded at, and a force-push can drop commits another launch
pushed.

### Option C: Do nothing

Rejected: each session picks rebase or merge on its own, and the first rebase strands the recorded rounds.

## Trade-offs

- The round after a merge reviews the merge's conflict resolution, diffed against the merge base
  (reviewer ADR-0010), so every merge costs a round.
- The branch carries merge commits; the squash merge keeps them off the default branch.

## Consequences

- Easier: recorded heads stay reachable, and no push is refused for rewriting history.
- Harder: a rescope reaches a story in flight only at its next launch.
- **How we would know this was wrong:** rounds after a merge re-review the default branch's changes, or a
  merge's resolution drops a change of the default branch.
- Revisit if: story PRs stop being squash-merged.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
