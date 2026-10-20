---
schemaVersion: 0.2.0
id: "0010"
title: "Check the plan against the governing decision logs before critique"
status: draft
date: 2026-10-19
deciders: []
tags: [adr, alignment, planning, decision-log, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0005"]
affects:
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/scripts/*.py"
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
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
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    id: "orchestrator ADR-0006"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0006-land-an-issue-s-decision-record-as-an-exempt-pr-before-its-first-story-pr.md"
    label: "orchestrator ADR-0006: Land an issue's decision record as an exempt PR before its first story PR"
---

# ADR-0010: Check the plan against the governing decision logs before critique

## Context

Two decision logs bind a plan: the repo's own and the org log governing it. Planning read neither, so a
contradiction first surfaced at reviewer's decision-reviewer. A local copy of the org log can fall
behind its remote and lack the record that now binds.

## Decision

1. We will run `adr check` after plan and before critique, against the repo's log and then the org log the
   repo declares. A public repo declares a public log only.
2. We will take the org log from a configured checkout, fetched first, and cloned when absent if the
   machine has credentials for it. A checkout behind its remote stops the run naming "pull it"; one that
   cannot be fetched or cloned is a check that could not run (ADR-0002).
3. We will record the org-log commit SHA the check saw in the plan artifact.
4. We will draft a record the plan needs on `<n>-adr-<slug>`; orchestrator ADR-0006 governs how it lands.

## Options considered

### Option A: Check both logs after plan, pinned by SHA (chosen)

Chosen: the SHA says which org log the check saw.

### Option B: The repo's log alone

Rejected: the org log the repo declares binds the plan too, and its records would go unchecked.

### Option C: Run with a stale or unreachable org log

Rejected: a checkout behind its remote may miss the governing record, and the plan would pass against a
log nobody can name.

### Option D: Only the review-round decision-reviewer

Rejected: the contradiction would surface after the code is written.

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
