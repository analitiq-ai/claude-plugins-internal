---
schemaVersion: 0.2.0
id: "0003"
title: "Open a draft PR after the first push and end the turn at an attested draft"
status: draft
date: 2026-10-20
deciders: []
tags: [draft-pr, turn-end, relaunch, orchestrator, issue-tackle, closes]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0004"]
affects:
  - type: path
    pattern: "builder/plugin/skills/issue-tackle/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0003: Open a draft PR after the first push and end the turn at an attested draft

## Context

Under orchestrator ADR-0001 the orchestrator drives the GitHub loop. The plugin owns the other half: what a
build turn writes when it opens the PR, where the turn ends, and which GitHub moves it never makes. A story
spans several launches, and each relaunch has to know what the last one left.

## Decision

1. We will open the story PR as a draft after the first push, and a new one on the same branch after a
   PR closed unmerged. builder writes its description once, at creation, with `Closes #s` for the story
   issue, so the merge closes it.
2. We will end the turn at an attested draft, or at a stop with a message naming why: a pre-PR stop, or the
   folder or lane stop of ADR-0002. The orchestrator relaunches it (orchestrator ADR-0001).
3. We will resume a relaunch from the story's PR (ADR-0002): findings open a github round
   (reviewer ADR-0016), an unattested head resumes the internal loop at the current head, and the ticks in
   the story's task block (planner ADR-0008) say which of its tasks are done.

## Options considered

### Option A: Draft at first push, turn ends attested, the orchestrator relaunches (chosen)

### Option B: builder marks the PR ready and writes In review

Rejected: the orchestrator flips the PR and moves the card; no plugin writes a lane (orchestrator
ADR-0002).

### Option C: builder polls the reviewers and re-requests Codex

Rejected: no plugin polls (orchestrator ADR-0001); the orchestrator re-requests (orchestrator ADR-0008).

### Option D: A tasks.md tick gates something

Rejected: the round grades the diff against the spec, and root ADR-0005 decides when a story is done.

### Option E: `Closes #s` written later, on the last story's PR only

Rejected: every story PR closes its own issue.

## Trade-offs

- The loop waits for the orchestrator's next tick: no flip, Codex request or relaunch comes before it.
- A session that pushes and ends before attesting costs a relaunch; REPEAT sends a launch that changes
  nothing to Blocked.

## Consequences

- Easier: the session never waits for GitHub and holds no loop state.
- Harder: a pre-PR stop reaches a human only through the orchestrator's Blocked reason.
- **How we would know this was wrong:** attested drafts stall waiting on the orchestrator's tick, or
  relaunches end in REPEAT because a fresh session could not re-derive from GitHub what the last one knew.
- Revisit if: a plugin can wait for CI, or the orchestrator stops driving the loop.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
