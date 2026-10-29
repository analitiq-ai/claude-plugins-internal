---
schemaVersion: 0.2.0
id: "0005"
title: "Have the skill that shapes an issue read and write the spec in its spec folder"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec, spec-folder, skills, rescope, lanes]
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
  - type: path
    pattern: "planner/plugin/scripts/premise_report.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:55Z
externalRefs:
  - type: doc
    id: "org ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
---

# ADR-0005: Have the skill that shapes an issue read and write the spec in its spec folder

## Context

An issue's spec lives in its spec folder (ADR-0001) and lands by a spec PR on `<p>-spec`, `<p>` the spec's
issue (org ADR-0002, root ADR-0005). A rescope changes a spec that stories may be building against. Planning
is run by an admin where they work, outside the agent machine, so the managed settings (root
ADR-0008) do not apply to it. Its grill and critique steps ask that admin for verdicts. Its premise step
answers whether the issue is worth a spec, from the issue and the code.

## Decision

1. We will take an issue number as the only entry, resolved to its spec's issue `<p>` (root ADR-0005);
   `untracked "<what>"` first creates the issue, which becomes `<p>`. A `specs/<p>-*/spec.md` on the
   default branch makes the run a rescope; otherwise the run writes a new spec.
2. We will commit only on `<p>-spec`, inside `specs/<p>-*/` and the decision-record folders, under the
   admin's oversight.
3. We will enforce root ADR-0006 at the start of a run: a card outside Backlog or Blocked, or a closed
   spec's issue, stops the run before it writes anything, naming the cards to move.
4. We will land a new spec and a rescope alike only through the spec PR (ADR-0010), a rescope with its
   rescope hold (reviewer ADR-0013). The run writes no lane and posts nothing on the issue.
5. We will have the admin drive every approval at grill and at critique; the critique's verdict is
   advisory and no script reads it. The agent makes the premise pick itself, from its own answers, and
   asks the admin only what the issue and the code cannot answer. Its pick goes through the premise gate's
   one input and equals its recommendation, and a reported defect is never `no spec needed`: a defect's fix
   is sized only once it is traced.

## Options considered

### Option A: The issue number as the only entry, the default branch deciding a rescope (chosen)

One entry for a new spec and a rescope; nothing the caller names can disagree with the repo.

### Option B: `rescope <spec folder> #<issue>`

Rejected: the default branch already says whether the folder exists, and a caller could name the wrong one.

### Option C: Refuse approval on RETHINK unless `override`

Rejected: no script reads the verdict.

### Option D: planner writes Blocked when it needs the user

Rejected: only the orchestrator's hooks write a lane (orchestrator ADR-0002).

### Option E: Fence planning's commits with reviewer's hook

Rejected: reviewer runs only on the agent machine (root ADR-0008); the admin oversees planning's commits.

### Option F: The admin makes the premise pick

Rejected by the admin on 2026-10-29 (#112): the agent's answers already settle the pick, and the admin
still sees every outcome at the spec PR or the issue close.

### Option G: A minor mechanical defect may be `no spec needed`

Rejected by the admin on 2026-10-29: whether a defect is minor is known only once it is traced.

## Trade-offs

- A RETHINK the admin goes past leaves no recorded reason.
- A rescope cannot start until an admin has moved the spec's running stories.
- A wrong premise pick is caught only at the spec PR, for `no spec needed`, or at the issue close, for
  `not worth doing`.

## Consequences

- Easier: one entry for a new spec and a rescope.
- Harder: the skill reads the board and the default branch before it runs.
- **How we would know this was wrong:** a rescope of the wrong folder, a new spec written for an issue
  that already had one, or a planning commit outside `<p>-spec` and its folders.
- Revisit if: planning runs without an admin.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
