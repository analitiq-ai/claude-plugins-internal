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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0011-record-rounds-and-holds-in-a-pr-body-section-reviewer-alone-writes.md"
    label: "reviewer ADR-0011: Record rounds and holds in a PR body section reviewer alone writes"
---

# ADR-0003: Keep the loop's durable state in GitHub objects

## Context

The orchestrator (ADR-0001) and reviewer act on the same facts, and the orchestrator's host is
unspecified. A store local to one host cannot be read by an orchestrator on another host.

## Decision

1. We will keep every state that outlives a session on GitHub, in objects it already has: the claim
   is the issue assignee; the attestation is a commit status at the head (ADR-0004); rounds and holds
   are one PR body section (reviewer ADR-0011); findings are review threads, check runs and the
   mergeable field; the escalation question, its answer and every Blocked reason are issue comments.
2. We will keep every fact the orchestrator acts on machine-readable, since it parses no prose
   (ADR-0001): the PR body section carries a machine block; a Blocked reason carries its cause's key
   and is posted only when no comment with that key exists.
3. We will let the orchestrator keep on its host only its process lock, launch log and config,
   keyed per (repo, issue); it re-reads GitHub every tick and stores nothing it could read there.
4. We will let the plugins keep session-scoped files and a cache rebuilt from the PR body (reviewer
   ADR-0011); no record elsewhere.

## Options considered

### Option A: GitHub objects as the store, a machine block in the PR body (chosen)

No host assumed.

### Option B: A shared-host ledger the orchestrator reads with `ledger.py`

Rejected: a deployment assumption; the orchestrator runs no plugin code.

### Option C: An inbox drop file for GitHub findings

Rejected: the github round queries GitHub at launch.

### Option D: A local handled flag in the launch log

Rejected: the comment's key is the record; a restart re-reads the issue.

## Trade-offs

- The PR body section stays consistent only while reviewer is its one writer (reviewer ADR-0011).
- The host keeps no record of a launch that died: at start-up its entry is dropped and the launch is
  relaunched as if never made.

## Consequences

- Easier: the orchestrator runs anywhere and restarts by reading GitHub.
- Harder: a fact to remember needs a GitHub object or is not state.
- **How we would know this was wrong:** a record kept off GitHub beyond the ones decisions 3 and 4
  name, or two hosts disagreeing about one issue.
- Revisit if: the PR body gets a second writer, or orchestrator and plugins share one host by design.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
