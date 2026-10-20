---
schemaVersion: 0.2.0
id: "0009"
title: "The orchestrator squash-merges on GitHub's gate and the Codex verdict"
status: draft
date: 2026-10-19
deciders: []
tags: [orchestrator, merge, ruleset, github, pull-requests]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0002", "0004", "0008"]
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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner, builder and orchestrator"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one PR per user story; only the last PR closes the issue"
---

# ADR-0009: The orchestrator squash-merges on GitHub's gate and the Codex verdict

## Context

Once a story's card is In review, something must merge its PR and hold the merge condition: the
plugin's pre-merge gate, as today; GitHub's auto-merge; or the orchestrator. The design reversed the choice
twice: the orchestrator's merge, then auto-merge never disarmed, then the orchestrator
again.

## Decision

1. We will have the orchestrator squash-merge an In review card's PR once no launch is running, Codex's
   verdict at the head is success and GitHub allows the merge, naming the head it evaluated so a push
   in between fails the call.
2. We will make GitHub's ruleset the merge contract: `internal-review` from the orchestrator's App
   (ADR-0004) and `codex-review` from the pr-gate App (ADR-0008), required checks and thread resolution;
   DeepSource's grade a report, not a gate, its policy kept in DeepSource settings.
3. We will never update a branch that is only behind main; a conflict stays a finding.
4. We will leave Done to GitHub (ADR-0002): the last story's `Closes #n` (org ADR-0003) closes the issue on
   merge.
5. We will leave a PR refused on a rule outside this contract In review.

## Options considered

### Option A: The orchestrator merges on GitHub's gate and the verdict (chosen)

A repo without the ruleset never merges unreviewed, since the orchestrator requires the verdict itself.

### Option B: GitHub auto-merge, never disarmed

Rejected: it could merge while a card sat Blocked, and needed its own event reads and a repo setting.

### Option C: The plugin's pre-merge gate re-checks GitHub's rules; `deepsource-pr-gate.sh` scrapes DeepSource's grade (today)

Rejected: GitHub owns the checks.

### Option D: Required human approval

Rejected: the attestation and the external verdicts are the merge condition.

### Option E: An up-to-date-branch rule or a stale-branch update

Rejected: conflicts are resolved, never staleness.

### Option F: A catch-all Blocked exit

Rejected as out of scope.

## Trade-offs

- A PR refused on a rule outside the contract stays In review silently.
- A branch behind main without conflicts merges as it is.

## Consequences

- Easier: one merge condition, read from the card, the launch lock and the PR's head; a stop is a board move.
- Harder: every served repo needs the ruleset and squash merging first.
- **How we would know this was wrong:** the orchestrator merged a PR without `codex-review` success at
  its head, or merged while the card sat Blocked.
- Revisit if: a rule outside the contract becomes a routine blocker, or the Codex verdict stops arriving
  as the pr-gate App's status (ADR-0008).

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
