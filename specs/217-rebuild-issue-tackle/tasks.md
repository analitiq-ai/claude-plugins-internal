---

description: "Task list for builder rebuilding issue-tackle to its records"
---

# Tasks: builder rebuilds issue-tackle to its records

**Input**: Design documents from `specs/217-rebuild-issue-tackle/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Constitution Principle IV and plan's Constitution Check: `decideStep` and core's `storyStop` are
pure, so every acceptance scenario starts as a failing `node:test` unit test; reads are tested against core's fake
GitHub (`core/tests/support/fake-github.ts`) and a scratch repository (`planner/tests/support/checkout.ts`). A test
task is run and seen to fail for the stated reason before its implementation task starts.

**Organization**: One phase per user story, in the spec's delivery order: US1, US2, US3, US4, US5. Every task marked
**Bn** lands in `core/` in US1's one PR on one US1 branch `<s1>-us1-<slug>`, merged before US3 (plan: Delivery
order). Task numbers are execution order within a PR.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5, as spec.md numbers them

## Path Conventions

- Plugin (installed): `builder/plugin/` — `.claude-plugin/`, `core` link, `lib/`, `scripts/`, `skills/`
- Tests (not installed): `builder/tests/`, run by `npm test --prefix builder` (`tsc -p . && node --test 'tests/**/*.test.ts'`)
- Shared code: `core/src/`, tests in `core/tests/`
- `builder/plugin/scripts/step.ts` exports `main(args, io)` and wires real I/O only under `import.meta.main`, the
  shape of `planner/plugin/scripts/preflight.ts` (R3), so tests drive it with injected I/O

---

## Phase 1: Setup (Shared Infrastructure)
Story issue: #245

**Purpose**: the governing-rule change and the cross-plan prerequisites every story waits on

- [x] T001 **Own PR (K), governing rule, before US2.** Amend `.specify/memory/constitution.md` Platform Constraints: replace "builder is two skills, with no scripts and no hooks" with builder's limits (no GitHub App or key of its own, the agent machine only, no plugin dependency), as a PATCH amendment (version line, Sync Impact Report and amendment date updated as the constitution's Governance section requires) (R15). Done in #338 (1.2.4)
- [x] T002 Post one comment on issue #174 naming the two items its plan must carry (plan: Coordination with #174): the state-folder paths in core; its Stop hook calls core's stop rule and the read of its facts (R16; FR-025). Posted; #174 took both (#251: R21, T076); the paths are on main in `core/src/orchestrator-paths.ts` (#242)
- [ ] T003 Gate check before US2: confirm on `origin/main` that #174's carrier is merged (`orchestrator/plugin/core` link, `orchestrator/plugin/package.json`, `orchestrator/plugin/package-lock.json`, `orchestrator/plugin/lib/guarded.ts`) and #212 is merged; record the merge commits of each in `specs/217-rebuild-issue-tackle/research.md` under R1. If #174's carrier is not merged, stop: no builder carrier file is written before it (spec Clarifications Q4; FR-018)

---

## Phase 2: Foundational (Blocking Prerequisites)
Story issue: #245

**Purpose**: none beyond Phase 1. Every shared prerequisite is either a governing rule (Phase 1) or a core read
owned by US1; builder's carrier itself is US2. This phase is intentionally empty.

**Checkpoint**: T001 merged, T003 confirmed — US2 can begin; US1 needs neither

---

## Phase 3: User Story 1 - core gains the reads and the stop rule builder needs (Priority: P1)
Story issue: #245

**Goal**: every read builder's step needs that core lacks, and the pure stop rule the orchestrator's Stop hook
shares, land in core in one PR carrying `Closes #245` from creation (builder ADR-0003 d1; FR-024–FR-026)

**Independent Test**: `npm test --prefix core` passes; each addition has a test against the fake GitHub or a scratch
repository; no addition's signature takes a key reader or a writing client

### B1 — Story branch name

- [ ] T004 [P] [US1] **B1.** Add failing cases to `core/tests/branch.test.ts` for `storyBranchName(s, k, title)` (US1 #1): titles with `/`, `..`, unicode, uppercase, runs of punctuation and 300 characters give a slug matching `^[a-z0-9]+(-[a-z0-9]+)*$`, at most 40 characters, with no leading, trailing or doubled `-`; an empty or all-punctuation title gives `story`; a 40-character cut never ends on `-`; `s` and `k` must be positive safe integers or it throws; for every case `parseBranch(storyBranchName(s, k, title))` deep-equals `{story: s, k, slug}` (R8)
- [ ] T005 [US1] **B1.** Add `storyBranchName(s, k, title)` beside `parseBranch` in `core/src/identity.ts`, sharing the branch grammar's constants with the parser; T004 passes

### B2 — Task-line grammar and story tasks

- [ ] T006 [P] [US1] **B2.** Add failing cases to `core/tests/tasks.test.ts` for `readTaskLine(line)`, the one task-line grammar (R11): `{id, ticked, story}` or `null` for a line that is no task; a task line is optional leading spaces, `- [ ] ` / `- [x] ` / `- [X] `, then `T` + 3 or more digits; `ticked` is true for `[x]` and `[X]`; `story` is `k` from a `[US<k>]` tag, `k` a positive integer without leading zero (`[US0]`, `[US01]`, `[us1]` are no tag), else `null`; the same tag twice gives that `k`; two different tags on one line refuse as `TaskLineRefused` naming the line; and for `storyTasks(text, s)` (data-model StoryTask), built on `readTaskLine`: returns `{id, ticked, story, line}` for each line `readTaskLine` reads as a task inside every phase block whose label line (per `readTaskBlockLabels`) is `Story issue: #<s>`, `[X]` and indented task lines included; `id`, `ticked` and `story` are `readTaskLine`'s; `line` is the line as written; lines in blocks labelled another issue, unlabelled blocks and non-task lines are excluded; no block labelled `#<s>` returns `[]`; a malformed label refuses as `TaskBlockLabelRefused`, never as no tasks
- [ ] T007 [US1] **B2.** Add `readTaskLine`, `TaskLineRefused`, `storyTasks(text, s)` and the `StoryTask` type to `core/src/contracts/tasks.ts`, reusing `isPhaseHeading` and the label grammar there; in the same PR, `planner/plugin/scripts/land.ts` `phasesOf` reads task lines and their tags through core's `readTaskLine`, its `TASK_LINE` and `STORY_TAG` removed, and `planner/tests/land.test.ts` gains a case for a line with two different tags; T006 and `planner/tests/land.test.ts` pass

### B3 — Story PR closed

- [ ] T008 [P] [US1] **B3.** Add failing cases to `core/tests/identity.test.ts`: `issueStory`'s and `storyPr`'s `StoryPr` carries `closed: boolean` from the query's existing `closed` field; open → `closed: false, merged: false`; closed unmerged → `closed: true, merged: false`; merged → `closed: true, merged: true`; B3 adds no field to the GraphQL query (R12)
- [ ] T009 [US1] **B3.** Add `closed` to the `StoryPr` type and its construction in `core/src/identity.ts`; T008 passes; existing `identity.test.ts` cases pass unchanged

### B4 — Spec PR merge commit

- [ ] T010 [P] [US1] **B4.** Add failing cases to `core/tests/identity.test.ts`: `specPr`'s `SpecPr` carries `mergeCommit: {oid} | null`, the oid read from the PR's `mergeCommit` in the same query; non-null only when `state` is `merged` (R9)
- [ ] T011 [US1] **B4.** Add `mergeCommit` to `SpecPr`, its query and `pickSpecPrs` in `core/src/identity.ts`; T010 passes

### B7 — Stop rule and the read of its facts (after B1, B2, B3 and B4)

- [ ] T012 [P] [US1] **B7.** Write failing `core/tests/story-stop.test.ts` for the pure `storyStop(facts)` (R9, R16; data-model Decision order stages 1–7 and the stop half of 9): one case per `StopState` — `NO_SESSION_RECORD`, `OTHER_SESSION_ISSUE`, `OTHER_REPOSITORY`, `CLOSED`, `DONE`, `LANE` (Backlog and Blocked each), `NO_CARD`, `SPEC_ISSUE_ELSEWHERE`, `SEVERAL_BRANCHES`, `BRANCH_MISMATCH`, `WORKTREE_ON_OTHER_BRANCH`, `NO_SPECS`, `NO_SPEC_FOLDER`, `SEVERAL_SPEC_FOLDERS`, `HEAD_BEHIND_PR` (behind and diverged each), `UNCOMMITTED_CHANGES` — asserting `{state, reason}` and that `reason` names the state, the issue, and the open story PR when one is given; stage order holds (e.g. `done` and Blocked together gives `DONE`; `NO_SESSION_RECORD` beats everything); facts that reach no stop return `null`; a merge in progress returns `null` (it is a `merge` step, not a stop); `merge.needed` returns `null` even with a folder stop in the facts (stage 6 before 7); `merge.needed` with the local head behind or diverged from the PR head gives `HEAD_BEHIND_PR`; `merge.needed` false with `NO_SPEC_FOLDER` gives `NO_SPEC_FOLDER`; no `reason` contains a planning-command name (`speckit`, `/plan`, `/specify`, `issue-spec`); the function performs no I/O (source-scan: no import of `node:fs`, `node:child_process`, `github.ts`); and failing `core/tests/story-stop-facts.test.ts` for `readStoryStopFacts(s, sessionId, {reader, home, checkout, fetch})` against the fake GitHub and a scratch repo, `fetch` a local `git fetch` from a scratch remote; per R16: a session record absent or for another issue stops with no GitHub read and no `fetch`; the main checkout and any of its worktrees as `checkout` give the same branch, worktree and merge facts, the main checkout returned with them; `fetch` is called with `trackingRefspec` of the branch core `defaultBranch` reads from GitHub before any read of a ref other than HEAD, `refs/remotes/origin/<default>` at the remote's tip after it, and again with `trackingRefspec(branch)` after the branch reads for any branch on GitHub, never otherwise; a PR head only on the remote, behind or diverged from the local branch → `headVsPr` read, never a git failure; a local branch with no worktree behind or diverged from the PR head → `HEAD_BEHIND_PR` read at that branch; `trackingRefspec("main")` is `+refs/heads/main:refs/remotes/origin/main`; the `shared` it read returned with the facts; one case per fact (session record at `sessionsFolder(home)` absent → `session: null`, refused → throws naming the file; `[shared]` read from `codeworks.toml` at `checkout`'s HEAD through `gitTree`, a different copy on the default branch on GitHub ignored (R7); origin; issue; `isDone`; `laneOf`; `specIssue`; `issueStory` with B3's `closed`; `git branch --list '<s>-us*'`; `git worktree list --porcelain`; `MERGE_HEAD`; `git status --porcelain`; `merge` per R9 against `refs/remotes/origin/<default>` after the fetch, at the worktree's HEAD or with no worktree at the ref it would start from (R16 step 5) — default tip an ancestor of HEAD → `needed:false`; the newest merged spec PR of `<p>` whose `mergeCommit.oid` is not an ancestor of HEAD → needed, `why` names the PR, also when a newer spec PR of `<p>` is open; that oid unknown to git → throws; a `specs/<p>-*` added, removed, renamed or doubled on the default branch → needed, `why` names the path; `governingDiff` non-empty for a `specs/<p>-*/spec.md`, a `**/docs/adr/` file or `.specify/memory/` → needed, `why` names the path; `git merge-tree --write-tree origin/<default> HEAD` exit 1 → needed, `why` names the conflict, with or without a PR; only an unrelated file differing → `needed:false`; `specFolder` at the worktree's HEAD, or with no worktree at the ref it would start from: `refs/remotes/origin/<default>` with no branch anywhere, `refs/remotes/origin/<branch>` for a branch on GitHub only, `<branch>` for a local one (R10); `head` and `headVsPr` by `merge-base --is-ancestor`), stopping early in data-model order; it writes nothing else (no `worktree add`: the scratch repo's branches, worktrees and `.git/index` unchanged)
- [ ] T013 [US1] **B7.** Create `core/src/story-stop.ts` exporting the Zod `StopState` enum (the 16 values above, defined once), the `StoryStopFacts` type (the data-model StepFacts fields stages 1–7, 9 read, later fields optional) and `storyStop(facts): {state, reason} | null`, and `core/src/story-stop-facts.ts` exporting `readStoryStopFacts`, git through `git.ts` `runGit` (`status` as `git --no-optional-locks status --porcelain`), `merge` through the first `merged` of `specPrs`, with B4's `mergeCommit` and `attest.ts` `governingDiff`, its folder made a list of folders (`governingLapse` passing its one); `defaultBranch(reader, repo)` moved from `orchestrator/plugin/lib/settings.ts` to core `identity.ts` (its `orchestrator/tests/settings.test.ts` cases moved to `core/tests/identity.test.ts`) `trackingRefspec(branch)` added to `git.ts`, and `mainCheckout(checkout)` moved there from `adr-folders.ts`, which calls it (R16); the orchestrator's `orchestratorOnGitHub` imports `defaultBranch` until #174 T081 removes that call; planner `land.ts`'s two refspecs replaced by `trackingRefspec` (its repository read stays: it reads `url` with `default_branch` in one call); T012, existing `attest.test.ts`, `orchestrator/tests/settings.test.ts` and `planner/tests/land.test.ts` cases pass

### B5 — `internal-review` read

- [ ] T014 [P] [US1] **B5.** Add failing cases to `core/tests/required-checks.test.ts` for `internalReviewAt(reader, repo, head, appLogin)` (R12; plan P9): `true` only when the newest `internal-review` check run at `head` whose app is `appLogin`'s App has conclusion `success`; a `success` run by another App does not count; no run → `false`; a pending run → `false`; a GitHub no-answer throws `GitHubUnanswered`/`GitHubRefused`, never `false`
- [ ] T015 [US1] **B5.** Export `internalReviewAt` from `core/src/validation/required-checks.ts` over the private `checkRuns` read and the `INTERNAL_REVIEW` constant; T014 and existing `required-checks.test.ts` cases pass

### B6 — PR findings

- [ ] T016 [P] [US1] **B6.** Write failing `core/tests/pr-findings.test.ts` against the fake GitHub for `prFindings(reader, repo, pr, head, settings, logins)` (R12; FR-026; US1 #2): returns `Finding[]` (core `contracts/finding.ts`) from `requiredChecks` and `threadsModule`, and only when both are empty from each `<module>-review` check run at `head` written by `[shared] orchestrator_app_login`'s App: `failure` is one finding of source `<module>`, keyed `module-review:<module>`, with no thread, shaped as `requiredChecks` shapes a failed check; `success`, pending or absent gives none; a red required check with no module run returns its finding; a `COULD_NOT_RUN` from either reader throws naming it, never returns `[]`; a check run by another App is ignored; the module set is `[shared] validators`; a provider login's thread and its replies are read as `threadsModule` reads them given the same `logins` (not a `threads` finding, not untrusted); `validatorLogins(shared, dir)` over the fixture packages returns each package's `logins` without calling `open`, and `loadValidators` returns the same set; with `[shared] required_checks` set, the listed checks are graded and no rules read (#174 R22, its C14 landing here: T017); the test asserts no validator package is opened (source-scan of `core/src/validation/pr-findings.ts`: no import of `validation/contract.ts` `loadValidators` or `readKey`)
- [ ] T017 [US1] **B6.** Land #174's C14 first: its failing cases in `core/tests/required-checks.test.ts` and `core/tests/settings.test.ts` (#174 T077's text), then `required_checks` in core's `Shared` and `requiredChecks` reading it; then `validatorLogins(shared, dir)` exported from `core/src/validation/contract.ts`, `loadValidators` calling it; then create `core/src/validation/pr-findings.ts` exporting `prFindings`, its failed-run finding built by `required-checks.ts`'s `findingOf`, exported taking the finding's `source` and `key` (its own call passes `SOURCE` and `required-check:<name>`); T016 and existing `required-checks.test.ts` cases pass; then, once for the PR, bump `version` in every carrier's `.claude-plugin/plugin.json` then present (`planner/plugin`, `orchestrator/plugin`, and `builder/plugin` once US2 has merged) and confirm `node core/scripts/check-carriers.ts --base origin/main` reports 0 failures (FR-022)

**Checkpoint**: US1's PR merged → US3 may start

---

## Phase 4: User Story 2 - builder carries core; the Python tests move to TypeScript (Priority: P1)
Story issue: #246

**Goal**: `builder/plugin` is a checked core carrier with a guarded entry; builder's tests are TypeScript and no
`.py` remains (FR-018, FR-019, FR-021, FR-022)

**Independent Test**: `node core/scripts/check-carriers.ts --base origin/main` lists `builder/plugin` with 0
failures; `npm test --prefix builder` passes; `git ls-files 'builder/tests/*.py'` prints nothing

### Carrier files (copied from the orchestrator's carrier on main, R1)

- [x] T018 [US2] Create `builder/package.json`, `builder/tsconfig.json` and `builder/package-lock.json` copying `planner/package.json` and `planner/tsconfig.json`: script `"test": "tsc -p . && node --test 'tests/**/*.test.ts'"`, dev pins `@types/node` and `typescript` at planner's exact versions, no build step (R2)
- [x] T019 [P] [US2] Create `builder/plugin/package.json` with `"type": "module"`, dependencies exactly equal to core's runtime pins in `core/package.json` (`zod`, `yaml`, `smol-toml`, same versions, no range), no devDependencies, then generate `builder/plugin/package-lock.json` with `lockfileVersion: 3` (`npm install --lockfile-version 3 --prefix builder/plugin`) (R1)
- [x] T020 [P] [US2] Create the symlink `builder/plugin/core -> ../../core/src`; if `orchestrator/plugin` links `validators/`, link it in `builder/plugin` the same way (R1)
- [x] T021 [P] [US2] In `builder/plugin/.claude-plugin/plugin.json` bump `version` `0.2.1` → `0.3.0`; leave its `description` until US4 (T054 rewrites it); declare no plugin dependency (builder ADR-0002 d1)

### Tests first

- [x] T022 [P] [US2] Write failing `builder/tests/carrier.test.ts` copied from `planner/tests/carrier.test.ts`: `builder/plugin/package.json` dependencies deep-equal core's runtime pins; the lock is `lockfileVersion: 3` and agrees with them; `builder/plugin/core` is a symlink resolving to `core/src`; no import under `builder/plugin/` resolves outside `builder/plugin/` except through `core/` (FR-019); no `*.py` file exists under `builder/` (FR-021, SC-005)
- [x] T023 [P] [US2] Write failing `builder/tests/guarded.test.ts` copied from `planner/tests/guarded.test.ts`: every `builder/plugin/scripts/*.ts` has `../lib/guarded.ts` as its first and only static import; with `zod` removed from a temp copy's `node_modules`, running `scripts/step.ts` exits 2 with stderr `core dependency zod is not installed in <folder>` and writes nothing (US2 #2; root ADR-0009 d4)
- [x] T024 [P] [US2] Write `builder/tests/skill.test.ts` carrying the Python assertions that still hold (R2): (a) from `test_names_no_planning_command_and_reads_no_issue_comment_for_the_spec`: `builder/plugin/skills/**/SKILL.md` names no planning command and reads no issue comment for the spec; (b) from `test_no_command_the_skills_give_reads_a_value_inside_its_arguments`; (c) from `test_guards.py` `test_no_file_names_a_command_this_plugin_does_not_ship_but_the_review_round`, its pattern corrected from `alq-(review|plan|build):` to `(reviewer|planner|builder|auditor|orchestrator):` and its shipped set `{builder:issue-tackle, builder:root-cause-check}` (narrowed to `{builder:issue-tackle}` in T053); every case passes against today's skill text
- [x] T025 [US2] Delete `builder/tests/test_issue_tackle.py`, `builder/tests/test_spec_source.py`, `builder/tests/test_guards.py` and `builder/tests/paths.py`; their other assertions (`spec=`/`branch=`, root-cause-check verdicts, `spec.md` non-empty at the given branch, the old-home phrases) are dropped as retired text (R2; FR-021)

### Implementation

- [x] T026 [US2] Create `builder/plugin/lib/guarded.ts` statically importing only `../core/guard.ts`, copied from `orchestrator/plugin/lib/guarded.ts` (copied, not imported: root ADR-0001 d1); fix any stale `alq-` pattern in the copied guard test rather than carrying it (plan V)
- [x] T027 [US2] Create `builder/plugin/scripts/step.ts` as a guarded entry only: first static import `../lib/guarded.ts`, `main(args, io)` that loads nothing else yet and exits 2 with `builder: step.ts is not built yet`; T022, T023 pass
- [x] T028 [US2] Run `npm ci --prefix builder/plugin`, `npm ci --prefix builder`, `npm test --prefix builder`, then `node core/scripts/check-carriers.ts --base origin/main` and confirm builder is listed with 0 failures; on a scratch branch change one line in `core/src` without bumping `builder/plugin/.claude-plugin/plugin.json` and confirm the check fails naming that file (US2 #1, SC-001); confirm `.github/workflows/tests.yml` runs builder's suite unchanged (R2)

**Checkpoint**: builder is a carrier; no step behaviour changed

---

## Phase 5: User Story 3 - A step derives everything from the story issue number (Priority: P1) 🎯 MVP
Story issue: #247

**Goal**: `issue-tackle <s>` takes `<s>` alone; the step script reads session, lane, issue, branch, worktree and
folder through core, cuts the story branch in `../<repo>.worktrees/<branch>` when none exists, and prints a stop, a
merge of the default branch, or the work to do; the skill runs the merge (FR-001–FR-010, FR-016, FR-017, FR-027,
FR-028)

**Independent Test**: against the fake GitHub and a scratch repository, `facts.test.ts` and `step.test.ts` run the
script for a story in each lane and folder state: Ready, one folder, no branch prints `implement` after cutting
`<s>-us<k>-<slug>` from the default branch; Backlog, Blocked, closed, a missing or a doubled folder each print a
`stop` (exit 1) and cut nothing

### Unrun behaviour first (R4)

- [ ] T029 [US3] On the agent machine, install a throwaway plugin skill whose only line runs `echo "${CLAUDE_PLUGIN_ROOT}" "${CLAUDE_SESSION_ID}"` and invoke it; record whether both are substituted, and save the result under R4 in `specs/217-rebuild-issue-tackle/research.md`. **If `${CLAUDE_SESSION_ID}` is not substituted, stop: R4 is reopened before T039**

### Tests first

- [ ] T030 [P] [US3] Write failing `builder/tests/step.test.ts` part 1, the step schemas and arguments (contracts/step-script.md Input/Output): `main(["231","--session",uuid], io)` is accepted; `<s>` must match `^[1-9][0-9]*$` and be a safe integer, `--session` a UUID; any other argv (missing, extra positional, `spec=x`, `branch=x`, unknown flag) exits 2 with exactly one stderr line `builder: step.ts takes <s> --session <id>, not <args>`, stdout empty, and no read made (FR-001, US3 #8); stdout on exit 0 or 1 is one JSON line with `"v":1` and `story`, stderr empty
- [ ] T031 [P] [US3] Write failing `builder/tests/step.test.ts` part 2, `decideStep(facts)` for data-model stages 1–8: each of the 16 `StopState`s gives `{kind:"stop", state, reason, pr}` with the reason from core's `storyStop` (SC-002, US3 #3–#7); `merge.needed` false and a merge in progress gives `merge` with no `argv` (FR-028); a Ready story, one folder, no PR gives `implement` carrying `worktree`, `branch`, `requirement {kind, source, observed}`, the unticked `tasks` only and `observed` (US3 #1); a `no_spec` spec gives the story issue body as requirement source (US3 #2); a newest PR closed unmerged gives `implement` (US4 #5); the same facts twice give deep-equal steps (SC-003)
- [ ] T032 [P] [US3] Write failing `builder/tests/facts.test.ts` against the fake GitHub and `planner/tests/support/checkout.ts` scratch repos (R5–R8, R10), one case each: absent gh folder or token past expiry exits 2 naming the folder; session record absent → `NO_SESSION_RECORD`, issue ≠ s → `OTHER_SESSION_ISSUE`, repo ≠ origin → `OTHER_REPOSITORY`, refused record → exit 2 naming the file (R6); `LaneRefused`/`GitHubUnanswered`/`GitHubRefused` exit 2 naming the read, never a lane (FR-009); no branch anywhere → the cut runs `git worktree add -b <branch> <path> <default-sha>` at `../<repo>.worktrees/<branch>` with `<branch>` = `storyBranchName(s, k, title)` (`k` from the first `[US<k>]` of `storyTasks`, else 1), and a second run finds it and cuts nothing (idempotent); no branch anywhere with no or two `specs/<p>-*` on the default branch → the folder stop, nothing cut (R10); branch on GitHub only → `git worktree add -B <branch> <path> refs/remotes/origin/<branch>`; local branch with no worktree → `git worktree add <path> <branch>` (FR-027); a branch on GitHub only and a local branch, each with no or two `specs/<p>-*` at its tip → the folder stop, no worktree added (R10), unless the default branch is ahead with one folder: then no stop, the worktree added, and the re-read names `merge` (R16 step 5); a local branch with no worktree behind the open PR's head → `HEAD_BEHIND_PR`, no worktree added; GitHub and local branches both present and different → `BRANCH_MISMATCH`; worktree at the path on another branch → `WORKTREE_ON_OTHER_BRANCH`; `MERGE_HEAD` present → `merge` with no argv; dirty worktree → `UNCOMMITTED_CHANGES` naming the files; two GitHub branches `<s>-us*` → `SEVERAL_BRANCHES`; parent in another repo → `SPEC_ISSUE_ELSEWHERE`; no `specs/`, no `specs/<p>-*`, two `specs/<p>-*` at HEAD → the three folder stops naming the open story PR (FR-008); every stop leaves `git status`, `git worktree list` and `git branch` of the scratch repo unchanged (SC-002)
- [ ] T033 [P] [US3] Extend `builder/tests/step.test.ts` (US5 #1–#3): `merge.needed` true gives `merge` with `ref` `refs/remotes/origin/<default>`, `why[]` copied from facts and `argv` deep-equal `["git","merge","--no-ff","--no-edit","refs/remotes/origin/<default>"]`, decided before stage 7 (a merge with a missing folder still gives `merge`, not `NO_SPEC_FOLDER`)
- [ ] T034 [P] [US3] Extend `builder/tests/facts.test.ts` with scratch repos (R9; the merge fact's cases are core's, T012): a spec PR merged on the remote since the last run → the run's fetch brings it and `merge.needed` is true; after the merge is committed and the script re-run, the folder check reads the merged head (US5 #1)
- [ ] T035 [P] [US3] Extend `builder/tests/skill.test.ts`: the skill runs the `merge` step's `argv` in `worktree`, resolves conflicts in that merge commit, then runs the script again in the same turn; it names no `git rebase`, `git reset --hard`, `git push --force`, `--force-with-lease` (FR-017)

### Implementation

- [ ] T036 [US3] Create `builder/plugin/lib/step.ts`: Zod `StepFacts` (data-model.md table, later fields optional), `Step` discriminated on `kind` (`stop`, `merge`, `implement`, `internal_round`, `github_round`, `nothing_to_do`) with exactly the fields data-model.md's Step table gives, `StopState` imported from core `story-stop.ts`, and the pure `decideStep(facts)` calling core `storyStop` first, then stages 5 (merge in progress), 6 (`merge.needed` → `merge` with `ref`, `why`, `argv`), 8 (`implement`); until US4 an open PR gives `internal_round` with `args {worktree, stage:"internal"}` (stages 9–10 land in T048); T031 (part 2) and T033 pass
- [ ] T037 [US3] Create `builder/plugin/lib/facts.ts` `readFacts(s, sessionId, deps)` reading in data-model order and stopping early: gh folder via core `ghFolder(home)` + `readGhToken`, `gitHub(token)`; the session's cwd as `checkout`, its origin via `repositoryOfRemote` checked equal to the token's `repo`; then core `readStoryStopFacts(s, sessionId, {reader, home, checkout, fetch})` (B7), `fetch` `(refspecs) => fetchWithGhCredential(checkout, ghFolder(home), repo, refspecs)`, for every stop fact, none read elsewhere in builder (R5–R8, R16)
- [ ] T038 [US3] In `builder/plugin/lib/facts.ts` add the cut and worktree writes exactly as contracts/step-script.md Writes lists (one of the three `git worktree add` forms), each only when core `storyStop` returns `null` for the facts read before it (the folder read at the ref it starts from, R10), the re-read through `readStoryStopFacts` after them, then builder's own reads in the worktree: `requirement(tree, folder, body)` and `readSpecFacts` for `observed`, `storyTasks(tasks.md at HEAD, s)` (R8, R10, R11); `merge` comes from `readStoryStopFacts`; T032 and T034 pass
- [ ] T039 [US3] Complete `builder/plugin/scripts/step.ts`: after the guard, `await import` `../lib/facts.ts` and `../lib/step.ts`, parse args (T030 part 1), `readFacts` → `decideStep` → print one JSON line; exit 0 for work, 1 for `stop`, 2 with one stderr line `builder: <cause>` for an unanswered or refused read; T030 passes
- [ ] T040 [P] [US3] Extend failing cases in `builder/tests/skill.test.ts`: the skill's argument-hint is `<s>`; it names `scripts/step.ts` with `--session "${CLAUDE_SESSION_ID}"`; it names no `spec=`, `branch=` or `worktrees/<n>`; T024's cases still pass
- [ ] T041 [US3] Rewrite Steps 1–2 of `builder/plugin/skills/issue-tackle/SKILL.md`: argument-hint `<s>`; refuse any text after `<s>`, naming `issue-tackle <s>` as the one form (FR-001); first action runs `node "${CLAUDE_PLUGIN_ROOT}/scripts/step.ts" <s> --session "${CLAUDE_SESSION_ID}"` (R4); exit 1 or 2 ends the turn quoting the reason or stderr line (FR-010); work happens in the step JSON's `worktree` on its `branch`, and the spec folder is read only from the step JSON's `requirement.source`; the merge path per contracts/skill.md's `merge` row: run `argv` in `worktree` (none when a merge is in progress), resolve any conflict in that merge commit, commit, then run the step script again (FR-017); T035 and T040 pass. Keep Steps 3–7 otherwise as they are on main (US4 rewrites them); drop `spec=`, `branch=` and `../<repo>.worktrees/<n>`
- [ ] T042 [US3] Run quickstart.md §2 for US3's cases and §4 steps 1–2 on the agent machine (after US1 and US2 merged): a Ready story with no branch prints `implement` and the worktree `../<repo>.worktrees/<s>-us<k>-<slug>` exists on a branch cut from the default branch; moving the card to Blocked and running again prints the `LANE` stop with `git status` and GitHub unchanged

**Checkpoint**: US3 shippable alone; rounds and pushes still as on main

---

## Phase 6: User Story 4 - Each step resumes from GitHub and ends at an attested draft (Priority: P1)
Story issue: #248

**Goal**: the step reads the PR, its `internal-review` attestation, findings and ticks; the skill implements every
unticked task with tick-only commits, runs the round with the step JSON's args and no `spec`, never pushes, and
`root-cause-check` retires (FR-011–FR-015, FR-020, FR-023, FR-029)

**Independent Test**: against the fake GitHub, run the step script for one story in each PR state (none, unattested,
findings, attested clean) and read the step it names, twice each; read the skill and find no step reading a
previous turn's state and no `root-cause-check`; `git ls-files` outside `specs/` and `**/docs/adr/` names no
`root-cause-check`

**Prerequisites**: #212 merged; reviewer's gate accepts a launch with no `spec` (reviewer ADR-0014
d1) and reviewer's root-cause reviewer runs in the internal round (reviewer ADR-0017) — confirm each on `origin/main`
and record the commits under R12 in `specs/217-rebuild-issue-tackle/research.md` before T048; if any is missing,
stop

### Tests first

- [ ] T043 [P] [US4] Extend `builder/tests/step.test.ts` for stages 9–10 (SC-003, US4 #1–#4, #9): no PR → `implement` listing only unticked tasks; open PR, local head behind or diverged → `HEAD_BEHIND_PR` stop naming both heads; open PR, local head ahead → `internal_round` at local HEAD; open PR unattested → `internal_round` with `args` deep-equal `{worktree, stage:"internal"}` and no `spec` key; attested with findings → `github_round` with `findings` counted by source and `args {worktree, stage:"github"}`; attested, no findings → `nothing_to_do`; attested, no findings, unticked task left → `nothing_to_do` (spec Edge Cases); each PR state run twice gives a deep-equal step
- [ ] T044 [P] [US4] Extend `builder/tests/step.test.ts` (US4 #7): a story of 3 tasks whose `tasks.md` at HEAD has T001 and T002 ticked lists only T003 as unticked; with no task block labelled `#<s>`, `implement` carries `tasks: []` (the requirement is built as one task)
- [ ] T045 [P] [US4] Extend `builder/tests/facts.test.ts` against the fake GitHub: `attested` read through `internalReviewAt(reader, repo, pr.head, shared.orchestrator_app_login)`; `findings` through `prFindings`; a red required check with no `<module>-review` run gives `github_round`; a module run pending or absent with no other finding gives `nothing_to_do`; a throw from `prFindings` exits 2 naming it (R12); nothing under `builder/plugin/` calls `loadValidators`, `readKey` or a package's `open` (source-scan, as T016's)
- [ ] T046 [P] [US4] Extend `builder/tests/skill.test.ts` (quickstart.md §3; US4 #6, #8): the skill names no `root-cause-check`, `git push`, `rebase`, `--force`, `gh pr`, `spec=`; it launches `reviewer:review-round` with the step JSON's `args` and names no `spec` argument; it says to tick each task in a commit that only flips its `[ ]` to `[x]` right after the task's code commit (FR-023); it reads `observed` from the step JSON, not from a heading; it reads no state from an earlier turn
- [ ] T047 [P] [US4] Add to `builder/tests/skill.test.ts` the SC-005 search: over `git ls-files` excluding `specs/**` and `**/docs/adr/**`, no file matches `(?<!alq-)root-cause-check` (the lookbehind leaves `reviewer/tests/test_shipped_tree.py`'s retired `alq-root-cause-check` path, which R14 keeps)

### Implementation

- [ ] T048 [US4] In `builder/plugin/lib/step.ts` replace the interim open-PR branch with data-model stages 9–10 (`HEAD_BEHIND_PR` via core `storyStop`; ahead or unattested → `internal_round`; findings → `github_round`; else `nothing_to_do`), each round step carrying `args` per FR-029; T043, T044 pass
- [ ] T049 [US4] In `builder/plugin/lib/facts.ts` read `attested` with core `internalReviewAt` and, only when attested, `findings` with core `prFindings`, its `logins` core `validatorLogins(shared, <plugin>/validators)` (R1, R12), exiting 2 on either's throw; T045 passes
- [ ] T050 [US4] Rewrite Steps 3–7 of `builder/plugin/skills/issue-tackle/SKILL.md` as one loop over the printed step per contracts/skill.md: `implement` — per listed task in order, build against the requirement at the spec's Root cause, confirming the mechanism first when `observed` is `hypothesis`, refusing shims and workarounds (today's Step 3 text kept, FR-015), commit, then a tick-only commit; with no task listed build the requirement as one change; then launch `Workflow(name='reviewer:review-round', args=<step.args>)` and take each step the gate names until clean, and end the turn; `internal_round`/`github_round` — the same launch, then end the turn; `nothing_to_do` — end the turn; plus the contracts/skill.md "Never" list verbatim (FR-011–FR-014, FR-023)
- [ ] T051 [US4] Delete `builder/plugin/skills/root-cause-check/` (R14; FR-020)
- [ ] T052 [P] [US4] Edit `auditor/plugin/skills/pr-audit/SKILL.md:123` to name reviewer's root-cause reviewer (reviewer ADR-0017) in place of `[[builder:root-cause-check]]`, and the comment at `planner/plugin/scripts/rootcause.py:7` the same way (R14)
- [ ] T053 [US4] In `builder/tests/skill.test.ts` narrow T024(c)'s shipped set to `{builder:issue-tackle}`; T046, T047 pass
- [ ] T054 [US4] Rewrite `description` in `builder/plugin/.claude-plugin/plugin.json` to describe one skill, `issue-tackle <s>`, driven by its step script, naming no `root-cause-check`; bump `version` `0.3.x` → next minor
- [ ] T055 [US4] Run quickstart.md §4 step 1 on the agent machine: each task's code commit is followed by a tick-only commit; the round ends clean; the model pushes nothing; the Stop hook opens and attests the draft

**Checkpoint**: US3 and US4 work together; root-cause-check is gone

---

## Phase 7: User Story 5 - The story branch takes the default branch by merge only (Priority: P2)
Story issue: #249

**Goal**: the merge path US3 built holds end to end on the agent machine: before the folder check, the step names a
merge of the default branch when a spec PR merged since, when governing files differ, or when the merge would
conflict; the skill merges, never rebases or force-pushes, and re-runs the step (FR-016, FR-017)

**Independent Test**: in a scratch repository, change `docs/adr/` on the default branch after the cut, run the step
script and read `merge` before any folder check; run the skill's merge path on a conflicting change and confirm
every earlier head is an ancestor of the new head

**Prerequisite**: US4 merged

- [ ] T056 [US5] Run quickstart.md §4 step 3: merge a `docs/adr/` change to the default branch, run the step, it prints `merge`; after the skill's merge, `git merge-base --is-ancestor <old-head> HEAD` holds for every earlier pushed head (SC-004)

**Checkpoint**: all five stories delivered

---

## Phase 8: Polish & Cross-Cutting Concerns
Story issue: #249

- [ ] T057 Run quickstart.md §1–§3 in full from the repo root: `node core/scripts/check-carriers.ts --base origin/main` (builder listed, 0 failures), `npm test --prefix core`, `npm test --prefix builder`, `npm test --prefix planner`; record SC-001–SC-005 results in `specs/217-rebuild-issue-tackle/quickstart.md`'s check log
- [ ] T058 [P] Confirm `specs/217-rebuild-issue-tackle/contracts/step-script.md` and `contracts/skill.md` match the shipped `builder/plugin/scripts/step.ts` output and `builder/plugin/skills/issue-tackle/SKILL.md`; fix the contract where the code is right
- [ ] T059 [P] Confirm the #174 coordination (T002) landed: `orchestrator/plugin` reads the state paths from core `orchestrator-paths.ts` and its Stop hook calls core `readStoryStopFacts` and `storyStop`; if not, comment on #174 naming what is missing

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (own PR) before US2; T002 any time before #174's Stop hook PR; T003 gates US2
- **Foundational (Phase 2)**: empty
- **US1 (Phase 3)**: starts at once; one PR, merged before US3
- **US2 (Phase 4)**: after T001, T003 (#174 carrier merged)
- **US3 (Phase 5)**: after US2 and US1
- **US4 (Phase 6)**: after US3, #212, and reviewer's ADR-0014 d1 and ADR-0017 work
- **US5 (Phase 7)**: after US4 (SC-004's pushed heads need US4)
- **Polish (Phase 8)**: after US5

### Within each story

- Test tasks are written and seen to fail before their implementation task
- `lib/step.ts` (pure) before `lib/facts.ts` (reads) before `scripts/step.ts` (entry) before `SKILL.md`
- US3 and US4 each edit `builder/plugin/lib/step.ts`, `builder/plugin/lib/facts.ts` and `SKILL.md`: sequential

### Parallel Opportunities

- US1: the B sections touch different files except B1/B3/B4/B7 (`core/src/identity.ts`), B2/B7 (`planner/plugin/scripts/land.ts`) and B5/B6 (`core/src/validation/required-checks.ts`) — B2, one of B5/B6 and one of B1/B3/B4 in parallel at a time, B6 after B5; B7 after B1, B2, B3 and B4
- US2: T019, T020, T021 in parallel after T018; T022, T023, T024 in parallel
- US3: T030, T031, T032, T033, T034, T035 in parallel (T030/T031/T033 and T032/T034 each one file: write each file's in one sitting)
- US4: T043–T047 in parallel; T052 in parallel with T050–T051

---

## Parallel Example: User Story 1

```bash
# Independent B sections, different files:
Task: "B2: failing storyTasks cases in core/tests/tasks.test.ts, then core/src/contracts/tasks.ts"
Task: "B5: failing internalReviewAt cases, then core/src/validation/required-checks.ts"
Task: "B1: failing storyBranchName cases in core/tests/branch.test.ts, then core/src/identity.ts"
```

## Parallel Example: User Story 3

```bash
Task: "step.test.ts part 1: argument refusal and JSON output"
Task: "step.test.ts part 2: decideStep stages 1–8"
Task: "facts.test.ts: reads against fake GitHub and scratch repos"
```

---

## Implementation Strategy

### MVP First

1. Phase 1 (K amendment, #174 coordination, #174 carrier gate)
2. US1 (B1–B7, one PR)
3. US2: builder becomes a carrier, Python tests gone
4. US3: **STOP and VALIDATE** — the step derives everything from `<s>` and stops correctly (MVP)

### Incremental Delivery

1. US3 → the skill takes `<s>` alone, cuts the right branch, refuses wrong lanes and folders
2. US4 → resumes from GitHub, ends at an attested draft, root-cause-check retired
3. US5 → rescopes reach stories in flight by merge only

---

## Notes

- builder writes only commits, ticks, the worktree add of R8 (with its branch) and core's remote-tracking fetches (R16) (P6); a task that would push, open a PR or write a lane is wrong
- Planner adds the `Story issue: #<s>` label lines under each phase heading when it lands this file; do not add them by hand
