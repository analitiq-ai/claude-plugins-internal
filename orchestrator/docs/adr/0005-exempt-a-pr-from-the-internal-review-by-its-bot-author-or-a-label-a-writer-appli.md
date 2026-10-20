---
schemaVersion: 0.2.0
id: "0005"
title: "Exempt a PR from the internal review by its Bot author or a label a writer applied"
status: draft
date: 2026-10-19
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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner, builder and orchestrator"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0025-fence-a-session-s-commits-on-its-issue-s-story-branch-not-on-the-branch-name.md"
    label: "reviewer ADR-0025: Fence a session's commits on its issue's story branch, not on the branch name"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0003-guard-commits-leave-the-rules-of-a-pr-to-github-and-read-the-org-gate-s-verdict.md"
    label: "reviewer ADR-0003: Guard commits, leave the rules of a PR to GitHub and read the org gate's verdict from its check run"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0022-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md"
    label: "reviewer ADR-0022: Refuse from any agent session every GitHub write the orchestrator or a human owns"
---

# ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied

## Context

ADR, revert, retire-spec and release PRs, and PRs that Bot accounts open, are not story PRs and get no
launch, yet the ruleset requires `internal-review` (ADR-0004), so who may waive it is a trust decision.
reviewer ADR-0003 decision 2 listed the exempt kinds in a record (one, a version-only release); this
record replaces that list.

## Decision

1. We will exempt a PR whose author is of GitHub type Bot, or which carries a label from the configured
   `exempt_labels` whose labeled event's sender is a User other than the bot with write permission.
2. We will have the orchestrator never launch on an exempt PR.
3. We will make exemption the only way a PR to main goes without the internal review: ADR, revert,
   retire-spec and release PRs are labelled or Bot-authored; no branch-name kinds, no list of exempt
   diff shapes.
4. We will let only a human create or apply an exempt label; the hook refuses a label write from any
   agent session (reviewer ADR-0022).

## Options considered

### Option A: Bot author, or a writer-applied label from a configured list (chosen)

Covers retire-spec, reverts and releases; the labeled event's sender is GitHub's own evidence.

### Option B: Exempt kinds named in a record

reviewer ADR-0003, decision 2: a version-only release is exempt, and the user switches the plugin off
for any other PR that should go without it. Rejected: every new kind needed a record; the label
is the general exemption.

### Option C: Branch-name kinds for tooling branches

Rejected: a session with no recorded issue commits freely on any branch (reviewer
ADR-0025), and the label or a Bot author exempts its PR, so a branch name does no work.

### Option D: The pr-gate App sets "exempt" on the labeled event

Rejected: the orchestrator writes `internal-review` from GitHub state every tick; no
event trigger is needed.

## Trade-offs

- A human creates the label in each repo and applies it by hand to every exempt PR a Bot did not open.
- A Bot author exempts with no human act: its PRs reach main without a round.

## Consequences

- Easier: a new exempt kind costs a label, not a record.
- Harder: the label exempts any PR a writer puts it on, a story PR included, on that human's
  judgment; the bot's own PRs are never Bot-exempt, since its account is a User.
- **How we would know this was wrong:** PRs attested "exempt" that needed a round: a labelled story PR,
  or a Bot-authored PR carrying code.
- Revisit if: GitHub stops carrying the sender on the labeled event.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
