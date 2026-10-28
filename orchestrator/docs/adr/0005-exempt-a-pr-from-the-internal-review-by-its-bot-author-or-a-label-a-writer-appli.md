---
schemaVersion: 0.2.0
id: "0005"
title: "Exempt a PR from the internal review by its Bot author or a label a writer applied"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [review, exemption, labels, pull-requests, trust]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0004", "0006"]
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

# ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied

## Context

Spec, revert, retire-spec and release PRs, and PRs that other Apps open, are not story PRs and get no
builder turn, yet the ruleset requires `internal-review` (ADR-0004), so who may waive it is a trust
decision.

## Decision

1. We will exempt a PR whose author is a GitHub App other than a codeworks App (root ADR-0007) and
   which changes no path ADR-0004 protects, or which carries a label from `exempt_labels` applied
   after the head's push by an account with write permission other than a codeworks App. The
   orchestrator's App opens every story PR and planner's App every spec PR, so neither authorship
   exempts. A push after
   the label voids it until it is labelled again. `exempt_labels` is a key of the orchestrator's
   section of `codeworks.toml` (root ADR-0002).
2. We will have the orchestrator alone decide EXEMPT and write `internal-review` "exempt"; reviewer and
   every other component read that check, never the list.
3. We will name no builder step on an exempt PR. An exempt story PR's card goes to Blocked, the reason
   "exempt: an admin merges", adding "push a fix" when it has findings; a push after the label sends it
   to Blocked naming the re-label.
4. We will make exemption the only way a PR to main goes without the internal review: spec, revert,
   retire-spec and release PRs are labelled or Bot-authored; no branch-name kinds, no list of exempt
   diff shapes. A spec PR's label is its approval.
5. We will let any writer but a codeworks App create or apply an exempt label. The model's token
   cannot write a label (root ADR-0007), and reviewer's hook refuses the attempt (reviewer ADR-0012).

## Options considered

### Option A: Bot author, or a listed label from any writer but a codeworks App (chosen)

Covers spec PRs, retire-spec, reverts and releases; the labeled event's sender is GitHub's own evidence.

### Option B: Exempt kinds named in a record

Rejected: every new kind needs a record; the label is the general exemption.

### Option C: Branch-name kinds for tooling branches

Rejected: the label or a Bot author exempts the PR, so a branch name does no work.

### Option D: Each component reads `exempt_labels` and decides EXEMPT itself

Rejected: two readers of one list can disagree; the check is the one answer.

### Option E: Exempt every PR another App authored, codeworks Apps included

Rejected: every story PR and spec PR would reach main with no round and no admin's label.

## Trade-offs

- A writer creates the label in each repo and applies it to each exempt PR no Bot opened.
- A Bot author exempts with no admin act: its PRs reach main without a round.

## Consequences

- Easier: a new exempt kind costs a label, not a record.
- Harder: the label exempts any PR a writer puts it on, a story PR included, on that writer's
  judgment; every push after it needs a new label.
- **How we would know this was wrong:** PRs attested "exempt" that needed a round: a labelled story PR,
  or a Bot-authored PR carrying code.
- Revisit if: GitHub stops carrying the sender or time on the labeled event.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
