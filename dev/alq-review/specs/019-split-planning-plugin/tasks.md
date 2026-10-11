# Tasks: Split alq-review into review, plan and build plugins

**Input**: `specs/019-split-planning-plugin/` (plan.md, spec.md, research.md, data-model.md, contracts/interfaces.md,
quickstart.md)

**Tests**: Requested. Constitution IV: every test task is written first, run, and seen to fail for its stated reason
before the code it grades. A test that is green on its first run is reported as such and not counted as proof.

**Organization**: by user story, inside the shipping order of R17. Phase 1 is the PRs that land before this branch.
Phases 2 to 7 are PR 1 (behaviour, this branch). Phase 8 is PR 2 (the move). Phase 9 is what follows.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- Paths are from the repository root. Run tests from `dev/alq-review/`: `python3 -m unittest discover -s tests`
- Source is `plugins/alq-review/`; tests are `dev/alq-review/tests/` until Phase 8
- R-numbers are `research.md`; "row n" is the refusal table in `contracts/interfaces.md`

## Rules for every task

- Before editing code that runs, name its callers in the message first (plan.md, Structure Decision lists them).
- Third edit to one file: stop and diagnose (pr-review-loop). Files touched in more than one task below, with the
  reason: `gate.py` (T016 binding, spec.md hold, call sites of `review_call` and settled-design removal, T037 rescope
  removal), `policy.py` (T020 call text, spec.md hold and `first_internal_round` removal, T038 rescope removal),
  `test_gate.py` and `test_policy.py` (T011 to T013, then story 1's test rework with T035 and T036 in one commit: no
  third edit),
  `test_spec_source.py` (T015 deletes, T032 adds, T051 splits it by plugin: the third is a move, written once from
  the settled text), `README.md` of alq-review (T039, T052).
- No backwards compatibility: no reader for the location comment, no `ALQ_REVIEW_ROOT` alias, no handling of a PR
  with no binding (a PR started before this change has none and no code handles it).

---

## Phase 1: Setup (lands before this branch; not on it)

**Purpose**: the rollout of R17 steps 1 to 3.

- [x] T001 In the `cto` repo, add `spec: '<spec folder>' | null` to the review-round call in `.claude/rules/pr-review-loop.md`, in its own PR (R17 step 1).
- [ ] T002 The user disables alq-review in `~/.claude/settings.json` (`"alq-review@alq-internal": false`) until T043's release is installed. PRs from here to PR 1 are reviewed by hand with `/pr-review-toolkit:review-pr` (R17).
- [x] T003 The user reviews and merges #69 (R17 step 2). Merged 2026-10-09 as draft records ADR-0016 to ADR-0018; the drafted ADR-0019 was dropped.
- [x] T004 In its own PR, create `dev/alq-plan/` and `dev/alq-build/` with `specify init` at Spec Kit 1.0.7 and the extensions `dev/alq-review/.specify/extensions.yml` lists (adrkit, assess, critique, grill) (R16).
- [x] T005 In the PR of T004, write `dev/alq-plan/.specify/memory/constitution.md`: principles I to VI copied verbatim from `dev/alq-review/.specify/memory/constitution.md`; plugin principles P1 reworded ("every planning rule is decided by a workflow step that runs a script, not by the agent obeying text"), P3, P4, P5 (R16).
- [x] T006 [P] In the PR of T004, write `dev/alq-build/.specify/memory/constitution.md`: principles I to VI verbatim; plugin principles P4 and P5 (R16).
- [x] T007 In the PR of T004, draft with the adrkit draft skill in `dev/alq-plan/docs/adr/`: one record each deciding again ADR-0008 decision 1, ADR-0009, ADR-0011 and ADR-0012 decision 1 for alq-plan, and the two ADR-0016 leaves to this log: the part of ADR-0008 decision 2 about the skill that shapes an issue, and what planning does with an issue that needs no spec or is not worth doing. Status draft, decided for this plugin, not copied (R16).
- [x] T008 [P] In the PR of T004, draft with the adrkit draft skill in `dev/alq-build/docs/adr/`: records deciding again ADR-0008 decisions 1 and 2 for alq-build. Status draft (R16).

---

## Phase 2: Foundational (PR 1; blocks US1 and US4)

**Purpose**: the pure spec-argument module every review change uses.

- [x] T009 Create `dev/alq-review/tests/test_specbinding.py`. `parse`: a folder path gives `Folder(path)`; `None` gives `NoSpec()`; surrounding whitespace stripped; an empty string raises; a number, list or dict raises; `none` and `nonesuch/specs/x` are read as folders. `shape_problem`: absolute path, a `..` segment, and a parent not named `specs` each give a text naming the rule; `dev/alq-review/specs/019-x` gives None. `bind(recorded, given)`: equal gives None, `None` with `None` included; different gives a text holding both values and saying the bound value never changes. `text_step(bound_blob, head_blob, held_at, unlocked_at)`: equal blobs give `same`; different blobs with no hold give `hold`; with a hold at or after `unlocked_at` (or no unlock) give `hold`; with a hold before `unlocked_at` give `bind` (R18). No git (R7).
- [X] T010 Create `plugins/alq-review/scripts/specbinding.py`: `Folder`, `parse`, `shape_problem`, `bind`, `text_step` as T009 grades them, `text_step` asking R18's one unlock predicate, `ledger.released`, whether the hold was released; move `NoSpec` here from `plugins/alq-review/scripts/speclocation.py` with no `reason` field. `FoundSpec` is not moved: `Folder` serves. Standard library only, pure (R7, constitution P3). Depends on T009.

**Checkpoint**: `test_specbinding` green.

---

## Phase 3: User Story 1 - Review is told the spec and reads only what it needs (Priority: P1) 🎯 MVP

**Goal**: every review-round launch carries `spec`; the gate verifies it against HEAD, binds it and its `spec.md`
text to the PR at the first round, holds the PR when that text changes, and gives reviewers and the assessor the path
of `spec.md`, quoting nothing, with no heading assumed.

**Independent Test**: launch rounds through the gate's hook handlers with each kind of `spec` value (spec US1).

### Tests for User Story 1 (write first, see red)

- [x] T011 [US1] In `dev/alq-review/tests/test_gate.py` replace class `IssueSpec` (from line 272) with class `SpecArgument(Gate)`: rows 1 to 7 of `contracts/interfaces.md`, each asserting the step named in the refusal (row 7: the diff); every binding case in its "Binding cases" table (first launch records `state["spec"]` and `state["spec_blob"]`; a launch refused by any rule records no binding; same value again opens; same value with `spec.md` since deleted in HEAD gives row 4; two PRs each bound to their own folder; `null` opens with no spec; a changed `spec.md` gives row 7, records `spec_held` and refuses an edit on the branch; in `log` mode it records no `spec_held`, leaves `spec_blob` and opens the round; a launch while held gives row 7 again; `unlock <ref>` then a launch opens and binds HEAD's blob; a RESHAPE_SPEC unlock then a rescope commit gives row 7). Each refusal goes through `hookio.refuse`: in `log` mode the launch passes with a log line. A git failure while reading `spec.md` or diffing (row 5) is a refusal, never the top-level handler (R9). Also: the reviewer prompt names `<folder>/spec.md`, quotes none of it, and contains neither "Acceptance criterion" nor "Out of scope" (R10); the assessor brief gives `spec_folder` from `state["spec"]` with no `spec` argument on the assess launch (R8). Rework `KeyedByPr` (from line 907) where it resolves the spec through the issue.
- [x] T012 [US1] In `dev/alq-review/tests/test_gate.py` delete classes `SpecChecks`, `SettledDesign` and `DesignDocuments` (from line 1279) and the import of `test_settled_design` (R11). Same file as T011: after it.
- [x] T013 [P] [US1] In `dev/alq-review/tests/test_policy.py` assert that `policy.review_call(state, stage)` carries `spec: '<bound folder>'` or `spec: null` when `state["spec"]` is set and `spec: '<spec folder>' | null` when not or when `state` is `None`, and that the dead-round relaunch, the audit cap and mark-ready messages carry it (R13); adjust `Mutation` (from line 27) where it pins the old text. Also: `locked` and `mutation` hold a state whose `spec_held.at` is at or after `unlocked_at` and not one whose `spec_held.at` is before it; the reason names the folder, both blob ids, `git diff <bound> <head>` and `unlock <ref>`; with a verdict lock or spent audits also active, the reason names each hold (R18).
- [x] T014 [P] [US1] In `dev/alq-review/tests/test_worktree_facts.py` replace the `mock.patch("speclocation.resolve", ...)` at about line 260 (and the one near line 247) by setting `state["spec"]` and `state["spec_blob"]` to `None` so `briefs.brief` needs no network; keep what each test checks.
- [x] T015 [P] [US1] Delete `dev/alq-review/tests/test_speclocation.py`. In `dev/alq-review/tests/test_spec_source.py` delete every test of the location comment, its marker, its post/none/show commands and comment paging (`test_tackle_and_root_cause_name_the_show_command_and_alq_spec`, `..._no_comment_sentence_...`, `..._do_not_spell_the_marker`, `..._hold_no_jq_filter`, `test_alq_spec_says_to_stop_on_located_...`, `test_alq_spec_names_the_location_script_...`, `test_alq_spec_commits_then_pushes_then_posts_...`, `test_every_skill_reads_an_issues_comments_...`) and the pin `test_root_cause_check_names_the_heading_and_both_openings_that_rootcause_py_grades` (FR-022).

### Implementation for User Story 1

- [X] T016 [US1] Callers: `hooks/hooks.json` PreToolUse Workflow → `gate.main` → `on_workflow`; `hooks/hooks.json` → `gate.main` → `on_agent`, `on_skill`. In `plugins/alq-review/scripts/gate.py` `on_workflow`: read `args["spec"]`; refuse rows 1 to 3 from `specbinding`; for a `Folder`, read `git ls-tree -l -z <head sha> -- <folder>/spec.md` through `worktree.git`, at the head sha the round is pinned to, not symbolic HEAD (missing or empty: row 4; else its blob id); turn a `RuntimeError` from that read or from the diff into row 5 with git's error; when the PR has a binding, refuse row 6 by `specbinding.bind(state["spec"], value)`, then `specbinding.text_step`: on `hold` refuse row 7 with `git diff <bound blob> <head blob>` through `worktree.git`, recording `state["spec_held"]` if absent only when the refusal blocks (`enforce`); in `log` mode the launch is logged as a would-deny, the binding stays as it was, no hold is recorded and the round opens; on `bind` set `state["spec_blob"]` to HEAD's; with no binding set `state["spec"]` and `state["spec_blob"]`; set them, and delete `spec_held`, in the same save that opens the round. These steps run before `policy.launch_round`. Assess launches take the spec from `state["spec"]`. The spec refusals, `on_agent` and `on_skill` print the call from `policy.review_call` (R13). `worktree.tree_text` and `worktree.tree_blob` are not used and not changed (#73). Delete `_spec`, `_spec_problems` and its call, and the `speclocation` and `settled_design` imports. Every refusal through `hookio.refuse` (R7, R8, R9, R11, R13, R18). Depends on T010, T011, T012, T020. In `gate.py` `on_workflow` the three refusals of a launch whose round cannot open (no open PR, an unreadable review base on either launch, no round awaiting assessment) use a new `hookio.block`, which records the deny and denies in every mode (R9); graded by `test_gate.InternalRound.test_in_log_mode_a_launch_whose_round_cannot_open_is_still_denied`.
- [X] T017 [US1] In `plugins/alq-review/scripts/briefs.py`: `Spec` points at `specbinding.Folder | specbinding.NoSpec`; `brief` (about line 147) gives the assessor `spec_folder` from `state["spec"]` (none for `null`) instead of `speclocation.resolve`, and no spec text; `_graded_against` (about lines 57 to 67) says exactly R10's two texts, naming `<folder>/spec.md` and quoting nothing. In `plugins/alq-review/agents/assessor.md`, the brief gives `spec_folder` (or none) and the assessor reads `<spec_folder>/spec.md` from the worktree itself (R8, R10). Depends on T016.
- [X] T018 [US1] In `plugins/alq-review/scripts/hookio.py` delete `spec_checks_mode` and `refuse_spec`; keep `_refuse_under` (`refuse_claim`, `refuse_shim` call it) (R11). The `config.json` part is in T019.
- [X] T020 [US1] Callers: `policy.py` (dead-round relaunch, audit cap, mark-ready), `gate.on_agent`, `gate.on_skill` and the gate's spec refusals (T016); `policy.locked` by `gate._unlock`; `_lock_reason` through `_obstacle` by `mutation`, `launch_round`, `rerequest`, `mark_ready`, and `gate._held` through `mutation`; `first_internal_round` only by the gate's settled-design check. In `plugins/alq-review/scripts/policy.py` add `review_call(state, stage)`, `state` `None` when none is at hand, building R13's text with `spec` from `state["spec"]`, else `'<spec folder>' | null`; the dead-round relaunch, the audit cap and `mark_ready` call it; the gate's users change in T016 (R13). In `plugins/alq-review/workflows/review-round.js` `meta.whenToUse` names `args.spec` (`'<spec folder>' | null`) (R13). Make `locked` and `_lock_reason` hold a PR whose `spec_held` no later unlock released, with R18's reason; the verdict lock, the spec-hold lock and `specbinding.text_step` use R18's one unlock predicate, `ledger.released(at, unlocked_at)` in `plugins/alq-review/scripts/ledger.py` (equal stamps: still held). `_lock_reason` names every hold active on the PR, since one unlock releases them all (R18). Delete `first_internal_round`, in the same commit as T016, which deletes its only caller (R11). Depends on T010, T013.

**Checkpoint**: US1 works: a launch without `spec` is refused with the full call; a bound PR keeps its spec; a changed `spec.md` holds the PR until `unlock`.

---

## Phase 4: User Story 2 - Planning runs from its own plugin: behaviour (Priority: P1)

**Goal**: planning posts nothing on the issue, closes a not-worth-doing issue as not planned, and rescope starts from
the folder and the issue. (The move into `alq-plan` is Phase 8.)

**Independent Test**: drive the workflow in `test_drive_workflow` with each premise pick and the rescope form.

### Tests for User Story 2 (write first, see red)

- [x] T021 [P] [US2] In `dev/alq-review/tests/test_premise_report.py` delete the tests of `record` and of posting (class `Cli(Issue)` where it posts); add tests of `premise_report.py reason <report>`: prints the `Reason:` text; exits 1 when it is empty (R5).
- [x] T022 [P] [US2] In `dev/alq-review/tests/test_settled_design.py` delete class `SpecFolders` and the `--branch` and `--spec-folders` cases of class `Cli`; keep `Check` and the one-folder command line (R4).
- [x] T023 [US2] In `dev/alq-review/tests/test_drive_workflow.py`: the driver sets `ALQ_PLAN_ROOT` and no `ALQ_REVIEW_ROOT` (class `Install`); a "not worth doing" pick runs `gh issue close <issue> --reason "not planned" --comment "<Reason line>"` once, recorded by a fake `gh` on `PATH`, and a failing `gh` fails the run; a "no spec needed" pick runs no `gh` command; class `Rescope` starts from `rescope <spec folder> #<issue>` with the issue's title and description in the run's spec input, and refuses either argument missing (R3, R5, R6). Replace the `test_speclocation.Issue` base of class `Premise`.
- [x] T024 [P] [US2] In `dev/alq-review/tests/test_plan_template.py` replace `ALQ_REVIEW_ROOT` with `ALQ_PLAN_ROOT` where it is asserted (R3).

### Implementation for User Story 2

- [X] T025 [P] [US2] In `plugins/alq-review/scripts/premise_report.py` delete `record` and the `speclocation` import; add the `reason` command (R5). Depends on T021.
- [X] T026 [P] [US2] In `plugins/alq-review/scripts/settled_design.py` delete `branch_problems`, `spec_folders`, `_spec_folder`, `design_documents`, `--branch`, `--spec-folders`, the module docstring's paragraph about them, and the `config` and `worktree` imports; keep `problems(folder)` and the one-folder command line (R4). Depends on T022.
- [X] T027 [US2] In `plugins/alq-review/speckit/workflows/alq-spec/workflow.yml`: add required input `issue`; replace step `record-outcome` with `close-not-worth-doing`, run only on the "not worth doing" pick: `gh issue close "$ISSUE" --reason "not planned" --comment "$(python3 "$ALQ_PLAN_ROOT/scripts/premise_report.py" reason <report>)"`; replace every `$ALQ_REVIEW_ROOT` with `$ALQ_PLAN_ROOT` (R3, R5). Depends on T023, T025.
- [X] T028 [US2] In `plugins/alq-review/skills/alq-spec/scripts/drive_workflow.py` set `ALQ_PLAN_ROOT` instead of `ALQ_REVIEW_ROOT` and pass `issue` to the workflow (R3). Depends on T027.
- [X] T029 [US2] Rewrite `plugins/alq-review/skills/alq-spec/SKILL.md` once from R6: two forms, `#<issue> [<dir>]` and `rescope <spec folder> #<issue>` (both required; the spec input is `gh issue view <issue> --json url,title,body` output followed by the open decision from the conversation); delete the `#<issue> none <reason>` form, the location-comment steps, the "already located" stop and every `speclocation` command; rescope releases no lock; a completed run's last message gives `Spec folder: <path>` and `Branch: <git rev-parse --abbrev-ref HEAD>` and names no other plugin's command; "no spec needed" tells the user to pass `spec: null` at review. Update `argument-hint` and `description`. Depends on T028.
- [X] T030 [US2] Refresh the committed copies `dev/alq-review/.specify/presets/` and `dev/alq-review/.specify/workflows/alq-spec/` from `plugins/alq-review/speckit/` so they match byte for byte (R3).

**Checkpoint**: US2 behaviour works inside today's plugin; no comment is written anywhere.

---

## Phase 5: User Story 3 - Build runs from its spec and branch (Priority: P2)

**Goal**: `issue-tackle` takes `spec` and `branch`, launches review with the same `spec`, and acts on every
root-cause verdict. (The move into `alq-build` is Phase 8.)

**Independent Test**: the skill-text tests of `test_agents.IssueTackle` and `test_spec_source`.

### Tests for User Story 3 (write first, see red)

- [x] T031 [US3] In `dev/alq-review/tests/test_agents.py` class `IssueTackle`: the skill takes `<n> spec=<folder|null> [branch=<branch>]`; stops when `branch` is missing for a folder; works in `.claude/worktrees/<n>`; stops before code when `git show HEAD:<folder>/spec.md` is missing or empty; launches review-round with the same `spec`; stops with "the review step needs alq-review" when that workflow is not installed; names all four verdicts with the action of `contracts/interfaces.md`; runs no root-cause check with `spec=null`; reads no issue comment (R14).
- [x] T032 [P] [US3] In `dev/alq-review/tests/test_spec_source.py` add: `alq-root-cause-check` takes the spec folder as its argument and reads `<folder>/spec.md`'s `## Root cause`; a missing section gives CANNOT TELL (R14).

### Implementation for User Story 3

- [X] T033 [US3] Rewrite `plugins/alq-review/skills/alq-issue-tackle/SKILL.md` once from R14 and the `issue-tackle` table of `contracts/interfaces.md`. Depends on T031.
- [X] T034 [P] [US3] Rewrite `plugins/alq-review/skills/alq-root-cause-check/SKILL.md`: argument is the spec folder; no `speclocation show`; missing section is CANNOT TELL (R14). Depends on T032.

**Checkpoint**: US3 skill texts pass.

---

## Phase 6: User Story 4 - A RESHAPE_SPEC lock has one way out (Priority: P2)

**Goal**: only `unlock <ref>` releases the lock; its reply carries the ruling and the bound folder.

**Independent Test**: lock a branch with a RESHAPE_SPEC ruling and type each command.

### Tests for User Story 4 (write first, see red)

- [X] T035 [US4] In `dev/alq-review/tests/test_gate.py` class `HeldBranch` (from line 532; the rescope tests about lines 580 to 711): `unlock <ref>` on a RESHAPE_SPEC lock releases it and the reply holds the open decision, its rationale, each spec gap as `mechanism (spec_ref)` and the bound folder; on a PR bound to `null` the reply holds the open decision and "This PR has no spec. Close it and restart the work on a new PR bound to a spec that settles this decision."; `/alq-review:alq-spec rescope <ref>` releases nothing (R12). Delete the tests that pin the rescope release. Lands with story 1's tests, in the same commit as their rework, so `test_gate.py` is not edited a third time: rewrite the class once.
- [X] T036 [P] [US4] In `dev/alq-review/tests/test_policy.py` assert `_lock_reason` for RESHAPE_SPEC names `unlock <ref>` only. In `dev/alq-review/tests/test_switch.py` check the rescope keyword is not among the release prompts it lists (about lines 360 to 375), and fix any that is. Lands with story 1's tests, in the same commit as their rework, so `test_policy.py` is not edited a third time.

### Implementation for User Story 4

- [X] T037 [US4] Callers: `gate.on_prompt` → `_on_release` → `_unlock`. In `plugins/alq-review/scripts/gate.py` delete `RESCOPE_SKILLS`, the rescope branch of `_on_release` and of `_unlock`; rename `_rescope_brief` to `_reshape_brief` and add it to the `unlock` reply for a RESHAPE_SPEC lock, with the `null` text of R12. Lands in the same commit as T016, so `gate.py` gets one code commit. Depends on T035.
- [X] T038 [US4] In `plugins/alq-review/scripts/policy.py` delete `RESCOPE` and `RESCOPE_SKILL` and the rescope sentence of `_lock_reason` (R12). Lands in the same commit as T020, so `policy.py` gets one code commit. Depends on T036.

**Checkpoint**: US4 works; one way out of the lock.

---

## Phase 7: Polish for PR 1

- [X] T019 Delete `plugins/alq-review/scripts/speclocation.py`; from `plugins/alq-review/scripts/github.py` delete `issue_comments` and `write_issue_comment` (speclocation was their only caller), the `stdin` parameter of `_answer` (only `write_issue_comment` used it), and their mention in the module docstring; in `plugins/alq-review/config.json` delete `spec_checks` and `design_documents` (R11). Grep again before deleting. Depends on T016, T017, T025 to T030, T033 and T034, which remove the last users (`premise_report`, `settled_design --branch`, the workflow and the three skills).
- [X] T039 Rewrite the changed parts of `plugins/alq-review/README.md` once: What it enforces 2 (rescope), 5 (location comment), 6 (settled-design check); Mode (spec refusals under `mode`); the typed words; State (the `spec`, `spec_blob` and `spec_held` fields); the hold on a changed `spec.md` and its release by `unlock`; Layout; and every hand-written review-round call gains `spec` (R11, R12, R13, R18).
- [X] T040 Grep the plugin and its tests for `speclocation`, `ALQ_REVIEW_ROOT`, `spec_checks`, `design_documents`, `refuse_spec`, `RESCOPE` and "location comment": none left except in `dev/alq-review/specs/` and `dev/alq-review/docs/adr/`.
- [X] T041 Bump `plugins/alq-review/.claude-plugin/plugin.json` version to `0.12.0`.
- [X] T042 Run every suite (quickstart.md "Suites"); run the tripwire `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; open PR 1 as a draft. The user reviews it with `/pr-review-toolkit:review-pr` (T002).
- [ ] T043 After PR 1 merges: release, the user installs it and re-enables alq-review. PR 2 onwards is reviewed by the new gate with `spec` (R17).

---

## Phase 8: User Story 5 + the move (PR 2) - Nothing that worked breaks silently (Priority: P2)

**Goal**: three plugins, each loading and testing alone (R1, R2, R15). Renames only; no logic change.

**Independent Test**: CI green; each plugin's scripts load from a copy holding only that plugin (quickstart.md).

### Tests for User Story 5 (write first, see red)

- [X] T044 [P] [US5] Create `dev/alq-plan/tests/paths.py` naming `plugins/alq-plan`, a two-line `git` helper, and a fake `gh` stub that records `issue close` calls; create `dev/alq-plan/tests/test_guards.py`: every script of `plugins/alq-plan` imports from a copy holding only that plugin; no file of it names a command of `alq-review` or `alq-build` (R15).
- [X] T045 [P] [US5] Create `dev/alq-build/tests/paths.py` naming `plugins/alq-build` and `dev/alq-build/tests/test_guards.py`: no file of it names another plugin's command except FR-004's two exceptions (R15).
- [X] T046 [P] [US5] Add to `dev/alq-review/tests/test_shipped_tree.py`: `plugins/alq-review` ships none of the files FR-002 lists; every script of it imports from a copy holding only that plugin.

### Implementation (the move)

- [X] T047 [US5] `git mv` into `plugins/alq-plan/`: `skills/alq-spec` → `skills/issue-spec`; `scripts/premise_report.py`, `scripts/rootcause.py`, `scripts/settled_design.py`; `speckit/`. Fix `drive_workflow.py`'s `PLUGIN = parents[...]` if the depth changed (R2, R3).
- [X] T048 [US5] `git mv` into `plugins/alq-build/`: `skills/alq-issue-tackle` → `skills/issue-tackle`, `skills/alq-root-cause-check` → `skills/root-cause-check` (R2).
- [X] T049 [US5] Create `plugins/alq-plan/.claude-plugin/plugin.json` and `plugins/alq-build/.claude-plugin/plugin.json`, version `0.1.0`, no `dependencies`; bump `plugins/alq-review/.claude-plugin/plugin.json` to `0.13.0`, since `0.12.0` (T041) shipped the moved files and an install keeps a version it already holds; list all three in `.claude-plugin/marketplace.json`; update the plugin table and install block of the root `README.md` (R2).
- [X] T050 [US5] Rename commands inside the moved skills: `/alq-plan:issue-spec`, `/alq-build:issue-tackle`, `/alq-build:root-cause-check` (no `alq-review:` prefix left for them).
- [X] T051 [US5] `git mv` tests: to `dev/alq-plan/tests/` `test_premise_report.py`, `test_rootcause.py`, `test_settled_design.py`, `test_drive_workflow.py`, `test_plan_template.py`, `test_critique_report.py`, and the planning half of `test_spec_source.py`; to `dev/alq-build/tests/` class `IssueTackle` of `test_agents.py` and the build half of `test_spec_source.py`. Each imports only its own suite's `paths.py` and helpers; replace `test_gate.SCRIPTS` and the `test_speclocation.Issue` base (R15).
- [X] T052 [US5] In `plugins/alq-review/README.md` Layout, remove the moved files (second README edit, the only other).

**Checkpoint**: all three suites green; T044 to T046 green.

---

## Phase 9: After PR 2

- [ ] T053 Amend `dev/alq-review/.specify/memory/constitution.md` in its own PR: P2's source no longer cites the rescope route; P5's source no longer cites `settled_design.py` or README item 6; bump by the constitution's own rule (R17 step 6).
- [ ] T054 In the `cto` repo, rename `alq-review:alq-root-cause-check` and `alq-review:alq-issue-tackle` to `alq-build:root-cause-check` and `alq-build:issue-tackle` wherever named (R17 step 7).
- [ ] T055 Run quickstart.md "End to end" by hand on throwaway issues.

---

## Dependencies & Execution Order

- Phase 1 lands first, in its own PRs (T001, T003 to T008 are done), with alq-review disabled (T002).
- Phase 2 blocks US1 and US4 (`specbinding`).
- US1 (Phase 3) before US4 (Phase 6): both edit `gate.py` and `policy.py`, in that order. US4's tests (T035, T036) are
  written with US1's test rework, in one commit.
- In US1, T020 before T016 (`review_call`), then T017.
- US2 (Phase 4) and US3 (Phase 5) are independent of US1 and of each other.
- Phase 7 needs Phases 3 to 6. T019 needs T016, T017, T025 to T030, T033 and T034. Phase 8 needs PR 1 merged and
  installed (T043). Phase 9 needs PR 2.

## Parallel Examples

- Phase 1: T006 and T008 beside T005 and T007.
- US1 tests, with T035 and T036 in the same commit: T013 and T036, T014, T015 together, beside T011, T012 then T035.
- US2: T021, T022, T024 together; then T025 and T026 together.
- US3: T032 and T034 beside T031 and T033.
- Phase 8: T044, T045, T046 together.

## Implementation Strategy

- MVP is US1: review told the spec. It alone removes review's dependence on planning's comment.
- Then US2, US3 and US4 in one PR with US1 (PR 1): every behaviour change in today's single plugin.
- Then the move (PR 2), which is renames, manifests and test suites only.
