---

description: "Task list for #112, the agent picks the premise outcome"
---

# Tasks: The agent picks the premise outcome

**Input**: Design documents from `specs/112-agent-picks-premise/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/premise-report.md, quickstart.md

**Tests**: Required. Constitution IV (test-first) and quickstart §2: every check and skill-wording change starts
from a test that fails on main for the reason stated, run and seen red before the code changes.

**Organization**: Grouped by user story. US3 (the ADR amendments) runs first despite being P3: FR-010 requires its
PR merged before any code PR opens (constitution VI, R6).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

## Path Conventions

Paths are relative to the repo root. Tests run from `dev/alq-plan/`:
`python3 -m unittest discover -s tests -v`.

Two PRs (plan, Structure Decision): **PR 1** = Phase 2 only (two ADRs). **PR 2** = Phases 3–5 (script, skill,
workflow comments, tests), opened only after PR 1 is merged.

---

## Phase 1: Setup

- [ ] T001 From `dev/alq-plan/`, run `python3 -m unittest discover -s tests -v` on the branch's base (main) and confirm every test passes; this is the baseline each red test below is measured against.

---

## Phase 2: User Story 3 - The decision is recorded before the code changes (Priority: P3, runs first) — PR 1

**Goal**: ADR-0006 and ADR-0008 state that the agent picks, in a PR that changes no code, merged before PR 2.

**Independent Test**: quickstart §1 — `git diff --name-only origin/main...HEAD` lists only the two ADR files;
`grep -n "user picks\|the user picked\|session that picked" dev/alq-plan/docs/adr/0006-* dev/alq-plan/docs/adr/0008-*` prints nothing.

**⚠️ BLOCKS PR 2**: no Phase 3+ task starts until this PR is merged by the user.

- [ ] T002 [US3] Create PR 1's branch and worktree off main, issue-numbered, per `.claude/rules/github-workflow.md` (it points to `docs/engineering/git-workflow.md`; read it first).
- [ ] T003 [P] [US3] Amend `dev/alq-plan/docs/adr/0006-close-an-issue-not-worth-doing-and-post-nothing-for-one-that-needs-no-spec.md` in place, keeping `status: draft` (R6): Context says the agent picks the outcome; decisions 1 and 2 say "an issue picked as …" (no picker named); add decision 4 recording that the agent picks by FR-002's rule in order (`not worth doing` when the issue is obsolete or does not apply to the current codebase; `no spec needed` for a minor mechanical bug fix of limited impact or a no-brainer code or prose change — typos, grammar, restatements, shortening text while keeping its meaning — and for a reported defect only when its `harm` and `change-alters` answers cite `<path>:<line>` from a `code:` or `reproduction:` source; `write the spec` otherwise), with `write the spec` the default whenever in doubt, that a premise question only the user can answer stays the user's (asked, recorded with a `user:` source), and that a `not worth doing` pick closes the issue with no human in the loop; Trade-offs gain the risk of a wrong agent close (reversed by reopening the issue) and of a wrongly skipped spec (reversed by a rescope of the no-spec folder); reword Trade-offs' "Whoever builds learns it from the user" and Consequences' "a `no spec needed` outcome lives only in the session that picked it" so neither names the user as the one who picked or knows; "Revisit if" stops naming the user as the only one who knows; add issue #112 to `relatesTo`/`externalRefs` in the front matter.
- [ ] T004 [P] [US3] Amend `dev/alq-plan/docs/adr/0008-give-an-issue-that-needs-no-spec-a-spec-folder-that-says-so.md` in place, keeping `status: draft` (R6): reword Context's "lives only in the session that picked it" and its quote of ADR-0006's "Revisit if" line to match T003's wording, so no sentence presumes the user picks; add issue #112 to `relatesTo`/`externalRefs`.
- [ ] T005 [US3] Run quickstart §1's two checks (diff lists only the two ADR files; the grep prints nothing) and fix any hit in the file it names.
- [ ] T006 [US3] Commit, push, open PR 1 as draft, and run the review loops of `.claude/rules/pr-review-loop.md` (internal `alq-review:review-round` with `spec: 'dev/alq-plan/specs/112-agent-picks-premise'`, then Codex) to clean; mark ready and stop for the user to review and merge. Do not start Phase 3 until they say it is merged.

**Checkpoint**: PR 1 merged on main.

---

## Phase 3: User Story 1 - A planning run goes past premise without the user (Priority: P1) 🎯 MVP — PR 2

**Goal**: The agent picks by the rule, writes `Pick:` on a form with no `Recommendation:`, and resumes; a located
defect may be `no spec needed`.

**Independent Test**: `python3 -m unittest discover -s tests -v` passes; `test_drive_workflow.py` `Premise` drives a
located defect resumed with `no spec needed` to `completed` with only the no-spec spec.md and no GitHub call
(acceptance 1.2); quickstart §3 scenarios 2–4 reach grill / completion with no pick asked.

- [ ] T007 [US1] Create PR 2's branch and worktree off the main that holds PR 1, per `.claude/rules/github-workflow.md`.

### Tests for User Story 1 (write first, run, see them fail for the stated reason) ⚠️

- [ ] T008 [US1] In `dev/alq-plan/tests/test_premise_report.py` (R2, R3): remove the `recommendation` parameter from `report()` and its `("Recommendation", recommendation or pick)` entry; in `Form`, rename `test_the_form_has_the_five_fields_outside_the_questions` to `..._four_fields_...`, drop `"Recommendation:"` from its list and assert no line of `premise_report.form()` starts with `Recommendation`; replace `test_the_recommendation_and_the_pick_are_each_one_of_the_three_outcomes` with `test_the_pick_is_one_of_the_three_outcomes` (keep only the `Pick: yes` assertion); rename `test_the_pick_is_the_one_the_user_gave_the_workflow` to `test_the_pick_is_the_one_the_run_was_resumed_with` and also assert the problem contains `resumed` and does not contain `user`; in `test_a_second_line_of_a_report_field_or_of_an_answer_and_a_second_harm_heading_are_each_the_one_problem` drop `recommendation=NO_SPEC` and the `("Recommendation", WRITE)` case.
- [ ] T009 [US1] In `dev/alq-plan/tests/test_premise_report.py`, replace `test_an_issue_that_reports_wrong_behaviour_is_never_recommended_as_needing_no_spec` with a `DefectNoSpec` group (R4, contracts/premise-report.md), each on `report(NO_SPEC, rests_on="needs-spec", reason="a typo", wrong="yes", answers=…)` checked against `NO_SPEC`: (a) `harm` = `("the total is off by one at a.py:12", "code: a.py")` and `change-alters` = `("yes, a.py:12 adds one", "reproduction: python3 a.py")` → `[]`; (b) for each of `harm` and `change-alters`, the answer with no `<path>:<line>` → exactly one problem naming `## <question>`, `<path>:<line>` and `Next step:` that names `write the spec`; (c) for each of the two, a located answer with a `user: …` source → exactly one problem naming `## <question>`, `code:` and `reproduction:`; (d) with `rests_on="harm"` and `change-alters` unlocated → one problem naming `## change-alters` (both answers are read whatever `Rests on:` names); (e) the same unlocated report with `wrong="no"` → `[]`, and with `WRITE`/`wrong="yes"` and no citations → `[]`; (f) `Form`: `premise_report.form()`'s comment block names `Reports wrong behaviour`, `no spec needed`, `<path>:<line>`, `harm`, `change-alters`, `code:` and `reproduction:`.
- [ ] T010 [P] [US1] In `dev/alq-plan/tests/test_spec_source.py` `IssueSpecSkill` (R3, R5), replace `test_names_the_premise_form_the_report_its_recommendation_and_pick_and_the_resume_in_that_order` with `test_names_the_premise_form_the_report_the_pick_rule_the_pick_and_the_resume_in_that_order`: in `squashed(ISSUE_SPEC)`, these appear in this order — `PREMISE form`, `.specify/workflows/runs/<run_id>/premise-report.md`, `` `not worth doing` when the issue is obsolete or does not apply to the current codebase``, `` `no spec needed` when the change is a minor mechanical bug fix of limited impact``, `` `write the spec` for every other issue, and whenever in doubt``, `` `Pick:` ``, `premise_verdict=<pick>"`, `/speckit-grill-me`; it contains `Ask the user only what the issue and the code cannot answer, and record the answer with a `user:` source.` and `Never ask the user to pick, confirm, approve or reject the outcome.`; it does not contain `Recommendation`. Add `test_only_a_grill_or_critique_verdict_is_the_users_decision`: the text contains `A grill or critique verdict is the user's decision. Never pass `approve` without the user saying so in this session.` and does not contain `premise pick, without the user`. Add `test_the_description_and_opening_name_the_agent_as_the_premise_picker`: the text does not contain `the workflow first asks whether it is worth a spec` nor `passes the user's verdicts on resume`, and contains `passes the agent's premise pick and the user's grill and critique verdicts on resume`.
- [ ] T011 [P] [US1] In `dev/alq-plan/tests/test_drive_workflow.py` `Premise`, add `test_a_located_defect_judged_to_need_no_spec_writes_the_no_spec_spec_md_and_calls_github_for_nothing`: resume with `premise_verdict=no spec needed` and `premise_report_text(NO_SPEC, rests_on="needs-spec", reason=self.REASON, wrong="yes", answers={**ANSWERS, "harm": (…`a.py:12`…, "code: a.py"), "change-alters": (…`a.py:12`…, "code: a.py")})` (import `ANSWERS` from `test_premise_report` beside `premise_report_text`), asserting as `test_no_spec_needed_writes_the_folder_with_only_a_no_spec_spec_md_and_calls_github_for_nothing` does: `completed`, `gh_calls() == []`, `prompts` empty, the folder holds only `spec.md`, `no_spec.is_no_spec(text)`, and its `Rests on:`/`Reason:` lines. Reword the `Premise` class docstring to `"""A new spec: the run pauses at `premise` first, and the pick it is resumed with decides whether a spec is written."""`.
- [ ] T012 [US1] From `dev/alq-plan/`, run `python3 -m unittest tests.test_premise_report tests.test_spec_source tests.test_drive_workflow -v` and confirm each new/changed test fails for quickstart §2's stated reason (form prints `Recommendation:`; the located defect is refused as a defect; the mismatch message says "the user picked"; step 2 asks the user to pick; the closing rule names a premise pick; the `premise-report` step fails the located-defect run). A test failing for any other reason is fixed before T013.

### Implementation for User Story 1

- [ ] T013 [US1] In `plugins/alq-plan/scripts/premise_report.py` (R2, R3, R4): remove `RECOMMENDATION` from the field constants and from `form()` (both the `Recommendation:` line and its comment bullet; `PICK` is "one of: …" alone); add a comment bullet for the defect rule: with `Reports wrong behaviour: yes`, a `no spec needed` pick cites `<path>:<line>` in the `harm` and `change-alters` `Answer:` lines, each with a `code:` or `reproduction:` source; add one module-level pattern `(?<![\w/.:-])[\w./-]+:\d+\b` named for what it matches (a file-and-line citation); in `problems()` read only `Pick:` in the outcome loop, reword the mismatch to exactly `` `Pick:` is `<written>` and the run was resumed with `<pick>`. Next step: make the report's `Pick:` and the resumed pick the same outcome. ``, delete the old `recommended == NO_SPEC` refusal, and when `wrong == "yes"` and `pick == NO_SPEC` add, for each of `harm` and `change-alters` regardless of `Rests on:`, one problem when its `Answer:` has no citation (naming `## <question>` and `<path>:<line>`, Next step: cite the file and line at fault with a `code:` or `reproduction:` source, or pick `write the spec`) and one when its `Source:` does not start with `code:` or `reproduction:` (naming the question, `code:` and `reproduction:`); reword the module docstring so it names no user pick (e.g. "…before a spec is written, and the outcome picked there." and "…not on whether the answer is right: the pick is the judgement.") and the `problems()` docstring to "What stops `text` from being the report of a run resumed with `pick`; empty when nothing does." Do not change `rested_on()`, `reason()`, `reports_wrong_behaviour()` or the exit statuses (R7, P4).
- [ ] T014 [US1] In `plugins/alq-plan/skills/issue-spec/SKILL.md` (R3, R5, FR-007, FR-009, FR-011): in the front-matter `description`, replace "For an issue, the workflow first asks whether it is worth a spec at all." with "For an issue, the agent first judges whether it is worth a spec at all."; in the opening paragraph replace "passes the user's verdicts on resume" with "passes the agent's premise pick and the user's grill and critique verdicts on resume"; rewrite step 2 after "each with its source." to: "Ask the user only what the issue and the code cannot answer, and record the answer with a `user:` source. Then pick the outcome yourself, by the first rule that fits: `not worth doing` when the issue is obsolete or does not apply to the current codebase; `no spec needed` when the change is a minor mechanical bug fix of limited impact, or a no-brainer change of code or prose (typos, grammar, restatements, shortening text while keeping its meaning), and for an issue that reports wrong behaviour only when the `harm` and `change-alters` answers each cite the file and line at fault (`<path>:<line>`) with a `code:` or `reproduction:` source; `write the spec` for every other issue, and whenever in doubt. Never ask the user to pick, confirm, approve or reject the outcome. Write the pick in `Pick:`, and for either of the two stop picks the question it rests on and the reason, as the form says." (drop the `Recommendation:` sentences and "Ask the user to pick one of the three by name"); replace the closing rule with "A grill or critique verdict is the user's decision. Never pass `approve` without the user saying so in this session." Keep step 1's rescope-of-a-no-spec-folder sentence and step 3's `no spec needed` sentence verbatim (pinned, R7).
- [ ] T015 [P] [US1] In `plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml`, comment-only (R3): line ~52 "never text the user typed" → "never free text"; line ~73 "never the text the user typed" → "never free text". No step, gate, option or input changes.
- [ ] T016 [US1] From `dev/alq-plan/`, run `python3 -m unittest discover -s tests -v`: every test passes, including the unedited `test_no_spec.py`, `test_spec_folder.py`, `test_rootcause.py` and `test_drive_workflow.py` `NoSpecRescope` through the changed `report()` helper (R3, R7).

**Checkpoint**: The run passes premise on the agent's pick; US1 is testable on its own.

---

## Phase 4: User Story 2 - The user reads what the agent picked, and why (Priority: P2) — PR 2

**Goal**: After every pick the session names the pick, the question it rests on and the reason; after
`not worth doing` also that the issue was closed (FR-008).

**Independent Test**: The `test_spec_source.py` tests below pass; quickstart §3 scenarios 1–3 show the line in the
session for each pick.

### Tests for User Story 2 (write first, run, see them fail) ⚠️

- [ ] T017 [US2] In `dev/alq-plan/tests/test_spec_source.py` `IssueSpecSkill`, add `test_the_session_names_the_pick_the_question_it_rests_on_and_the_reason_before_the_resume`: `squashed(ISSUE_SPEC)` contains `Tell the user, in one line, the pick, the question it rests on and the reason, then resume.` and it sits after `Never ask the user to pick, confirm, approve or reject the outcome.` and before `premise_verdict=<pick>"`; and `test_not_worth_doing_tells_the_user_the_issue_was_closed_and_why`: the text contains `After `not worth doing`, the workflow has closed the issue as not planned with the reason: tell the user the issue was closed and why, and stop.` Run it from `dev/alq-plan/` and confirm both fail because the skill lacks the sentences.

### Implementation for User Story 2

- [ ] T018 [US2] In `plugins/alq-plan/skills/issue-spec/SKILL.md`, end step 2 with "Tell the user, in one line, the pick, the question it rests on and the reason, then resume." and in step 3 replace "has closed the issue as not planned with the reason: tell the user so and stop." with "has closed the issue as not planned with the reason: tell the user the issue was closed and why, and stop." Leave the `no spec needed` sentence (with `spec: null`) as it is.
- [ ] T019 [US2] From `dev/alq-plan/`, run `python3 -m unittest discover -s tests -v`: all pass.

**Checkpoint**: US1 and US2 both pass.

---

## Phase 5: Polish & Cross-Cutting Concerns — PR 2

- [ ] T020 Grep `plugins/alq-plan/`, `dev/alq-plan/tests/` and `dev/alq-plan/docs/` for `user pick`, `user's pick`, `user picked`, `the user picks`, `Recommendation` (R3): expect no hits (ADR-0002's "a premise pick … is an answer" does not match); reword any hit in a file this PR touches, and note any outside it in one terminal line.
- [ ] T021 Run quickstart §3 end to end in Claude Code on a test repo (typo issue → `no spec needed`; issue with decisions → one line, then grill; issue about removed code → closed as not planned with `Reason:` as the comment; rescope of the folder from scenario 1 → premise picked again), and check each run's `premise-report.md` has `Pick:` and no `Recommendation:`. Report any scenario not run as not run.
- [ ] T022 Run the tripwire `git log --name-only origin/main..HEAD | sort | uniq -c | sort -rn`; any file above ~3 edits gets a one-shot rewrite before push (`.claude/rules/pr-review-loop.md`). Commit, push, open PR 2 as draft, and run the internal then Codex review loops with `spec: 'dev/alq-plan/specs/112-agent-picks-premise'` until clean; then the pre-merge checklist.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **US3 / PR 1 (Phase 2)**: after Setup. **Blocks Phases 3–5** until the user merges PR 1 (FR-010).
- **US1 (Phase 3)**: after PR 1 is merged.
- **US2 (Phase 4)**: after US1 — both edit step 2 of `SKILL.md` and `test_spec_source.py`, and US2's sentence is
  placed relative to US1's.
- **Polish (Phase 5)**: after US1 and US2.

### Within Each Story

- Red tests (T008–T012, T017) run and fail for the stated reason before the code task they grade.
- T008 → T009 (same file). T013 before T016. T014 → T018 (same file).

### Parallel Opportunities

- T003 ∥ T004 (different ADR files).
- T010 ∥ T011 (different test files), both alongside T008/T009.
- T015 ∥ T013 / T014 (different files).

---

## Parallel Example: User Story 1

```bash
# Red tests, after T008–T009 in test_premise_report.py:
Task: "T010 skill phrase tests in dev/alq-plan/tests/test_spec_source.py"
Task: "T011 located-defect end-to-end test in dev/alq-plan/tests/test_drive_workflow.py"

# Implementation:
Task: "T013 premise_report.py form/problems/docstrings"
Task: "T015 workflow.yml two comments"
```

---

## Implementation Strategy

### MVP First

1. T001 baseline.
2. Phase 2: PR 1 (ADRs) → user merges.
3. Phase 3: US1 → full suite green → the agent picks and the run goes on (MVP).
4. Phase 4: US2 adds the session line; Phase 5 closes out PR 2.

US1 and US2 ship in the same PR 2 (plan: the check and the skill change the report together); the MVP is a
checkpoint, not a separate PR.

---

## Notes

- Exact sentences given in T010/T014/T017/T018 are the pinned text: test and skill must match character for
  character after `squashed()`.
- No change to `no_spec.py`, `spec_folder.py`, `drive_workflow.py` or any `workflow.yml` step (R1, R7).
