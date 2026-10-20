---
schemaVersion: 0.1.0
id: "0018"
title: "Release a RESHAPE_SPEC lock only by unlock"
status: superseded
supersededBy: "0023"
date: 2026-10-09
deciders: ["@Analitiq-Bot-Wonka"]
tags: [release, holds, user-authority, spec]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0004", "0016", "0020"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,specbinding}.py"
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "reviewer/tests/{test_gate,test_policy,test_specbinding}.py"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
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
---

# ADR-0018: Release a RESHAPE_SPEC lock only by unlock

## Context

The decision in this record is the user's, recorded on 2026-10-09 for issue #63. No plan exists yet.

When a round is ruled `RESHAPE_SPEC`, the gate locks the branch. Two prompts release that lock today:
`unlock <ref>`, and the planning skill's rescope prompt for the same ref. ADR-0004's Context lists the
rescope prompt among the release keywords. No record decides the rescope route.

Constitution P2, as ADR-0004 quotes it, asks every hold to name the one entity approved to release it and
the one action by which it does, and fails a hold "with any second way out".

Issue #63 moves planning, and with it the rescope command, out of alq-review.
ADR-0016 binds each PR to its spec, or to no spec, and to the content of its `spec.md`. Only the user's
`unlock` re-takes that content.

## Decision

We will release a `RESHAPE_SPEC` lock only by the user's `unlock <ref>`. Planning's rescope command no
longer releases it.

## Options considered

### Option A: `unlock <ref>` is the one release (chosen)

| Dimension | Assessment |
|---|---|
| Who releases | The user |
| By what | One action, `unlock <ref>` |
| Ways out of the lock | One |
| A PR bound to no spec | Not rescoped: it is closed, and the work restarts on a new PR bound to a new spec |

### Option B: Do nothing

Both `unlock <ref>` and the rescope prompt release the lock. The lock keeps a second way out, against
constitution P2.

## Trade-offs

- The user takes two steps, the unlock and then the rescope, where one prompt did both.
- Nothing makes the user rescope after the unlock. The unlock reply only names what to do.
- A PR bound to no spec cannot be rescoped in place. Its work moves to a new PR.

## Consequences

- Easier: one entity releases the lock by one action.
- Harder: the unlock reply has to carry the open decision, its rationale, the spec gaps and the bound spec
  folder.
- **How we would know this was wrong:** branches unlocked after `RESHAPE_SPEC` whose next round runs on a
  spec that was never rescoped, and is ruled `RESHAPE_SPEC` again.
- Revisit if: such re-rulings occur.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [x] Plan issue #63 against this ADR. Done in spec 019, built in #75 and #72.
