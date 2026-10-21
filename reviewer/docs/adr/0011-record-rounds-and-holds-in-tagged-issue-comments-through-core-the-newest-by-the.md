---
schemaVersion: 0.2.0
id: "0011"
title: "Record rounds and holds in tagged issue comments through core/; the newest by the session App wins"
status: draft
date: 2026-10-20
deciders: []
tags: [state, ledger, holds, issue-comments, orchestrator, fail-closed]
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

# ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the session App wins

## Context

A local SQLite record is unreadable from the orchestrator's host. A hold can exist before the story's PR,
and a PR can be closed and reopened; the story issue outlives both. Every session posts as the
codeworks-session App (root ADR-0007), and a comment can be edited or deleted.

## Decision

1. We will record rounds and holds in comments on the story issue tagged
   `<!-- codeworks:reviewer-state -->`. Each is the full snapshot, a released hold keeping its row and a
   rescope hold its `spec.md` blob SHA (ADR-0013). The newest tagged comment by the session App wins.
2. We will fail closed: when the newest such comment was edited, or a story with a PR has no snapshot,
   the story is held, as by an open hold. A story with neither a PR nor a snapshot has no state. A
   human's Ready releases it: reviewer then posts a snapshot rebuilt from the newest unedited one.
3. We will read and write the snapshot only through the state module in `core/` (root ADR-0003):
   reviewer writes inside the session it gates, planner only to place a rescope hold (planner
   ADR-0010), and the orchestrator only reads ATTESTED and HOLD. A tagged comment a session posts any other
   way is refused (ADR-0012).
4. We will keep the two writers apart by the lane rule (root ADR-0006): planner writes only while the
   issue is in Blocked or Backlog, where reviewer runs no round and takes no story commit (ADR-0015).
5. We will keep `ledger.db` beside the session as a cache, rebuilt from the newest tagged comment at the
   session's start. Reviewer reports and session grants stay session-scoped files.

## Options considered

### Option A: Tagged issue comments through one shared module, failing closed (chosen)

### Option B: A local SQLite store as the record

Rejected: the problem in Context.

### Option C: A section of the PR body

Rejected: a hold has nowhere to live before the PR exists.

### Option D: The state module private to reviewer's plugin

Rejected: planner and the orchestrator would each need a copy.

### Option E: Fall back to the previous snapshot when the newest is edited or gone

Rejected: deleting or editing the newest comment would drop the hold it placed.

## Trade-offs

- Every state change notifies the issue's subscribers.
- A session can post a forged tagged comment through the API, past the hook; root ADR-0007 accepts that
  risk.
- An edited or lost snapshot holds the story until a human acts.

## Consequences

- Harder: a snapshot format change is a `core/` release every component pins.
- **How we would know this was wrong:** a tagged comment not written through `core/`, or by another
  author, is read as state; an edited or deleted snapshot releases a hold.
- Revisit if: two writers need one issue outside the lane rule, or rounds run outside the session.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
