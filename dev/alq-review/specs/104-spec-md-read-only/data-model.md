# Data model: spec.md is read-only on a story branch

## A spec.md, a story branch, a spec branch (pure, `specbinding.py`)

| Term | Function | Examples |
|---|---|---|
| A spec.md | `spec_md_folder(path)` → the folder when `path` is `<folder>/spec.md` and `shape_problem(folder)` is None | `dev/x/specs/123-login/spec.md` → `dev/x/specs/123-login`; `docs/spec.md`, `dev/x/specs/123-login/plan.md` → None |
| Story branch | `story_issue(branch)` → the issue when `branch` matches `^(\d+)-us\d+-` | `123-us2-reset` → `123`; `123-spec`, `123-retire-spec`, `123-adr-hold`, `main`, `feat/1-demo` → None |
| Spec branch | `<issue>-spec`, written into every next step from `story_issue` | `123-spec` |

`path` is repo-relative, as git names it. The gate resolves an edit's or a command's path against its checkout
(`worktree.locate`) before asking. A path in a rebase worktree, which is detached, is located as the branch of the
ledger whose `rebase` record names that worktree (R6), so the story rule and the lock hold there as in the story
checkout.

## Ledger doc, per PR (`ledgers (repo, pr) -> doc`)

| Field | Set by | Read by | Gone |
|---|---|---|---|
| `spec` | the first review-round launch that opens a round (`null` or the folder) | `_spec_step` (bind), `_assess_spec_step`, `briefs.bound_spec`, `policy.review_call`, `_rebase` | – |
| `rebase` = `{onto, worktree, lease, at}`, and `rebased` once the rebase completes | `_rebase` at step 12, before it adds the worktree (`worktree` its path, `lease` the `<sha>` of step 8); `rebased`, the worktree's HEAD, saved at step 13 before the push | `policy.rebase_admits`, `on_agent`, the gate's locate of a path (a path in `worktree` is on the record's branch), `after_bash`, `_rebase` | popped with its worktree removed: by the release (step 15), by a stop of the finish at step 10 or 11, by step 12's failed add or spec.md conflict, by step 13's refused push, by an admitted `rebase-abort`, and by step 4 when the push did not land; kept when step 14 or a removal exits non-zero, or step 4's fetch fails. The story branch never moves before step 14, so the record never holds anything to undo |
| `regraded_from` | the release by `rebase <ref>` (step 15), `len(rounds)` then: the index of the first round after it | `facts.round_facts` (`first_reviewed`, `base`, `earlier` for `count_not_falling`, `seen` for `repeat_unit`, so `burden`) and `policy.launch_round` (`done`), each reading only `rounds[regraded_from:]`; not the round caps or `briefs.brief`'s `earlier_rounds` (R15) | –; absent reads as 0; `unlock <ref>` leaves it; not `epoch`, which an escalation audit advances (R15) |
| `unlocked_at`, `unlocks[]` | `ledger.unlock`, by `unlock <ref>` and by `rebase <ref>` | `ledger.released` | – |
| `spec_blob`, `spec_held` | nothing | nothing | deleted; a stored one is ignored |

| State of a PR | Review-round launch with value v | Assess-round launch |
|---|---|---|
| no `spec` key | v parsed and shaped; for a folder, `spec.md` present at the reviewed commit; the round opens and `spec = v` in the same save | refused: no round awaits assessment |
| `spec != v` | refused naming both; nothing changes | – |
| `spec == v`, folder | `spec.md` present at the reviewed commit, whatever its text; the round opens | the same presence check |
| `spec == v == null` | the round opens | opens |

## Shell actions (`shell.Action`)

| kind | fields | Judged by |
|---|---|---|
| `commit` | `cwd, staging, alone` | story rule on `worktree.to_commit` (first), then claim and shim gates |
| `push`, `rerequest`, `ready` | as today | `policy.mutation` / `rerequest` / `mark_ready`; `ready` then the diff check |
| `unlock` | as today | refused to agents |
| `write` | `cwd, paths=(path,)`, one per written path | story rule, each path against its own checkout |
| `add` | `cwd, paths` | `rebase_admits` (resolver, unmerged paths, no spec.md), else `mutation` |
| `rebase-continue`, `rebase-abort` | `cwd` | `rebase_admits` (resolver, a recorded rebase), else `mutation`; `after_bash` finishes or clears |

The written paths of a segment, by the spec's table:

| Form | Written paths |
|---|---|
| `>`, `>>`, `&>`, `n>` | the target, attached or the next word |
| `tee` | every non-option word |
| `cp` | the last non-option word |
| `mv`, `rm` | every non-option word |
| `truncate` | every non-option word after `-s <size>` / `--size=<size>` |
| `sed`, `perl` with `-i`, `-i<suffix>` or `--in-place` | every non-option word |
| `git rm`, `git mv` | every non-option word after the verb |
| `git checkout` | the words after `--` |
| `git restore` | every non-option word after the verb, except the value of `-s` / `--source` |

## The rebase (`gate._rebase`, from `rebase <ref>`)

Read only when the whole prompt, trimmed, is `rebase <ref>`; any other prompt starting with `rebase` gets no reply
(None). The git subprocesses run with `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`. The story
branch and its checkout (`root`) are never changed before the push has landed: the rebase runs in a throwaway
worktree, detached, at `<worktree>` = `<git-common-dir>/alq-rebase/<branch>`.

| Step | Fact | Stop reply (lock stays) |
|---|---|---|
| 1 | `ref` names one locked ledger with a `RESHAPE_SPEC` ruling | names none / several / not a `RESHAPE_SPEC` lock |
| 2 | `state["spec"]` is a folder | no spec: close the PR and restart on a PR bound to a spec |
| 3 | the locked round's `root` exists and is on `state["branch"]` | the checkout is missing or on another branch |
| 4 | no `rebase` recorded | a rebase in progress in the record's `worktree`: the dispatch reply again (R10); none: "A recorded rebase found again" below |
| 5 | `rebasing(root)` is None: no rebase is in progress in the story checkout | one is, which no `rebase <ref>` started: names it: run `git rebase --abort` in `<root>`; nothing else runs |
| 6 | the checkout is clean | the checkout is dirty |
| 7 | `github.default_branch` gives `<default>` and `github.pr_target` the PR's base, and the base is `<default>` | gh's words; a stacked story PR: land the parent PR first |
| 8 | `fetch_target` brings `origin/<default>` and `origin/<branch>`; `<sha>` is `origin/<branch>` as fetched | git's words |
| 9 | `origin/<branch>` is an ancestor of HEAD: the remote has no commit the checkout lacks | the remote has commits this checkout lacks: pull them, then type `rebase <ref>` again |
| 10 | `tree_blob(spec.md)` at `origin/<default>` is not None | the bound spec.md is missing on `<default>`: the binding never changes; close this PR and restart the story on the new folder |
| 11 | `tree_blob(spec.md)` at `origin/<default>` ≠ at the locked round's `head_sha` | the spec PR has not reached `<default>` |
| 12 | `rebase` recorded as `{onto, worktree, lease: <sha>, at}`; `git worktree add --detach <worktree> HEAD` in `root` exits 0; `git -c core.editor=true rebase refs/remotes/origin/<default>` in `<worktree>` exits 0 | the add exits non-zero: git's words, `rebase` popped; conflict in a spec.md: `git rebase --abort`, the worktree removed, `rebase` popped, raise it to the user; other conflict: the record and the worktree kept, the dispatch reply naming `<worktree>` |
| 13 | `rebased = <rebased>`, the worktree's HEAD, saved in the record; then `git push --force-with-lease=<branch>:<sha> origin <rebased>:refs/heads/<branch>` in `<worktree>` exits 0 | refused: the worktree removed, `rebase` popped, git's words and `rebase <ref>` again; the story branch never moved |
| 14 | `git reset --keep <rebased>` in `root` exits 0 (`--keep` refuses rather than overwrite a local change) | the record, the worktree and the lock kept; git's words, `<rebased>`, and the manual step: `git reset --keep <rebased>` in `<root>`, then type `rebase <ref>` again |
| 15 | the release: the worktree removed; `ledger.unlock`; `regraded_from = len(rounds)`; `rebase` popped; `record("rebase", "released")` | – |

Steps 10, 11 and 13–15 are the finish; `after_bash` runs them in the record's `worktree`, with the recorded `lease` as
`<sha>`, after an admitted `rebase-continue` that completed the rebase there. A stop at step 10 or 11 in the finish
removes the worktree, pops `rebase` and gives that step's reply. A `rebase-continue` that stops again with a spec.md
unmerged is aborted as step 12 says. A worktree removal (`git worktree remove --force <worktree>`) that exits non-zero
keeps the record and the lock and replies git's words; the next `rebase <ref>` finds the record at step 4.

## A recorded rebase found again (step 4, no rebase in progress in its worktree)

A hook that ended between step 12 and step 15, or a step 14 or removal that exited non-zero, leaves the record.
`fetch_target` first brings `origin/<branch>`; a fetch that fails decides nothing: git's words, and the record, the
worktree and the lock kept. Then git as it is decides, never a cause inferred from it:

| Git now | Action | Reply |
|---|---|---|
| the record has `rebased` and `origin/<branch>` is it: the push landed | steps 14 and 15 with it as `<rebased>` | step 14's stop reply, or the pushed reply |
| anything else: no `rebased` (the push never ran), or `origin/<branch>` elsewhere | the worktree removed if present; `rebase` popped | none of its own: the steps start over from step 1 on the story branch as it was |

`rebased` is saved before the push, so a landed push always finds it, and a worktree added but never rebased, whose
HEAD is the story's own and may equal `origin/<branch>`, is never taken for one.

## What the conflict resolver may do (`policy.rebase_admits`)

Admitted only while the ledger records `rebase` and git has a rebase in progress in the record's `worktree`, and only
for `agent_type == "alq-review:conflict-resolver"`, whose dispatch `on_agent` admits only when its prompt, trimmed,
equals that worktree:

| Action | Condition |
|---|---|
| `Edit` / `Write` / `NotebookEdit` of a path | the path is in the worktree, unmerged there (`git diff --name-only --diff-filter=U`) and no spec.md |
| `git add -- <paths>`, alone | every path is unmerged and none is a spec.md (`spec_md_folder`) |
| `git rebase --continue`, alone | – |
| `git rebase --abort`, alone | – |

Everything else by the resolver, and all of the above by anyone else, is judged as today: `mutation` refuses it on the
locked branch, to which a path in the worktree is located, and the Bash watch catches a move.

## The mixed-diff rule (`specbinding.mixed_diff_refusal`)

Input: `[(status, path)]`, status one of git's `A M D R C T`; `worktree.name_status` strips the score from `R<score>` and
yields the destination path. For each `(s, p)` with `s != "D"` and `spec_md_folder(p)` set, the first `(_, q)` with `q` not
under that folder refuses. Readers of the fact:

| Site | Reader | Base |
|---|---|---|
| review-round launch, any stage | `worktree.name_status(root, base)` | `_review_base`, as the round's `base_sha` |
| attestation (`ready`) | `github.pr_files(slug, pr)`: GitHub `added→A`, `modified`/`changed→M`, `removed→D`, `renamed→R`, `copied→C`; None at 3000 files, GitHub's cap, so the ready is refused | the PR's base, as GitHub diffs it |
