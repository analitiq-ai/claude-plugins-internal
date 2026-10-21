---
schemaVersion: 0.2.0
id: "0002"
title: "The orchestrator alone writes the working lanes, derived from the PR"
status: draft
date: 2026-10-20
deciders: []
tags: [board, lanes, orchestrator, github-projects, workflow]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0006", "0007", "0009", "0010"]
affects:
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0002: The orchestrator alone writes the working lanes, derived from the PR

## Context

Humans and the orchestrator share the board; the orchestrator never checks who moved a card.

## Decision

1. We will keep six lanes on the Project status field, issues as cards, each with at most one automated
   writer: GitHub for Backlog and Done; the orchestrator for In progress, In review and Blocked; none for
   Ready, a human's alone. No agent session can write a lane (root ADR-0007).
2. We will re-derive In progress and In review from the story's PR every tick, acting on a card only
   when claimed: Analitiq-Bot as the story issue's assignee, set at every launch, never cleared.
3. We will launch a story only from Ready (root ADR-0006), once every issue in its `blockedBy` is done
   (root ADR-0005), no launch runs and the spec-PR rule allows it (ADR-0006); a merge launches nothing.
   The launch releases holds as reviewer ADR-0013 decides; only an unanswered escalation (ADR-0010)
   stops it, with or without an open PR, sending the card back to Blocked with no new comment. A Ready
   card whose PR closed unmerged relaunches on its branch.
4. We will never launch on a parent issue (one with sub-issues): moved to Ready, it goes to Blocked,
   naming the sub-issues to move instead; its other lanes are the human's.
5. We will make Blocked the one sink for what needs a human, each cause decided in its own record
   (ADR-0001, ADR-0004 to ADR-0010). This record's causes: a launch that opened no PR, or a PR closed
   unmerged (reason: the launch's final message); an In review PR whose `codex-review` failed with no
   findings and no hold (reason: dismiss and re-request, or bypass merge). The reason is posted first;
   the lane write is the commit point; these moves wait while a launch runs. Every tick, the
   orchestrator posts any missing keyed reason for every open hold, in any lane.
6. We will read a human's drag to Backlog, Blocked or Done as a stop: the launch is stopped, nothing
   merges. A drag into a working lane is inert when unclaimed, undone when claimed, bounced to Blocked
   under an open hold.
7. We will launch nothing on a done story (root ADR-0005).

## Options considered

### Option A: One automated writer per lane (chosen)

No move needs a check of its author.

### Option B: Plugins write lanes

Lost: a session would move the card it is graded on.

### Option C: Launch the next story without Ready after a merge

Lost: `blockedBy` carries the order.

## Trade-offs

- A Ready card waits silently on a blocker.

## Consequences

- Easier: a restart needs no lane state.
- Harder: a parent's lanes are kept by hand.
- **How we would know this was wrong:** a story launched before its blockers were done, or after it was
  done.
- Revisit if: GitHub adds an Actions event for a Projects lane change.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
