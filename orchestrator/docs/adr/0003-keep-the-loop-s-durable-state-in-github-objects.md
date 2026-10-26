---
schemaVersion: 0.2.0
id: "0003"
title: "Keep the loop's durable state in GitHub objects"
status: draft
date: 2026-10-20
deciders: []
tags: [orchestrator, state, github, pull-requests, issues]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0004"]
affects:
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0003: Keep the loop's durable state in GitHub objects

## Context

The orchestrator (ADR-0001) and reviewer act on the same facts; the agent machine is one dedicated
machine, and planner and the humans work elsewhere (root ADR-0008).

## Decision

1. We will keep every state that outlives a session on GitHub: the claim is the card's move from Ready
   to In progress by the orchestrator's App (ADR-0002); the attestation is a check run at the head
   (ADR-0004); rounds and holds are the
   reviewer App's tagged state comments on the story issue, read as reviewer ADR-0011 decides; findings
   come from the validator modules (root ADR-0003), the required checks and the mergeable field
   (ADR-0007); the escalation
   question, its answer and every Blocked reason are issue comments.
2. We will link a PR to its story issue only by its head branch, as root ADR-0005 decides; a fork PR
   as ADR-0004 decides.
3. We will keep every fact the orchestrator acts on machine-readable: a Blocked reason carries its cause's key and is posted only when no comment with that key
   exists (HANDLED). The Blocked move fires whether or not the reason is HANDLED, a card dragged back to
   a working lane after a handled no-PR turn included.
4. We will post Blocked reasons, status-issue comments, external review requests and thread replies with
   the orchestrator's App, and count only that App's comments for HANDLED and REQUESTED.
5. We will keep no lock: one session at a time runs on the board, building the one story its prompt
   names (root ADR-0008). The orchestrator re-reads
   GitHub at every hook run and stores nothing it could read there; a new session resumes a claimed
   story from GitHub. Where the bound counts of ADR-0001 live is the orchestrator's spec to settle.

## Options considered

### Option A: GitHub objects, reviewer's state in tagged issue comments (chosen)

### Option B: A PR body section

Rejected: there is no PR before the first push, and every whole-body writer can drop a hold.

### Option C: A ledger on the agent machine

Rejected: it dies with the machine and is unreadable where planner and humans work; GitHub is what
every session reads.

### Option D: A local handled flag

Rejected: the comment's key is the record; a restart re-reads the issue.

## Trade-offs

- A turn cut short by the session's end restarts from its start in the next session.

## Consequences

- Easier: a session on a re-built agent machine resumes the loop; a hold survives a re-created PR.
- Harder: a fact to remember needs a GitHub object or is not state.
- **How we would know this was wrong:** a record kept off GitHub beyond decision 5, or two sessions
  disagreeing about one issue.
- Revisit if: rounds move out of the session, or a board needs a second session.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
