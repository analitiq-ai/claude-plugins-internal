---
schemaVersion: 0.1.0
id: "0003"
title: "Ship every planning check enforcing from its first release"
status: draft
date: 2026-10-20
deciders: []
tags: [rollout, workflow, settled-design]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002"]
affects:
  - type: path
    pattern: "planner/plugin/scripts/*.py"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
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
  - type: doc
    id: "reviewer ADR-0006"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0006-ship-every-check-enforcing-from-its-first-release.md"
    label: "reviewer ADR-0006: Ship every check enforcing from its first release"
  - type: doc
    id: "reviewer ADR-0014"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0014-derive-the-spec-from-the-branch-at-each-round-s-launch-and-read-the-folder-as-da.md"
    label: "reviewer ADR-0014: Derive the spec from the branch at launch and read the folder as data"
---

# ADR-0003: Ship every planning check enforcing from its first release

## Context

reviewer's ADR-0006 ships every new review check refusing from its first release: no record-only phase, no
accuracy bar to pass first, no built-in threshold that turns it off. This record decides the same question for
planning.

A check in planner is a workflow step that runs a script (R16). A new one can stop the run from its first release,
or first only record what it would have stopped and be switched to stopping later. planner owns the settled-design
check and runs it on its own output before a run completes (FR-020).

The brake reviewer's ADR-0006 names, the user setting a check to `log`, is a setting in review's `config.json`.
planner ships no such file and no mode: it ships its skill, its scripts and its Spec Kit files (spec 019,
data-model.md, Plugins).

Review validates none of the spec folder. A spec folder that is not settled is caught only if planning ran
(reviewer ADR-0014).

## Decision

We will ship every new planner check stopping the run from its first release, with no record-only phase, no
accuracy bar to pass first, and no built-in threshold that turns it off later.

## Options considered

### Option A: Enforce from the first release (chosen)

| Dimension | Assessment |
|---|---|
| Matches | reviewer's ADR-0006, and FR-020's check run before a run completes |
| Accuracy bar to pass before stopping a run | None |
| The brake | A release of planner that changes the check |

### Option B: Do nothing

planner's log holds no answer, and each new check picks one.

### Option C: A record-only phase first

Rejected: while a check only records, a spec folder that fails it completes the run, and nothing after planning
checks the folder's contents (reviewer ADR-0014).

### Option D: Enforce, with a built-in threshold

Rejected in reviewer's ADR-0006: a check that turns itself off stops guarding without anyone deciding that.

## Trade-offs

- A check can stop a correct run on its first day. No accuracy bar comes first.
- planner has no setting that switches a check to recording only. A check that stops correct runs is changed only
  by a release.

## Consequences

- Easier: one answer for every new check, and no date to track for switching one on.
- Harder: a check needs a next step that can succeed (ADR-0002) on the day it ships.
- **How we would know this was wrong:** a new check is loosened or removed soon after its release because it stops
  correct runs, and this happens more than once.
- Revisit if: a check is proposed whose stop no next step can get past.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
