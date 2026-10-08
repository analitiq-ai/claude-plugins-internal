---
schemaVersion: 0.1.0
id: "0002"
title: "Keep all gate state in one local store outside every repo"
status: accepted
date: 2026-10-06
deciders: ["@Analitiq-Bot-Wonka"]
tags: [state, ledger]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{ledger,hookio,pre_merge_gate}.py"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
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
    label: "The batch of decisions already made, written as ADRs"
  - type: issue
    id: "36"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/36"
    label: "Move the merge override grants under the state root"
---

# ADR-0002: Keep all gate state in one local store outside every repo

## Context

Two parts of the plugin must meet on the same records, and neither knows what the other knows. The
poller knows a PR but no checkout. The hooks know a checkout but no PR. The module docstring of
`plugins/alq-review/scripts/ledger.py` gives this as the reason state lives outside every repo.

The claim check then added records about a commit that is not made yet. A commit has no PR, so the
store needed a second kind of key, and the choice was between the existing store and a new one.

Why now: the rule is written only in a docstring and two research files. Issue #26 will add a per-repo
switch that needs a place to live.

## Decision

1. We will keep what a gate records in one local folder outside every repo and every worktree, the state
   root: `${ALQ_REVIEW_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/alq-review}`.
2. We will keep records that outlive a session in one SQLite file there, written inside a
   `BEGIN IMMEDIATE` transaction.
3. We will keep no record anywhere else without an ADR that names it. A record is what a gate has to
   remember to decide later.
4. We will keep a gate's record for as long as its local branch exists. Once the branch is gone, the user
   deletes the record by hand.
5. We will let nothing else delete a record: no agent, and not the removal of a branch or a worktree. A
   record is what keeps a branch locked or held, so whoever can delete it can release the branch.
6. We will keep `gate.log` and `errors.log` for record keeping. They are not deleted with a record.

## Options considered

### Option A: One local folder outside every repo, one SQLite file (chosen)

| Dimension | Assessment |
|---|---|
| Poller and hooks meet | Yes, by repo and PR |
| Writers at the same time | Take turns inside the transaction |
| Commit checks | Same file, keyed without a PR |
| Shared between machines | No |

### Option B: Do nothing

The rule stays in a docstring and two research files, with no ADR that binds the next gate.

### Option C: A second store for the commit checks

Rejected: a second store would need its own locking.

### Option D: One JSON file per check

Rejected. The plugin had left that design for this reason: with a bare JSON file, writers at the same
time lose each other's update, and a file lock can go stale.

### Option E: The state in the worktree of the issue

Rejected:

- Removing the worktree would reset the gate. Its locks, counts and holds would go with the folder, and
  removing a worktree is a routine command.
- The user's keywords find a record by its id from any session, and a merge can run from any directory.
  One store answers both.
- A PR is not one worktree. A worktree can be removed and made again while its PR is open.

## Trade-offs

- State is per machine. A hold or a ledger on one machine is not known on another.
- The ledger is in no PR, so a reviewer cannot read it there.
- Not everything is in the store yet: until issue #36 is done, the merge override grants are kept in a
  folder of their own.
- Deleting a record is manual and has no tool. A tool is outside this ADR.
- Records pile up until the user deletes them. A shim check's record holds the staged diff, so source
  stays in the store that long.
- The two logs are not bounded by this ADR.

## Consequences

- Easier: a new gate adds a table to one schema and reuses one transaction.
- Harder: anything that must hold on two machines at once cannot rest on this store alone.
- **How we would know this was wrong:** two machines working on one PR disagree on whether it is
  locked or held, and that costs a wrong refusal or a wrong pass. Or a new store appears with no ADR.
  Or a lock or a hold is gone while its branch still exists.
- Revisit if: gate state has to be shared between machines.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [x] Decide whether the merge override grants move under the state root.
3. [ ] List every folder the plugin writes in the README's State section.
4. [ ] Move the merge override grants under the state root (issue #36).
