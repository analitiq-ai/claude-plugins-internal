---
schemaVersion: 0.1.0
id: "0001"
title: "Keep the spec of a change in its spec folder"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, skills]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002"]
affects:
  - type: path
    pattern: "builder/plugin/skills/{issue-tackle,root-cause-check}/SKILL.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
review:
  tier: async
externalRefs:
  - type: issue
    id: "63"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
    label: "Move planning (issue-spec) out of reviewer into its own plugin"
---

# ADR-0001: Keep the spec of a change in its spec folder

## Context

Issue #63 split reviewer into three plugins. `builder` took `issue-tackle` and `root-cause-check`,
which implement an issue against its spec and judge whether a fix reached the cause the spec names. The split
was settled with the user on 2026-10-09 (spec 019, FR-015 to FR-017).

Nothing in this log says where the spec these two skills build against lives.

A spec can have two homes: a marked comment on the issue, and a spec folder in the repo. A reader then has
to open both to know what a change must do, and nothing keeps the two in step. The case for the comment is
that an issue can be shaped today and picked up next week, "so the spec cannot live in a worktree that does
not exist yet".

A spec folder is `specs/<feature>/`, a folder whose parent is named `specs`. It may hold `spec.md`, `plan.md`,
`research.md` and more (spec 019, Terms and Key Entities).

Why now: research R16 gives builder a log of its own and has it land before the move of the two skills into
builder.

## Decision

1. We will keep the spec of a change that `builder` builds in its spec folder. The spec is that folder's
   `spec.md`.

## Options considered

### Option A: The spec folder is the one home (chosen)

| Dimension | Assessment |
|---|---|
| Where the spec is | `<spec folder>/spec.md`, in the repo |
| Places to read for one change | One |
| Needs a checkout to write the spec | Yes |
| Seen in a PR diff | Yes, a change to the spec is a reviewed change |

### Option B: The issue comment is the spec

The spec can be written with `gh` alone, before any checkout exists. Rejected: a spec folder exists for
the same change, so two places stay in use and nothing keeps them in step.

### Option C: Both, with one a copy of the other

Rejected: a copy in the worktree is "one `git add .` from being committed beside the comment it drifts
from".

## Trade-offs

- A spec folder lives in a checkout. A spec cannot be written from anywhere with only `gh`.
- An issue needs its spec PR merged before any story of it is built (planner ADR-0010).

## Consequences

- Easier: `issue-tackle` and `root-cause-check` read one file for the spec, and a change to it shows in a
  diff.
- Harder: whoever starts `issue-tackle` needs the spec PR merged first.
- **How we would know this was wrong:** an issue nobody can build because its spec PR was never merged.
- Revisit if: specs have to be written for repos where no checkout exists when the issue is scoped.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
