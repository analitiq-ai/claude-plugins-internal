---

description: "Task list for #177: planner checks the plan against the ADR folders it is given"
---

# Tasks: planner checks the plan against the ADR folders it is given

**Input**: Design documents from `specs/177-plan-adr-check/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R15), data-model.md, contracts/ (`core.md`, `artifact-grammar.md`,
`workflow-steps.md`), quickstart.md

**Tests**: required. Constitution Principle IV (test-first) and quickstart.md name every test; each story writes its
tests first and sees them fail for the expected reason before implementing.

**Organization**: one phase per user story; one story is one PR (constitution, Delivery Workflow). PR order (R11):
the planning PRs (decision records, no code) → US2 → US3 (US4 merged into it, 2026-11-04); US5's core half after US2, its reviewer half after
#235; US6 (#285) after US5 (#278), its reviewer half after #235. US1 was moved into the planning PR on 2026-11-03; ADRs and specs are written in planning only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US2–US6 from spec.md

---

## Phase 1: Setup
Story issue: #275

**Purpose**: the tools the tests and the manual check need (quickstart.md, Prerequisites)

- [ ] T001 Install `@adrkit/cli@0.20.0` (`npm install -g @adrkit/cli@0.20.0`), confirm `adr --version` prints `0.20.0`, install `specify-cli==1.1.3`, and check analitiq-ai/engineering out beside this repo so `../engineering/docs/adr` exists, as `specs/177-plan-adr-check/quickstart.md` Prerequisites lists

---

## Phase 2: Foundational
Story issue: #275

None. The blocking prerequisite is the planning PRs merging: they amend planner ADR-0009, orchestrator ADR-0004
d4, reviewer ADR-0002 d4 and ADR-0017 d2, and add root ADR-0011 and reviewer ADR-0022, before any code of US2–US6 (FR-001, constitution Principle VI).

---

## Phase 3: User Story 2 - core reads the list of ADR folders and resolves each path (Priority: P1) 🎯 MVP
Story issue: #275

**Goal**: `[shared] adr_folders` (required, may be empty), `adrFolders` resolving each entry, and `adr` run at one
pinned version and read by one reader, all in core.

**Independent Test**: `npm --prefix core test` green, including `core/tests/adr-folders.test.ts` and
`core/tests/adr.test.ts` (quickstart.md, Core).

### Tests for User Story 2 (write first, see them fail)

- [ ] T005 [P] [US2] In `core/tests/settings.test.ts` add `adr_folders = []` to the TOML fixture and `adr_folders: []` to the parsed object, add `"adr_folders"` to `REQUIRED_KEYS`, and add cases: a missing key, a non-array, an empty-string entry and an entry written twice each throw `SettingsError` whose `where` is `SHARED_SECTION` and whose message names `adr_folders`; `adr_folders = []` is accepted (US2 AS4, AS5)
- [ ] T006 [P] [US2] Create `core/tests/adr-folders.test.ts`, porting the corpus cases of `reviewer/tests/test_adrkit.py` (labels, a folder both entries reach, an org folder inside the checkout, a folder reached through a symlink, the checkout root given through a symlink) and adding: a scratch repo built with core's `runGit`, a worktree at `../<repo>.worktrees/<branch>`, an `org/docs/adr` folder beside the repo, `docs/adr` committed with a record only the worktree's branch adds, an absolute folder, a missing one, one `chmod 000` and a file; assert `adrFolders(checkout, shared)` returns `{entry, path, inside, readable}` per entry in list order: `../org/docs/adr` resolves to the same realpath from main checkout and worktree with `inside: false` (AS1); `docs/adr` resolves to each checkout's own folder with `inside: true` (AS2); missing, unreadable and a file are `readable: false`, others unchanged (AS3); `docs/adr` plus the absolute path of the same folder throws `SettingsError` on `SHARED_SECTION` naming both; `adr_folders: []` returns `[]` (AS5); called from the main checkout itself, resolution is the same; a cwd outside any git repo throws `GitFailed`
- [ ] T007 [P] [US2] Create `core/tests/adr.test.ts` by porting case for case the answer, version, deadline and failure cases of `reviewer/tests/test_adrkit.py` and the answer-reading cases of `reviewer/tests/test_decisions.py` (each test's Python name in a comment), as `specs/177-plan-adr-check/quickstart.md`'s Core table lists: `readAdrAnswer(raw)` on adrkit 0.20.0 answers (governing, broken leaving its record out of governing, notices, other findings ignored, each `AdrAnswerUnread` branch, `AdrScanCapped`); `checkAdrFolder(cwd, folder, paths, deadlineMs)` with a stand-in `adr` first on `PATH`: missing, cannot start, `--version` non-zero or `0.19.0`, exit 3, exit 1 non-JSON, exit 0 non-JSON, unread answer, capped, past the deadline, unreadable folder (no call) each `COULD_NOT_RUN` (never a throw) whose reason names the folder once and ends with the table's next step; `--dir` relative to `cwd` for an in-repo folder, absolute for an outside one; args `check --dir <folder> --json -- <paths>`

### Implementation for User Story 2

- [ ] T008 [US2] In `core/src/settings.ts` add to `Shared` `adr_folders: z.array(z.string().min(1))`, required, refusing an entry written twice with the same refusal `validators` uses; move that `superRefine` into one local helper both keys call rather than copying it (R1, FR-002)
- [ ] T009 [US2] Create `core/src/adr-folders.ts` per `contracts/core.md`: `ResolvedAdrFolder` and `adrFolders(checkout, shared)`; absolute entry as written; relative entry joined to the parent of `git rev-parse --path-format=absolute --git-common-dir` and normalised, and if that lies inside the main checkout, re-rooted at the same repo path under `git rev-parse --show-toplevel` of `checkout`; `path` the realpath when it exists; `inside` against the realpath of that toplevel; `readable` = `isDirectory` and `fs.access` `R_OK | X_OK`; two entries that are one folder throw `SettingsError(SHARED_SECTION, …)` naming both; git only through `runGit`; no env var read, no network call (R2, FR-004, FR-005)
- [ ] T010 [US2] Create `core/src/adr.ts` per `contracts/core.md`: `ADR_VERSION`, `ADR_INSTALL`, `AdrAnswer`, `AdrScanCapped`, `AdrAnswerUnread`, pure `readAdrAnswer(raw)` and `checkAdrFolder(cwd, folder, paths, deadlineMs)`, ported from `reviewer/plugin/scripts/adrkit.py` (`check`, `parse`, `_finding`, `_failed`, `_unread`) and `decisions.py` (`judge`): every could-not-run through `couldNotRun(folder.entry, …)` ending with the contract table's next step (R3, FR-013)
- [ ] T011 [P] [US2] Add `adr_folders: []` to every typed `Shared` literal so `tsc -p core` passes: `core/tests/fixtures/state/issue.ts`, `core/tests/could-not-run.test.ts`, `core/tests/threads.test.ts`, `core/tests/required-checks.test.ts`, `core/tests/contract.test.ts`, `core/tests/state-read.test.ts`
- [ ] T012 [P] [US2] Add `adr_folders = []` to the `[shared]` TOML in `planner/tests/support/checkout.ts` and `planner/tests/token.test.ts` (R1)
- [ ] T013 [P] [US2] Add `adr_folders` (`[]` / `adr_folders = []`) to `orchestrator/tests/support/story.ts` (`SHARED`) and `orchestrator/tests/support/checkout.ts` (`SHARED` TOML) (R1)
- [ ] T014 [US2] In `codeworks.toml` `[shared]` add `adr_folders = ["docs/adr", "planner/docs/adr", "reviewer/docs/adr", "builder/docs/adr", "orchestrator/docs/adr", "auditor/docs/adr", "../engineering/docs/adr"]` (R1, FR-003)
- [ ] T015 [US2] Verify US2: `npm --prefix core test`, `npm --prefix planner test`, `npm --prefix orchestrator test` green; the PR body states the rollout (critique E8): `Shared` is strict, so after merge the agent machine and the admin's machine reinstall at once, and every other repo with a `codeworks.toml` gains `adr_folders = []` in step

**Checkpoint**: US2 PR merged; US3 and US5's core half may start.

---

## Phase 4: User Story 3 - planner checks the plan and its tasks before the run completes (Priority: P1)
Story issue: #276 (US4, #277, merged into it on 2026-11-04; #277 has no tasks)

**Goal**: one check loop `adr-check` after the critique gate, in place of `to-tasks`; each round runs
settled-design → clear → touches → the tasks command when due → landing's story checks → ask → judge → decide →
report over the plan's and the tasks' paths; a script decides each folder's outcome from the judge's verdict; every
line comes from one stop table through `adrStop`; each resume after a stop runs a new round; the user can overrule a
departure the round found on resume; `tasks.md` is never edited by hand. Folds in #303.

**Independent Test**: `node --test planner/tests/adr-check.test.ts planner/tests/land.test.ts` and
`python3 -m unittest discover -s planner/tests -p 'test_drive_workflow.py'` green for every row of quickstart.md's
Planner table; the manual end-to-end check in quickstart.md stops at `adr-report`.

### Tests for User Story 3 (write first, see them fail)

- [ ] T016 [P] [US3] Create `core/tests/decision-check.test.ts`: `artifactPath` per `contracts/artifact-grammar.md` (under `"any"`: a `PATH` returned, anything else `PathRefused`; for a task span: a `PATH` with `/` returned, a no-`/` span returned only when `rootFiles` holds it, a span with `/` and a glob or brace character or a `.`/`..` segment `PathRefused`, a command, URL or `<run>/x` placeholder `null`); `readTouchedPaths`: `{"v": 1, "paths": [...]}` read with each entry's 1-based index as `line` and `artifact: plan`; an extra or missing key, `v` other than `1`, an entry not a `PATH` or an entry twice throws `TouchesRefused` naming `touches.json` and the entry; `paths: []` returns `[]` (the script makes it could not run); `AdrAsked` with each folder's `inside` and each path's `artifact`; `AdrVerdict`: `v: 1`, no `artifact` key, `judgment` from `AdrJudgment`, `paths` non-empty for `DEPARTS` and empty for `WITHIN`, `why` non-empty; `AdrRuling`: four non-empty strings, `path` a `PATH`, no other key; `AdrRulings`: `{v: 1, rulings}` with no `(folder, record, path)` twice; `AdrStopRecord`: `{v: 1, exit, lines, shown}`, `exit` `1` or `2` only, `lines` non-empty, no other key; `SourceHashes` and `sourceHashes(cwd, paths)`: an absent file left out, equal for unchanged bytes, unequal for a changed or removed file; `readRulings`: absent file → `[]`, unparsable → `RulingsRefused`
- [ ] T030 [P] [US3] In `core/tests/tasks.test.ts` add `readTaskPaths(tasksText, rootFiles)` cases: `- [ ] T<n>` and `- [x]`/`- [X]` lines read; backticked spans with `/` that are a `PATH` are paths, `artifact: tasks`; `` `codeworks.toml` `` is a path when `rootFiles` holds it, `` `adr check` `` and a URL are not; `` `a/{b,c}.ts` `` and `` `a/*.ts` `` throw `PathRefused` reported as `tasks.md:<line>`; story is `US<k>` from `[US<k>]`, else the heading's text without `## `; a task line above every `## ` heading is refused naming `tasks.md:<line>`; non-task lines ignored
- [ ] T017 [P] [US3] Create `planner/tests/adr-check.test.ts`: unit cases for the pure `decideFolder`, `decideCheck`, `changedSince` and `adrStop` (one case per `ADR_STOPS` row: line `<OUTCOME>: <label>: <what>. Next step: <next>.`, PASS with no next step, a core `CouldNotRun` printed with its label once; exit 2 when any `COULD_NOT_RUN`, else 1 when any `FAIL`, else 0; no row's next step names an edit to `tasks.md`); then drive `node planner/plugin/scripts/adr_check.ts clear`, `tasks-due`, `tasks-written`, `stories`, `ask`, `decide`, `report` and `stop rounds` in a scratch checkout (`planner/tests/support/checkout.ts`) with a stand-in `adr` on `PATH`, a stand-in GitHub, a verdict file the test writes in the judge's place and a `<run>/touches.json` the test writes in the touches step's place, one case per row of `specs/177-plan-adr-check/quickstart.md`'s Planner table, every line read from stderr and the stdout of tasks-due, ask and report read as JSON alone; a stop's exit read from `report` after stories, ask and decide each exit 0 having written `<run>/adr-stop.json`
- [ ] T031 [P] [US3] In `planner/tests/adr-check.test.ts` add the task-path rows: a `[US2]` task and a phase task naming one governed path with a `DEPARTS` verdict → exit 1 naming record, path and both stories, next step "change `plan.md`"; a path both `touches.json` and a task name → one entry per artifact; a `tasks.md` naming no path → exit 2, `tasks-empty`; a ruling written in one round honoured in the next with no `ADR_RULING` set (US3 AS6); a ruling on a key no departure of the round names → `ruling-refused`, nothing appended
- [ ] T066 [P] [US3] In `planner/tests/land.test.ts` assert `land.ts`'s stops name no edit to `tasks.md`: extra sub-issues → "remove them from #p's sub-issues"; a sub-issue out of story order → "order #p's sub-issues so sub-issue k is US<k>'s issue"; a `tasks.md` it refuses → "remove `<spec folder>`, then run `/planner:issue-spec #p [<dir>]` again"; and that `storyPlan` and the sub-issue checks are imported from `planner/plugin/lib/story-plan.ts`
- [ ] T018 [P] [US3] In `planner/tests/test_drive_workflow.py` add a fixture reaching the check loop: a stand-in `claude` whose plan step writes a `plan.md` that passes `settled_design.py`, whose `adr-touches` step writes `<run>/touches.json` from it and whose tasks command writes `tasks.md` from it, a stand-in judge that writes the verdict, a stand-in `adr`, a stand-in GitHub, and a committed `codeworks.toml` with `[planner] app_id` and `adr_folders`; one case per sentence of `specs/177-plan-adr-check/quickstart.md`'s `test_drive_workflow.py` paragraph, the stop step `adr-report`, the qualified id `adr-check:adr-report:1`, the rounds step `adr-rounds` (the test may lower `max_iterations` in its copy of the workflow); #291's `test_a_judge_that_fails_reports_adr_with_the_judge_stop`, `test_a_judge_timeout_reports_adr_with_the_judge_stop` and `test_a_touches_step_that_fails_reports_adr_with_the_touches_stop` change to expect these stops
- [ ] T032 [P] [US3] In `planner/tests/test_drive_workflow.py` add: a resume carrying `adr_ruling` reaches only the round it runs, the next round runs without `ADR_RULING`; a rescope run (starts at grill) runs the check loop, its first round writing `tasks.md` again; a resume after `plan.md` is changed writes `tasks.md` again and checks it; a resume with nothing changed does not run the tasks command; a judge that writes a valid verdict and then fails stops the run at `adr-report` with the `verdict-unread` line
- [ ] T019 [P] [US3] In `planner/tests/test_plan_template.py` assert `planner/plugin/speckit/workflows/issue-spec/workflow.yml` has no `to-tasks` block and its `to-adr-check` block, after `to-review-critique`, holds the `do-while` `adr-check` (`max_iterations: 100`, condition `steps.adr-report.output.data.again`) and then `adr-out-of-rounds`, the loop's steps in the order and with the settings `contracts/workflow-steps.md` gives (`adr-touches` and `adr-judge` with `continue_on_error: true`, `adr-tasks` under an `if` on `steps.adr-tasks-due.output.data.due`), ending with `adr-report`; `requires.speckit_version` is `>=1.1.3,<1.2.0` in `workflow.yml` and `planner/plugin/speckit/presets/settled-design/preset.yml`; `adr-touches.md` tells the model to read `plan.md` and write `<run folder>/touches.json` as `{"v": 1, "paths": [...]}`, one literal path per file created, changed or deleted, no glob, no brace group, no trailing `/`, no `..`, and no other file; the `plan` step's `input.args` and `speckit.plan.md` say nothing of `touches.json`; the plan template has no `## Touches` section
- [ ] T048 [P] [US3] In `planner/tests/test_plan_template.py` assert `planner/plugin/speckit/presets/settled-design/preset.yml` registers command `speckit.tasks` from `commands/speckit.tasks.md` with strategy `append`, and that file tells the model to name each file a task touches as one literal path per backtick span, no glob, no brace group

### Implementation for User Story 3

- [ ] T020 [US3] In `core/src/values.ts` add `AdrJudgment` and `CheckedArtifact` exactly as `specs/177-plan-adr-check/contracts/core.md` gives them, each with a comment naming its owner, planner ADR-0009 (root ADR-0010)
- [ ] T021 [US3] Create `core/src/contracts/decision-check.ts` per `contracts/core.md` and `contracts/artifact-grammar.md`: the file-name constants, `ArtifactPath` (with `artifact`), pure `artifactPath(span, rootFiles)` with `PathRefused`, Zod `TouchedPaths`, pure `readTouchedPaths(json)` (passes `"any"`) with `TouchesRefused`, Zod `AdrAsked`, `AdrVerdict`, `AdrRuling`, `AdrRulings` (no key twice), `AdrStopRecord`, `SourceHashes` and `sourceHashes(cwd, paths)`, `readRulings(specDir)` with `RulingsRefused` (R4, R5, R6, R7, R9, R15, FR-012)
- [ ] T033 [US3] In `core/src/contracts/tasks.ts` add `readTaskPaths(tasksText, rootFiles): ArtifactPath[]` beside `readTaskBlockLabels`, each backticked span through `artifactPath` from `core/src/contracts/decision-check.ts`, `artifact: tasks`, story from `[US<k>]` else the heading found by `isPhaseHeading` (R5, FR-012)
- [ ] T022 [US3] Create `planner/plugin/lib/adr-check.ts`, pure: `FolderOutcome` per data-model.md, `decideFolder`, `decideCheck`, `changedSince(recorded, now) → {added, removed}` (R9), the stop table `ADR_STOPS` as data, row for row as `contracts/workflow-steps.md` gives it, and `adrStop(items) → {lines, exit}` rendering it; a departure's row chosen by its folder's `inside`; a task-path departure naming every story whose task names its path, comma-separated (R8, FR-018)
- [ ] T067 [US3] Move `land.ts`'s pure story checks (`storyPlan`, `TasksRefused`, `TaskBlockLabelRefused`, and the extra, foreign and misplaced sub-issue checks) into `planner/plugin/lib/story-plan.ts`, `land.ts` importing them (`adr-stories` runs the sub-issue checks on a `new` run only); change `land.ts`'s next steps (`:284`, `:297`, `:400`) to the ones `contracts/workflow-steps.md` (`land.ts`) gives (R15, FR-025, #303)
- [ ] T023 [US3] Create `planner/plugin/scripts/adr_check.ts` (I/O only, imports `../lib/guarded.ts` first like `planner/plugin/scripts/spec_facts.ts`) with `clear`, `tasks-due`, `tasks-written`, `stories`, `ask`, `decide`, `report` and `stop rounds`, each exactly as `contracts/workflow-steps.md` gives it, every run-folder record written to a temporary file and renamed over it: settings through `readPlannerSettings` for stories, ask and decide only; stories through `story-plan.ts` and `planner/plugin/lib/github.ts`, the sub-issue checks on a `new` run only; ask reading `touches.json` through `readTouchedPaths` and `tasks.md` through `readTaskPaths` (`rootFiles` from `git ls-files` entries with no `/` and `touches.json` entries with no `/`), comparing `touches-from.json` first; decide matching `ADR_RULING` against the round's departures before any is dropped and appending to `<run>/adr-rulings-written.json` before `<spec folder>/adr-rulings.json`, each skipping an entry already there; stories, ask and decide exit 0 once they reach an answer, writing a stop to `<run>/adr-stop.json`; every line rendered through `adrStop`, none formatted locally (R6, R15, FR-007–FR-011, FR-016–FR-019, FR-025)
- [ ] T024 [US3] Create `planner/plugin/speckit/workflows/issue-spec/adr-judge.md` per `contracts/workflow-steps.md`: read `<run>/adr-asked.json`, `plan.md`, `tasks.md`, `<spec folder>/adr-rulings.json` and each governing record's file; judge each governing record as `reviewer/plugin/agents/decision-reviewer.md` defines a departure, naming none a rulings entry already rules on; write `<run>/adr-verdict.json` per `AdrVerdict` (one verdict per governing record per folder, `folder` the entry as the asked record gives it, `paths` only from the asked paths); write no other file; give no ruling (R7, FR-015)
- [ ] T026 [US3] Create `planner/plugin/speckit/workflows/issue-spec/adr-touches.md` per `contracts/workflow-steps.md`, installed with the workflow as `adr-judge.md` is; the `plan` step, `speckit.plan.md` and the plan template are not changed (R4, FR-012)
- [ ] T049 [US3] Create `planner/plugin/speckit/presets/settled-design/commands/speckit.tasks.md` (strategy `append`, registered in `preset.yml`): each file a task touches is one literal path in its own backtick span, no glob, no brace group; planner ADR-0008 d2 customises the stock tasks template only through presets (R5)
- [ ] T025 [US3] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` bump `version` to `1.7.0`, remove the `to-tasks` block and add `to-adr-check` after `to-review-critique`, exactly as `contracts/workflow-steps.md` gives it; no new input; set `requires.speckit_version` to `">=1.1.3,<1.2.0"` here and in `planner/plugin/speckit/presets/settled-design/preset.yml`; correct the comment above `scope`, which says a resume re-executes the whole top-level step the run stopped in (true on 1.0.x only; 1.1.x re-executes from the halted step, R14) (R6, R14, FR-006)
- [ ] T065 [US3] In `.github/workflows/tests.yml` pin `pip install specify-cli==1.1.3`, the floor `workflow.yml` declares (R14)
- [ ] T027 [US3] In `planner/plugin/skills/issue-spec/scripts/drive_workflow.py`: `resume <run> adr_ruling=@<file>` reads the file and exports its content as `ADR_RULING` in the env of that one `specify resume` call, passing no `-i` for it (never written to `inputs.json`); a value without `@` or an unreadable file exits non-zero before resuming; `report` sets `adr: true` for the steps `contracts/workflow-steps.md` (`drive_workflow.py`) lists, matched by the step's own id, the middle segment of a qualified `<loop>:<step>:<n>` id (R14), `stderr` the step's own, running no `adr_check.ts stop`, plus, on a `touches-missing` or `verdict-unread` stop, that model step's error from `state.json` by bare id (the judge's only when this round's `adr-asked.json` names a governing record); update the module docstring, and correct the `_step_env` docstring, which states the 1.0.x resume (R8, R9, R14)
- [ ] T028 [US3] In `planner/plugin/skills/issue-spec/SKILL.md`: §2's report fields gain `adr`; steps 5 and 7 say a report with `adr: true` may come back in place of the one they expect; `## Stops` gains the one rule for every report with `adr: true` as `contracts/workflow-steps.md` (Skill) gives it, the user's ruling written with the Write tool to a scratch file and passed as `adr_ruling=@<file>`, and `step: settled-design` covering `adr-settled-design`; SKILL.md:47 is unchanged
- [ ] T043 [US3] In the root `README.md` rewrite the ADR Kit passage: the check is planner's own `adr-*` steps, run after critique over the paths the plan and `tasks.md` name, against the folders `codeworks.toml` `[shared] adr_folders` lists, with the `adr` CLI at core's `ADR_VERSION` (0.20.0, `npm install -g @adrkit/cli@0.20.0`); drop "ADR Kit's check", "0.3.0 or later" and "`docs/adr` by default"
- [ ] T029 [US3] Verify US3: `npm --prefix core test`, `npm --prefix planner test`, `python3 -m unittest discover -s planner/tests` green; run the manual end-to-end check in `specs/177-plan-adr-check/quickstart.md` (a plan contradicting planner ADR-0008 passes critique and stops at `adr-report` with the real judge, and a resume after fixing `plan.md` runs a new round over it and the `tasks.md` written again from it; renamed `../engineering` gives `COULD_NOT_RUN`)

**Checkpoint**: US3 PR merged; the plan and its tasks are checked before the run completes.

---

## Phase 5: User Story 4 (merged into US3)
Story issue: #277 (no tasks)

US4's tasks (T030–T036, T044, T048, T049) moved into Phase 4 on 2026-11-04; T034, T035 and T044 were folded into
T023, T025 and T043.

---

## Phase 6: User Story 5 - one rule for spec and record changes; reviewer reads the same list (Priority: P3)
Story issue: #278

**Blocked by**: US2 (core half); #235 (#209's US1, which creates `reviewer/plugin/lib/round/decisions.ts`) and US3's
`readRulings` (reviewer half).

**Goal**: core's `protectedPaths` names a root spec folder changed beyond TICK_ONLY (R12); reviewer checks only the
listed folders, through core, honours the rulings file, and `REVIEWER_ORG_ADR_DIR` is gone.

**Independent Test**: `npm --prefix core test` and `npm --prefix reviewer test` green, including
`core/tests/protected-paths.test.ts` and `reviewer/tests/decisions.test.ts`; `git grep REVIEWER_ORG_ADR_DIR --
':!specs'` finds nothing.

### Tests for User Story 5 (write first, see them fail)

- [ ] T050 [P] [US5] In `core/tests/tasks.test.ts` add `isTickOnly(baseText, headText, issue)` cases and in `core/tests/protected-paths.test.ts` the spec-folder cases, as `specs/177-plan-adr-check/quickstart.md`'s Protected paths table gives them; add the listed-folder cases; move every existing `protectedPaths(changed)` call to `protectedPaths(changed, {tickOnly: null, adrFolders: []})` (US5 AS6)
- [ ] T038 [P] [US5] In `reviewer/tests/decisions.test.ts` add: two listed folders (one outside the repo) and an unlisted tracked `docs/adr` → one `adr check` per listed folder, none for the unlisted (AS3); an unreadable listed folder → could not run (AS1); `REVIEWER_ORG_ADR_DIR` set changes nothing; notices still reported; a departure finding matching a rulings entry's folder, record and path dropped (AS4); an unparsable rulings file → could not run naming it; a changed record with its own `adr check` error → FAIL naming the file, rule and message, next step revert the change (AS5); remove every test of `REVIEWER_ORG_ADR_DIR`

### Implementation for User Story 5

- [ ] T051 [US5] In `core/src/contracts/tasks.ts` add pure `isTickOnly(baseText, headText, issue)` per `contracts/core.md`, reading blocks through `readTaskBlockLabels` (R12, FR-020)
- [ ] T052 [US5] In `core/src/protected-paths.ts` change the signature to `protectedPaths(changedFiles, {tickOnly, adrFolders})` and add per `contracts/core.md` the listed-folder rule (each `adrFolders` entry, from the repo root, folded case) and the root spec-folder rule (`specs/<name>`, root only, any letter case, for each changed file under it other than `tickOnly`); the comment names orchestrator ADR-0004 d4 and root ADR-0011 (R12, FR-020)
- [ ] T039 [US5] In `reviewer/plugin/lib/round/decisions.ts` take folders from `adrFolders`, run `checkAdrFolder(cwd, folder, paths, deadline)` per folder at once with reviewer's own deadline, keep reporting `notices`, read rulings through `readRulings` from the checkout's spec folder and drop every departure finding whose folder label, record id and file match an entry (`RulingsRefused`: could not run naming the file), report a broken record as FAIL with the next step "revert the change to that record; planner fixes records (root ADR-0011)"; delete tracked-`docs/adr` discovery and `REVIEWER_ORG_ADR_DIR`; read `ADR_VERSION` from core, deleting any second copy; label each folder by its entry as written, in departure lines and ruling matches alike, "outside the repo" only as wording in a message and no "org" (R10, FR-013, FR-014, FR-017, FR-020)
- [ ] T040 [US5] Remove `REVIEWER_ORG_ADR_DIR` from `reviewer/plugin/README.md` and describe the folders as `codeworks.toml` `[shared] adr_folders`, the rulings file, and a broken record's next step
- [ ] T041 [US5] Verify US5: `npm --prefix core test` and `npm --prefix reviewer test` green and `git grep REVIEWER_ORG_ADR_DIR -- ':!specs'` prints nothing (AS2, SC-005)

**Checkpoint**: one setting, no env var, names the ADR folders for planner and reviewer; one matcher tells a story's
spec or record change from its ticks.

---

## Phase 7: User Story 6 - a departure found at review reaches planner (Priority: P3)
Story issue: #285

**Blocked by**: US5 (#278); #235 and #209's T010a–T010c and T040 (reviewer half).

**Goal**: a decision-check departure is ruled FIX or ESCALATE; one ruled ESCALATE is a line of the escalation
hold's question that core renders and reads; planner's rescope takes its open decision from every open review question, the
check checks each departure's file and stops once per (folder, record, file); a ruling landing lapses every
story's round under the spec (R13).

**Independent Test**: `npm --prefix core test`, `npm --prefix planner test`, `npm --prefix reviewer test`,
`python3 -m unittest discover -s planner/tests` green for quickstart.md's US6 rows.

### Tests for User Story 6 (write first, see them fail)

- [ ] T053 [P] [US6] In `core/tests/decision-check.test.ts` add quickstart.md's departure-line rows: `readAdrDepartures(renderAdrDeparture(d))` returning `[d]`; a question with a deadlock and two departure lines reading as both; a question with none as `[]`; a line opening `ADR departure: ` with a field missing, no ` — `, an empty `what` or a non-`PATH` path throwing `DepartureRefused` naming it; `renderAdrDeparture` throwing on a folder or record with whitespace or a `what` spanning lines; `ReviewQuestions` refusing an `(issue, hold)` twice (FR-022)
- [ ] T054 [P] [US6] In `core/tests/attest.test.ts` add: the story's spec folder's `adr-rulings.json` differing between the default branch and the round's commit is in `governingDiff`; another spec folder's is not (FR-024)
- [ ] T055 [P] [US6] In `planner/tests/adr-check.test.ts` add quickstart.md's `review-questions.json` rows: a departure's path `touches.json` lacks asked all the same; a departure whose record governs its path stopping as `departure-*` with `found at review on #<issue>`; the same line in two stories' questions stopping once, naming both; the same dropped once a ruling names it; a departure whose record no longer governs its path not stopping; an unreadable file or line stopping as `questions-refused` (FR-023)
- [ ] T056 [P] [US6] Create `planner/tests/rescope-questions.test.ts` for `rescope_questions.ts` against a stand-in GitHub and state: a parent's two open sub-issues, one with an open escalation hold and one with an open verdict rescope hold, writing both questions; an issue with no sub-issues read itself; a rescope hold with a spec PR not taken; no question writing nothing, exit 0; an unreadable departure line exiting 1 naming the issue and the line; in `planner/tests/test_drive_workflow.py` add `rescope … questions=@<file>` landing `<run>/review-questions.json` and an unreadable file exiting non-zero (FR-023)
- [ ] T057 [P] [US6] After #235 and #209's T034, in `reviewer/tests/assess.test.ts` add a decision-check departure ruled PUSH_BACK or DEFER refused as inadmissible, FIX and ESCALATE accepted; in `reviewer/tests/round-record.test.ts` a round with two departures ruled ESCALATE opening `escalation-<issue>` whose question `readAdrDepartures` reads as both (FR-021, FR-022)

### Implementation for User Story 6

- [ ] T058 [US6] In `core/src/contracts/decision-check.ts` add `REVIEW_QUESTIONS_FILE`, `ReviewQuestions`, `AdrDeparture`, pure `renderAdrDeparture` and `readAdrDepartures` with `DepartureRefused` per `contracts/core.md` and `contracts/artifact-grammar.md` (T053 green)
- [ ] T059 [US6] In `core/src/attest.ts` have `governs` take `<spec folder>/adr-rulings.json` (`ADR_RULINGS_FILE`), the comment naming orchestrator ADR-0004 d1 (T054 green)
- [ ] T060 [US6] In `planner/plugin/lib/adr-check.ts` and `planner/plugin/scripts/adr_check.ts` have the check read `<run>/review-questions.json` through `ReviewQuestions` and `readAdrDepartures` (`questions-refused` row on failure): ask adds each departure's path to the paths it checks; decide calls `checkAdrFolder(cwd, folder, [path], …)` once per `(folder, record, path)`, concurrently with the ruling checks under the same `ADR_DEADLINE_MS`, and adds each departure whose record that call names as governing as a judged departure, once per key, its `what` reading `found at review on #<issue>, …: <what>; …`, before rulings are applied (R13, FR-023; T055 green)
- [ ] T061 [US6] Create `planner/plugin/scripts/rescope_questions.ts` per `contracts/workflow-steps.md`, listing sub-issues and reading state through core's `readState` as the planner App (`planner/plugin/lib/github.ts`) (T056 green)
- [ ] T062 [US6] In `planner/plugin/skills/issue-spec/scripts/drive_workflow.py` accept `rescope <spec file> <issue> <spec dir> questions=@<file>`, copying the file to `<run>/review-questions.json` once the run has started; in `planner/plugin/skills/issue-spec/SKILL.md` §1 `rescope` runs `rescope_questions.ts` into a scratch file, stopping on a non-zero exit, §2 passes it when written, and step 4 gives grill those questions as the open decision, else the admin's words (T056 green)
- [ ] T063 [US6] After #235 and #209's T047, in `reviewer/plugin/lib/round/assess.ts` refuse PUSH_BACK and DEFER for a decision-check departure (reviewer ADR-0017 d2), and in `reviewer/plugin/lib/round/record.ts` write each departure ruled ESCALATE into the escalation hold's question through `renderAdrDeparture` (ADR-0013 d4) (T057 green)
- [ ] T064 [US6] Verify US6: `npm --prefix core test`, `npm --prefix planner test`, `npm --prefix reviewer test`, `python3 -m unittest discover -s planner/tests` green

**Checkpoint**: a departure reviewer cannot fix reaches the user through planner's rescope.

---

## Phase 8: Polish & Cross-Cutting Concerns
Story issue: #278

- [ ] T042 Run every command in `specs/177-plan-adr-check/quickstart.md` once US3 has merged and confirm each expectation, recording any mismatch as a fix in the story it belongs to

---

## Dependencies & Execution Order

### Story order

- **Planning PRs**: first; amend the decision records and block every story (FR-001).
- **US2** (P1): after the planning PRs merge.
- **US3** (P1): after US2 merges (calls `adrFolders`, `checkAdrFolder`); holds US4's tasks.
- **US5** (P3): T050–T052 after US2; T038–T041 after #235 and US3 (`readRulings`, T021). `protectedPaths`'
  callers, #174 and #209 US2, pass `{tickOnly, adrFolders}` in their own stories.
- **US6** (P3): T053–T056 and T058–T062 after US5 (#278); T057 and T063 after #235, #209's T010a–T010c, T034 and T047, and T039.

### Within each story

- Tests first, failing for the expected reason, then implementation.
- US2: T008 before T009 and T010 (both read `Shared`); T011–T013 after T008.
- US3: T020 → T021 → T033 → T022 → T067 → T023; T024–T028, T049, T065 and T043 after T023; T029 last.
- US5: T051 → T052; T039 → T040 → T041.
- US6: T058 → T060; T058 → T061 → T062; T058 → T063; T059 alone; T064 last.

### Parallel Opportunities

- US2: T005, T006, T007 together; then T011, T012, T013 together.
- US3: T016, T030, T017, T031, T066, T018, T032, T019, T048 together; T024, T026, T028, T049 and T043 in parallel
  once T023 is done.
- US5: T050 and T038 together.
- US6: T053, T054, T055, T056 together; T057 after #235.

## Parallel Example: User Story 2

```text
Task: "settings.test.ts adr_folders cases in core/tests/settings.test.ts"   (T005)
Task: "adrFolders cases in core/tests/adr-folders.test.ts"                  (T006)
Task: "ported readAdrAnswer/checkAdrFolder cases in core/tests/adr.test.ts" (T007)
```

## Parallel Example: User Story 3

```text
Task: "grammar and schema cases in core/tests/decision-check.test.ts"       (T016)
Task: "stop table and round-step rows in planner/tests/adr-check.test.ts" (T017)
Task: "adr report and ADR_RULING cases in planner/tests/test_drive_workflow.py" (T018)
Task: "the check loop in planner/tests/test_plan_template.py"             (T019)
Task: "land.ts next steps in planner/tests/land.test.ts"                   (T066)
```

## Implementation Strategy

### MVP

Planning PRs → US2 → US3: plans and their tasks are checked against every listed folder before the run completes. Stop and validate with
quickstart's Planner rows and the manual end-to-end check.

### Incremental delivery

1. Planning PRs: the rules (no code; not a story).
2. US2: the list and `adr` in core; rollout reinstall named in the PR (MVP start).
3. US3: the check of the plan and its tasks (MVP complete; US4 merged into it).
4. US5: the protected spec folder in core; reviewer on the same list, after #235.
5. US6: a departure found at review reaches planner's rescope.
