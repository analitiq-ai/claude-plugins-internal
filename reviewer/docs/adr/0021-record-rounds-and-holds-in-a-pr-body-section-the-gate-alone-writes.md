---
schemaVersion: 0.2.0
id: "0021"
title: "Record rounds and holds in a PR body section reviewer alone writes"
status: draft
date: 2026-10-19
deciders: []
tags: [state, ledger, holds, pr-body, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0002", "0022", "0023"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{ledger,github,gate,hookio,pre_merge_gate}.py"
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

# ADR-0021: Record rounds and holds in a PR body section reviewer alone writes

## Context

ADR-0002 kept reviewer's record in one local SQLite file on the session's machine, which the
orchestrator, on an unspecified host and running no plugin code, cannot read, and which a host change
loses.

This record supersedes ADR-0002 and reverses its decision 2, one local SQLite file as reviewer's
record; its decision 1, the state directory, stands for session-scoped files only; its decision 6,
`gate.log` and `errors.log`, stands; its decisions 3 to 5 fall with it.

## Decision

1. We will record rounds, holds and `Closes #n` on the last story in one PR body section: a rendered
   table and one machine block; a released hold keeps its row.
2. We will make reviewer the section's only writer after builder creates the PR (ADR-0022), inside
   the session it gates; the orchestrator reads ATTESTED and HOLD from it and never writes it.
3. We will keep `ledger.db` beside the session as a hot-path cache, rebuilt from the section when
   missing. Reviewer reports and session grants stay session-scoped files (orchestrator ADR-0003, decision 4).

## Options considered

### Option A: The PR body section as the record, the local store as a cache (chosen)

One writer after creation, so no conditional update is needed.

### Option B: ADR-0002's local SQLite store as the record

Rejected: the problem in Context.

### Option C: A shared-host ledger the orchestrator calls with `ledger.py`

Rejected: the orchestrator runs no plugin code.

### Option D: Holds as marked issue comments

Rejected: lanes are the state channel; nothing is parsed out of prose.

## Trade-offs

- Reviewer writes the machine block with the session's own credential, so the hook's refusal of a
  later agent body edit is the only boundary on what the orchestrator attests from (orchestrator ADR-0004,
  decision 4).
- A hold has nowhere to live until the PR exists.

## Consequences

- Easier: the orchestrator reads attestation and holds from the PR alone, on any host; a reviewer
  sees rounds and holds in the PR.
- Harder: no transition is recorded without reaching GitHub.
- **How we would know this was wrong:** the orchestrator and a session disagree on a PR's
  attestation or hold; anything but reviewer writes the section; a second durable record of rounds
  or holds appears.
- Revisit if: the orchestrator may read plugin state; GitHub gains a conditional update; a hold must outlive its PR.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
