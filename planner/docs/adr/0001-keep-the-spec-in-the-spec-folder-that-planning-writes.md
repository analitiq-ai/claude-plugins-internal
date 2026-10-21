---
schemaVersion: 0.1.0
id: "0001"
title: "Keep the spec in the spec folder that planning writes"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, spec-folder, skills]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0010"]
affects:
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "planner/plugin/speckit/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
review:
  tier: async
---

# ADR-0001: Keep the spec in the spec folder that planning writes

## Context

planner scopes an issue into a spec folder (spec 019, Terms; issue #63).

planner writes the spec; the other two plugins read it. Review finds the spec folder from the spec's issue at
each round's launch, and its reviewers read its `spec.md` (reviewer ADR-0014). `/builder:issue-tackle` builds
against the same folder (root ADR-0005).

Nothing reads an issue comment for the spec: review finds it from the spec's issue, and `issue-tackle` reads no
issue comment (FR-016).

## Decision

We will keep the spec of a change in its spec folder. Planning writes it there and puts no copy of it on the issue.

## Options considered

### Option A: The spec folder is the one home (chosen)

| Dimension | Assessment |
|---|---|
| Where the spec is | In the repo, beside the plan and research of the same change |
| Places to read for one change | One |
| Needs a checkout to write the spec | Yes |
| Seen in a PR diff | Yes, a change to the spec is a reviewed change |
| Matches what review and build read | Yes, both read `spec.md` from the folder |

### Option B: Do nothing

planner's log holds no record of where its spec lives, and each change to the planning skill decides it again.

### Option C: The spec in an issue comment

Rejected: two places to read for one change, with nothing keeping them in step, and no plugin reads it.

### Option D: Both, with one a copy of the other

Rejected: the copy drifts from the one it copies.

## Trade-offs

- A spec folder lives in a checkout. A spec cannot be written from anywhere with only `gh`.
- A scoped issue needs its spec PR merged before any story is built (ADR-0010).
- Nothing on the issue says where its spec is; readers find it by the spec's issue number in the folder name,
  `specs/<p>-*/`.
- The bot's issue picker and the `alq-claude-bot-assign` skill look for the spec in an issue comment and find none.
  Spec 019 leaves them out of scope.

## Consequences

- Easier: one place to read and to change the spec, and the change shows in a diff. Review and build need nothing
  from the issue to read it.
- Harder: a folder's name must carry its spec's issue number, since build and review find it by that number
  (root ADR-0005).
- **How we would know this was wrong:** a scoped issue that nobody can pick up because its spec PR was never
  opened or merged, or because nobody can find which folder holds it.
- Revisit if: specs have to be written for repos where no checkout exists at scoping time.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
