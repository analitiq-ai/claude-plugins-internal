---
schemaVersion: 0.1.0
id: "0014"
title: "Treat bugs that converge as one bug"
status: draft
date: 2026-10-07
deciders: []
tags: [shim-check, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{shimcheck,shimgate,ledger}.py"
  - type: path
    pattern: "dev/alq-review/specs/006-shim-check-gate/**"
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

We will treat bugs that converge as one bug. When two bugs that are tracked apart converge, they are one bug
from then on, and every later step applies to them together.

We will set the rest in the amendment of spec 006, the count of the merged bug included.

## Options considered

### Option A: Converged bugs become one bug (chosen)

| Dimension | Assessment |
|---|---|
| One check of a change that overlaps two bugs | One verdict for one bug |
| Deep sweep | One, for both together |
| Later steps | Applied to both together |

### Option B: Do nothing

The commit keeps counting toward both bugs, and the spec keeps saying nothing of their deep sweep, hold and
override.

### Option C: Keep the bugs apart and treat each as if it were alone

Each bug keeps its own count and gets its own deep sweep at its own third refusal. Rejected: a commit that
fixes two bugs and is ruled a patch needs both sent for the deeper sweep together.

## Trade-offs

- Two bugs that converged stay one bug, with one hold, when they are in fact unrelated.

## Consequences

- Easier: one check of one change gives one verdict to one bug.
- Harder: spec 006 has to say how two bugs become one, and its "counts toward both" is replaced. ADR-0001 says "holds will not be merged", and has
  to be read with this ADR.
- **How we would know this was wrong:** users who override a merged bug and say its two halves had nothing to
  do with each other.
- Revisit if: such reports come in.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Amend spec 006 to it, in the PR that amends it to ADR-0001.
