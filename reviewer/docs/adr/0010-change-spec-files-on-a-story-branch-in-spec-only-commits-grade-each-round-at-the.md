---
schemaVersion: 0.2.0
id: "0010"
title: "Change spec files on a story branch in spec-only commits; grade each round at the reviewed commit"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, review-round, holds, rescope]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0013", "0014", "0015"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,specbinding,shell}.py"
  - type: path
    pattern: "reviewer/plugin/README.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/pull/108"
review:
  tier: async
externalRefs:
  - type: issue
    id: "104"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/104"
    label: "reviewer: spec.md is read-only on a story branch; a spec change lands in its own spec-only PR"
  - type: pr
    id: "108"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/pull/108"
    label: "Spec, plan and research the first draft of this record was drafted from"
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per issue, in the repo"
---

# ADR-0010: Change spec files on a story branch in spec-only commits; grade each round at the reviewed commit

## Context

On a story branch the agent graded against `spec.md` can also edit it. No spec PR exists (org ADR-0002), so a
spec change lands on the story branch itself.

## Decision

1. We will let `spec.md`, `plan.md`, `research.md` and `premise.md` change on a story branch only in a
   spec-only commit: every staged path under `specs/<n>-*/`, `tasks.md` untouched beyond ticks.
   `tasks.md` changes in an ordinary commit only when the diff is tick-only. A spec-only commit is
   refused while a round is collecting or awaiting assessment.
2. We will grade every round against `spec.md` at the reviewed commit: no blob id, no hold on a changed
   `spec.md`. The round after a spec-only commit is full scope.
3. We will have a `RESCOPE` verdict place `rescope-<pr>`, which refuses code commits and lets spec-only
   commits pass; its release is every hold's (ADR-0013).

## Options considered

### Option A: Spec-only commits, graded at the reviewed commit (chosen)

A round reads the committed `spec.md`, so a changed spec needs no acknowledgement.

### Option B: Refuse a launch on a mixed diff

Rejected: a rescope lands spec-only on the open story branch, so the story PR's diff carries it.

### Option C: `rebase <ref>` after a spec PR

No spec PR exists (org ADR-0002); a hold is released at the launch after Ready or by `unlock <id>` (ADR-0013).

### Option D: A blob-id hold on a changed `spec.md`

Rejected: any edit to `spec.md`, a typo fix included, would hold the PR until the user releases it.

## Trade-offs

- Reviewer admits a spec-only commit by its paths alone, so the graded agent can change the spec it is
  graded against.
- Every spec-only commit costs a full-scope round.

## Consequences

- Easier: no stored copy of `spec.md` can drift from the committed one.
- Harder: a spec change waits until the open round is assessed.
- **How we would know this was wrong:** commits repeatedly refused for mixing spec files with code, or
  `RESCOPE` ruled again on the first full-scope round after a spec-only commit.
- Revisit if: org ADR-0002 brings back a spec PR.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
