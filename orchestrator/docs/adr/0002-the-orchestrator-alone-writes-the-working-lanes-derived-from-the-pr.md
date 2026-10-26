---
schemaVersion: 0.2.0
id: "0002"
title: "The orchestrator alone writes the working lanes, derived from the PR"
status: draft
date: 2026-10-20
deciders: []
tags: [board, lanes, orchestrator, github-projects, workflow]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0006", "0007", "0009", "0010"]
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

# ADR-0002: The orchestrator alone writes the working lanes, derived from the PR

## Context

Humans and the orchestrator share the board; the orchestrator never checks who moved a card.

## Decision

1. We will keep six lanes on the Project status field, issues as cards, each with at most one automated
   writer: GitHub for Backlog and Done; the orchestrator for In progress, In review and Blocked; none for
   Ready, a human's alone. The model's token cannot write a lane (root ADR-0007), and planner writes none
   (planner ADR-0005).
2. We will claim a story only on the prompt that names it (ADR-0001): the orchestrator's App moves its card
   from Ready to In progress and records it as the session's issue (reviewer ADR-0015). It re-derives a
   claimed card's In progress and In review from the story's PR at every hook run.
3. We will start a story only from Ready (root ADR-0006), once every issue in its `blockedBy` is done
   (root ADR-0005) and the spec-PR rule allows it (ADR-0006); a merge starts nothing. The start releases
   holds as reviewer ADR-0013 decides; an open hold that no human comment newer than it answers stops the
   start, with or without an open PR, sending the card back to Blocked with no new comment. A prompt
   naming a card these rules refuse claims nothing; the refusal names the reason. A Ready card whose PR
   closed unmerged restarts on its branch.
4. We will never start a parent issue (one with sub-issues): named from Ready, it goes to Blocked, naming
   the sub-issues to name instead; its other lanes are the human's.
5. We will make Blocked the one sink for what needs a human, each cause decided in its own record
   (ADR-0001, ADR-0004 to ADR-0010). This record's causes: a turn that opened no PR, or a PR closed
   unmerged (reason: that turn's final message); an In review PR whose `<module>-review` failed with no
   findings and no hold (reason: dismiss and re-request, or bypass merge). The reason is posted first;
   the lane write is the commit point; these moves fall between turns. At every hook run, the
   orchestrator posts any missing keyed reason for every open hold, in any lane. A failure that belongs
   to no story, such as a key that mints no token or a session ended without its hooks (ADR-0001), is
   posted on the board's status issue, whose card goes to Blocked.
6. We will read a human's drag to Backlog, Blocked or Done as a stop: no further step is named, nothing
   merges. A drag into a working lane starts nothing; a claimed card dragged there is re-derived (d2), or
   bounced to Blocked under an open hold.
7. We will start nothing on a done story (root ADR-0005).

## Options considered

### Option A: One automated writer per lane (chosen)

No move needs a check of its author.

### Option B: The model writes lanes

Lost: the model would move the card it is graded on.

### Option C: Start the next story without Ready after a merge

Lost: `blockedBy` carries the order.

### Option D: The claim as the story issue's assignee

Rejected: the account that held the claim, Analitiq-Bot, left the loop on 2026-10-24, and the person
names the issue a session claims.

## Trade-offs

- A Ready card waits for a person to name it; a prompt naming one held by a blocker is refused.

## Consequences

- Easier: a restart needs no lane state.
- Harder: a parent's lanes are kept by hand.
- **How we would know this was wrong:** a story started before its blockers were done, or after it was
  done.
- Revisit if: GitHub adds an Actions event for a Projects lane change.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
