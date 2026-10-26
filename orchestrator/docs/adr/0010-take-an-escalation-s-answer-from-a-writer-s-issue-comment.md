---
schemaVersion: 0.2.0
id: "0010"
title: "Take an escalation's answer from a writer's issue comment"
status: draft
date: 2026-10-20
deciders: []
tags: [orchestrator, escalation, holds, issue-comments, trust]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0002", "0007"]
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

# ADR-0010: Take an escalation's answer from a writer's issue comment

## Context

An escalation hold, `escalation-<s>` in reviewer's state comment on the story issue, keeps the card
Blocked until a writer answers the round's question (reviewer ADR-0013). The orchestrator must know when
the answer is in, yet it parses no prose (ADR-0001).

Whose comment counts is a trust choice: some repos the orchestrator serves are public, so anyone can
comment.

## Decision

1. We will have the orchestrator post the hold's question as an issue comment, with its App, while an
   escalation hold is open, in any lane (ADR-0002), keyed to the hold instance (id, since).
2. We will take as the answer an issue comment created after that question by a writer
   (author_association OWNER, MEMBER or COLLABORATOR) other than a codeworks App (root ADR-0007); the
   model's token posts no comment. That comment, with the human's Ready, releases the hold (reviewer
   ADR-0013).

## Options considered

### Option A: A writer's comment on the issue (chosen)

Write permission is GitHub's own fact on the comment.

### Option B: Any author except a codeworks App

Rejected: on a public repo a stranger's comment would count as the
answer and reach the next round's briefs.

### Option C: Only an author in `trusted_reviewers`

Rejected: `trusted_reviewers` names whose review threads are findings (root ADR-0003); who may answer
a question is write permission, which GitHub records on the comment.

## Trade-offs

- Who may answer and who is trusted differ: a collaborator outside `trusted_reviewers` can answer an
  escalation, yet a thread they start is resolved unread (ADR-0007).
- The orchestrator checks that a writer commented after the question, not what was written.

## Consequences

- Easier: no list to keep.
- Harder: an answer is a new comment after the question; an edited earlier comment does not count.
- **How we would know this was wrong:** an escalation released by a writer's comment that did not
  answer it, or write permission reaching people who should not answer.
- Revisit if: GitHub stops recording the author's association.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
