---

description: "Task list: the internal review round checks the diff against the decisions that govern it"
---

# Tasks: The internal review round checks the diff against the decisions that govern it

**Input**: Design documents from `dev/alq-review/specs/020-decision-review/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R17), data-model.md, contracts/interfaces.md, quickstart.md

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
- [ ] T002 In `dev/alq-review/.specify/memory/constitution.md` Platform Constraints, change the line "The claim and shim checks each have a `log` / `enforce` setting beside the plugin's mode; the review-round `spec` check follows the plugin's mode alone" to name the decision check: the claim, shim and decision checks each have their own setting (`claim_checks`, `shim_checks`, `decision_checks`); the review-round `spec` check and the `max_review_files` limit follow the plugin's mode alone. Bump the version per Governance (PATCH, wording) and set Last Amended to 2026-10-13.
- [ ] T003 Commit T001–T002 on `88-adr-notice`, open the draft PR against `main` (title `docs(#88): ADR-0019 ...`), run the internal review loop (`alq-review:review-round` with `spec: 'dev/alq-review/specs/020-decision-review'`) and the Codex loop per `.claude/rules/pr-review-loop.md`, and merge. No task below starts before this PR is merged and `main` fast-forwarded into `88-us1-decision-review`.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The settings, version, CI, the generalised diff listing and the hook deadline that every part of the
check reads. Branch `88-us1-decision-review`, worktree `.claude/worktrees/88-us1-decision-review`.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T004 [P] In `plugins/alq-review/config.json` add `"decision_checks": "enforce"` and `"max_review_files": 50` beside the existing keys (R12, R15, R16).
- [ ] T005 [P] In `plugins/alq-review/.claude-plugin/plugin.json` set `"version": "0.14.0"` (R12).
- [ ] T006 [P] In `.github/workflows/tests.yml`, in the `unittest` job before "Run suite", add `- uses: actions/setup-node@v4` with `node-version: '22'` and `- run: npm install -g @adrkit/cli@0.20.0`, commented as the adrkit CLI the decision check's contract tests run (R12). CI sets `CI=true`, which makes every `adr` test fail rather than skip.
- [ ] T007 Red test in `dev/alq-review/tests/test_worktree_facts.py`: replace the two `worktree.changed_files(root, base)` calls (lines 403 and 456) with `worktree.files_in(root, f"{base}...HEAD")`, and add to class `QuotedNames` (a) `files_in` with range `<a>..HEAD` lists only the files of the commits after `<a>`, a deleted file included; (b) `tracked(root, "*docs/adr/*")` lists tracked paths under any `docs/adr` at any depth and lists nothing for an untracked `docs/adr/0001-x.md` or one under the ignored `notes/`. Run; confirm `AttributeError: module 'worktree' has no attribute 'files_in'`.
- [ ] T008 In `plugins/alq-review/scripts/worktree.py` replace `changed_files(root, base)` with `files_in(root, rev_range) -> list[str]` = `_listed(root, *_DIFF, "--name-only", "-z", rev_range)` and add `tracked(root, pathspec) -> list[str]` = `_listed(root, "ls-files", "-z", "--", pathspec)`. Update the one caller `briefs._audit_prompt` (`plugins/alq-review/scripts/briefs.py` line 89) to `worktree.files_in(where.root, f"{base}...HEAD")`. Run T007 green and the whole `test_worktree_facts.py`.
- [ ] T009 Red test in `dev/alq-review/tests/test_gate.py`, new class `DecisionChecksSetting(unittest.TestCase)`: `hookio.decision_checks_mode()` returns `config.json`'s `decision_checks` and `ALQ_REVIEW_DECISION_CHECKS` overrides it (a value other than `log`/`enforce` raises `ValueError`); `hookio.max_review_files()` returns the integer 50; `hookio.refuse_decision(payload, "launch", reason)` denies only when both `mode()` and `decision_checks_mode()` are `enforce`, else records `would_deny`; `hookio.block_decision(payload, "launch", reason)` denies whenever `decision_checks_mode()` is `enforce` (in both plugin modes) and records `would_deny` and returns None at `log`. Use `mock.patch.dict(os.environ, ...)` with `ALQ_REVIEW_STATE_DIR` as `ErrorsLog` does. Run; confirm `AttributeError` on `decision_checks_mode`.
- [ ] T010 In `plugins/alq-review/scripts/hookio.py` add `decision_checks_mode()` = `_setting("decision_checks", "ALQ_REVIEW_DECISION_CHECKS")` (docstring: the decision check's own setting, so it can be released alone, ADR-0011), `max_review_files()` = `int(config.load()["max_review_files"])`, `refuse_decision(...)` = `_refuse_under(decision_checks_mode(), ...)`, and `block_decision(payload, action, reason, target=None)`: `block(...)` when `decision_checks_mode() == "enforce"`, else `record(..., "would_deny", ...)` and `None`. Run T009 green.
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

- [ ] T013 [P] [US1] Red tests in new `dev/alq-review/tests/test_decisions.py` (hand-written reports, no CLI). Class `Judge` over `decisions.judge(report)`, one test per row of data-model § Judgement: `test_a_capped_scan_fails_the_corpus` (a finding with no `path` and rule `marker-scan-capped` or `marker-declarations-capped` is `failed`; any other no-path rule is ignored); `test_a_finding_on_a_non_governing_record_is_ignored` (severity `error` on a record whose status is each of `draft`, `proposed`, `rejected`, `superseded`, `deprecated`: nothing); an `error` (incl. rule `unique-id`) on an `accepted` record, on a record with no `status:` line and on one whose file could not be read (status `None`) is `broken`; `affects-bad-pattern` and `affects-unknown-type` on a governing record are `broken`; `affects-unresolvable` and `affects-repo-not-applicable` with `source == "check"` on a governing record are a `Notice(corpus, id, matcher, reason)` with `matcher` = `f'{field} "{pattern}"'` and `reason` = the message, and the same rules from `lint` are ignored; `corpus-file-skipped` with the skipped file's status `accepted` is `broken`, with status `None` a notice naming the file, with `draft` ignored; a path in `unreadable_regular` is `failed`; `test_a_record_with_only_notices_is_not_given_to_the_reviewer` (`governing` empty, one notice: `records` empty); broken and failed lines read `<corpus label> <id or path>: <message> (<rule>)`. Class `Corpora` over `decisions.corpora(tracked, root, org)`: `test_an_untracked_folder_is_not_a_corpus`; repo corpora are the sorted distinct parents of tracked paths whose last two segments are `docs/adr`, at any depth, `label == dir`, `kind == "repo"`; the org corpus is `Corpus(label=f"org ({org})", dir=org, kind="org")`, last; `test_an_org_path_that_is_a_repo_corpus_is_checked_once_as_the_org` (an org path resolving to a repo corpus's folder drops the repo entry). Class `Governance` over `decisions.governance(judgements, org, not_checked)`: `corpora` labels in order; `records` in corpus order with the same id from two corpora both kept; `org_corpus` is the org label or the string `unset`; each broken/failed line is followed by its corpus's fix, the repo fix saying "correct the record in this repo, commit" and the org fix saying "fix the org's records at <path> or unset ALQ_ORG_ADR_DIR" and never containing the word "commit". Class `Drift`: `test_every_rule_and_status_this_module_reads_is_one_the_installed_adrkit_ships` reads every `.js` under `$(npm root -g)/@adrkit` and asserts each of `decisions.RULES` (7 names) and `decisions.NOT_GOVERNING` (5 statuses) appears verbatim; `skipUnless(shutil.which("adr"))` locally, `self.fail` when `os.environ.get("CI")`. Run; confirm `ModuleNotFoundError: No module named 'decisions'`.
- [ ] T014 [US1] Implement `plugins/alq-review/scripts/decisions.py` (standard library only, no I/O except `os.path.realpath` in `corpora`): frozen dataclasses `Corpus(label, dir, kind)`, `Finding(rule, severity, message, source, path=None, id=None, field=None, pattern=None)`, `CorpusReport(corpus, findings, governing: tuple[tuple[str, str], ...], statuses: dict[str, str | None], unreadable_regular: frozenset[str])`, `Record(corpus, id, title, file)`, `Notice(corpus, id, matcher, reason)`, `Judgement(corpus, governing, notices, broken, failed)`, `Governance(corpora, records, notices, broken, failed, org_corpus, not_checked)`; constants `NOT_GOVERNING = ("draft", "proposed", "rejected", "superseded", "deprecated")`, `RULES` (`corpus-file-skipped`, `affects-bad-pattern`, `affects-unknown-type`, `affects-unresolvable`, `affects-repo-not-applicable`, `marker-scan-capped`, `marker-declarations-capped`), `INSTALL = "npm install -g @adrkit/cli@0.20.0"`; `governs(status) -> bool` (R6); `corpora(tracked, root, org)`; `judge(report)`; `fix(corpus) -> str` per kind (R10); `governance(judgements, records, org, not_checked)` where `records` are the `Record`s the gate located (file located only after judging, R5). Comment only the why: the status and rule copies are adrkit's vocabulary pinned by `Drift`. Run T013 green (Drift skips without `adr`).

### Boundary: `adrkit.py`

- [ ] T015 [P] [US1] Red tests in new `dev/alq-review/tests/test_adrkit.py` with a stand-in `adr` script written to a temp `bin/` put first on `PATH` (a Python script reading `ADR_STDOUT`, `ADR_EXIT`, `ADR_SLEEP`, `ADR_CALLS_LOG` from the environment). Class `Boundary`: `test_a_report_of_another_shape_cannot_be_checked` with subTests per field (`findings` not a list; an entry without string `rule`/`severity`/`message`; `path`/`id`/`field`/`pattern` present but not strings; `governing` entry without string `recordId`/`title`; `markerScan.unreadablePaths` not a list of strings; stdout not JSON; stdout a JSON array) each raising `adrkit.Unavailable` whose text names the corpus label, the field and `INSTALL`; exit 2 raises `Unavailable` naming the corpus, the call and stderr; exits 0 and 1 are both reports; `test_a_call_that_hangs_is_stopped_at_the_deadline` (`ADR_SLEEP=5`, deadline `time.monotonic() + 0.5`: `Unavailable` within ~1 s, text names the corpus, the call, the deadline in seconds and each `spent` step including the review-base fetch and `gh` entries passed in, and the process is gone); every call of a launch is started before any is waited for (two corpora, each call logs its start time to `ADR_CALLS_LOG` then sleeps 0.5 s: all four starts precede the earliest end); `test_an_unreadable_regular_file_fails_and_a_symlink_does_not` (`unreadablePaths` naming a `chmod 000` regular file and a symlink: `unreadable_regular` holds only the regular file; skip the regular half when running as root); `statuses` maps each path a finding names, resolved against `root` (a path like `../org/docs/adr/0007-x.md` reaches the file), to its frontmatter `status:` scalar, `None` for a missing line or unreadable file. Class `OrgCorpus` over `adrkit.org_dir()`: `test_a_folder_that_is_not_there_or_not_absolute_is_refused` (relative path, missing folder, a file: `Unavailable` naming `ALQ_ORG_ADR_DIR` and its value with the next step to point it at the org's `docs/adr` as an absolute path or unset it); unset and empty string return `None`. Class `Command`: `adrkit.command()` is `None` when `adr` is not on `PATH`. Class `Locate`: `adrkit.locate(root, corpus, "0007")` returns the absolute path of `<dir>/0007-*.md` for a repo-relative and an absolute `dir`, and raises `Unavailable` when no file matches. Run; confirm `ModuleNotFoundError: No module named 'adrkit'`.
- [ ] T016 [US1] Red tests in `dev/alq-review/tests/test_decisions.py`, class `Contract` (the real CLI: `skipUnless(shutil.which("adr"))`, `self.fail("adr is required in CI")` when `CI` is set). `setUp` builds a git repo (reuse `test_worktree_facts.Repo`) with a corpus `docs/adr/` of records in ADR-0018's frontmatter form, an org corpus in a sibling temp folder, and runs `adrkit.reports(root, corpora, files, deadline, spent)` → `decisions.judge` → `decisions.governance`. Tests, named as in contracts § Scenario coverage: `test_only_governing_records_whose_matcher_covers_a_changed_file_govern` (an `accepted` record with `affects` path `src/**` governs `src/a.py`; a `draft` one with the same matcher is absent and adds no notice; an `accepted` one whose matcher misses is absent); `test_an_org_record_is_named_by_the_org_corpus` (`Record.corpus == f"org ({org})"`); `test_the_same_id_in_the_repo_and_the_org_is_two_records` (id `0001` in both: two records, each under its corpus); `test_a_repo_qualified_matcher_is_a_notice_naming_the_repo` (a matcher qualified with a repo, the checked repo's own name included: `affects-repo-not-applicable` notice whose reason names that repo; the record is not in `records`); `test_a_package_matcher_is_a_notice` (`type: package`: `affects-unresolvable` notice, `matcher` starts with `affects.package`); `test_a_record_matched_by_one_matcher_is_given_and_its_other_matcher_is_a_notice`; `test_a_bad_pattern_on_a_governing_record_is_broken` (`affects-bad-pattern`: one broken line naming corpus and id); `test_two_records_with_one_id_are_broken` (two `accepted` files `0002-a.md`, `0002-b.md`: broken, both files named, rule `unique-id`); `test_a_skipped_file_is_judged_by_its_status` (a `notes.md` and a `sub/0003-x.md` in the corpus with `status: accepted` → broken naming the file; no status → notice naming the file; `status: draft` → nothing); `test_an_org_record_outside_the_checkout_is_located` (`Record.file` is absolute and `os.path.exists`). Run; confirm `ModuleNotFoundError: No module named 'adrkit'`.
- [ ] T017 [US1] Implement `plugins/alq-review/scripts/adrkit.py` (R4, R5, R7): `class Unavailable(RuntimeError)` built from `(corpus_label, call, happened, next_step)` whose `str` reads "The decision check could not run: <corpus> <call>: <happened>. Next step: <next_step>"; `command()` = `shutil.which("adr")`; `org_dir()` reads `ALQ_ORG_ADR_DIR` (unset/empty → `None`; not `os.path.isabs`, not a readable directory → `Unavailable`); `reports(root, corpora, files, deadline, spent) -> list[CorpusReport]`: for each corpus build `["adr", "lint", "--dir", dir, "--json"]` and `["adr", "check", *files, "--dir", dir, "--json"]`, `subprocess.Popen` every call at once with `cwd=root`, `stdout=stderr=PIPE`, then for each `communicate(timeout=max(deadline - time.monotonic(), 0))`, on `TimeoutExpired` `kill()` every process and raise `Unavailable` naming the deadline in seconds and `spent` (each step, `f"{name} {seconds:.1f}s"`), recording each call's seconds in `spent[f"adr {verb} {label}"]`; exit not in (0, 1) → `Unavailable` with stderr; `json.loads` failure or a non-dict → `Unavailable` naming `INSTALL`; `_findings(data, source)`, `_governing(data)`, `_unreadable(data)` check exactly the shapes of contracts § "Fields read" and raise `Unavailable(..., f"field {name}", INSTALL)` otherwise; `_status(root, path)` reads the first `status:` scalar between the opening `---` lines of `os.path.join(root, path)`, `None` on `OSError` or no line; `unreadable_regular` = paths whose `os.lstat` is `stat.S_ISREG`; `locate(root, corpus, record_id)` = `sorted(glob.glob(os.path.join(root, corpus.dir, f"{record_id}-*.md")))[0]` as an absolute path, `Unavailable` when empty. Run T015 and T016 green.

### The reviewer and its brief: `briefs.py`

- [ ] T018 [US1] Red tests in `dev/alq-review/tests/test_worktree_facts.py`, class `RoundFacts`: `briefs.review_range(policy.Decision(True, scope="full"), base) == f"{base}...HEAD"` and `review_range(Decision(True, scope="delta", delta_from=sha), base) == f"{sha}..HEAD"`; `briefs.review_args(state, rnd, where, decision, spec, governance)` with a `Governance` holding one `Record` makes `args["waves"][0][-1]` `{"type": "alq-review:decision-reviewer", "short": "decision-reviewer", ...}` with `schema == assessment.findings_schema(rnd["ref"], "decision-reviewer")`, a prompt that contains the scope line `git diff <range>`, the line `- <corpus> <id> "<title>": <file>`, the words "Report nothing a decision does not settle", `decision-reviewer-1`, and not the spec sentence from `_graded_against`; with an empty `Governance.records` the wave is exactly `briefs.INTERNAL_REVIEWERS`; `args["decisions"]` equals data-model § Round arguments (`corpora`, `governing` as `{corpus, id, title, file}`, `notices` as `{corpus, id, matcher, reason}`, `org_corpus`, `not_checked`); for an audit round `review_args(..., governance=None)` has no `decisions` key; `briefs.DECISION_REVIEWER in briefs.REVIEWERS` and not in `briefs.INTERNAL_REVIEWERS`; `briefs.waves("internal", governance)` and `briefs.waves("audit", None)`. Update the existing `review_args` call at line 351 to pass an empty `decisions.Governance` as its sixth argument. Run; confirm `AttributeError: module 'briefs' has no attribute 'review_range'`.
- [ ] T019 [US1] In `plugins/alq-review/scripts/briefs.py`: `import decisions`; `DECISION_REVIEWER = "alq-review:decision-reviewer"`; `REVIEWERS = frozenset(INTERNAL_REVIEWERS + [DECISION_REVIEWER] + [t for wave in AUDIT_WAVES for t in wave])`; `review_range(decision, base)`; `_scope(where, decision, base) -> str` holding the two sentences `_review_prompt` builds today, used by both `_review_prompt` and the new `_decision_prompt(state, where, decision, base, records)` whose text is contracts § Decision reviewer prompt verbatim (`_ruled_on(state)` appended, no `_graded_against`); `waves(stage, governance)` = `AUDIT_WAVES` for audit, else `[INTERNAL_REVIEWERS + ([DECISION_REVIEWER] if governance.records else [])]`; `review_args(state, rnd, where, decision, spec, governance)` uses `waves(...)`, builds the decision reviewer's entry with `_decision_prompt` and `assessment.findings_schema(rnd["ref"], "decision-reviewer")`, and for `stage == "internal"` adds `"decisions": _decisions_block(governance)` (`org_corpus` the label or `"unset"`, `not_checked` as `[{"corpus", "reason"}]`). Run T018 green and the whole `test_worktree_facts.py`.

### The agent

- [ ] T020 [P] [US1] Red test in `dev/alq-review/tests/test_agents.py`, class `DecisionReviewer`: `tools("decision-reviewer") == ["Read", "Glob", "Grep", "Bash"]` and the frontmatter `name: decision-reviewer`; the body says the agent is dispatched only by the review-round workflow. Run; confirm `FileNotFoundError` for `agents/decision-reviewer.md`.
- [ ] T021 [P] [US1] Write `plugins/alq-review/agents/decision-reviewer.md` in `assessor.md`'s frontmatter form: `name: decision-reviewer`, `description` (judges one change against the decision records its prompt names; dispatched only by the alq-review review-round workflow, never directly), `tools: Read, Glob, Grep, Bash`, `effort: high`. Body: Bash is for read-only git (`git diff`, `git log`, `git show`) in the checkout the prompt names; read each record in full before the diff; a finding is a place the change does what a decision rejected, contradicts what it chose, or breaks a consequence it commits to, its title quoting the decision's words and its `detail` naming corpus and id; nothing a decision does not settle; an empty list is normal; answer through StructuredOutput with ids `decision-reviewer-<n>`. Run T020 green.

### The gate: the check at launch, the refusals, the rulings log

- [ ] T022 [US1] Red tests in `dev/alq-review/tests/test_gate.py`, class `DecisionReview(Gate)` (`skipUnless(shutil.which("adr"))`, fail when `CI` is set). `setUp` adds to the demo repo a tracked `docs/adr/0001-b-is-governed.md` (`status: accepted`, one `path` matcher `b.py`, ADR-0018's frontmatter form) committed before `self.head`, and a helper `corpus(path, **frontmatter)`; `ALQ_ORG_ADR_DIR` is set through `self.env` per test. Tests, named as in contracts § Scenario coverage: `test_a_governed_change_gets_the_decision_reviewer_with_the_records_it_judges_against` (launch allowed; `args["waves"][0][-1]["type"] == "alq-review:decision-reviewer"`; its prompt has `docs/adr 0001 "<title>"`; `self.saved()`'s current round `expected` ends with it; `args["decisions"]["governing"] == [{"corpus": "docs/adr", "id": "0001", ...}]`); `test_the_decision_reviewer_s_finding_is_assessed_with_the_others` (`run_reviewers` with the decision reviewer reporting `finding("decision-reviewer-1")`, `submit_assessment` ruling it `FIX`: accepted, and the ledger's `adjudicated` lists it); `test_an_ungoverned_change_gets_the_usual_reviewers_and_the_result_names_the_corpora` (change `c.py`: wave is `briefs.INTERNAL_REVIEWERS`, `decisions == {"corpora": ["docs/adr"], "governing": [], "notices": [], "org_corpus": "unset", "not_checked": []}`); `test_a_delta_round_is_governed_by_what_changed_since_the_last_round` (round 1 on `b.py`, assessed; commit `c.py`; round 2 is delta and ungoverned); `test_an_unset_org_corpus_opens_the_round_and_is_named_in_the_result`; `test_with_no_corpus_the_round_opens_and_the_result_says_nothing_was_checked` (corpus removed: `corpora == []`, `org_corpus == "unset"`); `test_without_adr_the_launch_is_refused_with_the_install_step` (`PATH` without `adr`: `deny` in mode `log` too, reason has `npm install -g @adrkit/cli@0.20.0`, no round in `self.saved()`); `test_a_broken_repo_record_refuses_and_says_to_fix_it_here` (commit `docs/adr/0009-broken.md` with `status: accepted` and `deciders: 7`: deny naming `docs/adr 0009`, "correct the record in this repo", and `policy.review_call(...)`); `test_a_broken_org_record_says_to_fix_the_org_or_unset_and_not_to_commit` (same record in the org folder: reason names `org (<path>)`, `ALQ_ORG_ADR_DIR`, and `assertNotIn("commit", reason)`); `test_in_log_mode_a_broken_record_is_a_would_deny_and_the_round_opens` (`mode="log"`: allowed, `gate.log` has `would_deny`, brief lists 0001 only); `test_in_log_mode_a_check_that_could_not_run_still_refuses` (`mode="log"`, `ALQ_ORG_ADR_DIR=/nowhere`: deny naming `/nowhere`); `test_with_decision_checks_at_log_a_check_that_could_not_run_opens_the_round` (`ALQ_REVIEW_DECISION_CHECKS=log`, `adr` hidden: allowed, no decision reviewer, `decisions["not_checked"]` names `docs/adr` and why, `gate.log` `would_deny`); `test_a_launch_whose_hook_time_is_spent_gets_the_deadline_refusal` (in-process: `gate.handle(payload, deadline=time.monotonic())` under `mock.patch.dict(os.environ, self.env)` with a stand-in `adr` that sleeps: deny whose reason names the deadline, `review-base fetch`, `gh` and `adr lint docs/adr` with seconds); `test_a_change_over_the_file_limit_is_refused_before_the_check` (commit 51 files; stand-in `adr` logging calls: deny naming `51` and `50` and "split the PR", log empty; after an assessed round, a delta launch says "commit in smaller steps"; `mode="log"` opens the round); `test_an_audit_round_runs_no_check` (`stage="audit"` with the stand-in logging: no call, no `decisions` key, waves are `AUDIT_WAVES`); `test_the_decision_reviewer_is_not_dispatched_alone` (`PreToolUse Agent` with `subagent_type: alq-review:decision-reviewer`: deny as for `INTERNAL_REVIEWERS[0]`); `test_the_decision_reviewer_s_rulings_are_written_to_the_gate_log` (after the assessment of a round whose reviewer reported `decision-reviewer-1` and `-2` ruled `FIX` and `PUSH_BACK`: one `gate.log` line with `action == "decision-review"`, `reason` containing the round ref, `decision-reviewer-1=FIX` and `decision-reviewer-2=PUSH_BACK`). Run; confirm failures: `args["waves"][0][-1]["type"]` is `pr-review-toolkit:type-design-analyzer`, `KeyError: 'decisions'`, and the refusals come back `allow`.
- [ ] T023 [US1] In `plugins/alq-review/scripts/gate.py` (R1, R10, R11, R15, R16, R17): `import adrkit, decisions`. In `on_workflow`'s internal branch, after `base = _review_base(...)` and before `open_round`: `files = worktree.files_in(where.root, briefs.review_range(decision, base))`; if `len(files) > max_review_files()`: `refused = refuse(payload, action, f"The change is too big to review: {len(files)} files, and max_review_files is {limit}. Next step: " + ("commit in smaller steps and launch after each" if decision.scope == "delta" else "split the PR") + ...)`, return when it denies, else fall through; `governance, refused = _governance(payload, action, state, where, files, deadline, spent, event)`; return `refused` if set; `waves = briefs.waves(stage, governance)`; `expected=[t for wave in waves for t in wave]`; `briefs.review_args(..., governance)`. The audit branch passes `governance=None` and runs no check. `_governance(...)`: `org = adrkit.org_dir()`; `corpora = decisions.corpora(worktree.tracked(where.root, "*docs/adr/*"), where.root, org)`; if `corpora` and `adrkit.command() is None`: `Unavailable` naming every corpus and `INSTALL`; `reports = adrkit.reports(...)`; `judgements = [decisions.judge(r) for r in reports]`; `records` located with `adrkit.locate` for each judgement's `governing`; `governance = decisions.governance(judgements, records, org, not_checked)`. Refuse once, in contracts' order: an `Unavailable` (rows 1–5) or `governance.failed` (row 6) → `block_decision(payload, action, "The decision check could not run: ... Next step: ...")`; when it returns `None` (decision_checks `log`) add `(corpus, reason)` to `not_checked` and go on with the corpora that answered; then `governance.broken` (row 7) → `refuse_decision(payload, action, "The decision check found a record it cannot judge against: <lines> Next step: <fix per corpus>, then " + policy.review_call(state, "internal"))`. `on_agent`: refuse when `subagent_type` is in `briefs.INTERNAL_REVIEWERS` or equals `briefs.DECISION_REVIEWER`. `after_structured_output`, assessor branch: when `briefs.DECISION_REVIEWER in rnd["expected"]`, `record(payload, "decision-review", "recorded", f"{ref} " + " ".join(f"{f['id']}={f['verdict']}" for f in payload["tool_input"]["findings"] if f["id"].startswith("decision-reviewer-")), Target(state["repo"], state["pr"], state["branch"], rnd["root"]))`. Run T022 green, then the whole `test_gate.py`, `test_switch.py`, `test_policy.py`.

### The workflow result

- [ ] T024 [US1] Red test in `dev/alq-review/tests/test_gate.py`, class `DecisionReview`: `test_the_round_s_result_carries_the_decisions_block` runs `plugins/alq-review/workflows/review-round.js` through `dev/alq-review/tests/workflow_harness.mjs` (`node workflow_harness.mjs <script>` with `{args, answers}` on stdin, as `test_claim_gate` runs its workflow) with the injected `args` of a governed launch: with every reviewer answering `{"findings": []}` the result is `{"status": "CLEAN", ..., "decisions": args["decisions"]}`; with the decision reviewer answering `null` the result is `INCOMPLETE` with `did_not_report == ["alq-review:decision-reviewer"]` and the same `decisions`; with one finding the result returned after `assess-round` carries `decisions`; with an audit launch's `args` the key is absent. First add to `workflow_harness.mjs` a `workflow` stand-in (`const workflow = async (name, opts) => ({ status: 'ASSESSED', workflow: name, ...opts })`) passed to `run` beside `pipeline`, since `review-round.js` calls `workflow(...)`. Run; confirm `KeyError: 'decisions'` on the result.
- [ ] T025 [US1] In `plugins/alq-review/workflows/review-round.js` add `decisions: args.decisions` to the `INCOMPLETE` return, the `CLEAN` return, and spread it onto the object `assess-round` returns (`{ ...assessed, decisions: args.decisions }`); an `undefined` value is dropped from JSON, so an audit's result has no key (R9). Run T024 green and `test_agents.py`.

### README

- [ ] T026 [US1] In `plugins/alq-review/README.md` (FR-020, R12): add item 8 under "What it enforces": "**Every internal round is checked against the decisions that govern the change.**" in the spec's terms: which corpora (each tracked `docs/adr`, and `ALQ_ORG_ADR_DIR`), which records count (`accepted`, or a status adrkit cannot read), the decision reviewer briefed by corpus and id and counted among the expected reviewers, the refusals (a governing record adrkit could not load; a check that could not run, the `adr` command missing included, each naming the corpus and a fix that works there; an org refusal never says to commit), the notices (a `package`/`entity` or repo-qualified matcher, ADR-0019), the result's `decisions` block and `not_checked`, the `max_review_files` refusal, and the `decision-review` line in `gate.log`. In "Mode": a paragraph for `decision_checks` (`ALQ_REVIEW_DECISION_CHECKS`; a broken governing record refuses only when both settings enforce; a check that could not run refuses in either plugin mode unless `decision_checks` is `log`) and `max_review_files` (50, follows the plugin's mode). In "Layout": rows for `scripts/adrkit.py` (the adrkit boundary: finds `adr`, runs lint and check per corpus under the hook's deadline, reads five fields and refuses the rest), `scripts/decisions.py` (the check's rules, pure functions of adrkit's reports), `agents/decision-reviewer.md`. In "Dependencies": `adr` (`npm install -g @adrkit/cli@0.20.0`, node ≥ 22) is required only when a corpus is to be checked; without it the launch is refused naming this step. Keep every sentence one the code states.

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
Task: "T013 Judge/Corpora/Governance/Drift in dev/alq-review/tests/test_decisions.py"
Task: "T015 Boundary/OrgCorpus/Command/Locate in dev/alq-review/tests/test_adrkit.py"
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
- No refusal about the org corpus may contain the word "commit" (FR-011); T013 and T022 assert it
- No path list, no cache, no planning-time check, no ledger field beyond `expected` (plan V, spec Assumptions)
- Commit after each red/green pair
