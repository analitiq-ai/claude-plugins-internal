---
schemaVersion: 0.2.0
id: "0004"
title: "Attest the internal review as a commit status written by the orchestrator's App"
status: draft
date: 2026-10-20
deciders: []
tags: [attestation, commit-status, merge-gate, github-app, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0005", "0009"]
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

# ADR-0004: Attest the internal review as a commit status written by the orchestrator's App

## Context

The merge contract is GitHub's ruleset (ADR-0009), which needs a status saying the internal review
passed at the head. Reviewer records each round's verdict in the PR body section (reviewer
ADR-0011) from inside the agent session, with its credential. Which credential turns that record into
the status the ruleset trusts is the ruleset's trust root.

## Decision

1. We will attest the internal review as the commit status `internal-review` at the head (ADR-0003):
   success when reviewer's block records a CLEAN round at head, success marked "exempt" on an exempt
   PR (ADR-0005), else pending; written whenever the status at head differs from that value, so a
   write never repeats and a removed exempt label is undone.
2. We will have the orchestrator's own App write it, from GitHub state alone.
3. We will have the ruleset (ADR-0009) require `internal-review` from that App alone, so a status
   written with any session token counts for nothing.
4. We will accept the reviewer hook, which refuses a body edit from the agent after creation
   (reviewer ADR-0011), as the only boundary on the block the orchestrator reads.

## Options considered

### Option A: The orchestrator's App writes the status from reviewer's block (chosen)

One writer, whose credential lives only on the orchestrator's host; no comment hop.

### Option B: An attestation comment the pr-gate App turns into the status

Rejected: a comment any session can post is the attestation's only evidence.

### Option C: Reviewer writes the status from the session with its token

Rejected: the graded session would attest its own review.

## Trade-offs

- The App's evidence is only as trustworthy as the hook: a session that got a body edit past it could
  record a CLEAN round the App would attest.
- Every repo the orchestrator serves needs the App installed and a ruleset pinning `internal-review`
  to it.

## Consequences

- Easier: the credential that attests never enters an agent session.
- Harder: while the orchestrator is down no PR is attested.
- **How we would know this was wrong:** a CLEAN round in the block that no review round produced
  because an agent session rewrote the block past the hook.
- Revisit if: reviewer stops recording rounds in the PR body (reviewer ADR-0011), or the ruleset
  stops being the merge contract (ADR-0009).

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
