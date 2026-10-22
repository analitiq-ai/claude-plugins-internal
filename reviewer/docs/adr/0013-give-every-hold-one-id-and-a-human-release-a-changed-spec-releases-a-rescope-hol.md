---
schemaVersion: 0.2.0
id: "0013"
title: "Give every hold one id and a human release; a changed spec releases a rescope hold"
status: draft
date: 2026-10-20
deciders: []
tags: [holds, release, user-authority, unlock, rescope, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0008", "0010", "0011", "0012", "0015", "0016", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,ledger,claimgate,shimgate,hookio}.py"
  - type: path
    pattern: "reviewer/plugin/hooks/hooks.json"
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "core/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0013: Give every hold one id and a human release; a changed spec releases a rescope hold

## Context

A story claimed from Ready types no prompt. Its PR can be closed and reopened. A rescope changes the spec
a story in flight is graded against.

## Decision

1. We will give every hold an id and a row in the state snapshot (ADR-0011), keyed by the story issue's
   number but `claim-<id>` (its lineage) and `shim-<id>` (its bug). While one is open the story merges
   nothing: `internal-review` stays pending (orchestrator ADR-0004). A refusal names the id.
2. We will release holds by one function. Only on the orchestrator's claim from Ready,
   reviewer releases each open hold of the story issue that has a Blocked-reason comment by the
   orchestrator's App (orchestrator ADR-0002), but `rescope-<issue>`, and `escalation-<issue>` only once
   ANSWERED (orchestrator ADR-0010), carrying the answer into the next round's briefs. A user prompt
   starting `unlock <id>` releases that one.
3. We will place each hold, and grant on its release, as follows; each count is a `[reviewer]` key.
   A merge blocker is a validator module's failure through `core/` (ADR-0016) or a failing required check;
   pushed-back threads alone are resolved by the replies.

   | Hold | Placed when | Refuses | A release grants |
   |---|---|---|---|
   | `escalation-<issue>` | a round verdict ESCALATE | commits and rounds | both |
   | `pushback-<issue>` | a github round rules no FIX while a merge blocker fails at the head | rounds | rounds |
   | `claim-<id>` | the count of WRONG rulings on its lineage | commits touching its file | those, until one more WRONG |
   | `shim-<id>` | its bug reaches the hold count | commits touching its lines | one such commit |
   | `audit-<issue>` | the count of escalation audits ruled other than CONVERGED_PUSHBACK | rounds | that many audits |
4. We will place `rescope-<issue>` on a `RESCOPE` verdict, and, when reviewer's hook sees a rescope's
   spec PR open (planner ADR-0010), on every open story issue under that spec (root ADR-0006). It
   records the blob SHA of `spec.md` on the story branch, else the default branch, and refuses every code
   commit but a merge of the default branch; it blocks no story start, which merges that branch. reviewer
   releases it once the branch's `spec.md` differs from that SHA and equals the default branch's, checked
   at each commit and round launch, or on `unlock rescope-<issue>`; never on Ready.

## Options considered

### Option A: Ids per story issue; a human or the spec releases (chosen)

### Option B: Ids keyed by the PR or by `us<k>`

Rejected: no PR key exists before or after the PR; `us<k>` is not unique (root ADR-0005).

### Option C: Release a rescope hold on Ready

Rejected: Ready can come before the branch carries the new spec.

### Option D: Release at every start of `issue-tackle`

Rejected: the agent could release its own hold mid-session.

## Trade-offs

- A rescope leaving `spec.md` unchanged holds until a human unlocks it.

## Consequences

- **How we would know this was wrong:** a hold released by another route, or a rescoped story merged on
  a spec other than main's.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
