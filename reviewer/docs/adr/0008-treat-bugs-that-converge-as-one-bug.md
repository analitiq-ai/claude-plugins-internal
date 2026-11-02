---
schemaVersion: 0.1.0
id: "0008"
title: "Treat bugs that converge as one bug"
status: accepted
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
  - type: path
    pattern: "core/src/contracts/gates.ts"
  - type: path
    pattern: "reviewer/plugin/lib/check/shim.ts"
  - type: path
    pattern: "reviewer/plugin/lib/rules/counts.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:51Z
---

# ADR-0008: Treat bugs that converge as one bug

## Context

The shim check keeps one record per bug: its line ranges (ADR-0001) and the trees of the checks that refused
it, from which its count of refusals is derived (ADR-0013 d4). One checked change (ADR-0002) can overlap two
bugs that have a record each. The deep sweep, the hold and its release each belong to one bug, so a change that
overlaps two has to say which bug they then belong to.

## Decision

1. We will treat two tracked bugs as one bug from the moment one checked change overlaps both. Every later
   step applies to them together.
2. We will give the merged bug the higher of the two counts of refusals. The bug with the higher count goes
   on: it keeps its `members`, moves every tree of the other into `absorbed` as evidence, never counted, and
   takes the union of both bugs' ranges. The other bug is dropped.
3. We will keep each open bug in the gates section of the story's state snapshot (ADR-0011 d1), in the shape
   of core's snapshot contract `Gates` (`core/src/contracts/gates.ts`).
4. We will never count again a tree in a bug's `members` or `absorbed`: a check run again on that tree adds
   nothing to the bug.

## Options considered

### Option A: Converged bugs become one bug (chosen)

| Dimension | Assessment |
|---|---|
| One check of a change that overlaps two bugs | One verdict for one bug |
| Deep sweep | One, for both together |
| Count of refusals | The higher of the two |

### Option B: Count toward both, and say nothing more

Leaves the deep sweep, the hold and the release of each bug undecided.

### Option C: Keep the bugs apart and treat each as if it were alone

Each bug keeps its own count and gets its own deep sweep. Rejected: a commit that fixes two bugs and is
ruled a patch needs both sent for the deeper sweep together.

### Option D: Add the two counts

Rejected: the sum can reach the limit at once, so a commit is held although neither bug had reached it.

### Option E: Start the merged bug's count again

Rejected: a commit that touches two bugs would wipe both counts.

### Option F: Carry the other bug's trees into `members`

Rejected: the count is derived from `members` (ADR-0013 d4), so it would add the two counts (Option D).

## Trade-offs

- Two bugs that converged stay one bug, with one hold, when they are in fact unrelated.
- The bug with fewer refusals takes on the count of the other.

## Consequences

- Easier: one check of one change gives one verdict to one bug.
- Harder: d2 makes a merged bug carry the other's trees in `absorbed`, apart from the trees it counts.
- **How we would know this was wrong:** admins who release a merged bug's hold and say its two halves had
  nothing to do with each other.
- Revisit if: such reports come in.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
