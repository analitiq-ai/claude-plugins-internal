# Quickstart: validating builder's rebuilt issue-tackle

## Prerequisites

- #174's carrier merged (orchestrator plugin with `core` link), core B0–B7 (US1) merged, the reviewer work for ADR-0014 d1 and ADR-0017 merged, the
  constitution amendment (R15) merged.
- Node ≥ 22.18; `npm ci` in `core/`, `builder/plugin/`, `builder/`.

## 1. Carrier and tests (US2)

```
node core/scripts/check-carriers.ts --base origin/main     # from the repo root
npm test --prefix builder
```

Expect: `N carriers checked against origin/main, 0 failures`, builder among them (SC-001); builder's suite
passes; `builder/tests/` holds no `.py` (SC-005). With `zod` removed from `builder/plugin/node_modules`, running
the step script exits 2 with `core dependency zod is not installed in …/builder/plugin` (US2 #2).

## 2. Step decisions (US3–US5), offline

`builder/tests/step.test.ts` drives `decideStep` over `StepFacts` for each row of data-model.md's decision
order: the 16 stop states of SC-002, the 4 PR states of SC-003 (each run twice, same answer), and the merge
reasons of US5 #1–#3. `builder/tests/facts.test.ts` runs the reads against core's fake GitHub and a scratch
repository (`planner/tests/support/checkout.ts`): a Ready story with no branch is cut from the default branch in
`../<repo>.worktrees/<branch>`; a `docs/adr/` change on the default branch names `merge` before any folder
check; a story with commits on a local branch only reuses that branch.

## 3. Skill text

`builder/tests/skill.test.ts`: the skill takes `<s>` alone and names the script; it names no `spec=`,
`branch=`, `root-cause-check`, planning command, `git push`, `rebase`, `--force`, `gh pr`; no command reads a
value inside its arguments; `root-cause-check` appears in no tracked file outside `specs/` and `**/docs/adr/`.

## 4. On the agent machine

1. `/codeworks <s>` for a Ready story with no branch: the hook names `builder:issue-tackle <s>`; the step prints
   `implement`; the worktree `../<repo>.worktrees/<s>-us<k>-<slug>` exists on a branch cut from the default
   branch; each task's code commit is followed by a tick-only commit; the round ends clean and the turn ends
   with nothing pushed by the model; the Stop hook opens the draft.
2. Move the card to Blocked and name the step again: it stops naming Blocked; `git status` and GitHub unchanged.
3. Merge a `docs/adr/` change to the default branch, then name the step: it prints `merge`; after the skill's
   merge, every earlier pushed head is an ancestor of the new head (`git merge-base --is-ancestor`, SC-004).
4. Record the skill's first Bash call: `${CLAUDE_SESSION_ID}` and `${CLAUDE_PLUGIN_ROOT}` were substituted (R4).
