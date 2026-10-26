---
schemaVersion: 0.2.0
id: "0018"
title: "After N review-driven edits to one file, only REDESIGN is admissible"
status: draft
date: 2026-10-20
deciders: []
tags: [review-round, assessment, policy, redesign, churn]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0017"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{policy,assessment,facts}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0018: After N review-driven edits to one file, only REDESIGN is admissible

## Context

Repeated review-driven edits to one file are patches against a structure nobody chose. A bound on them
needs one meaning of "edit" and a reset that does not punish polish after a settled design.

## Decision

1. We will stop offering PATCH and CLASS_FIX for a file once `edits_before_redesign` (3, a `[reviewer]`
   key) rounds' fixes touched it since the reset, the file followed across renames; REDESIGN must carry
   an invariant and a diagnosis: unsettled design, too many responsibilities, or review polish.
2. We will reset at the latest of round 1's head, the last settled round's head and the commit closing
   that file's last REDESIGN finding; the assessor's facts will carry edits_since_reset and the reset
   event.
3. We will define the rule once, in reviewer's policy; the pre-PR "unsettled branch" concern belongs to
   the history-shape audit reviewer.

## Options considered

### Option A: The bar in reviewer, N in config, a reset at settled points (chosen)

A gate reads the bound; the reset spares polish after a settled design.

### Option B: The rule as prose in an agent rule file, with a manual tripwire

Rejected: a rule no gate reads is advice; rules describe shipped tooling.

### Option C: A count that never resets

Rejected: it would force REDESIGN on polish after a settled design.

## Trade-offs

- The bar reads commits, not causes: N separate defects fixed one by one force a redesign.
- Churn on a file before round 1 is caught only when the history-shape audit reviewer runs.

## Consequences

- Easier: the assessor rules from facts reviewer computed.
- Harder: the bound needs the reset events recorded per file.
- **How we would know this was wrong:** REDESIGN forced on polish after a settled design despite
  the reset; a file still churning after the REDESIGN that closed its finding.
- Revisit if: the history-shape audit reviewer and this bar read the same commits for the same
  concern.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
