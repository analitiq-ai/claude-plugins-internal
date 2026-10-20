---
schemaVersion: 0.2.0
id: "0011"
title: "Record rounds and holds in tagged issue comments through core/; the newest by the bot wins"
status: draft
date: 2026-10-20
deciders: []
tags: [state, ledger, holds, issue-comments, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0012", "0013", "0015"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{ledger,github,gate,hookio,pre_merge_gate}.py"
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/README.md"
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0003-keep-the-loop-s-durable-state-in-github-objects.md"
    label: "orchestrator ADR-0003: Keep the loop's durable state in GitHub objects"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0004-attest-the-internal-review-as-a-commit-status-written-by-the-orchestrator-s-app.md"
    label: "orchestrator ADR-0004: Attest the internal review as a commit status written by the orchestrator's App"
---

# ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the bot wins

## Context

A local SQLite record of rounds and holds is unreadable from the orchestrator's host and lost with its own. A hold can exist before the story's PR, and a PR can be closed and reopened;
the story issue outlives both. reviewer writes this state, planner places a rescope hold, and the
orchestrator reads it.

## Decision

1. We will record rounds and holds in comments on the story issue tagged
   `<!-- codeworks:reviewer-state -->`. Each is the full snapshot, a released hold keeping its row and a
   rescope hold its `spec.md` blob SHA (ADR-0013); the newest tagged comment by the bot account wins, read
   with GraphQL `comments(last: N)`. No tagged comment is no state; deleting the newest rolls back to the
   one before, whose rounds name older heads and whose holds only block more.
2. We will read and write the snapshot only through the state module in `core/` (root ADR-0001,
   ADR-0003): reviewer writes inside the session it gates, planner only to place a rescope hold (planner
   ADR-0005), and the orchestrator only reads ATTESTED and HOLD. A tagged comment a session posts any other
   way is refused (ADR-0012).
3. We will keep the two writers apart by lane: planner works on an issue only in Blocked or Backlog, where
   reviewer runs no round and takes no commit (ADR-0015).
4. We will keep `ledger.db` beside the session as a cache, rebuilt from the newest tagged comment at the
   session's start. Reviewer reports and session grants stay session-scoped files (orchestrator ADR-0003).

## Options considered

### Option A: Tagged issue comments through one shared module (chosen)

Each write is a new comment, a hold lives before the PR exists, and one module owns the format.

### Option B: A local SQLite store as the record

Rejected: the problem in Context.

### Option C: A section of the PR body

Rejected: a hold has nowhere to live before the PR exists, and any other writer of the body can drop a row.

### Option D: The state module private to reviewer's plugin

Rejected: planner and the orchestrator would each need their own copy of one format.

## Trade-offs

- Every state change notifies the issue's subscribers.
- Sessions post as the bot account, so the hook's refusal is the only boundary on what the orchestrator
  attests from (orchestrator ADR-0004).

## Consequences

- Easier: the orchestrator reads attestation and holds from the issue alone.
- Harder: a change to the snapshot format is a `core/` release every component pins.
- **How we would know this was wrong:** the orchestrator and a session disagree on attestation or a hold;
  a tagged comment not written through `core/` is read as state; a snapshot loses another writer's row.
- Revisit if: two writers need one issue outside the lane rule.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
