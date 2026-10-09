---
schemaVersion: 0.1.0
id: "0001"
title: "Keep the spec of a change in its spec folder"
status: draft
date: 2026-10-09
deciders: []
tags: [spec, skills]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002"]
affects:
  - type: path
    pattern: "plugins/alq-build/skills/{issue-tackle,root-cause-check}/SKILL.md"
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
    label: "Move planning (alq-spec) out of alq-review into its own plugin"
---

# ADR-0001: Keep the spec of a change in its spec folder

## Context

Issue #63 splits alq-review into three plugins. `alq-build` takes `issue-tackle` and `root-cause-check`,
which implement an issue against its spec and judge whether a fix reached the cause the spec names. The split
was settled with the user on 2026-10-09 (spec 019, FR-015 to FR-017).

alq-review's ADR-0008, decision 1, keeps the spec of a change in its spec folder. Spec 019 says an existing
ADR that binds a new plugin is decided again in that plugin's log, not copied (FR-023). Until it is, nothing
in this log says where the spec these two skills build against lives.

ADR-0008 gives the forces. A spec had two homes: a marked comment on the issue, and a spec folder in the
repo. A reader had to open both to know what a change must do, and nothing kept the two in step. The comment
had been chosen because an issue can be shaped today and picked up next week, "so the spec cannot live in a
worktree that does not exist yet".

A spec folder is `specs/<feature>/` beside a committed `.specify/` folder. It may hold `spec.md`, `plan.md`,
`research.md` and more (spec 019, Terms and Key Entities).

## Decision

1. We will keep the spec of a change that `alq-build` builds in its spec folder. The spec is that folder's
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

The spec can be written with `gh` alone, before any checkout exists. Rejected for the reason ADR-0008
gives: a spec folder exists for the same change, so two places stay in use and nothing keeps them in step.

### Option C: Both, with one a copy of the other

`alq-issue-tackle` already rejected a second copy: a file in the worktree is "one `git add .` from being
committed beside the comment it drifts from" (ADR-0008, Option C).

## Trade-offs

- A spec folder lives in a checkout. A spec can no longer be written from anywhere with only `gh`.
- An issue needs a branch that holds its spec folder before anyone can build it.

## Consequences

- Easier: `issue-tackle` and `root-cause-check` read one file for the spec, and a change to it shows in a
  diff.
- Harder: whoever starts `issue-tackle` needs the spec folder on a branch first.
- **How we would know this was wrong:** an issue nobody can build because its spec is on a branch that was
  never pushed.
- Revisit if: specs have to be written for repos where no checkout exists when the issue is scoped.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
