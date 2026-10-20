---
schemaVersion: 0.1.0
id: "0005"
title: "Check the exact staged tree and refuse a commit command that could change it"
status: accepted
date: 2026-10-06
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
---

# ADR-0005: Check the exact staged tree and refuse a commit command that could change it

## Context

A check that runs before a commit is worth something only if what it read is what lands. Two things break
that.

The first is order inside one command. The gate's hook runs once, before the whole Bash command. In
`git add -A && git commit` the hook reads the index before the add, so a check of the older content lets
unchecked content through.

The second is time. The check runs before the commit, as a separate step. The index and the files can change
between the two.

Spec 004 met the first problem earlier, concluded that commit content is not readable for the usual
command form, and moved its own check to the review round launch. The claim check needed the commit
itself to be refused, so it had to solve the problem and not step around it.

## Decision

1. We will identify what a commit holds by the id `git write-tree` gives the index. A check is stored and
   looked up under that id, and counts only for that tree.
2. We will let `git commit` run alone. Only `cd` may come before it in its Bash command. A commit that stages
   for itself, with `-a`, `-i`, `-o`, their long forms or a pathspec, is refused and told to stage with
   `git add` in an earlier command.
3. We will not start a check while a tracked file differs from the index, so the agents that read the
   checkout read what is staged.
4. We will not check a commit with nothing staged, or one that concludes a merge, cherry-pick or revert.
   The first changes nothing, and the others only combine, replay or undo commits that already exist.
5. We will not check again what a repo's own commit hook rewrites, and we will not gate the push.

## Options considered

### Option A: Key by the staged tree, and let only `cd` share the commit's command (chosen)

| Dimension | Assessment |
|---|---|
| What was checked is what lands | Yes, short of point 5 |
| The rule | Closed, and the same words the refusal uses: run `git commit` alone |
| Existing tools | `git write-tree`. No tool was found that maps a commit command to its tree |
| Cost | Two commands for each commit |

### Option B: Do nothing, and read the index whatever shares the command

Rejected. This is the first defect in Context.

### Option C: Refuse only a command that holds something able to change the index

This was the rule's first wording. Rejected in critique: it is an open-ended list to maintain.

### Option D: Give the agents a copy of the staged tree, and allow unstaged changes

Rejected: a copy can time out inside the hook, go missing, or be deleted by another session's cleanup,
and it is read from outside the project.

### Option E: Check again after the commit, before the push

This was the earlier design. It was replaced: re-checking cosmetic changes costs a check and adds a push
gate for no claim the hooks write.

## Trade-offs

- An agent stages in one command and commits in the next.
- The closed rule also refuses harmless forms, such as a commit piped into `tail`.
- Any restaging gives a new tree id, so it needs a new check.
- Unstaged changes to tracked files stop a check from starting. The author stages or discards them first.
- A commit hook that rewrites files lands content no check read.

## Consequences

- Easier: a later commit-time check gets the same guarantee by calling the shared function and keying its
  record on the staged tree.
- Harder: every commit takes two commands, and any restaging needs a new check.
- **How we would know this was wrong:** a commit lands under `enforce` whose tree has no complete check; or
  a repo's commit hook is found to write claims or code, not only cosmetic changes.
- Revisit if: a hook can run after the earlier parts of a command, or Claude Code offers a way to read the
  tree a commit command will record.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
