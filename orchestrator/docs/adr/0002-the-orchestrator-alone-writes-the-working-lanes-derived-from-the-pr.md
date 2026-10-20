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
relatesTo: ["0001", "0009", "0010"]
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

The human and the orchestrator of ADR-0001 share a card's state, and the orchestrator parses no prose. The brainstorm let plugins move cards (builder to In review, any plugin to Blocked); the orchestrator never checks who moved a card, so a plugin's move would read as a human's.

## Decision

1. We will keep six lanes on the Project status field, with issues as the cards, never PRs, and give each lane one writer: GitHub Backlog and Done, a human Ready, the orchestrator In progress, In review and Blocked; reviewer refuses a lane write from any agent session (reviewer ADR-0012); the board's PR-linked, PR-merged and reopen workflows are off.
2. We will treat In progress and In review, the working lanes, as output, re-derived from the PR every tick, and the other four as inputs; the orchestrator acts on a card in either only when it has claimed it (the bot as assignee).
3. We will make Blocked the one sink for anything needing a human, its reason posted on the issue (ADR-0003); a human clears the cause and moves the card to Ready; a PR GitHub refuses on a rule outside the merge contract stays In review instead (ADR-0009).
4. We will read a human's drag to Backlog, Blocked or Done as a stop: the running launch is stopped, nothing merges, the card stays; a drag into a working lane is inert when the card is unclaimed, undone when claimed, and bounced to Blocked when a hold is open.

## Options considered

### Option A: One writer per lane (chosen)

Each lane has one source, so no move needs a check of who made it.

### Option B: Plugins write lanes

Lost: a plugin's lane write cannot be told from a human's, and a planning stop changes no lane.

### Option C: Hold comments as state

Lost: a hold comment is prose, and the orchestrator parses none (ADR-0001).

### Option D: The orchestrator writes Done

Lost: the board writes Done when the last story's merge closes the issue.

### Option E: An allow-list of humans on the Ready move

Lost: the guarantee sits at the writer; reviewer refuses an agent's Ready.

## Trade-offs

- A human's drag into a working lane starts nothing.
- Ready's guarantee is reviewer's refusal inside the agent session, not a check by the orchestrator.

## Consequences

- Easier: a restart needs no stored lane state, since the working lanes come from the PR.
- Harder: a planning stop never shows on the board; the card waits in its lane for Ready.
- **How we would know this was wrong:** a claimed working-lane card the orchestrator neither wrote nor undid; a plugin that needs to move a card.
- Revisit if: GitHub adds an Actions event for a Projects lane change.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
