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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner, builder and orchestrator"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/builder/docs/adr/0003-open-a-draft-pr-after-the-first-push-and-end-the-turn-at-an-attested-draft.md"
    label: "builder ADR-0003: Open a draft PR after the first push and end the turn at an attested draft"
---

# ADR-0007: Mark a story PR ready on the attestation alone; In review once green with no findings

## Context

A story PR opens as a draft (builder ADR-0003). When it leaves draft decides what CodeRabbit, which
skips drafts, sees. A second choice is whether a failing check is a finding or a human's stop.

## Decision

1. We will have the orchestrator flip a story PR to ready once per PR, when the head is attested with
   no launch running and no hold open; a human's click counts the same.
2. We will evaluate the external reviewers and the required checks after ready. Each tick the
   orchestrator reads `status` from every validator module the config enables (root ADR-0003) and
   calls `trigger` as ADR-0008 decides. GREEN is every check the base branch's effective rules require
   (ADR-0001) success at the head; no status is an input to its own wait, so GREEN leaves out
   `internal-review`, decided by the attestation (ADR-0004), and `codex-review`, requested once GREEN
   (ADR-0008). FINDINGS is a module reporting open findings, a required check failing, an unresolved
   review thread of any author, or a conflict with main; it relaunches builder. A pending module or
   check is a wait.
3. We will move the card to In review only once the head is attested and GREEN with no findings and no
   hold.
4. We will give a Ready card whose head is attested with no hold open no launch: a draft goes to the
   flip, a ready PR to In review once GREEN with no findings.
5. We will treat a PR a human converts back to draft as CONVERTED: Blocked until the human re-marks it
   ready and moves the card to Ready.

## Options considered

### Option A: Ready at internal-clean; In review at green with no findings (chosen)

CodeRabbit skips drafts, so external review needs the PR ready at internal-clean.

### Option B: Ready only once every required check is green

Rejected: holding the draft keeps CodeRabbit off a head the internal review already cleared.

### Option C: builder marks the PR ready at the end of its loop

Rejected: the ready flip has one writer, the orchestrator (ADR-0001); builder ends its turn at an
attested draft (builder ADR-0003).

### Option D: A failing check as a human's stop, never a finding

Rejected: the agent fixes a failing check, so it is a finding; Blocked is for what only a human can
clear.

## Trade-offs

- CodeRabbit reviews every push from ready on, including heads that CI then fails.
- A converted PR waits on the human who converted it.

## Consequences

- Easier: the agent clears a failing check itself; a new reviewer is a new module, not new orchestrator
  code.
- Harder: a ready PR's card stays In progress until GREEN with no findings.
- **How we would know this was wrong:** most github rounds open on CI findings alone, or converted PRs
  pile up in Blocked.
- Revisit if: CodeRabbit reviews drafts.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
