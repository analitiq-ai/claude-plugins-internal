---
schemaVersion: 0.2.0
id: "0019"
title: "Run every reviewer and the assessment inside one review-round workflow"
status: draft
date: 2026-10-20
deciders: []
tags: [review-round, reviewers, assessment, launch-gate, dependencies, round-cap]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0013", "0014", "0015", "0016", "0020"]
affects:
  - type: path
    pattern: "reviewer/plugin/workflows/{review-round,assess-round}.js"
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,briefs,policy,assessment}.py"
  - type: path
    pattern: "reviewer/plugin/agents/**"
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "reviewer/plugin/.claude-plugin/plugin.json"
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

# ADR-0019: Run every reviewer and the assessment inside one review-round workflow

## Context

A self-launched assessment, a reviewer dispatched from the main thread, or a copy of auditor's dispatch
inside reviewer each leave reviewer unable to enforce that an assessment ran on reports from reviewers
behind a barrier, or which plugins a round depends on.

## Decision

1. We will run every stage in one workflow, `review-round {worktree, stage}` (ADR-0014):
   reviewers behind a barrier (internal, audit) or the github stage's findings (ADR-0016), then
   the assess phase; `assess-round` launched from outside is refused. Each report is validated
   against its typed verdict first.
2. We will refuse any reviewer type dispatched from the main thread, outside a round, on a story
   branch or on a branch inside the grammar with an open PR: on a story branch naming review-round, on
   `<p>-spec`, where no round runs (ADR-0014), naming the human's review of the spec PR. main and branches
   outside the grammar keep main-thread dispatch.
3. We will have reviewer's decision-reviewer join every internal round; with no governing
   record, it flags a decision made in the diff with no record.
4. We will declare pr-review-toolkit and auditor as dependencies, pin the accepted auditor version in
   the `[reviewer]` section of `codeworks.toml` (root ADR-0002), refuse a round's launch when an
   expected agent type is missing, and read auditor's dispatch as data at launch.
5. We will cap github rounds at a number in the `[reviewer]` section. Past it, the next round
   runs the audit stage on the whole PR. Only a human resets the count, by Ready or by
   `unlock audit-<issue>`. The cap switches the stage, locking
   nothing; a human comes in only through the audit hold (ADR-0013).

## Options considered

### Option A: One workflow, the agent gate, dependencies as data (chosen)

### Option B: `assess-round` launched separately

Rejected: an assessment the agent can run on its own cannot be refused.

### Option C: Reviewers dispatched from the main thread

Rejected: a self-dispatched reviewer has no barrier and no typed report.

### Option D: The decision-reviewer only under a governing ADR

Rejected: an unrecorded decision in the diff would go unflagged.

### Option E: A dispatch copy in `briefs.py`

Rejected: a second copy of auditor's published dispatch.

### Option F: Past the cap, hold the PR for a human

Rejected: the whole-PR audit can end the churn alone; its hold brings a human in.

## Trade-offs

- A missing dependency blocks every round that expects its agents.
- Every internal round pays for a decision-reviewer.
- Past the cap, a round costs a whole-PR audit.

## Consequences

- Easier: both loops run review-round and act on its rulings.
- Harder: reviewer needs two other plugins installed.
- **How we would know this was wrong:** a reviewer type runs on a story branch outside a round, or
  an assessment no round produced is recorded.
- Revisit if: the audit agents move into this repo, or a reviewer must run outside a round.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
