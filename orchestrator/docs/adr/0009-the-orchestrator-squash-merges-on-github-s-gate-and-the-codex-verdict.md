---
schemaVersion: 0.2.0
id: "0009"
title: "The orchestrator squash-merges on GitHub's gate and the Codex verdict"
status: draft
date: 2026-10-20
deciders: []
tags: [orchestrator, merge, ruleset, github, pull-requests]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0002", "0004", "0007", "0008"]
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
---

# ADR-0009: The orchestrator squash-merges on GitHub's gate and the Codex verdict

## Context

Once a story's card is In review, something must merge its PR and hold the merge condition. The
model's token can call GitHub's merge endpoint (root ADR-0007).

## Decision

1. We will have the orchestrator squash-merge an In review card's PR, passing no message, between turns,
   once no hold is open on its story issue (reviewer ADR-0013), Codex's verdict at the head is
   success and GitHub allows the merge, naming the head it evaluated, so a push in between fails.
2. We will make GitHub's rulesets the merge contract and the only source of required checks, with no
   classic branch protection: they require `internal-review` and `codex-review`, pinned to the
   orchestrator's App (ADR-0004, ADR-0008), every other required check, pinned to the App that posts
   it, and every conversation resolved, so GitHub refuses a merge without them. Their bypass list names
   humans only, the only override.
3. We will never update a branch that is only behind main; a conflict stays a finding.
4. We will leave Done to GitHub (ADR-0002): each story PR carries `Closes #s` from its creation (builder
   ADR-0003), so its merge closes the story issue. The orchestrator closes a parent issue once every
   sub-issue is done (root ADR-0005), its only issue-close write.
5. We will leave a PR refused on a rule outside this contract In review.
6. We will require of every served repo: squash merging with the default squash message set to
   "commit messages", so every session-id trailer reaches main; head branches deleted on merge; no
   required human approval; no up-to-date rule; board workflows auto-add issues to Backlog, auto-add
   sub-issues, item closed to Done and Done to close the issue on, PR-linked, PR-merged and reopen off.

## Options considered

### Option A: The orchestrator merges on GitHub's gate and the verdict (chosen)

A repo without the ruleset never merges unreviewed, since the orchestrator requires the verdict itself.

### Option B: GitHub auto-merge, never disarmed

Rejected: it could merge while a card sat Blocked or a hold was open.

### Option C: Required human approval

Rejected: the attestation and the external verdicts are the merge condition.

### Option D: An up-to-date-branch rule or a stale-branch update

Rejected: conflicts are resolved, never staleness.

## Trade-offs

- A PR refused on a rule outside the contract stays In review silently.
- A branch behind main without conflicts merges as it is.

## Consequences

- Easier: one merge condition; a stop is a board move.
- Harder: every served repo needs decisions 2 and 6 first.
- **How we would know this was wrong:** a merge without `codex-review` success at its head or under an
  open hold; a squash commit on main missing a session-id trailer.
- Revisit if: a rule outside the contract becomes a routine blocker.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
