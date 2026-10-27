---
schemaVersion: 0.2.0
id: "0010"
title: "Create one issue per story, chain them by blockedBy, and open the spec PR as a draft"
status: draft
date: 2026-10-20
deciders: []
tags: [sub-issue, story, blocked-by, spec-pr, draft-pr, rescope, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0008", "0009"]
affects:
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/scripts/*.py"
  - type: path
    pattern: "specs/**/tasks.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: doc
    id: "org ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
  - type: doc
    id: "org ADR-0003"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one issue, one branch and one PR per user story"
---

# ADR-0010: Create one issue per story, chain them by blockedBy, and open the spec PR as a draft

## Context

Each story has its own issue, branch and PR (org ADR-0003). The spec and its records land first, by a spec
PR on `<p>-spec`, `<p>` the spec's issue (org ADR-0002), which gates every story's start (orchestrator
ADR-0006).

## Decision

1. We will make each story a sub-issue of the spec's issue, `blockedBy` the one before, or, for a one-story
   spec, the spec's issue itself; a rescope adds stories alike. A story issue's number never changes and
   labels its task block (ADR-0008).
2. We will, when a rescope gives a one-story issue `#n` a second story, after the admin approves: create
   parent `#p` with `#n`'s title and body, add under it `#n` and the new story blocked by `#n`, carry on
   the run with `#p` as its `<p>` (ADR-0005), and rename `specs/<n>-*` to `specs/<p>-*`. `#n` keeps its branch and PR.
3. We will push the spec folder and its records (ADR-0009), and no code, to `<p>-spec`: to its open PR if
   there is one, else to a branch cut from the default branch and opened as a draft PR, the spec PR. A
   `<p>-spec` whose PR closed unmerged stops the run, naming the branch for an admin to delete.
4. We will write no state: reviewer's hook on the agent machine, on seeing a rescope's spec PR open,
   places the rescope hold on the story issues root ADR-0006 names (reviewer ADR-0013).
5. We will name, in a rescope's spec PR description, each story issue whose task block it drops, for an
   admin to close. A rescope that edits or drops a merged story's task block stops before it pushes.
6. We will write into the description of decision 2's spec PR the steps that undo its issue writes if an
   admin closes it unmerged; the skill holds the steps.

## Options considered

### Option A: A sub-issue per story, a blockedBy chain, a draft spec PR (chosen)

### Option B: One issue for all stories, ordered by `tasks.md`

Rejected: a script computes order from ticks.

### Option C: planner opens the spec PR ready for review

Rejected: the admin marks it ready once they have reviewed the spec.

### Option D: planner closes dropped stories and undoes a rejected rescope

Rejected: the admin decides what a rejected rescope undoes, from the steps decision 6 writes, and a hold
releases only on a Ready move and an admin's comment (reviewer ADR-0013).

## Trade-offs

- planner writes issues, links and a draft PR as the planner App (root ADR-0007 d4); a rescope's holds wait
  until the agent machine sees its PR.
- Renaming `specs/<n>-*` breaks path links; a rejected spec PR leaves cleanup to an admin.

## Consequences

- Easier: done (root ADR-0005) and order are GitHub fields, never read from `tasks.md`.
- Harder: reordering stories is an admin edit of `blockedBy`.
- **How we would know this was wrong:** stories built out of order, or story issues out of step with
  spec.md after a rescope.
- Revisit if: GitHub drops sub-issues or issue dependencies.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
