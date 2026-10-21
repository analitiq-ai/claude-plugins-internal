---
schemaVersion: 0.2.0
id: "0009"
title: "Check the plan against the governing decision logs before critique"
status: draft
date: 2026-10-20
deciders: []
tags: [adr, alignment, planning, decision-log, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0010"]
affects:
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/scripts/*.py"
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0009: Check the plan against the governing decision logs before critique

## Context

Two decision logs bind a plan: the repo's own and the org log governing it. Unchecked at planning, a
contradiction first surfaces at reviewer's decision-reviewer, after the code is written. A local copy of the org log can fall
behind its remote and lack the record that now binds.

## Decision

1. We will run `adr check` after plan and before critique, against the repo's log and then the org log the
   repo declares. A public repo declares a public log only.
2. We will check against the org log as its remote holds it: a checkout behind its remote, or one that
   cannot be fetched or cloned, is a check that could not run (root ADR-0004).
3. We will commit a record the plan needs into the spec PR beside the spec it governs (ADR-0010), and a
   record found late into the rescope's spec PR; it governs a story in flight as reviewer ADR-0010 decides.

## Options considered

### Option A: Check both logs after plan, at the org log's remote head (chosen)

A plan passes only against the log that binds it now.

### Option B: The repo's log alone

Rejected: the org log the repo declares binds the plan too, and its records would go unchecked.

### Option C: Run with a stale or unreachable org log

Rejected: a checkout behind its remote may miss the governing record, and the plan would pass against a
log nobody can name.

### Option D: Only the review-round decision-reviewer

Rejected: the contradiction would surface after the code is written.

### Option E: A record on its own `<p>-adr-<slug>` branch and PR

Rejected: a second branch kind and a second rule blocking launch, for a record the spec PR carries with no
code beside it either way.

## Trade-offs

- Planning stops when the org log's remote does not answer, for no fault of the plan.
- A checkout behind its remote stops the run until a human pulls it.

## Consequences

- Easier: a contradiction is found while the plan is the cheapest thing to change.
- Harder: every machine that runs planning needs read access to the org log.
- **How we would know this was wrong:** the decision-reviewer keeps finding contradictions with records the
  check had seen, or fetch failures stop runs more often than the check finds anything.
- Revisit if: a repo needs more than one org log, or the org log stops being a git checkout.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
