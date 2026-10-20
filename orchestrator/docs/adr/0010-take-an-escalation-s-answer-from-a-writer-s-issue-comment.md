---
schemaVersion: 0.2.0
id: "0010"
title: "Take an escalation's answer from a writer's issue comment"
status: draft
date: 2026-10-19
deciders: []
tags: [orchestrator, escalation, holds, issue-comments, trust]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0002"]
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0023-give-every-hold-one-id-and-one-release-the-launch-after-ready-or-unlock-id.md"
    label: "reviewer ADR-0023: Give every hold one id and one release: the launch after Ready, or `unlock <id>`"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0026-resolve-unread-every-thread-whose-latest-author-is-not-a-trusted-reviewer.md"
    label: "reviewer ADR-0026: Resolve unread every thread whose latest author is not a trusted reviewer"
---

# ADR-0010: Take an escalation's answer from a writer's issue comment

## Context

An escalation hold keeps the card Blocked until a human answers the round's question (reviewer
ADR-0023). The orchestrator must know
when the answer is in, yet it parses no prose and reads no plugin config (ADR-0001).

Whose comment counts is a trust choice: some repos the orchestrator serves are public, so anyone can
comment.

## Decision

1. We will have the orchestrator post the hold's question as an issue comment when an escalation hold
   moves the card to Blocked, keyed to the hold instance (id, since).
2. We will take as the answer an issue comment created after that question by a User other than the
   bot whose author_association is OWNER, MEMBER or COLLABORATOR.
3. We will have reviewer carry the answer into the next round's briefs.

## Options considered

### Option A: A writer's comment on the issue (chosen)

Write permission is GitHub's own fact on the comment.

### Option B: Any author except Analitiq-Bot

Rejected: on a public repo a stranger's comment would count as the
answer and reach the next round's briefs.

### Option C: Only an author in `trusted_reviewers`

Rejected: trust has one owner, reviewer; the orchestrator reads no plugin
config.

## Trade-offs

- Who may answer and who is trusted differ: a collaborator outside `trusted_reviewers` can answer an
  escalation, yet a thread they last commented on is resolved unread (reviewer ADR-0026).
- The orchestrator checks that a writer commented after the question, not what was written.

## Consequences

- Easier: no list to keep.
- Harder: an answer is a new comment after the question; an edited earlier comment does not count.
- **How we would know this was wrong:** an escalation released by a writer's comment that did not
  answer it, or write permission reaching people who should not answer.
- Revisit if: GitHub stops recording the author's association, or the orchestrator comes to read
  reviewer's config.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
