---
schemaVersion: 0.2.0
id: "0006"
title: "Close an issue not worth doing and post nothing for one that needs no spec"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [premise, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0007"]
affects:
  - type: path
    pattern: "planner/plugin/scripts/premise_report.py"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:55Z
---

# ADR-0006: Close an issue not worth doing and post nothing for one that needs no spec

## Context

The premise step ends in `write the spec`, `no spec needed` or `not worth doing`. This record decides what
a run does with the issue on the last two. No plugin but the orchestrator's hooks closes an issue, and they
close only a parent whose sub-issues are all done (orchestrator ADR-0009), done as root ADR-0005 defines it.

## Decision

1. We will leave closing a `not worth doing` issue to the user: the run ends naming that step and the
   premise report's reason, and planner closes no issue.
2. We will post nothing on the issue for either pick; a `no spec needed` pick's record is its no-spec
   folder (ADR-0007).

## Options considered

### Option A: The user closes it; the folder is the no-spec record (chosen)

Every step finds the folder from its spec's issue (root ADR-0005).

### Option B: Tell the user to pass `spec: null` at review

Lost: nothing takes `spec`.

### Option C: Post a comment naming the outcome on the issue for both picks

Rejected: no plugin reads it.

### Option D: The premise step closes the issue

Lost: a plugin write outside the State table.

## Trade-offs

- `no spec needed` leaves no trace on the issue.
- A `not worth doing` issue stays open until the user closes it.

## Consequences

- Easier: neither stop pick writes to the issue.
- Harder: a `no spec needed` outcome is read from the branch, never from the issue.
- **How we would know this was wrong:** `not worth doing` issues left open; admins checking out a branch to learn
  that an issue needs no spec.
- Revisit if: anything needs the `no spec needed` outcome from the issue rather than from the spec folder.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
