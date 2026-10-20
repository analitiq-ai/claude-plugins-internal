---
schemaVersion: 0.2.0
id: "0006"
title: "Close an issue not worth doing and post nothing for one that needs no spec"
status: draft
date: 2026-10-19
deciders: []
tags: [premise, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0005", "0008"]
affects:
  - type: path
    pattern: "plugins/alq-plan/scripts/premise_report.py"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
review:
  tier: async
externalRefs:
  - type: issue
    id: "63"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
    label: "Move planning (alq-spec) out of alq-review into its own plugin"
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "ALQ plugins target design: rewrite the decision records of alq-review, alq-plan and alq-build"
  - type: doc
    id: "alq-review ADR-0024"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0024-derive-the-spec-from-the-branch-at-launch-and-read-the-folder-as-data.md"
    label: "Supersedes alq-review ADR-0016 (spec: null at launch); review derives the spec from the branch, null exists nowhere"
---

# ADR-0006: Close an issue not worth doing and post nothing for one that needs no spec

## Context

The premise step ends in `write the spec`, `no spec needed` or `not worth doing` (ADR-0002). As drafted, this
record had the step close a `not worth doing` issue and the user pass `spec: null` at review (alq-review
ADR-0016); the design drops both (Options B and D).

## Decision

1. We will end the run on `not worth doing` by naming the step for the user: close the issue as not planned, with
   the premise report's reason; an empty reason fails the premise step.
2. We will post nothing for an issue the user picks as `no spec needed`, and tell the user nothing to pass: its
   record is the spec folder ADR-0008 writes, which review and build find by the issue number.
3. We will have no `#<issue> none <reason>` entry form.

## Options considered

### Option A: The user closes it; the folder is the no-spec record (chosen)

`spec: null` exists nowhere; every launched branch carries `<n>` and finds its folder.

### Option B: Tell the user to pass `spec: null` at review

Lost: nothing takes `spec` any more.

### Option C: Post a comment naming the outcome on the issue for both picks

Stays rejected: no plugin reads it.

### Option D: The premise step closes the issue

Lost: a plugin write outside the State table.

## Trade-offs

- `no spec needed` leaves no trace on the issue.
- A `not worth doing` issue stays open until the user closes it.

## Consequences

- Easier: neither stop pick writes to the issue.
- Harder: a `no spec needed` outcome is read from the branch, never from the issue.
- **How we would know this was wrong:** `not worth doing` issues left open; humans checking out a branch to learn
  that an issue needs no spec.
- Revisit if: anything needs the `no spec needed` outcome from the issue rather than from the spec folder.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
