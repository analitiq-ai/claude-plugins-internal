# Research: spec.md is read-only on a story branch

Read for this: `plugins/alq-review/scripts/{gate,policy,specbinding,ledger,briefs,hookio,shell,worktree,github,pre_merge_gate}.py`,
`hooks/hooks.json`, `agents/assessor.md`, `workflows/review-round.js`, the README, `plugins/alq-plan/skills/issue-spec/SKILL.md`,
`dev/alq-review/tests/{helpers,test_gate,test_policy,test_specbinding,test_shell,test_worktree_facts}.py`,
`dev/alq-plan/tests/{test_spec_source,test_guards}.py`, ADRs 0002, 0004, 0009, 0011, 0012, 0016–0018, the constitution, the
engineering `git-workflow.md`, and `.github/workflows/tests.yml`, all on main at `735c172`. Nothing below was run unless it
says so. The spec cites "ADR-0019 decision 1": record 0019 is not on main; it is a draft on `origin/81-adr-name-the-user-story`,
open PR #93 (`git show origin/81-adr-name-the-user-story:dev/alq-review/docs/adr/`, run, and the record read there). Its
decision 1 stands. Its decision 3 binds the `spec.md` blob and its closing line says "ADR-0016, decision 6, and ADR-0018
stand": the decision record replaces both (R1).

## R1: Shipping order: records first, then one PR per user story, stacked where a story needs another

- **Decision**: (1) the decision record, drafted from this plan with `speckit-adrkit-draft`, in its own PR on `104-adr-<slug>`,
  with the README's pointer to it; it replaces ADR-0016 decision 6 and the blob-id part of decision 4, replaces the
  `spec.md`-blob part of ADR-0019 decision 3 (open PR #93) and that record's closing line "ADR-0016, decision 6, and ADR-0018
  stand", and changes ADR-0018 so a `RESHAPE_SPEC` lock is released by `unlock <ref>` when the spec stands and by `rebase <ref>`
  after a spec change; PR #105's hand-written ADR-0020 is closed. (2) The engineering `git-workflow.md` change, in that repo:
  the spec changes through its own spec-only PR, never in a story PR. (3) Code, one PR per user story on `104-us<N>-<slug>`: US1
  (the hook and the commit backstop) off the default branch; US2 (the hold deleted) stacked on US1; US3 (`rebase`, the conflict
  resolver) stacked on US2; US4 (the diff check) and US5 (the rescope, in `alq-plan`) off the default branch. The README changes
  with the code of each story. The plugin's version moves once, in the last alq-review story to merge, and that bump turns on
  US1; alq-plan's US5 release ships no later than it.
- **Rationale**: constitution VI puts the governing record apart from the code. The spec's priorities order the stories, and US2
  says it comes after US1; US3's release reads a lock US2 reshapes. The stacking rule is git-workflow.md's. The spec.md of this
  folder never changes on these branches, so the hold that is live until US2 merges does not bite. US5's release goes first
  because the rescope route the lock text names must work the day the rule is live: a rescope in the story worktree is refused
  at its first write once US1 is on.
- **Existing tools**: `speckit-adrkit-draft` and `draft.sh`, the tools ADR-0016–0018 were written with. The git-workflow
  stacking rule, as written. The release practice the repo used for 0.12.0 and 0.13.0 (019 R2).

## R2: What a spec.md and a story branch are, defined once

- **Decision**: `specbinding.py` gains three pure functions and loses `text_step`. `spec_md_folder(path) -> str | None`: the spec
  folder of a repo-relative `path` named `spec.md` whose folder passes `shape_problem`, else None (`docs/spec.md`,
  `specs/x/plan.md` give None). `story_issue(branch) -> str | None`: the issue number of a branch named `<digits>-us<digits>-...`,
  else None. `story_write_refusal(branch, path, staged: bool) -> str | None`: the one refusal text for a write of `path` on
  `branch`, None when the branch is not a story branch or the path is not a spec.md; it names the file, the branch, the rule,
  and the next step with `<issue>-spec`, and for a staged change the restore command. The module's docstring becomes: what a
  spec folder and a spec.md are, the review-round `spec` argument, its binding, and the two rules that keep a spec.md out of a
  story PR.
- **Rationale**: the spec's Terms define a spec.md by `shape_problem`, so the rule reuses it rather than re-declaring what a
  spec folder is. One text for the three sites (R3–R5) is the spec's "the same words". P3 puts the decision in a pure function.
- **Existing tools**: `specbinding.shape_problem`, reused. `worktree.locate`, which gives the branch. A regex of the branch
  name in `gate.py`: rejected, the rule would live in a handler.

## R3: The rule on `Edit`, `Write` and `NotebookEdit`

- **Decision**: `gate.on_edit` judges the story rule right after `worktree.locate(path)` and before `target(where)`: the path
  relative to `where.root`, `where.branch`, through `specbinding.story_write_refusal`; a text refuses with `hookio.refuse(payload,
  "spec-write", text, Target(where.slug, None, where.branch, where.root))`. Nothing of the ledger or GitHub is read first.
- **Rationale**: FR-001 reads the branch and nothing from the ledger; scenario 6 has no PR and no ledger, and `target()` may ask
  GitHub. `hookio.refuse` is under `mode`, which FR-005 asks for.
- **Existing tools**: `worktree.locate`, `hookio.refuse`, `Target`, reused.

## R4: Bash writes, read by the one shell reader

- **Decision**: `shell.classify` gains the kind `write`, one `Action` per written path, with a new field `paths: tuple[str, ...]`
  holding the path as written. The paths a segment writes, by the spec's table: a redirection target (`>`, `>>`, `&>`, `n>`,
  attached or as the next word); `tee`'s non-option words; the last non-option word of `cp`; every non-option word of `mv`, `rm`,
  `truncate` (after `-s <size>` / `--size=`), and of `sed` or `perl` when `-i`, `-i<suffix>` or `--in-place` is among its options;
  for `git`: the non-option words of `rm` and `mv`, the words after `--` of `checkout`, and the non-option words of `restore`
  except the value of `-s` / `--source`. Heredoc bodies are already cut away. `gate.on_bash` resolves each path against
  `action.cwd` (`~` expanded), locates its checkout, and judges it as R3 does; a refusal returns before the other actions.
- **Rationale**: one reader of a command (ADR-0005, the docstring of `shell.py`); the table is the spec's, and what it misses is
  caught at the commit (R5) and the launch (R11). A path is judged by its own checkout, so an absolute path into another
  worktree is judged by that worktree's branch (edge case). A word that is not a path, such as a `sed` script, locates nothing and
  is not a hit, so the reader need not tell the file from the script.
- **Existing tools**: `shell._segments`, `_words`, `_git`'s option walk and `_HEREDOC`, reused. `pre_merge_gate.tokenize`:
  looked at; it is the merge gate's own reader, kept there because that script must answer without the plugin's modules.

## R5: The commit backstop

- **Decision**: in `gate.on_bash`, a `commit` action is judged for the story rule before `claimgate.on_commit` and
  `shimgate.on_commit`: `worktree.to_commit(root, staging)` lists the paths the commit would record (`git diff --cached
  --name-only --no-renames -z`, plus `git diff --name-only --no-renames -z` when `action.staging`), and the first that
  `story_write_refusal(branch, path, staged=True)` refuses refuses the commit through `hookio.refuse(payload, "commit", ...)`.
  The text names the path and the restore command (`git restore --staged --worktree -- <path>`; for a path not in HEAD,
  `git rm --cached -- <path>` and delete it).
- **Rationale**: scenario 3 refuses "whatever the claim and shim checks' settings", so the refusal is under the plugin's `mode`
  alone, not `refuse_claim` or `refuse_shim`, and runs first. `--no-renames` so a spec.md moved away is listed by its own name.
- **Existing tools**: `worktree._listed` and `_DIFF`'s pinned options, reused with `--no-renames` in place of `--find-renames`;
  `claimgate.on_commit`'s `worktree.locate(action.cwd)`, the same locate.

## R6: The branch under a rebase is the checkout's branch

- **Decision**: `worktree.locate` returns the branch a rebase in progress is rebasing when HEAD is detached: a new
  `worktree.rebase_in_progress(root) -> bool` asks `git rev-parse --git-path` for `rebase-merge` and `rebase-apply`, and a new
  `worktree.rebasing(root) -> str | None` reads `head-name` there (`refs/heads/` stripped; None when it names no branch);
  `locate` uses it where it returned None for `HEAD`. Every reader of `locate` sees the branch under rebase. The rebase of
  `rebase <ref>` runs in a worktree detached from the start (R9), where `head-name` names no branch: the gate locates a path in
  it as the branch of the ledger whose `rebase` record names that `worktree`, so the story rule (R3–R5) and the lock hold the
  conflict resolver there as in the story checkout. Only a checkout with no branch is looked up among the ledgers' records, so
  on every checkout with one the story rule reads nothing from the ledger (FR-001).
- **Rationale**: the spec's edge case: during a rebase the story rule reads the branch being rebased. `_held` compares
  `here.branch` with the ledger's; with None it stops watching a checkout exactly when a rebase runs in it. The rebase worktree
  has no branch of its own to read, and the record is the one fact that ties it to the story; FR-001 names it as the one
  exception to reading nothing from the ledger.
- **Existing tools**: `git rev-parse --git-path`, which `worktree.concluding` already uses for `MERGE_HEAD`.

## R7: The hold goes, and the binding is the `spec` value alone

- **Decision**: delete `gate._spec_text`, `SpecStep.holds`, `_refuse_spec`, `_admit_spec`'s hold clearing and `_spec_md_blob`'s
  blob id; `_head_spec_md` becomes `_spec_md_present(root, head, folder, restore) -> str | None` (the refusal when `spec.md` is
  missing, empty or unreadable at `head`, by the same `ls-tree -l` read). `_spec_step` binds `{"spec": value}` only; on a bound
  PR it checks presence and binds nothing. `_assess_spec_step` checks presence only. Delete `specbinding.text_step` and its
  `released` import; `policy._spec_held` and the hold in `_holds`; the README's hold, `spec_blob` and `spec_held` text; the
  tests of the hold (R13). Nothing reads `spec_blob` or `spec_held` from a stored ledger; no migration.
- **Rationale**: decisions 4 and 5 of issue #104: every round grades against `spec.md` at the reviewed commit, and the gate keeps
  no copy. The presence check is ADR-0016 decision 3, which stands.
- **Existing tools**: `_spec_md_blob`'s `ls-tree -l -z` read, kept for size and type. `ledger.released`, kept for the verdict lock.

## R8: What a `RESHAPE_SPEC` lock says

- **Decision**: in `policy._holds`, the verdict-lock entry for `RESHAPE_SPEC` keeps `user_decision` as the question and
  `_lock_reason` ends, when a `RESHAPE_SPEC` ruling holds the branch, with: the spec is rescoped on `<issue>-spec` (the issue from
  `specbinding.story_issue(state["branch"])`, "the issue's spec branch" when the branch is not a story branch) and lands as a
  spec-only PR while this branch stays locked; once it merges the user starts a prompt with `rebase <ref>`, which rebases this
  branch on it and releases the lock; `unlock <ref>` releases it instead when the user rules the spec stands. With no
  `RESHAPE_SPEC` ruling the closing sentence is today's, less "Editing the spec or changing files another way does not release
  it". `gate._reshape_brief` (the `unlock` reply) adds the spec branch the rescope runs on.
- **Rationale**: FR-009 and US3 scenario 1 and 6. The lock's text is the one place the agent learns the route (P1: every refusal
  names the next legal step).
- **Existing tools**: `_holds`, `_lock_reason`, `unlock_ref`, `_reshape_brief`, edited in place.

## R9: `rebase <ref>`, the user's keyword that rebases and releases

- **Decision**: `gate._on_release` reads `rebase <ref>` only when it is the whole prompt, trimmed: the word `rebase`, one ref
  and nothing else. Any other prompt that starts with `rebase` ("rebase this on main", "rebase #12 now") gets None, and the hook
  stays silent. `unlock <ref>` is read as today (ADR-0004: first words). `gate._rebase` runs the steps of data-model "The
  rebase" in order. It finds the one locked ledger `ref` names, as `_unlock` does, and stops with a reply naming why when: it
  names none or more than one; `policy.reshape_spec_ruling` is None (not a `RESHAPE_SPEC` lock); `state["spec"]` is None (no
  spec: close the PR, as the unlock reply says); the locked round's `root` is gone or not on `state["branch"]`. A `rebase`
  record found next is R10's when its worktree has a rebase in progress (the dispatch reply again), and otherwise is decided as
  below. A rebase in progress in `root` (`worktree.rebasing`) with no `rebase` record, one no `rebase <ref>` started, is named
  with the step to run `git rebase --abort` in `<root>`, and nothing else runs. Then it stops when: the checkout is dirty;
  GitHub cannot say the repo's default branch (`github.default_branch(slug)`: `gh repo view --json defaultBranchRef`) or the
  PR's base (`github.pr_target`); the PR's base is not the default branch (a stacked story PR: land the parent PR first); the
  fetch fails. `worktree.fetch_target(root, target)` (factored out of `review_base`, which calls it) brings
  `refs/remotes/origin/<default>` and `refs/remotes/origin/<branch>`; `<sha>`, the branch tip the remote had before the rebase,
  is `refs/remotes/origin/<branch>` as that fetch brought it; when it is not an ancestor of HEAD, the remote has commits the
  checkout lacks, and the reply says to pull them first, lock stays. `worktree.tree_blob` of `<spec>/spec.md` at
  `origin/<default>` is None when a rescope moved or deleted the folder: the binding never changes, so the reply says to close
  this PR and restart the story on the new folder, and the lock stays. Otherwise it and the one at the locked round's `head_sha`
  are compared; equal means the spec PR has not reached the default branch: reply, lock stays. Different: the story branch and
  its checkout are not touched until the push has landed. `_rebase` records `state["rebase"] = {"onto", "worktree", "lease",
  "at"}` (`worktree` = `<git-common-dir>/alq-rebase/<branch>`, from `git rev-parse --git-common-dir` in `root`; `lease` `<sha>`;
  R10), then runs `git worktree add --detach <worktree> HEAD` in `root` and `git -c core.editor=true rebase
  refs/remotes/origin/<default>` in the worktree. On success it saves `rebased`, the worktree's HEAD, in the record and runs
  `git push --force-with-lease=<branch>:<sha> origin <rebased>:refs/heads/<branch>` there. A refused push removes the worktree
  (`git worktree remove --force`), pops the record, keeps the lock, and replies git's words and the step to type `rebase <ref>`
  again. A push that landed is followed by `git reset --keep <rebased>` in `root`; once it exits 0 the worktree is removed and
  the branch released by `ledger.unlock(state, "user prompt: rebase ...", now)` with `regraded_from` set (R15), the record
  popped, recorded as `rebase`/`released`, and the reply says the next round grades against the new `spec.md`; a no-op rebase
  (already rebased and pushed) takes the same path. A reset that exits non-zero keeps the record (with `rebased`), the worktree
  and the lock, and the reply gives git's words, `<rebased>` and the manual step: `git reset --keep <rebased>` in `<root>`, then
  `rebase <ref>` again. A record found with no rebase in progress in its worktree (a hook that ended before the release, or that
  reset) is decided after a fetch of `origin/<branch>`: at the recorded `rebased`, the push landed, and the reset and the
  release run; anything else, the worktree is removed if present, the record popped, and the steps start over from the first. A
  fetch that fails decides nothing: git's words, everything kept. A worktree removal that exits non-zero keeps the record and
  the lock and replies git's words. Every reply states git's words and the shas the gate read, never a cause it infers. The git
  subprocesses the hook runs set `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`. The UserPromptSubmit
  `gate.py` hook in `hooks.json` gets `"timeout": 120`.
- **Rationale**: the user's decisions in Clarifications: the hook checks, rebases, pushes with `--force-with-lease`, and
  releases; a refused push keeps the lock; the keyword is safe to repeat. The default branch, never the PR's base: the spec PR
  merges into the default branch, so a stacked story PR's base never receives it, and its parent lands first. The lease is
  pinned to `<sha>` because a bare `--force-with-lease` checks the local `origin/<branch>`, which any later fetch (an IDE,
  another session) moves, and "nothing is forced" would no longer hold. The ancestor check makes that lease safe: the lease is
  the tip the hook itself fetched and HEAD contains it, so the rebase drops no remote commit. The story branch moves only after
  the push has landed, so every failure before that leaves nothing to undo: a refused push, a stop in the finish and a hook
  killed at any step before the reset are each answered by dropping the worktree and the record, and the next run's ancestor
  check is judged on the story's own HEAD, which still contains `<sha>`. Only a landed push needs finishing, and one fact
  recognises it: `origin/<branch>` at the `rebased` saved before the push; with none saved the push never ran, and a worktree
  added but never rebased, whose HEAD is the story's own, is never taken for one. A refused push's words do not say why (a lease
  that no longer matches is one reason among a protected branch, a server hook and a dropped connection), so the reply quotes
  them and infers nothing. After a landed push the remote holds the rebase, so a release with the checkout not moved would leave
  the story checkout on commits the PR no longer has: the lock stays and the user is given the one command; `reset --keep`
  refuses rather than overwrite a local change. The worktree lives under the git dir, apart from every checkout's files, one per
  story branch. With no prompt possible, a git that would ask for a password or an SSH passphrase fails at once instead of
  hanging the hook until its timeout. The whole-prompt match keeps an ordinary request that starts with `rebase` from running a
  fetch, a rebase and a push. One release predicate, `ledger.unlock` and `released`, so `rebase` and `unlock` release the same
  way and nothing else does. `rebase` releases every hold the branch has, as `unlock` does, and the reply names each: a second
  stamp would be a second release mechanism.
- **Rejected**: rebasing the story branch in place, in its own checkout, before the push, with a recovery that undid it on a
  failure (`git reset --keep` back to the HEAD before the rebase, kept in the record): every failure between the rewrite and the
  push needed an undo of the user's branch, chosen from the state git was left in, and three review rounds in a row found states
  the undo got wrong.
- **Existing tools**: `_unlock`, `_names`, `policy.locked`, `reshape_spec_ruling`, `ledger.unlock`, `worktree.review_base`'s
  fetch, `tree_blob`, `is_dirty`, `github.pr_target`, `worktree.rebasing` and `rebase_in_progress` (R6), reused;
  `github.default_branch`, new; `git worktree add --detach` and `git worktree remove`. `ledger.py unlock` CLI, unchanged.

## R10: A conflict is resolved by the conflict-resolver agent, as a step of the user's `rebase`

- **Decision**: `_rebase` records in the ledger `state["rebase"] = {"onto": <default>, "worktree": <path>, "lease": <sha>, "at":
  stamp}` before it adds the worktree and runs `git rebase` there (R9); when the rebase stops on a conflict and no unmerged path
  is a spec.md, the record and the worktree stay and `_rebase` replies, as `systemMessage` and `additionalContext`: the lock
  stays, and the session is to dispatch `Agent(subagent_type='alq-review:conflict-resolver', prompt='<worktree>')` now, without
  asking the user. A new `agents/conflict-resolver.md` (tools Read, Grep, Glob, Edit, Bash) resolves each unmerged file in that
  worktree, `git add -- <file>`, `git rebase --continue`, and repeats; when it cannot, `git rebase --abort` and reports the
  files. While `state["rebase"]` is recorded and its worktree has a rebase in progress (`worktree.rebase_in_progress`),
  `policy.rebase_admits(state, *, agent_type, kind, paths, unmerged) -> bool` admits, for `agent_type == policy.RESOLVER` only:
  an edit of a path in `unmerged` (`worktree.unmerged(<worktree>)`: `git diff --name-only --diff-filter=U -z`) that is no
  spec.md; a Bash command that is alone (only `cd` beside it) and is `git add -- <paths>` with every path unmerged and none a
  spec.md (`spec_md_folder`), `git rebase --continue` or `git rebase --abort` (`shell.classify` kinds `add`, `rebase-continue`,
  `rebase-abort`, the paths in `Action.paths`). An admitted edit skips `policy.mutation`; an admitted command skips `mutation`
  and the Bash watch (`hold`). The same kinds from anyone else, or with no record, are judged by `mutation` like `push`, on the
  story branch a path in the worktree is located on (R6), and the story rule holds there. In `after_bash`, an admitted
  `rebase-continue` after which the worktree has no rebase in progress runs the finish of R9 (spec check, `rebased` saved, push
  with the recorded `lease`, the story checkout moved, release); a stop at the spec check removes the worktree, pops the record,
  keeps the lock and gives that check's reply; the push and the reset end as R9 says. One after which the rebase stopped again
  on no spec.md says so; an admitted `rebase-abort` removes the worktree, pops `rebase`, keeps the lock, and says to raise the
  unmerged files to the user. When a spec.md is among the unmerged paths, `_rebase`, or `after_bash` after a `--continue` that
  stopped again, runs `git rebase --abort`, removes the worktree, pops the record, keeps the lock and raises the spec.md to the
  user; the story branch never moved, so nothing is left to undo. `gate.on_agent` refuses dispatching the resolver unless its
  dispatch prompt, trimmed, equals the `worktree` of a ledger's recorded `rebase` and that worktree has a rebase in progress;
  `agent_type` alone admits no dispatch. A later `rebase <ref>` with a record and a rebase in progress in its worktree repeats
  the dispatch reply; with a record and none in progress it decides as R9 says for a record found; with a rebase in progress in
  `root` and no record (one no `rebase <ref>` started) it stops as R9 says.
- **Rationale**: the user's decision: resolved without the user, the lock stays, only the resolver's changes to the conflicted
  files and the rebase's continue or abort are admitted. A hook cannot run an agent, so the reply names the dispatch. That step
  depends on the session obeying a reply, a deviation from P1 the plan's Complexity Tracking records; it fails safe, since the
  lock stays and the story branch is unchanged until the rebase is pushed. The dispatch prompt must be the recorded worktree, so
  the dispatch admitted is the one the user's keyword asked for. No agent resolves a spec.md, whose change is the user's
  (FR-009). The record is what makes the resolver's steps part of the user's action and nothing else's: a rebase an agent
  started by Bash has no record, so the resolver is refused and its continue is a mutation the lock refuses (P2: one entity, the
  user; one action, `rebase <ref>`). Written before the worktree is added, the record names every worktree the hook made, so a
  later run can always remove it. The record lives in the ledger (ADR-0002).
- **Existing tools**: `on_agent`'s refusal of direct dispatch, `payload["agent_type"]` as `briefs.REVIEWERS` are told apart,
  `after_bash`, `session_state`, `shell.classify`, reused. A workflow for the rebase: rejected, workflows only orchestrate
  agents and cannot run git. A second release stamp: rejected (R9).

## R11: A PR changes the spec or the code, never both

- **Decision**: `specbinding.mixed_diff_refusal(changes: list[tuple[str, str]], branch, then) -> str | None`, pure: `changes`
  are `(status, path)` pairs, status git's letter (`A`, `M`, `D`, `R`, `C`, `T`); for each path with status other than `D` whose
  `spec_md_folder` is set, the first changed path (any status) not under that folder refuses, naming the spec.md, that path, the
  rule, and the next step (land the spec change as a spec-only PR on `<issue>-spec`, with `story_issue(branch)` or "the issue's
  spec branch", rebase this branch on it, then `then`). A renamed spec.md counts at its destination. Two sites, two readers of
  the same fact: at a review-round launch of any stage, after `_review_base` and before `ledger.open_round`,
  `worktree.name_status(root, base)` (`_DIFF --name-status -z base...HEAD`, which with `--find-renames` strips the score from
  `R<score>` and yields the destination path), refused through `hookio.refuse(payload, "launch", ...)` with `then` "launch
  again"; at the attestation, after `policy.mark_ready` allows, `github.pr_files(slug, pr)` (`gh api --paginate
  repos/<slug>/pulls/<pr>/files`, GitHub's `status` mapped to git's letter; None when gh cannot answer, or when the list reaches
  3000 files, GitHub's cap for that endpoint, past which the diff cannot be verified; None refuses as `_unknown_pr` refuses, P4)
  with `then` "mark it ready again". Assess-round launches run no diff check.
- **Rationale**: FR-004: one function decides for both sites. The launch has a checkout and a base; a `gh pr ready` may run from
  anywhere, and GitHub lists the PR's files with their status, so the attestation site needs no checkout. A deleted spec.md
  grades nothing (Clarifications). Under `mode` (FR-005). An audit launch is a review-round launch (edge case).
- **Existing tools**: `worktree.changed_files` and `_DIFF`, reused with `--name-status`; `github._gh`, the `--paginate` form
  `released` uses; `_review_base`, `hookio.refuse`. Reusing the settled round's `base_sha` and `root` at the attestation: rejected,
  the root may be gone and `released` PRs have no round.

## R12: The rescope runs on the spec branch

- **Decision**: `plugins/alq-plan/skills/issue-spec/SKILL.md`, the `rescope` form: `CHECKOUT` is the worktree of `<issue>-spec`,
  created per the repo's branch rules off the default branch when there is none; before any write the skill reads `git fetch
  origin` then `git branch -a --merged origin/<default>` and stops, naming it and asking the user to delete it, when a local or
  remote `<issue>-spec` is already merged. Step 8's commit and push land on that branch; its closing lines name the folder and the
  branch, and then, once, the user's next steps: open the spec-only PR, approve it, rebase the story branch with `rebase <ref>`,
  relaunch the review. It names no other plugin's command.
- **Rationale**: FR-006. With US1, a rescope in the story PR's worktree is refused at its first write. A merged branch reused
  would carry a merged history into a new PR.
- **Existing tools**: the skill's two forms and its `DRIVE` steps, unchanged; `git-workflow.md`'s worktree command.

## R13: Tests, red first, in the two suites

- **Decision**: `dev/alq-review/tests`: the story rule's gate tests join `test_gate.py` as a class `StoryBranch(Gate)` whose
  fixture checks out `123-us2-reset` and commits `dev/x/specs/123-login/spec.md`; the shell reader's write table in
  `test_shell.py`; the pure functions in `test_specbinding.py` (`SpecMdFolder`, `StoryIssue`, `StoryWriteRefusal`, `MixedDiff`,
  replacing `TextStep`); `policy.rebase_admits` and the lock text in `test_policy.py`; `rebase <ref>`, the resolver and the diff
  check in `test_gate.py` (`Rebase(HeldBranch)`, `MixedDiff(SpecArgument)`), the gh stub answering `api repos/*/pulls/*/files`
  from `GH_PR_FILES` and `repo view --json defaultBranchRef`; `Rebase` covers, besides the scenarios: a spec.md conflict during
  the rebase, aborted with the lock kept and the spec.md raised, and the resolver's `git add` of an unmerged spec.md refused; a
  stacked PR refused with "land the parent PR first"; a rebase in progress with no record, as a rebase started by hand leaves
  it, answered with the abort step and nothing run; each path of the rebase, with the story branch and its checkout unchanged
  until the push lands: a clean rebase that lands; a conflict resolved in the worktree that then lands; a spec.md conflict,
  aborted; a push the served origin refuses (its `pre-receive` hook, or a remote branch moved after the hook's fetch and fetched
  again, so a bare lease would pass), nothing forced, then a retry that lands, or after a moved remote asks for the pull; a hook
  killed before the push, after which the retry starts over; a hook killed after the push landed, after which `rebase <ref>`
  finishes without rebasing again, `regraded_from` set; a `git reset --keep <rebased>` that exits non-zero after the push,
  keeping the record and the lock and naming the manual step; a fetch that fails on a found record, deciding nothing; a spec.md
  write in the rebase worktree refused by the story rule; the first round after a release a full round with no delta, its facts
  counting only commits since the release and comparing it with no round before it (R15); a remote branch with a commit the
  checkout lacks, refused before any rebase with the lock kept; a resolver dispatched with a prompt other than the recorded
  worktree refused; `rebase onto main` and `rebase #<pr> now` answered with no reply; `worktree.rebasing`, `rebase_in_progress`,
  `unmerged`, `to_commit`, `name_status` in `test_worktree_facts.py`, `name_status` with a renamed spec.md giving `R` and the
  destination path; `policy.launch_round` with no `delta_from` across `regraded_from`, and still refused by the round cap on
  rounds from before it, in `test_policy.py` and `facts.round_facts` reading only the rounds from it on in
  `test_worktree_facts.py`. US2's tests name `spec_blob` and `spec_held`, a stored ledger carrying them and holding nothing, so
  SC-003's grep covers `plugins/alq-review` and not the tests. Deleted with the hold: `test_gate.py` `SpecArgument`'s hold tests
  (today's lines 442–470, 599–672, 709–760, 777–790, 852–877), `held()`, `assertHeldWithTheDiff`, `spec_blob` in
  `HeldBranch.lock` and three `state.update` calls; `test_policy.py` `hold_spec`, `spec_held_state`, `SPEC_HOLD_NAMES`, four
  `Mutation` tests and the "spec hold" case of the every-hold test; `test_specbinding.py` `TextStep`;
  `test_worktree_facts.py:298`. `dev/alq-plan/tests/test_spec_source.py`: the rescope test becomes the spec-branch test. Each
  test is written, run and seen to fail for the expected reason before its code (constitution IV). Before the hold's tests are
  deleted in US2, they are run once on main and the result is recorded in the PR, so the spec's "did not converge" is observed
  (its Root cause ran nothing).
- **Rationale**: SC-001 and FR-008. The harness drives each hook event in-process (`Gate.hook`), with a bare origin for the
  fetch and push (`serve_remote`), and subagent payloads carry `agent_type`.
- **Existing tools**: `Gate`, `HeldBranch.lock`, `SpecArgument.commit_files`, `Repo.serve_remote`, the gh stub, reused.

## R14: What the README says

- **Decision**: item 2: a `RESHAPE_SPEC` lock's two releases and the rescope route; the changed-spec hold sentence goes. Item 5:
  the binding is the `spec` value; `spec.md` is read at the reviewed commit each round; the hold paragraph is replaced by the
  diff check. A new item 8: a story branch never changes a spec.md (the three sites, the writes table's forms, the next step).
  Mode: the story rule and the diff check are made through `hookio.refuse`. What the user types: `rebase`. State: the ledger's
  `spec`, `rebase` and `regraded_from` records, and the rebase worktree. Layout: `specbinding.py`'s new line,
  `agents/conflict-resolver.md`. Nothing names `spec_blob`, `spec_held` or `text_step` (SC-003).
- **Rationale**: FR-007; the README is the plugin's description and changes with its code (019 R17).
- **Existing tools**: the README's sections, edited in place.

## R15: After a release by `rebase`, the story is measured afresh

- **Decision**: the release of `rebase <ref>` (step 15 of data-model "The rebase", run by `_rebase`, by `after_bash`'s finish
  and for a recorded rebase found again whose push landed) sets `state["regraded_from"] = len(state["rounds"])` beside
  `ledger.unlock`, in the same save; `unlock <ref>` sets nothing. Every reader of round history that measures the story reads
  only `state["rounds"][state.get("regraded_from", 0):]`. `policy.launch_round` counts as `done` only the internal rounds there,
  so the first round after the release has `scope="full"` and no `delta_from`, and the brief's delta diff
  (`briefs._review_prompt`, `git diff <delta_from>..HEAD`) gives way to the whole change, `git diff <base>...HEAD`.
  `facts.round_facts` takes `first_reviewed` and the original `base` from the first of them, not `rounds[0]`, so `added_lines`,
  `commits_per_file` and both `additions` count only commits since the release; it takes `earlier`, the finding counts behind
  `count_not_falling`, and `seen`, the spots behind `repeat_unit`, from them too, and so `burden`. Its callers,
  `gate.on_structured_output` (the assessor's admissible verdicts), `briefs.churned` and `briefs.brief`, change nothing. The
  round caps (`policy._capped`) and `briefs.brief`'s `earlier_rounds` span the release on purpose: a rebase settles no round, so
  the cap counts the rounds before it too, and earlier rounds are the assessor's context, not a gate. The field is not the
  ledger's `epoch`, which an escalation audit advances.
- **Rationale**: the rebase rewrites every commit of the story branch, so a head recorded before it is no ancestor of the
  rewritten HEAD: `<old head>..HEAD` holds every rewritten commit of the story and every commit the default branch gained, so a
  delta round would brief the whole rebase as a delta, and a file the story edited in three commits before it would read as at a
  third edit. The whole story is regraded against the new `spec.md`, which is a full round. A round before the release graded
  another `spec.md` and another history, so neither its finding count nor its spots say whether the story converges now: the
  first full round after it, with more findings than the last round before it, is no count that failed to fall. `unlock <ref>`
  rewrites nothing, so its rounds are measured as before.
- **Existing tools**: `policy.launch_round`'s `done` and `facts.round_facts`, edited; the briefs, unchanged. The escalation
  `epoch`: rejected, since advancing it also restarts the round cap (`_capped` counts `counted` rounds, which `epoch` filters)
  and changes the round refs, neither of which a spec change asks for.
