---
schemaVersion: 0.2.0
id: "0003"
title: "Open a draft PR after the first push and end the turn at an attested draft"
status: draft
date: 2026-10-20
deciders: []
tags: [draft-pr, turn-end, stop-hook, orchestrator, issue-tackle, closes]
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

builder runs in one session with the orchestrator and reviewer (root ADR-0008). The orchestrator's hooks drive
the GitHub loop there (orchestrator ADR-0001): at each turn's end its Stop hook reads GitHub and names the
next step or lets the session stop. builder owns the other half: what a build turn writes when it opens
the PR, where the turn ends, and which GitHub moves it never makes. Each of a story's steps has to know what
the last one left.

## Decision

1. We will open the story PR as a draft after the first push, and a new one on the same branch after a
   PR closed unmerged. builder writes its description once, at creation, with `Closes #s` for the story
   issue, so the merge closes it.
2. We will end the turn at an attested draft, or at a stop with a message naming why: a pre-PR stop, or the
   folder or lane stop of ADR-0002. The Stop hook then names the next step in this session or lets it stop
   (orchestrator ADR-0001).
3. We will begin every step the orchestrator's Stop hook names (orchestrator ADR-0001) from the story's
   PR (ADR-0002), its comments, findings and head's attestation, and the story issue's task ticks
   (planner ADR-0008), never the session's memory: findings open a github round (reviewer ADR-0016), an
   unattested head resumes the internal loop at the current head, and the ticks say which tasks are done.

## Options considered

### Option A: Draft at first push, turn ends attested, the Stop hook continues (chosen)

### Option B: builder marks the PR ready and writes In review

Rejected: the orchestrator's hooks flip the PR and move the card; the model writes no lane (orchestrator
ADR-0002).

### Option C: builder polls the reviewers and re-requests external reviews

Rejected: the orchestrator's hooks decide every wait and request external reviews (orchestrator
ADR-0008).

### Option D: A tasks.md tick gates something

Rejected: the round grades the diff against the spec, and root ADR-0005 decides when a story is done.

### Option E: `Closes #s` written later, on the last story's PR only

Rejected: every story PR closes its own issue.

## Trade-offs

- The next step waits for the turn to end.
- A turn that pushes and ends before attesting costs a continuation; REPEAT, or two unattested ends in a
  row, moves the story to Blocked (orchestrator ADR-0001).
- Context carried between steps may be stale; decision 3 re-reads GitHub.

## Consequences

- Easier: builder holds no loop state; what outlives a turn is on GitHub (orchestrator ADR-0003).
- Harder: a pre-PR stop reaches a human only through the orchestrator's Blocked reason.
- **How we would know this was wrong:** attested drafts the Stop hook leaves stalled, or REPEAT because a
  step could not re-derive from GitHub what the last one knew.
- Revisit if: the orchestrator's hooks stop driving the loop, or builder runs outside the agent
  environment.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
