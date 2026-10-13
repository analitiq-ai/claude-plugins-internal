# Research: the internal review round checks the diff against the decisions that govern it

Read on 2026-10-12: adrkit `@adrkit/cli` 0.20.0 as installed (`~/.node22/lib/node_modules/@adrkit/cli`, its `dist/index.js`
and `@adrkit/core`'s), the closed PR #92's branch `88-us1-adr-review`, and `plugins/alq-review` on `main` at `86a4b06`.
Nothing here was run; what PR #92's tests showed is quoted as theirs.

## R1: One check in the gate, at an internal round's launch, before the round opens

- **Decision**: `gate.on_workflow` runs the decision check for `stage == "internal"` only, after `policy.launch_round`
  has allowed the launch and the review base is read, and before `ledger.open_round`. An audit launch and an
  assess-round launch run no check. A refused check opens no round and records nothing. In `log` mode a launch whose
  only problem is a broken governing record (FR-008) opens the round with the records adrkit did read.
- **Rationale**: the launch is the one moment that has the diff range, the commit and the reviewer list in hand, and a
  refusal there costs one call (ADR-0009). Running after `launch_round` means a launch refused for its own reasons
  (dirty tree, cap, same commit) spends no `adr` call of the hook's budget. Audits read no spec either (README item 5).
- **Existing tools**: `gate.on_workflow`'s launch sequence (spec step, `launch_round`, `_review_base`, `open_round`):
  fit, the check slots between the last two. `hookio.block` for a check that could not run and `hookio.refuse` for a
  record that could not be loaded: fit, the README's existing split (Mode). PR #92's placement: the same, followed.

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

- **Decision**: a repo corpus is each distinct parent folder of a tracked path (`git ls-files -z -- '*docs/adr/*'`)
  whose last two segments are `docs/adr`, at any depth, sorted. A `docs/adr` with no tracked file, untracked or
  ignored, is not a corpus. The org corpus is `ALQ_ORG_ADR_DIR` when set and non-empty; it must be an absolute path
  to a folder the gate can read, else the launch is refused naming the path (FR-010, scenario 13). When it resolves to
  the same folder as a repo corpus, it is checked once, as the org corpus, with the org's fix text. Each corpus is
  labelled: a repo corpus by its path from the repo root, the org corpus as `org (<absolute path>)`; every record is
  named `<label> <id>`.
- **Rationale**: FR-001 and FR-003. `git ls-files` answers "tracked" directly and at any depth in one call. The spec's
  edge case says an org path inside the repo is still the org corpus. An absolute path is required because the hook's
  working directory is not the checkout's: `adr` runs with `cwd=root` (R4), and a relative org path would be read
  against the checkout.
- **Existing tools**: `worktree._listed` with `ls-files`: fit. PR #92's `_corpora`: followed, except that it kept an
  org path that coincides with a repo corpus as the repo's; the spec settles it the other way.

## R4: Two adrkit calls per corpus, `lint` and `check`, with the checkout as working directory

- **Decision**: for each corpus the gate runs `adr lint --dir <corpus> --json` and
  `adr check <files...> --dir <corpus> --json`, both with `cwd` = the checkout root, under the launch's deadline (R7).
  Every call of the launch is started at once (`subprocess.Popen` per call) and each is waited for with the time left
  before the deadline; each call's duration is kept for the deadline refusal (R7). Four corpora are eight calls, each
  of which re-reads its corpus, so one after another they would spend the deadline eight times over.
  Exit codes 0 and 1 are reports (1 means an error finding on a changed record); any other exit, a stdout that is not
  JSON, or a report that is not an object is a corpus that could not be checked (FR-010).
- **Rationale**: `check` alone is not enough. Its `findings` carry the corpus's lint findings only for *changed*
  records (`checkChanges`: `changedRecordFindings` filters `input.lint.findings` to `changedRecords`), so a broken
  governing record the PR does not touch, or a `corpus-file-skipped` file, appears only in `lint --json`. `check` is
  still needed for `governing`, the per-matcher `affects-*` findings and the marker scan. The files are repo-relative,
  so `cwd` must be the checkout; `--dir` may be absolute (the org corpus) or repo-relative.
- **Existing tools**: `subprocess.run` with `timeout`: fit. `worktree._run`: git only, not reused. PR #92's `_report`
  (the two calls, exit-code reading): fit, followed.

## R5: An `adrkit.py` boundary module reads the CLI's answer and refuses any shape it does not read

- **Decision**: a new `scripts/adrkit.py` owns everything that touches adrkit or the disk for the check: finding
  `adr` on `PATH`, checking `ALQ_ORG_ADR_DIR`, the two calls per corpus, parsing their JSON, reading the status line
  of each record a finding names, `lstat` of each path the marker scan could not read, and locating a governing
  record's file. adrkit names paths relative to the directory it ran in, the checkout root, so an org record outside
  the repo comes back as `../../engineering/docs/adr/0007-x.md`; every path adrkit names is resolved against the
  checkout root before it is read, `lstat`ed or put in a brief. A governing record's file is located only after the
  corpus is judged: two records with one id are adrkit's `unique-id` error, a broken record (R6), refused with the
  corpus fix before any file is located; no id can have zero files, since adrkit discovers records by the same
  `<id>-<slug>.md` name the gate globs for. It builds plain data (`decisions.CorpusReport`) and raises `adrkit.Unavailable` with the corpus and the
  install step (`npm install -g @adrkit/cli@0.20.0`) when the answer is not in the shape it reads: `findings` must be a
  list of objects with string `rule`, `severity`, `message` and optional string `path`, `id`, `field`, `pattern`;
  `governing` a list of objects with string `recordId` and `title`; `markerScan.unreadablePaths` a list of strings.
  Nothing else in the report is read.
- **Rationale**: constitution II (validate where input enters) and P4 (an answer the gate cannot read is a failed check,
  not a pass). Pinning the install step to 0.20.0 names a fix that works (ADR-0009). Keeping the I/O in one module
  leaves `decisions.py` pure (P3).
- **Existing tools**: `github.py` (one boundary module per outside service, RuntimeError in the service's words): fit,
  the same pattern. PR #92's `_entries` shape check and `_record` glob: fit, moved into the boundary.

## R6: `decisions.py` holds the classification as pure functions of the reports

- **Decision**: `decisions.judge(report: CorpusReport) -> Judgement` applies the spec's table with no I/O:
  - A record's status is the `status:` scalar of its frontmatter as `adrkit.py` read it; `draft`, `proposed`,
    `rejected`, `superseded`, `deprecated` are not governing; any other value, a missing line or an unreadable file
    is governing (FR-004).
  - A finding with no `path` is about the corpus or the scan: `marker-scan-capped` and `marker-declarations-capped`
    are *failed* (FR-009); any other is ignored.
  - `corpus-file-skipped` is judged by the skipped file's status line: `accepted` is *broken* (FR-008), a record
    adrkit could not read because of its name or place; no readable status is a *notice* (FR-012) naming the file;
    any other status is ignored. adrkit raises it for any `.md` that is not a record name, at the top of the corpus or
    in a subfolder, so a stray note must not stop every round.
  - Severity `error`, `affects-bad-pattern` or `affects-unknown-type` on a governing record's path is *broken* (FR-008).
  - `affects-unresolvable` or `affects-repo-not-applicable` from `check` on a governing record is a *notice*
    (FR-012), carrying the matcher (`field`, `pattern`) and adrkit's message; `lint`'s per-record
    `affects-repo-not-applicable` is ignored, since `check` reports the same per matcher.
  - A path in `markerScan.unreadablePaths` that `lstat` says is a regular file is *failed* (FR-009); a symlink or other
    non-regular file is ignored. adrkit reports both as `unreadable` (`readWithPreparedRoot`: a symlink in the path or a
    non-file both `refuse("unreadable")`), so only `lstat` tells them apart.
  - Every other finding, and `absentPaths`, `truncatedPaths`, `outOfTreePaths`, is ignored (FR-013).
  - The governing records are `check`'s `governing` entries: adrkit already includes only records that matched by an
    evaluated matcher or a marker (FR-012's last sentence).
  `decisions.governance(judgements, org)` folds the corpora into one `Governance`: the records, the notices, the
  failed and broken lists, and whether the org corpus was unset.
- **Rationale**: constitution P3. adrkit's own `Status` enum is exactly those six values; a status outside it fails the
  schema, raises an `error` finding and keeps the record out of `records`, so counting it as governing (FR-004) makes
  that `error` refuse instead of vanish. The status list and the seven rule names are a copy of adrkit's vocabulary that
  `check --json` gives no other way to learn (a finding carries no status); a drift test pins each name to the installed
  package's shipped JS, as PR #92's did for the rule names.
- **Existing tools**: `specbinding.py`, `policy.py` (pure rules over data the gate reads): fit, the same shape. PR #92's
  `_may_govern` (regex over `status:`) and `_not_evaluated`: followed, with the status list extended to all five
  non-governing statuses, the per-matcher notices added, and the symlink distinction added.

## R7: One deadline per hook run, taken before the payload is read, 5 s under the hook's timeout

- **Decision**: `gate.main` takes `time.monotonic()` as its first statement; the deadline is that plus
  `HOOK_SECONDS - ANSWER_MARGIN` = 60 − 5 = 55 s. `handle(payload, deadline)` passes it to `on_workflow`; each `adr`
  call's `timeout` is what remains. A call that reaches it is `Unavailable`: the refusal names the corpus, the call, the
  deadline, and the time each step of the launch spent (the review-base fetch, the `gh` calls, each `adr` call), so
  the next step is the one that can succeed: a slow network, or a corpus adrkit reads slowly (FR-010, FR-014). A test pins `HOOK_SECONDS` to the `timeout` of the
  `gate.py` PreToolUse entry in `hooks/hooks.json`.
- **Rationale**: the hook is killed at 60 s and its answer is never read; whatever `gh` and the 30 s review-base fetch
  spent must come off the same budget, so the deadline is absolute, not per call. 5 s is left to write the ledger,
  `gate.log` and the answer. The margin is a plan matter (spec Assumptions).
- **Existing tools**: `worktree.review_base`'s `timeout=30` and `_run`'s `TimeoutExpired` → `RuntimeError`: fit, the
  same mechanism per call. PR #92's `HOOK_SECONDS`, `_ANSWER_SECONDS` and `HookDeadline` test: followed. The step timings are new.

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

- **Decision**: `briefs.review_args` injects `args.decisions` for an internal round:
  `{corpora: [<label>...], governing: [{corpus, id, title, file}...], notices: [{corpus, id, matcher, reason}...],
  org_corpus: "<absolute path>" | "unset"}`. `review-round.js` returns `decisions: args.decisions` on `INCOMPLETE`,
  `CLEAN` and with the assessment's result. Audit launches inject no `decisions`, and the workflow omits the key.
  Nothing is written to the ledger beyond `expected`.
- **Rationale**: FR-015, FR-016, SC-008: `corpora` says what was checked, `governing` what covers the change, and
  `org_corpus: "unset"` why the org was not, without reading `gate.log`. The spec says the result is not kept beyond
  the round.
- **Existing tools**: the workflow's `args.label`, echoed in every return: fit, the same channel. PR #92's `notices`
  list: followed, widened to the four fields.

## R10: Refusal texts: the check failed, the corpus named, a fix that works for that corpus

- **Decision**: after every corpus is checked, the gate refuses once. If any corpus *failed* (FR-009) or could not be
  checked (FR-010), `hookio.block` with every such corpus and its problem; else if any has *broken* records (FR-008),
  `hookio.refuse` with each record named `<corpus> <id>` (its path when adrkit gives no id) and adrkit's message. Each
  refusal opens "The decision check could not run" or "The decision check found a record it cannot judge against", and
  ends "Next step: ...": for a repo corpus, correct the record in this repo, commit, and launch again; for the org
  corpus, fix the org's records at `<path>` or unset `ALQ_ORG_ADR_DIR`, then launch again; for a capped scan, adrkit's
  message and the step to split the change; for an unreadable file, make it readable and launch again; for a
  deadline, the time each step spent (R7); for a missing `adr` or
  an unreadable answer, the install step, then launch again; for a bad `ALQ_ORG_ADR_DIR`, point it at the org's
  `docs/adr` as an absolute path or unset it, then launch again. A refusal about the org corpus never says to commit.
- **Rationale**: FR-011, FR-018, ADR-0009 (say the check failed; name a step that can succeed where the refusal was
  made). All corpora are checked before refusing because the governing list is needed anyway in `log` mode, and one
  refusal naming every problem saves a launch per broken corpus.
- **Existing tools**: `_spec_step`'s refusal wording (`Step "...": ... Next step: ...`): fit, the same shape.
  `policy.review_call(state, stage)`: fit, the call to print for "launch again".

## R11: `adr` is required only when a call would be made

- **Decision**: when at least one corpus is to be checked (a tracked `docs/adr`, or `ALQ_ORG_ADR_DIR` set) and `adr`
  is not on `PATH`, the launch is blocked in both plugin modes with the install step, unless `decision_checks` is `log` (R15) (FR-010, scenario 10). With no corpus
  at all, no call is made and the result says `corpora: []`.
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

- **Decision**: `tests/test_decisions.py` holds the pure classification cases with hand-written reports (no CLI) and a
  `Contract` class that runs the real `adr` on fixture corpora to prove the shapes read in R5 are adrkit's
  (`skipUnless(shutil.which("adr"))`), plus the drift test of R6. `tests/test_adrkit.py` holds the boundary cases with
  a stand-in `adr` script: another shape, a non-object, exit 2, a hang past the deadline, a symlink and a regular
  unreadable file. Contract cases added by the critique: two records with one id, a stray file in a subfolder (with
  status `accepted`, none, and `draft`), and an org corpus outside the checkout. Every test that needs `adr` skips
  without it locally and fails without it when `CI` is set, so CI cannot pass with the contract unchecked. `tests/test_gate.py` gains `DecisionReview` with the launch scenarios through the hook, and
  `HookDeadline`. `tests/test_agents.py` gains the agent's tool list; `test_worktree_facts` gains `files_in` and
  `tracked`. The contract tables in [contracts/interfaces.md](contracts/interfaces.md) map each scenario to its test.
- **Rationale**: constitution IV. Pure rules are tested without node; the boundary is tested against the real CLI so
  the plugin grades adrkit's contract, not a copy.
- **Existing tools**: `test_gate.Gate` (hook driver, gh stub, `launch`, `run_reviewers`), `test_worktree_facts.Repo`,
  `workflow_harness.mjs` (stand-in agents): fit, reused. PR #92's `test_decisions.py` and `DecisionReview`: followed.


## R15: `decision_checks`, the check's own setting

- **Decision**: `hookio.decision_checks_mode()` reads `decision_checks` (`log` or `enforce`), overridden by
  `ALQ_REVIEW_DECISION_CHECKS`, shipped `enforce` in `config.json`. At `enforce` the refusals follow R10 and FR-018.
  At `log` no decision-check refusal blocks: each is `record`ed as `would_deny` in `gate.log`, the round opens with the
  records that were read, and `args.decisions.not_checked` lists `{corpus, reason}` for each corpus that could not be
  checked (the `adr` command missing names every corpus).
- **Rationale**: ADR-0011: a check needs its exits on the day it ships, and the claim and shim checks each have one
  "so it can be rolled back alone". FR-009/FR-010 refuse in either plugin mode, and `alq-review off` refuses round
  workflows, so without it a machine where adrkit cannot run has no internal round at all.
- **Existing tools**: `hookio.claim_checks_mode`, `hookio.shim_checks_mode` (`_setting`): fit, one more of the same.

## R16: `max_review_files`, the size a round may review

- **Decision**: `config.json` gains `max_review_files` (50), read through `hookio` as the other settings are. After
  `launch_round` and the review base, before any `adr` call, an internal launch whose files (R2) number more than it
  is refused with `hookio.refuse` (so it follows the plugin's mode), naming the count and the limit; next step: split
  the PR (full round), or commit in smaller steps and launch after each (delta round). It applies to every internal
  round, governed or not.
- **Rationale**: the user's choice (Clarifications). adrkit's own marker-scan cap (`MARKER_SCAN_FILE_CAP`, 3000) is a
  constant of its code with no option; a smaller limit the plugin owns is met first, so the capped-scan refusal is
  left for a change of over 3000 files, which this limit already refuses.
- **Existing tools**: `claim_warn_over` (a number in `config.json` the workflow reads): fit, the same file; read by the
  gate instead, since it refuses.

## R17: The decision reviewer's rulings in `gate.log`

- **Decision**: when the gate accepts an assessment for a round whose `expected` includes the decision reviewer, it
  writes one `gate.log` line: action `decision-review`, the round ref, and `<id>=<FIX|PUSH_BACK|DEFER>` for each
  `decision-reviewer-<n>` finding.
- **Rationale**: the user's choice: the rulings are what tell whether the reviewer's brief is right, and `gate.log`
  outlives a PR's ledger doc.
- **Existing tools**: `hookio.record`: fit. `ledger.adjudicated` (the rulings per finding): fit, the source of the line.
