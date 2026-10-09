---
schemaVersion: 0.1.0
id: "0008"
title: "Keep the spec in the spec folder, not in an issue comment"
status: accepted
date: 2026-10-06
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec, review-round, skills]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0016"]
affects:
  - type: path
    pattern: "plugins/alq-review/skills/{alq-shape,alq-issue-tackle,alq-root-cause-check,design-doc}/SKILL.md"
  - type: path
    pattern: "plugins/alq-review/scripts/{github,briefs,gate}.py"
  - type: path
    pattern: "dev/alq-review/{tests/test_spec_source.py,specs/014-review-spec/**}"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/25"
review:
  tier: async
externalRefs:
  - type: issue
    id: "25"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/25"
    label: "What treats the issue comment as the spec today, and the points not decided"
---

# ADR-0008: Keep the spec in the spec folder, not in an issue comment

## Context

The spec of a change has two homes: a marked comment on the issue, and a spec folder in the repo.

The skills `alq-shape`, `alq-issue-tackle` and `alq-root-cause-check` read the spec from a marked comment on
the issue, and `alq-shape` calls the issue its only home. It gives the reason: an issue can be shaped today and picked up next week,
"so the spec cannot live in a worktree that does not exist yet". Spec 014 built the review gate on that
comment: the gate puts the comment into each internal reviewer's prompt.

The `design-doc` skill writes a spec folder, `<dir>/specs/<feature>/`, for the same change. Seven spec
folders each open by saying that the acceptance criteria are the issue comment. So a reader has to open two places to know what a change must do, and nothing keeps
the two in step.

The format of the comment in which an issue names its spec folder, and the points still open, are in
issue #25.

Why now: issue #25 moves the spec into the spec folder, and the skills and the gate still read the comment.

## Decision

1. We will keep the spec of a change in its spec folder.
2. We will have every part of the plugin that reads the spec read it from the spec folder: the skills that
   shape and tackle an issue, and what the gate hands to the internal reviewers and to the assessor.
3. We will have the issue name its spec folder, in one comment. The gate refuses when the comment is
   missing or names a folder that is not there.

## Options considered

### Option A: The spec folder is the one home (chosen)

| Dimension | Assessment |
|---|---|
| Where the acceptance criteria are | In the repo, beside the design decisions |
| Places to read for one change | One |
| Needs a checkout to write the spec | Yes |
| Seen in a PR diff | Yes, a change to the spec is a reviewed change |

### Option B: Do nothing

The comment stays the spec and the folder holds design decisions only. Two places stay in use for one
change.

### Option C: Both, with one a copy of the other

`alq-issue-tackle` already rejects a second copy: a file in the worktree is "one `git add .` from being
committed beside the comment it drifts from".

## Trade-offs

- A spec folder lives in a checkout. A spec can no longer be written from anywhere with only `gh`, which is
  the reason `alq-shape` gave for the comment.
- A shaped issue now needs a branch that holds its spec folder before anyone else can pick it up.
- Existing spec folders point at a comment that will no longer be the spec.

## Consequences

- Easier: one place to read and to change the spec, and the change shows in a diff.
- Harder: three skills, the gate's spec reader and their tests change together.
- **How we would know this was wrong:** a shaped issue that nobody can pick up because its spec is on a
  branch that was never pushed; or a spec comment and a spec folder that disagree after this lands.
- Revisit if: specs have to be written for repos where no checkout exists at shaping time.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [ ] Settle the open points of issue #25 in its spec.
3. [ ] Change the three skills, the gate's spec reader and the tests in one change.
