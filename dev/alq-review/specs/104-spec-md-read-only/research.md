# Research: spec.md is read-only on a story branch

Read for this: `plugins/alq-review/scripts/{gate,policy,specbinding,ledger,briefs,hookio,shell,worktree,github,pre_merge_gate}.py`,
`hooks/hooks.json`, `agents/assessor.md`, `workflows/review-round.js`, the README, `plugins/alq-plan/skills/issue-spec/SKILL.md`,
`dev/alq-review/tests/{helpers,test_gate,test_policy,test_specbinding,test_shell,test_worktree_facts}.py`,
`dev/alq-plan/tests/{test_spec_source,test_guards}.py`, ADRs 0002, 0004, 0009, 0011, 0012, 0016–0018, the constitution, the
engineering `git-workflow.md`, and `.github/workflows/tests.yml`, all on main at `735c172`. Nothing below was run unless it
says so. The spec cites "ADR-0019 decision 1"; no record 0019 exists in `dev/alq-review/docs/adr/` on any branch (`git log
--all`, run): it is the record the #81 spec expects, and nothing here departs from what the spec quotes of it.

## R1: Shipping order: records first, then one PR per user story, stacked where a story needs another

- **Decision**: (1) the decision record, drafted from this plan with `speckit-adrkit-draft`, in its own PR on `104-adr-<slug>`,
  with the README's pointer to it; it replaces ADR-0016 decision 6 and the blob-id part of decision 4, and changes ADR-0018 so a
  `RESHAPE_SPEC` lock is released by `unlock <ref>` when the spec stands and by `rebase <ref>` after a spec change; PR #105's
  hand-written ADR-0020 is closed. (2) The engineering `git-workflow.md` change, in that repo: the spec changes through its own
  spec-only PR, never in a story PR. (3) Code, one PR per user story on `104-us<N>-<slug>`: US1 (the hook and the commit
  backstop) off the default branch; US2 (the hold deleted) stacked on US1; US3 (`rebase`, the conflict resolver) stacked on US2;
  US4 (the diff check) and US5 (the rescope, in `alq-plan`) off the default branch. The README changes with the code of each
  story. The plugin's version moves once, in the last alq-review story to merge, and that bump turns on US1; alq-plan's US5
  release ships no later than it.
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
  `worktree.rebasing(root) -> str | None` reads `rebase-merge/head-name` or `rebase-apply/head-name` through `git rev-parse
  --git-path`, and `locate` uses it where it returned None for `HEAD`. Every reader of `locate` sees the branch under rebase.
- **Rationale**: the spec's edge case: during a rebase the story rule reads the branch being rebased, and US3's lock must still
  hold the checkout while the conflict resolver works in it. `_held` compares `here.branch` with the ledger's; with None it
  stops watching the checkout exactly when the rebase runs.
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
  stays silent. `unlock <ref>` is read as today (ADR-0004: first words). `gate._rebase` finds the one locked ledger `ref` names,
  as `_unlock` does, and stops with a reply naming why when: it names none or more than one; `policy.reshape_spec_ruling` is
  None (not a `RESHAPE_SPEC` lock); `state["spec"]` is None (no spec: close the PR, as the unlock reply says); the locked
  round's `root` is gone or not on `state["branch"]`; a rebase is in progress in `root` (`worktree.rebasing`) with no `rebase`
  record, as when the hook was killed mid-rebase: the reply names it and tells the user to run `git rebase --abort` in `<root>`,
  and nothing else runs; the checkout is dirty; GitHub cannot say the repo's default branch (`github.default_branch(slug)`: `gh
  repo view --json defaultBranchRef`) or the PR's base (`github.pr_target`); the PR's base is not the default branch (a stacked
  story PR: land the parent PR first); the fetch fails. Then `worktree.fetch_target(root, target)` (factored out of
  `review_base`, which calls it) brings `refs/remotes/origin/<default>` and `refs/remotes/origin/<branch>`; `<sha>`, the branch
  tip the remote had before the rebase, is `refs/remotes/origin/<branch>` as that fetch brought it; when it is not an ancestor of HEAD, the remote has commits the
  checkout lacks, and the reply says to pull them first, lock stays. `worktree.tree_blob` of
  `<spec>/spec.md` at `origin/<default>` is None when a rescope moved or deleted the folder: the binding never changes, so the
  reply says to close this PR and restart the story on the new folder, and the lock stays. Otherwise it and the one at the
  locked round's `head_sha` are compared; equal means the spec PR has not reached the default branch: reply, lock stays.
  Different: `git -c core.editor=true rebase refs/remotes/origin/<default>` in `root`; on success `git push
  --force-with-lease=<branch>:<sha> origin <branch>`; a refused push is replied with git's words, lock stays; a pushed branch is
  released by `ledger.unlock(state, "user prompt: rebase ...", now)`, recorded as `rebase`/`released`, and the reply says the
  next round grades against the new `spec.md`. A no-op rebase (already rebased) takes the same path. The git subprocesses the
  hook runs set `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`. The UserPromptSubmit `gate.py` hook in
  `hooks.json` gets `"timeout": 120`.
- **Rationale**: the user's decisions in Clarifications: the hook checks, rebases, pushes with `--force-with-lease`, and
  releases; a refused push keeps the lock; the keyword is safe to repeat. The default branch, never the PR's base: the spec PR
  merges into the default branch, so a stacked story PR's base never receives it, and its parent lands first. The lease is
  pinned to `<sha>` because a bare `--force-with-lease` checks the local `origin/<branch>`, which any later fetch (an IDE,
  another session) moves, and "nothing is forced" would no longer hold. The ancestor check makes that lease safe: pinned to
  the tip the hook itself fetched, it lets a retry after a refused push succeed, and since HEAD already contains that tip, no
  remote commit is dropped by the rebase. With no prompt possible, a git that would ask for a
  password or an SSH passphrase fails at once instead of hanging the hook until its timeout. The whole-prompt match keeps an
  ordinary request that starts with `rebase` from running a fetch, a rebase and a push. One release predicate, `ledger.unlock`
  and `released`, so `rebase` and `unlock` release the same way and nothing else does. `rebase` releases every hold the branch
  has, as `unlock` does, and the reply names each: a second stamp would be a second release mechanism.
- **Existing tools**: `_unlock`, `_names`, `policy.locked`, `reshape_spec_ruling`, `ledger.unlock`, `worktree.review_base`'s
  fetch, `tree_blob`, `is_dirty`, `github.pr_target`, `worktree.rebasing` (R6), reused; `github.default_branch`, new. `ledger.py
  unlock` CLI, unchanged.

## R10: A conflict is resolved by the conflict-resolver agent, as a step of the user's `rebase`

- **Decision**: when the rebase stops on a conflict and no unmerged path is a spec.md, `_rebase` records in the ledger
  `state["rebase"] = {"onto": <default>, "from": <head sha before>, "lease": <sha>, "at": stamp}` and replies, as
  `systemMessage` and `additionalContext`: the lock stays, and the session is to dispatch
  `Agent(subagent_type='alq-review:conflict-resolver', prompt='<root>')` now, without asking the user. A new
  `agents/conflict-resolver.md` (tools Read, Grep, Glob, Edit, Bash) resolves each unmerged file, `git add -- <file>`, `git
  rebase --continue`, and repeats; when it cannot, `git rebase --abort` and reports the files. While `state["rebase"]` is
  recorded and `worktree.rebasing(root)` names the branch, `policy.rebase_admits(state, *, agent_type, kind, paths, unmerged) ->
  bool` admits, for `agent_type == policy.RESOLVER` only: an edit of a path in `unmerged` (`worktree.unmerged(root)`: `git diff
  --name-only --diff-filter=U -z`) that is no spec.md; a Bash command that is alone (only `cd` beside it) and is `git add --
  <paths>` with every path unmerged and none a spec.md (`spec_md_folder`), `git rebase --continue` or `git rebase --abort`
  (`shell.classify` kinds `add`, `rebase-continue`, `rebase-abort`, the paths in `Action.paths`). An admitted edit skips
  `policy.mutation`; an admitted command skips `mutation` and the Bash watch (`hold`). The same kinds from anyone else, or with
  no record, are judged by `mutation` like `push`. In `after_bash`, an admitted `rebase-continue` after which `rebasing(root)`
  is None runs the finish of R9 (spec check, push with the recorded `lease`, unlock, record) and pops `rebase`; one after which
  the rebase stopped again on no spec.md says so; an admitted `rebase-abort` pops `rebase`, keeps the lock, and says to raise
  the unmerged files to the user. When a spec.md is among the unmerged paths, `_rebase`, or `after_bash` after a `--continue`
  that stopped again, runs `git rebase --abort`, pops any `rebase` record, keeps the lock and raises the spec.md to the user.
  `gate.on_agent` refuses dispatching the resolver unless its dispatch prompt, trimmed, equals the root of a ledger's recorded
  `rebase` (the locked round's `root`) and that root has a rebase in progress; `agent_type` alone admits no dispatch. A later
  `rebase <ref>` with a record and a rebase in progress repeats the dispatch reply; with a record and none in progress it pops
  the record and starts over; with a rebase in progress and no record it stops as R9 says.
- **Rationale**: the user's decision: resolved without the user, the lock stays, only the resolver's changes to the conflicted
  files and the rebase's continue or abort are admitted. A hook cannot run an agent, so the reply names the dispatch. That step
  depends on the session obeying a reply, a deviation from P1 the plan's Complexity Tracking records; it fails safe, since the
  lock stays until the branch is pushed. The dispatch prompt must be the recorded root, so the dispatch admitted is the one the
  user's keyword asked for. No agent resolves a spec.md, whose change is the user's (FR-009). The record is what makes the
  resolver's steps part of the user's action and nothing else's: a rebase an agent started by Bash has no record, so the
  resolver is refused and its continue is a mutation the lock refuses (P2: one entity, the user; one action, `rebase <ref>`).
  The record lives in the ledger (ADR-0002).
- **Existing tools**: `on_agent`'s refusal of direct dispatch, `payload["agent_type"]` as `briefs.REVIEWERS` are told apart,
  `after_bash`, `session_state`, `shell.classify`, reused. A workflow for the rebase: rejected, workflows only orchestrate agents
  and cannot run git. A second release stamp: rejected (R9).

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
  stacked PR refused with "land the parent PR first"; a rebase in progress with no record, as a hook killed mid-rebase leaves
  it, answered with the abort step and nothing run; a remote branch moved after the hook's fetch and fetched again, so a bare
  lease would pass, refused at the push with the lock kept; a remote branch with a commit the checkout lacks, refused before
  any rebase with the lock kept; a resolver dispatched with a prompt other than the recorded root
  refused; `rebase onto main` and `rebase #<pr> now` answered with no reply; `worktree.rebasing`, `unmerged`, `to_commit`,
  `name_status` in `test_worktree_facts.py`, `name_status` with a renamed spec.md giving `R` and the destination path. Deleted
  with the hold: `test_gate.py` `SpecArgument`'s hold tests (today's lines 442–470, 599–672, 709–760, 777–790, 852–877),
  `held()`, `assertHeldWithTheDiff`, `spec_blob` in `HeldBranch.lock` and three `state.update` calls; `test_policy.py`
  `hold_spec`, `spec_held_state`, `SPEC_HOLD_NAMES`, four `Mutation` tests and the "spec hold" case of the every-hold test;
  `test_specbinding.py` `TextStep`; `test_worktree_facts.py:298`. `dev/alq-plan/tests/test_spec_source.py`: the rescope test
  becomes the spec-branch test. Each test is written, run and seen to fail for the expected reason before its code (constitution
  IV). Before the hold's tests are deleted in US2, they are run once on main and the result is recorded in the PR, so the spec's
  "did not converge" is observed (its Root cause ran nothing).
- **Rationale**: SC-001 and FR-008. The harness drives each hook event in-process (`Gate.hook`), with a bare origin for the
  fetch and push (`serve_remote`), and subagent payloads carry `agent_type`.
- **Existing tools**: `Gate`, `HeldBranch.lock`, `SpecArgument.commit_files`, `Repo.serve_remote`, the gh stub, reused.

## R14: What the README says

- **Decision**: item 2: a `RESHAPE_SPEC` lock's two releases and the rescope route; the changed-spec hold sentence goes. Item 5:
  the binding is the `spec` value; `spec.md` is read at the reviewed commit each round; the hold paragraph is replaced by the
  diff check. A new item 8: a story branch never changes a spec.md (the three sites, the writes table's forms, the next step).
  Mode: the story rule and the diff check are made through `hookio.refuse`. What the user types: `rebase`. State: the ledger's
  `spec` and `rebase` records. Layout: `specbinding.py`'s new line, `agents/conflict-resolver.md`. Nothing names `spec_blob`,
  `spec_held` or `text_step` (SC-003).
- **Rationale**: FR-007; the README is the plugin's description and changes with its code (019 R17).
- **Existing tools**: the README's sections, edited in place.
