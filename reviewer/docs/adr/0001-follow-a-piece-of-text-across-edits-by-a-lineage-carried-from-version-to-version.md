---
schemaVersion: 0.1.0
id: "0001"
title: "Follow a piece of text across edits by a lineage carried from version to version"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [claim-check, shim-check, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0008"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{claimcheck,claimgate,shimcheck,shimgate,ledger,lineage}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
review:
  tier: async
externalRefs:
  - type: issue
    id: "17"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
    label: "The full design (D1 to D9), the evidence and the rejected options"
---

# ADR-0001: Follow a piece of text across edits by a lineage carried from version to version

## Context

The claim check and the shim check count failed rulings on a piece of text and stop for the user at a
bound. The count has to follow one claim through its rewordings, ignore other work on the branch, and lower
only by the user's release or the end of that churn (constitution P2). Keyed on `HEAD`, it restarts when
other work moves it; kept per hunk, the hunk's claims share it (issue #17).

## Decision

1. We will mint a lineage at the first failed ruling of a piece of text and carry it from version to
   version, never recomputing it from later words.
2. We will let a diff of blobs decide what descends from what: the file as the previous check saw it
   against the file as staged now; nothing is keyed on `HEAD` or a commit. Text outside the changed ranges
   keeps its lineage. Inside a rewritten range, `diff-match-patch` maps each sentence by character offset,
   through a split or a merge; a claim inheriting several lineages carries the larger count. Words moved
   unchanged are found by their claim id. A file moved to a new path starts its counts again. In the claim
   check a lineage carries no line ranges and merges only when one claim inherits several; the shim check
   carries a bug's line ranges by the same mapping and merges bugs by ADR-0008.
3. We will give the count to the lineage: the failed rulings in its chain of versions.
4. We will let no model and no similarity threshold decide whether two texts are the same claim.

## Options considered

### Option A: A lineage carried by a diff of blobs (chosen)

Follows a claim through rewording, split and merge.

### Option B: Hunk holds keyed on `HEAD`

Rejected: the defects in Context.

### Option C: Key by the claim's words, or by commit shas

Rejected: each rewording starts a new count; a rebase rewrites shas.

### Option D: Similarity matching, or carrying a count to a moved file

Rejected: both need a similarity threshold (git pairs moves by one).

## Trade-offs

- `diff-match-patch` on the hook path, and a small hand-rolled core.
- Text moved and reworded in one step, or a moved file, starts a new count: the rule stops a loop on one
  claim, not an agent moving text on purpose.

## Consequences

- Easier: an amend, a rebase or other work leaves every count as it was.
- Harder: each such gate keeps, per file, the text its last check saw.
- **How we would know this was wrong:** a hold on a claim with fewer failed rulings than the bound, or a
  count changed by unrelated work.
- Revisit if: a tool follows a sentence across versions without a threshold.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
