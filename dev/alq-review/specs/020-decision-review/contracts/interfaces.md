# Interfaces: the internal review round checks the diff against the decisions that govern it

## Environment

| Variable | Read by | Meaning |
|---|---|---|
| `ALQ_ORG_ADR_DIR` | `adrkit.py`, at each internal launch | absolute path of the org's decision corpus, whose records apply to every repo; unset or empty means the org corpus is not checked, and the result says so |
| `ALQ_REVIEW_DECISION_CHECKS` | `hookio.decision_checks_mode` | overrides `config.json`'s `decision_checks` (`log` or `enforce`) |

`config.json` gains `"decision_checks": "enforce"` and `"max_review_files": 50`.

## adrkit calls made (the contract consumed)

Per corpus, with `cwd` = the checkout root, every call of the launch started at once and each waited for with the time left before the deadline:

```
adr lint --dir <corpus dir> --json
adr check <file>... --dir <corpus dir> --json
```

`<file>...` are the paths `git diff --name-only -z <range>` lists, where `<range>` is `<base>...HEAD` (full round) or
`<delta_from>..HEAD` (delta round), the same range the reviewer prompt prints.

Fields read, and nothing else:

| Report | Field | Must be |
|---|---|---|
| both | `findings` | list of objects: `rule`, `severity`, `message` strings; `path`, `id`, `field`, `pattern` strings when present |
| check | `governing` | list of objects: `recordId`, `title` strings |
| check | `markerScan.unreadablePaths` | list of strings |

Exit 0 and 1 are reports. Anything else, a stdout that is not a JSON object, or a field of another shape, is a corpus
that could not be checked, and the refusal names the install step: `npm install -g @adrkit/cli@0.20.0`.

Rule names read: `corpus-file-skipped`, `affects-bad-pattern`, `affects-unknown-type`, `affects-unresolvable`,
`affects-repo-not-applicable`, `marker-scan-capped`, `marker-declarations-capped`. Statuses read as not governing:
`draft`, `proposed`, `rejected`, `superseded`, `deprecated`. A drift test asserts each string appears in the installed
package's shipped JS.

## Classification

The table in [data-model.md § Judgement](../data-model.md#judgement-per-corpus-pure) is the contract; each row is a test
in `test_decisions.py`.

## Refusals, in the order they are checked

Each is a test, written to fail first. "Call" is `policy.review_call(state, 'internal')`.

| # | Input | Refusal says | Next step | Mode |
|---|---|---|---|---|
| 0 | the round's files number more than `max_review_files` | the change is too big to review; the count and the limit | full round: split the PR; delta round: commit in smaller steps and launch after each | `mode` |
| 1 | `ALQ_ORG_ADR_DIR` set but not an absolute path to a readable folder | the check could not run; the variable and its value | point it at the org's `docs/adr` as an absolute path, or unset it, then the call | both |
| 2 | `adr` not on `PATH`, and at least one corpus to check | the check could not run; the corpora | `npm install -g @adrkit/cli@0.20.0`, then the call | both |
| 3 | a call exits other than 0/1, or prints no JSON object | the check could not run; the corpus, the call, stderr | fix what it says, then the call | both |
| 4 | a call reaches the deadline | the check could not run; the corpus, the call, the deadline in seconds, and the seconds each step spent (review-base fetch, `gh` calls, each `adr` call) | the step that spent the time, then the call | both |
| 5 | a field of another shape | the check could not run; the corpus and the field | the install step, then the call | both |
| 6 | `failed`: `marker-scan-capped`, `marker-declarations-capped`, or a changed regular file the scan could not read | the check could not run; the corpus, adrkit's message, or the file | a cap: split the change; a file: make it readable; then the call | both |
| 7 | `broken`: an `error` (`unique-id` included), `affects-bad-pattern` or `affects-unknown-type` on a governing record, or `corpus-file-skipped` on a file whose status is `accepted` | the check found a record it cannot judge against; each as `<corpus> <id or path>: <message> (<rule>)` | repo corpus: correct the record in this repo, commit, then the call. Org corpus: fix the org's records at `<path>` or unset `ALQ_ORG_ADR_DIR`, then the call | `mode` |

"both" is both plugin modes while `decision_checks` is `enforce`; at `decision_checks: log` rows 1 to 7 are recorded as would-deny and the round opens, with rows 1 to 6 listed in `decisions.not_checked`. Row 7 refuses only when the plugin's mode and `decision_checks` both enforce. Row 0 is checked before any `adr` call. Rows 1 to 5 are `adrkit.Unavailable`, raised at the first corpus that hits one; rows 6 and 7 are collected across every
corpus and refused once, 6 before 7. A refusal about the org corpus never says to commit. Every refusal opens no round and
records nothing.

## Injected review-round arguments

Unchanged: `worktree`, `stage`, `round_ref`, `label`, `waves`, `assess`. New for an internal round:

- `waves[0]` ends with the decision reviewer's entry when `decisions.governing` is non-empty:
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

README: item 8 under "What it enforces"; Layout rows for `scripts/adrkit.py`, `scripts/decisions.py`,
`agents/decision-reviewer.md`; Dependencies names `adr` and `npm install -g @adrkit/cli@0.20.0`; Mode names `decision_checks` and `max_review_files`. `plugin.json`
`version: 0.14.0`.

## Scenario coverage

| Spec scenario | Test |
|---|---|
| 1 governed change gets the reviewer, briefed by corpus and id, in `expected` | `test_gate.DecisionReview.test_a_governed_change_gets_the_decision_reviewer_with_the_records_it_judges_against` |
| 2 its finding reaches assess-round | `test_gate.DecisionReview.test_the_decision_reviewer_s_finding_is_assessed_with_the_others` |
| 3 nothing governs: no reviewer, result names corpora checked | `test_gate.DecisionReview.test_an_ungoverned_change_gets_the_usual_reviewers_and_the_result_names_the_corpora` |
| 4 draft record covering a changed file: no reviewer, no notice | `test_decisions.Judge.test_a_finding_on_a_non_governing_record_is_ignored`; `test_decisions.Contract.test_only_governing_records_whose_matcher_covers_a_changed_file_govern` |
| 5 delta round asks about the delta | `test_gate.DecisionReview.test_a_delta_round_is_governed_by_what_changed_since_the_last_round` |
| 6 org record governs, named by org corpus | `test_decisions.Contract.test_an_org_record_is_named_by_the_org_corpus` |
| 7 same id in two corpora: both carried | `test_decisions.Contract.test_the_same_id_in_the_repo_and_the_org_is_two_records` |
| 8 `ALQ_ORG_ADR_DIR` unset: round opens, result says so | `test_gate.DecisionReview.test_an_unset_org_corpus_opens_the_round_and_is_named_in_the_result` |
| 9 org record whose only matcher is repo-qualified: notice, not given | `test_decisions.Contract.test_a_repo_qualified_matcher_is_a_notice_naming_the_repo` |
| 10 `adr` missing: refused with the install step | `test_gate.DecisionReview.test_without_adr_the_launch_is_refused_with_the_install_step` |
| 11 repo record with a bad matcher: refused, fix in this repo | `test_decisions.Contract.test_a_bad_pattern_on_a_governing_record_is_broken`; `test_gate.DecisionReview.test_a_broken_repo_record_refuses_and_says_to_fix_it_here` |
| 12 org record skipped or unloadable: refused, fix the org or unset, never commit | `test_gate.DecisionReview.test_a_broken_org_record_says_to_fix_the_org_or_unset_and_not_to_commit` |
| 13 org folder missing: refused naming the path | `test_adrkit.OrgCorpus.test_a_folder_that_is_not_there_or_not_absolute_is_refused` |
| 14 marker scan capped: refused naming corpus and cap | `test_decisions.Judge.test_a_capped_scan_fails_the_corpus` |
| 15 changed regular file unreadable: refused naming the file | `test_adrkit.Boundary.test_an_unreadable_regular_file_fails_and_a_symlink_does_not` |
| 16 call past the deadline: refused, launch again | `test_adrkit.Boundary.test_a_call_that_hangs_is_stopped_at_the_deadline`; `test_gate.DecisionReview.test_a_launch_whose_hook_time_is_spent_gets_the_deadline_refusal` |
| 17 answer in another shape: refused with the install step | `test_adrkit.Boundary.test_a_report_of_another_shape_cannot_be_checked` (per field) |
| 18 `package`/`entity` matcher: notice naming the matcher | `test_decisions.Contract.test_a_package_matcher_is_a_notice` |
| 19 repo-qualified matcher, this repo's name too: notice | `test_decisions.Contract.test_a_repo_qualified_matcher_is_a_notice_naming_the_repo` |
| 20 only such a record, nothing evaluated: no reviewer | `test_decisions.Judge.test_a_record_with_only_notices_is_not_given_to_the_reviewer` |
| 21 one evaluated matcher and one notice: given, and the notice | `test_decisions.Contract.test_a_record_matched_by_one_matcher_is_given_and_its_other_matcher_is_a_notice` |
| edge: `log` mode, broken record | `test_gate.DecisionReview.test_in_log_mode_a_broken_record_is_a_would_deny_and_the_round_opens` |
| edge: `log` mode, check could not run | `test_gate.DecisionReview.test_in_log_mode_a_check_that_could_not_run_still_refuses` |
| edge: no corpus and no variable | `test_gate.DecisionReview.test_with_no_corpus_the_round_opens_and_the_result_says_nothing_was_checked` |
| edge: org path equal to a repo corpus | `test_decisions.Corpora.test_an_org_path_that_is_a_repo_corpus_is_checked_once_as_the_org` |
| edge: untracked `docs/adr` | `test_decisions.Corpora.test_an_untracked_folder_is_not_a_corpus` |
| edge: audit round | `test_gate.DecisionReview.test_an_audit_round_runs_no_check` |
| edge: solo dispatch | `test_gate.DecisionReview.test_the_decision_reviewer_is_not_dispatched_alone` |
| FR-014 pin | `test_gate.HookDeadline.test_the_gate_s_deadline_is_the_timeout_hooks_json_gives_it` |
| drift | `test_decisions.Drift.test_every_rule_and_status_this_module_reads_is_one_the_installed_adrkit_ships` |
| 22 two records with one id: broken, corpus fix | `test_decisions.Contract.test_two_records_with_one_id_are_broken` |
| 23 skipped file: `accepted` refuses, no status a notice, `draft` nothing | `test_decisions.Contract.test_a_skipped_file_is_judged_by_its_status` |
| 24 `decision_checks: log`, `adr` missing: round opens, `not_checked` names the corpora | `test_gate.DecisionReview.test_with_decision_checks_at_log_a_check_that_could_not_run_opens_the_round` |
| 25 change over `max_review_files`: refused before any `adr` call | `test_gate.DecisionReview.test_a_change_over_the_file_limit_is_refused_before_the_check` |
| 26 assessed round: rulings in `gate.log` | `test_gate.DecisionReview.test_the_decision_reviewer_s_rulings_are_written_to_the_gate_log` |
| 27 org corpus outside the checkout: brief's file exists | `test_decisions.Contract.test_an_org_record_outside_the_checkout_is_located` |
| deadline refusal names step timings | `test_gate.DecisionReview.test_a_launch_whose_hook_time_is_spent_gets_the_deadline_refusal` |
| CI fails without `adr` | `test_decisions.Contract` setup: skip locally, fail when `CI` is set |
