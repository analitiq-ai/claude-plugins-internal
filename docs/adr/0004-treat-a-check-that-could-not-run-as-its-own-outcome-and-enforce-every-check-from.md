---
schemaVersion: 0.2.0
id: "0004"
title: "Treat a check that could not run as its own outcome, and enforce every check from its first release"
status: draft
date: 2026-10-20
deciders: []
tags: [failure-handling, checks, rollout, fail-closed]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/**"
  - type: path
    pattern: "planner/plugin/scripts/**"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "core/**"
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

# ADR-0004: Treat a check that could not run as its own outcome, and enforce every check from its first release

## Context

reviewer's gates, planner's workflow steps and the validator modules run checks that depend on git,
GitHub, a model or an agent. When one does not answer, the check has no verdict, and what it decides
still has to go ahead or not; a GitHub status reports this as `error`, apart from `failure`. Constitution
P4 says how such an outcome is reported, not whether the work goes on, and checks differ on it. Nothing
after planning validates a spec folder (reviewer ADR-0014), and nothing after a commit gate re-checks what
it let through. A new check can also enforce from its first release, or first only record what it would
have stopped.

## Decision

1. We will treat a check that could not run as its own outcome: never a pass, never a finding against the
   author, never a guess.
2. We will fail closed on it: the call, workflow step or merge the check decides does not go ahead until
   the check runs. The one exception is Codex out of credits, which passes marked WAIVED (ADR-0003).
3. We will count every verdict a check returns as an answer, not as this outcome: a judge's `UNSURE` and a
   planning premise pick included.
4. We will read a GitHub status or check in `error` as a check that could not run, and only `failure` as
   work that failed it.
5. We will ship every new check enforcing from its first release, with no record-only phase, no accuracy
   bar to pass first, and no built-in threshold that turns it off.

## Options considered

### Option A: Fail closed, enforce from the first release (chosen)

Nothing unchecked gets through; a new check inherits both rules.

### Option B: Go on and report `cannot verify`

P4 allows it. Rejected: the work goes through unchecked, and nothing later checks it.

### Option C: A record-only phase before a check enforces

Rejected: while a check only records, what fails it gets through.

### Option D: Enforce, with a built-in threshold

Rejected: the check turns itself off without anyone deciding that.

## Trade-offs

- A dependency that is down, or a new check on its first day, stops work that may be correct.
- A check that stops correct work is relaxed only by reviewer's modes (reviewer ADR-0006) or a
  release.

## Consequences

- Easier: a new check chooses nothing; a reader can tell a check that failed from work that failed it.
- Harder: every check needs, on the day it ships, a way past it that can succeed.
- **How we would know this was wrong:** work stalls on checks that could not run more often than checks
  find anything, or a new check is loosened soon after release more than once.
- Revisit if: the platform lets a hook refuse on its own timeout or crash.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
