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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner, builder and orchestrator"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0011-record-rounds-and-holds-in-tagged-issue-comments-through-core-the-newest-by-the.md"
    label: "reviewer ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the session App wins"
---

# ADR-0003: Keep the loop's durable state in GitHub objects

## Context

The orchestrator (ADR-0001) and reviewer act on the same facts; the orchestrator's host is unspecified.

## Decision

1. We will keep every state that outlives a session on GitHub: the claim is the story issue's
   assignee; the attestation is a commit status at the head (ADR-0004); rounds and holds are reviewer's
   tagged state comments on the story issue, read as reviewer ADR-0011 decides; findings come from
   `core/`'s modules, the required checks and the mergeable field (ADR-0007); the escalation question,
   its answer and every Blocked reason are issue comments.
2. We will link a PR to its story issue only by its head branch, as root ADR-0005 decides; a fork PR
   as ADR-0004 decides.
3. We will keep every fact the orchestrator acts on machine-readable: a Blocked reason carries its cause's key and is posted only when no comment with that key
   exists (HANDLED). The Blocked move fires whether or not the reason is HANDLED, a card dragged back to
   a working lane after a handled no-PR launch included.
4. We will post Blocked reasons and Codex requests with the orchestrator's App, and count only that
   App's comments for HANDLED and REQUESTED.
5. We will let the orchestrator keep on its host only the launch lock and the launch log, keyed per
   (repo, issue). The lock is `core/`'s, taken by every launch and by builder's issue-tackle, which
   refuses beside a running launch; a lock an interactive session holds counts as RUNNING. It lives on
   the orchestrator's host, so issue-tackle elsewhere refuses. The lock dies with its process. At
   start-up a launch-log entry with no exit is dropped only if its lock is free, so the next tick
   relaunches that story. The orchestrator re-reads GitHub every tick and stores nothing it could read
   there.

## Options considered

### Option A: GitHub objects, reviewer's state in tagged issue comments (chosen)

### Option B: A PR body section

Rejected: there is no PR before the first push, and every whole-body writer can drop a hold.

### Option C: A shared-host ledger the orchestrator reads

Rejected: a deployment assumption; the orchestrator runs no plugin code.

### Option D: A local handled flag in the launch log

Rejected: the comment's key is the record; a restart re-reads the issue.

## Trade-offs

- A state comment is trusted from the session App, so a session can forge one through the API (root
  ADR-0007).
- A launch that died is relaunched from the start of its turn.

## Consequences

- Easier: the orchestrator restarts anywhere; a hold survives a re-created PR.
- Harder: a fact to remember needs a GitHub object or is not state.
- **How we would know this was wrong:** a record kept off GitHub beyond decision 5, or two hosts
  disagreeing about one issue.
- Revisit if: rounds move out of the session, or stories must be built away from the orchestrator's
  host.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
