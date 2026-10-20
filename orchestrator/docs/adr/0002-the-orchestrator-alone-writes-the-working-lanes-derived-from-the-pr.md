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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner, builder and orchestrator"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0012-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md"
    label: "reviewer ADR-0012: Refuse from any agent session every GitHub write the orchestrator or a human owns"
---

# ADR-0002: The orchestrator alone writes the working lanes, derived from the PR

## Context

Humans and the orchestrator (ADR-0001) share the board; the orchestrator never checks who moved a card.

## Decision

1. We will keep six lanes on the Project status field, issues as the cards, each lane with one writer:
   GitHub Backlog and Done, a human Ready, the orchestrator In progress, In review and Blocked; reviewer
   refuses a lane write from any agent session (reviewer ADR-0012).
2. We will re-derive In progress and In review from the story's PR every tick, acting on a card only
   when claimed: Analitiq-Bot as the story issue's assignee, set at every launch, never cleared.
3. We will start a story only from Ready, never because another story merged, and only once every
   issue in its `blockedBy` is closed; until then the card waits in Ready. Every launch also needs no
   launch running and the spec-PR rule to allow it (ADR-0006); ADR-0007 names the Ready card needing no
   launch. An open hold never stops a launch from Ready: reviewer releases holds in that launch (reviewer ADR-0013).
   A Ready card whose PR closed unmerged relaunches on its branch; builder opens a new PR.
4. We will never launch on a parent issue (one with sub-issues): moved to Ready, it goes to Blocked, the
   reason naming the sub-issues to move instead; its other lanes are the human's.
5. We will make Blocked the one sink for what needs a human: an open hold on a working-lane card
   (reviewer ADR-0011), REPEAT, a converted PR, a PR closed unmerged, a silent reporter, a Ready card
   the spec-PR rule holds (ADR-0006), or a launch that opened no PR (reason: its final message). The
   reason is posted first; the lane write is the commit point. These moves wait while a launch runs.
6. We will read a human's drag to Backlog, Blocked or Done as a stop: the launch is stopped, nothing
   merges. A drag into a working lane is inert when unclaimed, undone when claimed, bounced to Blocked
   under an open hold.

## Options considered

### Option A: One writer per lane (chosen)

No move needs a check of who made it.

### Option B: Plugins write lanes

Lost: a plugin's lane write cannot be told from a human's.

### Option C: Launch the next story without Ready after a merge

Lost: `blockedBy` carries the order; a human's Ready starts every story.

## Trade-offs

- A human's drag into a working lane starts nothing.
- Ready's guarantee is reviewer's refusal inside the session, not the orchestrator's check.

## Consequences

- Easier: a restart needs no stored lane state.
- Harder: a parent's lanes are kept by hand; a Ready card under an open blocker waits silently.
- **How we would know this was wrong:** a claimed working-lane card the orchestrator neither wrote nor
  undid; a story launched before its blockers closed.
- Revisit if: GitHub adds an Actions event for a Projects lane change.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
