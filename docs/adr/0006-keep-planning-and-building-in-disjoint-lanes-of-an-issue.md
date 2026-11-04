---
schemaVersion: 0.2.0
id: "0006"
title: "Keep planning and building in disjoint lanes of an issue"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [lanes, board, rescope, concurrency, state-record]
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
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:47Z
---

# ADR-0006: Keep planning and building in disjoint lanes of an issue

## Context

reviewer's state record of a story is the fold of its events on the `ledger` branch (reviewer ADR-0011),
which reviewer's hook alone writes, while a story is built and when a rescope places holds (reviewer
ADR-0013). A spec that changes under a running story is built against the old one. The board already
says what runs: the orchestrator claims only from Ready, resumes only a story In progress or In review,
and an admin stops a story by dragging it to Blocked (orchestrator ADR-0002).

## Decision

1. We will let planner work on an issue only while its card is in Blocked or Backlog, and builder and
   reviewer never while it is there.
2. We will start a rescope only when the spec's issue and every open story issue under it are in Blocked
   or Backlog. planner opens the rescope's spec PR from where its admin works; reviewer's hook on the
   agent machine (ADR-0008) places the rescope hold (reviewer ADR-0013) on each of them when it sees
   that PR open. An admin moves an in-flight story there, which stops it.
3. We will refuse work on a closed issue; new work goes in a new issue.

## Options considered

### Option A: Disjoint lanes (chosen)

One lane rule keeps a story from building under a changing spec, and reviewer's hook the one writer of its
state record, with no second writer to merge.

### Option B: Refuse a rescope only on a closed issue, in any lane

Rejected: a story in progress builds under the spec being changed.

### Option C: Any lane, with a writer that retries on a stale reading

Rejected: a retry (reviewer ADR-0011 d1) orders two writes; it does not stop a build under a changing spec.

### Option D: planner moves the cards to Blocked itself

Rejected: only the orchestrator's hooks write a lane (orchestrator ADR-0002).

## Trade-offs

- A rescope stops every claimed story under the spec until an admin returns it to Ready.
- An admin moves every open story under the spec to Blocked or Backlog before a rescope can start, a
  claimed story not yet pushed included.

## Consequences

- Easier: reviewer's hook is the state record's one writer, with nothing to merge; no story builds while
  its spec changes.
- Harder: every component that starts work reads the board first. Each enforces this record in its own:
  planner ADR-0005, builder ADR-0002, reviewer ADR-0015, orchestrator ADR-0002.
- **How we would know this was wrong:** a second writer of a story's state record, or a story built under
  a spec a rescope was changing.
- Revisit if: planning runs without an admin, or a second component must write a story's state.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
