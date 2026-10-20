---
schemaVersion: 0.2.0
id: "0003"
title: "Keep the validator modules and the state comment behind one contract each, in core/"
status: draft
date: 2026-10-20
deciders: []
tags: [validators, findings, contract, state-comment, core, codex, coderabbit, deepsource]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0002"]
affects:
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/scripts/codexstate.py"
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0001-drive-the-issue-loop-with-a-deterministic-orchestrator-outside-the-plugins.md"
    label: "orchestrator ADR-0001: Drive the issue loop with a deterministic orchestrator outside the plugins"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0007-mark-a-story-pr-ready-on-the-attestation-alone-in-review-once-green-with-no-find.md"
    label: "orchestrator ADR-0007: Mark a story PR ready on the attestation alone; In review once green with no findings"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0008-request-codex-by-the-orchestrator-s-comment-once-per-head-automatic-review-off.md"
    label: "orchestrator ADR-0008: Request Codex by the orchestrator's comment once per head, automatic review off"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0016-resolve-unread-every-thread-whose-latest-author-is-not-a-trusted-reviewer.md"
    label: "reviewer ADR-0016: Resolve unread every thread whose latest author is not a trusted reviewer"
---

# ADR-0003: Keep the validator modules and the state comment behind one contract each, in core/

## Context

Codex, CodeRabbit, DeepSource and CI grade a PR, each its own way. The orchestrator needs their status at
the head; reviewer's github stage, their findings. reviewer's state, rounds and holds, lives in a tagged issue comment
(reviewer ADR-0011) that reviewer and planner write (planner ADR-0010) and the orchestrator reads.

## Decision

1. We will put one validator module per external reviewer behind one contract: `trigger(pr, head)`, a no-op
   for a self-triggering tool; `status(pr, head)` → pending · pass · fail · silent, silent once the module's
   timeout passes; `findings(pr, head)` → a list in the Findings schema (source, author, file, line, text,
   thread id if any, resolvable on GitHub). Shim and claim checks stay commit gates, not modules.
2. We will count every unresolved review thread on the PR, of any author, as a finding.
3. We will define the Findings contract and the state comment's snapshot as Pydantic models and generate
   their JSON Schemas.
4. We will keep the modules, both contracts and the one state-comment read and write in `core/` (ADR-0001);
   no component reaches the state comment another way. `[shared]` lists the enabled modules and their
   timeouts (ADR-0002).
5. We will have the orchestrator call `trigger` and `status` each tick (orchestrator ADR-0007, ADR-0008),
   and reviewer's github stage read `findings`, with trusted_reviewers applied to `author` (reviewer
   ADR-0016).
6. We will give the Codex module its verdict as Codex's newest review naming the head, a dismissed one
   ignored: the clean template passes, a findings preamble fails, no review at the head is pending. Codex
   out of credits with no verdict passes, marked WAIVED. A human overrides a fail only by merging with the
   ruleset bypass; no override label, no version-only release detection. This module replaces the pr-gate
   service.
7. We will have the CodeRabbit module return its outside-diff items as findings with no thread, each closed
   by a fix or by a pushback recorded in reviewer's state.

## Options considered

### Option A: One contract each, in `core/` (chosen)

### Option B: Modules and state code in reviewer's plugin

Rejected: planner and the orchestrator would import another plugin's code.

### Option C: Each consumer reads raw threads, checks and the state comment

Rejected: one source parsed per consumer, with as many answers.

## Trade-offs

- Nothing writes `codex-review` while the orchestrator is down, so nothing merges.
- A thread a human leaves open blocks the merge like a reviewer's finding.

## Consequences

- Easier: a new reviewer is one module; every consumer reads one answer.
- Harder: a contract change reaches every component that installs `core/`.
- **How we would know this was wrong:** two components disagree on a status, finding or hold at one head.
- Revisit if: a component must run without `core/`.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
