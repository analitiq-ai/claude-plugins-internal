---
schemaVersion: 0.2.0
id: "0020"
title: "Change spec files on a story branch in spec-only commits; grade each round at the reviewed commit"
status: draft
date: 2026-10-19
deciders: []
tags: [spec, review-round, holds, rescope]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0023", "0024", "0025"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,policy,specbinding,shell}.py"
  - type: path
    pattern: "plugins/alq-review/README.md"
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
    label: "alq-review: spec.md is read-only on a story branch; a spec change lands in its own spec-only PR"
  - type: pr
    id: "108"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/pull/108"
    label: "Spec, plan and research the first draft of this record was drafted from"
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "ALQ plugins target design: rewrite the decision records of alq-review, alq-plan and alq-build"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per issue, in the repo"
---

# ADR-0020: Change spec files on a story branch in spec-only commits; grade each round at the reviewed commit

## Context

On a story branch the agent graded against `spec.md` can also edit it. The draft's launch refusal on a mixed
diff and its `rebase <ref>` release assumed a spec PR; with none (org ADR-0002), both go.

## Decision

1. We will let `spec.md`, `plan.md`, `research.md` and `premise.md` change on a story branch only in a
   spec-only commit: every staged path under `specs/<n>-*/`, `tasks.md` untouched beyond ticks.
   `tasks.md` changes in an ordinary commit only when the diff is tick-only. A spec-only commit is
   refused while a round is collecting or awaiting assessment.
2. We will grade every round against `spec.md` at the reviewed commit: no blob id, no hold on a changed
   `spec.md`. The round after a spec-only commit is full scope.
3. We will have a `RESCOPE` verdict place `rescope-<pr>`, which refuses code commits and lets spec-only
   commits pass; its release is every hold's (ADR-0023).

## Options considered

### Option A: Spec-only commits, graded at the reviewed commit (chosen)

A round reads the committed `spec.md`, so a changed spec needs no acknowledgement.

### Option B: Refuse a launch on a mixed diff (as drafted)

Rejected: a rescope lands spec-only on the open story branch, so the story PR's diff carries it.

### Option C: `rebase <ref>` after a spec PR (as drafted)

No spec PR exists (org ADR-0002); a hold is released at the launch after Ready or by `unlock <id>` (ADR-0023).

### Option D: A blob-id hold on a changed `spec.md` (ADR-0016, decision 6)

Stays rejected.

## Trade-offs

- The gate admits a spec-only commit by its paths alone, so the graded agent can change the spec it is
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
