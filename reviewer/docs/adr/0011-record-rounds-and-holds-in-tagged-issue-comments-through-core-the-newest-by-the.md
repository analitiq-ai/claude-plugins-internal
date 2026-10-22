---
schemaVersion: 0.2.0
id: "0011"
title: "Record rounds and holds in tagged issue comments through core/; the newest by the reviewer App wins"
status: draft
date: 2026-10-20
deciders: []
tags: [state, ledger, holds, issue-comments, orchestrator, fail-closed]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0012", "0013", "0015", "0021"]
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
---

# ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the reviewer App wins

## Context

A record kept beside the session is lost with the agent environment and unreadable where planner and
humans work. A hold can exist before the story's PR, and a PR can be closed and reopened; the story issue
outlives both. A session's token can post any issue comment (root ADR-0007), and a comment can be edited
or deleted.

## Decision

1. We will record rounds and holds in comments on the story issue tagged
   `<!-- codeworks:reviewer-state -->`. Each is the full snapshot, a released hold keeping its row and a
   rescope hold its `spec.md` blob SHA (ADR-0013). The newest tagged comment by the reviewer App,
   `codeworks-reviewer` (issues write alone), wins; reviewer's hook posts it with that App's key, which
   only hooks read (root ADR-0008), and only from verdicts ADR-0021 counts.
2. We will fail closed: when the newest such comment was edited, when the issue's timeline shows a
   reviewer App comment deleted after it, or when a story with a PR has no snapshot, the story is held.
   A story with neither a PR nor a snapshot has no state. A human's Ready releases it: reviewer then
   posts a snapshot rebuilt from the newest unedited one.
3. We will read and write the snapshot only through the state module in `core/` (root ADR-0003):
   reviewer's hook alone writes, and the orchestrator only reads ATTESTED and HOLD.
4. We will have planner write no state: reviewer's hook in the agent environment places a rescope hold
   when it sees the rescope's spec PR open (ADR-0013).
5. We will keep a ledger beside the session as a cache, rebuilt from the newest tagged comment at the
   session's start. Reviewer reports and session grants stay session-scoped files.

## Options considered

### Option A: Tagged issue comments through one shared module, failing closed (chosen)

### Option B: A store beside the session as the record

Rejected: lost with the environment.

### Option C: A section of the PR body

Rejected: a hold has nowhere to live before the PR exists.

### Option D: The state module private to reviewer's plugin

Rejected: the orchestrator would need a copy.

### Option E: Fall back to the previous snapshot when the newest is edited or gone

Rejected: deleting or editing the newest comment would drop the hold it placed.

### Option F: Post as the orchestrator's App

Rejected: the orchestrator would attest `internal-review` from a record it wrote itself.

## Trade-offs

- Every state change notifies the issue's subscribers.
- An edited or lost snapshot holds the story until a human acts.

## Consequences

- Harder: a snapshot format change is a `core/` release every component pins.
- **How we would know this was wrong:** a tagged comment not written through `core/`, or by another
  author, is read as state; an edited or deleted snapshot releases a hold.
- Revisit if: a second writer needs the snapshot, or rounds run outside the session.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
