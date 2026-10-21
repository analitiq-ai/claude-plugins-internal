---
schemaVersion: 0.2.0
id: "0005"
title: "Exempt a PR from the internal review by its Bot author or a label a writer applied"
status: draft
date: 2026-10-20
deciders: []
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
review:
  tier: async
---

# ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied

## Context

Spec, revert, retire-spec and release PRs, and PRs that other Apps open, are not story PRs and get no
launch, yet the ruleset requires `internal-review` (ADR-0004), so who may waive it is a trust decision.

## Decision

1. We will exempt a PR whose author is a GitHub App other than the session App (root ADR-0007) and
   which changes no path ADR-0004 protects, or which carries a label from `exempt_labels` applied after the head's push by a User other than Analitiq-Bot
   with write permission. A push after the label voids it until a human labels again. `exempt_labels` is
   a key of the orchestrator's section of `codeworks.toml` (root ADR-0002).
2. We will have the orchestrator alone decide EXEMPT and write `internal-review` "exempt"; reviewer and
   every other component read that status, never the list.
3. We will never launch on an exempt PR. An exempt story PR's card goes to Blocked, the reason "exempt: a
   human merges", adding "push a fix" when it has findings; a push after the label sends it to Blocked
   naming the re-label.
4. We will make exemption the only way a PR to main goes without the internal review: spec, revert,
   retire-spec and release PRs are labelled or Bot-authored; no branch-name kinds, no list of exempt
   diff shapes. A spec PR's label is the human's approval of it (planner ADR-0010).
5. We will let only a human create or apply an exempt label; the hook refuses a label write from any
   agent session (reviewer ADR-0012).

## Options considered

### Option A: Bot author, or a writer-applied label from a configured list (chosen)

Covers spec PRs, retire-spec, reverts and releases; the labeled event's sender is GitHub's own evidence.

### Option B: Exempt kinds named in a record

Rejected: every new kind needs a record; the label is the general exemption.

### Option C: Branch-name kinds for tooling branches

Rejected: the label or a Bot author exempts the PR, so a branch name does no work.

### Option D: Each component reads `exempt_labels` and decides EXEMPT itself

Rejected: two readers of one list can disagree; the status is the one answer.

## Trade-offs

- A human creates the label in each repo and applies it by hand to every exempt PR a Bot did not open.
- A Bot author exempts with no human act: its PRs reach main without a round.

## Consequences

- Easier: a new exempt kind costs a label, not a record.
- Harder: the label exempts any PR a writer puts it on, a story PR included, on that human's
  judgment; every push after it needs a new label.
- **How we would know this was wrong:** PRs attested "exempt" that needed a round: a labelled story PR,
  or a Bot-authored PR carrying code.
- Revisit if: GitHub stops carrying the sender or time on the labeled event.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
