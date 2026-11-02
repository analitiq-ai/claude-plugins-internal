# Research: reviewer writes the records the orchestrator acts on, through core

Every decision below is cited by a mechanism in [plan.md](plan.md#mechanisms). Facts are read from `core/src`,
`reviewer/plugin`, `planner/plugin` and the ADRs named; the #174 spec was not readable from this worktree, so
its record is taken as the spec's VP-001 – VP-003 state it.

## R1: The hook path is TypeScript on core; the Python plugin is retired, not bridged

- **Decision**: Every reviewer hook becomes a TypeScript entry under `reviewer/plugin/hooks/`, run as
  `node ${CLAUDE_PLUGIN_ROOT}/hooks/<event>.ts` (Node's type stripping, `onFailure: block`), importing core
  through a carrier symlink `reviewer/plugin/core → ../../core/src` with core's exact pins in
  `reviewer/plugin/package.json` and a v3 lockfile. Every Python module the hook path reaches
  (`gate.py`, `policy.py`, `claimgate.py`, `shimgate.py`, `claimcheck.py`, `shimcheck.py`, `lineage.py`,
  `briefs.py`, `facts.py`, `assessment.py`, `reshape.py`, `specbinding.py`, `hookio.py`, `shell.py`,
  `worktree.py`, `snapshot.py`, `sweeper_read.py`, `jev.py`, `adrkit.py`, `decisions.py`, `config.py`,
  `github.py`) moves to TypeScript under `reviewer/plugin/lib/`; `ledger.py` is deleted (FR-018).
- **Rationale**: Root ADR-0009 d2: no Python calls core, and a script moves in the change that first makes it
  call core. The dispatcher (`gate.py`) decides on rounds and holds, so it calls core; every module it imports
  runs in its process, and a TS hook cannot import Python. Calling Python from TS by subprocess would keep
  two runtimes on one decision path (a parallel implementation, coding-principles "define once").
- **Existing tools**: `planner/plugin` is the one live carrier (`lib/settings.ts`, `lib/github.ts`,
  `hooks` pattern from `core/tests/fixtures/carrier-plugin/hooks/identity.ts`: static `guard.ts` import,
  `requireDependencies()`, dynamic import of core). `core/scripts/check-carriers.ts` already grades any
  `*/plugin/core` link, pins and version bump. `diff-match-patch` has an npm package (`diff-match-patch`,
  same algorithm as the Python one `lineage.py` uses), so lineages port without a new algorithm. The four
  `workflows/*.js` and `agents/*.md` are already non-Python and stay, except the assessor's brief command:
  `agents/assessor.md` runs `briefs.py`, so it is repointed to the ported `lib/briefs.ts` entry, same `--ref`
  argument and `brief_token` output, and its brief's facts come from git and core's state, not the ledger.

## R2: Reader is the session token; writer is the reviewer App minted per run

- **Decision**: `readState` and every core read take a reader built from the session App token the
  orchestrator's SessionStart hook keeps in its gh config folder (`readGhToken(folder)`, root ADR-0007 d2).
  Every write takes a writer from `mintToken("reviewer", settings.reviewer.app_id, "reviewer-app.pem",
  "reviewer", repo)` → `gitHub(minted.value)`, minted once per hook run that writes. `app_id` and the
  per-check modes now in `reviewer/plugin/config.json` move to a strict `[reviewer]` section of
  `codeworks.toml`, parsed by `ReviewerSettings` (Zod) in `reviewer/plugin/lib/settings.ts`.
- **Rationale**: `APP_PERMISSIONS.reviewer` is `{issues: write}` only; `readState` reads project items
  (`organization_projects`), which only the session App can read. Root ADR-0002 keeps every component's
  settings in one TOML section; core's `section("reviewer")` returns the raw table for the component to
  validate. No token is cached across runs, so none outlives its hour.
- **Existing tools**: `core/src/tokens.ts` `mintToken`, `core/src/gh-config.ts` `readGhToken`,
  `core/src/settings.ts` `readSettings`, planner's `PlannerSettings` and `mintPlannerToken` (same shape).

## R3: One state reading per hook run, discarded at its end

- **Decision**: A hook run that decides on rounds or holds calls `readState` at most once, through a
  run-scoped `RunState` object passed down explicitly; writes go through core's write functions, which
  re-read inside core. Nothing of the reading is written to disk.
  Every state write, and the claim step (R9), holds an exclusive `write.lock` in the session folder
  from core's read to its post, so two hook runs of one session never post from the same reading (FR-020).
- **Rationale**: FR-004 and orchestrator ADR-0003 d5 (store nothing readable on GitHub). Core's writes re-read
  before posting, but nothing serialises two concurrent read→post sequences: Claude Code runs hooks of parallel
  tool calls and subagents concurrently, and the later post would drop the earlier one's hold or round. One
  session runs on one machine, so a local lock suffices.
- **Existing tools**: `core/src/state.ts` `readState`, `writeState`, `placeHold`. The ledger's cache role
  (ADR-0011 d5) is the alternative rejected by the spec's clarification.

## R4: Rounds and holds map onto core's value sets

- **Decision**: A round's result is core's `RoundResult` (CLEAN / DIRTY / INCOMPLETE, ADR-0021 d4) and a DIRTY
  round's verdict core's `RoundVerdict`. Today's `RESHAPE_SPEC` maps to `RESCOPE` and places
  `placeRescopeHold(issue, specPr)`; `ESCALATE` places an `escalation-<issue>` hold with the question;
  spent audits (`max_audits`) place `audit-<issue>`; an open pushback the stage cap reaches places
  `pushback-<issue>`; claim and shim holds are `claim-<lineage>` and `shim-<bug>` (ADR-0013 d4 table).
  Rounds are keyed by `RoundId {stage, n}` on the story issue, not by PR.
- **Rationale**: FR-003, root ADR-0010. The PR-keyed `epoch` and `unlocked_at` disappear: a hold's release is
  its row's `released`, written only by `releaseOnClaim` (FR-008).
- **Existing tools**: `core/src/values.ts` value sets, `core/src/contracts/snapshot.ts`, `core/src/attest.ts`
  `passingRounds` (what the orchestrator will count).

## R5: The gates section of core's snapshot (prerequisite core PR)

- **Decision**: Before this spec's code, a core PR adds `gates: Gates | null` to `Snapshot` and a `recordGates`
  call that posts the gates change and the `claim-`/`shim-` holds it places in one post; every other writer
  refuses a `gates` differing from the one it read; `recordGates` refuses a snapshot that would not fit with
  every open hold released and one more round recorded ([contracts/gates-snapshot.md](contracts/gates-snapshot.md)).
  The ADR amendments FR-016 names (reviewer ADR-0001 d2, ADR-0008, ADR-0011 d1, ADR-0013 d4) land first.
- **Rationale**: One comment means one post: a count and its hold land together, so no run can die between them,
  and the newest-unedited rebuild restores counts and holds from the same moment. `judge()` already takes the
  newest reviewer App comment as state, so tamper and release rules apply unchanged. The size rule keeps a
  growing gates section from blocking an admin's release, which shares the comment. Principle VI: the governing
  ADRs and core's rule ship apart from reviewer's code.
- **Existing tools**: `core/src/state.ts` `judge`, `snapshotOf`, `checkTransition`, `untamperedSnapshot`,
  `COMMENT_LIMIT`. A second tagged comment was rejected: two posts leave a crash gap and need tag-classing.

## R6: Gate counts derive from times in the gates section

- **Decision**: The gates section is written once, field by field, from what today's claim and shim gates read
  again in a later run (every field cites its reader): [contracts/gates-snapshot.md](contracts/gates-snapshot.md). It holds the
  story's one branch (root ADR-0005) and its anchor commit; lineage counts are distinct WRONG check refs after the
  reset, bug counts are members after the reset, and a merge keeps the higher count (ADR-0008 d2). The record that
  reaches a threshold places the hold, with its question, in the same `recordGates` post.
- **Rationale**: FR-015: counts never stored, so a reset or a release needs no gates write to take effect, and no
  count can drift from its evidence.
- **Existing tools**: `claimgate.py`/`shimgate.py` count rules and thresholds (ported); `StateReading.reset`
  and the hold row's `released` from core.

## R7: Session issue record read through #174's core reader

- **Decision**: reviewer reads the record only through the core function #174 adds (VP-001), keyed by the
  hook's `session_id`. Absent file → "no recorded issue"; unreadable or invalid file → could not run (P4).
- **Rationale**: FR-013; P6 (the orchestrator is its one writer). This spec adds nothing to it.
- **Existing tools**: None in core yet (grep of `core/src` for a sessions record finds nothing); it lands with
  #174's core PR (PR #216). This spec's reviewer code is blocked on it.

## R8: The fence is a pure function applied by the after-commit check

- **Decision**: `fence(record, branch, switchOn): Allow | Refuse` in `lib/rules/fence.ts`: allow when the
  switch is off; refuse with `/codeworks <issue>` and `reviewer off` when no record; refuse naming `#<s>` and
  `<s>-us` when the branch lacks the prefix (parsed by core `parseBranch`, story = record issue). It is the
  first step of the after-commit check (R10), so a commit made by any route is fenced; a fenced-out commit
  is never recorded as passed, and the PostToolUse hook blocks with the refusal.
- **Rationale**: ADR-0015 d1–d2; ADR-0020 d2 enforces commit refusals through the check of the commits, which
  are pushed only once passed. One enforcement point, so `git commit`, rebase and scripts behave alike.
- **Existing tools**: `core/src/identity.ts` `parseBranch`. A PreToolUse match on `git commit` (today's
  `shell.py` classifier) was rejected: it misses other routes and would be a second fence.

## R9: Release on claim exactly once, before anything else in the run

- **Decision**: Every hook entry first runs `claimStep(record, marker)`: if the record names a claim and no
  marker `released-<issue>-<claimed_at>` exists in the session folder, call `releaseOnClaim`, then write the
  marker. On a resume or with no record it does nothing. If the call throws, the run refuses as could not
  run and writes no marker, so the next run retries.
- **Rationale**: FR-007, ADR-0013 d2, orchestrator ADR-0002 d3; two claims in one session get two markers. A
  marker is keyed by the claim's time, so a second claim of the same issue releases again.
- **Existing tools**: `core/src/state.ts` `releaseOnClaim` (handles resets, VP-004; posts nothing when nothing
  is releasable).

## R10: After-commit check over a hooks-owned bare copy

- **Decision**: PostToolUse on every Bash command compares the model clone's branch head to the head before
  the command (ADR-0020 d2). For new commits the hook fetches them into a bare copy at
  `~/.local/state/codeworks/reviewer/sessions/<session>/repo.git` (created on first use; `git fetch <clone>
  <sha>` only, ADR-0021 d6), then grades the range `base..head`, where `base` is the newest commit-check pass
  on that branch or, at the branch's first check in the session, the story branch's head on GitHub (merge base
  with the default branch when the branch is not on GitHub), fetched with the session token. `base` must be an
  ancestor of `head`: when it is not (an amend, rebase or reset past it), `base` becomes the branch's head on
  GitHub; when that is not an ancestor either, pushed history was rewritten and the check refuses, naming the
  pushed head to restore (FR-021). Steps, in order: fence (R8), open holds
  that refuse commits (`escalation-`, `claim-`, `shim-`, `rescope-` except a default-branch merge, ADR-0013
  d4–d5; `claim-<id>` refuses only a range touching its lineage's `file`, `shim-<id>` only one touching its bug's `ranges` (ADR-0013 d4)), `.github/`
  and protected-path touch (ADR-0002 d4), merge resolution only for merges (ADR-0002 d3), then the claim and
  shim checks as workflows the model launches on the range (ADR-0003 d2). Their running state and memos are
  files in the same session folder (FR-017). A pass records every commit of the range (R11).
- **Rationale**: ADR-0002 d1–d4, ADR-0021 d6, VP-005 (none of this exists). Grading from GitHub's head means a
  dead session's unpushed passes are graded again (FR-014).
- **Existing tools**: `core/src/git.ts` `runGit`, `fetchWithGhCredential`; `core/src/tree.ts` `gitTree`;
  `snapshot.py`'s export for sweepers (ported to export from the bare copy). The protected-path matcher of
  orchestrator ADR-0004 d4 is core's `protectedPaths` (`core/src/protected-paths.ts`, #230); the check calls it
  on the range's changed files, so the orchestrator and reviewer share one matcher.

## R11: Commit-check pass record as a core contract on local disk

- **Decision**: A core PR adds `core/src/contracts/commit-pass.ts` (Zod) and `core/src/commit-pass.ts`
  (`readCommitPasses(session)`, `recordCommitPasses(session, range)`), storing one JSON file per session at
  `~/.local/state/codeworks/reviewer/sessions/<session>/commit-passes.json`, passes keyed by branch so a second
  story branch or a second claim in one session keeps its own newest pass, written atomically (temp file,
  rename, 0600 in a 0700 folder). Reviewer's hook is its one writer; the orchestrator reads it through the
  same module.
- **Rationale**: FR-014, VP-003 (#174 Story 2 needs it); P6. The folder is already a deny path for the model
  (`core/src/keys.ts` `HOME_FOLDERS`), so the model cannot forge a pass.
- **Existing tools**: `core/src/gh-config.ts` `writeGhToken` (the atomic 0700/0600 write pattern, reused).
  GitHub (a ref or a check run) was rejected by the spec: a pass precedes the push.

## R12: `log` mode downgrades refusals only

- **Decision**: `refuse()` in `lib/hookio.ts` returns `deny` under `enforce` and appends `would_deny` to the
  session's `gate.log` under `log`; per-check settings (`claim_checks`, `shim_checks`, `decision_checks`)
  gate their own refusals as today. Rounds, holds, releases and passes are written in both modes.
- **Rationale**: ADR-0006 d1; spec edge case "reviewer in `log` mode".
- **Existing tools**: `hookio.py` `refuse`/`block`/`refuse_claim` (ported unchanged in meaning).

## R13: What is deleted at cutover

- **Decision**: Delete `ledger.py` and its SQLite file, the `unlock` / `override shim-` prompts, `ledger.py
  unlock`, `pre_merge_gate.py` (internal-review attestation for ready/merge), and `ledger.ingest_inbox` with
  the poller's inbox hand-off. No ledger row migrates; a PR open at cutover needs a fresh internal round.
- **Rationale**: FR-008, FR-018. Ready, merge and attestation are the orchestrator's (orchestrator ADR-0004,
  ADR-0007, ADR-0009); external reviewers are requested and read by the orchestrator (ADR-0008), so reviewer
  records no GITHUB-stage rounds. All three read the ledger, which no longer exists.
- **Existing tools**: None fit. Looked at: `ledger.py` (`unlock`, `ingest_inbox`), `pre_merge_gate.py`,
  `skills/github-pr-review/poll-pr-review.sh`.

## R14: Tests on `node:test` against core's GitHub recorder and temp repositories

- **Decision**: `reviewer/tests/*.test.ts` run by `node --test` after `tsc -p .`, same as core and planner;
  GitHub is `fakeGitHub` from `core/tests/support/fake-github.ts` with the `core/tests/fixtures/state/issue.ts`
  builders; git is real temp repositories (clone + bare copy). Python tests of retired modules are deleted
  with them; behaviour they pinned is re-pinned in TS tests written red first.
- **Rationale**: Constitution IV; CI already runs every `<component>/tests/` folder.
- **Existing tools**: `core/tests/support/fake-github.ts`, `core/tests/fixtures/state/issue.ts`,
  `planner/tests/support/checkout.ts`, `reviewer/tests/workflow_harness.mjs` (kept for the workflows).
