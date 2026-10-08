---

description: "Task list for the claim check before commit"
---

# Tasks: Claim check before commit

**Input**: Design documents from `/specs/005-claim-check-gate/`

**Prerequisites**: plan.md, spec.md, research.md (R1-R11), data-model.md, contracts/claim-check.md, quickstart.md

**Tests**: Required. Constitution IV and the plan's Constitution Check commit every mechanism to a failing test
written and run before its code. Each test task below is run and must fail for the reason it names before the
implementation task after it starts. Tests drive `scripts/gate.py` with hook payloads and recorded agent outputs;
no test calls a model.

**Organization**: by user story from spec.md, in priority order.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2, US3 from spec.md

## Path Conventions

All paths are relative to `.claude/plugins/alq-review/` unless they start with `specs/`. Tests run from that
directory with `ALQ_REVIEW_STATE_DIR=$(mktemp -d) python3 -m unittest discover -s tests`. Gate tests subclass
`Gate` in `tests/test_gate.py`, which builds a scratch repo through `test_worktree_facts.Repo`.

---

## Phase 1: Setup (spikes and settings)

**Purpose**: settle the two facts the plan leaves unrun, and add the settings every story reads.

- [X] T001 Spike, record the answer in `specs/005-claim-check-gate/research.md` R10: in a throwaway workflow
  script, call `budget.spent()` after one `agent()` call and print what it returns. If it returns output tokens,
  R10's `output_tokens` comes from it; if it does not exist or returns nothing usable, delete `output_tokens` from
  R10, data-model.md `cost` and contracts §2, and say so in the R10 entry. Delete the throwaway script.
- [X] T002 [P] Spike, record the answer in `specs/005-claim-check-gate/research.md` R1: time `git write-tree`,
  `git diff --cached -U0`, `git diff --quiet` and one `git patch-id --stable` on the largest repo in the
  workspace with a 50-file staged change. If the total exceeds 2 s, add an explicit `timeout` to the PreToolUse
  hook in `hooks/hooks.json` in T004 and record the measured time and the chosen value in R1.
- [X] T003 [P] Obtain the study's judge prompt (supplied by the user in session 60700fd1, research R5) from that
  session's history. If it cannot be found, stop and ask the user for it; do not write a new one. Save it verbatim,
  with `${READONLY}` unfilled, as the draft for T026.
- [X] T004 Add `"claim_checks": "enforce"` and `"claim_warn_over": 20` to `config.json`; add `WebFetch` to the
  PreToolUse matcher in `hooks/hooks.json` (`Edit|Write|NotebookEdit|Bash|Agent|Skill|Workflow|StructuredOutput|WebFetch`),
  with the timeout from T002 if one is needed.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: the diff parser, the shell rule, the ledger tables and the pure module every story builds on.

**⚠️ CRITICAL**: no user story work starts until this phase is complete.

Callers of what this phase changes: `worktree.added_lines` is called only by `facts.round_facts`;
`shell.classify` only by `gate.on_bash`; `ledger.SCHEMA` by every ledger call through `ledger._connect`;
`gate._setting` by `gate.mode` and `gate.spec_checks_mode`.

- [X] T005 [P] Write failing tests in `tests/test_worktree_facts.py`, class `StagedHunks(Repo)`: (a)
  `worktree.tree_hunks(root, base, tree)` returns one hunk per `@@` of `git diff -U0 -M <base> <tree>` with
  `{id, file, old_start, old_count, new_start, new_count, removed, added, patch_id}`, a missing count read as 1;
  (b) a removal-only hunk is returned with `added == []`; (c) a new file is one hunk `old_start 0, old_count 0`;
  (d) a file `git check-attr linguist-generated` reports `set` is skipped; (e) a binary file yields no hunk;
  (f) `patch_id` is `git patch-id --stable` of that hunk alone: unchanged when only spaces or indentation are
  added, changed when a word changes; (g) a staged rename's text is returned as added lines. Also assert
  `RoundFacts` tests still pass unchanged.
- [X] T006 Split `worktree.added_lines` into a diff-text parser over `_HUNK` (extended to capture the old-side
  start and count) plus its existing `git diff -U0 <since>` caller, and add `worktree.tree_hunks(root, base, tree)` over
  the same parser with `git diff -U0 -M <base> <tree>`, `git check-attr linguist-generated` and `git patch-id --stable`
  in `scripts/worktree.py`. No second hunk regex. T005 passes.
- [X] T007 [P] Write failing tests in `tests/test_shell.py`: `shell.classify` returns the `commit` action with
  `staging` set for `-a`, `--all`, `-i`, `--include`, `-o`, `--only` and for any pathspec, and with
  `alone == False` when any segment other than `cd …` shares the command (`git add -A && git commit -m x`,
  `git commit -m x; echo`, `true && git commit`); `cd /x && git commit -m y` is `alone == True` with cwd `/x`.
  `-m`, `-F`, `--amend`, `--no-edit` values are not mistaken for pathspecs.
- [X] T008 Extend `shell.Action` with `staging: bool` and `alone: bool` (set only for `commit`) and compute them
  in `shell.classify` / `shell._git` in `scripts/shell.py`. T007 passes, and every existing `tests/test_shell.py`
  case passes.
- [X] T009 [P] Write failing tests in `tests/test_ledger.py`: the four tables `claim_checks` (key `repo`, `tree`),
  `claim_reads` (key `repo`, `patch_id`), `claim_verdicts` (key `repo`, `claim_id`) and `claim_holds` (key `repo`,
  `head`, `file`, `old_start`, `old_count`), each with a JSON `doc`, exist after `_connect`; their accessors
  read, write and update a row inside `ledger._transaction`; an existing ledger file without them gains them on
  open.
- [X] T010 Add the four tables to `ledger.SCHEMA` and their accessors (`claim_check`, `save_claim_check`,
  `claim_read`, `save_claim_read`, `cached_verdict`, `cache_verdict`, `claim_holds`, `save_claim_hold`) in
  `scripts/ledger.py`, all through `_transaction`. T009 passes.
- [X] T011 [P] Write failing tests in `tests/test_claimcheck.py`, class `Ids`: `claimcheck.claim_id(file, quote)`
  is stable and differs when either changes; `claimcheck.check_ref(repo, tree)` is `<repo>#tree:<tree[:10]>` and
  `claimcheck.parse_check_ref` inverts it and rejects anything else; `claimcheck.CATEGORIES` is `K1`..`K8`;
  `claimcheck.VERDICTS` is `CORRECT`, `WRONG`, `UNSURE`.
- [X] T012 Create `scripts/claimcheck.py` with the ids, ref parser and value lists from T011, stdlib only, no I/O.
  T011 passes.
- [X] T013 [P] Write a failing test in `tests/test_gate.py`, class `ClaimCheckSetting(Gate)`:
  `gate.claim_checks_mode()` reads `claim_checks` from `config.json`, is overridden by `ALQ_REVIEW_CLAIM_CHECKS`,
  and is independent of `mode()`.
- [X] T014 Add `claim_checks_mode()` and `refuse_claim(payload, action, reason, target)` beside
  `spec_checks_mode` / `refuse_spec` in `scripts/gate.py`, using `_setting`; under `log` it records `would_deny`
  and allows. T013 passes.

**Checkpoint**: hunks, shell flags, tables, ids and the setting exist; `python3 -m unittest discover -s tests` is
green.

---

## Phase 3: User Story 1 - A wrong claim is refused at commit and handed back (P1) 🎯 MVP

**Goal**: an agent's `git commit` is refused until the exact staged tree has a complete check; a `WRONG` verdict
refuses with the claim, its `file:line`, the failing case and the settling `file:line`; `UNSURE` is a note; a
failed check refuses as a failure; what the repo's commit hook changes is not checked again.

**Independent test**: quickstart steps 1, 2, 4, 5, 6, 7 with recorded agent outputs in `tests/test_gate.py`, and
spec US1 scenarios 1-6.

### Tests for User Story 1 (write first, run, confirm each fails for the stated reason)

- [X] T015 [P] [US1] Failing tests in `tests/test_claimcheck.py`, class `CommitDecision`, for the pure
  `claimcheck.commit_decision(check, *, staged_empty, concluding, alone, staging)`: empty staged diff or a
  concluding merge/cherry-pick/revert → allow, no check; `staging` or not `alone` → refuse "stage with `git add`
  in an earlier command, then run `git commit` alone"; no check for the tree → refuse naming
  `Workflow(name='alq-review:claim-check', args={worktree: '<abs path>'})`; status `reading`/`judging` →
  refuse saying the check failed, not that a claim is wrong, and naming the same call; `complete` with any
  `WRONG` → refuse listing per claim `file:line`, the quoted claim, the failing case and the evidence `file:line`,
  then "fix the claim or the code, or contest with evidence"; `complete` with only `CORRECT`/`UNSURE` → allow.
- [X] T016 [P] [US1] Failing tests in `tests/test_claimcheck.py`, class `ValidateReader`, for
  `claimcheck.validate_reader(output, batch, staged_text)`: every hunk id of the batch appears exactly once
  (missing or duplicated → reason); `kind` is `CODE|PROSE|MIXED`; a CODE hunk has no claims; a `quote` must be
  verbatim in the staged file at `line`; `line` outside the hunk's paragraph → reason; `category` outside
  `K1`..`K8` → reason. Paths are read from the staged tree (`git show :<path>`), never the worktree.
- [X] T017 [P] [US1] Failing tests in `tests/test_claimcheck.py`, class `ValidateVerdict`, for
  `claimcheck.validate_verdict(output, claim, in_index)`: `CORRECT` needs every assertion `confirmed` with a
  `path:line` evidence; `WRONG` needs `failing_case` and at least one unconfirmed assertion with `path:line`;
  `UNSURE` needs `gap`; a `path:line` whose path is not in the index (`git cat-file -e :<path>`) or whose line is
  past its end → reason; an `https://` URL is accepted only when `contest=True`.
- [X] T018 [P] [US1] Failing tests in `tests/test_claimcheck.py`, class `Completion`: a check is `complete` when
  every hunk has a label and every K1 claim has a verdict; a check whose verdicts are all `UNSURE`
  with nothing cited is complete (FR-015); claims in K2..K8 are counted in
  `not_judged_categories` and not judged.
- [X] T019 [US1] Failing gate tests in `tests/test_gate.py`, class `ClaimCheckCommit(Gate)`, with recorded
  reader and judge outputs: (1) README says "the validator rejects an empty list", `validator.py` accepts one →
  `git commit` refused naming the workflow; after the recorded check, refused naming `README.md:<line>`, the
  claim, the empty-list case and `validator.py:<line>` (US1-1); (2) a true sentence → allowed with no output
  (US1-2); (3) a claim whose settling code is outside the repo → `UNSURE`, allowed, note returned (US1-3); (4) code
  only → reader labels CODE, no judge, allowed (US1-4); (5) a removal-only hunk → its sentence as it now reads is
  judged (US1-5); (6) a code line plus a comment → only the comment's claim is judged (US1-6); (7) the commit runs
  with no PR open for the branch; (8) `git add -A && git commit` and `git commit -a` refused; (9) an empty commit
  and a commit with `MERGE_HEAD` present run no check; (10) under `ALQ_REVIEW_CLAIM_CHECKS=log` case 1 is recorded
  `would_deny` and allowed while `mode()` still enforces.
- [X] T020 [US1] Failing gate tests in `tests/test_gate.py`, class `ClaimCheckLaunch(Gate)`: launching
  `alq-review:claim-check` with an unstaged change to a tracked file is refused, naming the file; a clean launch
  returns `updatedInput` carrying `check_ref`, the hunks, the reader and judge prompts and schemas, and writes a
  `claim_checks` row with `status: reading`; a staged change with no hunks is refused at launch as "nothing to
  check".
- [X] T021 [US1] Failing gate tests in `tests/test_gate.py`, class `ClaimCheckOutputs(Gate)`: a reader output
  with a wrong `check_ref` or a non-verbatim quote is rejected through `on_structured_output` with reasons; a valid
  one is recorded by `after_structured_output` and moves the check to `judging`; a valid verdict per K1 claim moves
  it to `complete`; a workflow result `INCOMPLETE` leaves the commit refused as a failed check (FR-015).
- [X] T022 [P] [US1] Failing test in `tests/test_agents.py` (new): the frontmatter `tools:` of
  `agents/claim-reader.md` is exactly `Read`, of `agents/claim-judge.md` exactly `Read, Glob, Grep`, of
  `agents/claim-contest-judge.md` exactly `Read, Glob, Grep, WebFetch`; none lists Edit, Write, NotebookEdit or
  Bash (FR-016, SC-006).
- T023 withdrawn 2026-10-02: commit hooks are not checked again (R11, user decision); its tests and code were
  removed.

### Implementation for User Story 1

- [X] T024 [US1] Implement `commit_decision`, `validate_reader`, `validate_verdict` and the completion rule in
  `scripts/claimcheck.py`, pure, taking the staged text and an index-membership callable as arguments.
  T015-T018 pass.
- [X] T025 [P] [US1] Create `agents/claim-reader.md` (`tools: Read`), `agents/claim-judge.md`
  (`tools: Read, Glob, Grep`) and `agents/claim-contest-judge.md` (`tools: Read, Glob, Grep, WebFetch`), model
  Sonnet, effort medium, following `agents/assessor.md`'s frontmatter without Bash. T022 passes.
- [X] T026 [US1] Add `claim_check_args(where, check)` to `scripts/briefs.py`: the reader prompt (label each hunk
  CODE/PROSE/MIXED from content, not extension; extract claims as verbatim quotes with K1..K8, using the K1-K8
  definitions in `specs/005-claim-check-gate/plugins-random-commits.md` Step 3), the judge prompt from T003
  verbatim with only the checkout line changed and `${READONLY}` filled with "read and search only, never modify
  files", the reader and judge JSON schemas from contracts §3, batches of up to 16 hunks, and `check_ref`.
- [X] T027 [US1] Create `workflows/claim-check.js` modelled on `workflows/review-round.js`: read the
  gate-injected args; run reader agents per batch in `parallel()`; then one judge per K1 claim in `parallel()`;
  return the contracts §2 result; any agent that does not report → `{status: 'INCOMPLETE', did_not_report,
  next_step}`.
- [X] T028 [US1] In `scripts/gate.py` `on_workflow`, handle `alq-review:claim-check`: locate the worktree,
  refuse when `git diff --quiet` fails (naming the files), compute `git write-tree`, `tree_hunks`, write the
  `claim_checks` row, and return `updatedInput` from `briefs.claim_check_args`. T020 passes.
- [X] T029 [US1] In `scripts/gate.py` `on_structured_output` / `after_structured_output`, find claim-check outputs
  by `check_ref`, validate with `claimcheck.validate_reader` / `validate_verdict` against `git show :<path>` and
  `git cat-file -e :<path>`, reject with reasons, record valid ones and advance `status`. T021 passes.
- [X] T030 [US1] In `scripts/gate.py` `on_bash`, for each `commit` action, evaluate `claimcheck.commit_decision`
  before the existing `policy.mutation` rule and independently of whether a PR exists (the current
  `event is None → continue` must not skip it); refuse through `refuse_claim`. Detect concluding commits from
  `MERGE_HEAD`, `CHERRY_PICK_HEAD`, `REVERT_HEAD` in the git dir. T019 passes.
- T031 withdrawn 2026-10-02 with T023.

**Checkpoint**: US1 tests and every existing test pass; a wrong claim refuses a commit end to end with recorded
outputs.

---

## Phase 4: User Story 2 - Correct or contest a verdict, and the loop ends (P2)

**Goal**: only changed hunks are read again; a contest with evidence is re-judged by a fresh judge with fetches
limited to the cited sites; a hunk refused 3 times stops the loop and only the user's `unlock claim-<id>` releases
it at its current words.

**Independent test**: quickstart step 3 with recorded outputs, and spec US2 scenarios 1-5.

### Tests for User Story 2 (write first, run, confirm each fails)

- [X] T032 [P] [US2] Failing tests in `tests/test_claimcheck.py`, class `Holds`, for pure hold transitions
  (data-model Hold): a completed check with a `WRONG` in a hunk adds 1 to that hunk's hold; a check with two
  `WRONG` claims in one hunk adds 1, not 2; a hunk whose old-side range overlaps or touches a hold continues it;
  counts are never summed across hunks or files; a new file is one hold; `refusals == 3` and not released →
  refuse with the question for the user, the hunk's claim ids and `unlock claim-<id>`; released with the same
  patch-id → pass; a different patch-id → `refusals` restarts at 0; a new `HEAD` starts a new hold; a rejected
  contest adds 1; an upheld contest adds 0 and replaces the verdict.
- [X] T033 [P] [US2] Failing tests in `tests/test_claimcheck.py`, class `Contests`, for
  `claimcheck.accept_contest(contest, in_index)`: evidence with a `path:line` in the index or an `https://` URL is
  accepted; an assertion with neither is refused naming the missing evidence (US2-3); an unknown claim id is
  refused; `claimcheck.fetch_allowed(url, contest)` is true only when the URL's host (`urllib.parse`) equals the
  host of a URL cited in that contest.
- [X] T034 [US2] Failing gate tests in `tests/test_gate.py`, class `ClaimCheckRepair(Gate)`: (1) after a refusal,
  rewriting only the flagged sentence and relaunching reads only that hunk again; other hunks reuse their
  `claim_reads` row by patch-id and keep their claim ids (US2-1); (2) repeating `git commit` against the same
  check adds no refusal; (3) three completed checks with a `WRONG` in one hunk, reworded between them →
  refused with the user's question while a second hunk refused once stays at 1 (US2-4); (4) the agent running
  `ledger.py unlock` is refused; (5) a user prompt `unlock claim-<id>` through `on_prompt` releases that hunk and
  the commit goes through; changing its words afterwards makes it checked again (US2-5); (6) a `WRONG` is
  re-judged when any other staged file changes (FR-010).
- [X] T035 [US2] Failing gate tests in `tests/test_gate.py`, class `ClaimCheckContest(Gate)`: a launch with
  `contests: [{claim, evidence}]` carrying evidence re-judges that claim alone with
  `alq-review:claim-contest-judge`, given the claim, the first verdict and the evidence (US2-2); a contest without
  evidence is refused at launch before any agent; a `WebFetch` from that agent type to a cited host is allowed,
  to any other host refused, and from any other agent type unaffected by this rule; an upheld contest replaces the
  verdict in the check for the same tree; a rejected one adds a refusal.

### Implementation for User Story 2

- [X] T036 [US2] Implement hold transitions, `accept_contest` and `fetch_allowed` in `scripts/claimcheck.py`.
  T032, T033 pass.
- [X] T037 [US2] In `scripts/gate.py` `on_workflow`, reuse `claim_reads` by patch-id so only unread hunks go to
  readers; save each validated reader output under its patch-id in `after_structured_output`. T034 case 1 passes.
- [X] T038 [US2] In `scripts/gate.py`, update `claim_holds` once per completed check (not per commit attempt) and
  make `commit_decision` consult holds; extend `on_prompt` so `unlock claim-<id>` resolves the held hunk through
  `claim_holds.claims` and stores its patch-id as `released_patch_id`, beside the existing `unlock #<pr>`.
  T034 passes.
- [X] T039 [US2] In `scripts/gate.py`, accept or refuse contests at claim-check launch, inject the contest judge's
  brief (claim, first verdict, evidence) from `scripts/briefs.py`, add an `on_webfetch` handler routed from
  `handle` for `WebFetch` that applies `fetch_allowed` for agent type `alq-review:claim-contest-judge`, and record
  the outcome. Extend `workflows/claim-check.js` with the contest path. T035 passes.

**Checkpoint**: US1 and US2 tests pass; the repair loop is bounded and the release is user-only.

---

## Phase 5: User Story 3 - The cost of a check is visible, and a large one is flagged (P3)

**Goal**: every claim is judged; over 20 claims warns without refusing; an unchanged `CORRECT` claim is not
judged again; the result and `gate.log` show claims judged and cost.

**Independent test**: spec US3 scenarios 1-3 with recorded outputs.

### Tests for User Story 3 (write first, run, confirm each fails)

- [X] T040 [P] [US3] Failing tests in `tests/test_claimcheck.py`, class `VerdictCache`: a `CORRECT` is reusable
  while every cited path has the same blob id (`git rev-parse :<path>`); a changed blob invalidates it; a claim
  containing every, only, all, exactly, always or never is never cached; `WRONG` and `UNSURE` are never cached.
- [X] T041 [US3] Failing gate tests in `tests/test_gate.py`, class `ClaimCheckCost(Gate)`: (1) 21 K1 claims →
  all 21 judged, the result carries `warning: "21 claims; consider splitting into several PRs"` from
  `claim_warn_over`, and the commit is not refused for it (US3-1); (2) an unchanged `CORRECT` claim from the
  previous check is not sent to a judge (US3-2, SC-005); (3) the result carries `judged`, `agents` and, if T001
  kept it, `output_tokens`, and `gate.log` holds a line per check with claims judged, verdicts and cost, and lines
  for each refusal, contest outcome and release (US3-3, FR-018).

### Implementation for User Story 3

- [X] T042 [US3] Implement the cache rule in `scripts/claimcheck.py`; write `claim_verdicts` on a validated
  `CORRECT` and skip cached claims at launch in `scripts/gate.py`. T040, T041 case 2 pass.
- [X] T043 [US3] Return `judged`, `agents`, the T001 cost field and the `claim_warn_over` warning from
  `workflows/claim-check.js` (threshold injected by the gate from `config.json`), and write the check, refusal,
  contest and release lines through `gate.record` in `scripts/gate.py`. T041 passes.

**Checkpoint**: all three stories pass their tests independently.

---

## Phase 6: Polish, real-agent runs and release

- [X] T044 Document the claim check, its `claim_checks` / `claim_warn_over` settings, the commit-alone rule, the
  contest call and `unlock claim-<id>` in `README.md`; bump `.claude-plugin/plugin.json` to `0.7.0`.
- [X] T045 Run `python3 -m unittest discover -s tests` with a scratch `ALQ_REVIEW_STATE_DIR`; all green.
- [X] T046 Real agents, manual: run quickstart steps 1-8 in a scratch repo with the plugin loaded from this
  worktree; record each result against its spec scenario in `specs/005-claim-check-gate/quickstart.md` under a
  "Run 2026-MM-DD" heading. Confirm SC-006: `git status --porcelain` and the untracked file list are identical
  before and after each check.
- [X] T047 Real agents, manual (SC-001): replay the 30 K1 claims of
  `specs/005-claim-check-gate/plugins-random-commits.md` Step 4 against `analitiq-ai/claude-code-plugins` at each
  row's commit; record that all 30 got a verdict and each settled assertion names a `file:line`.
- [X] T048 Real agents, manual (SC-002, SC-004): a stub repo seeded with 10 wrong and 10 true claims; record which
  were refused, that no true claim was refused, and the wall time from commit attempt to decision for a 30-claim
  commit (must be within 5 minutes). Report the numbers to the user; no threshold is built in.
- [X] T049 Tripwire before the PR: `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; any file above
  ~3 commits gets the one-shot rewrite (pr-review-loop rule) before pushing.

---

## Phase 7: Amendment of 2026-10-06 - the count follows a claim lineage (ADR-0001, issue #17)

**Goal**: FR-011 and FR-017 as amended. Supersedes every task that names the per-hunk hold, which this phase
removes: the `claim_holds` table and accessors of T009 and T010, T032, cases 3 and 5 of T034, the hold
transitions of T036, and T038. No migration of `claim_holds` rows.

**Independent test**: quickstart steps 3 and 4, and US2 scenarios 4 to 10.

- [ ] T050 Write gate tests, not written yet, for the two reported defects, on the current code: a commit of another file
  between two `WRONG` checks of one claim leaves its count at 2 (#15); one check that rules two claims of one
  hunk `WRONG` adds one to each claim and two to neither (#16). The first covers one clause of Keys in data-model
  Lineage: no count is keyed on `HEAD` or a commit. Run them; both fail for those reasons.
- [ ] T051 [P] Write tests, not written yet, in `tests/test_lineage.py` for the pure module (R12): one per row
  under **Succession** in the Transitions table of data-model Lineage, and one per sentence of its "Who wins a
  claim", "Minting" and "Not followed" paragraphs. Each is a sequence of file versions. The Split case asserts
  that the minted row's count equals its parent's. Run them; they fail because `lineage.py` does not exist.
- [ ] T052 Implement `scripts/lineage.py`, pure: open rows, the `git diff -U0` hunks of two blobs and the staged
  claims in, new rows out. `diff-match-patch` maps a sentence's character span. T051 passes.
- [ ] T053 Failing test: a hook that imports `lineage` without `diff-match-patch` installed fails with a message
  naming the install command. Implement. Green.
- [ ] T054 [P] Write tests, not written yet, in `tests/test_claimcheck.py`, pure, for these labels of data-model
  Lineage: one per entry of State, per cell under **Ruling** and **Other events** of the Transitions table and
  per clause of Tree rule, the path set given as input; and one per sentence of Count, Stopped rows and Unlock
  of a stopped row. They include the same check applied twice, which asserts the count after the second time.
  Run them; each fails.
- [ ] T055 Write gate tests, not written yet, in `tests/test_claim_gate.py`, driving the hooks: the Tree rule
  of data-model Lineage at the launch and at the commit, with a staged move of a stopped row's file asserting
  both refusals; the `unlock` row of its Transitions table, typed by the user and by an agent, asserting the
  stored `released`; Which row an unlock names, with one id that is the current claim of one open row and the
  row id of another, asserting which row is released; Contests, with contract §2, asserting the stored
  `contests[]`; and Old trees, with the stored tree pruned from git, asserting that succession still
  carries the row. Run them; each fails, because each sets up or reads rows of `claim_lineages`, which does not exist yet.
- [ ] T056 Replace `claim_holds` by `claim_lineages` in `scripts/ledger.py`, and the hold functions of
  `scripts/claimcheck.py` and their callers in `scripts/claimgate.py` by the rules of data-model Lineage and the
  module of T052. T050, T054 and T055 pass. Then delete the hold code and its tests.
- [ ] T057 Update the plugin README (the claim check, `unlock`, State) and run quickstart steps 3 and 4 with
  real agents.

## Dependencies & Execution Order

### Phase dependencies

- Setup (T001-T004): no dependencies. T001 and T003 block T026/T043 content; T002 blocks T004's timeout.
- Foundational (T005-T014): after T004. Blocks every story.
- US1 (T015-T031): after Foundational. The MVP.
- US2 (T032-T039): after US1; it extends the launch, output and commit paths US1 builds (T028-T030).
- US3 (T040-T043): after US1; independent of US2 except that T041's log lines for contests and releases need
  T039/T038 (write those two assertions last, or after US2).
- Polish (T044-T049): after the stories that ship.

### Within each story

Tests first, run red, then implementation. `scripts/claimcheck.py` before `scripts/gate.py`; agents and briefs
before the workflow; the workflow before the gate's launch handler is exercised end to end.

### Parallel opportunities

- T002, T003 alongside T001.
- T005, T007, T009, T011, T013 (different test files) together; then T006, T008, T010, T012, T014 together
  (different source files).
- US1 tests T015-T018 and T022 together (T015-T018 share `tests/test_claimcheck.py`; write as separate classes in
  one sitting, or serialize). T025 alongside T024.
- US2 T032, T033 together; US3 T040 alongside US2 if staffed separately.

## Parallel Example: User Story 1

```text
Task: "T015-T018 failing pure-function tests in tests/test_claimcheck.py"
Task: "T022 failing agent tool-list test in tests/test_agents.py"
Then:
Task: "T024 claimcheck.py rules"
Task: "T025 three agent files"
```

## Implementation Strategy

### MVP first (User Story 1)

1. Setup and Foundational.
2. US1: a wrong claim refuses the commit, a failed check refuses.
3. Stop and run T045 plus quickstart steps 1, 2, 4-8 with real agents before going on.

### Incremental delivery

US1 → US2 (bounded repair loop, contests, user release) → US3 (cache, warning, cost) → Polish. The plugin ships
as one 0.7.0 release: blocking from the first release is the spec's decision, and US1 alone has an unbounded
repair loop, so do not release before US2 is in.
