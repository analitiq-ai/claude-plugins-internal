---

description: "Tasks for #209: reviewer writes the records the orchestrator acts on, through core"
---

# Tasks: reviewer writes the records the orchestrator acts on, through core

**Input**: Design documents from `/specs/209-rebuild-reviewer-on-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Constitution IV (test-first): every implementation task is preceded by a `node:test` task
that is run and seen failing for the expected reason before the code is written. Tests use `fakeGitHub`
(`core/tests/support/fake-github.ts`), the fake `ledger` added in T004 (`core/tests/fixtures/state/ledger.ts`), the
issue builders (`core/tests/fixtures/state/issue.ts`) and real temp git repositories (R17). "qs #n" is quickstart.md's
scenario n.

**Organization**: Delivery order is the plan's: B → C → S → US1 → US2 → US3 → US4 → CUT. All four stories are P1;
US2 precedes US3 because the fence is the first step of US2's after-commit check (R11). Until CUT, every TS hook
entry is unregistered: `reviewer/plugin/hooks/hooks.json` and every `reviewer/plugin/scripts/*.py` stay untouched, so
one runtime decides each hook run at every merge (plan, Delivery order).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US4 from spec.md

## Path Conventions

- Core: `core/src/`, `core/tests/`, `core/scripts/`, `core/schemas/`
- reviewer plugin code: `reviewer/plugin/` (`hooks/`, `lib/`, `lib/rules/` pure, `lib/check/`, `lib/round/`)
- reviewer tests: `reviewer/tests/*.test.ts`, run by `reviewer/package.json` (`tsc -p . && node --test 'tests/**/*.test.ts'`)

---

## Phase 1: Setup (prerequisites already on main or external)

**Purpose**: Record what this spec's code rests on; nothing is built here.

- [x] T001 ADR amendments merged (#259: ADR-0001 d2, ADR-0003 d1, ADR-0004 d4, ADR-0008, ADR-0013 d4; #290: ADR-0011, ADR-0013 d1–d3); no amendment pending (VP-006)
- [x] T002 #174's session issue record on main: `core/src/session-record.ts` `readSessionRecord(folder, sessionId)` → `SessionRecord {v, repo, issue, taken, at}` (`core/src/contracts/session-record.ts`), `taken` one of core's `Taken`; `SessionRecordRefused` on invalid content; `core/src/orchestrator-paths.ts` `sessionsFolder` (R10)
- [ ] T003 External, gates US2's protected-path step only (T060): #177 US5 (`specs/177-plan-adr-check` T050–T052) merged, giving `protectedPaths(changedFiles, {tickOnly, adrFolders})` in `core/src/protected-paths.ts` and core's `isTickOnly`; today `protectedPaths` takes `changedFiles` alone

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work starts until this phase is complete. PR B, PR C and PR S are separate PRs, merged in that order (Principle VI, FR-016).

### PR B — core: the ledger record (R5–R8, FR-016, FR-022, FR-023, FR-025)

- [ ] T004 Create `core/tests/fixtures/state/ledger.ts` (R17): an in-memory `ledger` branch on `fakeGitHub` answering GraphQL `ref(qualifiedName: "refs/heads/ledger")` (null when absent), `object(oid).history(path:)` paged against one oid with `oid`, `committedDate`, `parents`, `signature { isValid wasSignedByGitHub }` and the directory's tree at the commit and its first parent (`entries { name oid }`), blob texts by oid, REST `GET /repos/{o}/{r}/commits?sha=&path=` with `author.login`, collaborator role reads, and `createCommitOnBranch` with `expectedHeadOid` refusal (head moved) and a settable `signature` answer; builders `eventCommit`, `clearanceCommit`, `invalidCommit` (unsigned, other author, modifying, deleting); the recorder keeps every POST so a test can assert none to `/issues/*/comments`
- [ ] T005 [P] Red tests in new `core/tests/ledger-event.test.ts` per [contracts/ledger-record.md](contracts/ledger-record.md#events): `LedgerEvent` accepts each kind (`round`, `ruling`, `ruling-commit`, `pushback`, `hold`, `release`, release of a tamper, `gates`) with `v: 1`; `eventFile` names each as the table gives (`round.<run>.json`, `ruling.<r>.<h(key)>.json`, `ruling-commit.<r>.<h(key)>.<commit>.json`, `pushback.<r>.<h(key)>.json`, `hold.<id>.<since>.json`, `release.<id>.<since>.json`, `release.tamper-<oid>.json`, `gates.<ref>.json`), "`<since>` is a `Time` written `YYYYMMDDTHHMMSSZ`; `<h(x)>` is the SHA-256 hex of `x`'s UTF-8; `<r>` is `<stage>-<n>` of a `RoundId`"; rejects an id, run or ref not matching `[A-Za-z0-9._-]+`; event text is "the event's JSON, keys sorted, two-space indent, trailing newline"
- [ ] T006 [P] Red tests in new `core/tests/gates.test.ts` per [contracts/gates-snapshot.md](contracts/gates-snapshot.md#shape): `Gates` accepts `{branch: "42-us1-login", anchor, lineages: [], bugs: []}` and a full lineage and bug; rejects duplicate lineage or bug ids, a non-`Time` time, an `anchor` not 40 hex, a `Site` missing `file`, `line`, `function` or `does`, `deep` neither null nor `{same_operation, callers}`, a ruling `issue` neither null nor a number
- [ ] T007 [P] Red tests in `core/tests/snapshot.test.ts`: `Round` requires `run` matching `[A-Za-z0-9._-]+`; `Snapshot` requires `gates` (null or a valid `Gates`); `Hold.question` is set exactly on `escalation`, `claim`, and `rescope` with `spec_pr` null, and is refused on `pushback`, `audit`, `shim` and on a `rescope` with a `spec_pr` (ADR-0013 d4–d5)
- [ ] T008 [P] Red test in `core/tests/values.test.ts`: `FindingRuling` has `ESCALATE` ("the assessor cannot rule the finding; an admin decides"), reviewer ADR-0017 d2, root ADR-0010
- [ ] T009 [P] Red tests in new `core/tests/state-read.test.ts` for the fold (R6, FR-022, [contracts/ledger-record.md](contracts/ledger-record.md#fold)) on T004's fake: no `ledger` ref → `LedgerMissing` naming orchestrator `README.md` step 6 (qs #8); no `issues/42/` → `snapshot: null`; event commits applied oldest first, within a commit in the table's kind order then by name; each event read from the blob at the commit that added it; an unsigned commit, one by another author, one modifying or deleting a file, one adding a file not named `eventFile(event)` or an event that does not apply → invalid: fold unchanged, `tamper-<oid>` derived with `remaining` its added or changed files still at `head`, cause `{cause: "tampered", commit, remaining}` (qs #3); a clearance (GitHub-signed, `roleOf` admin, deleting only files an earlier invalid commit added or changed) changes nothing and empties `remaining`; an admin's deletion of an event file no invalid commit added is invalid, the deleted event still in the fold (qs #14); GraphQL and REST disagreeing on the commit set → could not run; every page read against the one `head` oid; a hold's release floor is its placing commit's `committedDate`; a tamper's floor is the earlier of its commit's `committedDate` and the first GitHub-signed commit after it, so an invalid commit dated a year ahead is releasable after its clearance (qs #26); `BoardNotVisible` unchanged; frozen `v: 1` histories in new `core/tests/fixtures/state/v1/` fold to the same answer (qs #25)
- [ ] T010 [P] Red tests in `core/tests/state-write.test.ts`, replacing every comment-post case, per [contracts/ledger-record.md](contracts/ledger-record.md#writes): each write makes at most one `createCommitOnBranch` with `fileChanges.additions` only, `expectedHeadOid: reading.head`, headline `issues/<n>: <kinds>`, and returns the advanced reading (`head` the new oid) with no second fold; an answer not `isValid && wasSignedByGitHub` → `StateWriteUnsigned` naming the oid (qs #7); a refused mutation with the ref moved → `StateStale` carrying the new head, unmoved → GitHub's refusal as it came; a retry whose events are in the fold commits nothing (qs #6); every write refuses with an unreleased tamper, naming `remaining`, the admin's deletion, a Ready move and an admin comment after the invalid commit, then the claim; `writeState` derives `round`/`ruling`/`ruling-commit`/`pushback` events from `checkTransition`, stamps new rounds' `at` from `w.now()`, refuses a hold or `gates` differing from `reading`'s; `placeHold` refuses `rescope` and an `escalation`/`claim` with no question, commits nothing for an OPEN row; `placeRescopeHold(…, reading, {question} | {specPr})` per ADR-0013 d5 (verdict: nothing when OPEN; spec PR: nothing for a number already recorded, released or not); `recordGates(…, reading, ref, gates, openings)` commits `gates.<ref>.json` plus a `hold` event per opening not OPEN, reopening a RELEASED row in place (one row per id), leaving an OPEN one, committing `gates` regardless; the recorder holds no issue or PR comment (SC-006)
- [ ] T011 [P] Red tests in `core/tests/release.test.ts`: `releaseOnClaim(…, reading)` → one commit of a `release` event per releasable hold and releasable tamper, `ClaimRelease {released, reset}` (no `rebuilt`); nothing releasable → no commit; `/codeworks reset` → `released_by.reset: true`; a tamper whose `remaining` is non-empty, with Ready move and admin comment after it, refuses naming its `remaining` files; after a clearance the next call commits `release.tamper-<oid>.json` (qs #13, FR-024)
- [ ] T012 [P] Red test in `core/tests/tokens.test.ts`: `APP_PERMISSIONS.reviewer` deep-equals `{ contents: "write" }` (FR-023); `core/tests/security-permissions.test.ts` keeps pinning SECURITY.md §3 to the map
- [ ] T013 Create `core/src/contracts/ledger.ts` (Zod `LedgerEvent` union on `kind`, payloads from `core/src/contracts/snapshot.ts`, `eventFile(event)`, the event text rendering) (T005 green)
- [ ] T014 Create `core/src/contracts/gates.ts` (Zod `Gates`, `Lineage`, `Bug`, `Site` exactly as contracts/gates-snapshot.md; ids unique within each list; times core `Time`; shas 40 hex); in `core/src/contracts/snapshot.ts` add `run` to `Round`, `gates: Gates.nullable()` to `Snapshot`, and the `question` rule of T007 (T006, T007 green)
- [ ] T015 Add `ESCALATE` to `FindingRuling` in `core/src/values.ts` (T008 green)
- [ ] T016 Replace the state comment with the fold in `core/src/state.ts` (T009 green): `readState(reader, repo, issue, shared)` keeps its signature and the issue reads (`issueComments`, timeline, project items, `roleOf`, `BoardNotVisible`, `judge`'s release rule `releaseTerms`/`releaseOf`/`readyAfter`/`adminCommentAfter`/`questionTag`/`RESET_COMMAND`); `StateReading` gains `head`, `tamper: Tamper[]` and loses `rebuilt`, `comment_url`, `tamper_released`; `StateCause` becomes `{cause: "tampered"; commit; remaining} | {cause: "open_hold"; id}`; add `LedgerMissing`; export a read of whether any commit between two `ledger` oids touched `issues/<n>/` for R3's re-point; delete `snapshotOf`, `STATE_TAG`, `renderState`, `COMMENT_LIMIT`, the deletion-based tamper, `post` and `untamperedSnapshot`
- [ ] T017 Rewrite the writes in `core/src/state.ts` (T010, T011 green): one private `commitEvents(writer, repo, issue, reading, events)` as R7 gives it, the only path to `ledger`; `writeState`, `placeHold`, `placeRescopeHold`, `recordGates`, `releaseOnClaim` take the reading and return the advanced reading (`releaseOnClaim` returns it beside `ClaimRelease`); add `StateStale` (new head) and `StateWriteUnsigned` (oid)
- [ ] T018 Set `APP_PERMISSIONS.reviewer = { contents: "write" }` in `core/src/tokens.ts` and SECURITY.md §3's `codeworks-reviewer` row to `contents: write`, dropping its "until #209 lands" sentence (T012 green)
- [ ] T019 Add `ledger-event.schema.json` to `core/scripts/write-schemas.ts` and regenerate `core/schemas/` (`snapshot.schema.json` now with `gates` and `Round.run`; `Gates` a sub-schema, no file of its own); `core/tests/schemas.test.ts` drift test red first
- [ ] T020 Move `causeOf` in `orchestrator/plugin/lib/start.ts` to the new `StateCause` (a tamper names its commit, its `remaining` files and the release) and its fixtures in `orchestrator/tests/start.test.ts`, `orchestrator/tests/start-writes.test.ts` and `orchestrator/tests/support/story.ts` onto T004's fake `ledger`; red first in `orchestrator/tests/start.test.ts`
- [ ] T021 Bump the version of every plugin carrying core (`planner`, `orchestrator`; root ADR-0001) so `node core/scripts/check-carriers.ts --base origin/main` is green; `npm --prefix core test` and `npm --prefix orchestrator test` green; open and merge PR B

### PR C — core: commit-check pass record (R14, FR-014, FR-019)

- [ ] T022 [P] Red tests in new `core/tests/commit-pass.test.ts` per [contracts/commit-pass-record.md](contracts/commit-pass-record.md): `readCommitPasses(session)` → `null` with no file, throws on invalid content; `recordCommitPasses(session, {repository, issue, branch, from, shas, at})` appends every sha under `branches[branch]` not already there, oldest → newest, and sets `head` on every pass "even when its sha is already in `passes`": GitHub at A, pass B, amend to B′ and pass B′, restore B and pass B → `head` B (qs #22); refuses a `repository` differing from the file's or an `issue` differing from the branch entry's; `42-us1-login` and `43-us1-other` keep separate newest passes (qs #20); `setReviewerOff(session, repository, off)` creates a valid file when absent and refuses a differing `repository`; "folder 0700, file 0600, written by temp file + rename"
- [ ] T023 Create `core/src/contracts/commit-pass.ts` (Zod): `{v: 1, repository: "owner/name", off: boolean, branches: Record<branch, {issue: number, head: {sha: sha40, range_from: sha40, at: Time}, passes: {sha: sha40, range_from: sha40, at: Time}[]}>}`
- [ ] T024 Create `core/src/commit-pass.ts`: path `~/.local/state/codeworks/reviewer/sessions/<session id>/commit-passes.json`; `readCommitPasses`, `recordCommitPasses`, `setReviewerOff`; atomic write reusing the 0700/0600 temp + rename of `core/src/session-record.ts` `writeSessionRecord` (T022 green)
- [ ] T025 Bump the version of every plugin carrying core (`planner`, `orchestrator`); check-carriers green; open and merge PR C

### PR S — reviewer carrier, settings, run state, hook skeleton (unregistered)

- [ ] T026 Create carrier link `reviewer/plugin/core -> ../../core/src`; `reviewer/plugin/package.json` with core's exact pins (`zod 4.6.7`, `smol-toml 1.9.1`, `yaml 2.9.1`) plus `diff-match-patch`; generate v3 `reviewer/plugin/package-lock.json`
- [ ] T027 [P] Create `reviewer/package.json` (`"test": "tsc -p . && node --test 'tests/**/*.test.ts'"`, devDependencies `@types/node 22.20.5`, `typescript 7.0.2`) and `reviewer/tsconfig.json` copied from `planner/tsconfig.json` (`include: ["plugin", "tests"]`)
- [ ] T028 [P] Red tests in `reviewer/tests/settings.test.ts`: `ReviewerSettings` parses `[reviewer]` (`app_id`, `mode: "enforce"|"log"`, `claim_checks`, `shim_checks`, `decision_checks`, `max_review_files`, every other key now in `reviewer/plugin/config.json`, and `max_rounds`, `max_audits`, `k_topic`, `claim_hold_at`, `shim_deep_at`, `shim_hold_at`), rejects unknown keys (strict); a set `REVIEWER_MODE` or any other environment variable changes no key (root ADR-0002 d3)
- [ ] T029 Create `reviewer/plugin/lib/settings.ts` (`ReviewerSettings` Zod over core `section("reviewer")`, no environment read) and add `[reviewer]` to `codeworks.toml` with today's values from `reviewer/plugin/config.json` and the limits today in code: `max_rounds = 4` (`policy.py` `CAP`), `max_audits = 2` (`policy.py`), `claim_hold_at = 3` (`claimcheck.py` `REFUSALS_BEFORE_USER`), `shim_deep_at = 3`, `shim_hold_at = 4` (`shimcheck.py` `DEEP_AT`, `HOLD_AT`), and `k_topic` (T028 green)
- [ ] T030 [P] Red tests in `reviewer/tests/github.test.ts` (R2): reader from the session token `readGhToken(ghFolder(home))`; writer minted at most once per writing run via `mintToken("reviewer", app_id, "reviewer-app.pem", "reviewer", repo)` → `gitHub(minted.value)`; a mint or token-read failure is could not run; no token cached across runs
- [ ] T031 Create `reviewer/plugin/lib/github.ts` following `planner/plugin/lib/github.ts` (T030 green)
- [ ] T032 [P] Red tests in `reviewer/tests/session.test.ts`: session folder `~/.local/state/codeworks/reviewer/sessions/<session>/` created 0700; `gate.log` append; no `write.lock` and no file holding a round, hold or gates item (FR-004, data-model Session folder)
- [ ] T033 Create `reviewer/plugin/lib/session.ts` (folder, `gate.log`, marker paths `released-<issue>-<at>`) (T032 green)
- [ ] T034 [P] Red tests in `reviewer/tests/hook-io.test.ts` (R15, ADR-0006 d1): under `enforce` a refusal returns `deny` with its reason; under `log` a refusal by the commit gates or the round-launch gate appends `would_deny` to `gate.log` and does not block, while a tamper, a missing `ledger`, every could-not-run and every ADR-0012 d1 refusal deny in both modes; per-check modes (`claim_checks`, `shim_checks`, `decision_checks`) gate their own refusals; every core write and every refusal appends to `gate.log` the hook event, the call, the oid or outcome and its latency, in both modes
- [ ] T035 Create `reviewer/plugin/lib/hook-io.ts`; from `reviewer/plugin/scripts/hookio.py` keep the `refuse`/`block`/`refuse_claim` outputs, not its ledger writes or environment settings (T034 green)
- [ ] T036 [P] Red tests in `reviewer/tests/run-state.test.ts` (R3, data-model State write step, qs #6, #27): `RunState` calls `readState` once per run, holds the reading in memory only and replaces it with each write's advanced reading; on `StateStale` with `issues/<n>/` untouched since `reading.head` it re-points `head` and retries the same write with no second fold (qs #27); touched → reads and re-runs the step's decide function; the third `StateStale` refuses as could not run ("`ledger` kept moving; retry the step"); `LedgerMissing`, `StateWriteUnsigned`, `BoardNotVisible`, GitHub unanswered → could not run with refusals.md's text; nothing written to disk
- [ ] T037 Create `reviewer/plugin/lib/run-state.ts`: `step(decide, write)` over the run's reading per T036 (T036 green)
- [ ] T038 Create hook entries `reviewer/plugin/hooks/{pre-tool-use,post-tool-use,user-prompt-submit,subagent,session-start}.ts` on the pattern of `core/tests/fixtures/carrier-plugin/hooks/identity.ts` (static `guard.ts` import, `requireDependencies()`, dynamic core import), each reading hook JSON and dispatching to an empty handler; red test `reviewer/tests/hooks-skeleton.test.ts` runs each entry with sample hook JSON and asserts an allow answer, and asserts `reviewer/plugin/hooks/hooks.json` names no `.ts` entry yet
- [ ] T039 Bump `reviewer/plugin/.claude-plugin/plugin.json` version; check-carriers green; open and merge PR S

**Checkpoint**: Core reads and writes the ledger record and the pass record; reviewer carries core; TS entries run but are unregistered.

---

## Phase 3: User Story 1 — A story's rounds and holds are on the ledger branch (P1) 🎯 MVP

Story issue: #235

**Goal**: Every round, hold and gates change reviewer decides lands as one reviewer App commit under `issues/<n>/` on `ledger` through core; claim/shim counts live in the gates section and land with the holds they place.

**Independent Test**: Against `fakeGitHub` + fake `ledger`, drive one internal round to CLEAN on `42-us1-login`: exactly one `createCommitOnBranch` by the reviewer client, `expectedHeadOid` the head read, adding only `issues/42/round.<run>.json`; `readState` returns it as newest; core's attestation answers success (qs #1).

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [ ] T040 [P] [US1] Red tests in `reviewer/tests/rounds.test.ts` for pure `lib/rules/rounds.ts` (R4): round report → `Round {stage, n, run, head, result, verdict}` with core's `RoundStage`/`RoundResult`/`RoundVerdict` (no repeated strings, root ADR-0010); `RESHAPE_SPEC` → `RESCOPE`; a DIRTY round's verdict by ADR-0017 d2's first-match rule, one case per clause and one where an earlier clause beats a later match: ESCALATE (a finding ruled ESCALATE, an ADR departure not ruled FIX, the assessor cannot decide, a deadlock), RESCOPE, PATCH/CLASS_FIX/REDESIGN (at least one FIX), CONVERGED_PUSHBACK (every finding PUSH_BACK or DEFER); an ESCALATE's and a RESCOPE's question says why the round was raised and what must be decided; one case per row of ADR-0013 d4's table and d5, at non-default settings so a constant in code fails: `escalation-<issue>` with question on ESCALATE and on a trusted thread answered after its ruling `k_topic` times; `pushback-<issue>` when a github round rules no FIX while a merge blocker fails at the head; `audit-<issue>` at `max_audits` escalation audits ruled other than CONVERGED_PUSHBACK; `rescope-<issue>` on RESCOPE as `{question}`, on a spec PR seen open as `{specPr}`
- [ ] T041 [P] [US1] Red tests in `reviewer/tests/counts.test.ts` for pure `lib/rules/counts.ts` (R9, contracts/gates-snapshot.md §Derived), at `claim_hold_at = 2`, `shim_deep_at = 2`, `shim_hold_at = 5` so a constant in code fails: lineage count = distinct WRONG `ref` with `at` after the newest reset, one check counting once however many claims it ruled; `claim-<id>` opening at `claim_hold_at` with the last WRONG's failing case and evidence as its question; a RELEASED `claim-<id>` opened again only by a WRONG `ref` later than its release, including one on its words; bug count over `members[].at` after the reset; deep sweep due at `shim_deep_at`; `shim-<id>` at `shim_hold_at`; a RELEASED `shim-<id>` opened again by the check of the next commit touching its `ranges`; a moved file starts its counts again (ADR-0001 d2); merging bugs of 2 and 3 members yields 3, not 5, and no `shim-<id>` (ADR-0008 d2); the survivor is the higher count, the smaller id on a tie, keeps its `deep`, takes the other's rulings only for sites it has not ruled, the other's members go to `absorbed` and are never counted again; an ended item is dropped
- [ ] T042 [P] [US1] Red tests in `reviewer/tests/round-record.test.ts` (qs #1–#4, #7, #8, #23): CLEAN round → one commit adding only `round.<run>.json`, earlier events unchanged, `attests` true; ESCALATE → one commit adding the round and `hold.escalation-42.<since>.json`, reading held; an invalid commit under `issues/42/` → no commit, refusal names the commit, its `remaining`, the clearance, Ready move and admin comment; a new session folder → hold still OPEN and no reviewer file holds rounds, holds or gates; unsigned answer → could not run naming the oid; no `ledger` ref → could not run naming README step 6, nothing created; the recorder holds no issue or PR comment
- [ ] T043 [P] [US1] Red tests in `reviewer/tests/gates-record.test.ts` (qs #5, #6): gates with WRONG rulings from 2 checks + a third check's WRONG → one commit with `gates.<ref>.json` and `hold.claim-<id>.<since>.json`; the same tree re-checked in a new session adds no count; a check on a branch other than the gates' `branch` stops with an error naming both, nothing recorded; a released `shim-<id>`'s new member and its placing again land in one `recordGates` call; a claim check completed after a shim check carries the bugs' `ranges` to its head as the new `anchor`, and vice versa; `placeHold(claim-7)` and a round from one reading → the second is `StateStale`, decides again, both events in the fold
- [ ] T044 [P] [US1] Red tests in `reviewer/tests/launch.test.ts` for pure `lib/rules/launch.ts`, at non-default `max_rounds` and `max_audits`: a round launch is refused while a hold whose ADR-0013 d4 "Refuses" column names rounds is OPEN (`escalation-`, `pushback-`, `audit-`), naming the hold id and its release, and not for `claim-`, `shim-` or `rescope-`; refused while an unreleased tamper stands; refused while the session's issue is in Blocked or Backlog (ADR-0015 d3) and while reviewer is off (ADR-0006 d4); past `max_rounds` a stage's next round runs the audit stage on the whole PR (ADR-0019 d5); the count is reset only by an admin's release or `/codeworks reset`
- [ ] T045 [P] [US1] Red tests in `reviewer/tests/tool-gate.test.ts`: tool writes to `codeworks.toml` or the reviewer state folder refused naming the owner (ADR-0012 d1); every `Workflow` launch naming `review-round`, `claim-check` or `shim-check` rewritten to that name and the gate's args, `script`, `scriptPath` and `resumeFromRunId` dropped, and recorded (ADR-0021 d1); those launches refused while reviewer is off (ADR-0006 d4); PostToolUse `Workflow` records the run ID only for a recorded launch, invalid when its ID was seen before or `tool_response.scriptPath` differs from the plugin's file, so its verdicts never count (ADR-0021 d2)

### Implementation for User Story 1

- [ ] T046 [P] [US1] Create `reviewer/plugin/lib/rules/rounds.ts` (T040 green)
- [ ] T047 [P] [US1] Create `reviewer/plugin/lib/rules/counts.ts`, porting the count rules from `reviewer/plugin/scripts/claimgate.py`, `shimgate.py`, `claimcheck.py`, `shimcheck.py` over core's `Gates`; thresholds from `ReviewerSettings`, none in code (T041 green)
- [ ] T048 [P] [US1] Port `reviewer/plugin/scripts/lineage.py` to `reviewer/plugin/lib/check/lineage.ts` on npm `diff-match-patch`; re-pin `reviewer/tests/test_lineage.py` behaviour red first in `reviewer/tests/lineage.test.ts`, plus: a lineage read back from the gates section (anchor, places, chain) is inherited by a reworded claim across a session boundary; the anchor is read from the bare copy, else fetched by sha from the model's clone, then GitHub; in none → the check stops naming the branch, the anchor and `/codeworks reset`, unless the newest reset is later than every `at` in the section, when it starts the section over anchored on its own head (contracts/gates-snapshot.md §Anchor)
- [ ] T049 [P] [US1] Port `reviewer/plugin/scripts/claimcheck.py` and `shimcheck.py` to `reviewer/plugin/lib/check/claim.ts` and `lib/check/shim.ts` (pure parts under `lib/rules/`), reading and producing core's `Gates`; running state and memos in `<session>/check.json` and `<session>/memos/*.json` (FR-017); re-pin `test_claimcheck.py`, `test_shimcheck.py` behaviour red first in `reviewer/tests/claim-check.test.ts`, `reviewer/tests/shim-check.test.ts`
- [ ] T050 [P] [US1] Port `reviewer/plugin/scripts/reshape.py`, `decisions.py`, `adrkit.py`, `assessment.py`, `facts.py` to `reviewer/plugin/lib/round/{assess,decisions}.ts` and `lib/rules/reshape.ts`, each `ledger.py` read replaced by the `RunState` reading; re-pin `test_reshape.py`, `test_decisions.py`, `test_adrkit.py`, `test_assessment.py`, `test_worktree_facts.py` red first in matching `reviewer/tests/*.test.ts`; `specbinding.py` is not ported (ADR-0014 d1): `lib/rules/spec-source.ts` derives story issue, spec issue and spec folder from the branch through core `parseBranch`, red first in `reviewer/tests/spec-source.test.ts` (a `<p>-spec` branch or one outside the grammar is refused a round), re-pinning only what of `test_spec_source.py` agrees with ADR-0014 d1
- [ ] T051 [P] [US1] Port `reviewer/plugin/scripts/jev.py`, `briefs.py`, `worktree.py`, `shell.py`, `snapshot.py`, `sweeper_read.py` to `reviewer/plugin/lib/{jev,briefs,worktree,shell}.ts`, `lib/check/snapshot.ts` (exporting from the bare copy) and `lib/rules/sweeper-read.ts`; `briefs.ts` reads state through `RunState` and runs as `node ${CLAUDE_PLUGIN_ROOT}/lib/briefs.ts --ref '<round_ref>'` with the same `brief_token` output; repoint `reviewer/plugin/agents/assessor.md`'s brief command to it and drop "the ledger" from its facts line; re-pin `test_jev.py`, `test_worktree.py`, `test_shell.py`, `test_shim_snapshot.py`, `test_sweeper_read.py`, `test_agents.py` red first in matching `reviewer/tests/*.test.ts`
- [ ] T052 [US1] Create `reviewer/plugin/lib/rules/launch.ts` from ADR-0013 d4 and ADR-0019 d5 over core's `StateReading`, `max_rounds` and `max_audits` from `ReviewerSettings`; `policy.py`'s cap lock, its reset at a settled round, `spec_held` and separate `assess-round` launch are not ported (ADR-0019 d1, d5; ADR-0014 d1) (T044 green)
- [ ] T053 [US1] Create `reviewer/plugin/lib/round/record.ts`: round report / assessment → `writeState` (round named by its recorded workflow run), `placeHold`, `placeRescopeHold` with the minted writer, each through `RunState.step` and each hold per T040's rules; the github round's merge blockers and trusted threads read only through core's validator modules (`required-checks`, `threads`; ADR-0016); a rescope's open spec PR found per ADR-0013 d5; refusals per refusals.md (T042 green)
- [ ] T054 [US1] Create `reviewer/plugin/lib/round/gates.ts`: claim/shim results → one `recordGates(…, reading, ref, gates, openings)` through `RunState.step`, `openings` from T041's rules (a `claim-` opening with its question); branch mismatch and anchor errors per refusals.md (T043 green)
- [ ] T055 [US1] Create `reviewer/plugin/lib/round/launch.ts` and wire `reviewer/plugin/hooks/pre-tool-use.ts`: T045's refusals and rewrite, story-branch `spec.md` edit, round launch gate (T052), output validation; `Read|Glob|Grep` sweeper confinement (contracts/hooks.md) (T045 green)
- [ ] T056 [US1] Wire `reviewer/plugin/hooks/post-tool-use.ts` `StructuredOutput` branch to `round/record.ts` and `round/gates.ts` and its `Workflow` branch to T045's run-ID record; wire `reviewer/plugin/hooks/subagent.ts` (in-flight reviewer tracking) and `reviewer/plugin/hooks/session-start.ts` (off-switch notice)
- [ ] T057 [US1] Port `reviewer on|off` to `reviewer/plugin/hooks/user-prompt-submit.ts`, writing the switch with core `setReviewerOff`; no `unlock …` or `override shim-…` prompt (FR-008); re-pin `test_switch.py` behaviour red first in `reviewer/tests/switch.test.ts`
- [ ] T058 [US1] End-to-end test `reviewer/tests/e2e-round.test.ts` (SC-001): with the session record faked as a claim of `#42`, drive the TS entries from a round launch through a CLEAN internal round; core `attests` answers success for the head with no admin act, and the recorder holds no reviewer comment

**Checkpoint**: US1 independently testable against the recorder; the orchestrator can attest from the fold once CUT registers the entries.

---

## Phase 4: User Story 2 — Only commits that passed the commit check are pushed (P1)

Story issue: #236

**Goal**: The after-commit check over a hooks-owned bare copy grades `base..head` and records every commit of a passing range in the commit-check pass record.

**Independent Test**: Commits A, B, C on a story branch; A passes, B fails, C passes → record names A, then A, B, C, newest C (qs #15).

### Tests for User Story 2 ⚠️

- [ ] T059 [P] [US2] Red tests in `reviewer/tests/range.test.ts` for pure `lib/rules/range.ts` (FR-021): base = the branch's newest pass (`head`) if an ancestor of the checked head, else the branch's GitHub head if an ancestor, else refuse naming the pushed head to restore (qs #19); branch not on GitHub → merge base with the default branch; a session's first check on a branch grades from its GitHub head (qs #17)
- [ ] T060 [P] [US2] Red tests in `reviewer/tests/bare-copy.test.ts` (R13): bare copy at `<session>/repo.git` created on first use; commits taken only by `git fetch --no-tags` from the model's clone over a local path into the copy's own refs through core `runGit`, no other git command run in the clone (ADR-0021 d6); the base sha read by the API with the session token and its object fetched from the clone first, from GitHub only when the clone lacks it; fetch failure → could not run
- [ ] T061 [P] [US2] Red tests in `reviewer/tests/after-commit.test.ts` (qs #15–#17, #19–#22): A pass / B fail / C pass; could-not-run records nothing; a change touching any path core's `protectedPaths(changed, {tickOnly, adrFolders})` returns (`.github/`, `docs/adr/` at any depth or case, `CLAUDE.md`, a folder `[shared] adr_folders` lists inside the repo, the spec folder beyond TICK_ONLY) fails and records nothing, while one only ticking the story's task block passes (ADR-0002 d4); a merge of the default branch passes unless its conflict resolution touches one (ADR-0002 d3); a change to a merged story's task block fails, and after a merge of the default branch the spec folder must equal the default branch's but the story's own ticks (ADR-0015 d4); amend C→C′ graded from GitHub head, then a reset below GitHub head refused naming it; `42-us1-login` then `43-us1-other` keep separate newest passes; reviewer off → no check, nothing recorded (FR-019)
- [ ] T062 [P] [US2] Red tests in `reviewer/tests/after-commit-holds.test.ts`: an open `escalation-` or `rescope-` hold (a `rescope-` not on a default-branch merge, ADR-0013 d5) or an unreleased tamper refuses naming the hold id and its release; `claim-<id>` only when the range touches its lineage's `file`, `shim-<id>` only its bug's `ranges`, an unrelated range passing with the hold still OPEN; a pending claim/shim check refuses naming the workflow to launch and its range

### Implementation for User Story 2

- [ ] T063 [P] [US2] Create `reviewer/plugin/lib/rules/range.ts` (T059 green)
- [ ] T064 [P] [US2] Create `reviewer/plugin/lib/check/bare-copy.ts` over core `runGit` / `fetchWithGhCredential`; GitHub branch head read with the session token (T060 green)
- [ ] T065 [US2] Create `reviewer/plugin/lib/check/after-commit.ts`, the state machine `idle → fetched → based → fenced → structural → awaiting_checks → PASS | FAIL | COULD_NOT_RUN` (data-model): structural steps are holds and tampers from the run's reading, core's `protectedPaths` over the graded change (a merge's conflict resolution only) with `tickOnly` the story's `tasks.md` when core's `isTickOnly` finds its base and head versions TICK_ONLY else null, and `adrFolders` the `inside` folders of core's `adrFolders` relative to the repo root (requires T003), and ADR-0015 d4's task-block rule through core's `readTaskBlockLabels`; running state in `<session>/check.json`, memos in `<session>/memos/*.json` (FR-017); PASS → `recordCommitPasses` for every sha of the range; FAIL and COULD_NOT_RUN record nothing; the fence step is a pass-through until US3 (T061, T062 green)
- [ ] T066 [US2] Wire `reviewer/plugin/hooks/post-tool-use.ts` `Bash` branch: fetch the clone's HEAD into the bare copy's own ref and compare with that ref's sha before the command; a clone the fetch cannot read refuses the command (ADR-0020 d2); new commits run `after-commit.ts`; `StructuredOutput` claim/shim results feed the awaiting check and, on PASS, the pass record; skip the whole check while the pass record's `off` is set (FR-019)

**Checkpoint**: The orchestrator can push up to a branch's newest commit-check pass.

---

## Phase 5: User Story 3 — A session commits only on its own story's branch (P1)

Story issue: #237

**Goal**: The after-commit check's first step refuses commits off `<issue>-us`, and every commit in a session with no recorded issue (R11).

**Independent Test**: Record faked as `#42`; commits on `42-us2-logout`, `43-us1-other`, `main` → first proceeds to checks, others refused naming `#42` and `42-us`, none recorded (qs #9).

### Tests for User Story 3 ⚠️

- [ ] T067 [P] [US3] Red tests in `reviewer/tests/fence.test.ts` for pure `fence(record, branch, lane, switchOn): Allow | Refuse`: switch off → allow; no record → refuse naming `/codeworks <issue>` and `reviewer off`; branch without `<s>-us` (core `parseBranch`) → refuse naming `#<s>` and `<s>-us`; the issue in Blocked or Backlog → refuse naming the lane (ADR-0015 d3); `42-us2-logout` in a working lane → allow
- [ ] T068 [P] [US3] Red tests in `reviewer/tests/after-commit-fence.test.ts` (qs #9, #10, #18): fenced-out commits recorded as nothing; unreadable record (`SessionRecordRefused`) → could not run naming the record's path; reviewer off → fence skipped, no check; `mode = "log"` → the fence's refusal logged as `would_deny`, the commit not blocked and its range recorded as passed (ADR-0006 d1)

### Implementation for User Story 3

- [ ] T069 [US3] Create `reviewer/plugin/lib/rules/fence.ts` (T067 green)
- [ ] T070 [US3] In `reviewer/plugin/lib/session.ts` read the session record through core `readSessionRecord(sessionsFolder(home), session_id)` (null → no record; `SessionRecordRefused` → could not run, R10) and the issue's lane through core `laneOf` on `[shared] board` at each check; replace the fence pass-through in `reviewer/plugin/lib/check/after-commit.ts` with `fence.ts` as its first step (T068 green)

**Checkpoint**: SC-003 holds across the fence tests.

---

## Phase 6: User Story 4 — A Ready claim releases the holds an admin answered, once (P1)

Story issue: #238

**Goal**: Every entry that gates a commit, a round launch or a state write first calls `releaseOnClaim` once per claim, never on a resume; read-only entries and `reviewer on|off` skip it (R12, FR-007).

**Independent Test**: OPEN `claim-7` with Ready move + admin comment after its commit; record = claim; hook run twice → one commit adding `release.claim-7.<since>.json`, first run only; record = resume → none (qs #11, #12).

### Tests for User Story 4 ⚠️

- [ ] T071 [P] [US4] Red tests in `reviewer/tests/claim-step.test.ts` for pure `lib/rules/claim-step.ts`: record `taken: "claim"` and no marker `released-<issue>-<at>` → release; marker present → nothing; `taken: "resume"` or no record → nothing; a second claim of the same issue (new `at`) → release again; a second claim of another issue → its own release
- [ ] T072 [P] [US4] Red tests in `reviewer/tests/release-on-claim.test.ts` (qs #11–#13, #24): one release commit naming the comment, first run only; resume → no commit; a hold with no admin comment after it stays OPEN; `/codeworks reset` → RELEASED with `reset: true`, and a lineage with WRONG rulings before the reset needs `claim_hold_at` new ones (ADR-0013 d3); a tamper with its file still on `ledger` → hold OPEN, refusal names the file, no marker; after the admin's clearance the next claim commits `release.tamper-<oid>.json`; `releaseOnClaim` throws → could not run, no marker, next gating run retries; two first runs from one reading → one release commit (`StateStale`, retry finds it in the fold); GitHub unanswered after a claim: a `Read` call and the `reviewer off` prompt land with no release attempted, the next commit's hook refuses as could not run
- [ ] T073 [P] [US4] Red test in `reviewer/tests/claim-step-entries.test.ts`: the claim step runs first in PostToolUse `Bash`, `Workflow`, `StructuredOutput` and PreToolUse launches, and not in PreToolUse `Read|Glob|Grep`, UserPromptSubmit, Subagent* or SessionStart (contracts/hooks.md)

### Implementation for User Story 4

- [ ] T074 [US4] Create `reviewer/plugin/lib/rules/claim-step.ts` (T071 green)
- [ ] T075 [US4] Create `reviewer/plugin/lib/claim.ts`: `releaseOnClaim(…, reading)` with the minted writer through `RunState.step`, the advanced reading kept for the rest of the run, marker written after success; call it first in the gating branches of `reviewer/plugin/hooks/pre-tool-use.ts` and `post-tool-use.ts` only (T072, T073 green)

**Checkpoint**: SC-004 holds; all four stories functional on the unregistered TS path.

---

## Phase 7: Cutover (CUT, R16, FR-018)

Story issue: #238

**Purpose**: Register the TS hooks and delete the Python hook path in one PR, so one runtime decides each hook run.

- [ ] T076 Red test `reviewer/tests/hooks-json.test.ts`: every entry in `reviewer/plugin/hooks/hooks.json` is `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`, `onFailure: block`, matchers per contracts/hooks.md; no `python3`, no `pre_merge_gate.py`, no `unlock`/`override` prompt entry; update T038's skeleton test to drop its "no `.ts` entry" assertion
- [ ] T077 Rewrite `reviewer/plugin/hooks/hooks.json` per contracts/hooks.md (T076 green)
- [ ] T078 Delete `reviewer/plugin/scripts/{ledger,pre_merge_gate,gate,policy,claimgate,shimgate,hookio,config,github,lineage,claimcheck,shimcheck,reshape,specbinding,decisions,adrkit,assessment,facts,jev,briefs,worktree,shell,snapshot,sweeper_read}.py` and `reviewer/plugin/config.json`; keep `scripts/codexstate.py`; delete `test_ledger.py`, `test_pre_merge_gate.py`, `test_poller_contract.py`, `test_gate.py`, `test_policy.py`, `test_claim_gate.py`, `test_shim_gate.py`, `test_specbinding.py` and every Python test re-pinned in T048–T057; delete `reviewer/tests/{helpers,paths,replay_shim}.py` only if no kept Python test imports them; nothing migrates from the SQLite ledger (FR-018)
- [ ] T079 Remove the inbox hand-off from `reviewer/plugin/skills/github-pr-review/poll-pr-review.sh` (the function writing `$inbox/…json`) and from `reviewer/plugin/skills/github-pr-review/SKILL.md` the "Unresolved findings" step handing findings to the `reviewer` gate and running `reviewer:assess-round` (ADR-0019 Option B); drop `drop()` and every inbox assertion from `reviewer/tests/test_poll_pr_review.py`
- [ ] T080 Re-pin `reviewer/tests/test_shipped_tree.py` in `reviewer/tests/shipped-tree.test.ts` against the new tree (no hook-path `scripts/*.py`, `core` link present) and delete the Python test
- [ ] T081 Rewrite `reviewer/plugin/README.md`: module table and hook section for the TS layout; drop the ledger, `unlock`, `override`, `pre_merge_gate.py`; add the tamper clearance runbook (a repository admin deletes the invalid commit's `remaining` files on `ledger` in GitHub's web UI, giving a GitHub-signed delete-only commit, then a Ready move and an admin comment, then the claim)
- [ ] T082 Bump `reviewer/plugin/.claude-plugin/plugin.json` version; `npm --prefix reviewer test` and check-carriers green; open and merge the CUT PR. No rollback past it: a defect is fixed forward (R16)

---

## Phase 8: Polish & Cross-Cutting Concerns

- [ ] T083 Run quickstart.md: `npm --prefix core test`, `npm --prefix orchestrator test`, `npm --prefix reviewer test`, `node core/scripts/check-carriers.ts --base origin/main`; confirm each of quickstart.md's 27 scenarios maps to a passing test named in this file
- [ ] T084 Tripwire before each PR: `git log --name-only origin/main..HEAD | sort | uniq -c | sort -rn`; any file above ~3 edits → one-shot rewrite before pushing

---

## Dependencies & Execution Order

- **Phase 1**: T001, T002 done; T003 external, gates T065's protected-path step only.
- **PR B (T004–T021)** → **PR C (T022–T025)** → **PR S (T026–T039)** → **US1** → **US2** → **US3** → **US4** → **CUT** → **Polish**.
- T004 (fake `ledger`) precedes every PR B test task except T005–T008, T012.
- US1 depends on PR B and PR S. US2 depends on PR C and US1 (claim/shim ports T049, `RunState` holds). US3 depends on US2 (`after-commit.ts` fence pass-through). US4 depends on PR B and PR S only, shipped after US3 per plan. CUT depends on US1–US4.
- Within each story: red tests → pure rules (`lib/rules/`) → I/O (`lib/check/`, `lib/round/`) → hook wiring.

## Parallel Opportunities

- PR B: T005–T008, T012 at once; T009–T011 once T004 is in. PR C: T022.
- PR S: T027, T028, T030, T032, T034, T036 once T026 is in.
- US1: T040–T045 tests together; T046–T051 ports together (distinct files).
- US2: T059–T062; then T063, T064. US3: T067, T068. US4: T071–T073.

### Parallel Example: User Story 1

```bash
Task: "Red tests for lib/rules/rounds.ts in reviewer/tests/rounds.test.ts"
Task: "Red tests for lib/rules/counts.ts in reviewer/tests/counts.test.ts"
Task: "Red tests in reviewer/tests/round-record.test.ts (qs #1–#4, #7, #8, #23)"
Task: "Port lineage.py to reviewer/plugin/lib/check/lineage.ts"
Task: "Port claimcheck.py / shimcheck.py to reviewer/plugin/lib/check/{claim,shim}.ts"
```

## Implementation Strategy

### MVP (US1)

1. PR B, PR C, PR S.
2. US1: rounds, holds and gates on `ledger` through core. Validate qs #1–#8, #23, #27.
3. Live only after CUT; until then the Python hooks run unchanged.

### Incremental Delivery

1. US1 → attestation path built.
2. US2 → push gate (#174 Story 2 unblocked once registered).
3. US3 → fence.
4. US4 → release on claim.
5. CUT → TS hooks live, Python and the SQLite ledger gone; forward-fix only.
