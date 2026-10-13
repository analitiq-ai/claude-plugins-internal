---

description: "Task list: the internal review round checks the diff against the decisions that govern it"
---

# Tasks: The internal review round checks the diff against the decisions that govern it

**Input**: Design documents from `dev/alq-review/specs/020-decision-review/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R18), data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: Included. The constitution (IV) and the plan (R14) require every task to start from a test that fails
for the expected reason. Each test task names the reason its first run must fail for; the implementation task that
follows it makes it pass. Tests that need `adr` skip without it locally and fail when `CI` is set.

**Organization**: One user story (US1). The spec settles that the repo check, the org check, the refusals and the
notices are one mechanism and ship in one PR. The ADR and the constitution line ship first, in their own PR
(constitution VI, FR-019, FR-021).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1)
- Paths are from the repository root (`claude-plugins-internal`)

## Path Conventions

- Plugin (installed): `plugins/alq-review/{scripts,workflows,agents,hooks,README.md,config.json}`
- Spec Kit project (never installed): `dev/alq-review/{tests,docs/adr,.specify/memory}`
- CI: `.github/workflows/tests.yml`
- Tests run with `python -m unittest -v` from `dev/alq-review/tests/`; `paths.PLUGIN` locates the plugin

---

## Phase 1: Setup (the governing rule, its own PR first)

**Purpose**: Record the user's notice choice as ADR-0019 and name `decision_checks` in the constitution, on branch
`88-adr-notice`, merged before any code task (R13, constitution VI). ADR-0018 is the form to follow.

- [ ] T001 Draft `dev/alq-review/docs/adr/0019-run-the-round-with-a-notice-for-a-matcher-adrkit-cannot-evaluate-here.md` with `/speckit-adrkit-draft` from plan.md, then edit to ADR-0018's form: frontmatter `schemaVersion: 0.1.0`, `id: "0019"`, `status: accepted`, `date: 2026-10-13`, `deciders` as ADR-0018 has it, `relatesTo: ["0009", "0011"]`, `affects` three `path` matchers `plugins/alq-review/scripts/{adrkit,decisions,gate}.py`, `plugins/alq-review/README.md`, `dev/alq-review/tests/{test_decisions,test_adrkit,test_gate}.py`, `externalRefs` issue 88. Body: Context (adrkit 0.20 cannot evaluate a `package` or `entity` matcher, or any repo-qualified matcher, in a one-repo check; refusing would block every round, ignoring would hide the record); Decision (the round runs; the result carries a notice naming the record, its corpus, the matcher and adrkit's reason; the record reaches the reviewer only through another matcher or a marker); Options considered (notice, chosen; refuse; ignore); Consequences; "How we would know this was wrong". Verify with `adr lint --dir dev/alq-review/docs/adr --json` reporting no `error` on 0019.
- [ ] T002 In `dev/alq-review/.specify/memory/constitution.md` Platform Constraints: (a) change the line "The claim and shim checks each have a `log` / `enforce` setting beside the plugin's mode; the review-round `spec` check follows the plugin's mode alone" to: the claim, shim and decision checks each have their own setting (`claim_checks`, `shim_checks`, `decision_checks`); the review-round `spec` check and the `max_review_files` limit follow the plugin's mode alone; (b) change "Reviewer agents come from the `pr-review-toolkit` and `alq-anti-pattern` plugins" to add that the decision reviewer is this plugin's own (`agents/decision-reviewer.md`). Bump the version per Governance (PATCH, wording) and set Last Amended to the merge date.
- [ ] T003 Commit T001–T002 on `88-adr-notice`, open the draft PR against `main` (title `docs(#88): ADR-0019 ...`), run the internal review loop (`alq-review:review-round` with `spec: 'dev/alq-review/specs/020-decision-review'`) and the Codex loop per `.claude/rules/pr-review-loop.md`, and merge. No task below starts before this PR is merged and `main` fast-forwarded into `88-us1-decision-review`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The settings, version, CI, the generalised diff listing and the hook deadline that every part of the
check reads. Branch `88-us1-decision-review`, worktree `.claude/worktrees/88-us1-decision-review`.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 [P] In `plugins/alq-review/config.json` add `"decision_checks": "enforce"` and `"max_review_files": 50` beside the existing keys (R12, R15, R16).
- [ ] T005 [P] In `plugins/alq-review/.claude-plugin/plugin.json` set `"version": "0.14.0"` (R12).
- [ ] T006 [P] In `.github/workflows/tests.yml`, in the `unittest` job before "Run suite", add `- uses: actions/setup-node@v4` with `node-version: '22'` and `- run: npm install -g @adrkit/cli@0.20.0`, commented as the adrkit CLI the decision check's contract tests run (R12). CI sets `CI=true`, which makes every `adr` test fail rather than skip.
- [ ] T007 Red test in `dev/alq-review/tests/test_worktree_facts.py`: replace the two `worktree.changed_files(root, base)` calls (lines 403 and 456) with `worktree.files_in(root, f"{base}...HEAD")`, and add to class `QuotedNames` one test each for `files_in`, `tracked` and `not_as_head` as data-model.md § Functions and their owners states them: a deleted file in a `<a>..HEAD` range, and a renamed file listing both its old and new path; tracked paths under a `docs/adr` at any depth, none for an untracked or ignored one; a modified, an untracked and an ignored file under a corpus, none for a clean one. Run; confirm `AttributeError: module 'worktree' has no attribute 'files_in'`.
- [ ] T008 In `plugins/alq-review/scripts/worktree.py` replace `changed_files` with `files_in` and add `tracked` and `not_as_head`, per data-model.md § Functions and their owners, each through `_listed`. Update the one caller `briefs._audit_prompt` (`plugins/alq-review/scripts/briefs.py` line 89). Run T007 green and the whole `test_worktree_facts.py`.
- [ ] T009 Red test in `dev/alq-review/tests/test_gate.py`, new class `DecisionChecksSetting(unittest.TestCase)`: `test_decision_checks_reads_config_and_the_variable_overrides_it` (a value other than `log`/`enforce` raises `ValueError`); `test_max_review_files_is_fifty`; `test_each_helper_blocks_as_the_refusals_table_says` (`refuse_decision` and `block_decision` over the four (plugin mode, `decision_checks`) cells, as data-model.md § Refusals, By mode states the helpers). Use `mock.patch.dict(os.environ, ...)` with `ALQ_REVIEW_STATE_DIR` as `ErrorsLog` does. Run; confirm `AttributeError` on `decision_checks_mode`.
- [ ] T010 In `plugins/alq-review/scripts/hookio.py` add `decision_checks_mode()` (`_setting("decision_checks", "ALQ_REVIEW_DECISION_CHECKS")`; docstring: the decision check's own setting, so it can be released alone, ADR-0011), `max_review_files()`, `refuse_decision` and `block_decision` (R15, data-model.md § Refusals). Run T009 green.
- [ ] T011 Red test in `dev/alq-review/tests/test_gate.py`, new class `HookDeadline(unittest.TestCase)`: `test_the_gate_s_deadline_is_the_timeout_hooks_json_gives_it` reads `plugins/alq-review/hooks/hooks.json`, finds the `PreToolUse` entry whose command ends in `scripts/gate.py`, and asserts `gate.HOOK_SECONDS == entry["timeout"]` (60), `gate.ANSWER_MARGIN == 5`, and that `gate.handle(payload, deadline)` and `gate.on_workflow(payload, deadline)` accept a `deadline` argument (`inspect.signature`). Run; confirm `AttributeError: module 'gate' has no attribute 'HOOK_SECONDS'`.
- [ ] T012 In `plugins/alq-review/scripts/gate.py`: `HOOK_SECONDS = 60`, `ANSWER_MARGIN = 5` (comment: 5 s left to write the ledger, `gate.log` and the answer, R7); `main()` takes `started = time.monotonic()` as its first statement and calls `handle(payload, started + HOOK_SECONDS - ANSWER_MARGIN)`; `handle(payload, deadline)` passes `deadline` to `on_workflow` only (`PRE["Workflow"]` becomes `partial`-free: dispatch `on_workflow(payload, deadline)` explicitly before the `PRE` lookup); `on_workflow(payload, deadline)` keeps a `spent: dict[str, float]` of seconds per step, timing `_open_pr` as `"gh"` and `_review_base` as `"review-base fetch"`, to hand to the check in T023. Every existing `test_gate` test still drives the hook through `main`. Run T011 green and `test_gate.py` whole.

**Checkpoint**: Foundation ready; `python -m unittest -v` green in `dev/alq-review/tests/`

---

## Phase 3: User Story 1 - A review round is checked against every decision that governs the change (Priority: P1) 🎯 MVP

**Goal**: At an internal round's launch the gate lists the round's own diff range, asks adrkit per corpus which
governing records cover it, refuses a check that could not run or a governing record adrkit could not load, adds a
decision reviewer briefed with the governing records, carries the notices in the round's result, and logs the
reviewer's rulings.

**Independent Test**: launch internal rounds through the gate's hook handler on branches and corpora built for each
scenario (spec Acceptance Scenarios 1–27) and read the injected arguments, the refusal or the round's result; the
contract table in `contracts/interfaces.md` § Scenario coverage names the test for each.

### Pure rules: `decisions.py`

- [ ] T013 [P] [US1] Red tests in new `dev/alq-review/tests/test_decisions.py` (hand-written reports, no CLI) for every pure function of data-model.md § Functions and their owners, one test per row of § Status, of the causes `judge` makes in § Corpus outcome, of § Judgement and of § Corpus. Class `Judge`: `test_one_status_classifier_serves_records_and_skipped_files`; `test_a_capped_scan_leaves_the_corpus_not_checked`; `test_an_unreadable_changed_file_leaves_the_corpus_not_checked`; `test_a_governing_id_without_exactly_one_file_leaves_the_corpus_not_checked` (a repo subTest naming the repo fix; an org subTest naming the org fix, without "commit"); `test_a_finding_on_a_non_governing_record_is_ignored`; `test_a_broken_governing_record_is_named_and_left_out`; `test_two_records_with_one_id_are_both_left_out`; `test_an_unevaluable_matcher_from_check_is_a_notice_and_from_lint_is_ignored`; `test_a_skipped_file_is_judged_by_its_status`; `test_a_record_with_only_notices_is_not_given_to_the_reviewer`. Class `Corpora`: `test_an_untracked_folder_is_not_a_corpus`; `test_a_folder_whose_files_are_all_in_subfolders_is_a_corpus`; `test_repo_corpora_are_sorted_and_labelled_by_path`; `test_an_org_path_that_is_a_repo_corpus_is_checked_once_as_the_org` (run from a cwd other than `root`); `test_a_repo_corpus_dir_is_absolute_under_root`. Class `Governance`: `test_only_judged_corpora_are_listed_and_every_not_checked_is_kept`; `test_the_same_id_from_two_corpora_is_two_records`; `test_an_unset_org_is_named_unset`. Class `Refusals`: `test_the_size_refusal_names_the_count_the_limit_and_the_step_per_scope`; `test_a_repo_corpus_s_fix_is_to_correct_and_commit`; `test_an_org_corpus_s_fix_never_says_commit`. Class `Drift`: `test_every_rule_and_status_this_module_reads_is_one_the_installed_adrkit_ships` (every `.js` under `$(npm root -g)/@adrkit`; `RULES` and `NOT_GOVERNING`). Run; confirm `ModuleNotFoundError: No module named 'decisions'`.
- [ ] T014 [US1] Implement `plugins/alq-review/scripts/decisions.py` (standard library only; no I/O but the `realpath` in `merge`): the types and pure functions of data-model.md, and the constants `NOT_GOVERNING`, `RULES`, `INSTALL = "npm install -g @adrkit/cli@0.20.0"`. Comment only the why: the status and rule copies are adrkit's vocabulary, pinned by `Drift`. Run T013 green (`Drift` skips without `adr`).

### Boundary: `adrkit.py`

- [ ] T015 [P] [US1] Red tests in new `dev/alq-review/tests/test_adrkit.py` for data-model.md § Corpus (the org), § Reading a record file and § Reading adrkit, with a stand-in `adr` script written to a temp `bin/` put first on `PATH` (it reads `ADR_STDOUT`, `ADR_EXIT`, `ADR_SLEEP`, `ADR_CALLS_LOG`, per corpus where a test needs two). Class `Boundary` over `adrkit.outcomes`: `test_a_report_of_another_shape_is_not_checked` (a subTest per field of the fields-read table, stdout not JSON, stdout a JSON array); `test_an_exit_other_than_0_or_1_is_not_checked_with_stderr`; `test_exits_0_and_1_are_reports`; `test_a_call_that_hangs_is_stopped_at_the_deadline` (the hanging corpus first of two in `corpora` order: it alone is not checked, naming the deadline and every `spent` step; the other's report is returned; no process is left); `test_every_call_starts_before_any_ends`; `test_without_adr_every_corpus_is_not_checked_with_the_install_step`; `test_an_unreadable_regular_file_is_listed_and_a_symlink_is_not` (the regular half skipped as root); `test_paths_adrkit_names_are_read_from_the_checkout_root` (`../org/docs/adr/0007-x.md`); `test_a_record_file_is_found_by_its_frontmatter_id` (run from a cwd other than `root` that holds a decoy corpus at the same relative path; `0005-x.md` with id `0007`; a subTest each for a skipped file, `template.md`, `0000-template.md` and a symlink, each carrying id `0007`, none a candidate). Class `Frontmatter`: `test_a_status_outside_the_frontmatter_is_not_read` (no `status` in the block and a body line `status: accepted`, then `status: draft`: `None`); `test_a_byte_that_is_not_utf8_leaves_status_and_id_readable` (a Latin-1 byte in the body); `test_a_crlf_record_reads_status_and_id`. Class `Drift`: `test_the_record_file_rules_are_the_installed_adrkit_s` (`RECORD_FILE_PATTERN` and `TEMPLATE_FILE_NAME` against the declarations in every `.js` under `$(npm root -g)/@adrkit`). Class `OrgCorpus` over `adrkit.org_corpus`: `test_unset_and_empty_are_no_org`; `test_an_absolute_readable_folder_is_the_org_corpus`; `test_a_folder_that_is_not_there_or_not_absolute_is_not_checked`. Run; confirm `ModuleNotFoundError: No module named 'adrkit'`.
- [ ] T016 [US1] Red tests in `dev/alq-review/tests/test_decisions.py`, class `Contract` (the real CLI). `setUp` builds a git repo (reuse `test_worktree_facts.Repo`) with a corpus `docs/adr/` of records in ADR-0018's frontmatter form and an org corpus in a sibling temp folder, and runs `adrkit.outcomes` → `decisions.judge` → `decisions.governance`. Tests: `test_only_governing_records_whose_matcher_covers_a_changed_file_govern`; `test_an_org_record_is_named_by_the_org_corpus`; `test_the_same_id_in_the_repo_and_the_org_is_two_records`; `test_a_repo_qualified_matcher_is_a_notice_naming_the_repo` (the checked repo's own name included); `test_a_package_matcher_is_a_notice`; `test_a_record_matched_by_one_matcher_is_given_and_its_other_matcher_is_a_notice`; `test_a_bad_pattern_on_a_governing_record_is_broken`; `test_two_records_with_one_id_are_broken`; `test_a_skipped_file_is_judged_by_its_status`; `test_a_skipped_org_file_outside_the_checkout_is_named`; `test_an_org_record_outside_the_checkout_is_located`; `test_a_record_whose_file_name_differs_from_its_id_is_located`. Run; confirm `ModuleNotFoundError: No module named 'adrkit'`.
- [ ] T017 [US1] Implement `plugins/alq-review/scripts/adrkit.py`: `command`, `org_corpus`, `outcomes`, `_record_files`, `_frontmatter` and the constants `RECORD_FILE_PATTERN` and `TEMPLATE_FILE_NAME` per data-model.md § Corpus, § Reading a record file, § Reading adrkit and the causes it makes in § Corpus outcome (R4, R5, R7). Run T015 and T016 green.

### The reviewer and its brief: `briefs.py`

- [ ] T018 [US1] Red tests in `dev/alq-review/tests/test_worktree_facts.py`, class `RoundFacts`: `test_review_range_is_the_range_the_prompt_prints` (full `<base>...HEAD`, delta `<sha>..HEAD`); `test_a_governed_round_ends_its_wave_with_the_decision_reviewer` (prompt per contracts § Decision reviewer prompt: scope line, one line per record, "Report nothing a decision does not settle", `decision-reviewer-1`, no spec sentence; `schema == assessment.findings_schema(ref, "decision-reviewer")`); `test_an_ungoverned_round_has_the_internal_reviewers_only`; `test_the_decisions_block_is_the_data_model_s` (data-model.md § Round arguments and result, both notice kinds, a `broken` and a `not_checked` entry included); `test_an_audit_round_has_no_decisions_block`; `test_the_decision_reviewer_is_a_reviewer_but_not_an_internal_one`. Update the existing `review_args` call at line 351 to pass an empty `decisions.Governance`. Run; confirm `AttributeError: module 'briefs' has no attribute 'review_range'`.
- [ ] T019 [US1] In `plugins/alq-review/scripts/briefs.py` (R8, R9): `DECISION_REVIEWER`; `REVIEWERS` includes it; `review_range(decision, base)`; `_scope(where, decision, base)`, the two sentences `_review_prompt` builds today, shared by `_review_prompt` and the new `_decision_prompt` (contracts § Decision reviewer prompt); `waves(stage, governance)`; `review_args(state, rnd, where, decision, spec, governance)` adding the decision reviewer's entry and, for an internal round, `"decisions"` per data-model.md § Round arguments and result. Run T018 green and the whole `test_worktree_facts.py`.

### The agent

- [ ] T020 [P] [US1] Red test in `dev/alq-review/tests/test_agents.py`, class `DecisionReviewer`: `tools("decision-reviewer") == ["Read", "Glob", "Grep", "Bash"]` and the frontmatter `name: decision-reviewer`; the body says the agent is dispatched only by the review-round workflow. Run; confirm `FileNotFoundError` for `agents/decision-reviewer.md`.
- [ ] T021 [P] [US1] Write `plugins/alq-review/agents/decision-reviewer.md` in `assessor.md`'s frontmatter form: `name: decision-reviewer`, `description` (judges one change against the decision records its prompt names; dispatched only by the alq-review review-round workflow, never directly), `tools: Read, Glob, Grep, Bash`, `effort: high`. Body: Bash is for read-only git (`git diff`, `git log`, `git show`) in the checkout the prompt names; read each record in full before the diff; a finding is a place the change does what a decision rejected, contradicts what it chose, or breaks a consequence it commits to, its title quoting the decision's words and its `detail` naming corpus and id; nothing a decision does not settle; an empty list is normal; answer through StructuredOutput with ids `decision-reviewer-<n>`. Run T020 green.

### The gate: the check at launch, the refusals, the rulings log

- [ ] T022 [US1] Red tests in `dev/alq-review/tests/test_gate.py`, class `DecisionReview(Gate)` (the real CLI unless a test puts a stand-in `adr` first on `PATH`). `setUp` adds to the demo repo a tracked `docs/adr/0001-b-is-governed.md` (`status: accepted`, one `path` matcher `b.py`, ADR-0018's frontmatter form) committed before `self.head`, and a helper `corpus(path, **frontmatter)`; `ALQ_ORG_ADR_DIR` and the modes are set through `self.env`. The tests of data-model.md § Refusals, By mode, each a subTest per cell asserting what the cell says; and every test contracts § Scenario coverage names under `test_gate.DecisionReview`. Run; confirm failures: `args["waves"][0][-1]["type"]` is `pr-review-toolkit:type-design-analyzer`, `KeyError: 'decisions'`, and the refusals come back `allow`.
- [ ] T023 [US1] In `plugins/alq-review/scripts/gate.py` (R1, R10, R15–R18): `_governance` runs data-model.md § Order and § Refusals and nothing else, called in `on_workflow`'s internal branch after `_review_base` and before `open_round`, returning the `Governance` or the refusal; `waves = briefs.waves(stage, governance)`, `expected` from them, `briefs.review_args(..., governance)`. The audit and assess branches run no check. `on_agent`: refuse when `subagent_type` is in `briefs.INTERNAL_REVIEWERS` or equals `briefs.DECISION_REVIEWER`. `after_structured_output`, assessor branch: when `briefs.DECISION_REVIEWER in rnd["expected"]`, `record(payload, "decision-review", "recorded", ...)` with the round ref and `<id>=<verdict>` for each `decision-reviewer-` finding (R17). Run T022 green, then the whole `test_gate.py`, `test_switch.py`, `test_policy.py`.

### The workflow result

- [ ] T024 [US1] Red test in `dev/alq-review/tests/test_gate.py`, class `DecisionReview`: `test_the_round_s_result_carries_the_decisions_block` runs `plugins/alq-review/workflows/review-round.js` through `dev/alq-review/tests/workflow_harness.mjs` (`node workflow_harness.mjs <script>` with `{args, answers}` on stdin, as `test_claim_gate` runs its workflow) with the injected `args` of a governed launch: with every reviewer answering `{"findings": []}` the result is `{"status": "CLEAN", ..., "decisions": args["decisions"]}`; with the decision reviewer answering `null` the result is `INCOMPLETE` with `did_not_report == ["alq-review:decision-reviewer"]` and the same `decisions`; with one finding the result returned after `assess-round` carries `decisions`; with an audit launch's `args` the key is absent. First add to `workflow_harness.mjs` a `workflow` stand-in (`const workflow = async (name, opts) => ({ status: 'ASSESSED', workflow: name, ...opts })`) passed to `run` beside `pipeline`, since `review-round.js` calls `workflow(...)`. Run; confirm `KeyError: 'decisions'` on the result.
- [ ] T025 [US1] In `plugins/alq-review/workflows/review-round.js` add `decisions: args.decisions` to the `INCOMPLETE` return, the `CLEAN` return, and spread it onto the object `assess-round` returns (`{ ...assessed, decisions: args.decisions }`); an `undefined` value is dropped from JSON, so an audit's result has no key (R9). Run T024 green and `test_agents.py`.

### README

- [ ] T026 [US1] In `plugins/alq-review/README.md` (FR-020, R12): add item 8 under "What it enforces": "**Every internal round is checked against the decisions that govern the change.**" in the spec's terms: which corpora (each tracked `docs/adr`, and `ALQ_ORG_ADR_DIR`), which records count (`accepted`, or a status adrkit cannot read), the decision reviewer briefed by corpus and id and counted among the expected reviewers, the refusals (a governing record adrkit could not load; a check that could not run, the `adr` command missing included, each naming the corpus and a fix that works there), the notices (a `package`/`entity` or repo-qualified matcher, ADR-0019), the result's `decisions` block and `not_checked`, the `max_review_files` refusal, and the `decision-review` line in `gate.log`. In "Mode": a paragraph for `decision_checks` (`ALQ_REVIEW_DECISION_CHECKS`) and `max_review_files` (50) pointing at it for when each refusal blocks. In "Layout": rows for `scripts/adrkit.py` (the adrkit boundary: finds `adr`, runs lint and check per corpus under the hook's deadline, and reports a corpus whose answer it cannot read as not checked), `scripts/decisions.py` (the check's rules, pure functions of adrkit's reports), `agents/decision-reviewer.md`. Change the line "Depends on the `pr-review-toolkit` and `alq-anti-pattern` plugins for the reviewer agents" (line 248) to say the decision reviewer is this plugin's own. In "Dependencies": `adr` (`npm install -g @adrkit/cli@0.20.0`, node ≥ 22) is required only when a corpus is to be checked; what happens without it is the Mode paragraph's. Keep every sentence one the code states.

**Checkpoint**: US1 complete. `python -m unittest -v` in `dev/alq-review/tests/` green with `adr` installed and no `skipped` line for `test_decisions.Contract`, `test_adrkit` or `test_gate.DecisionReview`.

---

## Phase 4: Polish & Cross-Cutting Concerns

- [ ] T027 Run `cd dev/alq-review/tests && CI=1 python -m unittest -v` with `adr --version` printing 0.20.0, then the by-hand steps 1, 4, 5, 7, 8 and 9 of `dev/alq-review/specs/020-decision-review/quickstart.md` on this branch's own draft PR (its diff touches `gate.py`, which ADR-0018 governs); record each step's observed outcome in the PR description. Anything not run is reported as not run.
- [ ] T028 Tripwire before opening the PR: `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; any file above 3 commits is rewritten once from the settled shape (pr-review-loop "Rewrite, don't accrete"). Re-check plan.md's Constitution Check against the diff (I: no second validator; P3: `gate.py` only I/O and dispatch, rules in `decisions.py`; V: `changed_files` has no remaining caller, no dead code).
- [ ] T029 Commit, open the draft PR `feat(#88): the internal review round checks the diff against the decisions that govern it` against `main`, run the internal review loop (`spec: 'dev/alq-review/specs/020-decision-review'`) and the Codex loop per `.claude/rules/pr-review-loop.md`, then the pre-merge checklist.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: the ADR PR; no code dependency. **Must be merged before Phase 2 starts** (constitution VI).
- **Foundational (Phase 2)**: depends on Phase 1 merged; blocks US1.
- **User Story 1 (Phase 3)**: depends on Phase 2.
- **Polish (Phase 4)**: depends on Phase 3.

### Within Phase 2

- T004, T005, T006 are independent of each other and of T007–T012.
- T007 → T008 (worktree), T009 → T010 (hookio), T011 → T012 (gate deadline): three independent red/green pairs.
- T012 touches `gate.py`; T023 edits it again. T023 is the file's second edit on the branch.

### Within Phase 3

```
T013 (red, decisions)  ─┐
                        ├─ T014 (decisions.py)
T015 (red, adrkit)     ─┤
T016 (red, Contract)   ─┴─ T017 (adrkit.py)  ── needs T014
T018 (red, briefs)     ── T019 (briefs.py)   ── needs T014 (Governance type), T008 (files_in)
T020 (red, agent)      ── T021 (agent file)
T022 (red, gate)       ── T023 (gate.py)     ── needs T010, T012, T017, T019, T021
T024 (red, workflow)   ── T025 (review-round.js) ── needs T023 for the injected args
T026 (README)          ── needs T023, T025 (describes what ships)
```

### Parallel Opportunities

- Phase 2: T004 ‖ T005 ‖ T006; the three red/green pairs T007–T012 in parallel by file.
- Phase 3: T013 ‖ T015 ‖ T020 (three test files); T014 then T017 ‖ T019 ‖ T021; T024 can be written while T023 is built.

---

## Parallel Example: User Story 1

```bash
# Red tests first, three files at once:
Task: "T013 Judge/Corpora/Governance/Refusals/Drift in dev/alq-review/tests/test_decisions.py"
Task: "T015 Boundary/Frontmatter/OrgCorpus/Drift in dev/alq-review/tests/test_adrkit.py"
Task: "T020 DecisionReviewer tools in dev/alq-review/tests/test_agents.py"

# After T014, three implementations at once:
Task: "T017 plugins/alq-review/scripts/adrkit.py"
Task: "T019 plugins/alq-review/scripts/briefs.py"
Task: "T021 plugins/alq-review/agents/decision-reviewer.md"
```

---

## Implementation Strategy

### MVP = User Story 1 (the only story)

1. Phase 1: ADR-0019 and the constitution line, merged (one PR).
2. Phase 2: settings, version, CI, `files_in`/`tracked`, the hook deadline.
3. Phase 3: red tests, then `decisions.py` → `adrkit.py` → `briefs.py` + agent → `gate.py` → workflow → README.
4. **STOP and VALIDATE**: the suite with `adr` installed and `CI=1`, then quickstart by hand on the branch's own PR.
5. Phase 4: tripwire, PR, review loops.

### Why not smaller increments

The spec settles one story: a check that cannot refuse would pass a change silently whenever it failed (ADR-0009,
constitution P4), and the notices come from the same reading of adrkit's findings as the refusals. The only
separable piece, the governing rule, is Phase 1.

---

## Notes

- [P] tasks = different files, no dependencies
- Every test task states the failure its first run must show; do not write the implementation until it does
- A test that needs `adr` uses `skipUnless(shutil.which("adr"))` locally and `self.fail` when `CI` is set (R14)
- No refusal about the org corpus may contain the word "commit" (FR-011); T013 asserts it (`Refusals`, `Judge`)
- No path list, no cache, no planning-time check, no ledger field beyond `expected` (plan V, spec Assumptions)
- Commit after each red/green pair
