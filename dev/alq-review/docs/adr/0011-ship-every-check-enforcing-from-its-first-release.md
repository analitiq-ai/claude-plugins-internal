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

Draft for the ratifier. Paths are relative to the repo root.

## Context

A new check can refuse from its first release. Or it can first only record what it would have refused, and be
switched to refusing later. The documents give both answers:

- Spec 005: "From the first release. There is no record-only phase and no accuracy bar to pass first"
  (`dev/alq-review/specs/005-claim-check-gate/spec.md:17`).
- Spec 006: "`enforce` from the first release; no record-only phase"
  (`dev/alq-review/specs/006-shim-check-gate/spec.md:20`).
- Spec 004 FR-023: "The checks MUST be switched to `enforce` only after every existing spec folder passes
  them" (`dev/alq-review/specs/004-spec-folder-checks/spec.md:223`).
- The Mode section of `plugins/alq-review/README.md` gave `log` mode a trial purpose. PR #28 removes that
  sentence.

What ships today: `plugins/alq-review/config.json` sets `mode`, `spec_checks`, `claim_checks` and
`shim_checks` to `enforce`.

## Decision

The user decided on 2026-10-06: a check enforces from its first release.

1. A new check ships refusing. It has no record-only phase and no accuracy bar to pass first.
2. No threshold and no review date is built in. The user reads the log and decides: "No threshold is built
   in" (`dev/alq-review/specs/005-claim-check-gate/spec.md:49`).
3. This replaces spec 004 FR-023.

Not in this record: how a check is switched off. Today the spec-folder, claim and shim checks each have a setting
(`plugins/alq-review/scripts/hookio.py:26`, `:31`, `:36`). Issue #26 proposes a per-repo on/off switch typed
by the user, which would replace those settings. That is proposed, not decided.

## Options considered

### Option A: Enforce from the first release (chosen)

It matches specs 005 and 006 and the shipped `config.json`. Verdicts are not measured before they refuse. The
brake is the user, who reads `gate.log` and switches the check off.

### Other options, rejected

| Option | Why rejected |
|---|---|
| B. A record-only phase first (spec 004 FR-023) | The user rejected it for the claim check and the shim check in the lines quoted in Context. The one reason recorded is that the risk is accepted: "The user accepts that the verdicts are unmeasured and blocks from the first release" (`dev/alq-review/specs/005-claim-check-gate/spec.md:262`). |
| C. Enforce, with a built-in threshold or trial review | Critiques proposed it three times (`dev/alq-review/specs/005-claim-check-gate/critiques/critique-20261001-154410.md:25`, `dev/alq-review/specs/005-claim-check-gate/critiques/critique-20261002-060138.md:45`, `dev/alq-review/specs/006-shim-check-gate/critiques/critique-20261002-shim.md:34`). The answers are point 2 and "there is no review trigger" (`dev/alq-review/specs/006-shim-check-gate/spec.md:38`). |
| D. Do nothing | The specs keep two answers. |

## Trade-offs

- A check can refuse correct work on its first day. Spec 005 says of its labels that neither "has been checked
  against hand-labelled truth" (`dev/alq-review/specs/005-claim-check-gate/spec.md:261`).
- Nothing reminds anyone to look. The brake is the user reading the log.

## Consequences

- Easier: one answer for every new check, and no date to track for switching one on.
- Harder: a check needs its exits, such as a release by the user, on the day it ships.
- **How we would know this was wrong:** the user switches a new check off soon after its release because it
  refuses correct work, more than once.
- Revisit if: a check is proposed that the user has no way to release.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Merge PR #28, which corrects the README's Mode section.
3. [ ] Mark spec 004 FR-023 as replaced by this record, in its own PR. That spec also plans a clean-up "while
       the checks are in `log` mode" (`dev/alq-review/specs/004-spec-folder-checks/spec.md:271`).
4. [ ] Settle issue #26.
