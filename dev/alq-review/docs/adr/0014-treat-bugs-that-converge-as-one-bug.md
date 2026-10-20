---
schemaVersion: 0.1.0
id: "0014"
title: "Treat bugs that converge as one bug"
status: accepted
date: 2026-10-07
deciders: ["@Analitiq-Bot-Wonka"]
tags: [shim-check, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{shimcheck,shimgate,ledger}.py"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
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

# ADR-0014: Treat bugs that converge as one bug

## Context

The shim check keeps one record per bug, with the bug's line ranges and its count of refusals. One staged
change can overlap two bugs that have a record each.

Spec 006 says of it: "One commit edits sites of two refused bugs: it counts toward both (FR-015 applies to
each)." It does not say which bug the deep sweep, the hold and the override then belong to. The third review
round of the amendment of specs 005 and 006 found the gap. Its reviewers proposed fills that contradict each other.

Why now: the amendment of spec 006 to ADR-0001 was stopped in review on this question. The plan did not
weigh merging.

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
| Later steps | Applied to both together |
| Count of refusals | The higher of the two |

### Option B: Do nothing

The commit keeps counting toward both bugs, and the spec keeps saying nothing of their deep sweep, hold and
override.

### Option C: Keep the bugs apart and treat each as if it were alone

Each bug keeps its own count and gets its own deep sweep at its own third refusal. Rejected: a commit that
fixes two bugs and is ruled a patch needs both sent for the deeper sweep together.

### Option D: Add the two counts

Rejected: the sum can reach the limit at once, so a commit is held although neither bug had reached it.

### Option E: Start the merged bug's count again

Rejected: a commit that touches two bugs would wipe both counts.

## Trade-offs

- Two bugs that converged stay one bug, with one hold, when they are in fact unrelated.
- The bug with fewer refusals takes on the count of the other.

## Consequences

- Easier: one check of one change gives one verdict to one bug.
- Harder: the shim check's design has to say how two bugs become one, and a commit no longer counts toward
  both. ADR-0001 says "holds will not be merged", and has to be read with this ADR.
- **How we would know this was wrong:** users who override a merged bug and say its two halves had nothing to
  do with each other.
- Revisit if: such reports come in.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [x] Carry it into the design of ADR-0001's rule (issue #17). Done in #60.
