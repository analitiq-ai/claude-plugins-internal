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
the planning PR (decision records, no code) → US2 → US3 → US4; US5 after #235. US1 was
moved into the planning PR on 2026-11-03; ADRs and specs are written in planning only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US2–US5 from spec.md

---

## Phase 1: Setup
Story issue: #275

**Purpose**: the tools the tests and the manual check need (quickstart.md, Prerequisites)

- [ ] T001 Install `@adrkit/cli@0.20.0` (`npm install -g @adrkit/cli@0.20.0`), confirm `adr --version` prints `0.20.0`, and check analitiq-ai/engineering out beside this repo so `../engineering/docs/adr` exists, as `specs/177-plan-adr-check/quickstart.md` Prerequisites lists

---

## Phase 2: Foundational
Story issue: #275

None. The blocking prerequisite is the planning PR merging: it amends planner ADR-0009, reviewer ADR-0013 and
orchestrator ADR-0002 and adds root ADR-0011 "planner alone creates and edits spec folders and decision records",
before any code of US2–US5 (FR-001, constitution Principle VI).

---

## Phase 3: User Story 2 - core reads the list of ADR folders and resolves each path (Priority: P1) 🎯 MVP
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

## Phase 4: User Story 3 - planner checks the plan before critique (Priority: P1)
Story issue: #276

**Goal**: workflow steps `adr-plan-ask` → `adr-plan-judge` → `adr-plan-decide` between `to-settled-design` and
`to-mark-critiques`; a script decides each folder's outcome from the judge's verdict; every stop goes through
`adrStop`; the user can overrule a departure on resume.

**Independent Test**: `node --test planner/tests/adr-check.test.ts` and
`python3 -m unittest discover -s planner/tests -p 'test_drive_workflow.py'` green for every plan row of
quickstart.md's table; the manual end-to-end check in quickstart.md stops at `adr-plan-decide`.

### Tests for User Story 3 (write first, see them fail)

- [ ] T016 [P] [US3] Create `core/tests/decision-check.test.ts`: `artifactPath` against `^[A-Za-z0-9._-]+(/[A-Za-z0-9._{},-]+)*$` with no `.` or `..` segment: one `{a,b}` group expanded, a second group refused, a no-`/` span returned only when `rootFiles` holds it or is `"any"`, a glob or trailing `/` refused; `readTouchedPaths`: `{"v": 1, "paths": [...]}` read with each entry's 1-based index as `line`; an extra or missing key, `v` other than `1`, an entry not a `PATH` or an entry twice throws `TouchesRefused` naming `touches.json` and the entry; `paths: []` returns `[]` (the script makes it could not run); `AdrVerdict`: `v: 1`, `judgment` from `AdrJudgment`, `paths` non-empty for `DEPARTS` and empty for `WITHIN`, `why` non-empty; `AdrRuling`: four non-empty strings, no other key; `AdrRulings`: `{v: 1, rulings}` with no `(folder, record, path)` twice; `readRulings`: absent file → `[]`, unparsable → `RulingsRefused`
- [ ] T017 [P] [US3] Create `planner/tests/adr-check.test.ts`: unit cases for the pure `decideFolder`, `decideCheck`, `adrStop` (line form `<label>: <FAIL|COULD_NOT_RUN>: <what>. Next step: <next>.`; exit 2 when any `COULD_NOT_RUN`, else 1 when any `FAIL`, else 0) and `changedSince`; then drive `node planner/plugin/scripts/adr_check.ts ask plan …` and `decide plan …` in a scratch checkout (`planner/tests/support/checkout.ts`) with a stand-in `adr` on `PATH` and a verdict file the test writes in the judge's place, a `<run>/touches.json` the test writes in the plan step's place, one case per plan row of `specs/177-plan-adr-check/quickstart.md` Planner table: all `WITHIN` → exit 0 with governing ids (US3 AS1); one `DEPARTS` → exit 1 naming folder, record, path and next steps (AS2); missing folder / `adr` absent / verdict missing a record → exit 2 with other folders still printed (AS3); `ADR_RULING` cases (valid → exit 0 and `adr-rulings.json` plus `<run>/adr-rulings-written.json` gain it, valid without a matching departure still appended, unlisted folder or unasked path → exit 1, record governing only another asked path → exit 1, already present → file unchanged) (AS5); a rulings-file entry honoured on rerun (AS6); an entry neither at `HEAD` nor in the run record → exit 2 (AS7); asked record or `touches.json` changed between ask and decide → exit 2 naming what changed (FR-019); `touches.json` missing or `paths: []` → exit 2 naming `touches.json`; `touches.json` unparsable or wrong shape → exit 1 naming `touches.json`; `adr_folders = []` → exit 0 printing `No ADR folder is listed in codeworks.toml [shared] adr_folders.`; `adr_folders = []` and no `touches.json` → ask prints `judge: false` reading no path and decide exits 0 (FR-008); a `DEPARTS` from a record in a folder outside the repo → exit 1 whose next step is "change record <id> in the repo that holds <folder>", not drafting into the spec PR (AS2); a governing record with its own `adr check` error → exit 1 naming the record file, adrkit's rule and message, next step "fix that record" (AS8); ask removes a stale `<run>/adr-plan-verdict.json`; ask prints `{"judge", "asked"}` with `judge: false` when nothing governs; `stop plan judge` prints the judge's could-not-run line and exits 2
- [ ] T018 [P] [US3] In `planner/tests/test_drive_workflow.py` add cases with stand-in `claude` and `adr`: a run stops at `adr-plan-decide` before `mark-critiques`; `resume <run> adr_ruling=[…]` sets `ADR_RULING` for that `specify resume` only and `inputs.json` gains no `adr_ruling`; an ask grammar stop and an ask guard stop each report `adr: true` with their stderr lines; a judge that fails and one that times out report `adr: true` with `adr_check.ts stop plan judge`'s line; a decide stop reports `adr: true`
- [ ] T019 [P] [US3] In `planner/tests/test_plan_template.py` assert `planner/plugin/speckit/presets/settled-design/commands/speckit.plan.md` tells the model to write `<run folder>/touches.json` as `{"v": 1, "paths": [...]}`, one entry per file created, changed or deleted, no glob, no trailing `/`, no `..`, and that `planner/plugin/speckit/workflows/issue-spec/workflow.yml`'s `plan` step passes `Run folder: .specify/workflows/runs/{{ context.run_id }}` in `input.args`; assert the plan template has no `## Touches` section

### Implementation for User Story 3

- [ ] T020 [US3] In `core/src/values.ts` add `AdrJudgment` and `CheckedArtifact` exactly as `specs/177-plan-adr-check/contracts/core.md` gives them, each with a comment naming its owner, planner ADR-0009 (root ADR-0010)
- [ ] T021 [US3] Create `core/src/contracts/decision-check.ts` per `contracts/core.md` and `contracts/artifact-grammar.md`: `ADR_RULINGS_FILE = "adr-rulings.json"`, `ArtifactPath` (`{path, line, story}`), pure `artifactPath(span, rootFiles)`, `TOUCHES_FILE = "touches.json"`, Zod `TouchedPaths`, pure `readTouchedPaths(json)` (passes `"any"`) with `TouchesRefused`, Zod `AdrVerdict`, `AdrRuling`, `AdrRulings` (no key twice), `readRulings(specDir)` with `RulingsRefused` (R4, R7, R9, FR-012)
- [ ] T022 [US3] Create `planner/plugin/lib/adr-check.ts`, pure: `FolderOutcome` (`{entry, outcome: CheckOutcome, governing, departures: {record, path, story?, why}[], broken, reason}`), `decideFolder` (`COULD_NOT_RUN` for unreadable / `adr` could not run / verdict unreadable or missing a governing record or naming one not governing or a path not asked, else `FAIL` for a broken record or a `DEPARTS` no rulings entry names, else `PASS`), `decideCheck`, `AdrStop` and `adrStop` mapping folder outcomes, a refused artifact or rulings line, a guard difference, and a judge that did not answer to lines and exit (R8, FR-018), and `changedSince(recorded, now) → {added, removed}` (R9); each next step as `contracts/workflow-steps.md` shows: a departure's change the artifact, supersede the record ("draft a superseding record into the spec PR" when the folder is `inside`, else "change record <id> in the repo that holds <folder>") or rule; a broken record's line names the record file and adrkit's rule and message, next step "fix that record"
- [ ] T023 [US3] Create `planner/plugin/scripts/adr_check.ts` (I/O only, imports `../lib/guarded.ts` first like `planner/plugin/scripts/spec_facts.ts`) with `ask plan <spec folder> <run folder>`, `decide plan <spec folder> <run folder> <asked digest>`, `stop plan judge` per `contracts/workflow-steps.md`: settings through `readPlannerSettings` (`planner/plugin/lib/settings.ts`); settings first: on an empty `adr_folders` ask writes an asked record with no paths and prints `judge: false` without reading `touches.json`, and decide prints the none-listed line and exits 0; ask removes `<run>/adr-plan-verdict.json`, reads `<run>/touches.json` through `readTouchedPaths` (missing or empty: could not run naming `touches.json`; unparsable: refused), runs the writer guard (rulings file vs. the file at `HEAD` and `<run>/adr-rulings-written.json`), calls `adrFolders` and `checkAdrFolder` per readable folder, writes `<run>/adr-plan-asked.json` (`{v: 1, artifact, paths, folders}`), prints `{"judge": <bool>, "asked": "<sha256>"}`; decide re-runs the guard, compares the asked record's sha256 with `<asked digest>` and the re-read `touches.json` paths with the recorded ones, reads the verdict when judged and `ADR_RULING`, validates each new ruling (folder listed, path asked, one `checkAdrFolder(folder, [path])` naming the record; could-not-run there → exit 2), appends valid new ones to `<spec folder>/adr-rulings.json` and `<run>/adr-rulings-written.json`, drops departures a ruling names, decides and prints through `adrStop`; every stop through `adrStop`, none formatted locally (FR-007–FR-011, FR-016–FR-019)
- [ ] T024 [US3] Create `planner/plugin/speckit/workflows/issue-spec/adr-judge.md`: given artifact, spec folder and run folder, read `<run>/adr-<a>-asked.json`, the artifact, `<spec folder>/adr-rulings.json` and each governing record's file; judge each governing record as `reviewer/plugin/agents/decision-reviewer.md` defines a departure, naming none a rulings entry already rules on; write `<run>/adr-<a>-verdict.json` per `AdrVerdict` (one verdict per governing record per folder, `paths` only from the asked paths); write no other file; give no ruling (R7, FR-015)
- [ ] T025 [US3] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` bump `version` to `1.7.0` and add the `to-adr-plan` `if` block on `*spec-is-written` after `to-settled-design` and before `to-mark-critiques`, holding `adr-plan-ask` (shell, `output_format: json`, `timeout: 1800`), `adr-plan-judging` (`if` on `steps.adr-plan-ask.output.data.judge`) holding `adr-plan-judge` (`type: prompt`, `timeout: 1800`, prompt naming `.specify/workflows/issue-spec/adr-judge.md`), and `adr-plan-decide` (shell, passing `steps.adr-plan-ask.output.data.asked`), exactly as `contracts/workflow-steps.md` gives them; no new input (R6, FR-006)
- [ ] T026 [US3] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` append `\n\nRun folder: .specify/workflows/runs/{{ context.run_id }}` to the `plan` step's `input.args`, as the `specify` step passes its premise report; in `planner/plugin/speckit/presets/settled-design/commands/speckit.plan.md` tell the model to write `<run folder>/touches.json` in the grammar `contracts/artifact-grammar.md` gives, one entry per file the plan creates, changes or deletes, and nothing about it in `plan.md`; the plan template is not changed (R4, FR-012)
- [ ] T027 [US3] In `planner/plugin/skills/issue-spec/scripts/drive_workflow.py`: `resume <run> adr_ruling=<json>` exports `ADR_RULING=<json>` in the env of that one `specify resume` call and passes no `-i` for it (never written to `inputs.json`); `report` sets `adr: true` when the failed step is any `adr-{plan,tasks}-{ask,judge,decide}`, and for a judge step sets `stderr` to what `node "$PLANNER_ROOT/scripts/adr_check.ts" stop <a> judge` prints; update the module docstring (R8, R9)
- [ ] T028 [US3] In `planner/plugin/skills/issue-spec/SKILL.md` `## Stops` add the one rule for every report with `adr: true` as `contracts/workflow-steps.md` (Skill stop) gives it: show every stderr line; FAIL naming a departure → user picks change the artifact, supersede the record (draft a superseding record with `/speckit-adrkit-draft` into the spec PR when its folder is inside this repo, or change record <id> in the repo that holds <folder> when it is outside), or rule, and resume with `adr_ruling=[…]` only with the user's reason in their words; FAIL naming a record file with adrkit's rule and message → fix that record, then resume; a refused artifact line → change the artifact; COULD_NOT_RUN → user fixes what the line names (judge: nothing), resume once they say it is done
- [ ] T043 [US3] In the root `README.md` rewrite the ADR Kit passage (lines ~62-76): the plan check is planner's own `adr-plan-*` steps, run after plan and before critique, against the folders `codeworks.toml` `[shared] adr_folders` lists, with the `adr` CLI at core's `ADR_VERSION` (0.20.0, `npm install -g @adrkit/cli@0.20.0`); drop "ADR Kit's check", "0.3.0 or later" and "`docs/adr` by default"
- [ ] T029 [US3] Verify US3: `npm --prefix core test`, `npm --prefix planner test`, `python3 -m unittest discover -s planner/tests` green; run the manual end-to-end check in `specs/177-plan-adr-check/quickstart.md` (a plan contradicting planner ADR-0008 stops at `adr-plan-decide` with the real judge, critique P4; renamed `../engineering` gives `COULD_NOT_RUN`)

**Checkpoint**: US3 PR merged; plans are checked before critique.

---

## Phase 5: User Story 4 - planner checks the tasks again (Priority: P2)
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
- [ ] T034 [US4] In `planner/plugin/scripts/adr_check.ts` accept artifact `tasks`: ask reads `<spec folder>/tasks.md` through `readTaskPaths` with `rootFiles` from `git ls-files` entries with no `/` and `<run>/touches.json` entries with no `/` (R5), writes `<run>/adr-tasks-asked.json`; decide carries each departure's story so `adrStop` prints `(story US<k>)` and names `tasks.md` as the artifact to change; `stop tasks judge`
- [ ] T035 [US4] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` add the `to-adr-tasks` block after `to-tasks`: `adr-tasks-ask`, `adr-tasks-judging` / `adr-tasks-judge`, `adr-tasks-decide`, the same as `to-adr-plan` with `tasks` (R6, FR-006)
- [ ] T044 [US4] In the root `README.md` ADR passage T043 rewrote, add that the same check runs again after tasks (`adr-tasks-*`), over the paths `tasks.md` names
- [ ] T036 [US4] Verify US4: `npm --prefix core test`, `npm --prefix planner test`, `python3 -m unittest discover -s planner/tests` green

**Checkpoint**: US4 PR merged; tasks are checked before the spec PR.

---

## Phase 6: User Story 5 - reviewer's decision check reads the same list (Priority: P3)
Story issue: #278

**Blocked by**: #235 (#209's US1, which creates `reviewer/plugin/lib/round/decisions.ts`) and US2.

**Goal**: reviewer checks only the listed folders, through core, honours the rulings file, and
`REVIEWER_ORG_ADR_DIR` is gone.

**Independent Test**: `npm --prefix reviewer test` green including `reviewer/tests/decisions.test.ts`;
`git grep REVIEWER_ORG_ADR_DIR -- ':!specs'` finds nothing.

### Tests for User Story 5 (write first, see them fail)

- [ ] T045 [P] [US5] Add hold `adr-<issue>` cases (FR-020): in `core/tests/` the `HoldKind` value `adr` and its placement (opened once per issue, naming the file(s), released as every hold by the Ready move or `/codeworks reset`); in `reviewer/tests/decisions.test.ts` a governing record with its own `adr check` error and a story PR changing `specs/<n>-x/spec.md`, a line of `tasks.md` beyond flipping `[ ]` to `[x]` in its own task block, or a file under a `docs/adr/` folder at any depth (e.g. `planner/docs/adr/…`) each place it, refusing commits and rounds, its comment naming the file(s), adrkit's rule and message for the broken record, and that planner fixes it; a PR changing neither, or only ticking its own tasks, places none (US5 AS5, AS6)
- [ ] T038 [P] [US5] In `reviewer/tests/decisions.test.ts` add: two listed folders (one outside the repo) and an unlisted tracked `docs/adr` → one `adr check` per listed folder, none for the unlisted (AS3); an unreadable listed folder → could not run (AS1); `REVIEWER_ORG_ADR_DIR` set changes nothing; an entry in the spec folder's `adr-rulings.json` silences its departure (AS4); remove every test of `REVIEWER_ORG_ADR_DIR`

### Implementation for User Story 5

- [ ] T039 [US5] In `reviewer/plugin/lib/round/decisions.ts` take folders from `adrFolders`, run `checkAdrFolder` per readable one, make an unreadable one could not run, read rulings through `readRulings` and report no departure an entry names; delete tracked-`docs/adr` discovery and `REVIEWER_ORG_ADR_DIR`; read `ADR_VERSION` from core, deleting any second copy; label each folder by its entry, "org" becoming "outside the repo"; keep reviewer's own deadline (R10, FR-013, FR-014, FR-017)
- [ ] T046 [US5] In `core/src/values.ts` add `HoldKind` `adr` as `contracts/core.md` gives it, in `core/src/contracts/tasks.ts` the one function that tells a TICK_ONLY `tasks.md` change (only `[ ]` to `[x]` inside the task block labelled with the story's issue) from any other, shared with reviewer ADR-0010 d1's commit refusal, and in `core/src/state.ts` the hold's placement beside `placeRescopeHold`, opening `adr-<issue>` with a comment naming the file(s) and that planner fixes it (reviewer ADR-0013 d4, as amended in the planning PR)
- [ ] T047 [US5] In `reviewer/plugin/lib/round/decisions.ts` place hold `adr-<issue>` through T046's function when a listed folder's answer holds a broken record (naming its file, adrkit's rule and message) or when the PR's diff against its merge base changes a file under a `docs/adr/` folder at any depth, or a spec folder beyond what T046's TICK_ONLY function admits (naming them; root ADR-0011), and run no judgment on that round (FR-020)
- [ ] T040 [US5] Remove `REVIEWER_ORG_ADR_DIR` from `reviewer/plugin/README.md` and describe the folders as `codeworks.toml` `[shared] adr_folders`, and hold `adr-<issue>`: what places it and that planner fixes the named files
- [ ] T041 [US5] Verify US5: `npm --prefix reviewer test` green and `git grep REVIEWER_ORG_ADR_DIR -- ':!specs'` prints nothing (AS2, SC-005)

**Checkpoint**: one setting, no env var, names the ADR folders for planner and reviewer.

---

## Phase 7: Polish & Cross-Cutting Concerns
Story issue: #278

- [ ] T042 Run every command in `specs/177-plan-adr-check/quickstart.md` once US4 has merged and confirm each expectation, recording any mismatch as a fix in the story it belongs to

---

## Dependencies & Execution Order

### Story order

- **Planning PR**: first; amends the decision records and blocks every story (FR-001).
- **US2** (P1): after the planning PR merges.
- **US3** (P1): after US2 merges (calls `adrFolders`, `checkAdrFolder`).
- **US4** (P2): after US3 merges (extends `adr_check.ts` and `workflow.yml`; reuses `artifactPath`).
- **US5** (P3): after US2 and #235 merge; independent of US3/US4 except `readRulings`
  (`core/src/contracts/decision-check.ts`, T021), so it also waits for US3.

### Within each story

- Tests first, failing for the expected reason, then implementation.
- US2: T008 before T009 and T010 (both read `Shared`); T011–T013 after T008.
- US3: T020 → T021 → T022 → T023; T024–T028 and T043 after T023; T029 last.
- US4: T033 → T034 → T035 → T044 → T036.
- US5: T046 → T039 → T047 → T040 → T041.

### Parallel Opportunities

- US2: T005, T006, T007 together; then T011, T012, T013 together.
- US3: T016, T017, T018, T019 together; T024, T026, T028 and T043 in parallel once T023 is done.
- US4: T030, T031, T032 together.
- US5: T038 and T045 together.

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
Task: "touches.json instruction in planner/tests/test_plan_template.py"     (T019)
```

## Implementation Strategy

### MVP

Planning PR → US2 → US3: plans are checked before critique against every listed folder. Stop and validate with quickstart's
Planner rows and the manual end-to-end check.

### Incremental delivery

1. Planning PR: the rules (no code; not a story).
2. US2: the list and `adr` in core; rollout reinstall named in the PR (MVP start).
3. US3: the check after plan (MVP complete).
4. US4: the check after tasks.
5. US5: reviewer on the same list, after #235.
