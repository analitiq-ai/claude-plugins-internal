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
    pattern: "plugins/alq-review/scripts/{gate,policy,specbinding,ledger,worktree,github}.py"
  - type: path
    pattern: "plugins/alq-review/agents/conflict-resolver.md"
  - type: path
    pattern: "plugins/alq-review/README.md"
  - type: path
    pattern: "dev/alq-review/tests/{test_gate,test_policy,test_specbinding}.py"
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

Drafted from the plan of spec 104 (PR #108).

ADR-0016 binds a PR to the blob id of its `spec.md` at the first round and holds the PR whenever HEAD's
`spec.md` differs. The graded agent can still change `spec.md` in its own PR, and the user's `unlock <ref>`
then accepts the new text unchecked. ADR-0018 makes `unlock` the only release of a `RESHAPE_SPEC` lock,
so after the spec changes on its own branch nothing checks that it changed, or keeps a round from grading
the old code against the new spec.

The engineering git workflow and its ADR-0002 now require a spec change to land as its own spec-only PR.
Constitution P2 (3.0.0) asks that every action releasing a hold be named by a decision record.

## Decision

1. We will refuse a review-round launch on a PR whose diff adds or modifies a `spec.md` and changes any
   path outside that spec's folder. The check reads the PR's diff, so it catches the change whatever wrote it.
2. We will grade every round against `spec.md` at the reviewed commit. The binding is the `spec` value
   alone: no blob id, no hold on a changed `spec.md`. This replaces ADR-0016, decision 6, and the blob-id
   part of decision 4.
3. We will release a `RESHAPE_SPEC` lock by one of two user prompts: `unlock <ref>` when the spec stands,
   `rebase <ref>` after a spec change. On `rebase <ref>` the gate checks that the bound `spec.md` changed
   on the default branch, releases the lock and records that commit; no review round launches until HEAD
   contains it. The session, not the gate, rebases and pushes. This replaces ADR-0018's "only by
   `unlock`". Its Option B stays rejected: the rescope prompt released the lock without the user ruling
   on the spec.

Draft ADR-0019 (PR #93) binds the `spec.md` blob in its decision 3; decision 2 here replaces that part.

## Options considered

### Option A: Gate the PR's diff at launch, grade the committed spec, release by `unlock` or `rebase` (chosen)

| Dimension | Assessment |
|---|---|
| Where a mixed change is stopped | At every review-round launch |
| What a round grades against | `spec.md` at the reviewed commit |
| Release after a spec change | `rebase <ref>`: checked, recorded, enforced at the next launch |

### Option B: Keep the blob hold and `unlock` as the one release

The graded agent can still move its spec, and `unlock` accepts the move unchecked. After a spec change
elsewhere, nothing keeps the old code out of a round.

### Option C: The `rebase <ref>` hook rebases and pushes itself

Every partial failure between the rewrite and the push has to be handled inside the gate; four review
rounds kept finding states it got wrong. A gate that checks while the session changes the branch fails
safe instead.

### Option D: Do nothing

The graded spec can change inside the graded PR.

## Trade-offs

- Two keywords release one lock, one per outcome the user can rule; the lock's text names both.
- The rebase and push are the session's work, named by the reply. The launch refusal is what keeps it safe.
- A spec change costs its own PR and review loop before the story goes on.

## Consequences

- Easier: a round grades exactly the committed `spec.md`; no stored copy can drift from it.
- Harder: a story that needs a different approach waits for its spec PR to merge and the branch to rebase.
- **How we would know this was wrong:** story PRs repeatedly refused for mixed diffs, or `RESHAPE_SPEC`
  re-rulings on branches released by `rebase <ref>`.
- Revisit if: either shows up.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Close PR #105 (hand-written ADR-0020), which this record replaces.
3. [ ] Update draft ADR-0019 (PR #93): drop the `spec.md` blob from decision 3 and its closing line.
