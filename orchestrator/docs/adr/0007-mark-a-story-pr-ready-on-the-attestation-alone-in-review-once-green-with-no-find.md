---
schemaVersion: 0.2.0
id: "0007"
title: "Mark a story PR ready on the attestation alone; In review once green with no findings"
status: draft
date: 2026-10-20
deciders: []
tags: [pull-requests, ready-flip, orchestrator, review-loop, lanes]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0002", "0008", "0009"]
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

# ADR-0007: Mark a story PR ready on the attestation alone; In review once green with no findings

## Context

A story PR opens as a draft (builder ADR-0003), which an external reviewer may skip. Also to decide:
whether a failing check is a finding or a human's stop. Anyone can open a review thread on a public
repo.

## Decision

1. We will have the orchestrator flip a story PR to ready once per PR, between turns, when the head is
   attested with no hold open; a human's click counts the same.
2. We will evaluate the external reviewers and the required checks after ready, reading every enabled
   module's `status` at each hook run (root ADR-0003). GREEN is every check the base branch's effective
   rules require (ADR-0009) success at the head, leaving out `internal-review` and each module's
   `<module>-review`, so no status waits on itself. FINDINGS is a module's open finding, the threads module's trusted threads
   included (root ADR-0003), unless it has no thread and reviewer's state records it as pushed back; a
   required check in `failure`; or a conflict with main. FINDINGS names builder's next step; a pending
   module or check is a wait; a required check in `error` could not run (root ADR-0004) and moves the card to
   Blocked naming it.
3. We will move the card to In review only once the head is attested and GREEN with no findings and no
   hold.
4. We will name no builder step for a Ready card whose head is attested with no hold open: a draft goes
   to the flip, a ready PR to In review once GREEN with no findings.
5. We will treat a PR a human converts back to draft as CONVERTED: Blocked until the human re-marks it
   ready and moves the card to Ready.
6. We will have the orchestrator resolve, unread, every unresolved review thread no trusted reviewer
   started, replying with its App that it was not read, and name no step for it.

## Options considered

### Option A: Ready at internal-clean; In review at green with no findings (chosen)

A reviewer that skips drafts sees the PR from internal-clean.

### Option B: Ready only once every required check is green

Rejected: holding the draft keeps such a reviewer off a head the internal review already cleared.

### Option C: A failing check as a human's stop, never a finding

Rejected: the agent fixes a failing check; Blocked is for what only a human can clear.

## Trade-offs

- External reviewers may review every push from ready on, including failing heads.
- A writer outside `trusted_reviewers` gets no answer on a thread they start.

## Consequences

- Easier: the agent clears a failing check itself.
- Harder: a ready PR's card stays In progress until GREEN with no findings.
- **How we would know this was wrong:** most github rounds open on CI findings alone, or converted PRs
  pile up in Blocked.
- Revisit if: no configured external reviewer skips drafts.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
