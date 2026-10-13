# Interfaces: the internal review round checks the diff against the decisions that govern it

The check's types, readers, causes and refusals are [data-model.md](../data-model.md); this file holds only what
crosses the plugin's edge.

## Environment and settings

| Name | Read by | Meaning |
|---|---|---|
| `ALQ_ORG_ADR_DIR` | `adrkit.org_corpus` | absolute path of the org's decision corpus, whose records apply to every repo; unset or empty means no org corpus |
| `ALQ_REVIEW_DECISION_CHECKS` | `hookio.decision_checks_mode` | overrides `config.json`'s `decision_checks` (`log` or `enforce`, shipped `enforce`) |
| `max_review_files` | `hookio.max_review_files` | `config.json`, shipped 50 |

## adrkit

`@adrkit/cli@0.20.0`, the `adr` command, and the `@adrkit/core` it ships, which the record reader imports: the calls,
fields read and exit codes are data-model § Reading a record file and § Reading adrkit. The rule names and statuses
`decisions.py` reads (`RULES`, `NOT_GOVERNING`) are pinned to the installed package's shipped JS by
`test_decisions.Drift`.

## Injected review-round arguments

Unchanged: `worktree`, `stage`, `round_ref`, `label`, `waves`, `assess`. New for an internal round:

- `waves[0]` ends with the decision reviewer's entry when `Governance.records` is non-empty:
  `{type: 'alq-review:decision-reviewer', short: 'decision-reviewer', prompt, schema}`, `schema` =
  `assessment.findings_schema(round_ref, 'decision-reviewer')`.
- `decisions`: the block in [data-model.md § Round arguments and result](../data-model.md#round-arguments-and-result).

An audit launch injects neither.

### Decision reviewer prompt

```
Review branch <branch> of <slug>.
In <root>, run: git diff <range>
<full: That is the whole change under review. | delta: That is what changed since the previous review round. ...>

These decisions govern files this change touches. Each is named by its corpus and id:
- <corpus> <id> "<title>": <file>
...

Read each record in full before the diff. Report every place the change does what a decision rejected, contradicts
what it chose, or breaks a consequence it commits to: quote the decision's words in the finding's title and name the
record (corpus and id) in its detail. Report nothing a decision does not settle; other reviewers cover the rest. An
empty findings list is a normal and expected answer.
<_ruled_on(state)>

Answer through StructuredOutput, numbering findings decision-reviewer-1, decision-reviewer-2, ...
```

## Round result

`review-round.js` adds `decisions: args.decisions` to its `INCOMPLETE` and `CLEAN` returns and to the object it returns
after `assess-round`; the key is absent when `args.decisions` is (audit). Nothing else in the result changes.

## Agent

`agents/decision-reviewer.md`: `name: decision-reviewer`, `tools: Read, Glob, Grep, Bash` (read-only git), dispatched
only by the review-round workflow; `gate.on_agent` refuses a direct dispatch as it does for the internal reviewers.

## README and version

README: item 8 under "What it enforces"; Layout rows for `scripts/adrkit.py`, `scripts/adrkit_records.mjs`, `scripts/decisions.py`,
`agents/decision-reviewer.md`; Dependencies names `adr` as the npm-installed command (the record reader loads the `@adrkit/core` it ships), `npm install -g @adrkit/cli@0.20.0` and node ≥ 22; Mode names `decision_checks` and `max_review_files`. `plugin.json`
`version: 0.14.0`.

## Scenario coverage

Refusals by mode are the tests of data-model § Refusals, By mode; a row below names one only where a scenario is that test.

| Spec scenario or rule | Test |
|---|---|
| 1 governed change gets the reviewer, briefed by corpus and id, in `expected` | `test_gate.DecisionReview.test_a_governed_change_gets_the_decision_reviewer_with_the_records_it_judges_against` |
| 2 its finding reaches assess-round | `test_gate.DecisionReview.test_the_decision_reviewer_s_finding_is_assessed_with_the_others` |
| 3 nothing governs: no reviewer, result names corpora checked | `test_gate.DecisionReview.test_an_ungoverned_change_gets_the_usual_reviewers_and_the_result_names_the_corpora` |
| 4 draft record covering a changed file: no reviewer, no notice | `test_decisions.Judge.test_a_finding_on_a_non_governing_record_is_ignored`; `test_decisions.Contract.test_only_governing_records_whose_matcher_covers_a_changed_file_govern` |
| 5 delta round asks about the delta | `test_gate.DecisionReview.test_a_delta_round_is_governed_by_what_changed_since_the_last_round` |
| 6 org record governs, named by org corpus | `test_decisions.Contract.test_an_org_record_is_named_by_the_org_corpus` |
| 7 same id in two corpora: both carried | `test_decisions.Contract.test_the_same_id_in_the_repo_and_the_org_is_two_records` |
| 8 `ALQ_ORG_ADR_DIR` unset: round opens, result says so | `test_gate.DecisionReview.test_an_unset_org_corpus_opens_the_round_and_is_named_in_the_result` |
| 9, 19 repo-qualified matcher, this repo's name too: notice, not given | `test_decisions.Contract.test_a_repo_qualified_matcher_is_a_notice_naming_the_repo` |
| 10 `adr` missing: refused with the install step | `test_adrkit.Boundary.test_without_adr_every_corpus_is_not_checked_with_the_install_step`; `test_gate.DecisionReview.test_without_adr_the_check_follows_decision_checks` |
| 11 repo record with a bad matcher: refused, fix in this repo | `test_decisions.Contract.test_a_bad_pattern_on_a_governing_record_is_broken`; `test_decisions.Refusals.test_a_repo_corpus_s_fix_is_to_correct_and_commit` |
| 12 org record unloadable: refused, fix the org or unset, never commit | `test_decisions.Refusals.test_an_org_corpus_s_fix_never_says_commit` |
| 12 org record skipped, outside the checkout: refused naming the file | `test_decisions.Contract.test_a_skipped_org_file_outside_the_checkout_is_named` |
| 13 org folder missing: refused naming the path | `test_adrkit.OrgCorpus.test_a_folder_that_is_not_there_or_not_absolute_is_not_checked` |
| 14 marker scan capped | `test_decisions.Judge.test_a_capped_scan_leaves_the_corpus_not_checked` |
| 15 changed regular file unreadable | `test_adrkit.Boundary.test_an_unreadable_regular_file_is_listed_and_a_symlink_is_not`; `test_decisions.Judge.test_an_unreadable_changed_file_leaves_the_corpus_not_checked` |
| 16 call past the deadline, with each step's time | `test_adrkit.Boundary.test_a_call_that_hangs_is_stopped_at_the_deadline`; `test_gate.DecisionReview.test_a_launch_whose_hook_time_is_spent_gets_the_deadline_refusal` |
| 17 answer in another shape | `test_adrkit.Boundary.test_a_report_of_another_shape_is_not_checked` |
| 18 `package`/`entity` matcher: notice naming the matcher | `test_decisions.Contract.test_a_package_matcher_is_a_notice` |
| 20 only such a record, nothing evaluated: no reviewer | `test_decisions.Judge.test_a_record_with_only_notices_is_not_given_to_the_reviewer` |
| 21 one evaluated matcher and one notice: given, and the notice | `test_decisions.Contract.test_a_record_matched_by_one_matcher_is_given_and_its_other_matcher_is_a_notice` |
| 22 two records with one id | `test_decisions.Contract.test_two_records_with_one_id_are_broken`; `test_decisions.Contract.test_a_changed_broken_governing_record_is_one_broken_line` |
| 23 skipped file judged by its status | `test_decisions.Contract.test_a_skipped_file_is_judged_by_its_status` |
| 24 `decision_checks: log` with `adr` missing | `test_gate.DecisionReview.test_without_adr_the_check_follows_decision_checks` |
| 25 the file limit | `test_gate.DecisionReview.test_the_size_refusal_follows_the_plugin_s_mode` |
| 26 assessed round: rulings in `gate.log` | `test_gate.DecisionReview.test_the_decision_reviewer_s_rulings_are_written_to_the_gate_log` |
| 27 org corpus outside the checkout: brief's file exists | `test_decisions.Contract.test_an_org_record_outside_the_checkout_is_located` |
| refusal 2 is taken before refusal 3 | `test_gate.DecisionReview.test_a_corpus_not_checked_is_refused_before_a_broken_record` |
| FR-002 deleted governed file is given to the check | `test_gate.DecisionReview.test_a_deleted_governed_file_still_gets_the_decision_reviewer` |
| FR-017 audit and assess launches run no check | `test_gate.DecisionReview.test_an_audit_or_assess_launch_runs_no_check` |
| edge: no corpus and no variable | `test_gate.DecisionReview.test_with_no_corpus_the_round_opens_and_the_result_says_nothing_was_checked` |
| edge: org path equal to a repo corpus | `test_decisions.Corpora.test_an_org_path_that_is_a_repo_corpus_is_checked_once_as_the_org` |
| edge: untracked `docs/adr` | `test_decisions.Corpora.test_an_untracked_folder_is_not_a_corpus` |
| edge: `docs/adr` whose files are all in subfolders | `test_decisions.Corpora.test_a_folder_whose_files_are_all_in_subfolders_is_a_corpus` |
| edge: solo dispatch | `test_gate.DecisionReview.test_the_decision_reviewer_is_not_dispatched_alone` |
| one status classifier | `test_decisions.Judge.test_one_status_classifier_serves_records_and_skipped_files` |
| record files read by adrkit's own loader | `test_decisions.Contract.test_a_record_whose_id_is_a_block_scalar_is_located`; `test_decisions.Judge.test_a_finding_without_a_path_is_ignored`; `test_decisions.Judge.test_a_marker_finding_is_ignored_wherever_its_file_sits`; `test_decisions.Contract.test_a_marker_in_a_corpus_readme_leaves_the_corpus_judged`; `test_decisions.Judge.test_a_finding_on_a_corpus_file_the_reader_did_not_return_leaves_the_corpus_not_checked` |
| a record adrkit cannot load is broken, whatever the reader could read of it | `test_decisions.Contract.test_a_governing_record_adrkit_cannot_load_is_broken`; `test_decisions.Contract.test_a_skipped_file_with_no_status_is_a_notice` |
| one identity per file | `test_decisions.Contract.test_a_checkout_reached_through_a_symlink_still_refuses_a_broken_record` |
| the record reader's own failures | `test_adrkit.Boundary.test_a_record_reader_exit_1_is_not_checked_while_adr_exit_1_is_a_report`; `test_adrkit.Boundary.test_a_core_that_cannot_be_used_gives_the_install_step`; `test_adrkit.Boundary.test_a_status_or_id_that_is_not_a_string_reads_as_none` |
| FR-002 a changed path that begins with `-` is checked | `test_decisions.Contract.test_a_changed_path_that_begins_with_a_dash_is_checked` |
| a rename gives both paths to the check | `test_worktree_facts.QuotedNames` (`files_in`) |
| a record's file found by its id, not its name | `test_decisions.Contract.test_a_record_whose_file_name_differs_from_its_id_is_located`; `test_decisions.Judge.test_a_governing_id_without_exactly_one_file_leaves_the_corpus_not_checked` |
| calls read at once; only a live call is killed | `test_adrkit.Boundary.test_a_call_that_hangs_is_stopped_at_the_deadline` |
| FR-014 pin | `test_gate.HookDeadline.test_the_gate_s_deadline_is_the_timeout_hooks_json_gives_it` |
| drift | `test_decisions.Drift.test_every_rule_and_status_this_module_reads_is_one_the_installed_adrkit_ships` |
| CI fails without `adr` | every class that runs `adr`: skip locally, `self.fail` when `CI` is set |
