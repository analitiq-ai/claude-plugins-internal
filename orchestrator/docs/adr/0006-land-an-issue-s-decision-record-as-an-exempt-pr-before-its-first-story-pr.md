---
schemaVersion: 0.2.0
id: "0006"
title: "Land an issue's decision record as an exempt PR before its first story PR"
status: draft
date: 2026-10-19
deciders: []
tags: [adr, git-workflow, pull-requests, orchestrator, review]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0005"]
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/planner/docs/adr/0010-check-the-plan-against-the-governing-decision-logs-before-critique.md"
    label: "planner ADR-0010: Check the plan against the governing decision logs before critique"
---

# ADR-0006: Land an issue's decision record as an exempt PR before its first story PR

## Context

A plan can need a decision record (planner ADR-0010), which the decision-reviewer then grades every
internal round against. The orchestrator launches on any Ready card (ADR-0001): nothing said who
merges the record, or that story 1 waits for it.

## Decision

1. We will have planner write the record on `<n>-adr-<slug>`; a human opens its PR, labels it exempt and
   merges it.
2. We will block the first launch on #n, and any later launch from Ready, while an `<n>-adr-*` PR is
   open; the card goes to Blocked with the reason naming the PR, and a human merges or closes that PR,
   then moves the card to Ready.
3. We will accept that a record merged after a story branch was cut is unseen by that story's rounds;
   the next story has it.

## Options considered

### Option A: A human's end to end, merged before story 1 (chosen)

A record is a human's ruling; merged first, it governs story 1 from the first round.

### Option B: The record inside the story PR, or the orchestrator driving the ADR PR like a story

Lost: inside the story PR, a governing rule lands with the code it grades; driven like a story,
the bot would review and merge its own governing rule. The orchestrator runs no round on a record, and no
round attests it; a human's exempt label does.

### Option C: Re-cut or rebase story 1 onto a late record

Lost: the round grades the branch as it is.

## Trade-offs

- An issue with a record cannot start until a human merges or closes it.
- A late record governs only from the next story.

## Consequences

- Easier: story 1 is graded against a ratified record from its first round; records need no third kind
  of PR (ADR-0005).
- Harder: every record waits on a human to merge it.
- **How we would know this was wrong:** records merged unread to unblock launches, or later rounds
  finding story 1 contradicts a record that landed after its branch was cut.
- Revisit if: a record needs more than a human's reading, or a round can grade a branch against records
  merged after it was cut.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
