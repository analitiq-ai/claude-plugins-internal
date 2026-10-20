---
schemaVersion: 0.2.0
id: "0005"
title: "Have the skill that shapes an issue read and write the spec in its spec folder"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, spec-folder, skills, rescope, lanes, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0002", "0007", "0008", "0009", "0010"]
affects:
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/scripts/spec_folder.py"
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
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    id: "org ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
  - type: doc
    id: "orchestrator ADR-0006"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0006-launch-no-story-while-its-spec-s-issue-has-an-open-spec-pr-or-before-one-merged.md"
    label: "orchestrator ADR-0006: Launch no story while its spec's issue has an open spec PR, or before one merged"
  - type: doc
    id: "orchestrator ADR-0002"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md"
    label: "orchestrator ADR-0002: The orchestrator alone writes the working lanes, derived from the PR"
---

# ADR-0005: Have the skill that shapes an issue read and write the spec in its spec folder

## Context

An issue's spec lands by a spec PR on `<p>-spec`, `<p>` the spec's issue: the parent when the story issue has
one, else the story issue itself (org ADR-0002). While a spec's issue has an open spec PR, no story under it
launches (orchestrator ADR-0006).

## Decision

1. We will have `/planner:issue-spec` write the spec into its spec folder and read no issue comment for it
   (ADR-0001).
2. We will take an issue number (or `untracked "<what>"`) as the only entry and resolve it to its spec's
   issue `<p>`: a `specs/<p>-*/spec.md` on the default branch means a rescope, from grill; otherwise a new spec,
   from premise.
3. We will work on an issue only while its card is in Backlog or Blocked. A rescope also needs every story
   issue under the spec that has a branch in Backlog or Blocked; otherwise the run stops naming the cards to
   move to Blocked. A closed spec's issue is refused: "open a new issue for the new work".
4. We will commit the spec, or its rescope, on `<p>-spec` cut from the default branch, and open it as a draft
   spec PR (ADR-0010), placing the rescope hold on each story issue under the spec that has a branch. The run
   writes no lane, posts nothing on the issue, and ends naming the spec folder and the spec PR, and no
   command of another plugin.
5. We will have the human drive every approval at grill and at critique; the critique's verdict is advisory
   and no script reads it.

## Options considered

### Option A: Refuse a rescope only on a closed issue, in any lane

Rejected: a story in progress builds under the spec being changed, and two writers share its state comment.

### Option B: `rescope <spec folder> #<issue>`

Rejected: the default branch already says whether the folder exists.

### Option C: Work only on cards in Backlog or Blocked (chosen)

No session works on the issue meanwhile (builder ADR-0002), so its state comment has one writer at a time.

### Option D: Refuse approval on RETHINK unless `override`

Rejected: no script reads the verdict.

### Option E: planner writes Blocked when it needs the user

Rejected: no plugin writes a lane (orchestrator ADR-0002).

## Trade-offs

- A rescope stops every launched story under the spec until it merges the new spec.
- A rescope that leaves spec.md unchanged needs a human unlock of each hold.
- A RETHINK the human goes past leaves no recorded reason.

## Consequences

- Easier: one entry for a new spec and a rescope; no story builds while its spec changes.
- Harder: the skill reads the board; a human moves running stories to Blocked first.
- **How we would know this was wrong:** a story merged under a spec an open rescope changes, or a rescope
  of the wrong folder.
- Revisit if: planning runs without a human.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
