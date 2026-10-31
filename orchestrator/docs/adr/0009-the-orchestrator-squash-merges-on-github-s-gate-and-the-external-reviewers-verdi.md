---
schemaVersion: 0.2.0
id: "0009"
title: "The orchestrator squash-merges on GitHub's gate and the external reviewers' verdicts"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
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
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:49Z
---

# ADR-0009: The orchestrator squash-merges on GitHub's gate and the external reviewers' verdicts

## Context

Once a story's card is In review, something must merge its PR and hold the merge condition. The
model's token is read-only (root ADR-0007): only the orchestrator's App and the admins can merge.

## Decision

1. We will have the orchestrator squash-merge an In review card's PR, passing no message, between turns,
   once no hold is open on its story issue (reviewer ADR-0013), every module's verdict at the head is
   success and GitHub allows the merge, naming the head it evaluated, so a push in between fails.
2. We will make GitHub's rulesets the merge contract and the source of required checks, with no
   classic branch protection: they require the check runs `internal-review` and each module's
   `<module>-review`, pinned to the orchestrator's App (ADR-0004, ADR-0008), every other required check, pinned to the App that posts
   it, and every conversation resolved, so GitHub refuses a merge without them. Their bypass list names
   admins only, the only override. A repo whose GitHub plan offers no rulesets names its required checks in
   `required_checks` under `[orchestrator]` instead; the orchestrator then reads no rules, and its own merge
   condition (d1) is the only gate.
3. We will never update a branch only because it is behind main: a conflict stays a finding, and builder
   merges main only to resolve one or once main's spec, ADRs or constitution changed (builder ADR-0004).
4. We will leave Done to GitHub (ADR-0002): each story PR carries `Closes #s` from its creation by the
   orchestrator (builder ADR-0003), so its merge closes the story issue. The orchestrator closes a parent issue once every
   sub-issue is done (root ADR-0005), its only issue-close write.
5. We will leave a PR refused on a rule outside this contract In review.
6. We will require of every served repo: squash merging with the default commit title the PR title and
   the default message the PR body, which the orchestrator's hooks write: `Closes #s` at creation
   (builder ADR-0003), and each session's id trailer as that session first pushes, so no
   model-written commit message reaches main; head branches deleted on merge; no
   required admin approval; no up-to-date rule; board workflows auto-add issues to Backlog, auto-add
   sub-issues, item closed to Done and Done to close the issue on, PR-linked, PR-merged and reopen off.

## Options considered

### Option A: The orchestrator merges on GitHub's gate and the verdict (chosen)

A repo without the ruleset never merges unreviewed, since the orchestrator requires the verdict itself.

### Option B: GitHub auto-merge, never disarmed

Rejected: it could merge while a card sat Blocked or a hold was open.

### Option C: Required admin approval

Rejected: the attestation and the external verdicts are the merge condition.

### Option D: An up-to-date-branch rule or a stale-branch update

Rejected: a branch takes main for a conflict or a changed spec, ADR or constitution (builder ADR-0004),
never for staleness alone.

### Option E: A plan without rulesets read as no required checks

Rejected: a head would merge with no CI check read, and telling the plan apart from another refusal means
reading GitHub's error text (constitution P7).

## Trade-offs

- A PR refused on a rule outside the contract stays In review silently.
- A branch behind main without conflicts merges as it is, unless main's spec, ADRs or constitution changed
  since its round (ADR-0004).
- In a repo that lists `required_checks`, GitHub enforces nothing, and a listed check counts from whichever
  App posts it.

## Consequences

- Easier: one merge condition; a stop is a board move.
- Harder: every served repo needs decision 2's ruleset, or its `required_checks`, and decision 6 first.
- **How we would know this was wrong:** a merge without every `<module>-review` success at its head
  or under an open hold; a squash commit on main missing a session-id trailer.
- Revisit if: a rule outside the contract becomes a routine blocker.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
