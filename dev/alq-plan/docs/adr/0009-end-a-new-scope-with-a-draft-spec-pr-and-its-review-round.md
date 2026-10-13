---
schemaVersion: 0.1.0
id: "0009"
title: "End a new scope with a draft spec PR and its review round"
status: draft
date: 2026-10-12
deciders: []
tags: [spec, pull-request, review-round, skills]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0007", "0008"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: issue
    id: "79"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
    label: "alq-plan: name spec folders by their issue, land the spec through its own reviewed PR"
  - type: doc
    id: "engineering ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "The spec lands first as its own PR on <issue>-spec"
---

# ADR-0009: End a new scope with a draft spec PR and its review round

## Context

A completed run of `/alq-plan:issue-spec` commits the spec folder, pushes the branch, and ends with the folder and
the branch. It posts nothing and names no command of another plugin, so it runs with nothing but alq-plan installed
(ADR-0005, decision 3). No PR is opened and no review runs: a spec reaches code without anyone having agreed to it.

The organisation lands the spec first, through its own PR on branch `<issue>-spec` (engineering ADR-0002,
decision 3; `docs/engineering/git-workflow.md`). That rule leaves open who opens the PR and who starts its review.

Why now: issue #79, part of #80.

## Decision

We will have a completed new scope, a no-spec folder (ADR-0008) included, open a draft PR for its branch into the
default branch and launch the review loops itself: `alq-review:review-round` with `spec: null` first, then the
GitHub review loop. Branch, worktree and PR body follow the organisation's git workflow.

This supersedes ADR-0005, decision 3, in what a completed run does: the skill now runs a command of another plugin,
and needs alq-review installed to finish. It still posts nothing on the issue. A rescope is not a new scope: it
edits the spec in the worktree it is run from, so the edit lands in that worktree's PR, and it opens no PR and
launches no review.

## Options considered

### Option A: The skill opens the PR and launches the review (chosen)

| Dimension | Assessment |
|---|---|
| End of a new scope | A draft PR, with the internal round launched |
| Who starts the review | The skill |
| Needs alq-review | Yes |

### Option B: Keep ADR-0005, decision 3

The run ends on a pushed branch, and whoever builds opens the PR. Rejected: the spec is never reviewed as a spec,
which is the gap.

### Option C: The skill opens the PR; the user launches the review

Keeps alq-plan free of alq-review. Rejected: a spec PR left unreviewed is the same gap, one step later.

## Trade-offs

- alq-plan depends on alq-review to finish a new scope. Without it, the skill stops after the PR and says so.
- A new scope takes longer and writes to GitHub.
- A spec PR is not a user story, so review reads it with `spec: null`, as a change with no spec (alq-review
  ADR-0016).

## Consequences

- Easier: a spec reaches code only through a PR that review has seen.
- Harder: alq-plan no longer runs alone.
- **How we would know this was wrong:** spec PRs merged with no review round; or users who skip the skill to avoid
  the round.
- Revisit if: review rounds can run before a PR exists (#70), or the organisation lands specs another way.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
