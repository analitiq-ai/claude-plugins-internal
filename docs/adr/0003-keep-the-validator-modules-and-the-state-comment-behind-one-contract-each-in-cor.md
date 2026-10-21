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
relatesTo: ["0001", "0002", "0004"]
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
---

# ADR-0003: Keep the validator modules and the state comment behind one contract each, in core/

## Context

Codex, CodeRabbit, DeepSource and CI grade a PR, each its own way. The orchestrator needs their status at
the head; reviewer's github stage, their findings. reviewer's state, rounds and holds, lives in a tagged
issue comment (reviewer ADR-0011) that reviewer and planner write and the orchestrator reads.

## Decision

1. We will put one validator module per external reviewer behind one contract: `trigger(pr, head)`, a no-op
   for a self-triggering tool; `status(pr, head)` → pending · pass · fail · silent, silent once the module's
   timeout passes; `findings(pr, head)` → a list in the Findings schema (source, author, file, line, text,
   thread id if any, resolvable on GitHub).
2. We will put a threads module in `core/` behind the same `findings` contract: an unresolved review
   thread is a finding only if a trusted reviewer started it; `trusted_reviewers` is a `[shared]` key
   (ADR-0002).
3. We will define the Findings contract, the state comment's snapshot and the spec facts (planner
   ADR-0008) as Pydantic models and generate their JSON Schemas.
4. We will have no component reach the state comment other than through `core/`'s one read and write
   (ADR-0001).
5. We will make the modules the only way a component reads an external reviewer: the orchestrator calls
   `trigger` and `status` (orchestrator ADR-0008) and reads `findings` (orchestrator ADR-0007); reviewer's
   github stage reads `findings` (reviewer ADR-0016). The orchestrator alone closes threads no trusted
   reviewer started (orchestrator ADR-0007).
6. We will give the Codex module its verdict as Codex's newest review naming the head, a dismissed one
   ignored: the clean template passes, a findings preamble fails, no review at the head is pending. Codex
   out of credits with no verdict passes, marked WAIVED: the one exception to ADR-0004's fail-closed
   rule.
7. We will have the CodeRabbit module return its outside-diff items as findings with no thread, closed by
   a fix or by a pushback recorded in reviewer's state.

## Options considered

### Option A: One contract each, in `core/` (chosen)

### Option B: Modules and state code in reviewer's plugin

Rejected: planner and the orchestrator would import another plugin's code.

### Option C: Each consumer reads raw threads, checks and the state comment

Rejected: one source parsed per consumer, with as many answers.

### Option D: An override label for a Codex fail, or a release detected from a version-only change

Rejected: a named human on the ruleset bypass list merges past a fail (orchestrator ADR-0009); a release
is a human's decision.

## Trade-offs

- A thread from someone outside `trusted_reviewers` is resolved unread, a human writer's included.

## Consequences

- Easier: a new reviewer is one module; every consumer reads one answer.
- Harder: a contract change reaches every component that installs `core/`.
- **How we would know this was wrong:** two components disagree on a status, finding or hold at one head.
- Revisit if: a component must run without `core/`.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
