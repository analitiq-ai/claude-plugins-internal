---
schemaVersion: 0.2.0
id: "0013"
title: "Give every hold one id and release it only on a human's Ready and comment"
status: draft
date: 2026-10-20
deciders: []
tags: [holds, release, user-authority, reset, rescope, orchestrator]
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

# ADR-0013: Give every hold one id and release it only on a human's Ready and comment

## Context

A story is claimed from Ready on a person's prompt naming it (orchestrator ADR-0001). Its PR can be
closed and reopened. A rescope changes the spec a story in flight is graded against. Humans act on the
loop only through GitHub: the board and issue comments.

## Decision

1. We will give every hold an id and a row in the state snapshot (ADR-0011), keyed by the story issue's
   number but `claim-<id>` (its lineage) and `shim-<id>` (its bug). While one is open the story merges
   nothing: `internal-review` stays pending (orchestrator ADR-0004). A refusal names the id.
2. We will release holds by one function, only on the orchestrator's claim from Ready (orchestrator
   ADR-0002). reviewer releases each open hold of the story issue for which both the card's Ready and a
   human's comment on the story issue are newer than the state comment that placed the hold. A human
   is a writer other than a codeworks App, read as orchestrator ADR-0010 reads one; for an escalation
   hold, that comment is its answer. reviewer carries the comment into the next round's briefs. A hold
   with no such comment stays open, and the start stops (orchestrator ADR-0002).
3. We will have a human's comment `/codeworks reset` on the story issue release every open hold of the
   story and restart every count that places one, the orchestrator's included (orchestrator ADR-0001).
   It moves no card: the human sets Ready.
4. We will place each hold, and grant on its release, as follows; each count is a `[reviewer]` key.
   A merge blocker is a validator module's failure through `core/` (ADR-0016) or a failing required check;
   pushed-back threads alone are resolved by the replies.

   | Hold | Placed when | Refuses | A release grants |
   |---|---|---|---|
   | `escalation-<issue>` | a round verdict ESCALATE, or a trusted thread answered after its ruling `k_topic` (2) times (ADR-0016) | commits and rounds | both |
   | `pushback-<issue>` | a github round rules no FIX while a merge blocker fails at the head | rounds | rounds |
   | `claim-<id>` | the count of WRONG rulings on its lineage | commits touching its file | those, until one more WRONG |
   | `shim-<id>` | its bug reaches the hold count | commits touching its lines | one such commit |
   | `audit-<issue>` | the count of escalation audits ruled other than CONVERGED_PUSHBACK | rounds | that many audits |
5. We will place `rescope-<issue>` on a `RESCOPE` verdict, and, when reviewer's hook sees a rescope's
   spec PR open (planner ADR-0010), on every open story issue under that spec (root ADR-0006). It
   records the blob SHA of `spec.md` on the story branch, else the default branch, and refuses every code
   commit but a merge of the default branch; it blocks no story start, which merges that branch. It
   releases as every hold does (d2). The next round's briefs carry whether the default branch's `spec.md`
   differs from that SHA; where it does not, the human's comment says why the old spec stands.

## Options considered

### Option A: Ids per story issue; one release, a human's Ready and comment (chosen)

### Option B: Ids keyed by the PR or by `us<k>`

Rejected: no PR key exists before or after the PR; `us<k>` is not unique (root ADR-0005).

### Option C: Release a rescope hold once the branch carries a changed spec

Rejected by the user on 2026-10-24: every hold releases the same way, and a spec that did not change
needs the human's comment saying why the old one stands.

### Option D: Release at every start of `issue-tackle`

Rejected: the agent could release its own hold mid-session.

### Option E: A prompt `unlock <id>` in the session

Rejected by the user on 2026-10-24: humans act on the loop only through GitHub; `/codeworks reset` on
the story issue replaces it.

## Trade-offs

- Every release costs a human two acts: a comment and a Ready.
- The code checks that a comment exists, not what it says.

## Consequences

- **How we would know this was wrong:** a hold released by another route, or a rescoped story merged on
  a spec other than main's.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
