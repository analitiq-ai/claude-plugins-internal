---
schemaVersion: 0.2.0
id: "0006"
title: "Start no story while its spec's issue has an open spec PR, or before one merged"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, rescope, git-workflow, pull-requests, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0002", "0005", "0008", "0009"]
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

# ADR-0006: Start no story while its spec's issue has an open spec PR, or before one merged

## Context

A spec and its decision records land in a spec PR on `<p>-spec`, with no code, before any story (org
ADR-0002); a rescope is another spec PR on the same issue. The spec's issue is the parent when the story
issue has one, else the story issue itself. A story started under a spec that is changing would be
built against the old one.

## Decision

1. We will start no story while its spec's issue has an open spec PR or none merged (ADR-0002). The
   rule gates a story's start only; an in-flight story's merge is held by its rescope hold (reviewer ADR-0013),
   which the merge respects (ADR-0009).
2. We will move a Ready card the rule holds to Blocked, the reason naming the open spec PR, or saying
   none has merged.
3. We will name no builder step on a spec PR (planner ADR-0010) and run no internal round on it; it is attested
   and its external reviews requested as for any exempt PR (ADR-0005, ADR-0008).

## Options considered

### Option A: The spec-PR rule on start, the rescope hold on merge (chosen)

Each move is held by the fact that bears on it: a start by the spec PR, a merge by whether the story's
branch carries the new spec.

### Option B: The same rule on merge as well

Rejected: the rescope hold already refuses the merge of every open story under the spec until its
branch carries the new spec (root ADR-0006).

### Option C: Leave a held Ready card in Ready

Rejected: the card would show no reason, and a human could not tell it from one waiting on a blocker.

## Trade-offs

- An open spec PR stalls every story under its issue, even ones the rescope does not touch.
- A card the rule moved to Blocked needs a human's Ready once the spec PR merges.

## Consequences

- Easier: every story starts from a merged spec and merged records.
- Harder: every spec and rescope waits on a human to merge it.
- **How we would know this was wrong:** spec PRs merged unread to unblock stories; a story started
  while its spec's issue had an open spec PR.
- Revisit if: a round can grade a branch against a spec still in review.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
