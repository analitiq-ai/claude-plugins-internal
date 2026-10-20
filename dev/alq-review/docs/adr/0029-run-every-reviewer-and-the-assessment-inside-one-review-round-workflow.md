---
schemaVersion: 0.2.0
id: "0029"
title: "Run every reviewer and the assessment inside one review-round workflow"
status: draft
date: 2026-10-19
deciders: []
tags: [review-round, reviewers, assessment, launch-gate, dependencies]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0006", "0009", "0024", "0026"]
affects:
  - type: path
    pattern: "plugins/alq-review/workflows/{review-round,assess-round}.js"
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,briefs,policy,assessment}.py"
  - type: path
    pattern: "plugins/alq-review/config.json"
  - type: path
    pattern: "plugins/alq-review/agents/**"
  - type: path
    pattern: "plugins/alq-review/README.md"
  - type: path
    pattern: "plugins/alq-review/.claude-plugin/plugin.json"
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
---

# ADR-0029: Run every reviewer and the assessment inside one review-round workflow

## Context

Today the agent launches the assessment itself, any reviewer type can be
dispatched from the main thread (pr-audit's trigger), and auditor's dispatch is copied
into `briefs.py`. Whether an assessment ran on reports from reviewers behind a
barrier, whether a reviewer ran inside a round at all, and which plugins a round depends on, is
nothing reviewer can enforce.

## Decision

1. We will run every stage in one workflow, `review-round {worktree, stage}` (ADR-0024):
   reviewers behind a barrier (internal, audit) or the github stage's findings (ADR-0026), then
   the assess phase. `assess-round` launched from outside is refused. Every reviewer's report is
   validated against its typed verdict before the assess phase reads it.
2. We will refuse any reviewer type dispatched from the main thread, outside a round, on a story
   branch or on a branch inside the grammar with an open PR, naming review-round; main and branches
   outside the grammar (ADR-0024) keep main-thread dispatch.
3. We will have reviewer's decision-reviewer join every internal round; with no governing
   record, its brief is to flag a decision made in the diff with no record.
4. We will declare pr-review-toolkit and auditor as dependencies, with the accepted
   auditor version pinned in config.json, refuse a round's launch when an expected agent
   type is missing, and read auditor's dispatch as data at the round's launch.

## Options considered

### Option A: One workflow, the agent gate, dependencies as data (chosen)

### Option B: `assess-round` launched separately (today)

Rejected: an assessment the agent can run on its own cannot be refused.

### Option C: Reviewers dispatched from the main thread (today)

Rejected: a self-dispatched reviewer has no barrier and no typed report.

### Option D: The decision-reviewer only under a governing ADR

Rejected: with no governing record it would never run, so an unrecorded decision in
the diff would go unflagged.

### Option E: A dispatch copy in `briefs.py`

Rejected: it is a second copy of a dispatch auditor publishes as data.

## Trade-offs

- A missing dependency blocks every round that expects its agents, including the reviewers that
  are installed.
- Every internal round pays for a decision-reviewer, even on a diff no record governs.

## Consequences

- Easier: both loops are "run review-round, act on its rulings".
- Harder: reviewer works only with two other plugins installed.
- **How we would know this was wrong:** a reviewer type runs on a story branch outside a round;
  an assessment no round produced is recorded; a dispatch copy returns to `briefs.py`.
- Revisit if: the audit agents move into this repo, or a reviewer must run outside a round.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
