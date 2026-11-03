---
schemaVersion: 0.2.0
id: "0011"
title: "Record rounds and holds as the reviewer App's GitHub-signed commits on a ledger branch, read as a fold through core/"
status: accepted
date: 2026-11-03
deciders: ["@Analitiq-Bot-Wonka"]
tags: [state, ledger, holds, git, rulesets, signed-commits, orchestrator, fail-closed]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0012", "0013", "0015", "0021"]
affects:
  - type: path
    pattern: "reviewer/plugin/**"
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "orchestrator/**"
  - type: path
    pattern: "SECURITY.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/288"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-11-03T16:20:35Z
---

# ADR-0011: Record rounds and holds as the reviewer App's GitHub-signed commits on a ledger branch, read as a fold through core/

## Context

A record beside the session is lost with the agent machine and unreadable where planner and admins
work. A hold can exist before the story's PR, and a PR can be closed and reopened; the story issue
outlives both. Until now the record was one tagged comment on the story issue holding the whole
snapshot. GitHub caps a comment at 65,536 characters, and the snapshot grows with every round, hold,
pushback and ruling, so a long story is refused its own record; its author and every admin writer can
edit or delete a comment, so tamper was inferred from edit marks and timeline events. The model's token
writes nothing (root ADR-0007). GitHub signs a commit an App makes through its API, with the App's bot
identity as author, and refuses to sign one made with a custom author; a ruleset can forbid everyone a
force-push and a deletion while letting one App commit. All of this was tested on a throwaway repo (#288).

## Decision

1. We will record rounds and holds on the branch `ledger` of the served repo, under `issues/<n>/` for
   story issue `<n>`: one file per event, each write one commit the reviewer App makes with
   `createCommitOnBranch`, naming as `expectedHeadOid` the head the hook read, so a write on a stale
   reading is refused and the hook reads and decides again. A write only adds files, named by their kind
   and key (a round by its workflow run, a hold by its id and `since`), so a retry that finds its files
   there is complete. The record carries a `gates` section, core's `Gates` contract
   (`core/src/contracts/gates.ts`): the story's open lineages (ADR-0001) and bugs (ADR-0008), whose counts
   place `claim-<id>` and `shim-<id>` holds (ADR-0013 d4); it changes only together with the holds it
   places, in one commit. The hook asserts in the mutation's answer that GitHub signed the
   commit, and fails the write otherwise, naming the commit. Reviewer's hook alone writes as that App,
   `codeworks-reviewer`, whose key only hooks read (root ADR-0008), and only from verdicts ADR-0021 counts.
2. We will read a story's state as the fold of its directory's history on `ledger`, oldest first, from
   GitHub's API and never from a local copy, classifying each commit that touches the directory:
   - GitHub-signed and valid, authored by the reviewer App's bot login (`[shared]` names it, root
     ADR-0002), every file added: an event, read from that commit;
   - GitHub-signed and valid, authored by an admin, a writer who is no codeworks App as ADR-0013 d2 reads
     one, every file removed: the events under those paths leave the fold;
   - anything else: an invalid commit. The paths it touched count for nothing, and the story is held, as a
     tampered comment held it before, until an admin's commit of the second kind has removed every one of
     them; a Ready move and an admin's comment newer than that removal release it (ADR-0013 d2).
   The fold yields core's `Snapshot` (`core/src/contracts/snapshot.ts`): rounds, holds, pushbacks, rulings
   and gates, a released hold keeping its row and a rescope hold the number of the spec PR that placed it
   (ADR-0013). No reader takes the newest event alone. A story with no directory has no state.
3. We will guard `ledger` with three rulesets, one per guarantee, since a bypass exempts its actors from
   every rule in its ruleset (orchestrator `README.md`, setup step 6): block force pushes and restrict
   deletions, no bypass; restrict updates, bypass the reviewer App and the repository admin role; require
   signed commits, no bypass. Only the reviewer App and an admin can commit there, nothing unsigned lands,
   a commit the reviewer hook makes with a custom author is refused, and nobody rewrites or deletes the
   branch. The reviewer App holds `contents: write` and no `issues` permission: it posts no issue comment;
   a hold's question is the orchestrator's (orchestrator ADR-0010 d1, ADR-0013 d5), and whatever else an
   admin must read on the issue the orchestrator renders from the fold. This is the one exception to root
   ADR-0007 d5.
4. We will read and write the record only through the state module in `core/` (root ADR-0003):
   reviewer's hook alone writes, and the orchestrator reads all of it: attestation, holds, pushbacks and
   rulings (orchestrator ADR-0007). Planner writes no state: reviewer's hook places a rescope hold when it
   sees the rescope's spec PR open (ADR-0013 d5).
5. We will keep no copy of rounds or holds between hook runs: each hook run that decides on them reads
   the fold once, through `core/`, and uses that one reading only within the run. Nothing migrates at
   cutover: the SQLite ledger is deleted, no tagged comment is read, and a PR open at cutover is attested
   only after a fresh internal round. Reviewer reports stay session-scoped files.

## Options considered

### Option A: The reviewer App's signed commits on a ledger branch of the served repo, the state a fold (chosen)

### Option B: One tagged issue comment holding the whole snapshot, the record until now

Rejected: GitHub's 65,536-character cap refuses a long story its record, and every post rewrites the
whole snapshot; its author and every admin writer can edit or delete it, so tamper is inferred from edit
marks and timeline events instead of refused.

### Option C: One issue comment per event

Rejected: the cap moves from the snapshot to the event, but a comment stays editable and deletable, and
a deleted one leaves only a timeline event behind.

### Option D: A store beside the session as the record

Rejected: lost with the agent machine.

### Option E: A section of the PR body

Rejected: a hold has nowhere to live before the PR exists.

### Option F: The state module private to reviewer's plugin

Rejected: the orchestrator would need a copy.

### Option G: The orchestrator's App writes the record, reviewer handing it each verdict

Rejected: the orchestrator would attest from a record it wrote itself (orchestrator ADR-0004 Option C),
and that a round exists would rest on a file on the agent machine instead of GitHub's signature.

### Option H: A ledger beside the session as a cache, rebuilt from the state at the session's start

Rejected: a hook run would decide on a copy missing an event, an admin's comment or a reset made since.

### Option I: A ledger repository of its own

Rejected: a second installation, ruleset set and token per served repo, for a branch the served repo can
hold.

### Option J: A branch per story, `ledger/<n>`

Rejected: a branch per story accumulates in every clone and branch list and needs creating, and the
path filter bounds a story's read as well.

### Option K: Hash-chained events, or a reader that trusts the newest event

Rejected: GitHub's history already chains commits and its signature already names the author; the newest
event alone would let a stale or stray tail stand for the story.

### Option L: Recover from an invalid commit by a generation the next release starts, or by an admin's force-push

Rejected: a generation asks what carries over, and a stray commit would restart counts; a force-push
past a mid-history commit rewrites every later commit, which GitHub then no longer signs, and on one
branch other stories' events follow within minutes.

### Option M: Hold a story that has a PR and no record

Rejected: the draft PR precedes the first round (builder ADR-0003); every story would wait for an admin.

## Trade-offs

- `contents: write` reaches every branch no ruleset protects and GitHub's merge endpoint: a reviewer hook
  bug can push to a story branch, and only the ruleset stops a merge, as for the orchestrator App.
- Every event is a commit on the served repo: `ledger` grows for as long as the repo lives, since nothing
  on it is deleted, and clones fetch it unless they exclude it.
- An admin reads JSON files on a branch, not a rendered comment, unless the orchestrator renders one.
- An invalid commit costs an admin three acts, a deletion commit, a comment and a Ready move, and one
  that overwrote an event costs that event.
- A served repo whose plan offers no rulesets (orchestrator ADR-0009 d2) keeps only the fold's checks: a
  rewrite of the branch is not refused there.

## Consequences

- Easier: no size cap; a row can never be dropped or rewritten, since a reviewer App commit only adds
  files; a write on a stale reading is refused and made again, not lost; tamper is GitHub's verdict, a
  signature and an author, not an inference from edit marks and timeline events.
- Harder: an orphan branch and three rulesets per served repo; a read grows with a story's events, since
  the fold reads the directory's commits and each commit's file list; an event or snapshot format change
  is a `core/` release.
- **How we would know this was wrong:** a round in a fold no reviewer hook wrote; a commit on `ledger`
  GitHub did not sign; a state read from the newest event alone; a story held by an invalid commit that
  an admin's deletion does not release.
- Revisit if: a second writer needs the record, rounds run outside the session, or GitHub stops signing
  an App's API commits.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
