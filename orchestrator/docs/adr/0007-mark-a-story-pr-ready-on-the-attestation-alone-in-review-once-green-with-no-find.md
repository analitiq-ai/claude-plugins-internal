---
schemaVersion: 0.2.0
id: "0007"
title: "Mark a story PR ready on the attestation alone; In review once green with no findings"
status: draft
date: 2026-10-19
deciders: []
tags: [pull-requests, ready-flip, orchestrator, review-loop, lanes]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0008"]
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-build/docs/adr/0003-open-a-draft-pr-after-the-first-push-and-end-the-turn-at-an-attested-draft.md"
    label: "builder ADR-0003: Open a draft PR after the first push and end the turn at an attested draft"
---

# ADR-0007: Mark a story PR ready on the attestation alone; In review once green with no findings

## Context

A story PR opens as a draft (builder ADR-0003). When it leaves draft decides what CodeRabbit, which
skips drafts, sees. A second choice is whether a failing check is a finding or a human's stop.

## Decision

1. We will have the orchestrator flip a story PR to ready once per PR, when the head is attested with
   no launch running and no hold open; a human's click counts the same.
2. We will evaluate CI, CodeRabbit and DeepSource after ready: a failing required check, an unresolved
   thread or a conflict with main is a finding that relaunches builder; a pending check is a wait. The
   card moves to In review only once the head is green with no findings.
3. We will treat a PR a human converts back to draft as CONVERTED: Blocked until the human re-marks it
   ready and moves the card to Ready.

## Options considered

### Option A: Ready at internal-clean; In review at green with no findings (chosen)

CodeRabbit skips drafts, so external review needs the PR ready at internal-clean.

### Option B: Ready only once every required check is green

Rejected: holding the draft until green keeps CodeRabbit off a head the internal review already
cleared.

### Option C: builder marks the PR ready at the end of its loop (brainstorm)

Rejected: the ready flip has one writer past the PR's creation, the orchestrator (ADR-0001);
builder ends its turn at an attested draft and never flips it (builder ADR-0003).

### Option D: A failing check as a poller BLOCKED exit, never a finding (brainstorm)

Rejected: the agent fixes a failing check, so it is a finding; Blocked is for what only a human can
clear.

## Trade-offs

- CodeRabbit reviews every push from ready on, including a head that CI then fails and the fix that
  follows it.
- A converted PR waits on the human who converted it.

## Consequences

- Easier: the agent clears a failing check itself.
- Harder: a ready PR's card stays In progress until CI is green with no findings.
- **How we would know this was wrong:** most github rounds open on ci findings alone, or converted PRs
  pile up in Blocked.
- Revisit if: CodeRabbit reviews drafts, so nothing external reacts to ready.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
