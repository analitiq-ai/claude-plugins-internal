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
2. We will take as the answer an issue comment created after that question by a writer: its author a
   `User` whose `role_name` on the repository, from GitHub's collaborator-permission endpoint, is admin,
   maintain or write. A comment an App posts as itself has the App as its author, which names no person,
   so it never counts, a codeworks App's included (root ADR-0007 d5). An admin who posts through an App
   acting for them is the comment's author, and counts. The model's token posts no comment. That comment,
   with a Ready move, releases the hold (reviewer ADR-0013).

## Options considered

### Option A: A writer's comment on the issue, by the author's repository role (chosen)

Write permission is GitHub's own fact about the author. The endpoint answers it to any token with
`metadata: read`. It is the same read that decides whether an admin's close made a story done (root ADR-0005 d5).

### Option B: Any author except a codeworks App

Rejected: on a public repo a stranger's comment would count as the
answer and reach the next round's briefs.

### Option C: Only an author in `trusted_reviewers`

Rejected: `trusted_reviewers` names whose review threads are findings (root ADR-0003); who may answer
a question is write permission, which GitHub answers for the author.

### Option D: The comment's `author_association` OWNER, MEMBER or COLLABORATOR

Rejected: GitHub computes the association for the reader, and hides a private org membership from an App's
token. On 2026-10-28, an org admin's comments read as CONTRIBUTOR to all three codeworks Apps, so no answer
ever counted (PR #164, T044). It is also not write permission: MEMBER covers an org member who can only read.

## Trade-offs

- Who may answer and who is trusted differ: a collaborator outside `trusted_reviewers` can answer an
  escalation, yet a thread they start is resolved unread (ADR-0007).
- The orchestrator checks that a writer commented after the question, not what was written.
- Each read of the issue costs one more request per commenter.

## Consequences

- Easier: no list to keep.
- Harder: an answer is a new comment after the question; an edited earlier comment does not count.
- **How we would know this was wrong:** an escalation released by a writer's comment that did not
  answer it, or write permission reaching people who should not answer.
- Revisit if: GitHub stops answering a user's repository role to an App's token.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
