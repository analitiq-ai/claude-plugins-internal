---

description: "Task list for #177: planner checks the plan against the ADR folders it is given"
---

# Tasks: planner checks the plan against the ADR folders it is given

**Input**: Design documents from `specs/177-plan-adr-check/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R11), data-model.md, contracts/ (`core.md`, `artifact-grammar.md`,
`workflow-steps.md`), quickstart.md

**Tests**: required. Constitution Principle IV (test-first) and quickstart.md name every test; each story writes its
tests first and sees them fail for the expected reason before implementing.

**Organization**: one phase per user story; one story is one PR (constitution, Delivery Workflow). PR order (R11):
US1 → US2 → US3 → US4; US5 after #235 and its own reviewer record.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5 from spec.md

---

## Phase 1: Setup
Story issue: #274

**Purpose**: the tools the tests and the manual check need (quickstart.md, Prerequisites)

- [ ] T001 Install `@adrkit/cli@0.20.0` (`npm install -g @adrkit/cli@0.20.0`), confirm `adr --version` prints `0.20.0`, and check analitiq-ai/engineering out beside this repo so `../engineering/docs/adr` exists, as `specs/177-plan-adr-check/quickstart.md` Prerequisites lists

---

## Phase 2: Foundational
Story issue: #274

None. The blocking prerequisite is US1: ADR-0009's amendment merges, in its own PR, before any code of US2–US5
(FR-001, constitution Principle VI).

---

## Phase 3: User Story 1 - ADR-0009 is amended to check the listed folders (Priority: P1) 🎯 MVP
Story issue: #274

**Goal**: the governing rule for the check ships first, alone, with no code.

**Independent Test**: read the amended record: d1 names the listed folders, d2's remote-head rule is gone, the
after-tasks check is a decision, Option C's rejection is replaced by why it is accepted; the PR diff changes no code.

- [ ] T002 [US1] Amend `planner/docs/adr/0009-check-the-plan-against-the-governing-decision-logs-before-critique.md` (R11): d1 checks the plan after plan and before critique against each folder `codeworks.toml` `[shared] adr_folders` lists, with no mention of "the repo's log", "the org log" or a remote head (US1 AS1), and a public repo lists no path to private ADRs; d2 (remote head) replaced by "the folder on disk at the listed path is checked, no network call, no credential; keeping it current is the admin's", Option C moved from rejected to accepted with that reason; a decision that the check runs again after tasks, because tasks name the paths each story touches and are written after critique; a decision naming the judge's answer set `AdrJudgment` (`WITHIN`: "the artifact sits inside the record: it does nothing the record rejected or contradicts"; `DEPARTS`: "the artifact does what the record rejected, contradicts what it chose, or breaks a consequence it commits to") and `CheckedArtifact` (`plan`, `tasks`), per root ADR-0010 d3; a decision on the user's ruling (FR-016, FR-017): rulings live only in `<spec folder>/adr-rulings.json`, the decide step is its only writer and writes only from the resume's `ADR_RULING`, a ruling applies to the resume carrying it only, neither the judge nor the driving session gives one, and spec-PR review is the check on an entry committed by hand; `affects` adds `core/src/adr.ts`, `core/src/adr-folders.ts`, `core/src/contracts/decision-check.ts`, `planner/plugin/scripts/adr_check.ts`, `planner/plugin/lib/**`, `planner/plugin/speckit/workflows/issue-spec/**`
- [ ] T003 [US1] Read `.specify/memory/constitution.md` P8's Source line (cites planner ADR-0009 decision 1); change it, with a PATCH version bump and Sync Impact Report, only if T002 renumbered or redefined decision 1, else leave the file untouched
- [ ] T004 [US1] Verify US1: `adr check --dir planner/docs/adr --json -- planner/plugin/scripts/adr_check.ts core/src/adr-folders.ts` names 0009 as governing with no broken record, and `git diff --name-only main` lists only `planner/docs/adr/0009-check-the-plan-against-the-governing-decision-logs-before-critique.md` (and `.specify/memory/constitution.md` if T003 changed it) (US1 AS2)

**Checkpoint**: US1 PR merged; US2 may start.

---

## Phase 4: User Story 2 - core reads the list of ADR folders and resolves each path (Priority: P1)
Story issue: #275

**Goal**: `[shared] adr_folders` (required, may be empty), `adrFolders` resolving each entry, and `adr` run at one
pinned version, all in core.

**Independent Test**: `npm --prefix core test` green, including `core/tests/adr-folders.test.ts` and
`core/tests/adr.test.ts` (quickstart.md, Core).

### Tests for User Story 2 (write first, see them fail)

- [ ] T005 [P] [US2] In `core/tests/settings.test.ts` add `adr_folders = []` to the TOML fixture and `adr_folders: []` to the parsed object, add `"adr_folders"` to `REQUIRED_KEYS`, and add cases: a missing key, a non-array, an empty-string entry and an entry written twice each throw `SettingsError` whose `where` is `SHARED_SECTION` and whose message names `adr_folders`; `adr_folders = []` is accepted (US2 AS4, AS5)
- [ ] T006 [P] [US2] Create `core/tests/adr-folders.test.ts`: a scratch repo built with core's `runGit`, a worktree at `../<repo>.worktrees/<branch>`, an `org/docs/adr` folder beside the repo, `docs/adr` committed with a record only the worktree's branch adds, an absolute folder, a missing one and one `chmod 000`; assert `adrFolders(checkout, shared)` returns `{entry, path, inside, readable}` per entry in list order: `../org/docs/adr` resolves to the same absolute path from main checkout and worktree with `inside: false` (AS1); `docs/adr` resolves to each checkout's own folder with `inside: true` (AS2); missing, unreadable and a path that is a file are `readable: false` naming the entry as written and its resolved path, others unchanged (AS3, Edge Cases); `docs/adr` plus the absolute path of the same folder throws `SettingsError` on `SHARED_SECTION` naming both entries (Edge Cases); `adr_folders: []` returns `[]` (AS5); called from the main checkout itself, resolution is the same (Edge Cases); a cwd outside any git repo throws `GitFailed`
- [ ] T007 [P] [US2] Create `core/tests/adr.test.ts`: `readAdrAnswer` on adrkit 0.20.0 answers ported from `reviewer/plugin/scripts/adrkit.py` `parse`/`_outcome` (ok; exit 1 with an error finding → `broken` entry `{file, id?, rule, message}`; malformed → throws `AdrAnswerUnread`); `checkAdrFolder` with a stand-in `adr` script first on `PATH`: absent from `PATH`, `--version` printing `0.19.0`, exit 3, exit 1 with non-JSON stdout, a `marker-scan-capped` or `marker-declarations-capped` finding each return `COULD_NOT_RUN` (never an answer, never a throw) whose reason ends with a next step (`ADR_INSTALL` for missing/version); an in-repo folder is passed to `adr check --dir` relative to `cwd`, an outside one absolute; args are `check --dir <folder> --json -- <paths>`

### Implementation for User Story 2

- [ ] T008 [US2] In `core/src/settings.ts` add to `Shared` `adr_folders: z.array(z.string().min(1))`, required, refusing an entry written twice with the same refusal `validators` uses; move that `superRefine` into one local helper both keys call rather than copying it (R1, FR-002)
- [ ] T009 [US2] Create `core/src/adr-folders.ts` per `contracts/core.md`: `export type ResolvedAdrFolder = { entry; path; inside; readable }` and `adrFolders(checkout, shared)`; absolute entry as written; relative entry joined to the parent of `git rev-parse --path-format=absolute --git-common-dir` and normalised, and if that lies inside the main checkout, re-rooted at the same repo path under `git rev-parse --show-toplevel` of `checkout`; `readable` = a directory with read and search access (`fs.access` `R_OK | X_OK` plus `isDirectory`); two entries whose path (realpath where it exists) is one folder → `SettingsError(SHARED_SECTION, …)` naming both; git only through `runGit` (`core/src/git.ts`); no env var read, no network call (R2, FR-004, FR-005)
- [ ] T010 [US2] Create `core/src/adr.ts` per `contracts/core.md`: `ADR_VERSION = "0.20.0"`, `ADR_INSTALL`, `AdrAnswer`, `AdrAnswerUnread`, pure `readAdrAnswer(raw, ok)` and `checkAdrFolder(cwd, folder, paths)` ported from `reviewer/plugin/scripts/adrkit.py` `check`/`parse`/`_outcome`: `adr --version` must print `ADR_VERSION`; `adr check --dir <folder> --json -- ...paths` run from `cwd`, folder relative when `folder.inside`; exit 0/1 with readable JSON is an answer, anything else and each capped-scan rule is `couldNotRun(folder.entry, …)` (`core/src/outcomes.ts`) ending with the next step; no deadline (R3, FR-013)
- [ ] T011 [P] [US2] Add `adr_folders: []` to every typed `Shared` literal so `tsc -p core` passes: `core/tests/fixtures/state/issue.ts`, `core/tests/could-not-run.test.ts`, `core/tests/threads.test.ts`, `core/tests/required-checks.test.ts`, `core/tests/contract.test.ts`, `core/tests/state-read.test.ts`
- [ ] T012 [P] [US2] Add `adr_folders = []` to the `[shared]` TOML in `planner/tests/support/checkout.ts` and `planner/tests/token.test.ts` (R1)
- [ ] T013 [P] [US2] Add `adr_folders` (`[]` / `adr_folders = []`) to `orchestrator/tests/support/story.ts` (`SHARED`) and `orchestrator/tests/support/checkout.ts` (`SHARED` TOML) (R1)
- [ ] T014 [US2] In `codeworks.toml` `[shared]` add `adr_folders = ["docs/adr", "planner/docs/adr", "reviewer/docs/adr", "builder/docs/adr", "orchestrator/docs/adr", "auditor/docs/adr", "../engineering/docs/adr"]` (R1, FR-003)
- [ ] T015 [US2] Verify US2: `npm --prefix core test`, `npm --prefix planner test`, `npm --prefix orchestrator test` green; the PR body states the rollout (critique E8): `Shared` is strict, so after merge the agent machine and the admin's machine reinstall at once, and every other repo with a `codeworks.toml` gains `adr_folders = []` in step

**Checkpoint**: US2 PR merged; US3 may start.

---

## Phase 5: User Story 3 - planner checks the plan before critique (Priority: P1)
Story issue: #276

**Goal**: workflow steps `adr-plan-ask` → `adr-plan-judge` → `adr-plan-decide` between `to-settled-design` and
`to-mark-critiques`; a script decides each folder's outcome from the judge's verdict; every stop goes through
`adrStop`; the user can overrule a departure on resume.

**Independent Test**: `node --test planner/tests/adr-check.test.ts` and
`python3 -m unittest discover -s planner/tests -p 'test_drive_workflow.py'` green for every plan row of
quickstart.md's table; the manual end-to-end check in quickstart.md stops at `adr-plan-decide`.

### Tests for User Story 3 (write first, see them fail)

- [ ] T016 [P] [US3] Create `core/tests/decision-check.test.ts`: `artifactPath` against `^[A-Za-z0-9._-]+(/[A-Za-z0-9._{},-]+)*$` with no `.` or `..` segment: one `{a,b}` group expanded, a second group refused, a no-`/` span returned only when `rootFiles` holds it or is `"any"`, a glob or trailing `/` refused; `readTouches`: bullets `` - `<PATH>` `` under `## Touches` read with their line, prose lines ignored, a `- ` line not in that form throws `TouchesRefused` naming `plan.md:<line>`, no heading or no bullet is could not run naming `plan.md` and that the plan template's `## Touches` section must be added (critique P2); `AdrVerdict`: `v: 1`, `judgment` from `AdrJudgment`, `paths` non-empty for `DEPARTS` and empty for `WITHIN`, `why` non-empty; `AdrRuling`: four non-empty strings, no other key; `AdrRulings`: `{v: 1, rulings}` with no `(folder, record, path)` twice; `readRulings`: absent file → `[]`, unparsable → `RulingsRefused`
- [ ] T017 [P] [US3] Create `planner/tests/adr-check.test.ts`: unit cases for the pure `decideFolder`, `decideCheck`, `adrStop` (line form `<label>: <FAIL|COULD_NOT_RUN>: <what>. Next step: <next>.`; exit 2 when any `COULD_NOT_RUN`, else 1 when any `FAIL`, else 0) and `changedSince`; then drive `node planner/plugin/scripts/adr_check.ts ask plan …` and `decide plan …` in a scratch checkout (`planner/tests/support/checkout.ts`) with a stand-in `adr` on `PATH` and a verdict file the test writes in the judge's place, one case per plan row of `specs/177-plan-adr-check/quickstart.md` Planner table: all `WITHIN` → exit 0 with governing ids (US3 AS1); one `DEPARTS` → exit 1 naming folder, record, path and next steps (AS2); missing folder / `adr` absent / verdict missing a record → exit 2 with other folders still printed (AS3); `ADR_RULING` cases (valid → exit 0 and `adr-rulings.json` plus `<run>/adr-rulings-written.json` gain it, valid without a matching departure still appended, unlisted folder or unasked path → exit 1, record governing only another asked path → exit 1, already present → file unchanged) (AS5); a rulings-file entry honoured on rerun (AS6); an entry neither at `HEAD` nor in the run record → exit 2 (AS7); asked record or `## Touches` changed between ask and decide → exit 2 naming what changed (FR-019); empty `## Touches` → exit 2; `adr_folders = []` → exit 0 printing `No ADR folder is listed in codeworks.toml [shared] adr_folders.`; ask removes a stale `<run>/adr-plan-verdict.json`; ask prints `{"judge", "asked"}` with `judge: false` when nothing governs; `stop plan judge` prints the judge's could-not-run line and exits 2
- [ ] T018 [P] [US3] In `planner/tests/test_drive_workflow.py` add cases with stand-in `claude` and `adr`: a run stops at `adr-plan-decide` before `mark-critiques`; `resume <run> adr_ruling=[…]` sets `ADR_RULING` for that `specify resume` only and `inputs.json` gains no `adr_ruling`; an ask grammar stop and an ask guard stop each report `adr: true` with their stderr lines; a judge that fails and one that times out report `adr: true` with `adr_check.ts stop plan judge`'s line; a decide stop reports `adr: true`
- [ ] T019 [P] [US3] In `planner/tests/test_plan_template.py` assert `planner/plugin/speckit/presets/settled-design/templates/plan-template.md` has a `## Touches` section whose example bullets are `` - `<path>` `` and whose instruction says one bullet per file created, changed or deleted, no glob, no trailing `/`, no `..`

### Implementation for User Story 3

- [ ] T020 [US3] In `core/src/values.ts` add `AdrJudgment` and `CheckedArtifact` exactly as `specs/177-plan-adr-check/contracts/core.md` gives them, each with a comment naming its owner, planner ADR-0009 (root ADR-0010)
- [ ] T021 [US3] Create `core/src/contracts/decision-check.ts` per `contracts/core.md` and `contracts/artifact-grammar.md`: `ADR_RULINGS_FILE = "adr-rulings.json"`, `ArtifactPath` (`{path, line, story}`), pure `artifactPath(span, rootFiles)`, pure `readTouches(planText)` (passes `"any"`) with `TouchesRefused`, Zod `AdrVerdict`, `AdrRuling`, `AdrRulings` (no key twice), `readRulings(specDir)` with `RulingsRefused` (R4, R7, R9, FR-012)
- [ ] T022 [US3] Create `planner/plugin/lib/adr-check.ts`, pure: `FolderOutcome` (`{entry, outcome: CheckOutcome, governing, departures: {record, path, story?, why}[], broken, reason}`), `decideFolder` (`COULD_NOT_RUN` for unreadable / `adr` could not run / verdict unreadable or missing a governing record or naming one not governing or a path not asked, else `FAIL` for a broken record or a `DEPARTS` no rulings entry names, else `PASS`), `decideCheck`, `AdrStop` and `adrStop` mapping folder outcomes, a refused artifact or rulings line, a guard difference, and a judge that did not answer to lines and exit (R8, FR-018), and `changedSince(recorded, now) → {added, removed}` (R9); each next step as `contracts/workflow-steps.md` shows
- [ ] T023 [US3] Create `planner/plugin/scripts/adr_check.ts` (I/O only, imports `../lib/guarded.ts` first like `planner/plugin/scripts/spec_facts.ts`) with `ask plan <spec folder> <run folder>`, `decide plan <spec folder> <run folder> <asked digest>`, `stop plan judge` per `contracts/workflow-steps.md`: settings through `readPlannerSettings` (`planner/plugin/lib/settings.ts`); ask removes `<run>/adr-plan-verdict.json`, reads `## Touches`, runs the writer guard (rulings file vs. the file at `HEAD` and `<run>/adr-rulings-written.json`), calls `adrFolders` and `checkAdrFolder` per readable folder, writes `<run>/adr-plan-asked.json` (`{v: 1, artifact, paths, folders}`), prints `{"judge": <bool>, "asked": "<sha256>"}`; decide re-runs the guard, compares the asked record's sha256 with `<asked digest>` and re-read paths with the recorded ones, reads the verdict when judged and `ADR_RULING`, validates each new ruling (folder listed, path asked, one `checkAdrFolder(folder, [path])` naming the record; could-not-run there → exit 2), appends valid new ones to `<spec folder>/adr-rulings.json` and `<run>/adr-rulings-written.json`, drops departures a ruling names, decides and prints through `adrStop`; every stop through `adrStop`, none formatted locally (FR-007–FR-011, FR-016–FR-019)
- [ ] T024 [US3] Create `planner/plugin/speckit/workflows/issue-spec/adr-judge.md`: given artifact, spec folder and run folder, read `<run>/adr-<a>-asked.json`, the artifact, `<spec folder>/adr-rulings.json` and each governing record's file; judge each governing record as `reviewer/plugin/agents/decision-reviewer.md` defines a departure, naming none a rulings entry already rules on; write `<run>/adr-<a>-verdict.json` per `AdrVerdict` (one verdict per governing record per folder, `paths` only from the asked paths); write no other file; give no ruling (R7, FR-015)
- [ ] T025 [US3] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` bump `version` to `1.7.0` and add the `to-adr-plan` `if` block on `*spec-is-written` after `to-settled-design` and before `to-mark-critiques`, holding `adr-plan-ask` (shell, `output_format: json`, `timeout: 1800`), `adr-plan-judging` (`if` on `steps.adr-plan-ask.output.data.judge`) holding `adr-plan-judge` (`type: prompt`, `timeout: 1800`, prompt naming `.specify/workflows/issue-spec/adr-judge.md`), and `adr-plan-decide` (shell, passing `steps.adr-plan-ask.output.data.asked`), exactly as `contracts/workflow-steps.md` gives them; no new input (R6, FR-006)
- [ ] T026 [US3] In `planner/plugin/speckit/presets/settled-design/templates/plan-template.md` add a `## Touches` section after `## Mechanisms`, with the bullet grammar and one instruction line per `contracts/artifact-grammar.md` (R4)
- [ ] T027 [US3] In `planner/plugin/skills/issue-spec/scripts/drive_workflow.py`: `resume <run> adr_ruling=<json>` exports `ADR_RULING=<json>` in the env of that one `specify resume` call and passes no `-i` for it (never written to `inputs.json`); `report` sets `adr: true` when the failed step is any `adr-{plan,tasks}-{ask,judge,decide}`, and for a judge step sets `stderr` to what `node "$PLANNER_ROOT/scripts/adr_check.ts" stop <a> judge` prints; update the module docstring (R8, R9)
- [ ] T028 [US3] In `planner/plugin/skills/issue-spec/SKILL.md` `## Stops` add the one rule for every report with `adr: true` as `contracts/workflow-steps.md` (Skill stop) gives it: show every stderr line; FAIL naming a departure → user picks change the artifact, draft a superseding record with `/speckit-adrkit-draft` into the component's `docs/adr`, or rule, and resume with `adr_ruling=[…]` only with the user's reason in their words; other FAIL → change the artifact; COULD_NOT_RUN → user fixes what the line names (judge: nothing), resume once they say it is done
- [ ] T029 [US3] Verify US3: `npm --prefix core test`, `npm --prefix planner test`, `python3 -m unittest discover -s planner/tests` green; run the manual end-to-end check in `specs/177-plan-adr-check/quickstart.md` (a plan contradicting planner ADR-0008 stops at `adr-plan-decide` with the real judge, critique P4; renamed `../engineering` gives `COULD_NOT_RUN`)

**Checkpoint**: US3 PR merged; plans are checked before critique.

---

## Phase 6: User Story 4 - planner checks the tasks again (Priority: P2)
Story issue: #277

**Goal**: the same ask → judge → decide block after `to-tasks`, over the paths `tasks.md` names, each departure
naming its story.

**Independent Test**: `planner/tests/adr-check.test.ts` tasks rows: a `[US2]` task naming a governed path stops
naming the record, path and `US2`.

### Tests for User Story 4 (write first, see them fail)

- [ ] T030 [P] [US4] In `core/tests/tasks.test.ts` add `readTaskPaths(tasksText, rootFiles)` cases: `- [ ] T<n>` and `- [x]`/`- [X]` lines read; backticked spans with `/` are paths; `` `codeworks.toml` `` is a path when `rootFiles` holds it, `` `adr check` `` is not; a second `{…}` group throws naming `tasks.md:<line>`; story is `US<k>` from `[US<k>]`, else the `## Phase` heading text; non-task lines ignored
- [ ] T031 [P] [US4] In `planner/tests/adr-check.test.ts` add tasks rows from `specs/177-plan-adr-check/quickstart.md`: a task tagged with story US2 naming a governed path with a `DEPARTS` verdict → exit 1 naming record, path and `story US2` (US4 AS1); missing folder → exit 2 (AS2); a `tasks.md` naming no path → exit 2 naming `tasks.md`; a ruling written at the plan check is honoured at the tasks check with no `ADR_RULING` set (US3 AS6)
- [ ] T032 [P] [US4] In `planner/tests/test_drive_workflow.py` add: after a plan-check resume carrying `adr_ruling`, the after-tasks check runs without `ADR_RULING`; a rescope run (starts at grill) runs both `adr-plan-*` and `adr-tasks-*`

### Implementation for User Story 4

- [ ] T033 [US4] In `core/src/contracts/tasks.ts` add `readTaskPaths(tasksText, rootFiles): ArtifactPath[]` beside `readTaskBlockLabels`, each backticked span through `artifactPath` from `core/src/contracts/decision-check.ts`, story from `[US<k>]` else the phase heading via `isPhaseHeading` (R5, FR-012)
- [ ] T034 [US4] In `planner/plugin/scripts/adr_check.ts` accept artifact `tasks`: ask reads `<spec folder>/tasks.md` through `readTaskPaths` with `rootFiles` from `git ls-files` entries with no `/`, writes `<run>/adr-tasks-asked.json`; decide carries each departure's story so `adrStop` prints `(story US<k>)` and names `tasks.md` as the artifact to change; `stop tasks judge`
- [ ] T035 [US4] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` add the `to-adr-tasks` block after `to-tasks`: `adr-tasks-ask`, `adr-tasks-judging` / `adr-tasks-judge`, `adr-tasks-decide`, the same as `to-adr-plan` with `tasks` (R6, FR-006)
- [ ] T036 [US4] Verify US4: `npm --prefix core test`, `npm --prefix planner test`, `python3 -m unittest discover -s planner/tests` green

**Checkpoint**: US4 PR merged; tasks are checked before the spec PR.

---

## Phase 7: User Story 5 - reviewer's decision check reads the same list (Priority: P3)
Story issue: #278

**Blocked by**: #235 (#209's US1, which creates `reviewer/plugin/lib/round/decisions.ts`) and US2.

**Goal**: reviewer checks only the listed folders, through core, honours the rulings file, and
`REVIEWER_ORG_ADR_DIR` is gone.

**Independent Test**: `npm --prefix reviewer test` green including `reviewer/tests/decisions.test.ts`;
`git grep REVIEWER_ORG_ADR_DIR -- ':!specs'` finds nothing.

- [ ] T037 [US5] In its own PR before any US5 code (FR-001, R11), draft with `/speckit-adrkit-draft` the reviewer record `reviewer/docs/adr/<next free number>-check-only-the-listed-adr-folders-and-honour-a-recorded-ruling.md` (working name 0022; take the next free number at draft time, after checking #209/#235's open PRs for reviewer records): the decision check checks only `[shared] adr_folders` folders via core, a folder outside the repo is labelled by its entry, and a departure an entry of the spec folder's `adr-rulings.json` names is not reported

### Tests for User Story 5 (write first, see them fail)

- [ ] T038 [P] [US5] In `reviewer/tests/decisions.test.ts` add: two listed folders (one outside the repo) and an unlisted tracked `docs/adr` → one `adr check` per listed folder, none for the unlisted (AS3); an unreadable listed folder → could not run (AS1); `REVIEWER_ORG_ADR_DIR` set changes nothing; an entry in the spec folder's `adr-rulings.json` silences its departure (AS4); remove every test of `REVIEWER_ORG_ADR_DIR`

### Implementation for User Story 5

- [ ] T039 [US5] In `reviewer/plugin/lib/round/decisions.ts` take folders from `adrFolders`, run `checkAdrFolder` per readable one, make an unreadable one could not run, read rulings through `readRulings` and report no departure an entry names; delete tracked-`docs/adr` discovery and `REVIEWER_ORG_ADR_DIR`; read `ADR_VERSION` from core, deleting any second copy; label each folder by its entry, "org" becoming "outside the repo"; keep reviewer's own deadline (R10, FR-013, FR-014, FR-017)
- [ ] T040 [US5] Remove `REVIEWER_ORG_ADR_DIR` from `reviewer/plugin/README.md` and describe the folders as `codeworks.toml` `[shared] adr_folders`
- [ ] T041 [US5] Verify US5: `npm --prefix reviewer test` green and `git grep REVIEWER_ORG_ADR_DIR -- ':!specs'` prints nothing (AS2, SC-005)

**Checkpoint**: one setting, no env var, names the ADR folders for planner and reviewer.

---

## Phase 8: Polish & Cross-Cutting Concerns
Story issue: #278

- [ ] T042 Run every command in `specs/177-plan-adr-check/quickstart.md` once US4 has merged and confirm each expectation, recording any mismatch as a fix in the story it belongs to

---

## Dependencies & Execution Order

### Story order

- **US1** (P1): first; blocks every other story (FR-001).
- **US2** (P1): after US1 merges.
- **US3** (P1): after US2 merges (calls `adrFolders`, `checkAdrFolder`).
- **US4** (P2): after US3 merges (extends `adr_check.ts` and `workflow.yml`; reuses `artifactPath`).
- **US5** (P3): after US2, #235 and T037's record merge; independent of US3/US4 except `readRulings`
  (`core/src/contracts/decision-check.ts`, T021), so it also waits for US3.

### Within each story

- Tests first, failing for the expected reason, then implementation.
- US2: T008 before T009 and T010 (both read `Shared`); T011–T013 after T008.
- US3: T020 → T021 → T022 → T023; T024–T028 after T023; T029 last.
- US4: T033 → T034 → T035 → T036.

### Parallel Opportunities

- US2: T005, T006, T007 together; then T011, T012, T013 together.
- US3: T016, T017, T018, T019 together; T024, T026 and T028 in parallel once T023 is done.
- US4: T030, T031, T032 together.
- US5: T038 alongside T037's review.

## Parallel Example: User Story 2

```text
Task: "settings.test.ts adr_folders cases in core/tests/settings.test.ts"   (T005)
Task: "adrFolders cases in core/tests/adr-folders.test.ts"                  (T006)
Task: "readAdrAnswer/checkAdrFolder cases in core/tests/adr.test.ts"        (T007)
```

## Parallel Example: User Story 3

```text
Task: "grammar and schema cases in core/tests/decision-check.test.ts"       (T016)
Task: "pure rules and ask/decide rows in planner/tests/adr-check.test.ts"   (T017)
Task: "adr report and ADR_RULING cases in planner/tests/test_drive_workflow.py" (T018)
Task: "Touches section in planner/tests/test_plan_template.py"              (T019)
```

## Implementation Strategy

### MVP

US1 → US2 → US3: plans are checked before critique against every listed folder. Stop and validate with quickstart's
Planner rows and the manual end-to-end check.

### Incremental delivery

1. US1: the rule (no code).
2. US2: the list and `adr` in core; rollout reinstall named in the PR.
3. US3: the check after plan (MVP).
4. US4: the check after tasks.
5. US5: reviewer on the same list, after #235.
