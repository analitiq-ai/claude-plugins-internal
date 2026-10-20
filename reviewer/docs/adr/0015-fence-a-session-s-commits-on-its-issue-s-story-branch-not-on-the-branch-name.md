---
schemaVersion: 0.2.0
id: "0015"
title: "Fence a session's commits on its issue's story branch, not on the branch name"
status: draft
date: 2026-10-20
deciders: []
tags: [commit-gate, fence, branch-grammar, session-state, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0014"]
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
    label: "org ADR-0003: Open one PR per user story; only the last PR closes the issue"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0005-exempt-a-pr-from-the-internal-review-by-its-bot-author-or-a-label-a-writer-appli.md"
    label: "orchestrator ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied"
---

# ADR-0015: Fence a session's commits on its issue's story branch, not on the branch name

## Context

The brainstorm had reviewer refuse a commit on any branch outside the grammar, keyed on the name. The risk a commit-time refusal must cover is narrower: a build session committing on a branch other than its own story's. On a repo with no ruleset, the session hook is the only line between the bot and main.

## Decision

1. We will key the fence on the session's issue: when `builder:issue-tackle <n>` starts, the gate
   records n for the session, and every commit in that session must land on `<n>-us<k>` with no other
   `<n>-us<j>` on origin; any other branch is refused.
2. We will let a session with no recorded issue commit freely on any branch: reverts, release bumps and
   retire-spec need no name and no label before their PR.
3. We will enforce the grammar only at the review-round launch (ADR-0014) and by this fence.

## Options considered

### Option A: A fence keyed on the session's issue (chosen)

Reviewer already runs on every Skill call and keeps a state file per session.

### Option B: Refuse any commit on a branch outside the grammar, keyed on the name

It would refuse every revert, release-bump and retire-spec commit unless each tooling branch had a name
kind, and the grammar has none: a tooling PR is exempt by its Bot author or a writer's label (orchestrator ADR-0005).

## Trade-offs

- "No other `<n>-us<j>` on origin" rests on the head branch being deleted on merge; without that setting,
  every story after the first is refused.
- The fence is a hook inside the session's process, not a server-side rule.

## Consequences

- Easier: a build session cannot stray from its story.
- Harder: a session that never starts `issue-tackle` is trusted on every branch.
- **How we would know this was wrong:** a commit from an `issue-tackle` session lands outside `<n>-us<k>`,
  or a commit from a session with no recorded issue is refused for its branch.
- Revisit if: branch kinds return to the grammar, or a build is launched by anything other than
  `issue-tackle <n>`.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
