---
schemaVersion: 0.1.0
id: "0002"
title: "Check each commit after it is made, and push only commits that passed"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [claim-check, shim-check, commit-gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0015", "0020", "0021"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{shell,worktree,claimcheck,claimgate,shimcheck,shimgate}.py"
  - type: path
    pattern: "specs/004-spec-folder-checks/**"
  - type: path
    pattern: "reviewer/plugin/lib/check/after-commit.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:50Z
---

# ADR-0002: Check each commit after it is made, and push only commits that passed

## Context

A check is worth something only if what it read is what lands. Checked before the commit, the staged tree
can change between the check and the commit by any Bash route, and holding it still took a closed rule on
commit commands and a clean checkout. Checked in the checkout after the commit, the model can change what
the check reads (ADR-0021).

## Decision

1. We will check each commit after it is made, reading it from the hooks' copy of the repository
   (ADR-0021), never the checkout. A check grades the diff from the newest commit that passed to the
   commit it names, and passes every commit in that range.
2. We will push only commits that passed: the orchestrator's push goes up to the newest passed commit
   (orchestrator ADR-0001). While reviewer is off for the session (ADR-0006), it pushes the session's commits
   unchecked, but none that d4 would fail.
3. We will check a merge on its conflict resolution, as its round reviews it (ADR-0010).
4. We will fail a check whose change, as d1 and d3 grade it, touches a path orchestrator ADR-0004 d4
   protects, through core's one protected-path matcher: a workflow on the branch runs on the push, before
   any review, and a spec folder or a record a story changes moves the target it is graded against (root
   ADR-0011). Such a change is an admin's, merged under an exempt label (orchestrator ADR-0005).
   *Amended by root ADR-0012 d5 and ADR-0023 d5 (#342): the paths root ADR-0012 d5 names leave the protected set; the check fails instead a commit ADR-0023 d1–d3 would refuse; in force from root ADR-0012 action item 6.*

## Options considered

### Option A: Check after the commit in the hooks' copy, and push only what passed (chosen)

What was checked is what is pushed, whatever made the commit, with no rule on commit commands.

### Option B: Key the check by the staged tree, and let only `cd` share the commit's command

Rejected by the user on 2026-10-26: the index can change between the check and the commit, and the closed
rule refuses harmless forms.

### Option C: Check the checkout after the commit

Rejected: the model can change the checkout under the check.

## Trade-offs

- A commit that fails stays local, unpushed, until a later commit's check passes the range.
- The agent can build on a commit before its check fails.

## Consequences

- Easier: every commit takes one command, and a commit made by any route is checked.
- Harder: a failed check is answered by a new commit, not by restaging.
- Harder: a story never changes a protected path; an admin or planner does, in a PR of their own.
- **How we would know this was wrong:** a pushed commit that no check passed, or a range that passed while
  one of its commits alone would have been refused.
- Revisit if: something other than the orchestrator's hooks pushes a story branch.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
