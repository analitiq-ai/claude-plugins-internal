---
schemaVersion: 0.2.0
id: "0013"
title: "Give every hold one id and release it only on a Ready move and an admin's comment"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [holds, release, user-authority, reset, rescope, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0008", "0010", "0011", "0012", "0015", "0016", "0017", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,ledger,claimgate,shimgate,hookio}.py"
  - type: path
    pattern: "reviewer/plugin/hooks/hooks.json"
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/lib/rules/counts.ts"
  - type: path
    pattern: "reviewer/plugin/lib/round/gates.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:52Z
---

# ADR-0013: Give every hold one id and release it only on a Ready move and an admin's comment

## Context

A story is claimed from Ready on an admin's prompt naming it (orchestrator ADR-0001). Its PR can be
closed and reopened. A rescope changes the spec a story in flight is graded against. Admins act on the
loop only through GitHub: the board, issue comments and, to clear an invalid commit from the `ledger`
branch, a deletion commit (ADR-0011 d2).

## Decision

1. We will give every hold an id and a row in the state snapshot (ADR-0011), keyed by the story issue's
   number but `claim-<id>` (its lineage) and `shim-<id>` (its bug). While one is open the story merges
   nothing: `internal-review` stays pending (orchestrator ADR-0004). A refusal names the id.
2. We will release holds by one function in `core/`, only on the orchestrator's claim from Ready (orchestrator
   ADR-0002): the orchestrator runs it before it claims, and reviewer's hook writes its releases at its first
   run after the claim, since the two plugins' hooks on one prompt run in parallel.
   reviewer releases each open hold of the story issue for which both a move of the card to Ready on the board
   `[shared] board` names and an admin's comment on the story issue are newer than the commit that
   placed the hold. An admin is a writer other than a codeworks App, read as orchestrator ADR-0010 reads one;
   for an escalation hold, that comment is its answer. A release by a comment lapses the attestation, and the
   new internal round at the head is briefed with the comment (orchestrator ADR-0004). A hold with no such
   comment stays open, and the start stops (orchestrator ADR-0002).
3. We will have an admin's comment `/codeworks reset` on the story issue release every open hold of the
   story and restart every count that places one, the orchestrator's included (orchestrator ADR-0001),
   and let a check that cannot find its gates anchor start the gates section over (ADR-0001 d2). It moves
   no card: the admin sets Ready.
4. We will place each hold, and grant on its release, as follows; each count is a `[reviewer]` key.
   A merge blocker is a validator module's failure through `core/` (ADR-0016) or a failing required check;
   pushed-back threads alone are resolved by the replies.

   | Hold | Placed when | Refuses | A release grants |
   |---|---|---|---|
   | `escalation-<issue>` | a round verdict ESCALATE, or a trusted thread answered after its ruling `k_topic` times (ADR-0016) | commits and rounds | both |
   | `pushback-<issue>` | a github round rules no FIX while a merge blocker fails at the head | rounds | rounds |
   | `claim-<id>` | its lineage has `claim_hold_at` WRONG rulings, a check counting once | commits touching its file | those, until one more WRONG |
   | `shim-<id>` | its bug has `shim_hold_at` members (ADR-0008) | commits touching its lines | one such commit |
   | `audit-<issue>` | `max_audits` escalation audits ruled other than CONVERGED_PUSHBACK | rounds | that many audits |

   The claim and shim counts take only the WRONG rulings and members dated after `reset.at`, the time of the
   newest `/codeworks reset` (d3). A release by d2 lowers no count: a released `claim-<id>` holds again at the next
   check that rules its lineage WRONG, the released words included, and a released `shim-<id>` lets one commit
   touching its line ranges through, whose check places it again. A `claim-<id>` hold carries the last WRONG
   ruling's failing case and evidence as its question. An `escalation-<issue>` hold a verdict places carries
   as its question why the round escalated and what must be decided, each ADR departure among them one line,
   `ADR departure: <folder> <record id> <file> — <what departs>` (ADR-0017 d2), written and read by one pair
   of functions in `core/`. The rulings and members live in the gates section of the state snapshot (ADR-0011
   d1), and a count and the hold it places land in one commit.
5. We will place `rescope-<issue>` on a `RESCOPE` verdict, carrying as its question, as d4's escalation does,
   why the round rescoped and what must be decided; and, when reviewer's hook sees a rescope's spec PR open
   (planner ADR-0010), on every open story issue under that spec (root ADR-0006), recording that spec PR's
   number and no question. The orchestrator posts a verdict's question (orchestrator ADR-0010 d1). reviewer's hook derives this at each run: a spec PR whose number a story's
   rescope row already records places nothing again, released or not; a new spec PR places the hold
   again. It refuses every code commit but a merge of the default branch, and releases as every hold
   does (d2).

## Options considered

### Option A: Ids per story issue; one release, a Ready move and an admin's comment (chosen)

### Option B: Ids keyed by the PR or by `us<k>`

Rejected: no PR key exists before or after the PR; `us<k>` is not unique (root ADR-0005).

### Option C: Release a rescope hold once the branch carries a changed spec

Rejected by the user on 2026-10-24: every hold releases the same way, and a spec that did not change
needs the admin's comment saying why the old one stands.

### Option D: Release at every start of `issue-tackle`

Rejected: the agent could release its own hold mid-session.

### Option E: A prompt `unlock <id>` in the session

Rejected by the user on 2026-10-24: admins act on the loop only through GitHub; `/codeworks reset` on
the story issue replaces it.

## Trade-offs

- Every release costs an admin two acts: a comment and a Ready; a tamper hold a third, the clearance of
  what the invalid commit added (ADR-0011 d2).
- The code checks that a comment exists, not what it says.

## Consequences

- **How we would know this was wrong:** a hold released by another route, or a rescoped story merged on
  a spec other than main's.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
