---
schemaVersion: 0.2.0
id: "0006"
title: "Keep planning and building in disjoint lanes of an issue"
status: draft
date: 2026-10-20
deciders: []
tags: [lanes, board, rescope, concurrency, state-comment]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0005", "0008"]
affects:
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "builder/plugin/skills/issue-tackle/**"
  - type: path
    pattern: "reviewer/plugin/scripts/**"
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0006: Keep planning and building in disjoint lanes of an issue

## Context

reviewer's state comment on a story issue is a full snapshot, the newest winning (reviewer ADR-0011).
reviewer's hook writes it while a story is built, and again when a rescope places holds (reviewer
ADR-0013); two writes at once would lose one snapshot. A spec that changes under a running story is built
against the old one. The board already says what runs: the orchestrator claims only from Ready, and a
human stops a story by dragging it to Blocked (orchestrator ADR-0002).

## Decision

1. We will let planner work on an issue only while its card is in Blocked or Backlog, and builder and
   reviewer never while it is there.
2. We will start a rescope only when the spec's issue and every open story issue under it are in Blocked
   or Backlog. planner opens the rescope's spec PR from where its human works; reviewer's hook on the
   agent machine (ADR-0008) places the rescope hold (reviewer ADR-0013) on each of them when it sees
   that PR open. A human moves an in-flight story there, which stops it.
3. We will refuse work on a closed issue; new work goes in a new issue.

## Options considered

### Option A: Disjoint lanes (chosen)

One lane rule keeps one writer per state comment and no build under a changing spec.

### Option B: Refuse a rescope only on a closed issue, in any lane

Rejected: a story in progress builds under the spec being changed, and two writers share its state comment.

### Option C: Any lane, with a snapshot that names its base and a writer that retries

Rejected: a second mechanism for what the lanes already keep apart.

### Option D: planner moves the cards to Blocked itself

Rejected: only the orchestrator's hooks write a lane (orchestrator ADR-0002).

## Trade-offs

- A rescope stops every claimed story under the spec until a human returns it to Ready.
- A human moves every open story under the spec to Blocked or Backlog before a rescope can start, a
  claimed story not yet pushed included.

## Consequences

- Easier: the state comment has one writer at a time with no merge logic; no story builds while its spec
  changes.
- Harder: every component that starts work reads the board first. Each enforces this record in its own:
  planner ADR-0005, builder ADR-0002, reviewer ADR-0015, orchestrator ADR-0002.
- **How we would know this was wrong:** a rescope hold lost to another state write, or a story built
  under a spec a rescope was changing.
- Revisit if: planning runs without a human, or state moves out of a single snapshot.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
