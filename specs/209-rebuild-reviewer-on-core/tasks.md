---

description: "Tasks for #209: reviewer writes the records the orchestrator acts on, through core"
---

# Tasks: reviewer writes the records the orchestrator acts on, through core

**Input**: Design documents from `/specs/209-rebuild-reviewer-on-core/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. Constitution IV (test-first): every implementation task is preceded by a `node:test` task
that is run and seen failing for the expected reason before the code is written. Tests use `fakeGitHub`
(`core/tests/support/fake-github.ts`), the issue builders (`core/tests/fixtures/state/issue.ts`) and real temp
git repositories (R14).

**Organization**: Delivery order is the plan's: A → B → C → S → US1 → US2 → US3 → US4. All four stories are P1;
US2 precedes US3 because the fence is the first step of US2's after-commit check (R8). US3 and US4 also wait on
#174's core PR adding the session issue record (PR #216).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US2 from spec.md

## Path Conventions

- Core: `core/src/`, `core/tests/`
- reviewer plugin code: `reviewer/plugin/` (`hooks/`, `lib/`, `lib/rules/` pure, `lib/check/`, `lib/round/`)
- reviewer tests: `reviewer/tests/*.test.ts`, run by `reviewer/package.json` (`tsc -p . && node --test 'tests/**/*.test.ts'`)

---

## Phase 1: Setup — PR A, reviewer ADR amendments (Principle VI)
Story issue: #235

**Purpose**: The governing decisions change in their own PR, merged before any code below (FR-004, FR-016, FR-017).

- [ ] T001 [P] Amend ADR-0011 in `reviewer/docs/adr/0011-record-rounds-and-holds-in-tagged-issue-comments-through-core-the-newest-by-the.md`: d1 adds a second tagged reviewer App comment `codeworks:reviewer-gates` (full snapshot, newest wins); d2 holds the story when any reviewer App comment was edited, carries no known tag, or was deleted after the newest of either tag (release: Ready move + admin comment); d5 replaces the local ledger cache with "no copy of rounds or holds between hook runs; one reading per run" (FR-004). Record that nothing in the SQLite ledger migrates at cutover (FR-018)
- [ ] T002 [P] Amend ADR-0001 d2 in `reviewer/docs/adr/0001-follow-a-piece-of-text-across-edits-by-a-lineage-carried-from-version-to-version.md`: a lineage is stored in the gates comment as `{id, file, wrong_at[], claimed}`, open lineages only; counts derived from times, never stored (FR-015)
- [ ] T003 [P] Amend ADR-0008 in `reviewer/docs/adr/0008-treat-bugs-that-converge-as-one-bug.md`: a bug lives in the gates comment as `{id, members[{tree, at}], absorbed[{tree, at}], ranges, anchor, site_rulings}`; a merge (ADR-0008) keeps as `members` those of the bug with the higher count, moves the other's into `absorbed` (evidence, never counted), and unions ranges; a tree in `members` or `absorbed` is never counted again
- [ ] T004 [P] Amend ADR-0013 d4 in `reviewer/docs/adr/0013-give-every-hold-one-id-and-release-it-only-on-a-ready-move-and-an-admin-s-commen.md`: `claim-<id>` placed at `REFUSALS_BEFORE_USER = 3` WRONG rulings and `shim-<id>` at `HOLD_AT = 4` members, each counted after `max(reset.at, hold.released)`; gates evidence posted first, the hold derived and placed by every deciding run that finds the count at threshold and no OPEN row (R6)
- [ ] T005 [P] Amend ADR-0003 d1 in `reviewer/docs/adr/0003-gate-commits-from-the-session-hook-and-run-each-check-as-a-workflow.md` and ADR-0004 d4 in `reviewer/docs/adr/0004-judge-a-fix-with-an-outside-classifier-and-compose-the-verdict-in-code.md`: "ledger" → the check's session-scoped files (`check.json`, `memos/*.json`) beside the commit-check pass record (FR-017)
- [ ] T006 Open PR A from its own branch with T001–T005 only; merge before Phase 2 starts

**Checkpoint**: ADRs govern the tag-keyed state, gates comment and session-scoped check files.

---

## Phase 2: Foundational (Blocking Prerequisites)
Story issue: #235

**⚠️ CRITICAL**: No user story work starts until this phase is complete. PR B, PR C and PR S are separate PRs, in that order.

### PR B — core: tag-keyed state + gates contract (R5, FR-016)

- [ ] T007 [P] Red tests in `core/tests/state-read.test.ts`: two reviewer App comments tagged `codeworks:reviewer-state` and `codeworks:reviewer-gates` both read valid, newest per tag wins; an edited older reviewer App comment of either tag holds; a reviewer App comment without a known first-line tag holds; a reviewer App comment deleted after the newest of either tag holds; held-and-released rebuilds each tag from its newest unedited comment
- [ ] T008 [P] Red tests in new `core/tests/gates.test.ts`: `Gates` schema accepts `{v: 1, lineages: [], bugs: []}`; rejects duplicate lineage or bug ids, non-`Time` times, `anchor` not 40 hex; `readGates` returns `{gates, comment_url, rebuilt, held, causes}`; `writeGates` posts one comment framed `<!-- codeworks:reviewer-gates -->` + fenced JSON, refuses with `StateWriteRefused` on tamper, contract break, or over `COMMENT_LIMIT` (65 536)
- [ ] T009 Create `core/src/contracts/gates.ts` (Zod): `Lineage {id, file, wrong_at: Time[], claimed: string}`; `Bug {id, members: {tree, at: Time}[], absorbed: {tree, at: Time}[], ranges: {file, start, end}[], anchor: sha40, site_rulings: {site, ruling, issue: number|null}[]}`; `Gates {v: 1, lineages: Lineage[], bugs: Bug[]}`; ids unique within each list
- [ ] T010 Change `core/src/state.ts`: class reviewer App comments by first-line tag (`STATE_TAG`, new `GATES_TAG`), newest per tag; extend `judge` with the hold rules of T007; add `readGates` / `writeGates` per [contracts/gates-snapshot.md](contracts/gates-snapshot.md), reusing `snapshotOf`'s frame and the rebuild-from-newest-unedited path; `readState` behaviour for a single state comment unchanged (T007, T008 green)
- [ ] T011 [P] Register `Gates` in `core/scripts/write-schemas.ts` beside `Snapshot`, extend `core/tests/schemas.test.ts` red first
- [ ] T012 Bump `planner/plugin/.claude-plugin/plugin.json` version (core changed; `node core/scripts/check-carriers.ts --base origin/main` green); open and merge PR B

### PR C — core: commit-check pass record + protected paths (R11)

- [ ] T013 [P] Red tests in new `core/tests/commit-pass.test.ts` per [contracts/commit-pass-record.md](contracts/commit-pass-record.md): `readCommitPasses(session)` → `null` with no file, throws on invalid content; `recordCommitPasses(session, {repository, issue, branch, from, shas, at})` appends every sha under `branches[branch]` in order, a sha appears once per branch, refuses a `repository` differing from the file's or an `issue` differing from the branch entry's; two branches keep separate newest passes; `setReviewerOff(session, off)` creates the file when absent; file mode 0600 in folder 0700, written by temp file + rename
- [ ] T014 [P] Red tests in new `core/tests/protected-paths.test.ts`: `touchesProtected` true for `.github/workflows/x.yml`, `codeworks.toml`, `.claude/settings.json` and the rest of orchestrator ADR-0004 d4's list; false for `src/a.ts`
- [ ] T015 Create `core/src/contracts/commit-pass.ts` (Zod): `{v: 1, repository: "owner/name", off: boolean, branches: Record<branch, {issue: number, passes: {sha: sha40, range_from: sha40, at: Time}[]}>}`; per branch passes oldest → newest
- [ ] T016 Create `core/src/commit-pass.ts`: path `~/.local/state/codeworks/reviewer/sessions/<session id>/commit-passes.json`; `readCommitPasses`, `recordCommitPasses`, `setReviewerOff`; atomic write reusing the 0700/0600 temp+rename pattern of `core/src/gh-config.ts` `writeGhToken` (T013 green)
- [ ] T017 Create `core/src/protected-paths.ts` with `touchesProtected(paths: string[]): boolean` from orchestrator ADR-0004 d4's list (T014 green)
- [ ] T018 Bump `planner/plugin/.claude-plugin/plugin.json` version; open and merge PR C

### External — #174 core session issue record (PR #216)

- [ ] T019 Confirm PR #216 is merged and its reader returns `{repository, issue, kind: "claim"|"resume", claimed_at}` keyed by `session_id` (VP-001); if the shape differs, stop and re-plan R7/R9 before US3/US4

### PR S — reviewer carrier, hook skeleton, session folder, write lock (FR-020)

- [ ] T020 Create carrier link `reviewer/plugin/core -> ../../core/src`; `reviewer/plugin/package.json` with core's exact pins (`zod 4.6.7`, `smol-toml 1.9.1`, `yaml 2.9.1`) plus `diff-match-patch`; generate v3 `reviewer/plugin/package-lock.json`
- [ ] T021 [P] Create `reviewer/package.json` (`"test": "tsc -p . && node --test 'tests/**/*.test.ts'"`, devDependencies `@types/node 22.20.5`, `typescript 7.0.2`) and `reviewer/tsconfig.json` copied from `planner/tsconfig.json` (`include: ["plugin", "tests"]`)
- [ ] T022 [P] Red tests in `reviewer/tests/settings.test.ts`: `ReviewerSettings` parses `[reviewer]` (`app_id`, `mode: "enforce"|"log"`, `claim_checks`, `shim_checks`, `decision_checks`, `max_review_files`, and every other key now in `reviewer/plugin/config.json`), rejects unknown keys (strict)
- [ ] T023 Create `reviewer/plugin/lib/settings.ts` (`ReviewerSettings` Zod over core `section("reviewer")`) and add the `[reviewer]` section to `codeworks.toml` with today's values from `reviewer/plugin/config.json` (T022 green)
- [ ] T024 [P] Red tests in `reviewer/tests/github.test.ts`: reader built from the session token via `readGhToken(folder)`; writer minted once per writing run via `mintToken("reviewer", app_id, "reviewer-app.pem", "reviewer", repo)`; a mint or token-read failure is `COULD_NOT_RUN`
- [ ] T025 Create `reviewer/plugin/lib/github.ts` following `planner/plugin/lib/github.ts` (T024 green)
- [ ] T026 [P] Red tests in `reviewer/tests/session.test.ts`: session folder `~/.local/state/codeworks/reviewer/sessions/<session>/` created 0700; `withWriteLock(session, fn)` is exclusive across two concurrent processes and refuses as could not run when not acquired in time (refusals.md row "session write lock not acquired in time"); `gate.log` append
- [ ] T027 Create `reviewer/plugin/lib/session.ts` (folder, `write.lock`, `gate.log`) (T026 green)
- [ ] T028 [P] Red tests in `reviewer/tests/hookio.test.ts`: `refuse()` returns `deny` with the reason under `enforce`, appends `would_deny` to `gate.log` and allows under `log` (R12); could-not-run for a write records nothing in either mode; per-check modes (`claim_checks`, `shim_checks`, `decision_checks`) gate their own refusals
- [ ] T029 Create `reviewer/plugin/lib/hookio.ts` porting `reviewer/plugin/scripts/hookio.py` `refuse`/`block`/`refuse_claim` meaning, without the ledger (T028 green)
- [ ] T030 [P] Red tests in `reviewer/tests/run-state.test.ts`: `RunState` calls `readState` and `readGates` at most once each per run and holds the reading in memory only; nothing written to disk
- [ ] T031 Create `reviewer/plugin/lib/run-state.ts` (T030 green)
- [ ] T032 Create hook entries `reviewer/plugin/hooks/{pre-tool-use,post-tool-use,user-prompt-submit,subagent,session-start}.ts` on the pattern of `core/tests/fixtures/carrier-plugin/hooks/identity.ts` (static `guard.ts` import, `requireDependencies()`, dynamic core import), each reading hook JSON and dispatching to an empty handler; red test `reviewer/tests/hooks-skeleton.test.ts` runs each entry with sample hook JSON and asserts an allow answer
- [ ] T033 Bump `reviewer/plugin/.claude-plugin/plugin.json` version; `node core/scripts/check-carriers.ts --base origin/main` green; open and merge PR S (hooks.json still points at Python until US1)

**Checkpoint**: Core contracts merged; reviewer carries core; a TS hook entry runs per event.

---

## Phase 3: User Story 1 — A story's rounds and holds are on its issue (P1) 🎯 MVP
Story issue: #235

**Goal**: Every round and hold reviewer records lands as a state snapshot on the story issue through core as the reviewer App; claim/shim counts live in the gates comment; the ledger is gone.

**Independent Test**: Against `fakeGitHub`, drive one internal round to CLEAN on `42-us1-login`; exactly one state comment posted on `#42` by the reviewer App client; `readState` returns it as newest; core attestation answers success (quickstart #1).

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [ ] T034 [P] [US1] Red tests in `reviewer/tests/rounds.test.ts` for pure `lib/rules/rounds.ts`: round report → `Round {id: {stage, n}, head, result, verdict}` with core's `RoundStage`/`RoundResult`/`RoundVerdict` (no repeated strings, root ADR-0010); `RESHAPE_SPEC` → `RESCOPE`; hold kind per data-model table (ESCALATE → `escalation-<issue>` with question; RESCOPE → `placeRescopeHold(specPr)`; spent `MAX_AUDITS` → `audit-<issue>`; stage cap with open pushback → `pushback-<issue>`)
- [ ] T035 [P] [US1] Red tests in `reviewer/tests/counts.test.ts` for pure `lib/rules/counts.ts`: lineage count = `|wrong_at > max(reset.at, hold(claim-<id>).released)|`, place at 3; bug count over `members[].at`, place at 4; merging two bugs with disjoint members of 2 and 3 yields count 3, not 5, and no `shim-<id>` (ADR-0008 d2); a tree in `absorbed` is not counted again; ended item dropped
- [ ] T036 [P] [US1] Red tests in `reviewer/tests/round-record.test.ts` (quickstart #1–#4): CLEAN round → one POST on `#42` by the reviewer client, earlier rows unchanged, `attests` true; ESCALATE → round + OPEN `escalation-42`, reading held; newest state comment `lastEditedAt` set → no POST, refusal names Ready move + admin comment; new session folder → hold still OPEN and no reviewer file holds rounds/holds
- [ ] T037 [P] [US1] Red tests in `reviewer/tests/gates-record.test.ts` (quickstart #5, #6, #19): gates with 2 `wrong_at` + WRONG ruling → gates has 3 and `claim-<id>` OPEN; an older gates comment edited → held as for state; run dies after gates post before `placeHold` → next deciding run places `claim-<id>`
- [ ] T038 [P] [US1] Red test in `reviewer/tests/write-lock.test.ts` (quickstart #15): two hook runs post `placeHold(claim-7)` and a round concurrently → both in the newest snapshot
- [ ] T039 [P] [US1] Red tests in `reviewer/tests/launch.test.ts` for pure `lib/rules/launch.ts`: round launch refused while a hold is open or the stage cap is reached, reading state through `RunState`; refusal names the hold id and its release

### Implementation for User Story 1

- [ ] T040 [P] [US1] Create `reviewer/plugin/lib/rules/rounds.ts` (T034 green)
- [ ] T041 [P] [US1] Create `reviewer/plugin/lib/rules/counts.ts`, porting thresholds and count rules from `reviewer/plugin/scripts/claimgate.py` and `shimgate.py` (T035 green)
- [ ] T042 [P] [US1] Port `reviewer/plugin/scripts/lineage.py` to `reviewer/plugin/lib/check/lineage.ts` on npm `diff-match-patch`; re-pin `reviewer/tests/test_lineage.py` behaviour red first in `reviewer/tests/lineage.test.ts`
- [ ] T043 [P] [US1] Port `reviewer/plugin/scripts/claimcheck.py` and `shimcheck.py` to `reviewer/plugin/lib/check/claim.ts` and `lib/check/shim.ts` (pure parts under `lib/rules/`); re-pin `test_claimcheck.py`, `test_shimcheck.py` behaviour red first in `reviewer/tests/claim-check.test.ts`, `reviewer/tests/shim-check.test.ts`
- [ ] T044 [P] [US1] Port `reviewer/plugin/scripts/reshape.py`, `specbinding.py`, `decisions.py`, `adrkit.py`, `assessment.py`, `facts.py` to `reviewer/plugin/lib/round/{assess,decisions}.ts` and `lib/rules/{reshape,spec-binding}.ts`, replacing every `ledger` read with the `RunState` reading; re-pin `test_reshape.py`, `test_specbinding.py`, `test_spec_source.py`, `test_decisions.py`, `test_adrkit.py`, `test_assessment.py`, `test_worktree_facts.py` behaviour red first in matching `reviewer/tests/*.test.ts`
- [ ] T045 [P] [US1] Port `reviewer/plugin/scripts/jev.py`, `briefs.py`, `worktree.py`, `shell.py`, `snapshot.py`, `sweeper_read.py` to `reviewer/plugin/lib/` (`briefs.ts`, `jev.ts`, `worktree.ts`, `shell.ts`, `check/snapshot.ts`, `rules/sweeper-read.ts`), `briefs` reading state through `RunState`; re-pin `test_jev.py`, `test_worktree.py`, `test_shell.py`, `test_shim_snapshot.py`, `test_sweeper_read.py`, `test_agents.py` behaviour red first in matching `reviewer/tests/*.test.ts`
- [ ] T046 [US1] Create `reviewer/plugin/lib/rules/launch.ts` porting `reviewer/plugin/scripts/policy.py` launch/cap rules over core's `Snapshot` (T039 green)
- [ ] T047 [US1] Create `reviewer/plugin/lib/round/record.ts`: StructuredOutput round report/assessment → `writeState` / `placeHold` / `placeRescopeHold` with the minted writer, inside `withWriteLock`; `StateWriteRefused` → refusal naming the release or could not run (refusals.md rows "state or gates tampered", "state write over comment limit", "GitHub unanswered") (T036, T038 green)
- [ ] T048 [US1] Create `reviewer/plugin/lib/round/gates.ts`: claim/shim results → `writeGates` (evidence first) then `placeHold(claim-<id>|shim-<id>)` when `counts.ts` reaches threshold and no OPEN row; every deciding run re-derives and repairs a missing hold (T037 green)
- [ ] T049 [US1] Create `reviewer/plugin/lib/round/launch.ts` and wire into `reviewer/plugin/hooks/pre-tool-use.ts`: refuse writes to the state folder, story-branch `spec.md` edit, round launch gate, claim/shim workflow launch rewrite (ADR-0021 d1), output validation; wire `Read|Glob|Grep` sweeper confinement (contracts/hooks.md)
- [ ] T050 [US1] Wire `reviewer/plugin/hooks/post-tool-use.ts` StructuredOutput branch to `round/record.ts` and `round/gates.ts`; wire `reviewer/plugin/hooks/subagent.ts` (in-flight reviewer tracking) and `reviewer/plugin/hooks/session-start.ts` (off-switch notice)
- [ ] T051 [US1] Port `reviewer on|off` to `reviewer/plugin/hooks/user-prompt-submit.ts`, writing the switch via core `setReviewerOff`; remove `unlock …` and `override shim-…` prompts (FR-008); re-pin `test_switch.py` behaviour red first in `reviewer/tests/switch.test.ts`
- [ ] T052 [US1] Rewrite `reviewer/plugin/hooks/hooks.json`: every entry `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`, `onFailure: block`, matchers per contracts/hooks.md; no `pre_merge_gate.py` entries
- [ ] T053 [US1] Delete `reviewer/plugin/scripts/{ledger,pre_merge_gate,gate,policy,claimgate,shimgate,hookio,config,github,lineage,claimcheck,shimcheck,reshape,specbinding,decisions,adrkit,assessment,facts,jev,briefs,worktree,shell,snapshot,sweeper_read}.py` and `reviewer/plugin/config.json`; keep `scripts/codexstate.py` (poller only); delete their Python tests (`test_ledger.py`, `test_pre_merge_gate.py`, `test_poller_contract.py`, `test_gate.py`, `test_policy.py`, `test_claim_gate.py`, `test_shim_gate.py` and each test re-pinned in T042–T051); delete `reviewer/tests/{helpers,paths,replay_shim}.py` only if no kept Python test imports them (FR-018, R13)
- [ ] T054 [US1] Remove the inbox hand-off from `reviewer/plugin/skills/github-pr-review/poll-pr-review.sh` (function writing `$inbox/…json`) and its mention in `reviewer/plugin/skills/github-pr-review/SKILL.md` (R13)
- [ ] T055 [US1] Re-pin `reviewer/tests/test_shipped_tree.py` in `reviewer/tests/shipped-tree.test.ts` against the new tree (no `scripts/*.py` on the hook path, `core` link present) and delete the Python test
- [ ] T056 [US1] End-to-end test `reviewer/tests/e2e-round.test.ts` (SC-001): story taken from Ready through a CLEAN internal round reaches core `internal-review` success with no admin act

**Checkpoint**: US1 independently testable; orchestrator can attest from issue state.

---

## Phase 4: User Story 2 — Only commits that passed the commit check are pushed (P1)
Story issue: #236

**Goal**: After-commit check over a hooks-owned bare copy grades `base..head` and records every commit of a passing range in the commit-check pass record.

**Independent Test**: Commits A, B, C on a story branch; A passes, B fails, C passes → record names A, then A, B, C, newest C (quickstart #11).

### Tests for User Story 2 ⚠️

- [ ] T057 [P] [US2] Red tests in `reviewer/tests/range.test.ts` for pure `lib/rules/range.ts` (FR-021): base = branch's newest pass if ancestor of head, else GitHub head if ancestor, else refuse naming the pushed head to restore; branch not on GitHub → merge base with the default branch
- [ ] T058 [P] [US2] Red tests in `reviewer/tests/bare-copy.test.ts`: bare copy at `<session>/repo.git` created on first use; only `git fetch <clone> <sha>`; fetch failure → `COULD_NOT_RUN`
- [ ] T059 [P] [US2] Red tests in `reviewer/tests/after-commit.test.ts` (quickstart #11–#13, #16–#18): A pass / B fail / C pass; could-not-run records nothing; range touching `.github/` fails and records nothing; new session grades from GitHub head A; amend C→C' graded from GitHub head, then reset below GitHub head refused naming it; passes on `42-us1-login` then `42-us2-logout` keep separate newest passes; reviewer off → no check, nothing recorded
- [ ] T060 [P] [US2] Red test in `reviewer/tests/after-commit-holds.test.ts`: open `claim-`, `shim-`, `rescope-` hold (except `rescope-` on a default-branch merge, ADR-0013 d5) refuses naming the hold id and its release; pending claim/shim check refuses naming the workflow and range

### Implementation for User Story 2

- [ ] T061 [P] [US2] Create `reviewer/plugin/lib/rules/range.ts` (T057 green)
- [ ] T062 [P] [US2] Create `reviewer/plugin/lib/check/bare-copy.ts` over core `runGit` / `fetchWithGhCredential`; GitHub branch head read with the session token (T058 green)
- [ ] T063 [US2] Create `reviewer/plugin/lib/check/after-commit.ts` state machine `idle → fetched → based → fenced → structural → awaiting_checks → PASS | FAIL | COULD_NOT_RUN` (data-model); structural steps: holds, `touchesProtected`, merge resolution for merges only (ADR-0002 d3); running state in `<session>/check.json`, memos in `<session>/memos/*.json` (FR-017); PASS → `recordCommitPasses` for every sha of the range; fence step is a pass-through placeholder until US3 (T059, T060 green)
- [ ] T064 [US2] Record HEAD before Bash in `reviewer/plugin/hooks/pre-tool-use.ts`; wire `reviewer/plugin/hooks/post-tool-use.ts` Bash branch to compare heads and run `after-commit.ts`; StructuredOutput claim/shim results feed the awaiting check and, on PASS, the pass record
- [ ] T065 [US2] Skip the check entirely while `off` is set in the pass record (FR-019)

**Checkpoint**: Orchestrator can push up to the newest commit-check pass.

---

## Phase 5: User Story 3 — A session commits only on its own story's branch (P1)
Story issue: #237

**Goal**: The after-commit check's first step refuses commits off `<issue>-us`, and every commit in a session with no recorded issue. Blocked on T019.

**Independent Test**: Record faked as `#42`; commits on `42-us1-login`, `43-us1-other`, `main` → first proceeds, others refused naming `#42` and `42-us`, none recorded (quickstart #7).

### Tests for User Story 3 ⚠️

- [ ] T066 [P] [US3] Red tests in `reviewer/tests/fence.test.ts` for pure `fence(record, branch, switchOn): Allow | Refuse`: switch off → allow; no record → refuse naming `/codeworks <issue>` and `reviewer off`; branch without `<s>-us` (via core `parseBranch`) → refuse naming `#<s>` and `<s>-us`; `42-us2-logout` allowed
- [ ] T067 [P] [US3] Red tests in `reviewer/tests/after-commit-fence.test.ts` (quickstart #7, #8, #14): fenced-out commits recorded as nothing; unreadable record → could not run naming the record's path; `mode = "log"` → `would_deny` logged and still nothing recorded as passed

### Implementation for User Story 3

- [ ] T068 [US3] Create `reviewer/plugin/lib/rules/fence.ts` (T066 green)
- [ ] T069 [US3] Read the session record through #174's core reader in `reviewer/plugin/lib/session.ts` (absent → no record; invalid → `COULD_NOT_RUN`, R7) and replace the fence placeholder in `reviewer/plugin/lib/check/after-commit.ts` with `fence.ts` as the first step (T067 green)

**Checkpoint**: SC-003 holds across the fence tests.

---

## Phase 6: User Story 4 — A Ready claim releases the holds an admin answered, once (P1)
Story issue: #238

**Goal**: Every hook entry's first step calls `releaseOnClaim` once per claim, never on a resume. Blocked on T019.

**Independent Test**: OPEN `claim-7` with Ready move + admin comment after; record = claim; hook run twice → one release POST, first run only; record = resume → none (quickstart #9, #10).

### Tests for User Story 4 ⚠️

- [ ] T070 [P] [US4] Red tests in `reviewer/tests/claim-step.test.ts` for pure `lib/rules/claim-step.ts`: claim + no marker `released-<issue>-<claimed_at>` → release; marker present → nothing; resume or no record → nothing; second claim of the same issue (new `claimed_at`) → release again
- [ ] T071 [P] [US4] Red tests in `reviewer/tests/release-on-claim.test.ts` (quickstart #9, #10): one release POST on first run only; resume → no POST; hold without admin comment stays OPEN; `/codeworks reset` → RELEASED with `reset: true`; `releaseOnClaim` throws → could not run, no marker, next run retries; two concurrent first runs → one release (write lock)

### Implementation for User Story 4

- [ ] T072 [US4] Create `reviewer/plugin/lib/rules/claim-step.ts` (T070 green)
- [ ] T073 [US4] Run the claim step first in every entry under `reviewer/plugin/hooks/*.ts` via a shared `reviewer/plugin/lib/claim.ts`: `releaseOnClaim` with the minted writer inside `withWriteLock`, marker written after success (T071 green)

**Checkpoint**: SC-004 holds; all four stories functional.

---

## Phase 7: Polish & Cross-Cutting Concerns
Story issue: #238

- [ ] T074 [P] Rewrite `reviewer/plugin/README.md` module table and hook section for the TS layout; drop ledger, `unlock`, `override`, `pre_merge_gate.py`
- [ ] T075 Bump `reviewer/plugin/.claude-plugin/plugin.json` version for the release containing US1–US4
- [ ] T076 Run quickstart.md: `npm --prefix core test`, `npm --prefix reviewer test`, `node core/scripts/check-carriers.ts --base origin/main`; confirm scenarios 1–19 each map to a passing test
- [ ] T077 Tripwire before each PR: `git log --name-only origin/main..HEAD | sort | uniq -c | sort -rn`; any file above ~3 edits → one-shot rewrite before pushing

---

## Dependencies & Execution Order

- **Phase 1 (PR A)** → **PR B** → **PR C** → **PR S** → **US1** → **US2** → **US3** → **US4** → **Polish**
- **T019 (#174 PR #216 merged)** gates US3 and US4 only.
- US2 depends on US1 (holds read through `RunState`, claim/shim ports, `hooks.json` switched).
- US3 depends on US2 (`after-commit.ts` fence placeholder). US4 depends on PR S only, but ships after US3 per plan.
- Within each story: red tests → pure rules (`lib/rules/`) → I/O (`lib/check/`, `lib/round/`) → hook wiring.

## Parallel Opportunities

- Phase 1: T001–T005 all [P].
- PR B: T007, T008, T011 [P]. PR C: T013, T014 [P].
- PR S: T021, T022, T024, T026, T028, T030 [P] once T020 is in.
- US1: T034–T039 tests [P]; T040–T045 ports [P] (distinct files).
- US2: T057–T060 [P]; T061, T062 [P].
- US3: T066, T067 [P]. US4: T070, T071 [P].

### Parallel Example: User Story 1

```bash
Task: "Red tests for lib/rules/rounds.ts in reviewer/tests/rounds.test.ts"
Task: "Red tests for lib/rules/counts.ts in reviewer/tests/counts.test.ts"
Task: "Red tests in reviewer/tests/round-record.test.ts (quickstart #1–#4)"
Task: "Port lineage.py to reviewer/plugin/lib/check/lineage.ts"
Task: "Port claimcheck.py / shimcheck.py to reviewer/plugin/lib/check/{claim,shim}.ts"
```

## Implementation Strategy

### MVP (US1)

1. PR A, PR B, PR C, PR S.
2. US1: rounds and holds on the issue; ledger deleted. Validate quickstart #1–#6, #15, #19 → orchestrator can attest.

### Incremental Delivery

1. US1 → attestation unblocked.
2. US2 → push gate (#174 Story 2 unblocked).
3. US3 → fence (after #216).
4. US4 → release on claim (after #216).

No rollback path: the ledger is gone at US1; forward-fix only.
