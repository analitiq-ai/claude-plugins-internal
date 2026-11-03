---
schemaVersion: 0.2.0
id: "0011"
title: "Let planner alone create and edit spec folders and decision records"
status: draft
date: 2026-11-03
deciders: []
tags: [spec-folder, decision-log, ownership, planner, reviewer, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0006"]
affects:
  - type: path
    pattern: "specs/**"
  - type: path
    pattern: "**/docs/adr/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/274"
review:
  tier: async
---

# ADR-0011: Let planner alone create and edit spec folders and decision records

## Context

planner ADR-0001 says planner writes the spec and the other plugins read it, but only in its Context, not
as a decision. Nothing decides who writes a decision record. Implementation stories have proposed changes
to their spec and to records from the story branch (issue #274). A rule and the code it governs ship apart
(constitution Principle VI); a story that changes its own spec or record moves both in one PR, and the
review grades the code against a target it just moved.

## Decision

1. We will let planner alone create and edit spec folders (`specs/**`) and decision records: every folder
   `codeworks.toml` `[shared] adr_folders` lists (planner ADR-0009) and every component's `docs/adr`. The one
   exception is a story's tick: a `tasks.md` change that only flips `[ ]` to `[x]` inside the task block
   labelled with the story's issue number (TICK_ONLY, reviewer ADR-0010 d1).
2. We will have builder, reviewer and the orchestrator only read them, but for that tick.
3. We will hold an implementation story's PR whose diff against its merge base changes a decision record, or
   a spec folder beyond TICK_ONLY (reviewer ADR-0013, `adr-<issue>`), and move its card to Blocked for planner
   (orchestrator ADR-0002). One function in `core/` tells TICK_ONLY from any other change, for this hold and
   for reviewer ADR-0010 d1's commit refusal alike.

## Options considered

### Option A: planner alone writes them; a story PR that changes one is held (chosen)

The spec and records a story is graded against stay fixed while it is built; its ticks are its progress
(reviewer ADR-0010).

### Option B: A story may change its spec or records, reviewed in its PR

Rejected: the rule and the code it governs move in one PR (Principle VI).

### Option C: Leave it to planner ADR-0001's Context

Rejected: a Context grades nothing, and it does not mention decision records.

## Trade-offs

- A story that finds its spec or a record wrong stops until planner changes it in a spec PR.
- An admin releases each `adr-<issue>` hold, as every hold (reviewer ADR-0013 d2).

## Consequences

- Easier: a story's spec and records change only in planning, in a spec PR.
- Harder: fixing a typo in a record takes a planning run.
- **How we would know this was wrong:** stories held for spec or record edits more often than they find a
  real gap, a story held for its own ticks, or a spec or record change merged from a story PR.
- Revisit if: a component other than planner must write a spec folder or a record.

## Action items

1. [ ] reviewer places the `adr-<issue>` hold and the orchestrator moves its card to Blocked.
2. [ ] The ratifier ratifies this record, or sends it back.
