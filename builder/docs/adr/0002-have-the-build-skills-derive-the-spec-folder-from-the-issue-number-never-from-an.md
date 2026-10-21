---
schemaVersion: 0.2.0
id: "0002"
title: "Have the build skills derive the spec folder from the issue number, never from an issue comment"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, spec-folder, skills, issue-tackle, root-cause-check, story, lanes, launch-lock]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0004"]
affects:
  - type: path
    pattern: "builder/plugin/skills/issue-tackle/**"
  - type: path
    pattern: "builder/plugin/skills/root-cause-check/**"
  - type: path
    pattern: "builder/plugin/.claude-plugin/plugin.json"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
review:
  tier: async
externalRefs:
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one issue, one branch and one PR per user story"
---

# ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment

## Context

The spec of a change lives in its spec folder (planner ADR-0001). The caller is a deterministic
orchestrator (orchestrator ADR-0001), which computes no story order. Each story has its own issue, branch and PR; a spec with several stories sits on
a parent issue with one sub-issue per story (org ADR-0003, planner ADR-0010).

## Decision

1. We will have `issue-tackle <s>` take the story issue number only, and
   derive the spec folder, the requirement, the branch and the PR from it through `core/` (root ADR-0005),
   never from an issue comment. `builder` declares no plugin dependency.
2. We will cut the story's branch from the default branch at its first launch, and build every later
   launch of the story on it.
3. We will stop, never plan or repair, on no `specs/`, no `specs/<p>-*` or an inconsistent folder, naming
   the state and any open PR.
4. We will enforce root ADR-0006 at launch: `issue-tackle` stops on an issue in Backlog or Blocked,
   building nothing.
5. We will have `issue-tackle` take the story's launch lock (orchestrator ADR-0003) before any work, and
   stop, naming the holder, when another launch holds it or this host cannot take it.
6. We will retire the `root-cause-check` skill: the round's root-cause reviewer verifies the cause
   (reviewer ADR-0017).

## Options considered

### Option A: Everything from `<s>` (chosen)

The orchestrator and a human launch the same way, with one number.

### Option B: `spec` and `branch` from the caller

Rejected: both follow from the story issue, and the orchestrator would compute what builder derives.

### Option C: The story read from `tasks.md`, the lowest with an unticked task

Rejected: the story is its issue, and order is the issues' `blockedBy` chain (planner ADR-0010).

### Option D: A planning command on a missing folder

Rejected: the skill stops with a message naming the state, never a planning command.

### Option E: Keep `root-cause-check` as a skill or a build step

Rejected: it reads nothing from the round; the round's root-cause reviewer does its job.

### Option F: An interactive `issue-tackle` without the launch lock

Rejected: it and an orchestrator launch would build one story at once.

## Trade-offs

- The skill repairs nothing; a missing or inconsistent folder costs a Blocked card and a human.
- Without `reviewer` installed, the turn has no round to run and stops there.
- `issue-tackle` runs only where the launch lock lives.

## Consequences

- Easier: the orchestrator launches with the issue number alone.
- Harder: a story out of order needs a human to change its `blockedBy`.
- **How we would know this was wrong:** a caller that must pass more than `<s>`, or repeated Blocked
  moves for a missing or inconsistent folder.
- Revisit if: a spec needs two spec folders.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
