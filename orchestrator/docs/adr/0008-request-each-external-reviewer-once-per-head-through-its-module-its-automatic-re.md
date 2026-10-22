---
schemaVersion: 0.2.0
id: "0008"
title: "Request each external reviewer once per head through its module, its automatic review off"
status: draft
date: 2026-10-20
deciders: []
tags: [external-review, orchestrator, pull-requests, github]
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

# ADR-0008: Request each external reviewer once per head through its module, its automatic review off

## Context

The merge waits on each external reviewer's verdict, which counts only for the head it names
(ADR-0009). A provider may review on its own only when a PR opens or turns ready, never on a push.

## Decision

1. We will have each validator module's `trigger` (root ADR-0003) request its provider's review, posted
   with the orchestrator's App. A provider's own automatic review is off on every repo where its module
   triggers it; a self-triggering provider's `trigger` is a no-op. How a provider is asked is its
   module's spec's to settle.
2. We will trigger once per head, when there is no verdict and no request yet: on a story PR once
   attested, GREEN and without findings; on an exempt PR once ready. REQUESTED counts only a request
   posted by the orchestrator's App (ADR-0003); reviewer's hook refuses the request from the model's
   commands (reviewer ADR-0012).
3. We will have the orchestrator write each module's `<module>-review` at the head with its App, from
   that module's `status`: PASS is success, WAIVED success marked so, FAIL failure, PENDING pending.
   No other service writes it, so while no agent session runs no PR has a verdict and none merges.
4. We will move the card to Blocked, naming the reporter, when a module reports SILENT past its
   timeout from config, timed from its request where it posted one, or a required check (ADR-0007) is
   missing or pending past the configured timeout. We never ask twice for one head; the second ask is
   a human's.

## Options considered

### Option A: The orchestrator's request and status, automatic review off (chosen)

One trigger and one writer per module for every PR to main, story or exempt; nothing stored.

### Option B: Each provider's automatic review

Rejected: a provider that never reviews a push needs a request for every later head anyway.

### Option C: builder re-requests after pushing fixes

Rejected: a request is the orchestrator's move under its App, never the model's.

### Option D: A separate service and App write the `<module>-review` checks

Rejected: a second writer on the merge path, running when the orchestrator does not, reading what the
modules already read.

### Option E: The orchestrator re-asks a silent reviewer itself

Rejected: the second ask is a human's.

## Trade-offs

- A repo setting the design cannot verify: left on, a provider's automatic review may give a head two
  reviews.
- Whether a provider honours the App's request is its business: an ignored request surfaces only as a
  Blocked card.

## Consequences

- Easier: every reporter's silence has one bound and one exit; the merge fails safe.
- Harder: a silent reviewer waits for a human.
- **How we would know this was wrong:** heads with two reviews from one provider, or requests that
  routinely time out without a verdict.
- Revisit if: a provider we trigger re-reviews on push, or stops taking a request from the App.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
