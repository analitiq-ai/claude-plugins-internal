# Data model: spec.md is read-only on a story branch

## A spec.md, a story branch, a spec branch (pure, `specbinding.py`)

| Term | Function | Examples |
|---|---|---|
| A spec.md | `spec_md_folder(path)` → the folder when `path` is `<folder>/spec.md` and `shape_problem(folder)` is None | `dev/x/specs/123-login/spec.md` → `dev/x/specs/123-login`; `docs/spec.md`, `dev/x/specs/123-login/plan.md` → None |
| Story branch | `story_issue(branch)` → the issue when `branch` matches `^(\d+)-us\d+-` | `123-us2-reset` → `123`; `123-spec`, `123-retire-spec`, `123-adr-hold`, `main`, `feat/1-demo` → None |
| Spec branch | `<issue>-spec`, written into every next step from `story_issue` | `123-spec` |

`path` is repo-relative, as git names it. The gate resolves an edit's or a command's path against its checkout
(`worktree.locate`) before asking.

## Ledger doc, per PR (`ledgers (repo, pr) -> doc`)

| Field | Set by | Read by | Gone |
|---|---|---|---|
| `spec` | the first review-round launch that opens a round (`null` or the folder) | `_spec_step` (bind), `_assess_spec_step`, `briefs.bound_spec`, `policy.review_call`, `_rebase` | – |
| `rebase` = `{onto, from, lease, at}` | `_rebase`, before it runs `git rebase` (`from` the HEAD before it, `lease` the `<sha>` of step 8) | `policy.rebase_admits`, `on_agent`, `after_bash`, `_rebase` | popped on the release; on a refused push or a stop in the finish, after `git reset --keep <from>`; on an abort; and by a `rebase <ref>` that finds it with no rebase in progress, after `git reset --keep <from>` |
| `regraded_from` | the release by `rebase <ref>` (step 14), `len(rounds)` then: the index of the first round after it | `facts.round_facts` (`first_reviewed`, the original base, every `..HEAD` range), `policy.launch_round` (no `delta_from` from a round before it) | –; absent reads as 0; `unlock <ref>` leaves it; not `epoch`, which an escalation audit advances (R15) |
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

Read only when the whole prompt, trimmed, is `rebase <ref>`; any other prompt starting with `rebase` gets no reply (None).
The git subprocesses run with `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`.

| Step | Fact | Stop reply (lock stays) |
|---|---|---|
| 1 | `ref` names one locked ledger with a `RESHAPE_SPEC` ruling | names none / several / not a `RESHAPE_SPEC` lock |
| 2 | `state["spec"]` is a folder | no spec: close the PR and restart on a PR bound to a spec |
| 3 | the locked round's `root` exists and is on `state["branch"]` | the checkout is missing or on another branch |
| 4 | `rebase` recorded | with `rebasing(root)` set, the dispatch reply again (R10); with none in progress (a hook killed between its rebase and its push), no reply: `git reset --keep <from>` in `root`, `rebase` popped, and the steps start over from step 1 |
| 5 | `rebasing(root)` set and no `rebase` recorded (a rebase no `rebase <ref>` started) | names it: run `git rebase --abort` in `<root>`; nothing else runs |
| 6 | the checkout is clean | the checkout is dirty |
| 7 | `github.default_branch` gives `<default>` and `github.pr_target` the PR's base, and the base is `<default>` | gh's words; a stacked story PR: land the parent PR first |
| 8 | `fetch_target` brings `origin/<default>` and `origin/<branch>`; `<sha>` is `origin/<branch>` as fetched | git's words |
| 9 | `origin/<branch>` is an ancestor of HEAD: the remote has no commit the checkout lacks | the remote has commits this checkout lacks: pull them, then type `rebase <ref>` again |
| 10 | `tree_blob(spec.md)` at `origin/<default>` is not None | the bound spec.md is missing on `<default>`: the binding never changes; close this PR and restart the story on the new folder |
| 11 | `tree_blob(spec.md)` at `origin/<default>` ≠ at the locked round's `head_sha` | the spec PR has not reached `<default>` |
| 12 | `rebase` recorded as `{onto, from, lease: <sha>, at}`, then `git rebase origin/<default>` exits 0 | conflict in a spec.md: `git rebase --abort`, `rebase` popped, raise it to the user; other conflict: the record kept, the dispatch reply |
| 13 | `git push --force-with-lease=<branch>:<sha> origin <branch>` exits 0 | `git reset --keep <from>` in `root`, `rebase` popped; git's words, then type `rebase <ref>` again |
| 14 | `ledger.unlock`; `regraded_from = len(rounds)`; `rebase` popped; `record("rebase", "released")` | – |

Steps 10, 11, 13 and 14 are the finish; `after_bash` runs them, with the recorded `lease` as `<sha>` and the recorded
`from`, after an admitted `rebase-continue` that completed the rebase. Every way out of the finish pops `rebase`, and a
stop at step 10, 11 or 13 first runs `git reset --keep <from>` in `root`: the next `rebase <ref>` judges step 9 on the
HEAD before the rebase, never on the rewritten one, of which no tip recorded before the rebase is an ancestor. A
`rebase-continue` that stops again with a spec.md unmerged is aborted as step 12 says.

## What the conflict resolver may do (`policy.rebase_admits`)

Admitted only while the ledger records `rebase` and git has a rebase in progress in the round's root, and only for
`agent_type == "alq-review:conflict-resolver"`, whose dispatch `on_agent` admits only when its prompt, trimmed, equals that
root:

| Action | Condition |
|---|---|
| `Edit` / `Write` / `NotebookEdit` of a path | the path is unmerged (`git diff --name-only --diff-filter=U`) and is no spec.md |
| `git add -- <paths>`, alone | every path is unmerged and none is a spec.md (`spec_md_folder`) |
| `git rebase --continue`, alone | – |
| `git rebase --abort`, alone | – |

Everything else by the resolver, and all of the above by anyone else, is judged as today: `mutation` refuses it on the locked
branch and the Bash watch catches a move.

## The mixed-diff rule (`specbinding.mixed_diff_refusal`)

Input: `[(status, path)]`, status one of git's `A M D R C T`; `worktree.name_status` strips the score from `R<score>` and
yields the destination path. For each `(s, p)` with `s != "D"` and `spec_md_folder(p)` set, the first `(_, q)` with `q` not
under that folder refuses. Readers of the fact:

| Site | Reader | Base |
|---|---|---|
| review-round launch, any stage | `worktree.name_status(root, base)` | `_review_base`, as the round's `base_sha` |
| attestation (`ready`) | `github.pr_files(slug, pr)`: GitHub `added→A`, `modified`/`changed→M`, `removed→D`, `renamed→R`, `copied→C`; None at 3000 files, GitHub's cap, so the ready is refused | the PR's base, as GitHub diffs it |
