---
schemaVersion: 0.1.0
id: "0005"
title: "Check the exact staged tree and refuse a commit command that could change it"
status: draft
date: 2026-10-06
deciders: []
tags: [claim-check, shim-check, commit-gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{shell,worktree,claimcheck,claimgate,shimcheck,shimgate}.py"
  - type: path
    pattern: "dev/alq-review/specs/{004-spec-folder-checks,005-claim-check-gate,006-shim-check-gate}/**"
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

# ADR-0005: Check the exact staged tree and refuse a commit command that could change it

Draft for the ratifier. Paths are relative to the repo root. This record writes down a choice that specs 005 and
006 made and the code already follows.

## Context

A check that runs before a commit is worth something only if what it read is what lands. Two things break that.

The first is the order of work inside one command. The gate's hook runs once, before the whole Bash command.
The first critique of spec 005 found the defect (E4,
`dev/alq-review/specs/005-claim-check-gate/critiques/critique-20261001-154410.md:12`): "in
`git add -A && git commit`, `git write-tree` reads the index *before* the add. If a check already exists for
that older tree, the commit goes through with content that was never checked."

The second is time. The check runs as a workflow before the commit, and the index can change between the check
and the commit.

Spec 004 met the same problem first and decided the other way. Its research R7 says of refusing at commit: "The
content is not readable for the usual command form"
(`dev/alq-review/specs/004-spec-folder-checks/research.md:146`). Its R9 rests on that: "R7 found that the round
launch sees the exact content where a commit hook does not" (`research.md:169` of the same folder). Spec 004
still says so.

What the code does today:

- Each commit hook reads the staged tree with `git write-tree` (`plugins/alq-review/scripts/worktree.py:229`) and
  looks its check up under that tree id (`plugins/alq-review/scripts/claimgate.py:86` and `:90`,
  `plugins/alq-review/scripts/shimgate.py:44` and `:50`).
- `shell.classify` counts the segments of the command that do not start with `cd`, and marks a commit `alone`
  when there is one such segment (`plugins/alq-review/scripts/shell.py:169`). `_stages` marks a commit `staging`
  when its arguments put something into the index: "-a, -i, -o or a pathspec"
  (`plugins/alq-review/scripts/shell.py:86`).
- `commit_preconditions` lets an empty or concluding commit through, and otherwise returns a refusal when the
  commit is `staging` or not `alone` (`plugins/alq-review/scripts/claimcheck.py:245`). The claim check's
  decision and the shim check's decision both call it before they read their own record (`claimcheck.py:259`,
  `plugins/alq-review/scripts/shimcheck.py:243`).
- Each check's launch handler turns the launch down while a tracked file differs from the index
  (`claimgate.py:159`, `shimgate.py:145`).

These refusals go through `refuse_claim` and `refuse_shim`. They block when the check's own setting and the
plugin's mode are both `enforce`, and otherwise only record (`plugins/alq-review/scripts/hookio.py:57` and `:64`).

## Decision

A gate that checks a commit checks the exact staged tree, and refuses a commit command that could change it.

1. **The key.** A check is stored and looked up under the id `git write-tree` gives the index. A check counts
   for a commit only when it is the check of that commit's tree. Spec 005 R2 gives the reason: "A check bound to
   a tree id cannot be reused for different content" (`dev/alq-review/specs/005-claim-check-gate/research.md:43`).
2. **The command.** `git commit` runs alone. Only `cd` may come before it in its Bash command. A commit that
   stages for itself (`-a`, `-i`, `-o`, their long forms, a pathspec) is refused. The refusal says to stage with
   `git add` in an earlier command.
3. **The launch.** A check is not started while a tracked file differs from the index, so the agents that read
   the checkout read what is staged (spec 005 R5, `research.md:87` of that folder).
4. **One function.** The rules of point 2 live in one function that every commit check calls. Spec 006 R1 gives
   the reason: "under `claim_checks=log` the claim decision only records, so the shim decision cannot rely on it
   having refused a staging flag" (`dev/alq-review/specs/006-shim-check-gate/research.md:17`).
5. **Not checked.** A commit with nothing staged, and a commit that concludes a merge, cherry-pick or revert.
   `worktree.concluding` gives the reason for the second: "its content was settled by that operation"
   (`plugins/alq-review/scripts/worktree.py:271`).

**Recorded exception.** What a repo's own commit hook rewrites during the commit is not checked again, and the
push is not gated. This is a user decision of 2026-10-02 (spec 005 R11,
`dev/alq-review/specs/005-claim-check-gate/research.md:190`): such hooks "are cosmetic checks and validations".

**Not in this record:** what a hold or a chain is keyed on, which commands count as a commit (record 0006), and
how long a release lasts.

## Options considered

### Option A: Key by the staged tree, and let only `cd` share the commit's command (chosen)

| Dimension | Assessment |
|---|---|
| What was checked is what lands | Yes, short of the recorded exception |
| Rule the refusal states | Closed: "run `git commit` alone" |
| Existing tools | `git write-tree`; spec 005 R2 found no tool that maps a commit command to its tree |
| Hand-rolled | Splitting a command into segments, and reading `git commit`'s staging flags |
| Cost | Two commands for each commit, and some harmless command forms are refused |

### Option B: Do nothing: read the index when the hook runs, whatever shares the command

Rejected: this is the defect E4 describes. The hook reads the tree before an earlier `git add` in the same
command has run.

### Option C: Refuse only a command that holds something able to change the index

This was the first wording of R2 and E4's first suggestion (`add`, `rm`, `reset`, `restore`, `stash`).
Rejected by the second critique (E10,
`dev/alq-review/specs/005-claim-check-gate/critiques/critique-20261002-060138.md:86`), which calls it "an
open-ended list to maintain" and asks for the rule the refusal already states.

### Option D: Check at the review round launch, where the content is exact

Spec 004 R7 proposed this (`dev/alq-review/specs/004-spec-folder-checks/research.md:142`), and its R9 runs the
settled-design check when the first internal round launches. Specs 005 and 006 require the commit itself to
be refused (FR-001 of each). No reason is recorded in their research for not using the round launch.

### Option E: Check again after the commit, before the push

Replaced by the recorded exception. Spec 005 R11: "Re-checking cosmetic changes costs a check and adds a push
gate for no claim the hooks write" (`dev/alq-review/specs/005-claim-check-gate/research.md:195`).

## Trade-offs

- An agent stages in one command and commits in the next. `git add -A && git commit` and `git commit -a` are
  refused.
- The closed rule refuses forms that cannot change the index. `test_a_commit_stands_alone_only_after_cd`
  (`dev/alq-review/tests/test_shell.py:109`) asserts that `git commit -m x 2>&1 | tail -3` and
  `git commit -m x; echo done` are not `alone`.
- Any restaging gives a new tree id, so it needs a new check.
- Tracked files with unstaged changes stop a check from starting. The author stages or discards them first.
- A commit hook that rewrites files lands content no check read.

## Consequences

- Easier: a later commit-time check gets the same guarantee by calling `commit_preconditions` and keying its
  record on the staged tree.
- Harder: spec 004 says the opposite in two places. Its R7 and R9 call commit content unreadable, and its FR-003
  still requires three checks to refuse a commit (`dev/alq-review/specs/004-spec-folder-checks/spec.md:169`)
  while the spec is a Draft (`spec.md:5` of that folder). A reader of spec 004 alone would conclude that no
  commit-time check can be exact.
- **How we would know this was wrong:** a commit lands, with the check's setting on `enforce`, whose tree has no
  complete check record; or agents are refused for sharing the command so often that the two-command form is
  seen as the main cost of the gate; or a repo's commit hook is found to write claims or code, not only cosmetic
  changes.
- Revisit if: the hook can run after the earlier parts of a command, or Claude Code offers a way to read the
  tree a commit command will record.

## Action items

1. [ ] The ratifier accepts this record, or sends it back.
2. [ ] Note in spec 004 (R7, R9, FR-003) that spec 005 R2 overtook the finding that commit content cannot be
   read, in a PR of its own.
3. [ ] A new commit-time check calls `claimcheck.commit_preconditions` and keys its record on the staged tree.
