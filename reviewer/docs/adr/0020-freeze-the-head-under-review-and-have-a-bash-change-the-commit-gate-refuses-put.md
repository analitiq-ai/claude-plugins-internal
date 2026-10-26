---
schemaVersion: 0.2.0
id: "0020"
title: "Freeze the head under review, and have a Bash change the commit gate refuses put back"
status: draft
date: 2026-10-20
deciders: []
tags: [hooks, mutation-gate, holds, review-round]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0013", "0015", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,worktree,hookio}.py"
  - type: path
    pattern: "reviewer/plugin/hooks/hooks.json"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0020: Freeze the head under review, and have a Bash change the commit gate refuses put back

## Context

A round grades the head it was launched on. An edit, a commit, a push or a reply on the PR while its
reviewers run, or before its assessment, acts on a head no ruling covers. A hold that refuses commits is
checked at `git commit`, but a Bash command can write files or move the branch tip by any other route: a
script, `cp`, `git reset`.

## Decision

1. We will freeze the head under review: while a reviewer subagent of the session runs, while its round
   collects reports, and while a round awaits assessment, the session's `Edit`, `Write`, `git commit`,
   `git push` and replies on the PR are refused.
2. We will bracket every Bash command of a session with an issue. After it, a new commit names the checks
   it needs (ADR-0002); while the head is frozen, a moved branch tip blocks the command's result and tells
   the agent to put the branch back. A hold that refuses commits (ADR-0013) is enforced by the check of
   the commits, which are pushed only once passed. A checkout the watch cannot read refuses the command
   (root ADR-0004).

## Options considered

### Option A: Refuse the session's own writes, and compare around each Bash command (chosen)

Any Bash route is caught by what changed, with no list of commands to maintain.

### Option B: Refuse only `git commit` while a round runs

Rejected: an edit, push or reply mid-round still acts on a head no ruling covers.

### Option C: Parse each Bash command for what it could write

Rejected: an open-ended list; any interpreter can write a file.

### Option D: Do nothing beyond the commit gate

Rejected: a held branch moves by `git reset` or a script, out from under its hold.

## Trade-offs

- A command that changed a held branch has already run; the agent puts it back, and a command that
  cannot be undone stays done.
- Every Bash command pays for a tip check.
- A command from another session in the same checkout is not watched.

## Consequences

- Easier: the head a round ruled on is the head that is pushed and answered for.
- Harder: an agent waits for its round and the assessment before it edits again.
- **How we would know this was wrong:** a commit, push or reply lands between a round's launch and its
  assessment.
- Revisit if: Claude Code can confine a session's writes by path or branch.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
