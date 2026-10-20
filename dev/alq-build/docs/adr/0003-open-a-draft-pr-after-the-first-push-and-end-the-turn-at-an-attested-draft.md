---
schemaVersion: 0.2.0
id: "0003"
title: "Open a draft PR after the first push and end the turn at an attested draft"
status: draft
date: 2026-10-19
deciders: []
tags: [draft-pr, turn-end, relaunch, orchestrator, issue-tackle]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002"]
affects:
  - type: path
    pattern: "plugins/alq-build/skills/issue-tackle/**"
  - type: path
    pattern: "plugins/alq-build/scripts/next_story.py"
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
    label: "ALQ plugins target design: rewrite the decision records of alq-review, alq-plan and alq-build"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0004-drive-the-issue-loop-with-a-deterministic-orchestrator-outside-the-plugins.md"
    label: "org ADR-0004: Drive the issue loop with a deterministic orchestrator outside the plugins"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0010-mark-a-story-pr-ready-on-the-attestation-alone-in-review-once-green-with-no-find.md"
    label: "org ADR-0010: Mark a story PR ready on the attestation alone; In review once green with no findings"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0021-record-rounds-and-holds-in-a-pr-body-section-the-gate-alone-writes.md"
    label: "alq-review ADR-0021: Record rounds and holds in a PR body section the gate alone writes"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0022-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md"
    label: "alq-review ADR-0022: Refuse from any agent session every GitHub write the orchestrator or a human owns"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0026-resolve-unread-every-thread-whose-latest-author-is-not-a-trusted-reviewer.md"
    label: "alq-review ADR-0026: Resolve unread every thread whose latest author is not a trusted reviewer"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0011-request-codex-by-the-orchestrator-s-comment-once-per-head-automatic-review-off.md"
    label: "org ADR-0011: Request Codex by the orchestrator's comment once per head, automatic review off"
---

# ADR-0003: Open a draft PR after the first push and end the turn at an attested draft

## Context

Under org ADR-0004 the orchestrator drives the GitHub loop; the plugin owns the other half: where a
build turn ends, and which GitHub moves it never makes. The brainstorm gave alq-build the flip; today the session polls the reviewers and re-requests Codex.

## Decision

1. We will open the story PR as a draft after the first push, and a new one on the same branch after a
   PR closed unmerged; alq-build writes its description once, at creation (alq-review ADR-0021). Ticks in tasks.md land in
   ordinary commits in the story PR.
2. We will end the turn at an attested draft, or at a stop with a message: a pre-PR stop, or the folder stop of ADR-0002, Decision 3. alq-build polls
   nothing and makes none of the GitHub moves alq-review ADR-0022 refuses; the orchestrator relaunches
   it.
3. We will resume a relaunch from the open story PR (ADR-0002, Decision 2): findings open a github round (alq-review
   ADR-0026), an unattested head resumes the internal loop at the current head.

## Options considered

### Option A: Draft at first push, turn ends attested, the orchestrator relaunches (chosen)

The session never waits for GitHub.

### Option B: alq-build marks the PR ready and writes In review (the brainstorm)

Rejected: the orchestrator flips the PR and moves the card; no plugin writes a lane, and the
hook refuses one from an agent session. A pre-PR stop likewise ends with a message and the orchestrator
moves the card (the 2026-10-18 redraw: no plugin writes Blocked).

### Option C: alq-build polls the reviewers and re-requests Codex (today's loop)

Rejected (brainstorm): a session cannot wait for CI, and the re-request is due only after it; the
orchestrator makes it (org ADR-0011).

### Option D: A tasks.md tick gates something

Rejected: a tick is the agent's own checkbox and gates nothing; the round grades the
diff against the spec, and the next launch's stop catches a forgotten tick.

## Trade-offs

- The loop waits for the orchestrator's next tick: no flip, Codex request or relaunch comes before it.
- A session that pushes and ends before attesting costs a relaunch; REPEAT sends a launch that changes
  nothing to Blocked.

## Consequences

- Easier: the session holds no loop state; a crash costs nothing GitHub holds.
- Harder: a pre-PR stop reaches a human only through the orchestrator's Blocked reason.
- **How we would know this was wrong:** attested drafts stall waiting on the orchestrator's tick, or relaunches end in REPEAT because a fresh session could not re-derive from GitHub
  what the last one knew.
- Revisit if: a plugin can wait for CI, or the orchestrator stops driving the loop.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
