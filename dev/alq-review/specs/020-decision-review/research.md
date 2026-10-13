# Research: the internal review round checks the diff against the decisions that govern it

Read on 2026-10-12: adrkit `@adrkit/cli` 0.20.0 as installed (`~/.node22/lib/node_modules/@adrkit/cli`, its `dist/index.js`
and `@adrkit/core`'s), the closed PR #92's branch `88-us1-adr-review`, and `plugins/alq-review` on `main` at `86a4b06`.
Nothing here was run unless a section says so; what PR #92's tests showed is quoted as theirs.

## R1: One check in the gate, at an internal round's launch, before the round opens

- **Decision**: `gate.on_workflow` runs the decision check for `stage == "internal"` only, after `policy.launch_round`
  has allowed the launch and the review base is read, and before `ledger.open_round`. An audit launch and an
  assess-round launch run no check. What it refuses, and what a round opens on when a refusal does not block, is
  data-model § Refusals.
- **Rationale**: the launch is the one moment that has the diff range, the commit and the reviewer list in hand, and a
  refusal there costs one call (ADR-0009). Running after `launch_round` means a launch refused for its own reasons
  (dirty tree, cap, same commit) spends no `adr` call of the hook's budget. Audits read no spec either (README item 5).
- **Existing tools**: `gate.on_workflow`'s launch sequence (spec step, `launch_round`, `_review_base`, `open_round`):
  fit, the check slots between the last two. `hookio.refuse` and `hookio.block`: fit, wrapped by `refuse_decision` and
  `block_decision` for `decision_checks` (R15). PR #92's placement: the same, followed.

## R2: The files are the reviewers' own diff range, deleted files and all

- **Decision**: the paths come from `git diff --name-only -z <range>` where `<range>` is the one the reviewer prompt
  prints: `<base>...HEAD` for a full round, `<delta_from>..HEAD` for a delta round. `worktree.changed_files(root, base)`
  becomes `worktree.files_in(root, rev_range)`; `briefs.review_range(decision, base)` is the one place the range is
  written, used by the prompts and the check. Every path is passed to `adr check`: deleted files, symlinks and
  non-regular files included.
- **Rationale**: FR-002 forbids a kept list; the diff the reviewers read is the only honest source, and a delta round
  must ask about the delta (scenario 5). adrkit matches `affects` patterns against the path strings it is given and
  scans only regular files it can open for markers, so a deleted path still finds the record whose pattern covers it.
- **Existing tools**: `worktree.changed_files` (audit packet, `base...HEAD` only): fit when generalised to a range; its one
  caller is `briefs._audit_prompt`. `worktree._listed` (`-z` listings): fit, reused. PR #92's `files_in` and
  `review_range`: the same, followed.

## R3: The corpora are every tracked `docs/adr` plus the org corpus, checked once each

- **Decision**: the corpora are every tracked `docs/adr` at any depth plus the org corpus, checked once each; how they
  are listed, labelled, merged and who builds each is data-model § Corpus and § Functions and their owners.
- **Rationale**: FR-001 and FR-003. `git ls-files` answers "tracked" directly and at any depth in one call; taking
  every `docs/adr` prefix of a tracked path finds a corpus whose files all sit in subfolders, which adrkit skips but
  scenario 23 must judge. The spec's edge case says an org path inside the repo is still the org corpus. An absolute
  path is required because `adr` runs with `cwd` = the checkout, so a relative org path would be read against it.
- **Existing tools**: `worktree._listed` with `ls-files`: fit. PR #92's `_corpora`: followed, except that it kept an
  org path that coincides with a repo corpus as the repo's; the spec settles it the other way.

## R4: Two adrkit calls per corpus, `lint` and `check`, with the checkout as working directory

- **Decision**: per corpus, `adr lint` and `adr check`, all calls of a launch at once under the launch's deadline;
  the command lines, fields read and exit codes are data-model § Reading adrkit.
  Four corpora are eight calls, each of which re-reads its corpus, so one after another they would spend the deadline
  eight times over. Exit 1 means an error finding on a changed record, so it is a report.
- **Rationale**: `check` alone is not enough. Its `findings` carry the corpus's lint findings only for *changed*
  records (`checkChanges`: `changedRecordFindings` filters `input.lint.findings` to `changedRecords`), so a broken
  governing record the PR does not touch, or a `corpus-file-skipped` file, appears only in `lint --json`. `check` is
  still needed for `governing`, the per-matcher `affects-*` findings and the marker scan. The files are repo-relative,
  so `cwd` must be the checkout; `--dir` may be absolute (the org corpus) or repo-relative.
- **Existing tools**: `subprocess.run` with `timeout`, one thread per call (`concurrent.futures`): fit.
  `worktree._run`: git only, not reused. PR #92's `_report` (the two calls, exit-code reading): fit, followed.

## R5: An `adrkit.py` boundary module reads the CLI's answer, and a shape it does not read leaves the corpus not checked

- **Decision**: a new `scripts/adrkit.py` owns everything that touches adrkit or the disk for the check; its functions,
  readers and the shapes it returns are data-model § Functions and their owners, § Frontmatter and § Reading adrkit.
  Three choices in them:
  - One value per corpus, never an exception, so a corpus that could not be checked does not hide what the others
    answered when `decision_checks` is `log`.
  - A governing record's file is found by the `id` in each file's frontmatter, not by the file name. Run on
    2026-10-13 with adr 0.20.0: `docs/adr/0005-x.md` holding `id: "0007"` lints clean and `check` reports governing
    `0007` with no path, so a `<id>-*.md` glob finds nothing and would blame the install.
  - Status and id are read only from the frontmatter block, so a body line cannot decide a record's status (spec
    edge case on an unreadable status).
- **Rationale**: constitution II (validate where input enters) and P4 (an answer the gate cannot read is a failed check,
  not a pass). Pinning the install step to 0.20.0 names a fix that works (ADR-0009). Keeping the I/O in one module
  leaves `decisions.py` pure (P3).
- **Existing tools**: `github.py` (one boundary module per outside service): fit, the same pattern. PR #92's
  `_entries` shape check: followed. PR #92's `_STATUS` regex over the whole file and `_record` glob: replaced, for the
  two reasons above.

## R6: `decisions.py` holds the classification as pure functions of the reports

- **Decision**: `decisions.py` holds the pure rules of data-model § Status, § Corpus outcome (the causes `judge`
  makes), § Judgement, § Governance and the refusal texts of § Refusals. Two choices in them:
  - One status classifier for loaded records and skipped files, so the same text means the same thing in both.
  - A corpus with a capped scan or an unreadable changed file is not checked as a whole: a record matched only by a
    marker in the unscanned part would be missed, so no subset of its records is briefed.
- **Rationale**: constitution P3. adrkit's own `Status` enum is exactly six values; a status outside it fails the
  schema, raises an `error` and keeps the record out of `governing`, so counting it as governing (FR-004) makes that
  `error` refuse instead of vanish. `affects-unresolvable` and `affects-repo-not-applicable` are read from `check`
  only: `lint` reports the same per record, and `check` names the matcher. `markerScan.unreadablePaths` holds both
  symlinks and unreadable regular files (`readWithPreparedRoot` refuses both as `unreadable`), so only `lstat` tells
  them apart (FR-002: a symlink is given to the check and is not a failure). The status list and the seven rule names
  are a copy of adrkit's vocabulary that its JSON gives no other way to learn; a drift test pins each to the installed
  package's shipped JS.
- **Existing tools**: `specbinding.py`, `policy.py` (pure rules over data the gate reads): fit, the same shape. PR #92's
  `_may_govern` and `_not_evaluated`: followed, with all five non-governing statuses, per-matcher notices and the
  symlink distinction added.

## R7: One deadline per hook run, taken before the payload is read, 5 s under the hook's timeout

- **Decision**: `gate.main` takes `time.monotonic()` as its first statement; the deadline is that plus
  `HOOK_SECONDS - ANSWER_MARGIN` = 60 − 5 = 55 s, passed through `handle` to `on_workflow`, which keeps `spent`, the
  seconds of each step. How the `adr` calls meet the deadline, and what a late call's corpus says, is data-model
  § Reading adrkit and § Corpus outcome. A test pins `HOOK_SECONDS` to the `timeout` of the `gate.py` PreToolUse
  entry in `hooks/hooks.json`.
- **Rationale**: the hook is killed at 60 s and its answer is never read; whatever `gh` and the 30 s review-base fetch
  spent comes off the same budget, so the deadline is absolute, not per call. 5 s is left to write the ledger,
  `gate.log` and the answer. Each call runs in its own thread with the remaining time: waiting on the calls one after
  another with `communicate(timeout=remaining)` reports a call that already exited as timed out once the deadline has
  passed (run on Python 3.13.5 by the round-2 assessor), which would blame and, at `log`, drop a corpus that answered.
  The step timings make the deadline refusal name the step that can be shortened.
- **Existing tools**: `worktree.review_base`'s `timeout=30` and `_run`'s `TimeoutExpired`: fit, the same mechanism per
  call. PR #92's `HOOK_SECONDS`, `_ANSWER_SECONDS` and `HookDeadline` test: followed.

## R8: One decision reviewer agent, briefed with the governing records, counted among the expected reviewers

- **Decision**: a new agent `agents/decision-reviewer.md` (`alq-review:decision-reviewer`; tools Read, Glob, Grep,
  Bash for read-only git) joins the internal wave when `Governance.records` is non-empty; `expected` lists it, so the
  round is `INCOMPLETE` until it reports and its report is validated like any reviewer's
  (`assessment.validate_report`, ids `decision-reviewer-<n>`). `briefs.REVIEWERS` includes it, so in-flight tracking
  and the solo-dispatch refusal (`gate.on_agent`) cover it. Its prompt is the scope lines every reviewer gets, then one
  line per record, `- <corpus> <id> "<title>": <file>`, the instruction to read each record and report only where the
  change contradicts what a record settles, naming the record in each finding's `detail`, and `_ruled_on`. It gets no
  spec text.
- **Rationale**: FR-006, FR-007. One agent however many records: the records are the brief (spec Assumptions). Going
  through `review-round.js` unchanged puts its findings in `rnd["findings"]` with everyone else's, which is what
  `assess-round` reads (FR-007 needs no change there).
- **Existing tools**: `briefs.review_args`'s `reviewer()` entry builder and `assessment.findings_schema`: fit, reused.
  `_review_prompt`'s scope text: shared through a `_scope` helper so the two prompts cannot drift. PR #92's agent file
  and `_decision_prompt`: followed.

## R9: The round's result carries a `decisions` block the workflow echoes

- **Decision**: `briefs.review_args` injects data-model § Round arguments and result as `args.decisions` for an
  internal round; `review-round.js` echoes it on `INCOMPLETE`, `CLEAN` and with the assessment's result. Audit launches
  inject none, and the workflow omits the key. Nothing is written to the ledger beyond `expected`.
- **Rationale**: FR-015, FR-016, SC-008: the result tells "nothing governs" from "a corpus was not checked" and from
  "a record could not be loaded" without reading `gate.log`. The spec says the result is not kept beyond the round.
- **Existing tools**: the workflow's `args.label`, echoed in every return: fit, the same channel.

## R10: Refusal texts: the check failed, the corpus named, a fix that works for that corpus

- **Decision**: the refusals, their order, when each blocks and the state a round opens on when one does not are
  data-model § Refusals; each cause's next step is § Corpus outcome. The gate refuses after every corpus has its
  outcome.
- **Rationale**: FR-011, FR-018, ADR-0009 (say the check failed; name a step that can succeed where the refusal was
  made). Every corpus is checked before refusing because a refusal that does not block opens the round on what was
  read, and one refusal naming every problem saves a launch per corpus. `NotChecked` carries a cause so the size
  refusal, which follows the plugin's mode, is never taken again as a check that could not run.
- **Existing tools**: `_spec_step`'s refusal wording (`...: ... Next step: ...`): fit, the same shape.
  `policy.review_call(state, stage)`: fit, the call to print for "launch again".

## R11: `adr` is required only when a call would be made

- **Decision**: `adr` is needed only when at least one corpus is to be checked; without it every corpus is not checked
  (data-model § Corpus outcome; FR-010, scenario 10). With no corpus at all, no call is made.
- **Rationale**: a check with nothing to call has not failed (ADR-0009 point 4); a repo without decisions should not
  need node. The spec's edge case for no corpus and an unset variable opens the round.
- **Existing tools**: README Dependencies (`diff-match-patch`: refuse and name the step): fit, the same rule.
  `shutil.which`: fit.

## R12: README, version and CI

- **Decision**: README gains item 8 under "What it enforces" in the spec's terms (which records count, refusals,
  notices, the result), Layout rows for `adrkit.py`, `decisions.py` and `agents/decision-reviewer.md`, and a
  Dependencies paragraph naming `adr` and its install step (FR-020). `plugin.json` goes to 0.14.0. `config.json` gains `"decision_checks": "enforce"` (R15) and
  `"max_review_files": 50` (R16). `tests.yml` adds
  `actions/setup-node@v4` (node 22) and `npm install -g @adrkit/cli@0.20.0` so the suite runs the real CLI.
- **Rationale**: the README is the source the constitution's P1/P4 cite; it changes with the code it describes, as spec
  019 did. The tests that run `adr` skip without it locally and must not skip in CI.
- **Existing tools**: PR #92's README item and CI step: followed, the item rewritten to the spec's terms.

## R13: The notice choice is ADR-0019, in its own PR before the code

- **Decision**: `dev/alq-review/docs/adr/0019-run-the-round-with-a-notice-for-a-matcher-adrkit-cannot-evaluate-here.md`,
  status `accepted`, affecting `plugins/alq-review/scripts/{adrkit,decisions,gate}.py`, drafted from this plan
  (`/speckit-adrkit-draft`) and merged on branch `88-adr-notice` before the code PR (FR-019, constitution VI). The
  same PR changes the constitution's Platform Constraints line on per-check settings to name `decision_checks` beside
  the claim and shim checks (FR-021): it is a governing rule too.
- **Rationale**: a governing rule ships apart from the code it governs; the decision was the user's and the spec
  says to record it.
- **Existing tools**: ADR-0018 (a user's choice recorded for an issue before its plan): fit, the same form.

## R14: Tests, red first, one per scenario

- **Decision**: `tests/test_decisions.py` holds the pure rules with hand-written reports (no CLI), a `Contract`
  class that runs the real `adr` on fixture corpora, and the drift test of R6. `tests/test_adrkit.py` holds the
  boundary with a stand-in `adr` script, and the frontmatter reader. `tests/test_gate.py` gains `DecisionReview`
  (launches through the hook, including one test per row of data-model § Refusals, By mode) and `HookDeadline`.
  `tests/test_agents.py` gains the agent's tool list; `test_worktree_facts` gains `files_in`, `tracked` and
  `not_as_head`. contracts § Scenario coverage maps each scenario to its test. Every test that needs `adr` skips
  without it locally and fails without it when `CI` is set, so CI cannot pass with the contract unchecked.
- **Rationale**: constitution IV. Pure rules are tested without node; the boundary is tested against the real CLI so
  the plugin grades adrkit's contract, not a copy. A refusal's mode is tested at every cell where the helper that
  makes it and another helper would answer differently, so wiring a refusal to the wrong helper fails a test.
- **Existing tools**: `test_gate.Gate` (hook driver, gh stub, `launch`, `run_reviewers`), `test_worktree_facts.Repo`,
  `workflow_harness.mjs` (stand-in agents): fit, reused. PR #92's `test_decisions.py` and `DecisionReview`: followed.

## R15: `decision_checks`, the check's own setting

- **Decision**: `hookio.decision_checks_mode()` reads `decision_checks` (`log` or `enforce`), overridden by
  `ALQ_REVIEW_DECISION_CHECKS`, shipped `enforce`. The refusals it governs: data-model § Refusals.
- **Rationale**: ADR-0011: a check needs its exits on the day it ships, and the claim and shim checks each have one
  "so it can be rolled back alone". A corpus not checked refuses in either plugin mode, and `alq-review off` refuses
  round workflows, so without it a machine where adrkit cannot run has no internal round at all.
- **Existing tools**: `hookio.claim_checks_mode`, `hookio.shim_checks_mode` (`_setting`): fit, one more of the same.

## R16: `max_review_files`, the size a round may review

- **Decision**: `config.json` gains `max_review_files` (50), read through `hookio`. The size refusal is refusal 1 of
  data-model § Refusals: it applies to every internal round, governed or not, follows the plugin's mode, and when it
  does not block no `adr` call is made.
- **Rationale**: the user's choice (Clarifications). adrkit's own marker-scan cap (`MARKER_SCAN_FILE_CAP`, 3000) is a
  constant of its code with no option; a smaller limit the plugin owns is met first. The cap cause stays for
  `marker-declarations-capped`, which a change under 50 files can still reach.
- **Existing tools**: `claim_warn_over` (a number in `config.json` the workflow reads): fit, the same file; read by the
  gate instead, since it refuses.

## R17: The decision reviewer's rulings in `gate.log`

- **Decision**: when the gate accepts an assessment for a round whose `expected` includes the decision reviewer, it
  writes one `gate.log` line: action `decision-review`, the round ref, and `<id>=<FIX|PUSH_BACK|DEFER>` for each
  `decision-reviewer-<n>` finding.
- **Rationale**: the user's choice: the rulings are what tell whether the reviewer's brief is right, and `gate.log`
  outlives a PR's ledger doc.
- **Existing tools**: `hookio.record`: fit. `ledger.adjudicated` (the rulings per finding): fit, the source of the line.

## R18: The corpus is checked as HEAD has it

- **Decision**: a repo corpus holding a file `worktree.not_as_head` lists is not checked (data-model § Corpus
  outcome). The org corpus is outside the repo and read as it is.
- **Rationale**: the spec's edge case (a PR that adds an ADR is checked against the corpus as HEAD has it). adrkit reads
  the working folder. The gate's own dirty-tree check (`worktree.is_dirty`) skips untracked files and follows the
  plugin's mode, so it does not make the folder equal HEAD. Checking an exported copy of HEAD's corpus would brief the
  reviewer with files that are gone when it reads them.
- **Existing tools**: `worktree._listed`: fit, one more listing.
