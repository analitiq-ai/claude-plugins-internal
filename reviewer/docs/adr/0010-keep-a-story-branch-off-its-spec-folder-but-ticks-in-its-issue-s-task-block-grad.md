---
schemaVersion: 0.2.0
id: "0010"
title: "Keep a story branch off its spec folder but ticks in its issue's task block; grade each round at the reviewed commit"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, review-round, tasks, merge-main]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0013", "0014", "0015"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,specbinding,shell}.py"
  - type: path
    pattern: "reviewer/plugin/README.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/pull/108"
review:
  tier: async
externalRefs:
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
---

# ADR-0010: Keep a story branch off its spec folder but ticks in its issue's task block; grade each round at the reviewed commit

## Context

On a story branch the agent is graded against `spec.md`, a file in the worktree it writes and commits
to. The spec and every rescope land as a spec PR on the spec's issue (org ADR-0002), so a story branch has
no reason to change the spec. A story spans several turns (builder ADR-0003), and each has to
know which of its tasks are done.

## Decision

1. We will refuse, on a story branch, every commit that changes a path in the spec folder, except a
   `tasks.md` change that only flips `[ ]` to `[x]` inside the task block labelled with the session's issue
   number (TICK_ONLY). planner labels each story's task block with its issue number (planner ADR-0008).
2. We will grade every round against `spec.md` at the reviewed commit, never a stored copy. A changed spec
   or a new decision record reaches a story branch only when it merges the default branch (builder
   ADR-0004), and governs the story from the round after that merge; a rescope hold waits for that merge
   (ADR-0013). The round after any merge of the default branch into a story branch reviews that merge's
   conflict resolution, diffed against the merge base.

## Options considered

### Option A: No spec-folder edits but ticks; graded at the reviewed commit (chosen)

The spec the agent is graded against changes only through a spec PR an admin merges.

### Option B: Spec-only commits on the story branch

Spec files change on the story branch in commits that touch nothing else. Rejected: the graded agent could
change the spec it is graded against, admitted by its paths alone.

### Option C: Task progress outside `tasks.md`

Rejected: a second record of which tasks are done, beside the file each turn reads.

### Option D: A hold placed whenever `spec.md` changes on the branch

Rejected: any edit to `spec.md`, a typo fix included, would hold the PR until the user releases it.

### Option E: Accept a tick on any task in `tasks.md`

Rejected: a session could mark another story's tasks done.

## Trade-offs

- A spec fix found mid-story waits for a spec PR and a merge of the default branch.
- A tick that conflicts with a rescope's `tasks.md` edit is resolved by hand in the merge.

## Consequences

- Easier: no stored copy of `spec.md` can drift from the committed one; ticks merge with the story.
- Harder: the commit gate parses a `tasks.md` diff to tell a tick from an edit.
- **How we would know this was wrong:** a story PR whose diff changes the spec folder beyond ticks in its own
  issue's block, or a turn that redoes a task already ticked.
- Revisit if: task progress moves out of `tasks.md`.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
