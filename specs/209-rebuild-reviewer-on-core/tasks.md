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

- [ ] T001 [P] Amend ADR-0011 in `reviewer/docs/adr/0011-record-rounds-and-holds-in-tagged-issue-comments-through-core-the-newest-by-the.md`: d1 adds a `gates` section to the state snapshot, changed only together with the holds it places, in one post; d5 replaces the local ledger cache with "no copy of rounds or holds between hook runs; one reading per run" (FR-004). Record that nothing in the SQLite ledger migrates at cutover (FR-018)
- [ ] T002 [P] Amend ADR-0001 d2 in `reviewer/docs/adr/0001-follow-a-piece-of-text-across-edits-by-a-lineage-carried-from-version-to-version.md`: a lineage is stored in the gates section of the story's state snapshot as contracts/gates-snapshot.md defines it, against the branch's anchor commit, open lineages only; counts derived, never stored; the anchor looked up in the bare copy, the model's clone by sha, then GitHub, a check stopping when none has it, naming `/codeworks reset`, and once a reset is newer than every time in the section, starting it over; and ADR-0013 d3: the reset lets that check start over (FR-015)
- [ ] T003 [P] Amend ADR-0008 in `reviewer/docs/adr/0008-treat-bugs-that-converge-as-one-bug.md`: a bug lives in the gates section of the story's state snapshot as contracts/gates-snapshot.md defines it; a merge (ADR-0008) keeps as `members` and `deep` those of the bug with the higher count (the smaller id on a tie), moves the other's members into `absorbed` (evidence, never counted), unions ranges, and gives the survivor the other's rulings for the sites it has not ruled, its own winning; a tree in `members` or `absorbed` is never counted again
- [ ] T004 [P] Amend ADR-0013 d4 in `reviewer/docs/adr/0013-give-every-hold-one-id-and-release-it-only-on-a-ready-move-and-an-admin-s-commen.md`: `claim-<id>` placed at `claim_hold_at` WRONG rulings and `shim-<id>` at `shim_hold_at` members, each a `[reviewer]` key, each counted after the newest `reset.at` only; a release does not lower the count but grants per contracts/gates-snapshot.md: a released `claim-<id>` holds again at one more WRONG check, a released `shim-<id>` after one commit touching its ranges; a `claim-<id>` hold carries the last WRONG's failing case and evidence as its question; the count and the hold it places land in one post (R6)
- [ ] T005 [P] Amend ADR-0003 d1 in `reviewer/docs/adr/0003-gate-commits-from-the-session-hook-and-run-each-check-as-a-workflow.md` and ADR-0004 d4 in `reviewer/docs/adr/0004-judge-a-fix-with-an-outside-classifier-and-compose-the-verdict-in-code.md`: in ADR-0003 d1, "ledger" → the check's session-scoped files (`check.json` for the running check, `memos/*.json` for its reads and verdicts) beside the commit-check pass record; in ADR-0004 d4, "ledger" → the check's `memos/*.json` (FR-017)
- [ ] T006 Open PR A from its own branch with T001–T005 only; merge before Phase 2 starts

**Checkpoint**: ADRs govern the gates section and session-scoped check files.

---

## Phase 2: Foundational (Blocking Prerequisites)
Story issue: #235

**⚠️ CRITICAL**: No user story work starts until this phase is complete. PR B, PR C and PR S are separate PRs, in that order.

### PR B — core: gates section of the snapshot (R5, FR-016)

- [ ] T007 [P] Red tests in `core/tests/state-write.test.ts` per contracts/gates-snapshot.md: `recordGates` posts once with `gates` replaced and each opening placed (a `claim-` opening carries its question); an opening whose hold is OPEN posts the `gates` change and leaves the row; an opening on a RELEASED row reopens that row in place (still one row per id); refuses, posting nothing, on a `gates` on GitHub differing from the reading's, and when the snapshot would not fit with every OPEN hold released and one more largest round appended (the refusal names size, reserve and limit); `writeState`, `placeHold`, `placeRescopeHold` and `releaseOnClaim` refuse a `gates` differing from the one they read; a tampered snapshot rebuilt from the newest unedited comment restores `gates` with its holds
- [ ] T008 [P] Red tests in new `core/tests/gates.test.ts`: `Gates` schema accepts `{branch: "42-us1-login", anchor, lineages: [], bugs: []}`; rejects duplicate lineage or bug ids, non-`Time` times, `anchor` not 40 hex, a deep-sweep site missing `file`, `line`, `function` or `does`; `core/tests/snapshot.test.ts`: `Snapshot` accepts `gates: null` and a valid `Gates`, rejects a snapshot without `gates`; a `claim-` hold with a question is valid, and a `rescope-` hold with `spec_pr: null` and one, while a `rescope-` hold with a `spec_pr` and a question, or a `pushback-`/`audit-`/`shim-` hold with one, is not
- [ ] T009 Create `core/src/contracts/gates.ts` (Zod): the shape of contracts/gates-snapshot.md exactly (`Gates {branch, anchor, lineages, bugs}`), ids unique within each list; add `gates: Gates.nullable()` to `Snapshot` in `core/src/contracts/snapshot.ts`
- [ ] T010 Change `core/src/state.ts`: `emptySnapshot` sets `gates: null`; `checkTransition` refuses a `gates` change from every writer but `recordGates`; add `recordGates` per [contracts/gates-snapshot.md](contracts/gates-snapshot.md) through `untamperedSnapshot` and `post`, with the size rule (T007, T008 green)
- [ ] T010a Change `core/src/contracts/snapshot.ts`: `question` is set exactly when the hold kind is `escalation` or `claim`, or `rescope` with `spec_pr` null (reviewer ADR-0013 d4–d5) (T008 green)
- [ ] T010b Change `core/src/state.ts`: `placeRescopeHold(reader, writer, repo, issue, shared, placement: {question: string} | {specPr: number})`, a RESCOPE verdict passing its question and a spec PR seen open its number, the row then carrying no question; red first in `core/tests/state-write.test.ts`, every existing `placeRescopeHold(…, null)` / `(…, n)` call moved to its placement (ADR-0013 d5)
- [ ] T010c Add `ESCALATE` ("the assessor cannot rule the finding; an admin decides") to core's `FindingRuling` in `core/src/values.ts` (root ADR-0010, reviewer ADR-0017 d2); red first in `core/tests/values.test.ts`
- [ ] T011 [P] Regenerate `snapshot.schema.json` through `core/scripts/write-schemas.ts` (`Gates` is a sub-schema of `Snapshot`, no file of its own); `core/tests/schemas.test.ts` drift test red first
- [ ] T012 Bump the version of every plugin carrying core (`planner`, `orchestrator`; root ADR-0001) so `node core/scripts/check-carriers.ts --base origin/main` is green; open and merge PR B

### PR C — core: commit-check pass record (R11)

- [ ] T013 [P] Red tests in new `core/tests/commit-pass.test.ts` per [contracts/commit-pass-record.md](contracts/commit-pass-record.md): `readCommitPasses(session)` → `null` with no file, throws on invalid content; `recordCommitPasses(session, {repository, issue, branch, from, shas, at})` appends every sha under `branches[branch]` in order, a sha appears once per branch while `head` is set on every pass, including GitHub at A, pass B, amend to B′ and pass B′, restore B and pass B → `head` B, refuses a `repository` differing from the file's or an `issue` differing from the branch entry's; two branches keep separate newest passes; `setReviewerOff(session, repository, off)` creates a valid file when absent and refuses a `repository` differing from the file's; file mode 0600 in folder 0700, written by temp file + rename
- [ ] T015 Create `core/src/contracts/commit-pass.ts` (Zod): `{v: 1, repository: "owner/name", off: boolean, branches: Record<branch, {issue: number, head: {sha: sha40, range_from: sha40, at: Time}, passes: {sha: sha40, range_from: sha40, at: Time}[]}>}`; per branch passes oldest → newest, `head` the newest pass
- [ ] T016 Create `core/src/commit-pass.ts`: path `~/.local/state/codeworks/reviewer/sessions/<session id>/commit-passes.json`; `readCommitPasses`, `recordCommitPasses`, `setReviewerOff`; atomic write reusing the 0700/0600 temp+rename pattern of `core/src/gh-config.ts` `writeGhToken` (T013 green)
- [ ] T018 Bump the version of every plugin carrying core (`planner`, `orchestrator`); open and merge PR C

### External — #174 core session issue record (PR #216)

- [x] T019 PR #216 is merged: core's `readSessionRecord(folder, sessionId)` returns `SessionRecord {v, repo, issue, taken, at}` (`core/src/contracts/session-record.ts`), `taken` one of core's `Taken`; R7 and R9 read it as such

### PR S — reviewer carrier, hook skeleton, session folder, write lock (FR-020)

- [ ] T020 Create carrier link `reviewer/plugin/core -> ../../core/src`; `reviewer/plugin/package.json` with core's exact pins (`zod 4.6.7`, `smol-toml 1.9.1`, `yaml 2.9.1`) plus `diff-match-patch`; generate v3 `reviewer/plugin/package-lock.json`
- [ ] T021 [P] Create `reviewer/package.json` (`"test": "tsc -p . && node --test 'tests/**/*.test.ts'"`, devDependencies `@types/node 22.20.5`, `typescript 7.0.2`) and `reviewer/tsconfig.json` copied from `planner/tsconfig.json` (`include: ["plugin", "tests"]`)
- [ ] T022 [P] Red tests in `reviewer/tests/settings.test.ts`: `ReviewerSettings` parses `[reviewer]` (`app_id`, `mode: "enforce"|"log"`, `claim_checks`, `shim_checks`, `decision_checks`, `max_review_files`, every other key now in `reviewer/plugin/config.json`, and every count ADR-0013 d4 and ADR-0019 d5 make a `[reviewer]` key: `max_rounds`, `max_audits`, `k_topic`, `claim_hold_at`, `shim_deep_at`, `shim_hold_at`), rejects unknown keys (strict); a set `REVIEWER_MODE` or any other environment variable changes no key (root ADR-0002 d3)
- [ ] T023 Create `reviewer/plugin/lib/settings.ts` (`ReviewerSettings` Zod over core `section("reviewer")`, no environment read) and add the `[reviewer]` section to `codeworks.toml` with today's values from `reviewer/plugin/config.json` and the limits today in code: `max_rounds = 4` (`policy.py` `CAP`), `max_audits = 2` (`policy.py`), `claim_hold_at = 3` (`claimcheck.py` `REFUSALS_BEFORE_USER`), `shim_deep_at = 3`, `shim_hold_at = 4` (`shimcheck.py` `DEEP_AT`, `HOLD_AT`), and `k_topic`, which no code has yet (T022 green)
- [ ] T024 [P] Red tests in `reviewer/tests/github.test.ts`: reader built from the session token via `readGhToken(folder)`; writer minted once per writing run via `mintToken("reviewer", app_id, "reviewer-app.pem", "reviewer", repo)`; a mint or token-read failure is `COULD_NOT_RUN`
- [ ] T025 Create `reviewer/plugin/lib/github.ts` following `planner/plugin/lib/github.ts` (T024 green)
- [ ] T026 [P] Red tests in `reviewer/tests/session.test.ts`: session folder `~/.local/state/codeworks/reviewer/sessions/<session>/` created 0700; `withWriteLock(session, fn)` is exclusive across two concurrent processes and refuses as could not run when not acquired in time (refusals.md row "session write lock not acquired in time"); `gate.log` append
- [ ] T027 Create `reviewer/plugin/lib/session.ts` (folder, `write.lock`, `gate.log`) (T026 green)
- [ ] T028 [P] Red tests in `reviewer/tests/hookio.test.ts` per ADR-0006 d1: under `enforce` a refusal returns `deny` with its reason; under `log` a refusal by the commit gates or the round-launch gate appends `would_deny` to `gate.log` and does not block, while every ADR-0012 d1 refusal still denies; could-not-run for a write records nothing in either mode; per-check modes (`claim_checks`, `shim_checks`, `decision_checks`) gate their own refusals
- [ ] T029 Create `reviewer/plugin/lib/hookio.ts` with the refusal kinds of T028; from `reviewer/plugin/scripts/hookio.py` keep the `refuse`/`block`/`refuse_claim` outputs, not its ledger writes or its environment-variable settings (T028 green)
- [ ] T030 [P] Red tests in `reviewer/tests/run-state.test.ts`: `RunState` calls `readState` at most once per run and holds the reading in memory only; nothing written to disk
- [ ] T031 Create `reviewer/plugin/lib/run-state.ts` (T030 green)
- [ ] T032 Create hook entries `reviewer/plugin/hooks/{pre-tool-use,post-tool-use,user-prompt-submit,subagent,session-start}.ts` on the pattern of `core/tests/fixtures/carrier-plugin/hooks/identity.ts` (static `guard.ts` import, `requireDependencies()`, dynamic core import), each reading hook JSON and dispatching to an empty handler; red test `reviewer/tests/hooks-skeleton.test.ts` runs each entry with sample hook JSON and asserts an allow answer
- [ ] T033 Bump `reviewer/plugin/.claude-plugin/plugin.json` version; `node core/scripts/check-carriers.ts --base origin/main` green; open and merge PR S (hooks.json still points at Python until US1)

**Checkpoint**: Core contracts merged; reviewer carries core; a TS hook entry runs per event.

---

## Phase 3: User Story 1 — A story's rounds and holds are on its issue (P1) 🎯 MVP
Story issue: #235

**Goal**: Every round and hold reviewer records lands as a state snapshot on the story issue through core as the reviewer App; claim/shim counts live in the snapshot's gates section; the ledger is gone.

**Independent Test**: Against `fakeGitHub`, drive one internal round to CLEAN on `42-us1-login`; exactly one state comment posted on `#42` by the reviewer App client; `readState` returns it as newest; core attestation answers success (quickstart #1).

### Tests for User Story 1 ⚠️ (write first, see them fail)

- [ ] T034 [P] [US1] Red tests in `reviewer/tests/rounds.test.ts` for pure `lib/rules/rounds.ts`: round report → `Round {id: {stage, n}, head, result, verdict}` with core's `RoundStage`/`RoundResult`/`RoundVerdict` (no repeated strings, root ADR-0010); `RESHAPE_SPEC` → `RESCOPE`; a DIRTY round's verdict by ADR-0017 d2's first-match rule, one case per clause and one where an earlier clause beats a later one that also matches: ESCALATE when any finding is ruled ESCALATE, the assessor cannot decide, or a deadlock stands, RESCOPE when a finding shows the spec does not settle a decision, the assessor's PATCH, CLASS_FIX or REDESIGN when at least one finding is ruled FIX, CONVERGED_PUSHBACK when every finding is ruled PUSH_BACK or DEFER; an ESCALATE's and a RESCOPE's question says why the round was raised and what must be decided (ADR-0013 d4–d5); one case per row of ADR-0013 d4's table and d5, each built from the row's "Placed when" column, at non-default settings so a constant in code fails: `escalation-<issue>` with question on an ESCALATE verdict, and on a trusted thread answered after its ruling `k_topic` times; `pushback-<issue>` when a github round rules no FIX while a merge blocker fails at the head, and not at the stage cap; `audit-<issue>` at `max_audits` escalation audits ruled other than CONVERGED_PUSHBACK; `rescope-<issue>` on a RESCOPE verdict with the verdict's question and no spec PR (`placeRescopeHold({question})`), on a rescope's spec PR seen open recording its number, nothing again for a number already recorded (released or not), and again for a new number
- [ ] T035 [P] [US1] Red tests in `reviewer/tests/counts.test.ts` for pure `lib/rules/counts.ts`: lineage count = distinct WRONG `ref` after the newest `reset.at`, one check counting once however many split claims it ruled; every threshold case runs at non-default settings (`claim_hold_at = 2`, `shim_deep_at = 2`, `shim_hold_at = 5`) so a constant in code fails: `claim-<id>` placed at `claim_hold_at`; a released `claim-<id>` placed again only by a WRONG `ref` later than its release, including one on the released words, and not by its count alone; bug count over `members[].at`, deep sweep due at `shim_deep_at`, `shim-<id>` placed at `shim_hold_at`; a released `shim-<id>` placed again by the check of the next commit touching its ranges, the release lowering no count (ADR-0013 d4); a file moved to a new path starts its counts again (ADR-0001 d2); merging two bugs with disjoint members of 2 and 3 yields count 3, not 5, and no `shim-<id>` (ADR-0008 d2); the survivor is the higher count, the smaller id on a tie, keeps its own `deep` and takes the other's rulings only for sites it has not ruled; a tree in `absorbed` is not counted again; ended item dropped
- [ ] T036 [P] [US1] Red tests in `reviewer/tests/round-record.test.ts` (quickstart #1–#4): CLEAN round → one POST on `#42` by the reviewer client, earlier rows unchanged, `attests` true; ESCALATE → round + OPEN `escalation-42`, reading held; newest state comment `lastEditedAt` set → no POST, refusal names Ready move + admin comment; new session folder → hold still OPEN and no reviewer file holds rounds/holds
- [ ] T037 [P] [US1] Red tests in `reviewer/tests/gates-record.test.ts` (quickstart #5, #6, #19): gates with WRONG rulings from 2 checks + a third check's WRONG → `claim-<id>` OPEN; the same tree re-checked in a new session adds no count; a check on a branch other than the gates' `branch` stops with an error naming both; the third WRONG and `claim-<id>` with its question land in one `recordGates` call, and so do a released `shim-<id>`'s new member and its placing again; a claim check completed after a shim check carries the bugs' `ranges` to its head as the new `anchor`, and a shim check after a claim check carries the lineages' `places` likewise; a size refusal records nothing and reports the sizes; a round built from a reading older than a gates post is refused as stale
- [ ] T038 [P] [US1] Red test in `reviewer/tests/write-lock.test.ts` (quickstart #15): two hook runs post `placeHold(claim-7)` and a round concurrently → both in the newest snapshot
- [ ] T039 [P] [US1] Red tests in `reviewer/tests/launch.test.ts` for pure `lib/rules/launch.ts`, reading state through `RunState`, at non-default `max_rounds` and `max_audits` so a constant in code fails: a round's launch is refused while a hold whose ADR-0013 d4 "Refuses" column names rounds is OPEN (`escalation-`, `pushback-`, `audit-`), naming the hold id and its release, and not for `claim-`, `shim-` or `rescope-`; refused while the session's issue is in Blocked or Backlog (ADR-0015 d3) and while reviewer is off (ADR-0006 d4); past `max_rounds` a stage's next round runs the audit stage on the whole PR and is not refused (ADR-0019 d5); the count is reset only by an admin's release or `/codeworks reset`, not by a settled round

### Implementation for User Story 1

- [ ] T040 [P] [US1] Create `reviewer/plugin/lib/rules/rounds.ts` (T034 green)
- [ ] T041 [P] [US1] Create `reviewer/plugin/lib/rules/counts.ts`, porting the count rules from `reviewer/plugin/scripts/claimgate.py` and `shimgate.py`; the thresholds now in `claimcheck.py` and `shimcheck.py` come from `ReviewerSettings` (`claim_hold_at`, `shim_deep_at`, `shim_hold_at`), none in code (T035 green)
- [ ] T042 [P] [US1] Port `reviewer/plugin/scripts/lineage.py` to `reviewer/plugin/lib/check/lineage.ts` on npm `diff-match-patch`; re-pin `reviewer/tests/test_lineage.py` behaviour red first in `reviewer/tests/lineage.test.ts`, plus a rewording across a session boundary: a lineage read back from the gates section (anchor, places, chain) is inherited by the reworded claim and keeps its chain, not a new lineage; an anchor absent from the bare copy is fetched by sha from the model's clone, then GitHub; absent from all three stops the check with an error naming the branch, the anchor and `/codeworks reset`, and still stops when the newest reset is older than some time in the section; once a reset is newer than every time in the section, the check starts the section over on its own head
- [ ] T043 [P] [US1] Port `reviewer/plugin/scripts/claimcheck.py` and `shimcheck.py` to `reviewer/plugin/lib/check/claim.ts` and `lib/check/shim.ts` (pure parts under `lib/rules/`); re-pin `test_claimcheck.py`, `test_shimcheck.py` behaviour red first in `reviewer/tests/claim-check.test.ts`, `reviewer/tests/shim-check.test.ts`
- [ ] T044 [P] [US1] Port `reviewer/plugin/scripts/reshape.py`, `decisions.py`, `adrkit.py`, `assessment.py`, `facts.py` to `reviewer/plugin/lib/round/{assess,decisions}.ts` and `lib/rules/reshape.ts`, replacing every `ledger` read with the `RunState` reading; re-pin `test_reshape.py`, `test_decisions.py`, `test_adrkit.py`, `test_assessment.py`, `test_worktree_facts.py` behaviour red first in matching `reviewer/tests/*.test.ts`. `specbinding.py` and `test_specbinding.py` are not ported: a round records no spec binding (ADR-0014 d1); `lib/rules/spec-source.ts` derives the story issue, the spec's issue and the spec folder from the branch at HEAD through core `parseBranch`, red first in `reviewer/tests/spec-source.test.ts` (a `<p>-spec` branch or one outside the grammar is refused a round), re-pinning of `test_spec_source.py` only what agrees with ADR-0014 d1
- [ ] T045 [P] [US1] Port `reviewer/plugin/scripts/jev.py`, `briefs.py`, `worktree.py`, `shell.py`, `snapshot.py`, `sweeper_read.py` to `reviewer/plugin/lib/` (`briefs.ts`, `jev.ts`, `worktree.ts`, `shell.ts`, `check/snapshot.ts`, `rules/sweeper-read.ts`), `briefs` reading state through `RunState` and runnable as `node ${CLAUDE_PLUGIN_ROOT}/lib/briefs.ts --ref '<round_ref>'` with the same `brief_token` output; repoint `reviewer/plugin/agents/assessor.md`'s brief command to it and drop "the ledger" from its facts line; re-pin `test_jev.py`, `test_worktree.py`, `test_shell.py`, `test_shim_snapshot.py`, `test_sweeper_read.py`, `test_agents.py` behaviour red first in matching `reviewer/tests/*.test.ts`
- [ ] T046 [US1] Create `reviewer/plugin/lib/rules/launch.ts` from ADR-0013 d4 and ADR-0019 d5 over core's `Snapshot`, `max_rounds` and `max_audits` taken from `ReviewerSettings`; `policy.py`'s cap lock, its reset at a settled round, `spec_held` and separate `assess-round` launch are not ported (ADR-0019 d1, d5, Option B; ADR-0014 d1) (T039 green)
- [ ] T047 [US1] Create `reviewer/plugin/lib/round/record.ts`: StructuredOutput round report/assessment → `writeState` / `placeHold` / `placeRescopeHold` with the minted writer, inside `withWriteLock`, each hold per T034's rules; the github round's merge blockers and trusted threads read only through core's validator modules (`requiredChecks`, `threadsModule`; ADR-0016); a rescope's open spec PR found per ADR-0013 d5; `StateWriteRefused` → refusal naming the release or could not run (refusals.md rows "state tampered", "state write over comment limit", "GitHub unanswered") (T036, T038 green)
- [ ] T048 [US1] Create `reviewer/plugin/lib/round/gates.ts`: claim/shim results → one `recordGates` call with the new gates and, when T035's rules place a `claim-<id>`/`shim-<id>` hold, its opening (claim: the last WRONG's failing case and evidence as its question), inside `withWriteLock`; refusals per refusals.md (T037 green)
- [ ] T048a [P] [US1] Red tests in `reviewer/tests/tool-gate.test.ts`: tool writes to `codeworks.toml` or the state folder refused naming the owner (ADR-0012 d1); every `Workflow` launch naming `review-round`, `claim-check` or `shim-check` rewritten to that name and the gate's args, `script`, `scriptPath` and `resumeFromRunId` dropped, and recorded (ADR-0021 d1); those launches refused while reviewer is off (ADR-0006 d4); PostToolUse `Workflow` records the run ID only for a recorded launch, and the run is invalid when its ID was seen before or `tool_response.scriptPath` differs from the plugin's file, so its verdicts never count (ADR-0021 d2)
- [ ] T049 [US1] Create `reviewer/plugin/lib/round/launch.ts` and wire into `reviewer/plugin/hooks/pre-tool-use.ts`: the refusals and rewrite of T048a, story-branch `spec.md` edit, round launch gate (T046), output validation; wire `Read|Glob|Grep` sweeper confinement (contracts/hooks.md) (T048a green)
- [ ] T050 [US1] Wire `reviewer/plugin/hooks/post-tool-use.ts` StructuredOutput branch to `round/record.ts` and `round/gates.ts` and its `Workflow` branch to T048a's run-ID record; wire `reviewer/plugin/hooks/subagent.ts` (in-flight reviewer tracking) and `reviewer/plugin/hooks/session-start.ts` (off-switch notice)
- [ ] T051 [US1] Port `reviewer on|off` to `reviewer/plugin/hooks/user-prompt-submit.ts`, writing the switch via core `setReviewerOff`; remove `unlock …` and `override shim-…` prompts (FR-008); re-pin `test_switch.py` behaviour red first in `reviewer/tests/switch.test.ts`
- [ ] T052 [US1] Rewrite `reviewer/plugin/hooks/hooks.json`: every entry `node ${CLAUDE_PLUGIN_ROOT}/hooks/<file>.ts`, `onFailure: block`, matchers per contracts/hooks.md; no `pre_merge_gate.py` entries
- [ ] T053 [US1] Delete `reviewer/plugin/scripts/{ledger,pre_merge_gate,gate,policy,claimgate,shimgate,hookio,config,github,lineage,claimcheck,shimcheck,reshape,specbinding,decisions,adrkit,assessment,facts,jev,briefs,worktree,shell,snapshot,sweeper_read}.py` and `reviewer/plugin/config.json`; keep `scripts/codexstate.py` (poller only); delete their Python tests (`test_ledger.py`, `test_pre_merge_gate.py`, `test_poller_contract.py`, `test_gate.py`, `test_policy.py`, `test_claim_gate.py`, `test_shim_gate.py`, `test_specbinding.py` and each test re-pinned in T042–T051); delete `reviewer/tests/{helpers,paths,replay_shim}.py` only if no kept Python test imports them (FR-018, R13)
- [ ] T054 [US1] Remove the inbox hand-off from `reviewer/plugin/skills/github-pr-review/poll-pr-review.sh` (the function writing `$inbox/…json`, lines 309–315) and from `reviewer/plugin/skills/github-pr-review/SKILL.md` the "Unresolved findings" step that hands findings to the `reviewer` gate and runs `reviewer:assess-round` (ADR-0019 Option B); drop `drop()` and every inbox assertion from `reviewer/tests/test_poll_pr_review.py` (R13)
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
- [ ] T058 [P] [US2] Red tests in `reviewer/tests/bare-copy.test.ts`: bare copy at `<session>/repo.git` created on first use; commits taken only by `git fetch --no-tags` from the model's clone over a local path into the copy's own refs, and no other git command run in the clone (ADR-0021 d6, SECURITY.md); fetch failure → `COULD_NOT_RUN`
- [ ] T059 [P] [US2] Red tests in `reviewer/tests/after-commit.test.ts` (quickstart #11–#13, #16–#18): A pass / B fail / C pass; could-not-run records nothing; a change touching any path core's `protectedPaths` returns (`.github/` or `docs/adr/` at any depth or case, `CLAUDE.md`, a folder `[shared] adr_folders` lists inside the repo, the spec folder beyond TICK_ONLY) fails and records nothing, while one only ticking the story's task block passes (ADR-0002 d4); a merge of the default branch bringing such changes passes unless its conflict resolution touches one (ADR-0002 d3); a change to a merged story's task block fails, and after a merge of the default branch the spec folder must equal the default branch's but the story's own ticks (ADR-0015 d4); new session grades from GitHub head A; amend C→C' graded from GitHub head, then reset below GitHub head refused naming it; restoring an earlier passed commit after a rewrite and passing it makes it the newest pass; passes on `42-us1-login` then `42-us2-logout` keep separate newest passes; reviewer off → no check, nothing recorded
- [ ] T060 [P] [US2] Red test in `reviewer/tests/after-commit-holds.test.ts`: open `escalation-`, `claim-`, `shim-`, `rescope-` hold (except `rescope-` on a default-branch merge, ADR-0013 d5) refuses naming the hold id and its release, `claim-` only when the range touches its file and `shim-` only its lines, while an unrelated range passes with the hold still OPEN; pending claim/shim check refuses naming the workflow and range

### Implementation for User Story 2

- [ ] T061 [P] [US2] Create `reviewer/plugin/lib/rules/range.ts` (T057 green)
- [ ] T062 [P] [US2] Create `reviewer/plugin/lib/check/bare-copy.ts` over core `runGit` / `fetchWithGhCredential`; GitHub branch head read with the session token (T058 green)
- [ ] T063 [US2] Create `reviewer/plugin/lib/check/after-commit.ts` state machine `idle → fetched → based → fenced → structural → awaiting_checks → PASS | FAIL | COULD_NOT_RUN` (data-model); structural steps: holds; core's `protectedPaths` over the graded change (a merge's conflict resolution only, ADR-0002 d3) with `{tickOnly, adrFolders}`: `tickOnly` the story's `tasks.md` when core's `isTickOnly` finds its base and head versions TICK_ONLY, else null; `adrFolders` the `inside` folders of core's `adrFolders`, each relative to the repo root (#177 R12), failing on any path it returns (ADR-0002 d4); the task-block rule of ADR-0015 d4 through core's `readTaskBlockLabels`; running state in `<session>/check.json`, memos in `<session>/memos/*.json` (FR-017); PASS → `recordCommitPasses` for every sha of the range; fence step is a pass-through placeholder until US3 (T059, T060 green)
- [ ] T064 [US2] Wire `reviewer/plugin/hooks/post-tool-use.ts` Bash branch: fetch the clone's HEAD into the bare copy's own ref (T058) and compare it with that ref's sha before the command; a clone the fetch cannot read refuses the command (ADR-0020 d2); new commits run `after-commit.ts`; StructuredOutput claim/shim results feed the awaiting check and, on PASS, the pass record
- [ ] T065 [US2] Skip the check entirely while `off` is set in the pass record (FR-019)

**Checkpoint**: Orchestrator can push up to the newest commit-check pass.

---

## Phase 5: User Story 3 — A session commits only on its own story's branch (P1)
Story issue: #237

**Goal**: The after-commit check's first step refuses commits off `<issue>-us`, and every commit in a session with no recorded issue. Reads core's session record (T019).

**Independent Test**: Record faked as `#42`; commits on `42-us1-login`, `43-us1-other`, `main` → first proceeds, others refused naming `#42` and `42-us`, none recorded (quickstart #7).

### Tests for User Story 3 ⚠️

- [ ] T066 [P] [US3] Red tests in `reviewer/tests/fence.test.ts` for pure `fence(record, branch, lane, switchOn): Allow | Refuse`: switch off → allow; no record → refuse naming `/codeworks <issue>` and `reviewer off`; branch without `<s>-us` (via core `parseBranch`) → refuse naming `#<s>` and `<s>-us`; the record's issue in Blocked or Backlog → refuse naming the lane (ADR-0015 d3); `42-us2-logout` in a working lane allowed
- [ ] T067 [P] [US3] Red tests in `reviewer/tests/after-commit-fence.test.ts` (quickstart #7, #8, #14): fenced-out commits recorded as nothing; unreadable record → could not run naming the record's path; `mode = "log"` → the fence's refusal logged as `would_deny`, the commit not blocked and its range recorded as passed (ADR-0006 d1)

### Implementation for User Story 3

- [ ] T068 [US3] Create `reviewer/plugin/lib/rules/fence.ts` (T066 green)
- [ ] T069 [US3] Read the session record through core's `readSessionRecord` in `reviewer/plugin/lib/session.ts` (absent → no record; `SessionRecordRefused` → `COULD_NOT_RUN`, R7) and the issue's lane through core's `laneOf` on `[shared] board` at each check (ADR-0015 d3); replace the fence placeholder in `reviewer/plugin/lib/check/after-commit.ts` with `fence.ts` as the first step (T067 green)

**Checkpoint**: SC-003 holds across the fence tests.

---

## Phase 6: User Story 4 — A Ready claim releases the holds an admin answered, once (P1)
Story issue: #238

**Goal**: Every hook entry's first step calls `releaseOnClaim` once per claim, never on a resume. Reads core's session record (T019).

**Independent Test**: OPEN `claim-7` with Ready move + admin comment after; record = claim; hook run twice → one release POST, first run only; record = resume → none (quickstart #9, #10).

### Tests for User Story 4 ⚠️

- [ ] T070 [P] [US4] Red tests in `reviewer/tests/claim-step.test.ts` for pure `lib/rules/claim-step.ts`: record `taken: "claim"` + no marker `released-<issue>-<at>` → release; marker present → nothing; `taken: "resume"` or no record → nothing; second claim of the same issue (new `at`) → release again
- [ ] T071 [P] [US4] Red tests in `reviewer/tests/release-on-claim.test.ts` (quickstart #9, #10): one release POST on first run only; resume → no POST; hold without admin comment stays OPEN; `/codeworks reset` → every open hold RELEASED with `reset: true`, and every count restarts: a lineage with WRONG rulings before the reset needs `claim_hold_at` new ones (ADR-0013 d3); `releaseOnClaim` throws → could not run, no marker, next run retries; two concurrent first runs → one release (write lock)

### Implementation for User Story 4

- [ ] T072 [US4] Create `reviewer/plugin/lib/rules/claim-step.ts` (T070 green)
- [ ] T073 [US4] Run the claim step first in every entry under `reviewer/plugin/hooks/*.ts` via a shared `reviewer/plugin/lib/claim.ts`: `releaseOnClaim` with the minted writer inside `withWriteLock`, marker written after success (T071 green)

**Checkpoint**: SC-004 holds; all four stories functional.

---

## Phase 7: Polish & Cross-Cutting Concerns
Story issue: #238

- [ ] T074 [P] Rewrite `reviewer/plugin/README.md` module table and hook section for the TS layout; drop ledger, `unlock`, `override`, `pre_merge_gate.py`
- [ ] T075 Bump `reviewer/plugin/.claude-plugin/plugin.json` version for the release containing US1–US4
- [ ] T076 Run quickstart.md: `npm --prefix core test`, `npm --prefix reviewer test`, `node core/scripts/check-carriers.ts --base origin/main`; confirm every scenario in quickstart.md maps to a passing test
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
- PR B: T007, T008, T011 [P]. PR C: T013 [P].
- PR S: T021, T022, T024, T026, T028, T030 [P] once T020 is in.
- US1: T034–T039, T048a tests [P]; T040–T045 ports [P] (distinct files).
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
3. US3 → fence.
4. US4 → release on claim.

No rollback path: the ledger is gone at US1; forward-fix only.
