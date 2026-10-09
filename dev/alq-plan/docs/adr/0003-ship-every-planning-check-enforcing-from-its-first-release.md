---
schemaVersion: 0.1.0
id: "0003"
title: "Ship every planning check enforcing from its first release"
status: draft
date: 2026-10-09
deciders: []
tags: [rollout, workflow, settled-design]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002"]
affects:
  - type: path
    pattern: "plugins/alq-plan/scripts/*.py"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
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
  - type: doc
    id: "alq-review ADR-0011"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0011-ship-every-check-enforcing-from-its-first-release.md"
    label: "Decided here again for alq-plan"
  - type: doc
    id: "alq-review ADR-0017"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0017-leave-the-spec-folder-s-contents-to-planning-review-reads-only-spec-md.md"
    label: "Planning checks its own output; review does not"
---

# ADR-0003: Ship every planning check enforcing from its first release

## Context

alq-review's ADR-0011 ships every new review check refusing from its first release: no record-only phase, no
accuracy bar to pass first, no built-in threshold that turns it off. Spec 019 FR-023 has an existing record that
binds a new plugin decided again in that plugin's log, not copied, and research R16 names ADR-0011 as one alq-plan
decides again. This is that record.

A check in alq-plan is a workflow step that runs a script (R16). A new one can stop the run from its first release,
or first only record what it would have stopped and be switched to stopping later. alq-plan owns the settled-design
check and runs it on its own output before a run completes (FR-020).

The brake alq-review's ADR-0011 names, the user setting a check to `log`, is a setting in review's `config.json`.
alq-plan ships no such file and no mode: it ships its skill, its scripts and its Spec Kit files (spec 019,
data-model.md, Plugins).

Review no longer checks the spec folder's contents. A spec folder that is not settled is caught only if planning
ran (alq-review's ADR-0017).

Why now: alq-plan gets its own decision log before the code moves into it (R16).

## Decision

We will ship every new alq-plan check stopping the run from its first release, with no record-only phase, no
accuracy bar to pass first, and no built-in threshold that turns it off later.

## Options considered

### Option A: Enforce from the first release (chosen)

| Dimension | Assessment |
|---|---|
| Matches | alq-review's ADR-0011, and FR-020's check run before a run completes |
| Accuracy bar to pass before stopping a run | None |
| The brake | A release of alq-plan that changes the check |

### Option B: Do nothing

alq-plan's log holds no answer, and each new check picks one.

### Option C: A record-only phase first

Rejected: while a check only records, a spec folder that fails it completes the run, and nothing after planning
checks the folder's contents (alq-review's ADR-0017).

### Option D: Enforce, with a built-in threshold

Rejected in alq-review's ADR-0011: a check that turns itself off stops guarding without anyone deciding that.

## Trade-offs

- A check can stop a correct run on its first day. No accuracy bar comes first.
- alq-plan has no setting that switches a check to recording only. A check that stops correct runs is changed only
  by a release.

## Consequences

- Easier: one answer for every new check, and no date to track for switching one on.
- Harder: a check needs a next step that can succeed (ADR-0002) on the day it ships.
- **How we would know this was wrong:** a new check is loosened or removed soon after its release because it stops
  correct runs, and this happens more than once.
- Revisit if: a check is proposed whose stop no next step can get past.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
