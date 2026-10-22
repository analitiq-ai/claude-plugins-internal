---
schemaVersion: 0.2.0
id: "0005"
title: "Parse a story's identity from its branch in core/ alone"
status: draft
date: 2026-10-20
deciders: []
tags: [story, branch, spec-folder, pull-request, core]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0006"]
affects:
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/**"
  - type: path
    pattern: "builder/plugin/skills/issue-tackle/**"
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0005: Parse a story's identity from its branch in core/ alone

## Context

Each user story has its own issue, branch and PR, under a parent issue when a spec has several (org
ADR-0003). builder, reviewer and the orchestrator each need a story's spec, branch or PR, starting from a
branch name or an issue number; three parsers of one grammar give three answers at its edges. A session writes the PR body, where `Closes #s` sits. Whether a story is done gates
the stories `blockedBy` it and its parent's close, and a merged story's issue can be reopened.

## Decision

1. We will name a story's branch `<s>-us<k>-<slug>`, `<s>` its story issue, and a spec PR's branch
   `<p>-spec`, and parse both only in `core/` (ADR-0001); reviewer, builder and the orchestrator call it.
   `<k>` is a label for humans, never checked.
2. We will take the spec's issue `<p>` as `<s>`'s parent when it has one, else `<s>`, and the spec folder as
   the one `specs/<p>-*/`.
3. We will take a story's PR as the newest PR whose head is its branch in the same repo, never by its
   body; fork PRs are orchestrator ADR-0004's.
4. We will build and grade a story against one requirement: its spec folder's `spec.md`, or the story
   issue's body when that `spec.md` has `codeworks.kind: no_spec` (planner ADR-0008).
5. We will decide in `core/` alone when a story is done: its PR merged, or a human closed its issue.
   Reopening a done story's issue starts nothing; new work goes in a new issue.

## Options considered

### Option A: One parser in `core/`, the branch as the link (chosen)

Every component reads the same story, spec and PR from the same name.

### Option B: Each component parses the branch itself, or asks reviewer

Rejected: three parsers drift at the edges, and no plugin imports another's code (ADR-0001).

### Option C: Link a PR by `Closes #s` or `closingIssuesReferences`

Rejected: a session writes the PR body.

### Option D: Check `<k>` against the story's position in `tasks.md`

Rejected: a renumbered or reordered story would break a branch that is still correct.

### Option E: Grade a no-spec story against its premise-only `spec.md`

Rejected: that file states no requirement.

## Trade-offs

- Finding the spec costs one more API read, the issue's parent.
- A branch named outside the grammar has no story, spec or round.

## Consequences

- Easier: a claim needs only the issue number; a renumbered story or a reopened done issue changes
  nothing.
- Harder: a grammar change is a `core/` release every component must install.
- **How we would know this was wrong:** two components name a different story, spec or PR for one
  branch, or disagree on whether a story is done.
- Revisit if: a story needs more than one branch, or a spec more than one folder.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
