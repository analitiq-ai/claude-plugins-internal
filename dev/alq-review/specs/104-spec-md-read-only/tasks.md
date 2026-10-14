---

description: "Task list for #104: spec.md is read-only on a story branch"
---

# Tasks: spec.md is read-only on a story branch

**Input**: Design documents from `dev/alq-review/specs/104-spec-md-read-only/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: Required (FR-008, SC-001, constitution IV, research R10). Every test task is written, run, and seen to fail
for the reason named before the implementation task after it. A task marked *pin* covers behaviour this feature keeps;
it passes before and after, and says so.

**Organization**: one phase per user story; each story is its own PR on `104-us<N>-<slug>` (research R1).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5, spec.md's user stories
- Paths are repo-root relative. Suites: `(cd dev/alq-review/tests && python -m unittest -v)` and
  `(cd dev/alq-plan/tests && python -m unittest -v)`

---

## Phase 1: Setup (governing records, their own PRs, before any code — R1, constitution VI)

- [ ] T001 Run both suites on the default branch and record that they are green, as the baseline every story PR is measured against (`dev/alq-review/tests`, `dev/alq-plan/tests`)
- [ ] T002 Draft the decision record with `speckit-adrkit-draft` from `dev/alq-review/specs/104-spec-md-read-only/plan.md` into `dev/alq-review/docs/adr/` on branch `104-adr-<slug>`, with its pointer in `plugins/alq-review/README.md`; it replaces ADR-0016 decision 6 and the blob-id part of decision 4, replaces the `spec.md`-blob part of ADR-0019 decision 3 (open PR #93) and that record's closing line "ADR-0016, decision 6, and ADR-0018 stand", and changes ADR-0018 so a `RESHAPE_SPEC` lock is released by `unlock <ref>` when the spec stands and by `rebase <ref>` after a spec change. Open it as its own PR; ask the user before closing PR #105 (hand-written ADR-0020)
- [ ] T003 [P] In the engineering repo, change `docs/engineering/git-workflow.md`: the spec changes through its own spec-only PR on `<issue>-spec`, never in a story PR; spec PR first, then the story PR rebases on it. Its own PR in that repo

---

## Phase 2: Foundational (the terms, defined once — R2)

**Purpose**: the pure term functions US1, US3 and US4 call. Ships in US1's PR (the first story PR cut).

- [ ] T004 Write failing tests in `dev/alq-review/tests/test_specbinding.py` for `spec_folder(path) -> str | None`, `spec_md_folder(path) -> str | None` and `story_issue(branch) -> str | None`, with data-model's examples verbatim: `dev/x/specs/123-login/tasks.md` → `dev/x/specs/123-login`; `b.py`, `docs/spec.md` → None; `dev/x/specs/123-login/spec.md` → `dev/x/specs/123-login` for `spec_md_folder`, `dev/x/specs/123-login/plan.md` → None; `story_issue` matches `^(\d+)-us\d+-`: `123-us2-reset` → `123`; `123-spec`, `123-retire-spec`, `123-adr-hold`, `main`, `feat/1-demo`, None → None. Run; expect `AttributeError`
- [ ] T005 Implement `spec_folder` (by the existing `shape_problem`, not a new regex), `spec_md_folder` and `story_issue` in `plugins/alq-review/scripts/specbinding.py`; rewrite the module docstring per R2 (what a spec folder and a spec.md are, the `spec` argument, its binding, the two rules that keep a spec.md out of a story PR). T004 green

**Checkpoint**: the terms exist; no caller yet.

---

## Phase 3: User Story 1 - A story branch's edit tools cannot change a spec.md (Priority: P1) 🎯 MVP

**Goal**: on a story branch, `Edit`, `Write` and `NotebookEdit` of a spec.md are refused by path, before the ledger or GitHub is read.

**Independent Test**: in `test_gate.py`'s harness, on a checkout of `123-us2-reset` with a committed `dev/x/specs/123-login/spec.md`, send each edit tool and read the refusal; on `123-spec` the same writes pass this rule.

**Branch**: `104-us1-<slug>` off the default branch, carrying Phase 2.

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [ ] T006 [US1] Write failing tests in `dev/alq-review/tests/test_specbinding.py` for `story_edit_refusal(branch: str | None, path: str) -> str | None`: on `123-us2-reset` with `dev/x/specs/123-login/spec.md` it returns contracts "The edit rule" text naming the path, the folder, the branch and `123-spec`; it returns None for branches `123-spec`, `123-retire-spec`, `123-adr-hold`, `main`, None (detached HEAD), and for `plan.md`, `tasks.md`, `research.md` of the folder and `docs/spec.md`. Expect `AttributeError`
- [ ] T007 [US1] Write failing tests in `dev/alq-review/tests/test_gate.py`, a new class on a story-branch checkout with a committed spec.md (reuse `Gate`, `SpecArgument.commit_files`): scenario 1 (`Edit`, `Write`, `NotebookEdit` each refused, action `spec-edit`, text names the file and `123-spec`); 2 (`123-spec`, `123-retire-spec`, `123-adr-hold`, default branch: not refused by this rule); 3 (`plan.md`, `tasks.md`, `research.md` pass); 4 (no PR, no ledger, no round: still refused, and the gh stub is not called); 5 (a Bash write and a commit of the spec.md are not refused by this rule); 6 (`log` mode: recorded `would_deny`, not blocked); edge cases: an absolute path into another worktree is judged by that worktree's branch; a detached HEAD (a rebase in progress) refuses nothing. Expect the edits to be allowed

### Implementation for User Story 1

- [ ] T008 [US1] Implement `story_edit_refusal` in `plugins/alq-review/scripts/specbinding.py` from `story_issue` and `spec_md_folder`, text per contracts "The edit rule". T006 green
- [ ] T009 [US1] In `plugins/alq-review/scripts/gate.py` `on_edit` (caller: `gate.PRE` for `Edit`, `Write`, `NotebookEdit`), right after `where = worktree.locate(path)` and its None check and before `target(where)`: take `path` relative to `where.root`, call `specbinding.story_edit_refusal(where.branch, rel)`, and on a text return `refuse(payload, "spec-edit", text, Target(where.slug, None, where.branch, where.root))`. Read nothing of the ledger or GitHub first (R3). T007 green
- [ ] T010 [US1] In `plugins/alq-review/README.md`: new item 8 (on a story branch the edit tools never change a spec.md; the next step is the spec-only PR on `<issue>-spec`), Mode (the edit rule is made through `hookio.refuse`), Layout (`specbinding.py`'s new line) — R11
- [ ] T011 [US1] Run both suites; all green. Run the PR tripwire `git log --name-only <base>..HEAD | sort | uniq -c | sort -rn`

**Checkpoint**: US1 is live; a story branch's edit tools cannot move the spec.

---

## Phase 4: User Story 2 - Every round grades against spec.md at the reviewed commit, and the gate keeps no copy (Priority: P2)

**Goal**: delete the hold; the binding is the `spec` value alone; `spec.md` is read at the reviewed commit every round.

**Independent Test**: bind a PR to a folder, commit a change to its `spec.md`, launch the next review round and the assessment, and read the ledger and the refusals.

**Branch**: `104-us2-<slug>` stacked on `104-us1-<slug>`.

### Tests for User Story 2 ⚠️

- [ ] T012 [US2] Before deleting anything, run the hold's tests once on the default branch (`test_gate.py`'s `SpecArgument` hold tests, `test_policy.py`'s spec-hold cases, `test_specbinding.py`'s `TextStep`) and record the output for the US2 PR body (R10: the "did not converge" is observed)
- [ ] T013 [US2] Write failing tests in `dev/alq-review/tests/test_gate.py`: scenario 1 / SC-004 (a PR bound to a folder whose `spec.md` changed since its first round: review-round and assess-round both open, no diff shown, no hold recorded, no `unlock` asked); scenario 2 (after a round opens the ledger holds `spec` and neither `spec_blob` nor `spec_held`); scenario 6 (a stored ledger carrying `spec_blob` and `spec_held`: nothing reads them, and a PR held only by a changed `spec.md` is held no longer). Expect a hold refusal / those keys present
- [ ] T014 [P] [US2] Write *pin* tests in `dev/alq-review/tests/test_gate.py` if not already covered: scenario 3 (internal reviewers and the assessor are told to read `<folder>/spec.md` in the checkout and quoted none of its text); scenario 4 (`spec.md` missing or empty at the reviewed commit: refused naming the path; assess: "restore it with the user's commit"). These pass before and after
- [ ] T015 [P] [US2] Write failing tests in `dev/alq-review/tests/test_policy.py`: scenario 5 (a lock reason names a `RESHAPE_SPEC`, `ESCALATE` or spent-audit hold only, never a changed `spec.md`; a state with `spec_held` set and no other hold is not locked)

### Implementation for User Story 2

- [ ] T016 [US2] Delete the hold's tests: in `dev/alq-review/tests/test_gate.py` the `SpecArgument` hold tests, `held()`, `assertHeldWithTheDiff`; in `dev/alq-review/tests/test_policy.py` the spec-hold fixtures and cases; in `dev/alq-review/tests/test_specbinding.py` `TextStep`
- [ ] T017 [US2] In `plugins/alq-review/scripts/gate.py` (callers: `_spec_step` and `_assess_spec_step` by `on_workflow`; `_refuse_spec` and `_admit_spec` by `on_workflow`, two sites each): delete `_spec_text`, `SpecStep.holds`, `_refuse_spec` and `_admit_spec`'s hold clearing; replace `_head_spec_md` with `_spec_md_present(root, head, folder, restore) -> str | None` (the refusal when `spec.md` is missing, empty or unreadable at `head`) through `_spec_md_blob`, kept whole; `_spec_step` binds `{"spec": value}` only and on a bound PR checks presence and binds nothing; `_assess_spec_step` checks presence only. T013 green
- [ ] T018 [P] [US2] In `plugins/alq-review/scripts/specbinding.py` delete `text_step` and its `released` import
- [ ] T019 [P] [US2] In `plugins/alq-review/scripts/policy.py` delete `_spec_held` and the hold in `_holds` (callers of `_holds`: `locked`, `_lock_reason`). T015 green
- [ ] T020 [US2] In `plugins/alq-review/README.md`: item 2 loses the changed-spec hold sentence; item 5 says the binding is the `spec` value and `spec.md` is read at the reviewed commit each round, the hold paragraph removed; State names the ledger's `spec`. No `spec_blob`, `spec_held` or `text_step` anywhere (R11)
- [ ] T021 [US2] Run both suites green and `grep -rn 'spec_blob\|spec_held\|text_step' plugins/alq-review ; test $? -eq 1` (SC-003)

**Checkpoint**: no hold; a spec.md change between rounds costs no `unlock`.

---

## Phase 5: User Story 3 - `rebase` releases a `RESHAPE_SPEC` lock after a spec change (Priority: P3)

**Goal**: the lock names the rescope route; `rebase <ref>` checks the spec changed on the default branch, releases, records `rebased_onto` and `regraded_from`; the session rebases; the next round waits for the commit and is measured afresh (FR-009, FR-010).

**Independent Test**: lock a story with a `RESHAPE_SPEC` ruling, merge a change to its bound `spec.md` into the default branch (or not), send `rebase <ref>` and `unlock <ref>` as the prompt, and launch the next round before and after rebasing.

**Branch**: `104-us3-<slug>` stacked on `104-us2-<slug>`.

### Tests for User Story 3 ⚠️

- [ ] T022 [P] [US3] Write failing tests in `dev/alq-review/tests/test_worktree_facts.py` against a bare origin (`Repo.serve_remote`): `worktree.fetch_target(root, target) -> str` updates `origin/<target>` and returns its sha, git failure raises `RuntimeError` in git's words, and `review_base` still gives today's answer through it; `worktree.contains(root, sha) -> bool` is True when HEAD contains `sha`, False when it does not or the checkout does not know `sha`, `RuntimeError` in git's words otherwise
- [ ] T023 [P] [US3] Write failing tests in `dev/alq-review/tests/test_policy.py`: R5's lock text when a `RESHAPE_SPEC` ruling holds the branch (rescope on `123-spec`, "the issue's spec branch" for a non-story branch, lands as a spec-only PR while this branch stays locked, then `rebase <ref>`; or `unlock <ref>` if the spec stands); with no `RESHAPE_SPEC` ruling the closing sentence is today's less "Editing the spec or changing files another way does not release it"; `launch_round` refuses when `rebased_onto` is set and HEAD does not contain it (contracts `contains`, exit 1 text naming `<default>` and `<onto>`); after `regraded_from` the next round is `scope="full"` with no `delta_from` (`done` via `counted(..., regraded_only=True)`), and `_capped` still counts every round
- [ ] T024 [P] [US3] Write failing tests in `dev/alq-review/tests/test_worktree_facts.py` for `facts.round_facts` after a release: `earlier` from `counted(..., regraded_only=True)`, `seen`, `first_reviewed` and `base` from `ledger.regraded_rounds`; a file edited in three rounds before `regraded_from` is not at a third edit; absent `regraded_from` reads as 0 and facts are unchanged
- [ ] T025 [P] [US3] Write failing tests in `dev/alq-review/tests/test_agents.py` for `plugins/alq-review/agents/conflict-resolver.md` against contracts "The conflict resolver": name `conflict-resolver`; tools Read, Grep, Glob, Edit, Bash; body says it never edits a spec.md, never runs `git rebase --skip`, and on a spec.md among the unmerged files or a file it cannot resolve runs `git rebase --abort` and reports the files; and in `dev/alq-review/tests/test_shipped_tree.py` list `alq-review:conflict-resolver`
- [ ] T026 [US3] Write failing tests in `dev/alq-review/tests/test_gate.py` for `rebase <ref>`, one per check of data-model "`rebase <ref>`" in order, each failure keeping the lock and recording nothing, with the gh stub answering the default-branch and PR-base lookups: whole-prompt match only (`rebase #12 now` gets no reply and runs no fetch); `names` (none / several: as `unlock`'s replies with `rebase`); `ruling` (an `ESCALATE` or spent-audit lock); `bound` (`spec` null); `checkout` (round's root gone); `default` (gh fails: its words); `base` (stacked PR: "land the parent PR first"; no open PR passes; gh fails); `fetch` (git fails); `onto spec.md` (missing or empty on the default branch: "the binding never changes"; git fails); `head spec.md` (git fails); `changed` (same blob: "The spec PR has not reached `<default>`"). The release: `ledger.unlock` applied, `regraded_from` set to the index of the next round, `rebased_onto` = `{"branch": <default>, "sha": <onto>}`, a `rebase released` record, all in one save; a second release replaces the pair; the reply names every hold released and the session's next step (contracts `release` text, including `Agent(subagent_type='alq-review:conflict-resolver', prompt='<root>')` and `git push --force-with-lease`); the only git write is `origin/<default>` (no local branch, checkout, worktree or remote branch changes); typing it twice is safe. `unlock <ref>` on a `RESHAPE_SPEC` lock releases with no spec check, leaves `regraded_from` and `rebased_onto` unchanged, and its reply names `123-spec`. Launch after release: refused until HEAD contains `<onto>` (scenario 7), git failure refused as `_review_base`'s; once rebased, a full round with facts restarted (scenario 8); after `unlock` rounds are measured as before

### Implementation for User Story 3

- [ ] T027 [P] [US3] Add `default_branch(slug: str) -> str` to `plugins/alq-review/scripts/github.py`: the default branch's name; gh fails → `RuntimeError` in gh's words. Only caller: `gate._rebase`
- [ ] T028 [P] [US3] In `plugins/alq-review/scripts/worktree.py`, factor `fetch_target(root, target) -> str` out of `review_base` (which calls it; its caller `gate._review_base` is unchanged) and add `contains(root, sha) -> bool` per data-model "New interfaces". T022 green
- [ ] T029 [P] [US3] In `plugins/alq-review/scripts/ledger.py` add `regraded_rounds(state)` = `state["rounds"][state.get("regraded_from", 0):]` and give `counted(state, stage, *, regraded_only=False)` the keyword, filtering that slice when set. Callers of `counted` stay unsliced except where T030/T031 set it: `policy._capped`, `ledger._append_round` and `briefs.brief`'s `earlier_rounds` keep every round (R12)
- [ ] T030 [US3] In `plugins/alq-review/scripts/facts.py` `round_facts` (callers: `gate.on_structured_output`, `briefs.churned`, `briefs.brief`): `earlier` via `counted(..., regraded_only=True)`; `seen`, `first_reviewed`, `base` from `ledger.regraded_rounds`. T024 green
- [ ] T031 [US3] In `plugins/alq-review/scripts/policy.py`: `_lock_reason` ends with R5's `RESHAPE_SPEC` text (issue from `specbinding.story_issue(state["branch"])`), and otherwise drops "Editing the spec or changing files another way does not release it"; `launch_round` (caller `gate.on_workflow`; `delta_from` read by `briefs._review_prompt`) takes whether HEAD contains `rebased_onto["sha"]`, refuses with contracts `contains` exit-1 text when it does not, and computes `done` via `counted(..., regraded_only=True)`. T023 green
- [ ] T032 [US3] In `plugins/alq-review/scripts/gate.py`: `_reshape_brief` (the `unlock` reply) names `<issue>-spec` as where a rescope runs; `_on_release` (caller `on_prompt`) reads `rebase <ref>` only when the trimmed prompt is exactly `rebase` and one ref; new `_rebase(payload, ref)` runs data-model's checks in order through `_names`, `policy.locked`, `reshape_spec_ruling`, `github.pr_target`, `github.default_branch`, `worktree.fetch_target`, `_spec_md_blob` at `<onto>` and at the locked round's `head_sha`, replies per contracts "`rebase <ref>`" with `<sha>` the commit the failing read named, and on pass releases in one save (`ledger.unlock`, `regraded_from`, `rebased_onto`, `rebase released` record)
- [ ] T033 [US3] In `plugins/alq-review/scripts/gate.py` `on_workflow`, at a review-round launch of any stage after the lock and dirty checks: when `rebased_onto` is set call `worktree.contains(root, rebased_onto["sha"])` and pass the answer to `policy.launch_round`; a `RuntimeError` is refused as `_review_base`'s failure is. T026 green
- [ ] T034 [US3] Create `plugins/alq-review/agents/conflict-resolver.md` per contracts "The conflict resolver" (frontmatter name `conflict-resolver`, tools Read, Grep, Glob, Edit, Bash; prompt is the checkout; reads `git status`/`git diff`, edits each unmerged file so both sides' intent survives, `git add -- <file>`, `git rebase --continue`, repeats; never edits a spec.md, never `git rebase --skip`; aborts and reports on a spec.md conflict or an unresolvable file). T025 green
- [ ] T035 [US3] In `plugins/alq-review/README.md`: item 2 names a `RESHAPE_SPEC` lock's two releases and the rescope route; What the user types adds `rebase <ref>` and the session's next step after it; State adds `regraded_from` and `rebased_onto`; Layout adds `agents/conflict-resolver.md` (R11)
- [ ] T036 [US3] Run both suites green; tripwire as T011

**Checkpoint**: a story locked for a wrong spec has a way back onto the changed spec.

---

## Phase 6: User Story 4 - A PR changes the spec or the code, never both (Priority: P4)

**Goal**: a review-round launch of any stage refuses a diff that adds or modifies a spec.md and changes a file outside its folder (`mixed`, `folders`); any launch whose last counted head is not an ancestor of HEAD is a full round (FR-004, FR-011).

**Independent Test**: build branches whose diffs mix and separate spec and code, and launch rounds on each.

**Branch**: `104-us4-<slug>` off the default branch once US1 (Phase 2's terms) and US3 (`worktree.contains`) have merged.

### Tests for User Story 4 ⚠️

- [ ] T037 [P] [US4] Write failing tests in `dev/alq-review/tests/test_specbinding.py` for `mixed_diff_refusal(changes: list[tuple[str, str]], branch: str) -> str | None`: `[("M", "dev/x/specs/123-login/spec.md"), ("M", "b.py")]` on `123-us2-reset` → `mixed` text naming the spec.md, `b.py`, `123-spec`; on a non-story branch → "the issue's spec branch"; one folder only → None; `b.py` + `tasks.md` → None; `("D", …/spec.md)` + code → None; a move (`D` old folder's spec.md, `A` new folder's spec.md, both folders' other files) → `folders` naming both folders and the two-PR route; two folders → `folders`; the first non-`D` spec.md decides `F`
- [ ] T038 [P] [US4] Write failing tests in `dev/alq-review/tests/test_worktree_facts.py` for `worktree.name_status(root, base) -> list[tuple[str, str]]`: each path changed from the merge base of `base` and HEAD, once, as `(status, path)`; a rename as its `D` and its `A`; git failure raises `RuntimeError` in git's words
- [ ] T039 [P] [US4] Write failing tests in `dev/alq-review/tests/test_policy.py` for FR-011: `launch_round` told the last counted round's head is not an ancestor of HEAD (or unknown) gives `scope="full"` and no `delta_from`, and leaves the round facts' slice untouched
- [ ] T040 [US4] Write failing tests in `dev/alq-review/tests/test_gate.py`: scenario 1 (`spec.md` + `b.py`, refused for `spec` null and a folder, stage internal and audit, naming both and `123-spec`); 2 (spec-only PR, `spec: null`: passes, reviewers told the change needs no spec); 3 (`b.py` + `tasks.md`: passes); 4 (deleted spec.md + code, `spec: null`: passes); 5 (branch not named as a story branch: refused all the same); 6 (`log` mode: `would_deny`, launch opens); 7 (story branch rebased after its last round without `rebase <ref>`: full round, facts measured as before); edge cases: a story branch cut off `123-spec` before the spec PR merged is refused; a folder move gets `folders`; a git failure in the diff read is refused as `_review_base`'s; an assess-round launch runs no diff check

### Implementation for User Story 4

- [ ] T041 [P] [US4] Add `name_status(root, base) -> list[tuple[str, str]]` to `plugins/alq-review/scripts/worktree.py`, modelled on `changed_files` and `_DIFF`, renames split into `D` + `A`. T038 green
- [ ] T042 [P] [US4] Add `mixed_diff_refusal` to `plugins/alq-review/scripts/specbinding.py` per data-model "The diff check" and contracts `mixed`/`folders` texts. T037 green
- [ ] T043 [US4] In `plugins/alq-review/scripts/policy.py` `launch_round` (caller `gate.on_workflow`), take whether the last counted round's head is an ancestor of HEAD; on False give `scope="full"` and no `delta_from`, round facts untouched. T039 green
- [ ] T044 [US4] In `plugins/alq-review/scripts/gate.py` `on_workflow`, at a review-round launch of any stage, after `_review_base` and inside its `try`, before `ledger.open_round`: `specbinding.mixed_diff_refusal(worktree.name_status(root, base), where.branch)`; a text is refused through `refuse(payload, "launch", text, event)`; and pass `worktree.contains(root, <last counted head>)` to `policy.launch_round` (FR-011). Assess-round launches run no diff check. T040 green
- [ ] T045 [US4] In `plugins/alq-review/README.md`: item 5 replaces the old hold paragraph's place with the diff check and its two replies; item 8 adds that the diff check stands behind the edit rule for every other route; Mode names the diff check as made through `hookio.refuse` (R11)
- [ ] T046 [US4] Run both suites green; tripwire as T011

**Checkpoint**: no round opens on a PR that changes a spec.md and code together.

---

## Phase 7: User Story 5 - A rescope runs on the spec branch (Priority: P5)

**Goal**: `/alq-plan:issue-spec rescope <folder> #<issue>` works in the `<issue>-spec` worktree, never the story PR's (FR-006).

**Independent Test**: run the skill's entry-point resolution on a rescope and read the checkout it names and the closing lines.

**Branch**: `104-us5-<slug>` off the default branch; its alq-plan release ships no later than the alq-review release that turns US1 on (R1).

### Tests for User Story 5 ⚠️

- [ ] T047 [US5] In `dev/alq-plan/tests/test_spec_source.py`, replace the rescope test (story PR's worktree) with failing tests: scenario 1 (`rescope dev/x/specs/123-login #123` resolves `CHECKOUT` to the `123-spec` worktree, created off the default branch per the repo's branch rules when there is none); 2 (a local or remote `123-spec` merged into the default branch: the skill fetches and stops before any write, naming it and asking the user to delete it; never reuses it); 3 (commit and push land on `123-spec`; closing lines `Spec folder: <path>` and `Branch: 123-spec`, then once: open the spec-only PR, approve it, type `rebase <ref>` for the story branch, relaunch the review; no other plugin's command named)

### Implementation for User Story 5

- [ ] T048 [US5] Edit the `rescope` form in `plugins/alq-plan/skills/issue-spec/SKILL.md` per R9 and contracts "`/alq-plan:issue-spec rescope`"; the skill's two forms and `DRIVE` steps otherwise unchanged. T047 green
- [ ] T049 [US5] Bump `plugins/alq-plan/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json`; run `dev/alq-plan/tests` green

**Checkpoint**: the route the `RESHAPE_SPEC` lock names works.

---

## Phase 8: Polish & Cross-Cutting

- [ ] T050 In the last alq-review story PR to merge, bump `plugins/alq-review/.claude-plugin/plugin.json` and its entry in `.claude-plugin/marketplace.json` once (R1); this release turns US1 and US4 on
- [ ] T051 Run quickstart.md end to end against the merged default branch (`dev/alq-review/specs/104-spec-md-read-only/quickstart.md` steps 1–5), the SC-003 grep, and both suites; record the result
- [ ] T052 Ask the user before closing PR #102 (superseded by this issue, spec Assumptions)

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)**: T002 and T003 land as their own PRs before the first code PR (constitution VI)
- **Foundational (Phase 2)**: ships inside US1's PR; blocks US1, US3 (`story_issue` in the lock text) and US4
- **US1**: off the default branch, after Phase 2
- **US2**: stacked on US1
- **US3**: stacked on US2 (its lock text reads the lock US2 reshapes)
- **US4**: off the default branch after US1 and US3 merge (needs Phase 2's terms and `worktree.contains`). R1 lists US4 "off the default branch"; the dependency on US3's `contains` was not in it, so US4 waits for that merge
- **US5**: independent of the others (alq-plan only); release no later than the alq-review release (T050)
- **Polish**: T050 in the last alq-review story PR; T051 after all merge

### Within each story

Tests written and seen to fail → pure functions (`specbinding`, `ledger`, `worktree`, `github`) → `policy`/`facts` → `gate` handlers → README → suites green.

### Parallel opportunities

- T003 beside T002 (different repos)
- US5 (Phase 7) beside any alq-review story
- US2: T014 and T015 (different files); T018 and T019 after T017
- US3: T022, T023, T024, T025 (tests in four files; T022 and T024 share `test_worktree_facts.py`, so run them as one task when one agent writes them); T027, T028, T029 (three modules)
- US4: T037, T038, T039 (three test files); T041, T042

---

## Parallel Example: User Story 3

```bash
# Tests first, in separate files:
Task: "fetch_target/contains tests in dev/alq-review/tests/test_worktree_facts.py"
Task: "lock text and launch_round tests in dev/alq-review/tests/test_policy.py"
Task: "conflict-resolver frontmatter tests in dev/alq-review/tests/test_agents.py"

# Then the leaf modules together:
Task: "github.default_branch in plugins/alq-review/scripts/github.py"
Task: "worktree.fetch_target and contains in plugins/alq-review/scripts/worktree.py"
Task: "ledger.regraded_rounds and counted(regraded_only) in plugins/alq-review/scripts/ledger.py"
```

---

## Implementation Strategy

### MVP (User Story 1)

1. Phase 1 records merged
2. Phase 2 + Phase 3 in `104-us1-<slug>`: the edit rule
3. Validate with quickstart step 1; the internal and Codex review loops per `pr-review-loop.md`

### Incremental delivery

US1 → US2 (hold deleted) → US3 (`rebase`) → US4 (diff check) → T050 version bump in the last alq-review PR. US5 any time before T050's release. Each story PR runs the full review loop and is merged before the next stacked one is rebased onto the default branch.

## Notes

- Name each edited function's callers in the PR before the first edit (the callers are listed in plan.md "Structure Decision")
- Third edit to one file in a branch: stop and diagnose (pr-review-loop.md)
- No migration of stored ledgers; no backwards compatibility
