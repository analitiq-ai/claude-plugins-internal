---
schemaVersion: 0.2.0
id: "0015"
title: "Fence a session on its story issue's branch prefix and lane; a session needs an issue"
status: draft
date: 2026-10-20
deciders: []
tags: [commit-gate, fence, branch-grammar, session-state, lanes, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0010", "0011", "0014"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,hookio,worktree}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one issue, one branch and one PR per user story"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0005-exempt-a-pr-from-the-internal-review-by-its-bot-author-or-a-label-a-writer-appli.md"
    label: "orchestrator ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied"
---

# ADR-0015: Fence a session on its story issue's branch prefix and lane; a session needs an issue

## Context

A build session must not commit outside its own story's branch; on a repo with no ruleset, the session
hook is the only line between the bot and the default branch. Each story issue has one branch,
`<s>-us<k>-<slug>`, `<k>` a label for humans (org ADR-0003). reviewer keeps its state on the story issue
(ADR-0011); planner writes there only in Blocked or Backlog (planner ADR-0005).

## Decision

1. We will key the fence on the session's issue: when `builder:issue-tackle <s>` starts, the gate records
   `<s>` for the session, and every commit in that session must land on a branch whose name starts with
   `<s>-us`; any other branch is refused. `<k>` is never checked.
2. We will refuse, while reviewer is on, every commit of a session with no recorded issue, naming the ways
   forward: name the issue, or switch reviewer off. Ad-hoc work runs with reviewer off; its PR merges once
   a human applies the exempt label (orchestrator ADR-0005).
3. We will refuse every commit and every round's launch while the session's issue is in Blocked or
   Backlog on the board. A human stops a running story by dragging it to Blocked.
4. We will enforce the grammar only at the review-round launch (ADR-0014) and by this fence.

## Options considered

### Option A: Fence on the session's story issue and its lane; a session needs an issue (chosen)

The issue is where reviewer's state lives.

### Option B: Refuse any commit on a branch outside the grammar, keyed on the name

Rejected: a name alone does not tie a session to its own story.

### Option C: A session with no issue commits on any branch

Rejected: its state has no issue to live on, and it is trusted on every branch.

### Option D: Also check `<k>`, or that no other `<s>-us<j>` branch exists

Rejected: one story issue has one branch, so the prefix is enough; `<k>` is a human label.

### Option E: Gate on holds alone, not on the lane

Rejected: a story dragged to Blocked would keep committing, and planner could write its state beside a
running session.

## Trade-offs

- Every ad-hoc change needs reviewer off and a human's exempt label.
- The fence is a hook inside the session's process, not a server-side rule.

## Consequences

- Easier: a build session cannot stray from its story.
- Harder: a session must name its issue before its first commit; each commit and round launch reads the
  issue's lane from the board.
- **How we would know this was wrong:** with reviewer on, a commit lands outside `<s>-us`, from a session
  with no issue, or while its issue is in Blocked or Backlog.
- Revisit if: a build is launched other than by `issue-tackle <s>`.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
