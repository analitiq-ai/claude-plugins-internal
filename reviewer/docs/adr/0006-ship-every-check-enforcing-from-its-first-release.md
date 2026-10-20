---
schemaVersion: 0.1.0
id: "0006"
title: "Ship every check enforcing from its first release"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [rollout, mode, claim-check, shim-check, spec-checks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "reviewer/plugin/scripts/{hookio,gate}.py"
  - type: path
    pattern: "specs/004-spec-folder-checks/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of ADRs this one belongs to"
---

# ADR-0006: Ship every check enforcing from its first release

## Context

A new check can refuse from its first release, or first only record what it would have refused. Specs 005
and 006 chose `enforce` from the first release, with no record-only phase; spec 004 FR-023 switches to
`enforce` only after every existing spec folder passes.

The plugin ships with its mode and every check's own setting on `enforce`.

Why now: the next check has two specs to follow and they disagree.

## Decision

1. We will ship every new check refusing from its first release, with no record-only phase, no accuracy bar
   to pass first, and no built-in threshold that turns it off later.
2. We will read the mode and every check's setting only from the `[reviewer]` section of `codeworks.toml`
   (root ADR-0002). No environment variable sets or overrides them.
3. We will name, in the refusal of a call the gate crashed deciding, the user-only `reviewer off` switch as
   the way to work while the gate is broken.

## Options considered

### Option A: Enforce from the first release (chosen)

| Dimension | Assessment |
|---|---|
| Matches | Specs 005 and 006, and the shipped settings |
| Accuracy bar to pass before refusing | None |
| The brake | The user, who reads the log and sets a check to `log` in the config file, or types `reviewer off` |

### Option B: Do nothing

The specs keep two answers, and each new check picks one.

### Option C: A record-only phase first (spec 004 FR-023)

Rejected for the claim check and the shim check in specs 005 and 006. The cost: a check refuses before its
verdicts are measured.

### Option D: Enforce, with a built-in threshold

Proposed in critique. Rejected: a check that turns itself off stops guarding without anyone deciding that.

### Option E: Environment variables that override the config

Rejected: whoever launches a session, an agent included, could switch a check to `log` with no edit the
hook can refuse.

## Trade-offs

- A check can refuse correct work on its first day. No accuracy bar comes first.
- Nothing reminds anyone to look at the log.
- Only the user can switch a check off for one session, with `reviewer off`.

## Consequences

- Easier: one answer for every new check, and no date to track for switching one on.
- Harder: a check needs its exits, such as a release by the user, on the day it ships.
- **How we would know this was wrong:** the user switches a new check off soon after its release because it
  refuses correct work, and this happens more than once.
- Revisit if: a check is proposed that the user has no way to release.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Settle how a check is switched off (issue #26).
