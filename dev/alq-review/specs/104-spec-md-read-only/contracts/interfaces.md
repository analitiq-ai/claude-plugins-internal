# Interfaces: spec.md is read-only on a story branch

Every refusal below is a test written to fail first. `<ref>` is `policy.unlock_ref(state)`: `#<pr>`, or the branch with no PR.
`<issue>-spec` is written from `story_issue(branch)`; when the branch is not a story branch, "the issue's spec branch".

## The story rule (US1), one text at three sites

Sites: `Edit`, `Write`, `NotebookEdit` (`on_edit`); a Bash `write` action (`on_bash`); a `commit` action, on the paths it
would record (`on_bash`, before the claim and shim gates). All through `hookio.refuse`, action `spec-write` (`commit` for the
third), under `mode`: in `log` mode recorded as `would_deny`, nothing blocked.

| Site | Refusal text |
|---|---|
| edit, Bash write | `<path>` is the spec.md of spec folder `<folder>`, and `<branch>` is a story branch: a story branch never changes a spec.md. Next step: stop and raise the spec problem to the user. They land the change in a spec-only PR on `<issue>-spec`; once it merges, this branch rebases on it. |
| commit | `<path>`, the spec.md of spec folder `<folder>`, is staged for this commit, and `<branch>` is a story branch: a story branch never changes a spec.md. Put it back: `git restore --staged --worktree -- <path>`, or for a file HEAD does not hold, `git rm --cached -- <path>` and delete it. Then raise the spec problem to the user: they land the change in a spec-only PR on `<issue>-spec`; once it merges, this branch rebases on it. |

Not refused by this rule: any file but a spec.md; any branch but a story branch; a Bash command with no `write` action
(`cat`, `grep`, `git diff`, `git show`, `git log`); a path outside any checkout. A path in the detached worktree a
`rebase <ref>` rebases in is on the branch of the ledger whose `rebase` record names that worktree (data-model).

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
| 8 | the diff mixes a spec.md and code (US4, review-round only) | below |

The ledger holds `spec` and nothing of the file. A lock reason names a `RESHAPE_SPEC`, `ESCALATE` or spent-audit hold only.

## `rebase <ref>` (US3)

Matched only when the whole prompt, trimmed, is `rebase <ref>`; any other prompt that starts with `rebase` gets no reply (the
hook returns None). Replies go back as `additionalContext` and `systemMessage`. `<default>` is the repo's default branch
(`gh repo view --json defaultBranchRef`), never the PR's base. The git subprocesses run with `GIT_TERMINAL_PROMPT=0` and
`GIT_SSH_COMMAND='ssh -o BatchMode=yes'`.

| Case | Reply | Lock |
|---|---|---|
| names no locked PR / several | as `unlock`'s replies, with `rebase` | stays |
| the lock is not a `RESHAPE_SPEC` ruling | `rebase` releases a RESHAPE_SPEC lock after a spec change; this branch is held by <hold>. Next step: `unlock <ref>` once the user has decided. | stays |
| bound to `null` | This PR has no spec, so no spec change can reach it. Close it and restart the work on a new PR bound to a spec that settles the decision. | stays |
| checkout missing / on another branch / dirty | names the root and what to do (check `<branch>` out there; commit or discard the changes) | stays |
| a rebase in progress in `<root>` with no `rebase` record (one no `rebase <ref>` started) | A rebase is in progress in `<root>` that no `rebase <ref>` recorded, so nothing was run. Ask the user to run `git rebase --abort` in `<root>`, then type `rebase <ref>` again. | stays |
| a `rebase` record with no rebase in progress in its worktree (a hook that ended before the release, or a step that exited non-zero) | data-model "A recorded rebase found again": `origin/<branch>` at the recorded `rebased` → the story checkout moved to it and released: the pushed reply, or the checkout-not-moved reply; otherwise → none of its own: the worktree removed, and the keyword starts over from its first check; the fetch fails → git's words | released, `rebase` popped / as the run ends, `rebase` popped / stays, `rebase` kept |
| gh (the default branch or the PR's base) or git fetch fails | their words, as `_unknown_pr` gives them | stays |
| the PR's base is not `<default>` (a stacked story PR) | `rebase` rebases on `<default>`, and this PR's base is `<base>`, a parent story branch the spec PR never reaches. Next step: land the parent PR first, then type `rebase <ref>` again. | stays |
| `origin/<branch>` is not an ancestor of HEAD | The remote `<branch>` has commits this checkout lacks, so nothing was rebased. Pull them in `<root>`, then type `rebase <ref>` again. | stays |
| `<spec>/spec.md` is missing at `origin/<default>` (a rescope moved or deleted the folder) | `<spec>/spec.md` is missing on `<default>`, and this PR's binding to `<spec>` never changes. Next step: close this PR and restart the story on the new folder. | stays |
| `<spec>/spec.md` at `origin/<default>` equals the one at the locked round's commit | The spec PR has not reached `<default>`: `<spec>/spec.md` there is the one round <n> reviewed. Land the spec change as a spec-only PR on `<issue>-spec`, and type `rebase <ref>` once it merges. | stays |
| `git worktree add --detach <worktree> HEAD` exits non-zero | `git worktree add` of `<worktree>` exited non-zero: <git's words>. Nothing was rebased. | stays; `rebase` popped |
| rebase stops with a spec.md among the conflicts | The rebase of `<branch>` on `<default>` stopped on a conflict in `<spec.md>`, which no agent resolves, so it was aborted; `<branch>` was not changed. Raise it to the user: <files>. | stays; the worktree removed, `rebase` popped |
| rebase stops on other conflicts | The rebase of `<branch>` on `<default>`, in the worktree `<worktree>`, stopped on conflicts in <files>. Dispatch now, without asking the user: `Agent(subagent_type='alq-review:conflict-resolver', prompt='<worktree>')`. It resolves them and continues the rebase there; `<branch>` is not changed until the rebase is pushed, the lock stays until then, and only its changes to those files are admitted. | stays; `rebase`, recorded before the rebase, and the worktree kept |
| recorded rebase still in progress in its worktree | the dispatch reply again | stays |
| push refused | `git push --force-with-lease=<branch>:<sha> origin <rebased>:refs/heads/<branch>` was refused: <git's words>. Nothing was forced, and `<branch>` in `<root>` is at `<head>`, as before `rebase <ref>`. Type `rebase <ref>` again. | stays; the worktree removed, `rebase` popped |
| pushed, and `git reset --keep <rebased>` in `<root>` exits non-zero | `<rebased>` was pushed to `<branch>` on origin, and `git reset --keep <rebased>` in `<root>` exited non-zero: <git's words>. Next step: ask the user to run `git reset --keep <rebased>` in `<root>`, then type `rebase <ref>` again. | stays; `rebase` (with `rebased`) and the worktree kept |
| a worktree removal (`git worktree remove --force <worktree>`) exits non-zero | `git worktree remove --force <worktree>` exited non-zero: <git's words>. Type `rebase <ref>` again once it is removed. | stays; `rebase` kept |
| pushed and the checkout moved (rebased or already up to date), also when found again | The user rebased `<branch>` on `<default>` and released <repo>#<pr>: every hold named before is released, and the next round is a full round that grades against `<spec>/spec.md` as the branch now has it. | released; the worktree removed, `rebase` popped; `regraded_from` set |

`unlock <ref>` on a `RESHAPE_SPEC` lock: released with no rebase and no spec check; the reply carries the ruling as today, and
names `<issue>-spec` as where a rescope runs.

### The conflict resolver

`agents/conflict-resolver.md`: name `conflict-resolver`; tools Read, Grep, Glob, Edit, Bash; dispatched only when the gate's
reply says so. Its prompt is the rebase worktree the reply names. It reads `git status` and `git diff` there, edits each
unmerged file so that both sides' intent survives, `git add -- <file>`, `git rebase --continue`, and repeats while the rebase
stops; it never edits a spec.md, never runs `git rebase --skip`, and when it cannot resolve a file it runs `git rebase --abort`
and reports the files.

| Event | Gate's answer |
|---|---|
| `Agent(subagent_type='alq-review:conflict-resolver')` with no recorded rebase in progress | refused: Only the user's `rebase <ref>` starts a rebase; nothing is in progress to resolve. |
| the same, with a prompt other than the recorded rebase's worktree | refused: The conflict resolver is dispatched with the worktree the gate's reply names, `<worktree>`, and nothing else. |
| resolver edits an unmerged non-spec.md file of the worktree | allowed |
| resolver edits any other file, or a spec.md | refused with the lock reason |
| resolver: `git add -- <unmerged, none a spec.md>`, `git rebase --continue`, `git rebase --abort`, alone | allowed; not watched |
| resolver: `git add -- <paths>` naming a spec.md | refused with the lock reason |
| anyone else, or not alone: the same | judged by `mutation`; a move is caught by the watch |
| PostToolUse of an admitted `--continue`, rebase finished | the finish in the worktree: spec check, `rebased` saved, push with the recorded lease, the story checkout moved to `<rebased>`, release; `systemMessage` as the pushed reply, or a stop's reply: at the spec check that step's reply, the worktree removed and `rebase` popped; the push-refused reply; the checkout-not-moved reply |
| PostToolUse of an admitted `--continue`, stopped again on no spec.md | `systemMessage`: The rebase stopped again on <files>; resolve them and continue. |
| PostToolUse of an admitted `--continue`, stopped again with a spec.md unmerged | the hook runs `git rebase --abort`, removes the worktree and pops `rebase`; `systemMessage`: the spec.md-conflict reply above. |
| PostToolUse of an admitted `--abort` | the worktree removed, `rebase` popped; `systemMessage`: The rebase was aborted, `<branch>` was not changed, and the lock stays. Raise the conflicted files to the user: <files>. |

## The diff check (US4)

Sites: a review-round launch of any stage, after the review base is read; the attestation (`ready`), after `mark_ready`
allows. Both through `hookio.refuse` under `mode`.

| Text |
|---|
| This PR's diff changes `<spec.md>` and `<other path>`, which is outside `<folder>`: a PR changes the spec or the code, never both. Next step: land the spec change as a spec-only PR on `<issue>-spec`, rebase this branch on it, then <launch again / mark it ready again>. |

At the attestation, a PR file list GitHub cannot give, or one that reaches GitHub's 3000-file cap, is a diff that cannot be
verified: the ready is refused as an unknown PR is (P4).

Passes: a spec-only PR (any `spec`); code with `plan.md`, `tasks.md` or any file of the folder but `spec.md`; a deleted
spec.md with code. Refused: two spec folders' spec.md in one diff; a renamed spec folder with its citations.

## `/alq-plan:issue-spec rescope <spec folder> #<issue>` (US5)

| Situation | Behaviour |
|---|---|
| no `<issue>-spec` worktree | created per the repo's branch rules off the default branch |
| a local or remote `<issue>-spec` merged into the default branch | stop before any write, naming it; ask the user to delete it |
| run completes | commit and push on `<issue>-spec`; `Spec folder: <path>`, `Branch: <issue>-spec`, then once: open the spec-only PR, approve it, type `rebase <ref>` for the story branch, relaunch the review |

## Hooks

`hooks.json`: the UserPromptSubmit `gate.py` entry gains `"timeout": 120` (fetch, rebase, push). No new hook.
