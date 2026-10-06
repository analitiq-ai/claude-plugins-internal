---
schemaVersion: 0.1.0
id: "0011"
title: "Ship every check enforcing from its first release"
status: draft
date: 2026-10-06
deciders: []
tags: [rollout, mode, claim-check, shim-check, spec-checks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/{config.json,README.md}"
  - type: path
    pattern: "dev/alq-review/specs/004-spec-folder-checks/**"
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
    label: "The batch of decision records this one belongs to"
---

# ADR-0011: Ship every check enforcing from its first release

## Context

A new check can refuse from its first release. Or it can first only record what it would have refused, and
be switched to refusing later. The specs give both answers:

- Spec 005, Clarifications: blocking is on "From the first release. There is no record-only phase and no
  accuracy bar to pass first".
- Spec 006, Clarifications: the check's setting ships "`enforce` from the first release; no record-only
  phase".
- Spec 004 FR-023: "The checks MUST be switched to `enforce` only after every existing spec folder passes
  them."

The plugin ships with its mode and every check's own setting on `enforce`
(`plugins/alq-review/config.json`).

Why now: the next check has two specs to follow and they disagree. No plan decided the general rule. The
user decided it on 2026-10-06: "Enforce them on first release".

## Decision

1. We will ship every new check refusing from its first release.
2. We will give a new check no record-only phase and no accuracy bar to pass first.
3. We will build in no threshold and no review date. The user reads the log and decides, as spec 005 says:
   "No threshold is built in."
4. We will treat spec 004 FR-023 as replaced by this record.

## Options considered

### Option A: Enforce from the first release (chosen)

| Dimension | Assessment |
|---|---|
| Matches | Specs 005 and 006, and the shipped settings |
| Accuracy bar to pass before refusing | None |
| The brake | The user, who reads the log and sets a check to `log` |

### Option B: Do nothing

The specs keep two answers, and each new check picks one.

### Option C: A record-only phase first (spec 004 FR-023)

The user rejected it for the claim check and the shim check, in the clarifications quoted above. Spec 005
records the reason: "The user accepts that the verdicts are unmeasured and blocks from the first release."

### Option D: Enforce, with a built-in threshold or a trial review

The critiques of specs 005 and 006 proposed it. The user's answer is point 3.

## Trade-offs

- A check can refuse correct work on its first day. No accuracy bar comes first.
- Nothing reminds anyone to look at the log.

## Consequences

- Easier: one answer for every new check, and no date to track for switching one on.
- Harder: a check needs its exits, such as a release by the user, on the day it ships.
- **How we would know this was wrong:** the user switches a new check off soon after its release because it
  refuses correct work, and this happens more than once.
- Revisit if: a check is proposed that the user has no way to release.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Mark spec 004 FR-023 as replaced by this record, in its own PR.
3. [ ] Settle how a check is switched off (issue #26).
