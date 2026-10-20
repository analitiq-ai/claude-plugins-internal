---
schemaVersion: 0.2.0
id: "0028"
title: "After N review-driven edits to one file, only REDESIGN is admissible"
status: draft
date: 2026-10-19
deciders: []
tags: [review-round, assessment, policy, redesign, churn]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0013", "0027"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{policy,assessment,facts}.py"
  - type: path
    pattern: "plugins/alq-review/config.json"
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
    label: "ALQ plugins target design: rewrite the decision records of alq-review, alq-plan and alq-build"
---

# ADR-0028: After N review-driven edits to one file, only REDESIGN is admissible

## Context

Today the churn bound is defined twice, with two meanings of "edit": prose in the cto rule file
`pr-review-loop.md`, and the gate's count of commits per file since round 1's head, which resets
only when the file moves.

## Decision

1. We will stop offering PATCH and CLASS_FIX for a file once `edits_before_redesign` review-driven
   commits touched it since the reset; REDESIGN must carry an invariant and a diagnosis:
   unsettled design, too many responsibilities, or review polish.
2. We will reset at the latest of round 1's head, the last settled round's head, the commit
   closing that file's last REDESIGN finding, and a move of the file (ADR-0013); the assessor's
   facts will carry edits_since_reset and the reset event.
3. We will define the rule once, in alq-review's policy; the cto rule file only points at the gate;
   the pre-PR "unsettled branch" concern belongs to the history-shape audit reviewer.

## Options considered

### Option A: The bar in the gate, N in config, a reset at settled points (chosen)

Brainstorm Third-edit rule, option 2, plus decision 2's reset.

### Option B: The rule as prose in `pr-review-loop.md` with a manual tripwire

Rejected: a rule no gate reads is advice; rules describe shipped tooling.

### Option C: A count that never resets

Rejected: it would force REDESIGN on polish after a settled design.

## Trade-offs

- The bar reads commits, not causes: N separate defects fixed one by one force a redesign.
- The rule file's pre-PR tripwire goes: churn on a file before round 1 is caught only when the
  history-shape audit reviewer runs.

## Consequences

- Easier: the assessor rules from facts the gate computed.
- Harder: the rule file no longer states the bound.
- **How we would know this was wrong:** REDESIGN forced on polish after a settled design despite
  the reset; a file still churning after the REDESIGN that closed its finding.
- Revisit if: the history-shape audit reviewer and this bar read the same commits for the same
  concern.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
