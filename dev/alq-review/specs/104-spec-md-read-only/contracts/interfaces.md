# Interfaces: spec.md is read-only on a story branch

Every refusal below is a test written to fail first. `<ref>` is `policy.unlock_ref(state)`: `#<pr>`, or the branch with no PR.
`<issue>-spec` is written from `story_issue(branch)`; when the branch is not a story branch, "the issue's spec branch".

## The edit rule (US1)

Site: `Edit`, `Write`, `NotebookEdit` (`on_edit`), through `hookio.refuse`, action `spec-edit`, under `mode`: in `log` mode
recorded as `would_deny`, nothing blocked.

> `<path>` is the spec.md of spec folder `<folder>`, and `<branch>` is a story branch: a story branch never changes a
> spec.md. Next step: stop and raise the spec problem to the user. They land the change in a spec-only PR on
> `<issue>-spec`; once it merges, this branch rebases on it.

Not refused by this rule: any file but a spec.md; any branch but a story branch; a detached HEAD; a path outside any
checkout; a Bash command or a commit, whatever it writes. A spec.md change that reaches a story PR by those routes is
refused at the next launch (the diff check).

## The binding (US2)

```
Workflow(name='alq-review:review-round', args={worktree: '<absolute worktree path>', stage: 'internal'|'audit', spec: '<spec folder>' | null})
Workflow(name='alq-review:assess-round', args={worktree: '<absolute worktree path>'})
```

Refusals, in order (019's rows 1–6 unchanged; row 7, the hold, deleted):

| # | Input | Refusal names |
|---|---|---|
| 1–3 | missing `spec`; neither null nor a non-empty string; a folder of the wrong shape | as today |
| 6 | a value different from the binding | both values; the bound value never changes |
| 4–5 | `<folder>/spec.md` missing or empty at the reviewed commit; git fails reading it | step "spec.md", the path (assess: restore it with the user's commit) |
| 8 | the diff changes a spec.md and a file outside its folder (US4, review-round only) | below |

The ledger holds `spec` and nothing of the file. A lock reason names a `RESHAPE_SPEC`, `ESCALATE` or spent-audit hold only.

## `rebase <ref>` (US3)

The reply of each check of data-model "`rebase <ref>`", as `additionalContext` and `systemMessage`. `<sha>` is the commit
the failing read named: `<onto>` or the locked round's `head_sha`.

| Check | Reply |
|---|---|
| `names` | as `unlock`'s replies, with `rebase` |
| `ruling` | `rebase` releases a RESHAPE_SPEC lock after a spec change; this branch is held by <hold>. Next step: `unlock <ref>` once the user has decided. |
| `bound` | This PR has no spec, so no spec change can reach it. Close it and restart the work on a new PR bound to a spec that settles the decision. |
| `checkout` | `<root>`, where round <n> ran, is gone. Next step: check `<branch>` out there, then type `rebase <ref>` again. |
| `default`, `fetch`; `base`, `onto spec.md`, `head spec.md` when gh or git fails | `rebase <ref>` could not <read the default branch / read the PR's base / fetch `<default>` / read `<spec>/spec.md` at `<sha>`>: <gh's or git's words>. The lock stays. Next step: fix what they name, then type `rebase <ref>` again. |
| `base` | `rebase` checks the spec on `<default>`, and this PR's base is `<base>`, a parent story branch the spec PR never reaches. Next step: merge the parent PR, retarget this PR to `<default>` (`gh pr edit --base <default>` in `<root>`), then type `rebase <ref>` again. |
| `onto spec.md` | `<spec>/spec.md` is missing or empty on `<default>`, and this PR's binding to `<spec>` never changes. Next step: close this PR and restart the story on the new folder. |
| `changed` | The spec PR has not reached `<default>`: `<spec>/spec.md` there is the one round <n> reviewed. Next step: land the spec change as a spec-only PR on `<issue>-spec` and type `rebase <ref>` once it merges, or type `unlock <ref>` if the spec stands. |
| `release` | The user released `<ref>` for the spec change on `<default>` at `<onto>`: every hold named before is released. Next step, without asking the user: in `<root>`, rebase `<branch>` onto `origin/<default>`; if it stops on conflicts, dispatch `Agent(subagent_type='alq-review:conflict-resolver', prompt='<root>')`, and if it reports the rebase aborted, raise its report to the user and stop; push with `git push --force-with-lease`; then launch the next round, a full round that grades against `<spec>/spec.md` as the branch then has it. |
| `rebased_onto` not contained | `rebase <ref>` released this branch for the spec on `origin/<default>` at `<onto>`, and HEAD does not contain that commit, so a round would grade the old code against the new spec. Next step: rebase onto `origin/<default>` first, push with `git push --force-with-lease`, then launch again. |
| `contains` raises at a review-round launch | git's words, as `_review_base`'s refusal gives them |

`unlock <ref>` on a `RESHAPE_SPEC` lock: the reply carries the ruling as today, and names `<issue>-spec` as where a
rescope runs.

### The conflict resolver

`agents/conflict-resolver.md`: name `conflict-resolver`; tools Read, Grep, Glob, Edit, Bash. The session dispatches it when its
rebase after `rebase <ref>` stops on conflicts, with the checkout where the rebase stopped as its prompt. It reads `git status`
and `git diff` there, edits each unmerged file so that both sides' intent survives, `git add -- <file>`, `git rebase
--continue`, and repeats while the rebase stops. It never edits a spec.md and never runs `git rebase --skip`. A spec.md among
the unmerged files, or a file it cannot resolve: it runs `git rebase --abort` and reports the files, for the session to raise
to the user.

## The diff check (US4)

Site: a review-round launch of any stage, through `hookio.refuse` under `mode`. Where it reads its diff: data-model
"The diff check".

| Reply | Text |
|---|---|
| `mixed` | This PR's diff changes `<spec.md>` and `<other path>`, which is outside `<folder>`: a PR changes the spec or the code, never both. Next step: land the spec change as a spec-only PR on `<issue>-spec`, rebase this branch on it, then launch again. |
| `folders` | This PR's diff changes `<spec.md>` and files of another spec folder, `<other folder>`: a spec-only PR changes one spec folder. To move a folder, split it in two PRs: one adds `<folder>`; a later one deletes `<other folder>` and updates its citations. Next step: split this PR, then launch again. |

Passes: a spec-only PR of one folder (any `spec`); code with `plan.md`, `tasks.md` or any file of the folder but `spec.md`;
a deleted spec.md with code.

## `/alq-plan:issue-spec rescope <spec folder> #<issue>` (US5)

| Situation | Behaviour |
|---|---|
| no `<issue>-spec` worktree | created per the repo's branch rules off the default branch |
| a local or remote `<issue>-spec` merged into the default branch | stop before any write, naming it; ask the user to delete it |
| run completes | commit and push on `<issue>-spec`; `Spec folder: <path>`, `Branch: <issue>-spec`, then once: open the spec-only PR, approve it, type `rebase <ref>` for the story branch, relaunch the review |

## Hooks

`hooks.json` is unchanged: no new hook and no new timeout.
