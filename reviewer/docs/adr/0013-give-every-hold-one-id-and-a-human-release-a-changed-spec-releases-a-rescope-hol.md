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
relatesTo: ["0001", "0008", "0010", "0011", "0012", "0015", "0019"]
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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md"
    label: "orchestrator ADR-0002: The orchestrator alone writes the working lanes, derived from the PR"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0010-take-an-escalation-s-answer-from-a-writer-s-issue-comment.md"
    label: "orchestrator ADR-0010: Take an escalation's answer from a writer's issue comment"
---

# ADR-0013: Give every hold one id and a human release; a changed spec releases a rescope hold

## Context

A launch from Ready types no prompt. A story's PR can be closed and reopened. A rescope changes the spec
a story in flight is graded against.

## Decision

1. We will give every hold an id and a row in the state snapshot (ADR-0011), keyed by the story issue's
   number but `claim-<id>` (its lineage) and `shim-<id>` (its bug). The orchestrator moves the card to Blocked
   and merges nothing while one is open (orchestrator ADR-0009). A refusal names the exact id.
2. We will release holds by one function: reviewer, at the start of the launch after a human's Ready,
   releases every open hold of the story issue but `rescope-<issue>`; a prompt starting `unlock <id>`,
   read in the `UserPromptSubmit` hook, releases that one.
3. We will place each hold, and grant on its release, as follows. A merge blocker is `codex-review` =
   failure or a required check failing; pushed-back threads alone are resolved by the replies and place
   no hold.

   | Hold | Placed when | Refuses | A release grants |
   |---|---|---|---|
   | `escalation-<issue>` | a round verdict ESCALATE | commits and rounds | both; Ready releases it only once ANSWERED |
   | `pushback-<issue>` | a github round rules no FIX while a merge blocker stays failing at the head | rounds | rounds again |
   | `claim-<id>` | three WRONG rulings on one claim lineage | commits touching its file | its commits, until one more WRONG |
   | `shim-<id>` | its bug reaches count 4 | commits touching the bug's lines | one such commit, then the count resumes |
   | `audit-<issue>` | two escalation audits not CONVERGED | rounds | two more audits |
4. We will place `rescope-<issue>` on a `RESCOPE` verdict, and through `core/` when planner opens a rescope
   spec PR, on each story issue under that spec that has a branch (planner ADR-0005). It records the blob
   SHA of the story branch's `spec.md`, and refuses the PR's merge and every code commit but the session's
   merge of the default branch. It blocks no launch: that launch and merge bring in the new `spec.md`.
   reviewer releases it once that SHA changes, checked at each commit and round launch, or on
   `unlock rescope-<issue>`.

## Options considered

### Option A: Ids per story issue; human release; a rescope hold released by its spec (chosen)

### Option B: Ids keyed by the PR or by `us<k>`

Rejected: no PR key exists before or after the PR; `us<k>` is not unique (ADR-0015).

### Option C: A pushback hold on every pushed-back round

Rejected: replies resolve the threads.

### Option D: Release a rescope hold at the launch after Ready

Rejected: Ready can come before the branch carries the new spec.

## Trade-offs

- A rescope that leaves `spec.md` unchanged holds until a human types `unlock rescope-<issue>`.

## Consequences

- Harder: an escalation also needs ANSWERED, else Ready bounces to Blocked (orchestrator ADR-0010).
- **How we would know this was wrong:** a hold released by another route or lost with its PR; a rescoped
  story merged on its old spec.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
