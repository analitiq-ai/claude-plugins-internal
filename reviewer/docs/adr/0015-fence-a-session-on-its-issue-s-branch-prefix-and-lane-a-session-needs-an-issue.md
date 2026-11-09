---
schemaVersion: 0.2.0
id: "0015"
title: "Fence a session on its issue's branch prefix and lane; a session needs an issue"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [commit-gate, fence, branch-grammar, session-state, lanes, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0006", "0010", "0011", "0014", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,hookio,worktree}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:53Z
---

# ADR-0015: Fence a session on its issue's branch prefix and lane; a session needs an issue

## Context

A build session must not commit outside its own story's branch; on a repo with no ruleset, the session
hook is the only line before the default branch. Each story issue has one branch, `<s>-us<k>-<slug>`
(root ADR-0005). Building runs only outside Blocked and Backlog (root ADR-0006).

## Decision

1. We will key the fence on the session's issue, the one its `/codeworks <s>` prompt names, recorded by the
   orchestrator (orchestrator ADR-0002). A commit lands only on a branch starting `<s>-us`.
2. We will refuse, while reviewer is on, every commit of a session with no recorded issue, naming the ways
   forward: name the issue, or switch reviewer off (ADR-0006). Ad-hoc work runs with reviewer off; its PR
   merges once a writer other than a codeworks App applies the exempt label (orchestrator ADR-0005).
3. We will enforce root ADR-0006's lane rule by refusing every story-branch commit and every round's
   launch while the session's issue is in Blocked or Backlog, read from the board at each.
4. We will gate every new commit on the branch, however made (ADR-0002), and refuse a change to a merged
   story's task block. After a merge of the default branch, the spec folder must equal
   the default branch's but the story's own ticks (ADR-0010).
   *Amended by ADR-0023 d1, d5 (#342): the intent tier must equal the default branch's; the design tier, the story's own task block among it, may differ by the story's `spec:` commits, and its resolution is graded by the round; in force from root ADR-0012 action item 6.*
5. We will enforce the branch grammar at three sites only, each parsing the branch through `core/` (root
   ADR-0005): the review-round launch (ADR-0014), this fence, and the refusal of a reviewer type
   dispatched from the main thread (ADR-0019).

## Options considered

### Option A: Fence on the session's issue and its lane; a session needs an issue (chosen)

### Option B: Refuse any commit on a branch outside the grammar, keyed on the name

Rejected: a name alone does not tie a session to its own story.

### Option C: A session with no issue commits on any branch

Rejected: its state has no issue to live on, and it is trusted on every branch.

### Option D: Gate on holds alone, not on the lane

Rejected: a story dragged to Blocked would keep committing beside planner.

## Trade-offs

- Every ad-hoc change needs reviewer off and an exempt label.
- The fence is a hook in the session's process, not a server rule.

## Consequences

- Easier: a build session cannot stray from its story.
- Harder: a session must name its issue before its first commit.
- **How we would know this was wrong:** with reviewer on, a commit lands outside the fence, from a
  session with no issue, or on a story branch while its issue is in Blocked or Backlog; a merge brings
  in a spec other than main's.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
