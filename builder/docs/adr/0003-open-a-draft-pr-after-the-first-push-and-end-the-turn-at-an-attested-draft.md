---
schemaVersion: 0.2.0
id: "0003"
title: "Open a draft PR after the first push and end the turn at an attested draft"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
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
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:56Z
---

# ADR-0003: Open a draft PR after the first push and end the turn at an attested draft

## Context

builder runs in one session with the orchestrator and reviewer (root ADR-0008). The orchestrator's hooks drive
the GitHub loop there (orchestrator ADR-0001): at each turn's end its Stop hook reads GitHub and names the
next step or lets the session stop. This record decides when the story PR opens and what it says, which the
orchestrator's hooks carry out, where builder's turn ends, and which GitHub moves builder never makes. The
model's token writes nothing on GitHub (root ADR-0007). Each of a story's steps has to know what the last one
left.

## Decision

1. We will have the story PR open as a draft after the first push, and a new one on the same branch
   after a PR closed unmerged; the orchestrator's hooks push builder's commits and open it (orchestrator
   ADR-0001). Its description, which the squash merge takes as its message (orchestrator ADR-0009),
   carries `Closes #s` for the story issue from creation, so the merge closes it.
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
- A turn that ends at a pushed, unattested head costs another turn; REPEAT, or two unattested ends in a row,
  moves the story to Blocked (orchestrator ADR-0001).
- Context carried between steps may be stale; decision 3 re-reads GitHub.

## Consequences

- Easier: builder holds no loop state; what outlives a turn is on GitHub (orchestrator ADR-0003).
- Harder: a pre-PR stop reaches an admin only through the orchestrator's Blocked reason.
- **How we would know this was wrong:** attested drafts the Stop hook leaves stalled, or REPEAT because a
  step could not re-derive from GitHub what the last one knew.
- Revisit if: the orchestrator's hooks stop driving the loop, or builder runs outside the agent machine.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
