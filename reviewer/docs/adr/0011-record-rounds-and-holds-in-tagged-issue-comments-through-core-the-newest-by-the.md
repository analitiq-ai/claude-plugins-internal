---
schemaVersion: 0.2.0
id: "0011"
title: "Record rounds and holds in tagged issue comments through core/; the newest by the reviewer App wins"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [state, ledger, holds, issue-comments, orchestrator, fail-closed]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0012", "0013", "0015", "0021"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{ledger,github,gate,hookio,pre_merge_gate}.py"
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "reviewer/plugin/lib/run-state.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:52Z
---

# ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the reviewer App wins

## Context

A record beside the session is lost with the agent machine and unreadable where planner and admins
work. A hold can exist before the story's PR, and a PR can be closed and reopened; the story issue
outlives both. The model's token posts nothing (root ADR-0007), but planner's App and every admin writer
can comment, and a comment can be edited or deleted.

## Decision

1. We will record rounds and holds in comments on the story issue tagged
   `<!-- codeworks:reviewer-state -->`. Each is the full snapshot, a released hold keeping its row and a
   rescope hold the number of the spec PR that placed it (ADR-0013). The snapshot carries a `gates` section,
   core's `Gates` contract (`core/src/contracts/gates.ts`): the story's open lineages (ADR-0001) and bugs
   (ADR-0008), whose counts place `claim-<id>` and `shim-<id>` holds (ADR-0013 d4). The `gates` section
   changes only together with the holds it places, in one post. The newest comment by the reviewer App,
   `codeworks-reviewer`, wins whatever its text; reviewer's hook alone posts as that App, whose key only
   hooks read (root ADR-0008), and only from verdicts ADR-0021 counts.
2. We will fail closed: when the newest such comment lacks the tag or was edited, or the issue's timeline
   shows a reviewer App comment deleted after it, the story is held. A story with no reviewer App comment has
   no state. A Ready move and an admin's comment release it (ADR-0013): reviewer then posts a snapshot rebuilt
   from the newest unedited tagged one.
3. We will read and write the snapshot only through the state module in `core/` (root ADR-0003):
   reviewer's hook alone writes, and the orchestrator reads all of it: attestation, holds, pushbacks and
   rulings (orchestrator ADR-0007).
4. We will have planner write no state: reviewer's hook places a rescope hold when it sees the rescope's
   spec PR open (ADR-0013).
5. We will keep no copy of rounds or holds between hook runs: each hook run that decides on them reads the
   state once, through `core/`, and uses that one reading only within the run. Nothing in the SQLite ledger
   migrates at cutover: the ledger is deleted, and a PR open at cutover is attested only after a fresh
   internal round. Reviewer reports stay session-scoped files.

## Options considered

### Option A: Tagged issue comments through one shared module, failing closed (chosen)

### Option B: A store beside the session as the record

Rejected: lost with the agent machine.

### Option C: A section of the PR body

Rejected: a hold has nowhere to live before the PR exists.

### Option D: The state module private to reviewer's plugin

Rejected: the orchestrator would need a copy.

### Option E: Fall back to an earlier snapshot

Rejected: editing, untagging or deleting the newest comment would drop the hold it placed.

### Option F: Hold a story that has a PR and no snapshot

Rejected: the draft PR precedes the first round (builder ADR-0003); every story would wait for an admin.

### Option G: Post as the orchestrator's App

Rejected: the orchestrator would attest from a record it wrote itself.

### Option H: A ledger beside the session as a cache, rebuilt from the state at the session's start

Rejected: a hook run would decide on a copy missing an edit, an admin's comment or a reset made since.

### Option I: The counts in a second tagged comment

Rejected: a count and the hold it places would take two posts, and a run dying between them leaves one
without the other.

## Trade-offs

- Every state change notifies the issue's subscribers.
- Tampered state holds the story until an admin acts.

## Consequences

- Harder: a snapshot format change is a `core/` release.
- **How we would know this was wrong:** a tagged comment not written through `core/`, or by another
  author, is read as state; an edited or deleted snapshot releases a hold.
- Revisit if: a second writer needs the snapshot, or rounds run outside the session.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
