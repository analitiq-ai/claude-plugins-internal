---
schemaVersion: 0.2.0
id: "0005"
title: "Have the skill that shapes an issue read and write the spec in its spec folder"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, spec-folder, skills, rescope, lanes, fence]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0007", "0010"]
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
    id: "orchestrator ADR-0002"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md"
    label: "orchestrator ADR-0002: The orchestrator alone writes the working lanes, derived from the PR"
  - type: doc
    id: "root ADR-0005"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/docs/adr/0005-parse-a-story-s-identity-from-its-branch-in-core-alone.md"
    label: "root ADR-0005: Parse a story's identity from its branch in core/ alone"
  - type: doc
    id: "root ADR-0006"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/docs/adr/0006-keep-planning-and-building-in-disjoint-lanes-of-an-issue.md"
    label: "root ADR-0006: Keep planning and building in disjoint lanes of an issue"
  - type: doc
    id: "reviewer ADR-0015"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0015-fence-a-session-on-its-issue-s-branch-prefix-and-lane-a-session-needs-an-issue.md"
    label: "reviewer ADR-0015: Fence a session on its issue's branch prefix and lane; a session needs an issue"
  - type: doc
    id: "reviewer ADR-0013"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0013-give-every-hold-one-id-and-a-human-release-a-changed-spec-releases-a-rescope-hol.md"
    label: "reviewer ADR-0013: Give every hold one id and a human release; a changed spec releases a rescope hold"
---

# ADR-0005: Have the skill that shapes an issue read and write the spec in its spec folder

## Context

An issue's spec lives in its spec folder (ADR-0001) and lands by a spec PR on `<p>-spec`, `<p>` the spec's
issue (org ADR-0002, root ADR-0005). A rescope changes a spec that stories may be building against. Planning
is run by a human in a session, and its grill and critique steps ask that human for verdicts.

## Decision

1. We will take an issue number as the only entry, resolved to its spec's issue `<p>` (root ADR-0005);
   `untracked "<what>"` first creates the issue, which becomes `<p>`. A `specs/<p>-*/spec.md` on the
   default branch makes the run a rescope; otherwise the run writes a new spec.
2. We will make `<p>` the session's issue when the run starts, and commit only on `<p>-spec`, inside
   `specs/<p>-*/` and the decision-record folders; reviewer's fence admits exactly these commits while
   `<p>` is in Backlog or Blocked (reviewer ADR-0015).
3. We will enforce root ADR-0006 at the start of a run: a card outside Backlog or Blocked, or a closed
   spec's issue, stops the run before it writes anything, naming the cards to move.
4. We will land a new spec and a rescope alike only through the spec PR (ADR-0010), a rescope with its
   rescope hold (reviewer ADR-0013). The run writes no lane and posts nothing on the issue.
5. We will have the human drive every approval at grill and at critique; the critique's verdict is
   advisory and no script reads it.

## Options considered

### Option A: The issue number as the only entry, the default branch deciding a rescope (chosen)

One entry for a new spec and a rescope; nothing the caller names can disagree with the repo.

### Option B: `rescope <spec folder> #<issue>`

Rejected: the default branch already says whether the folder exists, and a caller could name the wrong one.

### Option C: Refuse approval on RETHINK unless `override`

Rejected: no script reads the verdict.

### Option D: planner writes Blocked when it needs the user

Rejected: no plugin writes a lane (orchestrator ADR-0002).

### Option E: Run planning with reviewer off

Rejected: nothing would then keep a planning session's commits off code and other branches.

## Trade-offs

- A RETHINK the human goes past leaves no recorded reason.
- A rescope cannot start until a human has moved the spec's running stories.

## Consequences

- Easier: one entry for a new spec and a rescope.
- Harder: the skill reads the board and the default branch before it runs.
- **How we would know this was wrong:** a rescope of the wrong folder, a new spec written for an issue
  that already had one, or a planning commit refused on `<p>-spec`.
- Revisit if: planning runs without a human.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
