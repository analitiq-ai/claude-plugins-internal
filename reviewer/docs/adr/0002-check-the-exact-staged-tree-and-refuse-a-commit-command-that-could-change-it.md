---
schemaVersion: 0.1.0
id: "0002"
title: "Check the exact staged tree and refuse a commit command that could change it"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [claim-check, shim-check, commit-gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{shell,worktree,claimcheck,claimgate,shimcheck,shimgate}.py"
  - type: path
    pattern: "specs/004-spec-folder-checks/**"
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
    label: "The batch of decisions already made, written as ADRs"
---

# ADR-0002: Check the exact staged tree and refuse a commit command that could change it

## Context

A pre-commit check is worth something only if what it read is what lands. The gate's hook runs once, before the whole Bash command: in `git add -A && git commit` it reads the
index before the add. And the check runs as a separate step before the commit, so the index and the files
can change in between.

## Decision

1. We will identify what a commit holds by the id `git write-tree` gives the index. A check is stored and
   looked up under that id, and counts only for that tree.
2. We will let `git commit` run alone. Only `cd` may come before it in its Bash command. A commit that stages
   for itself, with `-a`, `-i`, `-o`, their long forms or a pathspec, is refused.
3. We will not start a check while a tracked file differs from the index, so agents read what is staged.
4. We will not check an empty commit. A merge is checked on its conflict resolution; a cherry-pick or
   revert like any commit (ADR-0015).
5. We will not check again what a repo's own commit hook rewrites, and we will not gate the push.

## Options considered

### Option A: Key by the staged tree, and let only `cd` share the commit's command (chosen)

What was checked is what lands, short of point 5, by a closed rule: run `git commit` alone.

### Option B: Read the index whatever shares the command

Rejected: the first defect in Context.

### Option C: Refuse only a command that holds something able to change the index

Rejected: an open-ended list to maintain.

### Option D: Give the agents a copy of the staged tree, and allow unstaged changes

Rejected: a copy can time out inside the hook or be deleted by another session's cleanup.

### Option E: Check again after the commit, before the push

Rejected: re-checking cosmetic changes costs a check and adds a push gate for no claim the hooks write.

## Trade-offs

- An agent stages in one command and commits in the next; any restaging needs a new check.
- The closed rule also refuses harmless forms, such as a commit piped into `tail`.
- Unstaged changes to tracked files stop a check from starting.
- A commit hook that rewrites files lands content no check read.

## Consequences

- Easier: a later commit-time check gets the same guarantee by keying its record on the staged tree.
- Harder: every commit takes two commands.
- **How we would know this was wrong:** a commit lands under `enforce` whose tree has no complete check, or
  a repo's commit hook writes code, not only cosmetic changes.
- Revisit if: Claude Code offers a way to read the tree a commit command will record.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
