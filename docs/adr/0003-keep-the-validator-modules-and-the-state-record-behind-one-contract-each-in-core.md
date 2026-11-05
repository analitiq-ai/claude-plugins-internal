---
schemaVersion: 0.2.0
id: "0003"
title: "Keep the validator modules and the state record behind one contract each, in core/"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [validators, findings, contract, state-record, core]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0002", "0004"]
affects:
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "validators/**"
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
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:46Z
---

# ADR-0003: Keep the validator modules and the state record behind one contract each, in core/

## Context

External reviewers and CI grade a PR, each its own way. The orchestrator needs their status at the head;
reviewer's github stage, their findings. reviewer's state, rounds and holds, lives on the served repo's
`ledger` branch (reviewer ADR-0011), which reviewer's hook writes and the orchestrator reads as a fold.

## Decision

1. We will put one validator module per external reviewer behind one contract, defined in `core/`:
   `trigger(pr, head)`, a no-op for a self-triggering provider; `status(pr, head)` → PENDING · PASS ·
   FAIL · WAIVED · SILENT; `findings(pr, head)` → a list in the Findings schema (source, author, file,
   line, text, thread id if any, resolvable on GitHub). PASS and FAIL come only from the provider's
   reading of that head; until one exists, a head the provider skipped included, the status is PENDING,
   and SILENT once `review_timeout` (orchestrator ADR-0001) passes. A FAIL names what failed: its
   `findings` for that head list at least one finding, and core reads a FAIL with none as a module that
   could not run (ADR-0004), since builder would have nothing to fix.
2. We will put a threads module in `core/` behind the same `findings` contract: an unresolved review
   thread is a finding only if a trusted reviewer started it; `trusted_reviewers` is a `[shared]` key
   (ADR-0002).
3. We will define the Findings contract, the state record's events and snapshot, and the spec facts (planner
   ADR-0008) as Zod schemas (ADR-0009) and generate their JSON Schemas.
4. We will have no component reach the state record other than through `core/`'s one read and write
   (ADR-0001).
5. We will make the modules the only way a component reads an external reviewer: the orchestrator calls
   `trigger` and `status` (orchestrator ADR-0008) and reads `findings` (orchestrator ADR-0007); reviewer's
   github stage reads `findings` (reviewer ADR-0016). The orchestrator alone closes threads no trusted
   reviewer started (orchestrator ADR-0007).
6. We will keep each validator module in a package of its own (ADR-0001), which
   owns how it reaches its provider and reads and interprets the provider's results, its token if it
   needs one included; `core/` holds only the contract, the threads module and the read of required
   checks. A module whose provider publishes its verdict only in review text reads it there, in that
   module alone. A provider out of credits with no verdict is WAIVED, which counts as a pass: the one
   exception to ADR-0004's fail-closed rule.
7. We will have a module return items its provider publishes outside any thread as findings with no
   thread, closed by a fix or by a pushback recorded in reviewer's state.
8. We will treat every module listed in `validators` (a `[shared]` key) alike: each is required, with one
   `<module>-review` (orchestrator ADR-0008), its name its folder's, and no module has a `codeworks.toml`
   key of its own. A module reads its provider's verdict only from objects GitHub shows that provider
   authored, or from the provider's API, never from a commit status, whose creator GitHub leaves empty.

## Options considered

### Option A: One contract each, in `core/` (chosen)

### Option B: Modules and state code in reviewer's plugin

Rejected: planner and the orchestrator would import another plugin's code.

### Option C: Each consumer reads raw threads, checks and the state record

Rejected: one source parsed per consumer, with as many answers.

### Option D: An override label for an external reviewer's fail, or a release detected from a version-only change

Rejected: a named admin on the ruleset bypass list merges past a fail (orchestrator ADR-0009); a release
is an admin's decision.

### Option E: An advisory module, or settings per module

Rejected by the user on 2026-10-25: every module is treated the same.

### Option F: A verdict from the provider's commit status

Rejected: a commit status names no creator, so any writer could post it; CodeRabbit posted `success`
for a review it never ran.

## Trade-offs

- A thread from someone outside `trusted_reviewers` is resolved unread, an admin writer's included.
- A provider that does not read a head, one that skips the agent's commits for example, leaves it SILENT,
  and the card goes to Blocked at `review_timeout`.
- A head merged on WAIVED had no external reading.

## Consequences

- Easier: a new reviewer is one folder in `validators/`; every consumer reads one answer.
- Harder: a contract change reaches every plugin that carries `core/`.
- **How we would know this was wrong:** two components disagree on a status, finding or hold at one head.
- Revisit if: a component must run without `core/`.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
