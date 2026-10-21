---
schemaVersion: 0.2.0
id: "0014"
title: "Derive the spec from the branch at each round's launch and read the folder as data"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, spec-folder, review-round, branch-grammar, front-matter]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0010"]
affects:
  - type: path
    pattern: "reviewer/plugin/workflows/review-round.js"
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,briefs,specbinding,github,worktree}.py"
  - type: path
    pattern: "reviewer/plugin/README.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
---

# ADR-0014: Derive the spec from the branch at each round's launch and read the folder as data

## Context

A review round has to know which spec governs its PR, and what to read from that spec's folder. The branch
names the story issue, and `core/` derives the spec's issue and its folder from it (root ADR-0005).

## Decision

1. We will take `review-round {worktree, stage}`, no `spec`: the review-round launch gate derives the
   story issue, the spec's issue and the spec folder from the branch at HEAD through `core/` (root
   ADR-0005). Any other branch, `<p>-spec` included, is refused a round. Every round derives the spec
   afresh and grades at the reviewed commit (ADR-0010); the round records no spec binding, neither a value
   nor a blob id, and none can be rebound.
2. We will read the folder as data and validate none of it (planning checks its own output): `spec.md`
   whole for reviewers and assessor, or the issue body as the requirement when `codeworks.kind` is
   `no_spec` (root ADR-0005), and the `codeworks` keys for dispatch (planner ADR-0008); never headings.

## Options considered

### Option A: Derived from the branch at each launch; read by keys (chosen)

Keys survive a template change where headings do not.

### Option B: `spec` passed at the round's launch, bound in the ledger

Rejected: the branch already names the story issue, and a bound copy can drift from the committed spec.

### Option C: Reviewers read the spec folder by its headings

Rejected: a template change breaks every reader.

## Trade-offs

- A PR from a branch outside the grammar never gets internal-review; a spec PR, a revert or a release
  bump reaches the default branch only as an exempt PR (orchestrator ADR-0005).
- Every round's launch costs one more GitHub read, the story issue's parent.
- A folder written outside planning reaches review unchecked.

## Consequences

- Easier: a review-round launch needs only the checkout and the stage.
- Harder: a third branch kind needs a grammar change in `core/`.
- **How we would know this was wrong:** a review-round launch cannot find a story branch's spec; a round
  grades another issue's folder; a template change breaks a reader.
- Revisit if: a spec's issue needs two spec folders (org ADR-0002).

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
