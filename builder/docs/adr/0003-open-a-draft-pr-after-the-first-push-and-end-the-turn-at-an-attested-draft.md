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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0001-drive-the-issue-loop-with-a-deterministic-orchestrator-outside-the-plugins.md"
    label: "orchestrator ADR-0001: Drive the issue loop with a deterministic orchestrator outside the plugins"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md"
    label: "orchestrator ADR-0002: The orchestrator alone writes the working lanes, derived from the PR"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0007-mark-a-story-pr-ready-on-the-attestation-alone-in-review-once-green-with-no-find.md"
    label: "orchestrator ADR-0007: Mark a story PR ready on the attestation alone; In review once green with no findings"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0011-record-rounds-and-holds-in-tagged-issue-comments-through-core-the-newest-by-the.md"
    label: "reviewer ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the bot wins"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0012-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md"
    label: "reviewer ADR-0012: Refuse from any agent session every GitHub write the orchestrator or a human owns"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0016-resolve-unread-every-thread-whose-latest-author-is-not-a-trusted-reviewer.md"
    label: "reviewer ADR-0016: Resolve unread every thread whose latest author is not a trusted reviewer"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0008-request-codex-by-the-orchestrator-s-comment-once-per-head-automatic-review-off.md"
    label: "orchestrator ADR-0008: Request Codex by the orchestrator's comment once per head, automatic review off"
---

# ADR-0003: Open a draft PR after the first push and end the turn at an attested draft

## Context

Under orchestrator ADR-0001 the orchestrator drives the GitHub loop. The plugin owns the other half: what a
build turn writes when it opens the PR, where the turn ends, and which GitHub moves it never makes. A story
spans several launches, and each relaunch has to know what the last one left.

## Decision

1. We will open the story PR as a draft after the first push, and a new one on the same branch after a
   PR closed unmerged. builder writes its description once, at creation, with `Closes #s` for the story
   issue, so the merge closes it. Ticks in the tasks.md block labelled with the story's issue number
   (planner ADR-0008) land in ordinary commits in the story PR.
2. We will end the turn at an attested draft, or at a stop with a message naming why: a pre-PR stop, or the
   folder or lane stop of ADR-0002. A launch that opens no PR goes to Blocked with its final message as the
   reason (orchestrator ADR-0002). A card moved to Backlog or Blocked ends the turn (reviewer ADR-0015).
   builder polls nothing and makes none of the GitHub moves reviewer ADR-0012 refuses; the orchestrator
   relaunches it.
3. We will resume a relaunch from the story's PR (ADR-0002): findings open a github round
   (reviewer ADR-0016), an unattested head resumes the internal loop at the current head, and the ticks say
   which of the story's tasks are done.

## Options considered

### Option A: Draft at first push, turn ends attested, the orchestrator relaunches (chosen)

### Option B: builder marks the PR ready and writes In review

Rejected: the orchestrator flips the PR and moves the card; no plugin writes a lane, and the hook refuses
one from an agent session.

### Option C: builder polls the reviewers and re-requests Codex

Rejected: a session cannot wait for CI; the orchestrator re-requests (orchestrator ADR-0008).

### Option D: A tasks.md tick gates something

Rejected: the round grades the diff against the spec, and a closed story issue marks the story done.

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
