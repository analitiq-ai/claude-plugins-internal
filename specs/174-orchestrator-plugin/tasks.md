---

description: "Task list for the orchestrator plugin carrying core"
---

# Tasks: The orchestrator plugin carries core

**Input**: Design documents from `specs/174-orchestrator-plugin/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Constitution Principle IV and plan's Constitution Check: every task starts from a failing
`node:test` against core's fake GitHub (`core/tests/support/fake-github.ts`) or a recorded hook input. A test task
is run and seen to fail for the stated reason before its implementation task starts.

**Organization**: One phase per user story. Every task marked **core PR** lands in `core/` as its own PR, merged
before the story PR that first calls it (plan: Delivery order). The managed-settings change (T005) is a governing
rule and lands as its own PR before Story 1 (Principle VI).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1–US5, as spec.md numbers them

## Path Conventions

- Plugin (installed): `orchestrator/plugin/` — `hooks/`, `lib/`, `commands/`, `.claude-plugin/`, `core` link
- Tests (not installed): `orchestrator/tests/`
- Shared code: `core/src/`, tests in `core/tests/`
- Hook entry files export `run(input, deps)` and wire real dependencies only under `import.meta.main`, so tests
  drive them with a recorded stdin and the fake GitHub (R3); a subprocess test covers exit codes and the guard.

---

## Phase 1: Setup (Shared Infrastructure)
Story issue: #211

**Purpose**: the orchestrator component and its carrier shape (R1, R2)

- [ ] T001 Create `orchestrator/package.json`, `orchestrator/tsconfig.json` and `orchestrator/package-lock.json` copying `planner/package.json` and `planner/tsconfig.json`: script `"test": "tsc -p . && node --test 'tests/**/*.test.ts'"`, dev pins `@types/node` and `typescript` at planner's exact versions, Node ≥ 22.18 type stripping, no build step
- [ ] T002 [P] Create `orchestrator/plugin/package.json` with `"type": "module"` and dependencies pinned exactly to core's runtime pins in `core/package.json` (`zod` 4.6.7, `yaml` 2.9.1, `smol-toml` 1.9.1), then generate `orchestrator/plugin/package-lock.json` with `lockfileVersion: 3` (`npm install --lockfile-version 3` in `orchestrator/plugin/`)
- [ ] T003 [P] Create the symlink `orchestrator/plugin/core -> ../../core/src` and `orchestrator/plugin/.claude-plugin/plugin.json` with `name: "orchestrator"` and pinned `version: "0.1.0"`, shaped as `core/tests/fixtures/carrier-plugin/.claude-plugin/plugin.json`
- [ ] T004 [P] Add `{"name": "orchestrator", "source": "./orchestrator/plugin", …}` to `.claude-plugin/marketplace.json`, matching the other entries' fields (FR-004)

---

## Phase 2: Foundational (Blocking Prerequisites)
Story issue: #211

**Purpose**: the managed settings, the guard, hook I/O, settings, the in-memory orchestrator token and keyed
comments, which every story's hooks use

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [ ] T005 **Own PR (M), governing rule, before any US1 PR.** In `SECURITY.md` §5 replace `/tmp/verify-b-ghsess` with `~/.local/state/codeworks/orchestrator` in sandbox `denyWrite` and in the `Edit(...)` deny, and add `"GH_CONFIG_DIR": "~/.local/state/codeworks/orchestrator/gh"` to `env`; in `core/src/keys.ts` replace the `/tmp/verify-b-ghsess` entry of the managed-settings check with the new folder and require the `GH_CONFIG_DIR` value. First extend `core/tests/security-settings.test.ts` and `core/tests/keys.test.ts` so they fail on the old placeholder, then change the code
- [ ] T006 **core PR (read half of C6), before US1.** Export the issue-comment page read that `core/src/state.ts` makes internally (`IssueComment` list with author login, `createdAt`, `lastEditedAt`, body) as a named function, with a failing test first in `core/tests/state-read.test.ts`; `lib/keyed.ts` (T016) needs it and R11 says no exported read fits yet. Reviewer's existing state tests must still pass unchanged
- [ ] T007 [P] Write failing `orchestrator/tests/carrier.test.ts`, modelled on `planner/tests/carrier.test.ts` and `planner/tests/guarded.test.ts`: (a) every `orchestrator/plugin/hooks/*.ts` has `../lib/guarded.ts` as its first and only static import; (b) with a core package removed from a temp copy's `node_modules`, running an entry file exits 2 with stderr `core dependency <name> is not installed in <folder>` and writes nothing (US1 #3); (c) no import under `orchestrator/plugin/` resolves outside `orchestrator/plugin/` except through `core/` (FR-003); (d) no `*.py` file exists under `orchestrator/` (FR-003a)
- [ ] T008 Create `orchestrator/plugin/lib/guarded.ts` statically importing only `../core/guard.ts`, the shape of `planner/plugin/lib/guarded.ts` (copied, not imported: ADR-0001 d1); T007 passes for the guard cases
- [ ] T009 [P] Write failing `orchestrator/tests/hook-io.test.ts` per `contracts/hooks.md` Input/Output: `session_id` must be a UUID; `cwd` an absolute path; `hook_event_name` equal to the event the file serves; `prompt` (UserPromptSubmit) a string; `tool_name` (PreToolUse) equal to `Bash`; `background_tasks` (Stop) an optional array of `{type, status}`; a refusal writes exactly one stderr line prefixed `orchestrator: `; context output is `{"hookSpecificOutput":{"hookEventName":…,"additionalContext":…}}`
- [ ] T010 Implement `orchestrator/plugin/lib/hook-io.ts`: per-event Zod input schemas, `readInput(event, stdin)`, `refuse(reason)` (exit 2), `context(event, text)` (exit 0); T009 passes
- [ ] T011 [P] Implement `orchestrator/plugin/lib/paths.ts` with the state folder's paths: root `~/.local/state/codeworks/orchestrator`, `gh/`, `sessions/<session id>.json`, `push/<owner>/<name>.git`, all from an injected home directory; test first in `orchestrator/tests/paths.test.ts`
- [ ] T012 [P] Write failing `orchestrator/tests/settings.test.ts` per `contracts/orchestrator-settings.md` with Story 1's keys only (FR-007): `app_id`, `session_app_id`, `status_issue` each "integer ≥ 1"; an unknown key, a missing key or a bad value refuses as `SettingsError("codeworks.toml [orchestrator]", …)`; R5: the bootstrap reads only `app_id` and `session_app_id` from the checkout's `HEAD`, the full file is then read through `gitHubTree` at the given ref with the orchestrator App's token, every other key comes from that GitHub read only, and a differing App ID refuses naming both values
- [ ] T013 Implement `orchestrator/plugin/lib/settings.ts`: strict `OrchestratorSettings` Zod object, `bootstrapAppIds(checkout)` from `HEAD` via core `gitTree`/`readSettings`, `settleSettings(client, repo, ref, bootstrapped)` via core `gitHubTree`; T012 passes
- [ ] T014 [P] Write failing `orchestrator/tests/app-token.test.ts` (R12, FR-016a): the orchestrator App token is minted through core `mintToken` with key file `orchestrator-app.pem` (FR-006); it is held in memory and no file appears under a temp `HOME`; before each write the client re-mints when core `needsMint` holds for the held `MintedToken` (under 10 min left), using an injected clock
- [ ] T015 Implement `orchestrator/plugin/lib/app-token.ts`: `orchestratorClient(repo, settings, now)` returning a core `gitHub` client whose writes re-mint per `needsMint`; T014 passes
- [ ] T016 [P] Write failing `orchestrator/tests/keyed.test.ts` (R11): `postKeyed(writer, repo, issue, key, text)` posts a comment whose first line is `<!-- codeworks:orchestrator-reason <key> -->` only when no comment by the orchestrator App login (`[shared] orchestrator_app_login`) starts with that line; a comment with the same line by another author does not count; a GitHub no-answer refuses, never reads as "no comment"
- [ ] T017 Implement `orchestrator/plugin/lib/keyed.ts` over T006's comment read; T016 passes

**Checkpoint**: `(cd orchestrator && npm test)` passes; user stories can begin

---

## Phase 3: User Story 1 - Plugin, session token and claim (Priority: P1) 🎯 MVP
Story issue: #211

**Goal**: the plugin is a checked carrier; SessionStart, PreToolUse and UserPromptSubmit mint the read-only session
token; `/codeworks <s>` claims or resumes `<s>` and writes the session's issue record after the lane write

**Independent Test**: `node core/scripts/check-carriers.ts --base origin/main` lists `orchestrator/plugin` with 0
failures. Against the fake GitHub, SessionStart then `/codeworks <s>` for a Ready story with no hold, no blocker and
a merged spec PR leaves a session App token in the gh folder, the card In progress by the orchestrator App, and
`sessions/<id>.json` naming `<s>` with `taken: claim`.

### Unrun behaviour first (R20)

- [ ] T018 [US1] On the agent machine, install a throwaway plugin whose UserPromptSubmit hook writes its stdin to a file, plus `commands/codeworks.md`, and run `claude --setting-sources "" -p "/codeworks 212"`. Record whether the hook's `prompt` is the raw `/codeworks 212` or the expanded command, and whether `-p` accepts the command. Save the recorded input as `orchestrator/tests/fixtures/hooks/user-prompt-submit.json` and the result under R20 in `specs/174-orchestrator-plugin/research.md`. **If the raw text is not seen, stop: R20 is reopened before T034**

### Core PRs for Story 1 (each its own PR, merged before T034)

- [ ] T019 [P] [US1] **core PR C1.** Failing `core/tests/session-record.test.ts` per `contracts/session-record.md`: strict shape `v` literal 1, `repo` as `ownerAndName` accepts, `issue` positive integer, `taken` `claim` | `resume`, `at` core `Time`; the write puts text in a temp file in the folder (mode 0600, flag `wx`) then `link`s it to `<session id>.json`; a second write fails and leaves the first; the temp file is removed either way; a non-UUID session id refuses; read of an absent file returns `null`; a present invalid file refuses naming the file
- [ ] T020 [US1] **core PR C1.** Create `core/src/contracts/session-record.ts` (Zod `SessionRecord`), `core/src/session-record.ts` (`writeSessionRecord(folder, sessionId, record)`, `readSessionRecord(folder, sessionId)`), and `core/src/files.ts` holding the temp-file write extracted from `core/src/gh-config.ts` `replaceFile`, which `gh-config.ts` now calls; T019 and `core/tests/gh-config.test.ts` pass
- [ ] T021 [P] [US1] **core PR C2.** Failing cases in `core/tests/identity.test.ts`, then add to `core/src/identity.ts` the read from issue `<s>` to its story branch `<s>-us<k>-<slug>` (root ADR-0005 grammar) and its story PR through the existing `storyPr`
- [ ] T022 [P] [US1] **core PR C3.** Failing `core/tests/issue-graph.test.ts` against the fake GitHub, then `core/src/issue-graph.ts`: `blockedBy(client, repo, issue)` and `subIssues(client, repo, issue)` returning issue numbers, every page read, a GitHub no-answer refusing (never empty)
- [ ] T023 [P] [US1] **core PR C4.** Failing cases in `core/tests/board.test.ts`, then add `moveCard(client, repo, issue, lane)` beside `laneOf` in `core/src/board.ts`, writing the project's status field; a card absent from the board refuses as `LaneRefused`

### Session token (FR-009–FR-011, R6–R7)

- [ ] T024 [P] [US1] Write failing `orchestrator/tests/session-token.test.ts`: `ensureSessionToken(checkout, now, deps)` reads the repository from the checkout's `origin` with core `repositoryOfRemote`; reads the gh folder with core `readGhToken`; when core `needsMint` is false it makes no GitHub call and reads no settings (E5); otherwise it reads settings (T013), mints `codeworks-session` with key `session-app.pem`, `APP_PERMISSIONS.session` and the one repository, and writes it with `writeGhToken(folder, token, shared.session_app_login)`; folder mode 0700, files 0600; a `MintError` or `GhFolderRefused` is returned as a refusal naming core's cause, and no other credential is tried (US1 #4–#6)
- [ ] T025 [US1] Implement `orchestrator/plugin/lib/session-token.ts`; T024 passes

### Start decision (FR-012–FR-013, R9, data-model StartFacts → StartDecision)

- [ ] T026 [P] [US1] Write failing `orchestrator/tests/start.test.ts` for the pure `decideStart(issue, facts)`, one case per data-model.md row: Ready + blockers done + spec PR merged and none open + no sub-issues + not done + `startable` → `start`; In progress or In review, state not held → `resume`; Ready not `startable` → refuse open holds, move Blocked, no post; Ready with spec PR open or none merged → refuse, post `spec-pr-open-<p>` / `spec-pr-unmerged-<p>`, move Blocked; Ready with sub-issues → refuse, post `parent-<s>` naming them, move Blocked; Backlog, Blocked, Done, no card, a blocker not done, or done → refuse, no write; In progress or In review, state held → refuse open holds, move Blocked, no post
- [ ] T027 [US1] Implement `decideStart` and `gatherStartFacts(client, repo, issue)` in `orchestrator/plugin/lib/start.ts`, gathering with the orchestrator client: `laneOf`, `blockedBy` + `isDone` of each, `specIssue` then `specPr`, `subIssues`, `isDone(s)`, and exactly one `readState`; T026 passes
- [ ] T028 [P] [US1] Write failing `orchestrator/tests/start-writes.test.ts` against the fake GitHub: a start moves Ready → In progress and only then writes the record `taken: claim` with `at` from `client.now()` (US1 #14); a resume writes no lane and records `taken: resume` and releases nothing (US1 #8, SC-003); a refusal posts the keyed reason before the lane write when its row says to (FR-013); a lane-write failure leaves no record
- [ ] T029 [US1] Implement `applyStart(decision, deps)` in `orchestrator/plugin/lib/start.ts` performing writes in data-model.md's order (reason → lane → record); T028 passes

### Hooks (contracts/hooks.md)

- [ ] T030 [US1] Create `orchestrator/plugin/hooks/hooks.json` with SessionStart → `session-start.ts` timeout 60 `"onFailure": "block"`; UserPromptSubmit → `prompt.ts` timeout 120 `"onFailure": "block"`; PreToolUse matcher `Bash` → `pre-tool-use.ts` timeout 60 `"onFailure": "block"`; each command `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`
- [ ] T031 [P] [US1] Write failing `orchestrator/tests/session-start-hook.test.ts`: success leaves a token in the gh folder; on a mint failure the hook calls `postKeyed` on `status_issue` with key `session-start-<cause>` and exits 0 (FR-008); stdin fixture under `orchestrator/tests/fixtures/hooks/session-start.json`
- [ ] T032 [P] [US1] Write failing `orchestrator/tests/pre-tool-use-hook.test.ts`: with ≥ 10 min left no GitHub call is made; with < 10 min left a new token is written before exit 0; a failed mint exits 2 naming core's cause (US1 #5–#6)
- [ ] T033 [P] [US1] Write failing `orchestrator/tests/prompt-hook.test.ts` from T018's fixture: mint first, refusing on failure; `^/codeworks ([1-9][0-9]*)$` claims and emits `[orchestrator] <s> claimed: run builder:issue-tackle <s>` (US1 #7); a record naming `<s>` emits `resumed` without re-deciding; a record naming another issue refuses naming it (US1 #13); a prompt starting `/codeworks` that misses the grammar refuses naming the grammar; any other prompt passes after the mint; each refusal row of T026 refuses with its reason (US1 #9–#12)
- [ ] T034 [US1] Implement `orchestrator/plugin/hooks/session-start.ts`, `orchestrator/plugin/hooks/pre-tool-use.ts` and `orchestrator/plugin/hooks/prompt.ts`: each imports `../lib/guarded.ts` first and every other module by `await import(...)`, reads input via `hook-io.ts`, calls `ensureSessionToken`, and (prompt) `readSessionRecord` → `gatherStartFacts` → `decideStart` → `applyStart`; T031–T033 and T007 pass
- [ ] T035 [P] [US1] Create `orchestrator/plugin/commands/codeworks.md` (R20): its body tells the model only to take the hook's `[orchestrator]` context as its step; it states no fact of its own
- [ ] T036 [US1] Run `node core/scripts/check-carriers.ts --base origin/main` and confirm `2 carriers checked …, 0 failures`; on a scratch branch change a line in `core/src` without bumping `orchestrator/plugin/.claude-plugin/plugin.json` and confirm it fails naming that file (US1 #1–#2, SC-001); run the `jq` check from quickstart.md §1
- [ ] T037 [US1] Run quickstart.md §4 on the agent machine (after T005 and C1–C4 are merged): token file names the repository with expiry ≤ 1 h; `gh api /installation/repositories` lists one repository; card In progress by `codeworks-orchestrator[bot]`; `sessions/<id>.json` holds `"taken": "claim"`; `/codeworks <other>` refused naming `<s>`

**Checkpoint**: Story 1 is shippable alone; no push yet (spec Assumptions)

---

## Phase 4: User Story 2 - Push and open the draft PR (Priority: P2)
Story issue: #212

**Goal**: the Stop hook pushes passed commits by the agent identity from a hook-owned copy with an in-memory
orchestrator token and opens the draft PR; builder stops pushing

**Independent Test**: against the fake GitHub with a passed-commit record naming two agent-identity commits, a Stop
run pushes both from the copy and opens a draft PR with `Closes #s`; adding a commit by another author pushes
nothing and refuses the stop naming it.

### Unrun behaviour first (R13)

- [ ] T038 [US2] On the agent machine, before C7 lands: start a `run_in_background` reader before the turn ends that, during a Stop hook holding a token in its child's `GH_TOKEN`, tries `/proc/<pid>/environ` of the git child and of the Stop hook's own process. Record the outcome under R13 in `specs/174-orchestrator-plugin/research.md`. **If either is readable, stop: R13 is reopened before T040**

### Core PRs for Story 2

- [ ] T039 [P] [US2] **core PR C7.** Failing cases in `core/tests/git.test.ts`, then add to `core/src/git.ts` a push that passes an in-memory token to `gh auth git-credential` through the child's `GH_TOKEN` alone, reusing `pushWithGhCredential`'s credential path; no file is written and the parent's environment is unchanged
- [ ] T040 [P] [US2] **core PR C12.** Passed-commit record: the contract for reviewer's commit-check passes (reviewer ADR-0002 d2, ADR-0003 d2) in `core/src/contracts/` with its reader in `core/src`, failing tests first in `core/tests/`. Its shape is not in this feature's `contracts/`; settle it with reviewer's records in that PR before writing code

### Push (FR-016–FR-018, R13–R14, data-model PushPlan, AgentIdentity)

- [ ] T041 [P] [US2] Write failing `orchestrator/tests/push.test.ts`: `readAgentIdentity` runs core `runGit` with `config --file <resolved ~/.gitconfig> --no-includes --get user.name|user.email`; exit 1 or empty value refuses naming the key (US2 #3); pure `decidePush({commits, passed, identity, stage})` returns `push {branch, head}` only when every new commit is in `passed` and its author and committer equal the identity, otherwise `refuse {commit, cause}` and pushes nothing (US2 #2, SC-004)
- [ ] T042 [US2] Implement `readAgentIdentity` and `decidePush` in `orchestrator/plugin/lib/push.ts`; T041 passes
- [ ] T043 [P] [US2] Write failing `orchestrator/tests/push-copy.test.ts` with real temp git repositories: the story branch is fetched from the model's clone into the bare `push/<owner>/<name>.git` with `--no-tags`; the push uses T039's push with the in-memory token; after the first push a draft PR is opened against the fake GitHub whose body carries `Closes #s` and the session's id trailer, and a later session's first push adds its own trailer (FR-018)
- [ ] T044 [US2] Implement `pushFromCopy` and `openDraftPr` in `orchestrator/plugin/lib/push.ts`; T043 passes

### Stop hook (FR-016b, contracts/hooks.md)

- [ ] T045 [US2] Add Stop → `stop.ts` to `orchestrator/plugin/hooks/hooks.json` with `"timeout": 3900` and no `onFailure` (fails open)
- [ ] T046 [P] [US2] Write failing `orchestrator/tests/stop-hook.test.ts`: a running `workflow` in `background_tasks` → no push, no step, exit 0 (US2 #4); no `background_tasks` field → no push, card to Blocked naming the missing field via `postKeyed` then `moveCard`, exit 0; passed commits → pushed and draft PR opened (US2 #1); a failing commit → exit 2 naming commit and cause; a thrown error → exit 1; repository and issue come from the session record
- [ ] T047 [US2] Implement `orchestrator/plugin/hooks/stop.ts` (guard first, dynamic imports) calling `lib/push.ts`; T046 and T007 pass
- [ ] T048 [P] [US2] Edit `builder/plugin/skills/issue-tackle/SKILL.md` (R19, FR-024): Step 4 (line 58) reads "commit, then end the turn; the orchestrator pushes and opens the draft PR"; remove Step 6's "Mark the PR ready"

**Checkpoint**: a session on the agent machine pushes and opens the draft PR (live once #209 lands)

---

## Phase 5: User Story 3 - Attest and flip to ready (Priority: P2)
Story issue: #213

**Goal**: `internal-review` at each open PR's head from reviewer's state, EXEMPT marking, and the ready flip

**Independent Test**: fake GitHub with an INTERNAL round CLEAN at a draft PR's head: `internal-review` success from
the orchestrator App and the PR ready; a protected-path PR is not attested and its card goes to Blocked naming the
paths.

- [ ] T049 [P] [US3] **core PR C10.** Failing `core/tests/protected-paths.test.ts`, then a protected-path matcher in `core/src/protected-paths.ts` returning the protected paths a PR's changed files touch (orchestrator ADR-0004 d4)
- [ ] T050 [P] [US3] Add `exempt_labels` ("string[]; label names, no duplicates") to `OrchestratorSettings` in `orchestrator/plugin/lib/settings.ts`, failing case first in `orchestrator/tests/settings.test.ts`
- [ ] T051 [P] [US3] Write failing `orchestrator/tests/attest.test.ts` for pure `decideAttest(facts)`: INTERNAL or AUDIT round CLEAN or CONVERGED_PUSHBACK that core `attests` accepts for the head and no hold → success, else pending (US3 #1); protected path or fork PR → not attested from state, protected-path card to Blocked naming the paths (US3 #2); non-codeworks-App author touching no protected path, or an `exempt_labels` label applied after the head's push by a writer who is not a codeworks App (core `appLogins`, `roleOf`) → success marked "exempt", card to Blocked "exempt: an admin merges" (US3 #3); a value equal to the current check run is not rewritten (FR-019)
- [ ] T052 [P] [US3] Write failing `orchestrator/tests/ready.test.ts` for pure `decideReady(facts)`: attested draft with no hold → flip once; already flipped → nothing; after CONVERTED → flip again (US3 #4, FR-020)
- [ ] T053 [US3] Implement `decideAttest`, `decideReady` and their writes (REST check run `internal-review` at the head as the orchestrator App; `markPullRequestReadyForReview`) in `orchestrator/plugin/lib/loop.ts`; T051–T052 pass
- [ ] T054 [US3] Call the attest and ready steps from `orchestrator/plugin/hooks/stop.ts` after the push, failing cases first in `orchestrator/tests/stop-hook.test.ts`

---

## Phase 6: User Story 4 - External review, replies, merge and the wait (Priority: P2)
Story issue: #214

**Goal**: In review, module triggers, `<module>-review`, replies and resolution, stage-2 push, squash merge, and
Stop's wait up to `review_timeout`

**Independent Test**: fake GitHub with a ready, attested PR and passing required checks: card to In review, each
module triggered once; all verdicts success → squash-merged naming the head; a module silent past
`review_timeout` → card to Blocked naming it.

- [ ] T055 [P] [US4] **core PR C8.** Rulings, replies and FIX commits per thread in reviewer's snapshot: failing cases in `core/tests/snapshot.test.ts`, then `core/src/contracts/snapshot.ts` and `core/schemas/snapshot.schema.json` via `core/scripts/write-schemas.ts`
- [ ] T056 [P] [US4] **core PR C9.** Conflict-with-main finding: failing test in `core/tests/`, then the finding in `core/src/validation/`
- [ ] T057 [P] [US4] **core PR C11.** Validator request time: failing case in `core/tests/contract.test.ts`, then in `core/src/validation/contract.ts`
- [ ] T058 [P] [US4] Add `review_timeout` ("integer seconds; 1–3600; absent reads core's default 1800") to `orchestrator/plugin/lib/settings.ts`, failing cases first (3601 refuses, absent → 1800) in `orchestrator/tests/settings.test.ts`
- [ ] T059 [P] [US4] Write failing `orchestrator/tests/review.test.ts` for pure `decideReview` and `decideMerge` over core `requiredChecks`, `threadsModule`, `trigger`/`status`/`findings`: ready, attested, GREEN, no findings, no hold → In review and each module triggered once per head (US4 #1); each `<module>-review` written; a ruling on a trusted thread → reply and resolve, FIX only after its commits are pushed, PUSH_BACK/DEFER at once; an untrusted thread resolved unread with a reply saying so (US4 #2); In review, no hold, every module success at the head, GitHub allowing → squash merge naming that `sha` (US4 #4, SC-005); COULD_NOT_RUN or SILENT never read as success
- [ ] T060 [US4] Implement `decideReview`, `decideMerge` and their writes in `orchestrator/plugin/lib/loop.ts`; T059 passes
- [ ] T061 [P] [US4] Write failing stage-2 cases in `orchestrator/tests/push.test.ts`: at stage 2 `decidePush` accepts only commits a FIX ruling names or a merge of the default branch (US4 #3, FR-020b)
- [ ] T062 [US4] Add `fixCommits` and `defaultBranchMerges` inputs to `decidePush` in `orchestrator/plugin/lib/push.ts`; T061 passes
- [ ] T063 [P] [US4] Write failing `orchestrator/tests/wait.test.ts` with an injected clock and sleep (R15): while a module or required check is pending and `review_timeout` has not passed, poll every 30 s, make each reading's writes (attest, ready, review, merge), and return on a named builder step, a merge, or the timeout; past the timeout the card goes to Blocked naming the reporter (US4 #5); the orchestrator token is re-minted inside the wait per `needsMint`
- [ ] T064 [US4] Implement the wait in `orchestrator/plugin/lib/loop.ts` and call it from `orchestrator/plugin/hooks/stop.ts`; T063 passes

---

## Phase 7: User Story 5 - Bound the loop (Priority: P2)
Story issue: #215

**Goal**: counts in tagged orchestrator App snapshots on the story issue, and Blocked at a bound

**Independent Test**: fake GitHub: each named builder step posts a new snapshot; at `max_turns` the card goes to
Blocked naming the bound; an edited snapshot sends it to Blocked; a session found not ended counts toward `k_deaths`.

- [ ] T065 [US5] **core PR C6.** Parameterise core's state-comment read and post in `core/src/state.ts` (`judge`, `post`, tamper causes) by tag, App login and schema, so reviewer's state and the counts are two uses of one function set (FR-022, R17); `core/tests/state-read.test.ts` and `core/tests/state-write.test.ts` pass unchanged for reviewer, plus failing-first cases for a second tag
- [ ] T066 [US5] **core PR C6.** Add `core/src/contracts/counts.ts` per `contracts/counts-comment.md`: strict `{v: 1, since: Time, sessions: [{id: uuid, ended: boolean}], turns: integer ≥ 0, repeat: {head, findings: string[]} | null}`, tag `<!-- codeworks:orchestrator-counts -->`, rendered with sorted keys as `renderState`; test first in `core/tests/counts.test.ts`
- [ ] T067 [P] [US5] Add `max_turns` and `k_deaths` (each "integer ≥ 1") to `orchestrator/plugin/lib/settings.ts`, failing cases first in `orchestrator/tests/settings.test.ts`
- [ ] T068 [P] [US5] Write failing `orchestrator/tests/bounds.test.ts` for pure `decideBounds(snapshot, facts, settings)`: REPEAT (same head and findings) → Blocked; two turns in a row from a working lane each ending with an unattested head → Blocked; `turns` ≥ `max_turns` → Blocked; sessions with `ended: false` other than the current one ≥ `k_deaths` → Blocked (US5 #1, SC-006); `since` is the newer of the last Ready move and the last admin `/codeworks reset`, and a snapshot with an older `since` counts nothing; a new snapshot only when a field changed
- [ ] T069 [US5] Implement `orchestrator/plugin/lib/bounds.ts`: `decideBounds` plus read/post through C6; an edited or untagged newest snapshot, or an orchestrator App comment deleted after it, sends the card to Blocked naming it (US5 #2); T068 passes
- [ ] T070 [US5] Post snapshots from the hooks, failing cases first in `orchestrator/tests/prompt-hook.test.ts` and `orchestrator/tests/stop-hook.test.ts`: at the claim or resume in `orchestrator/plugin/hooks/prompt.ts`; when a hook names a builder step and just before Stop lets the session end in `orchestrator/plugin/hooks/stop.ts`

---

## Phase 8: Polish & Cross-Cutting Concerns
Story issue: #215

- [ ] T071 Run `(cd orchestrator && npm test)` and `(cd core && npm test)` and confirm both pass with `tsc -p .` clean
- [ ] T072 Run quickstart.md §1–§3 and record any deviation in `specs/174-orchestrator-plugin/quickstart.md`
- [ ] T073 Bump `orchestrator/plugin/.claude-plugin/plugin.json` `version` in every story PR that changes `core/src` or core's pins (FR-001); T036's carrier check enforces it
- [ ] T074 **Own PR, governing rule.** Update `SECURITY.md` "Open:" (line 286) and §8 to state the decisions this spec made (Stop pushes from a hook-owned copy; Stop waits in its own run), after US2 lands
- [ ] T075 Run the `git log --name-only <base>..HEAD | sort | uniq -c | sort -rn` tripwire per story PR; any file above ~3 edits gets the one-shot rewrite before review

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none
- **Foundational (Phase 2)**: after Setup; T005 (M) and T006 are separate PRs merged first; blocks every story
- **US1 (Phase 3)**: after Phase 2; T018 gates T034; C1–C4 (T019–T023) merged before the US1 PR
- **US2 (Phase 4)**: after US1 (Stop reads the session record); T038 gates T039; C7, C12 merged first
- **US3 (Phase 5)**: after US2 (needs the draft PR); C10 merged first
- **US4 (Phase 6)**: after US3; C8, C9, C11 merged first
- **US5 (Phase 7)**: after US2's Stop hook; C6 merged first; independent of US3–US4
- **Live runs of US2–US5**: after reviewer #209
- **Polish**: after the stories in scope

### Within Each Story

- Unrun-behaviour task first, then core PRs, then failing tests, then the code that passes them
- Pure decisions (`lib/`) before entry files (`hooks/`)

### Parallel Opportunities

- Phase 1: T002, T003, T004
- Phase 2: T007, T009, T011, T012, T014, T016 (test files and leaf modules)
- US1: core PRs T019/T021/T022/T023; tests T024, T026, T028, T031–T033; T035
- US2: T039, T040; tests T041, T043, T046; T048
- US3: T049, T050, T051, T052
- US4: T055–T059, T061, T063
- US5: T067, T068 (after T065–T066)

---

## Parallel Example: User Story 1

```bash
# Core PRs, each its own branch:
Task: "core PR C1: session record in core/src/session-record.ts"
Task: "core PR C3: blockedBy and subIssues in core/src/issue-graph.ts"
Task: "core PR C4: moveCard in core/src/board.ts"

# Failing tests together:
Task: "orchestrator/tests/session-token.test.ts"
Task: "orchestrator/tests/start.test.ts"
Task: "orchestrator/tests/start-writes.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1 + Phase 2 (M and the comment-read PR merged)
2. T018 (R20 run), then C1–C4
3. US1 → T036 carrier check and T037 on the agent machine
4. **STOP and VALIDATE**: SC-001 holds; claims and the session token work end to end

### Incremental Delivery

US1 → US2 (push) → US3 (attest, ready) → US4 (review, merge, wait) → US5 (bounds), each its own story PR after
its core PRs; US5 may land before US3–US4.

---

## Notes

- Every **core PR** and the two **governing-rule PRs** (T005, T074) are separate from the story PRs
- Verify each test fails for the stated reason before writing the code it grades
- No Python under `orchestrator/` (FR-003a); no import of another plugin (FR-003)
