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
relatesTo: ["0007", "0009"]
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0012-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md"
    label: "reviewer ADR-0012: Refuse from any agent session every GitHub write the orchestrator or a human owns"
---

# ADR-0008: Request Codex by the orchestrator's comment once per head, automatic review off

## Context

The merge waits on a Codex verdict that counts only for the head it names (ADR-0009). Neither of today's
triggers (Options B and C, `.claude/rules/pr-review-loop.md`) asks exactly once for each attested, green head.

## Decision

1. We will switch Codex's Automatic review off on every repo the orchestrator serves; the orchestrator's PR
   comment `@codex review`, naming the head, is Codex's trigger on every PR. CodeRabbit keeps its defaults,
   reviewing from ready on.
2. We will post it once per head, when there is no verdict and no request yet: on a story PR once attested,
   green and without findings; on an exempt PR once ready. The hook refuses it from any agent session
   (reviewer ADR-0012).
3. We will read the verdict from the pr-gate App's `codex-review` status at the head (ADR-0009), never the
   review text.
4. We will move the card to Blocked, naming the reporter, when a required context, CodeRabbit or Codex is
   silent for review_timeout, and never ask twice for one head; the second ask is a human's.

## Options considered

### Option A: The orchestrator's comment, Automatic review off (chosen)

One trigger for every PR to main, story or exempt; nothing stored.

### Option B: Codex's Automatic review

Rejected: it reviews on open and ready, never on a push, so every later head needs the comment anyway;
it would only add a second trigger.

### Option C: builder re-requests after pushing fixes (today's loop)

Rejected: it cannot wait for CI; the orchestrator owns the GitHub loop.

### Option D: Request whenever no codex-review status exists at the head

Rejected: the pr-gate App writes pending on every new head, so that never occurs.

### Option E: The orchestrator re-asks a silent reviewer itself

Rejected: the second ask is a human's.

## Trade-offs

- A repo setting the design cannot verify: left on, Automatic review may give a head two reviews.
- Whether Codex honours the orchestrator App's comment is Codex's business: an ignored request
  surfaces only as a Blocked card.

## Consequences

- Easier: every reporter's silence has one bound and one exit.
- Harder: a silent reviewer waits for a human.
- **How we would know this was wrong:** heads with two Codex reviews, or requests that routinely reach
  review_timeout without a verdict.
- Revisit if: Codex re-reviews on push, or stops taking a request from a PR comment.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
