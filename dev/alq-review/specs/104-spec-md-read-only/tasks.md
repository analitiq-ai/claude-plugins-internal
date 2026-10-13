---

description: "Task list for spec.md is read-only on a story branch (#104)"
---

# Tasks: spec.md is read-only on a story branch

**Input**: Design documents from `dev/alq-review/specs/104-spec-md-read-only/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R15), data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: Required (FR-008, SC-001, constitution IV, R13). Every test task is written, run, and seen to fail for the
reason named before its code task starts; the failure is quoted in the commit message or PR body.

**Organization**: One PR per user story (R1). US1 off the default branch; US2 stacked on US1; US3 stacked on US2; US4
and US5 off the default branch. The README changes with each story's code (R14).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5, from spec.md
- Paths are repo-relative to the `claude-plugins-internal` root

## Path Conventions

- Plugin code: `plugins/alq-review/scripts/`, `plugins/alq-review/agents/`, `plugins/alq-review/hooks/hooks.json`,
  `plugins/alq-review/README.md`; `plugins/alq-plan/skills/issue-spec/SKILL.md`
- Tests: `dev/alq-review/tests/`, `dev/alq-plan/tests/`; run with `(cd dev/alq-review/tests && python -m unittest -v)`
  and `(cd dev/alq-plan/tests && python -m unittest -v)`

---

## Phase 1: Setup (governing records, their own PRs — R1, constitution VI)

**Purpose**: The decision record and the workflow rule ship apart from, and before, the code they govern.

- [ ] T001 Draft the decision record with `speckit-adrkit-draft` from `dev/alq-review/specs/104-spec-md-read-only/plan.md` into `dev/alq-review/docs/adr/` on branch `104-adr-<slug>`, with the README's pointer to it in `plugins/alq-review/README.md`: it replaces ADR-0016 decision 6 and the blob-id part of decision 4, replaces the `spec.md`-blob part of ADR-0019 decision 3 (open PR #93) and that record's closing line "ADR-0016, decision 6, and ADR-0018 stand", and changes ADR-0018 so a `RESHAPE_SPEC` lock is released by `unlock <ref>` when the spec stands and by `rebase <ref>` after a spec change; open it as its own PR
- [ ] T002 Close PR #105 (hand-written ADR-0020) with a comment naming T001's PR, after the user confirms
- [ ] T003 [P] In the engineering repo, open the `git-workflow.md` PR "The spec changes through its own PR": a spec change lands in a spec-only PR on `<issue>-spec`, never in a story PR; the story branch rebases on it (outward-facing: confirm with the user first)
- [ ] T004 Run the hold's tests once on main (`dev/alq-review/tests/test_gate.py` `SpecArgument` hold tests and `dev/alq-review/tests/test_policy.py` spec-hold tests named in R13) and save the output for US2's PR body, so "did not converge" is observed, not asserted (R13)

---

## Phase 2: Foundational (shared pure definitions — R2, R6)

**Purpose**: What a spec.md, a story branch and a branch under rebase are, defined once; every story reads them.

**⚠️ CRITICAL**: US1, US3 and US4 call these. Land them in US1's PR (the first code PR); US4 and US5, off the default branch, rebase on US1 if they need them before it merges.

- [ ] T005 [P] Write failing tests `SpecMdFolder` and `StoryIssue` in `dev/alq-review/tests/test_specbinding.py`: `spec_md_folder("dev/x/specs/123-login/spec.md") == "dev/x/specs/123-login"`; `None` for `docs/spec.md` and `dev/x/specs/123-login/plan.md`; `story_issue("123-us2-reset") == "123"`; `None` for `123-spec`, `123-retire-spec`, `123-adr-hold`, `main`, `feat/1-demo` (data-model "A spec.md, a story branch"); run and confirm `AttributeError`
- [ ] T006 Implement `spec_md_folder(path) -> str | None` (path named `spec.md` whose folder passes `shape_problem`) and `story_issue(branch) -> str | None` (`^(\d+)-us\d+-`) in `plugins/alq-review/scripts/specbinding.py`; update the module docstring per R2; T005 passes
- [ ] T007 [P] Write a failing test in `dev/alq-review/tests/test_worktree_facts.py` for `worktree.rebase_in_progress(root)` and `worktree.rebasing(root)`: false and `None` with no rebase; true and the branch name from `rebase-merge/head-name` during a stopped `git rebase`; true and `None` during a rebase in a detached worktree; and `worktree.locate` reporting that branch while HEAD is detached mid-rebase (R6, edge case "During a rebase HEAD is detached")
- [ ] T008 Implement `rebase_in_progress(root) -> bool` and `rebasing(root) -> str | None` in `plugins/alq-review/scripts/worktree.py` via `git rev-parse --git-path rebase-merge` and `rebase-apply` and the `head-name` there (strip `refs/heads/`; `None` when it names no branch), and use it in `locate` where it returned `None` for a detached `HEAD`; T007 passes; callers of `locate` (`gate._held`, `on_edit`, `on_bash`, `on_workflow`, `claimgate` ×2, `shimgate` ×3, `ledger.main`) still pass the full suite

**Checkpoint**: shared definitions in place, full `dev/alq-review/tests` suite green.

---

## Phase 3: User Story 1 - A story branch cannot change a spec.md (Priority: P1) 🎯 MVP

**Goal**: Every `Edit`/`Write`/`NotebookEdit`, every Bash write of the writes table and every `git commit` that touches a spec.md on a story branch is refused with one text (contracts "The story rule").

**Independent Test**: `StoryBranch(Gate)` in `dev/alq-review/tests/test_gate.py`, on a checkout of `123-us2-reset` with `dev/x/specs/123-login/spec.md` committed: each write refused; the same on `123-spec` passes.

**Branch/PR**: `104-us1-<slug>` off the default branch.

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [ ] T009 [P] [US1] Write failing tests `StoryWriteRefusal` in `dev/alq-review/tests/test_specbinding.py`: `story_write_refusal(branch, path, staged)` returns contracts' edit/Bash text (names `<path>`, `<folder>`, `<branch>`, "a story branch never changes a spec.md", next step with `123-spec`) for `staged=False`; the commit text with `git restore --staged --worktree -- <path>` and `git rm --cached -- <path>` for `staged=True`; `None` for a non-story branch or a non-spec.md path
- [ ] T010 [P] [US1] Write failing tests in `dev/alq-review/tests/test_shell.py` for the `write` kind, one `Action` per path in `Action.paths`, per data-model "The written paths of a segment": `echo x > P`, `cat <<EOF >> P` (body cut), `2> P`, `&> P`, `>P` attached; `| tee P`, `tee -a P`; `sed -i ... P`, `sed -i.bak`, `--in-place`, `perl -i`; `cp a P` (last word); `mv a P`, `mv P b`, `rm P`, `truncate -s 0 P`, `truncate --size=0 P`; `git rm P`, `git mv P b`, `git checkout -- P`, `git restore P`, `git restore -s HEAD P` (value of `-s` excluded); and no `write` action for `cat P`, `grep x P`, `git diff P`, `git show HEAD:P`, `git log P`, `sed` without `-i`
- [ ] T011 [P] [US1] Write a failing test in `dev/alq-review/tests/test_worktree_facts.py` for `worktree.to_commit(root, staging)`: staged paths via `git diff --cached --name-only --no-renames -z`, plus unstaged tracked paths when `staging` is true; a spec.md moved away is listed by its own name
- [ ] T012 [US1] Write failing tests class `StoryBranch(Gate)` in `dev/alq-review/tests/test_gate.py` (fixture: branch `123-us2-reset`, `dev/x/specs/123-login/spec.md` committed), one per US1 scenario: (1) `Edit`, `Write`, `NotebookEdit` of the spec.md refused with the edit text; (2) each Bash form of the writes table refused with the same text; (3) `git commit` with a staged spec.md change refused with the commit text, also with `refuse_claim`/`refuse_shim` off and with `-a` staging; (4) on `123-spec`, `123-retire-spec`, `123-adr-hold` and the default branch none refused by this rule; (5) `plan.md`, `tasks.md`, `research.md` writes not refused; (6) refused with no PR, no ledger, no round, and no `gh` call made; (7) `cat`, `grep`, `git diff`, `git show`, `git log` not refused; (8) `log` mode records `would_deny` and does not block; plus edge cases: an absolute path into another worktree judged by that worktree's branch; a spec.md path only in a heredoc body, comment or quoted string not refused; mid-rebase (detached HEAD) on a story branch still refused

### Implementation for User Story 1

- [ ] T013 [US1] Implement `story_write_refusal(branch, path, staged: bool) -> str | None` in `plugins/alq-review/scripts/specbinding.py` with the contracts' two texts verbatim; T009 passes
- [ ] T014 [US1] Add `paths: tuple[str, ...]` to `shell.Action` and the `write` kind to `shell.classify` in `plugins/alq-review/scripts/shell.py`, reusing `_segments`, `_words`, `_git`'s option walk and `_HEREDOC`, exactly the table's forms and no wider (R4); T010 passes and existing `test_shell.py` stays green
- [ ] T015 [US1] Implement `to_commit(root, staging) -> list[str]` in `plugins/alq-review/scripts/worktree.py` reusing `_listed` and `_DIFF`'s options with `--no-renames` in place of `--find-renames` (R5); T011 passes
- [ ] T016 [US1] In `plugins/alq-review/scripts/gate.py` `on_edit`, judge the story rule right after `worktree.locate(path)` and before `target(where)`: path relative to `where.root`, `where.branch`, `specbinding.story_write_refusal(..., staged=False)`; refuse via `hookio.refuse(payload, "spec-write", text, Target(where.slug, None, where.branch, where.root))` (R3)
- [ ] T017 [US1] In `plugins/alq-review/scripts/gate.py` `on_bash`, for each `write` action resolve each path against `action.cwd` (`~` expanded), `worktree.locate` it, and judge it as T016 does, returning the first refusal before other actions (R4)
- [ ] T018 [US1] In `plugins/alq-review/scripts/gate.py` `on_bash`, for a `commit` action, before `claimgate.on_commit` and `shimgate.on_commit`, refuse through `hookio.refuse(payload, "commit", ...)` on the first `worktree.to_commit(root, action.staging)` path that `story_write_refusal(branch, path, staged=True)` refuses — under the plugin's `mode` only, not `refuse_claim`/`refuse_shim` (R5); T012 passes
- [ ] T019 [US1] Update `plugins/alq-review/README.md`: new item 8 (a story branch never changes a spec.md: the three sites, the writes table's forms, the next step); Mode: the story rule is made through `hookio.refuse`; Layout: `specbinding.py`'s new line (R14)
- [ ] T020 [US1] Run both suites; open the US1 draft PR on `104-us1-<slug>` and run the review loops per `.claude/rules/pr-review-loop.md` with `spec: 'dev/alq-review/specs/104-spec-md-read-only'`

**Checkpoint**: US1 refusals live and tested; the hold still exists (removed by US2).

---

## Phase 4: User Story 2 - Every round grades against spec.md at the reviewed commit; no copy kept (Priority: P2)

**Goal**: The binding is the `spec` value alone; `spec.md` is read at the reviewed commit each round; the hold, `spec_blob`, `spec_held` and `text_step` are deleted (R7).

**Independent Test**: in `test_gate.py`, bind a PR to a folder, commit a change to its `spec.md`, launch the next review round and assessment: both open, the ledger holds `spec` only, no `unlock` asked.

**Branch/PR**: `104-us2-<slug>`, stacked on US1. Include T004's recorded output in the PR body.

### Tests for User Story 2 ⚠️

- [ ] T021 [P] [US2] Write failing tests in `dev/alq-review/tests/test_gate.py` (`SpecArgument`), one per US2 scenario: (1) a changed `spec.md` at the reviewed commit opens the review round and the assess round, no diff shown, no hold, no `unlock`; (2) the ledger after a round holds `spec` and neither `spec_blob` nor `spec_held`; (3) reviewer and assessor briefs tell them to read `<folder>/spec.md` and quote none of its text; (4) `spec.md` missing or empty at the reviewed commit is refused naming the path; (6) a stored ledger with `spec_blob`/`spec_held` set does not hold the PR (SC-004)
- [ ] T022 [P] [US2] Write a failing test in `dev/alq-review/tests/test_policy.py` for US2 scenario 5: a lock reason names only a `RESHAPE_SPEC`, `ESCALATE` or spent-audit hold, never a changed `spec.md`, including on a state carrying a stale `spec_held`

### Implementation for User Story 2

- [ ] T023 [US2] In `plugins/alq-review/scripts/gate.py` delete `_spec_text`, `SpecStep.holds`, `_refuse_spec`, `_admit_spec`'s hold clearing and `_spec_md_blob`'s blob id; replace `_head_spec_md` with `_spec_md_present(root, head, folder, restore) -> str | None` using the same `ls-tree -l -z` read; `_spec_step` binds `{"spec": value}` only and on a bound PR checks presence only; `_assess_spec_step` checks presence only (R7). Callers to re-check: `on_workflow` (two sites each for `_refuse_spec`/`_admit_spec`)
- [ ] T024 [US2] In `plugins/alq-review/scripts/specbinding.py` delete `text_step` and its `released` import (R7)
- [ ] T025 [US2] In `plugins/alq-review/scripts/policy.py` delete `_spec_held` and its entry in `_holds`; drop "Editing the spec or changing files another way does not release it" from `_lock_reason`'s closing sentence (R7, R8); callers `locked`, `_lock_reason`, `_obstacle`, `mutation`, `rerequest`, `mark_ready`, `launch_round` stay green
- [ ] T026 [US2] Delete the hold's tests per R13: in `dev/alq-review/tests/test_gate.py` `SpecArgument`'s hold tests (main's lines 442–470, 599–672, 709–760, 777–790, 852–877), `held()`, `assertHeldWithTheDiff`, `spec_blob` in `HeldBranch.lock` and the three `state.update` calls; in `dev/alq-review/tests/test_policy.py` `hold_spec`, `spec_held_state`, `SPEC_HOLD_NAMES`, the four `Mutation` hold tests and the "spec hold" case of the every-hold test; in `dev/alq-review/tests/test_specbinding.py` `TextStep`; `dev/alq-review/tests/test_worktree_facts.py:298`
- [ ] T027 [US2] Update `plugins/alq-review/README.md` item 5 (binding is the `spec` value; `spec.md` read at the reviewed commit each round; hold paragraph removed), item 2 (changed-spec hold sentence removed), State (`spec` only); verify `grep -rn 'spec_blob\|spec_held\|text_step' plugins/alq-review` finds nothing (SC-003; US2's tests name `spec_blob` and `spec_held` to prove nothing reads them)
- [ ] T028 [US2] Run both suites; open the US2 draft PR stacked on US1 and run the review loops

**Checkpoint**: US1 + US2: the agent cannot move its target, and a spec change costs no `unlock`.

---

## Phase 5: User Story 3 - `rebase <ref>` releases a `RESHAPE_SPEC` lock after a spec change (Priority: P3)

**Goal**: The `RESHAPE_SPEC` lock text names the rescope and both keywords; `rebase <ref>` checks, rebases on the default branch in a throwaway worktree, pushes from it with a pinned lease, and only then moves the story checkout and releases; a conflict-resolver agent settles conflicts as a recorded step (R8–R10).

**Independent Test**: `Rebase(HeldBranch)` in `test_gate.py`: lock with `RESHAPE_SPEC`, merge (or not) a change to the bound `spec.md` into the served origin's default branch, with and without a conflict, send `rebase <ref>` and `unlock <ref>` as the prompt.

**Branch/PR**: `104-us3-<slug>`, stacked on US2.

### Tests for User Story 3 ⚠️

- [ ] T029 [P] [US3] Write failing tests in `dev/alq-review/tests/test_policy.py`: the `RESHAPE_SPEC` `_lock_reason` names `123-spec` (or "the issue's spec branch" for a non-story branch), "spec-only PR", `rebase <ref>` and `unlock <ref>` (US3 scenario 1); `policy.rebase_admits(state, *, agent_type, kind, paths, unmerged)` per data-model "What the conflict resolver may do": true only for `agent_type == policy.RESOLVER` with `state["rebase"]` recorded, for an edit of an unmerged non-spec.md path, `add` of only unmerged non-spec.md paths, `rebase-continue`, `rebase-abort`; false for a spec.md, a non-unmerged path, another agent type, or no record; `policy.launch_round` on a state whose `regraded_from` is past every internal round gives `scope="full"` and no `delta_from` (US3 scenario 12); `policy.launch_round` on a state with `CAP` unsettled internal rounds, all before `regraded_from`, is still refused with the cap refusal: the round cap counts rounds from before `regraded_from` (R15)
- [ ] T030 [P] [US3] Write failing tests in `dev/alq-review/tests/test_shell.py` for kinds `add` (`git add -- a b` → `paths=("a","b")`), `rebase-continue`, `rebase-abort`, and `alone` true only with nothing but `cd` beside them
- [ ] T031 [P] [US3] Write failing tests in `dev/alq-review/tests/test_worktree_facts.py` for `worktree.unmerged(root)` (`git diff --name-only --diff-filter=U -z`) during a stopped rebase in a detached worktree, and `worktree.fetch_target(root, target)` fetching `origin/<target>` (with `review_base` still green after it calls `fetch_target`); `facts.round_facts` on a ledger with `regraded_from` reads only `rounds[regraded_from:]`: `files_at_third_edit`, `fix_additions` and `original_additions` are measured from the first round at or after it, so a file edited in three commits before a rebase is not at a third edit; the first full round after a release, with more findings than the last round before it, has `count_not_falling` false and `burden` false; and a finding at a spot a round before the release flagged is not `repeat_unit` (US3 scenario 12, R15)
- [ ] T032 [US3] Extend the gh stub in `dev/alq-review/tests/helpers.py` to answer `repo view --json defaultBranchRef` (and fail on demand), so `github.default_branch` is testable offline
- [ ] T033 [US3] Write failing tests class `Rebase(HeldBranch)` in `dev/alq-review/tests/test_gate.py`, using `Repo.serve_remote`, one per US3 scenario and R13 extra; on every path below, the story branch and its checkout are asserted unchanged until the push lands. The paths of the rebase (data-model "The rebase" and "A recorded rebase found again"): (a) a clean rebase lands: `rebase` recorded as `{onto, worktree, lease, at}` before `git worktree add --detach <worktree> HEAD` runs, the rebase run in `<worktree>` = `<git-common-dir>/alq-rebase/<branch>`, `rebased` saved before `git push --force-with-lease=<branch>:<sha> origin <rebased>:refs/heads/<branch>`, then `git reset --keep <rebased>` in the story checkout, the worktree removed, the record popped, released, recorded `rebase`/`released`, `regraded_from` set; (b) a conflict resolved then lands: the dispatch reply names `Agent(subagent_type='alq-review:conflict-resolver', prompt='<worktree>')`, the record and the worktree kept, lock stays; the resolver's edits of unmerged files in the worktree and its `git add`/`--continue` admitted; `after_bash` of the completing `--continue` pushes from the worktree with the recorded lease, moves the story checkout and releases; a `--continue` that stops again replies "stopped again"; `--abort` removes the worktree, pops `rebase`, keeps the lock, names the files; (c) a spec.md conflict aborts, from `_rebase` and after a `--continue`: the worktree removed, the record popped, the lock kept, the spec.md raised; the resolver's `git add` of an unmerged spec.md refused, and a write to the spec.md in the worktree refused by the story rule; (d) push refused, then a retry lands: the served origin's `pre-receive` hook refuses, nothing forced, the worktree removed, the record popped, the reply git's words and `rebase <ref>` again; after the hook is removed, `rebase <ref>` lands as in (a); also a remote branch moved after the hook's fetch and fetched again, so a bare lease would pass: refused at the push the same way, and the retry stops at the ancestor check ("pull them"); (e) hook killed before the push (a record with no `rebased`, the worktree rebased or only added): the next `rebase <ref>` removes the worktree, pops the record and starts over from step 1, completing as in (a); (f) hook killed after the push landed (a record with `rebased`, `origin/<branch>` at it): the next `rebase <ref>` runs no `git rebase`, moves the story checkout, removes the worktree and releases; (g) the local reset fails after the push (a local change to a file `<rebased>` differs in): the record with `rebased`, the worktree and the lock kept, the reply git's words, `<rebased>` and the manual step `git reset --keep <rebased>` in `<root>`; after the user runs it, `rebase <ref>` releases as in (f); (h) the fetch fails on a found record: git's words, the record, the worktree and the lock kept. The scenarios: (1) mutation refusal under a `RESHAPE_SPEC` lock names the rescope and both keywords; the spec branch is not locked; (2) is (a), and the next round opens against the new `spec.md`; (3) spec unchanged → nothing rebased, no worktree added, lock stays, "has not reached"; (4) is (b) and (c); (5) repeated `rebase <ref>` after a rebase and its push is a no-op and releases; (6) `unlock <ref>` releases with no rebase and no spec check and names `123-spec`; (7) is (d); (8) is (g); (9) stacked PR (base ≠ default) → "land the parent PR first"; (10) bound `spec.md` missing on default → "close this PR and restart the story on the new folder"; (11) remote branch with a commit the checkout lacks → refused before any rebase; (12) the first review round after a release by `rebase <ref>` is a full round (`git diff <base>...HEAD` in its brief, no delta), its facts count only commits since the release, a file at three edits before the rebase not at a third edit, and it is compared with no round before the release; after `unlock <ref>` rounds are measured as before; (13) is (e) and (f); plus: a `git worktree add` that exits non-zero → git's words, the record popped; a worktree removal that exits non-zero → git's words, the record and the lock kept; no locked PR / several; not a `RESHAPE_SPEC` lock; bound to `null`; checkout missing / other branch / dirty; a rebase in progress in the story checkout with no record → abort step, nothing run; gh or fetch failure → their words, lock stays; resolver dispatched with a prompt other than the recorded worktree, or with no recorded rebase, refused; prompts `rebase onto main` and `rebase #<pr> now` get no reply; no reply names a cause git did not state; git subprocesses see `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`

### Implementation for User Story 3

- [ ] T034 [P] [US3] Add `default_branch(slug)` (`gh repo view --json defaultBranchRef`) to `plugins/alq-review/scripts/github.py`, failing loud with gh's words (P4)
- [ ] T035 [P] [US3] Add kinds `add`, `rebase-continue`, `rebase-abort` with `Action.paths` to `shell.classify` in `plugins/alq-review/scripts/shell.py`; T030 passes
- [ ] T036 [P] [US3] Add `unmerged(root)` (read in the rebase worktree) and factor `fetch_target(root, target)` out of `review_base` in `plugins/alq-review/scripts/worktree.py`; T031 passes
- [ ] T037 [US3] In `plugins/alq-review/scripts/policy.py` add `RESOLVER = "alq-review:conflict-resolver"`, `rebase_admits(...)`, and the `RESHAPE_SPEC` closing sentence of `_lock_reason` per R8 using `specbinding.story_issue(state["branch"])`, and have `launch_round` count as `done` only internal rounds from `state["rounds"][state.get("regraded_from", 0):]`; in `plugins/alq-review/scripts/facts.py` have `round_facts` read only those rounds for `first_reviewed`, `base`, `earlier` (so `count_not_falling`) and `seen` (so `repeat_unit`), hence `burden` (R15); the slice is applied at those readers (`launch_round`'s `done`, `round_facts`' `earlier`, `seen`, `first_reviewed` and `base`), never inside `ledger.counted()` (`ledger.py:408`), which stays unsliced on purpose, and so do its readers that span the release: `ledger._append_round`'s round numbering (the `counted()` reader near `ledger.py:425`) and the round caps (`policy._capped`); `briefs.brief`'s `earlier_rounds` keeps reading every round too; callers `gate.on_workflow`, `gate.on_structured_output`, `briefs.churned`, `briefs.brief` and `briefs._review_prompt` stay green; T029 (the cap test included) and T031's facts tests pass
- [ ] T038 [US3] Create `plugins/alq-review/agents/conflict-resolver.md` per contracts "The conflict resolver": name `conflict-resolver`, tools Read, Grep, Glob, Edit, Bash; prompt is the checkout root; reads `git status`/`git diff`, resolves each unmerged file keeping both sides' intent, `git add -- <file>`, `git rebase --continue`, repeats; never edits a spec.md, never `git rebase --skip`; on failure `git rebase --abort` and reports the files; register it wherever `dev/alq-review/tests/test_agents.py` and `dev/alq-review/tests/test_shipped_tree.py` require
- [ ] T039 [US3] In `plugins/alq-review/scripts/gate.py` `_on_release`, match `rebase <ref>` only as the whole trimmed prompt (word `rebase`, one ref, nothing else); implement `_rebase` per data-model "The rebase" steps 1–15 with contracts' replies verbatim, never touching the story branch or its checkout before the push lands: one locked ledger with a `RESHAPE_SPEC` ruling, folder bound, root present on `state["branch"]`; a `rebase` record with a rebase in progress in its `worktree` → the dispatch reply, with none → data-model "A recorded rebase found again"; a rebase in progress in the story checkout with no record → the abort step, nothing run; clean checkout; `github.default_branch` and `github.pr_target` with base == default; `fetch_target` of default and branch; `<sha>` ancestor of HEAD; `tree_blob` present and different from the locked round's `head_sha`; `state["rebase"] = {"onto","worktree","lease","at"}` recorded, `<worktree>` = `<git-common-dir>/alq-rebase/<branch>`, then `git worktree add --detach <worktree> HEAD` in `root` (a failure → git's words, the record popped) and `git -c core.editor=true rebase refs/remotes/origin/<default>` in `<worktree>`; a spec.md conflict → abort, the worktree removed, the record popped; any other conflict → the record and the worktree kept, the dispatch reply naming `<worktree>`; the finish as one function, called by `_rebase`, `after_bash` and the found-again decision: `rebased` saved in the record, `git push --force-with-lease=<branch>:<sha> origin <rebased>:refs/heads/<branch>` in `<worktree>` (refused → the worktree removed, the record popped, git's words and `rebase <ref>` again), `git reset --keep <rebased>` in `root` (non-zero → the record, the worktree and the lock kept, git's words, `<rebased>` and the manual step), then the release (step 15): the worktree removed, `ledger.unlock(state, "user prompt: rebase ...", now)`, `state["regraded_from"] = len(state["rounds"])`, the record popped, `record("rebase", "released")`; a worktree removal exiting non-zero → git's words, the record and the lock kept. The found-again decision: `fetch_target` of the branch (failure → git's words, everything kept); `origin/<branch>` at the record's `rebased` → the reset and the release; anything else → the worktree removed if present, the record popped, the steps start over from step 1. Replies state git's words and shas, no inferred cause; every git subprocess with `GIT_TERMINAL_PROMPT=0` and `GIT_SSH_COMMAND='ssh -o BatchMode=yes'`
- [ ] T040 [US3] In `plugins/alq-review/scripts/gate.py`: a path in a detached checkout that a ledger's `rebase` record names as its `worktree` is located on that ledger's branch, for the story rule (T016–T018), `mutation` and `_held` (R6); `on_agent` refuses a resolver dispatch unless its trimmed prompt equals a ledger's recorded `rebase` `worktree` with a rebase in progress there (contracts' two refusal texts); `on_edit` and `on_bash` skip `policy.mutation` (and `hold` for Bash) when `policy.rebase_admits` admits, reading `payload["agent_type"]` and `worktree.unmerged(<worktree>)`; `after_bash`, after an admitted `rebase-continue` that completed the rebase in the worktree, runs steps 10 and 11 (a stop → the worktree removed, the record popped, that step's reply) and then T039's finish with the recorded `lease` as `<sha>`; it handles stopped-again and spec.md-unmerged (abort, the worktree removed, pop) and admitted `rebase-abort` (the worktree removed, pop, keep lock) with contracts' `systemMessage`s
- [ ] T041 [US3] Update `gate._reshape_brief` (the `unlock` reply) in `plugins/alq-review/scripts/gate.py` to name `<issue>-spec` as where the rescope runs (US3 scenario 6); T033 passes
- [ ] T042 [US3] Add `"timeout": 120` to the UserPromptSubmit `gate.py` entry in `plugins/alq-review/hooks/hooks.json`
- [ ] T043 [US3] Update `plugins/alq-review/README.md`: item 2 (a `RESHAPE_SPEC` lock's two releases and the rescope route), What the user types (`rebase <ref>`), State (the `rebase` record, the rebase worktree it names, and `regraded_from`), Layout (`agents/conflict-resolver.md`) (R14)
- [ ] T044 [US3] Run both suites; open the US3 draft PR stacked on US2 and run the review loops

**Checkpoint**: US1–US3: a wrong spec has a full route back that the user does not have to drive.

---

## Phase 6: User Story 4 - A PR changes the spec or the code, never both (Priority: P4)

**Goal**: A review-round launch of any stage and the attestation refuse a diff that adds or modifies a spec.md and changes a file outside its folder; one pure function decides both (R11).

**Independent Test**: `MixedDiff(SpecArgument)` in `test_gate.py`: branches whose diffs mix and separate spec and code; launch rounds and run `gh pr ready` on each.

**Branch/PR**: `104-us4-<slug>` off the default branch (rebase on US1 for `spec_md_folder`/`story_issue` if US1 has not merged).

### Tests for User Story 4 ⚠️

- [ ] T045 [P] [US4] Write failing tests `MixedDiff` in `dev/alq-review/tests/test_specbinding.py` for `mixed_diff_refusal(changes, branch, then)`: `[("M", "dev/x/specs/123-login/spec.md"), ("M", "b.py")]` refused naming both, `123-spec` and `then`; spec-only passes; `tasks.md` + code passes; `("D", spec.md)` + code passes; two folders' spec.md refused; renamed spec.md (`R`, destination path) counted at its destination; non-story branch uses "the issue's spec branch"
- [ ] T046 [P] [US4] Write a failing test in `dev/alq-review/tests/test_worktree_facts.py` for `worktree.name_status(root, base)`: `(status, path)` pairs from `--name-status -z base...HEAD`, a renamed spec.md giving `R` and the destination path
- [ ] T047 [US4] Extend the gh stub in `dev/alq-review/tests/helpers.py` to answer `api repos/*/pulls/*/files` (with `--paginate`) from `GH_PR_FILES`, and fail on demand
- [ ] T048 [US4] Write failing tests class `MixedDiff(SpecArgument)` in `dev/alq-review/tests/test_gate.py`, one per US4 scenario: (1) mixed diff refused at review-round launch for `internal` and `audit`, any `spec`, naming the spec.md, a file outside its folder and "launch again"; (2) `gh pr ready`, `gh pr create` without `--draft`, and a comment with the attestation marker refused with "mark it ready again"; (3) spec-only PR with `spec: null` passes and reviewers are told the change needs no spec; (4) `b.py` + `tasks.md` passes; (5) deleted spec.md + code with `spec: null` passes; (6) a non-story branch name refused all the same; (7) `log` mode records `would_deny` and the launch opens; plus: assess-round launch runs no diff check; gh file list unavailable or at 3000 files refuses the ready as an unknown PR (P4); edge cases: a story branch cut off `123-spec` before it merged refused; a renamed spec folder with citations refused

### Implementation for User Story 4

- [ ] T049 [P] [US4] Implement `mixed_diff_refusal(changes: list[tuple[str, str]], branch, then) -> str | None` in `plugins/alq-review/scripts/specbinding.py` with contracts' text verbatim; T045 passes
- [ ] T050 [P] [US4] Implement `name_status(root, base)` in `plugins/alq-review/scripts/worktree.py` with `_DIFF --name-status -z base...HEAD` (`--find-renames`, score stripped from `R<score>`, destination path); T046 passes
- [ ] T051 [P] [US4] Implement `pr_files(slug, pr)` in `plugins/alq-review/scripts/github.py`: `gh api --paginate repos/<slug>/pulls/<pr>/files`, map `added→A`, `modified`/`changed→M`, `removed→D`, `renamed→R`, `copied→C`; return `None` when gh cannot answer or the list reaches 3000 files
- [ ] T052 [US4] In `plugins/alq-review/scripts/gate.py` `on_workflow`, for a review-round launch of any stage, after `_review_base` and before `ledger.open_round`, refuse via `hookio.refuse(payload, "launch", ...)` on `specbinding.mixed_diff_refusal(worktree.name_status(root, base), branch, "launch again")`; not for assess-round
- [ ] T053 [US4] In `plugins/alq-review/scripts/gate.py`, at the attestation (`ready` action and the other attestation forms), after `policy.mark_ready` allows, refuse via `hookio.refuse` on `mixed_diff_refusal(github.pr_files(slug, pr), branch, "mark it ready again")`, and refuse as `_unknown_pr` does when `pr_files` is `None`; T048 passes
- [ ] T054 [US4] Update `plugins/alq-review/README.md` item 5 (the diff check) and Mode (the diff check is made through `hookio.refuse`) (R14)
- [ ] T055 [US4] Run both suites; open the US4 draft PR and run the review loops

**Checkpoint**: "spec PR first, then the story PR" is decided in code.

---

## Phase 7: User Story 5 - A rescope runs on the spec branch (Priority: P5)

**Goal**: `/alq-plan:issue-spec rescope <folder> #<issue>` works in the `<issue>-spec` worktree, never a merged one, so the rescoped `spec.md` lands as a spec-only PR (R12).

**Independent Test**: `dev/alq-plan/tests/test_spec_source.py`: the rescope form's resolved `CHECKOUT` and its two closing lines.

**Branch/PR**: `104-us5-<slug>` off the default branch; must release no later than the alq-review version that turns on US1 (R1).

### Tests for User Story 5 ⚠️

- [ ] T056 [US5] Rewrite the rescope test in `dev/alq-plan/tests/test_spec_source.py` as the spec-branch test, failing first: (1) `CHECKOUT` for `rescope dev/x/specs/123-login #123` is the `123-spec` worktree, created off the default branch when none exists; (2) a local or remote `123-spec` already merged into the default branch stops the skill before any write, naming the branch and asking the user to delete it; (3) commit and push land on `123-spec`, closing lines `Spec folder: <path>` and `Branch: 123-spec`, then once: open the spec-only PR, approve it, type `rebase <ref>` for the story branch, relaunch the review; names no other plugin's command

### Implementation for User Story 5

- [ ] T057 [US5] Edit the `rescope` form of `plugins/alq-plan/skills/issue-spec/SKILL.md` per R12: `CHECKOUT` is the `<issue>-spec` worktree (created per the repo's branch rules off the default branch); before any write `git fetch origin` then `git branch -a --merged origin/<default>`, stop naming a merged `<issue>-spec`; step 8's commit and push on that branch; the closing lines of T056; T056 passes
- [ ] T058 [US5] Run `(cd dev/alq-plan/tests && python -m unittest -v)`; bump alq-plan's version per the repo's release practice; open the US5 draft PR and run the review loops

**Checkpoint**: the rescope route the `RESHAPE_SPEC` lock names works.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T059 In the last alq-review story PR to merge, bump the alq-review plugin version (the bump that turns on US1), after confirming US5's alq-plan release has shipped or ships with it (R1)
- [ ] T060 [P] Run `grep -rn 'spec_blob\|spec_held\|text_step' plugins/alq-review ; test $? -eq 1` and both suites from `dev/alq-review/specs/104-spec-md-read-only/quickstart.md` on the final branch (SC-003, SC-005)
- [ ] T061 [P] Walk quickstart.md's manual end-to-end steps 1–5 after each story merges and record the results in its PR
- [ ] T062 Close PR #102 as superseded by #104, after the user confirms (spec Assumptions)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 and T003 must merge before any code PR merges (constitution VI). T004 before T026.
- **Foundational (Phase 2)**: ships inside US1's PR; blocks US1, US3, US4.
- **US1 (P1)**: after Phase 2.
- **US2 (P2)**: stacked on US1 (spec: "comes after User Story 1").
- **US3 (P3)**: stacked on US2 (its release reads the lock US2 reshapes); needs Phase 2's `rebasing`.
- **US4 (P4)**: needs `spec_md_folder`/`story_issue` (Phase 2); otherwise independent of US1–US3.
- **US5 (P5)**: independent code; its release ships no later than the alq-review release that turns on US1.
- **Polish**: after all stories.

### Within Each User Story

- Tests written and seen to fail before their code (quickstart "Red first").
- Pure functions (`specbinding`, `policy`, `shell`, `worktree`, `github`) before `gate.py` handlers.
- README with the story's code, in the same PR.

### Parallel Opportunities

- T003 parallel with T001.
- T005 ∥ T007.
- US1 tests T009 ∥ T010 ∥ T011.
- US2 tests T021 ∥ T022.
- US3 tests T029 ∥ T030 ∥ T031; implementation T034 ∥ T035 ∥ T036.
- US4 tests T045 ∥ T046; implementation T049 ∥ T050 ∥ T051.
- US4 and US5 can proceed in parallel with US1–US3 (separate branches off the default branch).

---

## Parallel Example: User Story 1

```bash
Task: "Write failing StoryWriteRefusal tests in dev/alq-review/tests/test_specbinding.py"
Task: "Write failing write-kind tests in dev/alq-review/tests/test_shell.py"
Task: "Write failing to_commit test in dev/alq-review/tests/test_worktree_facts.py"
```

## Parallel Example: User Story 3

```bash
Task: "Add github.default_branch in plugins/alq-review/scripts/github.py"
Task: "Add kinds add, rebase-continue, rebase-abort in plugins/alq-review/scripts/shell.py"
Task: "Add worktree.unmerged and fetch_target in plugins/alq-review/scripts/worktree.py"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 records (T001, T003) merged.
2. Phase 2 + US1 in one PR: the agent can no longer write the spec it is graded against.
3. **Validate**: `StoryBranch` green; quickstart step 1.

### Incremental Delivery

1. US1 → US2 (hold deleted) → US3 (`rebase` release), stacked.
2. US4 and US5 in parallel off the default branch.
3. Version bump in the last alq-review PR to merge (T059); alq-plan's US5 release no later.

---

## Notes

- Name each edited function's callers in the message before editing it (coding principles); plan.md's Structure Decision lists them.
- Third edit to one file in a branch: stop and diagnose (`.claude/rules/pr-review-loop.md`).
- Outward-facing steps (T002, T003, T062, PR creation) are confirmed with the user first.
