---
schemaVersion: 0.1.0
id: "0013"
title: "Start the count again when a file is moved"
status: accepted
date: 2026-10-07
deciders: ["@Analitiq-Bot-Wonka"]
tags: [claim-check, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{claimcheck,claimgate,ledger}.py"
  - type: path
    pattern: "dev/alq-review/specs/005-claim-check-gate/**"
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

# ADR-0013: Start the count again when a file is moved

## Context

ADR-0001 says how a count follows a piece of text across edits inside one file. It says nothing of a file
that is moved to a new path while one of its claims has a running count.

The plan of spec 005 does not decide it either. Its Limits name two cases that start a new count, and a moved
file is not one of them. The third review round of the amendment of specs 005 and 006 found the gap and
left it open.

Git stores a move as a delete of the old path and a create of the new one.

Why now: spec 005 cannot be amended to ADR-0001 while this is open.

## Decision

We will not carry a count to a moved file. The count starts again at the new path.

## Options considered

### Option A: The count starts again at the new path (chosen)

| Dimension | Assessment |
|---|---|
| Needs old and new path to be paired | No |
| Count after a move | Starts from scratch |
| Fits ADR-0001 | Adds a case to its known gap |

### Option B: Do nothing

The specs stay silent on a moved file, and the amendment of spec 005 cannot pass review.

### Option C: Carry the count to the new path

It needs old and new path to be paired. Git pairs them by a similarity index, which decision 4 of
ADR-0001 rules out. Pairing exact moves only would miss a file moved and edited in one step. Rejected: there is no
accurate way to detect that a file was moved.

## Trade-offs

- Moving a file starts a running count again without the user.

## Consequences

- Easier: the claim check needs no way to detect a move.
- Harder: ADR-0001's known gap has one more case, and that ADR has to be read with this one.
- **How we would know this was wrong:** claims that pass the bound because their file was moved.
- Revisit if: git gains a record of moves that needs no similarity index.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [ ] Carry it into the design of ADR-0001's rule (issue #17).
