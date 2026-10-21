---
schemaVersion: 0.1.0
id: "0008"
title: "Treat bugs that converge as one bug"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [shim-check, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{shimcheck,shimgate,ledger}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
review:
  tier: async
externalRefs:
  - type: issue
    id: "17"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
    label: "The lineage design that ADR-0001 decided and this ADR adds to"
---

# ADR-0008: Treat bugs that converge as one bug

## Context

The shim check keeps one record per bug, with the bug's line ranges (ADR-0001) and its count of refusals.
One staged change can overlap two bugs that have a record each. The deep sweep, the hold and the override
each belong to one bug, so a change that overlaps two has to say which bug they then belong to.

## Decision

1. We will treat two tracked bugs as one bug from the moment one staged change overlaps both. Every later
   step applies to them together.
2. We will give the merged bug the higher of the two counts of refusals.

## Options considered

### Option A: Converged bugs become one bug (chosen)

| Dimension | Assessment |
|---|---|
| One check of a change that overlaps two bugs | One verdict for one bug |
| Deep sweep | One, for both together |
| Count of refusals | The higher of the two |

### Option B: Count toward both, and say nothing more

Leaves the deep sweep, the hold and the override of each bug undecided.

### Option C: Keep the bugs apart and treat each as if it were alone

Each bug keeps its own count and gets its own deep sweep. Rejected: a commit that fixes two bugs and is
ruled a patch needs both sent for the deeper sweep together.

### Option D: Add the two counts

Rejected: the sum can reach the limit at once, so a commit is held although neither bug had reached it.

### Option E: Start the merged bug's count again

Rejected: a commit that touches two bugs would wipe both counts.

## Trade-offs

- Two bugs that converged stay one bug, with one hold, when they are in fact unrelated.
- The bug with fewer refusals takes on the count of the other.

## Consequences

- Easier: one check of one change gives one verdict to one bug.
- Harder: the shim check records how two bugs became one.
- **How we would know this was wrong:** users who override a merged bug and say its two halves had nothing to
  do with each other.
- Revisit if: such reports come in.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
