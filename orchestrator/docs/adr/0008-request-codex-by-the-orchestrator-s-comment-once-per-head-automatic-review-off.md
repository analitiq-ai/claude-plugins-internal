---
schemaVersion: 0.2.0
id: "0008"
title: "Request Codex by the orchestrator's comment once per head, automatic review off"
status: draft
date: 2026-10-20
deciders: []
tags: [codex, external-review, orchestrator, pull-requests, github]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0004", "0007", "0009"]
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

# ADR-0008: Request Codex by the orchestrator's comment once per head, automatic review off

## Context

The merge waits on a Codex verdict that counts only for the head it names (ADR-0009). Codex reviews on
its own only when a PR opens or turns ready, never on a push.

## Decision

1. We will switch Codex's Automatic review off on every repo the orchestrator serves; the Codex
   validator module's `trigger` (root ADR-0003) posts the PR comment `@codex review` naming the head,
   with the orchestrator's App, and is Codex's trigger on every PR. CodeRabbit keeps its defaults,
   reviewing from ready on; its `trigger` does nothing.
2. We will trigger once per head, when there is no verdict and no request yet: on a story PR once
   attested, GREEN and without findings; on an exempt PR once ready. REQUESTED counts only a comment by
   the orchestrator's App (ADR-0003); reviewer's hook refuses the request from the model's commands
   (reviewer ADR-0012).
3. We will have the orchestrator write `codex-review` at the head with its App, from the Codex module's
   `status`: pass is success, WAIVED when marked so; fail is failure; pending is pending. No other
   service writes it, so while no agent session runs no PR has a verdict and none merges.
4. We will move the card to Blocked, naming the reporter, when a module reports silent past its
   configured timeout, Codex's timed from the request comment, or a required check (ADR-0007) is
   missing or pending past the configured timeout. We never ask twice for one head; the second ask is a human's.

## Options considered

### Option A: The orchestrator's comment and status, Automatic review off (chosen)

One trigger and one writer for every PR to main, story or exempt; nothing stored.

### Option B: Codex's Automatic review

Rejected: it never reviews a push, so every later head needs the comment anyway.

### Option C: builder re-requests after pushing fixes

Rejected: a request is the orchestrator's move under its App, never the model's.

### Option D: A separate service and App write `codex-review`

Rejected: a second writer on the merge path, running when the orchestrator does not, reading what the
Codex module already reads.

### Option E: The orchestrator re-asks a silent reviewer itself

Rejected: the second ask is a human's.

## Trade-offs

- A repo setting the design cannot verify: left on, Automatic review may give a head two reviews.
- Whether Codex honours the App's comment is Codex's business: an ignored request surfaces only as a
  Blocked card.

## Consequences

- Easier: every reporter's silence has one bound and one exit; the merge fails safe.
- Harder: a silent reviewer waits for a human.
- **How we would know this was wrong:** heads with two Codex reviews, or requests that routinely time
  out without a verdict.
- Revisit if: Codex re-reviews on push, or stops taking a request from a PR comment.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
