---
schemaVersion: 0.2.0
id: "0020"
title: "Keep spec.md out of story PRs and grade every round against spec.md at the reviewed commit"
status: draft
date: 2026-10-14
deciders: []
tags: [spec, review-round, holds, user-authority, release]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0004", "0016", "0018"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,policy,specbinding,ledger,facts,worktree,github}.py"
  - type: path
    pattern: "plugins/alq-review/agents/conflict-resolver.md"
  - type: path
    pattern: "plugins/alq-review/README.md"
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/SKILL.md"
  - type: path
    pattern: "dev/alq-review/tests/{test_gate,test_policy,test_specbinding,test_worktree_facts,test_agents}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/pull/108"
review:
  tier: async
externalRefs:
  - type: issue
    id: "104"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/104"
    label: "alq-review: spec.md is read-only on a story branch; a spec change lands in its own spec-only PR"
  - type: pr
    id: "108"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/pull/108"
    label: "Spec, plan and research this record is drafted from"
---

# ADR-0020: Keep spec.md out of story PRs and grade every round against spec.md at the reviewed commit

## Context

Drafted from the plan of spec 104 (PR #108), settled with the user on 2026-10-13 and 2026-10-14.

A review round grades a story PR against its `spec.md`. ADR-0016 binds a PR to the git blob id of its
`spec.md` at the first round (decision 4) and holds the PR, as a `RESHAPE_SPEC` ruling does, whenever HEAD's
`spec.md` differs from that blob (decision 6). The agent being graded can still change `spec.md` in its own
PR: the hold then stops the PR, and the user's `unlock <ref>` takes the new text as the binding. So the
document that grades the work can move inside the work it grades, and one keyword both checks nothing and
accepts the change.

ADR-0018 makes `unlock <ref>` the only release of a `RESHAPE_SPEC` lock. A ruling of `RESHAPE_SPEC` usually
means the spec has to change. Once it changes on another branch and merges, the story branch has to be
rebased on it, and nothing checks that the spec actually changed or keeps a round from grading the old code
against the new spec.

Constitution P2 (3.0.0) asks every hold to name the one entity approved to release it, and that every
action releasing it be named by a decision record; a way out no record names fails. Before 3.0.0, P2 allowed
one action only, and ADR-0018 rejected a second release of a `RESHAPE_SPEC` lock on that ground.

## Decision

1. We will refuse a review-round launch, of any stage, on a PR whose diff adds or modifies a `spec.md` and
   changes any path outside that spec's folder. A path in no spec folder gets one reply (land the spec
   change as its own spec-only PR); paths only in other spec folders, a folder's move included, get another,
   naming both folders and the two-PR route. A deleted `spec.md` does not count. This check reads git, so it
   sees a change whatever wrote it.
2. We will refuse `Edit`, `Write` and `NotebookEdit` of a `spec.md` on a story branch (`<issue>-us<N>-<slug>`),
   by path, before the ledger or GitHub is read. Bash writes, commits and rebases are not judged here;
   decision 1 catches what they carry.
3. We will change a spec only through a spec-only PR on `<issue>-spec`, branched fresh off the default branch.
   A rescope runs there, never in the story PR's worktree, and never on a merged `<issue>-spec`.
4. We will grade every round and assessment against `spec.md` at the reviewed commit. The binding is the
   `spec` value alone; the gate stores no copy and no blob id of `spec.md`, and puts no hold on a changed one.
   This replaces ADR-0016, decision 6, and the blob-id part of decision 4. ADR-0016's decisions 1–3 and 5
   stand.
5. We will release a `RESHAPE_SPEC` lock by the user's prompt in one of two forms. `unlock <ref>` releases it
   when the user rules the spec stands. `rebase <ref>`, the whole prompt, releases it after a spec change:
   the gate checks that the bound `spec.md` differs on the default branch from the locked round's commit,
   releases the lock, and records the default branch's commit; the session then rebases, has the
   conflict-resolver agent settle any conflict, and pushes. No review round launches until HEAD contains
   that commit. Both go through the same release, and nothing else releases the lock. These two are the
   release actions P2 asks a record to name for this lock. This replaces ADR-0018's "only by `unlock`";
   the rest of ADR-0018 stands. ADR-0018's Option B, the rescope prompt as a second release, stays
   rejected: it released the lock without the user ruling on the spec, where each keyword here is the
   user's ruling on one outcome.
6. We will grade a review-round launch as a full round, and measure the round facts afresh from it, when HEAD
   no longer contains a head the facts are measured from, whatever rewrote the branch. The round caps and
   round numbering still span it.

Draft ADR-0019 (PR #93) binds a PR to its `spec.md` blob in its decision 3 and closes with "ADR-0016,
decision 6, and ADR-0018 stand". Decision 4 replaces that blob part, and decisions 4 and 5 replace that line.

## Options considered

### Option A: Keep spec changes out of story PRs, gate at the launch, user releases by `rebase` or `unlock` (chosen)

| Dimension | Assessment |
|---|---|
| Where a mixed change is stopped | At every review-round launch, from the PR's diff |
| What a round grades against | `spec.md` at the reviewed commit |
| State the gate keeps about the spec | The `spec` value only |
| Release after a spec change | `rebase <ref>`: checked, recorded, enforced at the next launch |
| Who rewrites the branch | The session, as the reply names |

### Option B: Keep the blob hold (ADR-0016, decision 6) and `unlock` as the one release

**Pros:** no new keyword; already built.
**Cons:** the graded agent can still move its spec, and the user's `unlock` accepts the move without
checking it. After a spec change elsewhere, nothing checks the rebase or keeps the old code out of a round.

### Option C: Refuse every write to `spec.md` on a story branch: Bash, commit and rebase included

**Pros:** stops the change before it is committed.
**Cons:** each route needs a reader of shell or git state, and review rounds on PR #108 kept finding edge
cases in each. The launch check sees what every route leaves, so the user narrowed the early refusal to the
edit tools.

### Option D: The `rebase <ref>` hook rebases and force-pushes itself

**Pros:** one prompt does the whole job.
**Cons:** every partial failure between the rewrite and the push has to be handled inside the gate; four
review rounds kept finding states it got wrong. A gate that checks state while the worker changes it, as
GitHub's "branch must be up to date" rule does, fails safe instead.

### Option E: Do nothing

The graded spec can change inside the graded PR, and a `RESHAPE_SPEC` lock has no checked route back after
the spec changes.

## Trade-offs

- Two keywords release one lock, one per outcome the user can rule (the spec stands, or it changed). The
  user has to know which to type; the lock's text names both.
- The rebase, the conflict-resolver dispatch and the push are the session's, named by the reply, not done by
  code. What keeps this safe is the launch refusal until HEAD contains the recorded commit.
- A spec change costs a separate PR and its own review loop before the story can go on.
- A spec edit by Bash, by commit or during a rebase is caught only at the next launch, not when it is made.

## Consequences

- Easier: the spec a round grades against is the committed `spec.md` at that commit; no stored copy can
  drift from it. A spec change has one route, reviewed on its own.
- Harder: a story that needs a different approach stops until its spec PR merges and the branch is rebased.
- **How we would know this was wrong:** story PRs repeatedly refused at launch for a mixed diff, or
  `RESHAPE_SPEC` re-rulings on branches released by `rebase <ref>` whose spec did not really change.
- Revisit if: either shows up, or spec PRs stall stories for longer than the stories take.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Close PR #105 (hand-written ADR-0020), which this record replaces.
3. [ ] Update draft ADR-0019 (PR #93): drop the `spec.md` blob from decision 3 and its closing line.
4. [ ] Build spec 104's user stories against this record.
