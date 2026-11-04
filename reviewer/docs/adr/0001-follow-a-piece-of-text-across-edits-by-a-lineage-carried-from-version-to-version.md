---
schemaVersion: 0.1.0
id: "0001"
title: "Follow a piece of text across edits by a lineage carried from version to version"
status: accepted
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
  - type: path
    pattern: "core/src/contracts/gates.ts"
  - type: path
    pattern: "reviewer/plugin/lib/check/{claim,shim,lineage}.ts"
  - type: path
    pattern: "reviewer/plugin/lib/rules/counts.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:50Z
---

# ADR-0001: Follow a piece of text across edits by a lineage carried from version to version

## Context

The claim check and the shim check count failed rulings on a piece of text and stop for the user at a
bound. The count has to follow one claim through its rewordings and ignore other work on the branch. Keyed
on `HEAD`, it restarts when other work moves it; kept per hunk, the hunk's claims share it (issue #17).

## Decision

1. We will mint a lineage at the first failed ruling of a piece of text and carry it from version to
   version, never recomputing it from later words.
2. We will let a diff of blobs decide what descends from what: the file at the story branch's anchor commit
   against the file at the commit now checked (ADR-0002). The anchor is the head of the newest check completed
   on the branch, claim or shim; each completed check carries every open lineage and bug to it. The anchor
   names only the text positions index into: no lineage is keyed on `HEAD` or a commit. Text outside the
   changed ranges keeps its lineage. Inside a rewritten range, `diff-match-patch` maps each sentence by
   character offset, through a split or a merge; a claim inheriting several lineages carries the larger count.
   Words moved unchanged are found by their claim id. A file moved to a new path starts its counts again. In
   the claim check a lineage carries no line ranges and merges only when one claim inherits several; the shim
   check carries a bug's line ranges by the same mapping and merges bugs by ADR-0008. We will store only open
   lineages, in the `gates` section of the story's state snapshot (ADR-0011 d1), against the anchor: per
   lineage its file, its places as character ranges in the anchor's text, each with its claim id, and its
   chain of rulings, each with its check, claim, line, words, ruling and time. A lineage is dropped once no
   place is left to it or it merges into another. The section holds the story's one branch and its anchor: a
   check on another branch stops with an error naming both branches. A check looks for the anchor in the hooks'
   copy, then fetches it by its sha from the model's clone (ADR-0021 d6), then from GitHub; when none has it,
   the check stops with an error naming the branch, the anchor and `/codeworks reset`. Once an admin's reset
   is newer than every time the section holds, a check that cannot find the anchor drops the section's
   lineages and bugs and anchors on its own head (ADR-0013 d3). No count or
   release floor is stored: each is derived from the chain's rulings and their times, a check counting once
   (ADR-0013 d3, d4).
3. We will give the count to the lineage: the checks that ruled it WRONG in its chain of versions, each once.
4. We will let no model and no similarity threshold decide whether two texts are the same claim.

## Options considered

### Option A: A lineage carried by a diff of blobs (chosen)

Follows a claim through rewording, split and merge.

### Option B: Hunk holds keyed on `HEAD`

Rejected: the defects in Context.

### Option C: Key by the claim's words, or by commit shas

Rejected: each rewording starts a new count; a rebase rewrites shas.

### Option D: A model, similarity matching, or a count carried to a moved file

Rejected: a model's answer varies between asks and would run in every commit's hook; the others need a
similarity threshold (git pairs moves by one).

### Option E: Keep every lineage, ended ones too, and per file the text the last check saw, beside the session

Rejected: lost when the session ends (ADR-0011 Option D); git holds that text at the anchor, and nothing
reads an ended lineage again.

### Option F: Store each count, or the count a release left

Rejected: a reset or a release would need a gates write to take effect, and a stored count can drift from the
rulings it counts.

### Option G: Anchor on the branch's head on GitHub

Rejected: a claim first written in an unpushed commit has no place in that text.

## Trade-offs

- `diff-match-patch` on the hook path, and a small hand-rolled core.
- Text moved and reworded in one step, or a moved file, starts a new count: the rule stops a loop on one
  claim, not an agent moving text on purpose.
- A check whose anchor is gone from the hooks' copy, the model's clone and GitHub stops until an admin's
  reset, which drops the open lineages and bugs with it.

## Consequences

- Easier: an amend, a rebase or other work leaves every count as it was.
- Harder: each such gate reads the anchor's text from git, and the story's state record carries every open
  lineage.
- **How we would know this was wrong:** a hold on a claim with fewer failed rulings than the bound, or a
  count changed by unrelated work.
- Revisit if: a tool follows a sentence across versions without a threshold.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
