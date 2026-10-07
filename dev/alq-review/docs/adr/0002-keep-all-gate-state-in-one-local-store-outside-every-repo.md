---
schemaVersion: 0.1.0
id: "0002"
title: "Keep all gate state in one local store outside every repo"
status: draft
date: 2026-10-06
deciders: []
tags: [state, ledger]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{ledger,hookio,pre_merge_gate,snapshot}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of decisions already made, written as records"
---

# ADR-0002: Keep all gate state in one local store outside every repo

## Context

Two parts of the plugin must meet on the same records, and neither knows what the other knows. The
poller knows a PR but no checkout. The hooks know a checkout but no PR. The module docstring of
`plugins/alq-review/scripts/ledger.py` gives this as the reason state lives outside every repo.

Spec 005 then added records about a commit that is not made yet. Its research R7 notes that "PR ledgers
cannot hold these records because a commit has no PR". So the store needed a second kind of key, and
the spec had to choose between the existing store and a new one.

Spec 006 research R3 met the opposite pull. Its sweeper agents read a copy of `HEAD`, and a read
outside the project needs an allow from a hook.

Why now: the rule is written only in a docstring and two research files. Issue #26 will add a per-repo
switch that needs a place to live.

## Decision

1. We will keep what a gate records in one local folder outside every repo, the state root.
2. We will keep records that outlive a session in one SQLite file there, written inside a
   `BEGIN IMMEDIATE` transaction.
3. We will key a record about a PR by repo and PR, and a record about a commit or a staged tree by
   repo and an id that needs no PR.
4. We will name each exception in a record. One is named here: the sweeper's copy of `HEAD` stays
   beside the worktrees, as spec 006 research R3 decided. It is a read copy, not a record.

## Options considered

### Option A: One local folder outside every repo, one SQLite file (chosen)

| Dimension | Assessment |
|---|---|
| Poller and hooks meet | Yes, by repo and PR |
| Writers at the same time | Take turns inside the transaction |
| Commit checks | Same file, keyed without a PR |
| Shared between machines | No |

### Option B: Do nothing

The rule stays in a docstring and two research files, with no record that binds the next gate.

### Option C: A second store for the commit checks

Rejected in spec 005 research R7: "a second store would need its own locking".

### Option D: One JSON file per check

Rejected in spec 005 research R7, which points to the README for why the plugin left that design.

### Option E: The sweeper's copy in the state folder

Rejected in spec 006 research R3: the folder "is outside the project, so every read depends on the
allow".

## Trade-offs

- State is per machine. A hold or a ledger on one machine is not known on another.
- The ledger is in no PR, so a reviewer cannot read it there.
- Not everything is in the store today: the merge override grants are kept in a folder of their own
  (action item 2).

## Consequences

- Easier: a new gate adds a table to one schema and reuses one transaction.
- Harder: anything that must hold on two machines at once cannot rest on this store alone.
- **How we would know this was wrong:** two machines working on one PR disagree on whether it is
  locked or held, and that costs a wrong refusal or a wrong pass. Or a new store appears with no record.
- Revisit if: gate state has to be shared between machines.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Decide whether the merge override grants move under the state root.
3. [x] List every folder the plugin writes in the README's State section.
