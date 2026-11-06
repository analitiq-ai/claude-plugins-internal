# Research: reviewer writes the records the orchestrator acts on, through core

Every decision below is cited by a mechanism in [plan.md](plan.md#mechanisms). Facts are read from `core/src`,
`reviewer/plugin`, `orchestrator/plugin`, `specs/174-orchestrator-plugin`, `specs/177-plan-adr-check` and the ADRs
named, at main 49a3d8b (reviewer ADR-0011 and ADR-0013 as merged in #290).

## R1: The hook path is TypeScript on core; the Python plugin is retired, not bridged

- **Decision**: Every reviewer hook becomes a TypeScript entry under `reviewer/plugin/hooks/`, run as
  `node ${CLAUDE_PLUGIN_ROOT}/hooks/<event>.ts` (Node's type stripping, `onFailure: block`), importing core
  through a carrier symlink `reviewer/plugin/core → ../../core/src` with core's exact pins in
  `reviewer/plugin/package.json` and a v3 lockfile. Every Python module the hook path reaches
  (`gate.py`, `policy.py`, `claimgate.py`, `shimgate.py`, `claimcheck.py`, `shimcheck.py`, `lineage.py`,
  `briefs.py`, `facts.py`, `assessment.py`, `reshape.py`, `hookio.py`, `shell.py`,
  `worktree.py`, `snapshot.py`, `sweeper_read.py`, `jev.py`, `adrkit.py`, `decisions.py`, `config.py`,
  `github.py`) moves to TypeScript under `reviewer/plugin/lib/`; `ledger.py` is deleted (FR-018), and so is
  `specbinding.py`, since a round records no spec binding (ADR-0014 d1). `codexstate.py` and
  `skills/github-pr-review/poll-pr-review.sh` are not on the hook path and call no core; they stay as they are.
- **Rationale**: Root ADR-0009 d2: no Python calls core, and a script moves in the change that first makes it
  call core. The dispatcher (`gate.py`) decides on rounds and holds, so it calls core; every module it imports
  runs in its process, and a TS hook cannot import Python. Calling Python from TS by subprocess would keep
  two runtimes on one decision path (a parallel implementation, coding-principles "define once").
- **Existing tools**: `planner/plugin` and `orchestrator/plugin` are live carriers (`lib/settings.ts`,
  `lib/hook-io.ts`, static `guard.ts` import, `requireDependencies()`, dynamic import of core).
  `core/scripts/check-carriers.ts` already grades any `*/plugin/core` link, pins and version bump.
  `diff-match-patch` has an npm package (same algorithm as the Python one `lineage.py` uses), so lineages port
  without a new algorithm. The four `workflows/*.js` and `agents/*.md` are already non-Python and stay, except the
  assessor's brief command: `agents/assessor.md` runs `briefs.py`, so it is repointed to the ported
  `lib/briefs.ts` entry, same `--ref` argument and `brief_token` output, its facts from git and core's state
  (earlier rounds' finding counts and positions from `Round.findings`, R4), at CUT with `hooks.json` (R16): until
  then the live `gate.py` grades the assessor's `brief_token` against the SQLite round, which only `briefs.py` can
  produce.

## R2: Reader is the session token; writer is the reviewer App, `contents: write`, minted per writing run

- **Decision**: `readState` and every core read take a reader built from the session App token the
  orchestrator's SessionStart hook keeps in its gh config folder (`readGhToken(ghFolder(home))`, root ADR-0007 d2).
  Every write takes a writer from `mintToken("reviewer", settings.reviewer.app_id, "reviewer-app.pem", "reviewer",
  repo)` → `gitHub(minted.value)`, minted once per hook run that writes. Core PR B sets
  `APP_PERMISSIONS.reviewer` to `{ contents: "write" }` and, in the same PR, SECURITY.md §3's `codeworks-reviewer`
  row to `contents: write` and drops its "until #209 lands" sentence; the test that pins the table to the map
  keeps them equal (FR-023). `app_id` and the per-check modes now in `reviewer/plugin/config.json` move to a
  strict `[reviewer]` section of `codeworks.toml`, parsed by `ReviewerSettings` (Zod) in
  `reviewer/plugin/lib/settings.ts`.
- **Rationale**: ADR-0011 d3: the reviewer App writes `ledger` and nothing on issues. The session App already
  reads contents, issues, the board and collaborator roles, which the fold and the release rule read. Root
  ADR-0002 keeps every component's settings in one TOML section. No token is cached across runs.
- **Existing tools**: `core/src/tokens.ts` `mintToken`, `APP_PERMISSIONS`; `core/src/gh-config.ts` `readGhToken`;
  `core/src/orchestrator-paths.ts` `ghFolder`; `core/src/settings.ts` `readSettings`/`section`; planner's and the
  orchestrator's `lib/settings.ts` (same shape).

## R3: One reading per hook run, advanced by each write; the head it names serialises writers

- **Decision**: A hook run that decides on rounds or holds calls `readState` once and passes the
  `StateReading` down explicitly. Every core write takes that reading and commits with
  `expectedHeadOid = reading.head`, the `ledger` head the reading was folded at. A successful write returns the
  reading after its commit, folded locally from the old reading plus its own events with `head` the new
  commit's oid (no intervening commit can exist, since GitHub accepted the expected head), so the run decides
  its next step on it without a second read. When GitHub refuses the mutation, core reads the `ledger` ref: a
  head other than `reading.head` throws `StateStale`; the same head rethrows GitHub's refusal. reviewer's hook
  answers `StateStale` by reading `issues/<n>/`'s path history from the new head: when no commit since
  `reading.head` touched the directory, the reading stands with `head` re-pointed and the same commit is retried;
  otherwise it reads again and decides the whole step again. At most 3 attempts per step, then it refuses as
  could not run. No local lock and no copy outlives the run.
- **Rationale**: FR-004, FR-016, FR-020, ADR-0011 d1: GitHub's expected-head check is the one serialiser, across
  hook runs, sessions and machines; the retry re-decides, so a round's `n` or a hold's state is computed from what
  landed. Classifying the refusal by re-reading the ref, not by GitHub's error text, keeps P7. Three attempts
  bound the run when other stories' writes keep moving the branch.
- **Existing tools**: `core/src/github.ts` `GitHubRefused`, `graphql`. A session `write.lock` (the October plan)
  was rejected: it serialises one session only, and the expected head now covers every writer.

## R4: Rounds and holds map onto core's value sets

- **Decision**: A round's result is core's `RoundResult` (CLEAN / DIRTY / INCOMPLETE, ADR-0021 d4) and a DIRTY
  round's verdict core's `RoundVerdict`, the first that matches by reviewer ADR-0017 d2: ESCALATE (a finding ruled
  ESCALATE, an ADR departure that is not FIX among them; the assessor cannot decide; a deadlock), RESCOPE (a
  finding shows the spec does not settle a decision), PATCH/CLASS_FIX/REDESIGN (at least one FIX; the assessor
  picks within ADR-0017 and ADR-0018), CONVERGED_PUSHBACK (every finding PUSH_BACK or DEFER); composed in
  `lib/rules/rounds.ts`, the assessor's output only its input. Today's `RESHAPE_SPEC` maps to `RESCOPE` and places
  `placeRescopeHold({question})`; `ESCALATE` places `escalation-<issue>` with its question; each question says why
  the round was raised and what must be decided (ADR-0013 d4–d5); spent audits (`max_audits`) place
  `audit-<issue>`; an open pushback the stage cap reaches places `pushback-<issue>`; claim and shim holds are
  `claim-<lineage>` and `shim-<bug>` (ADR-0013 d4 table). Rounds are keyed by `RoundId {stage, n}` on the story
  issue, and core's `Round` gains `run`, the workflow run that produced it (ADR-0021 d2), which names its file (R5),
  and `findings`, each finding its reviewers reported as key, file and line and no text (ADR-0016 d2): the assessor's
  facts (finding counts of earlier rounds, positions reviewed before, ADR-0018 d2's reset point) read them from the
  fold, since no round report outlives its run (FR-004, FR-026).
- **Rationale**: FR-003, root ADR-0010. The PR-keyed `epoch` and `unlocked_at` disappear: a hold's release is
  a release event, written only by `releaseOnClaim` (FR-008).
- **Existing tools**: `core/src/values.ts` value sets, `core/src/contracts/snapshot.ts`, `core/src/attest.ts`
  `passingRounds` (what the orchestrator counts).

## R5: The ledger record's events and file names are core contracts (core PR B)

- **Decision**: `core/src/contracts/ledger.ts` defines `LedgerEvent`, a Zod union on `kind` (`round`, `ruling`,
  `ruling-commit`, `pushback`, `hold`, `release`, `gates`), and `eventFile(event)`, the one function that names an
  event's file under `issues/<n>/`: `<kind>.<key>.json`, the key the event's own (a round by its `run`, a hold
  by its id and `since`, a release by the placement it releases, gates by the check that wrote it), free-text keys
  as their SHA-256 hex. Ids, runs and refs match `[A-Za-z0-9._-]+`, so every name is one plain path segment.
  `core/scripts/write-schemas.ts` adds `ledger-event.schema.json` beside the regenerated `snapshot.schema.json`.
  Shapes and names: [contracts/ledger-record.md](contracts/ledger-record.md).
- **Rationale**: ADR-0011 d1 (one event per file, add-only, named by its key, so a retry finds its events),
  root ADR-0003 d3 (events and snapshot as Zod schemas with generated JSON Schemas), spec Key Entities (a round
  by its workflow run, a hold by its id and `since`). Every Snapshot field has one event kind, so the fold yields
  the whole `Snapshot` and no field is kept anywhere else.
- **Existing tools**: `core/src/contracts/snapshot.ts` (`Round`, `Hold`, `Pushback`, `Ruling`, `Time`, reused as
  the events' payloads); `core/scripts/write-schemas.ts` and its drift test.

## R6: The reader is the fold of the directory's history (core PR B)

- **Decision**: `readState(reader, repo, issue, shared)` keeps its signature and the issue reads it has today
  (comments, Ready moves, project items, collaborator roles, `BoardNotVisible`), and replaces the state comment
  with the fold:
  1. GraphQL: `ref(qualifiedName: "refs/heads/ledger")` → its target oid, `head`; null throws `LedgerMissing`
     (FR-025). Then `object(oid: head).history(path: "issues/<n>/")`, every page against that one oid, each commit's
     `oid`, `committedDate`, `parents`, `signature { isValid wasSignedByGitHub }`, and the directory's tree at the
     commit and at its first parent (`entries { name oid }`). Texts are read once per added blob oid.
  2. REST `GET /repos/{o}/{r}/commits?sha=<head>&path=issues/<n>/` for each commit's `author.login`; a set of
     shas differing from GraphQL's is no answer (could not run).
  3. Oldest first, each commit is classed (ADR-0011 d2): an event commit (GitHub-signed and valid, author
     `[shared] reviewer_app_login`, adds only, every added file an event its name keys, every event applying
     under the fold's rules); a clearance (GitHub-signed and valid, author whose `roleOf` is `admin`, deletes
     only files an earlier invalid commit added or changed); otherwise invalid: nothing applied, `tamper-<oid>`
     derived with the files it added or changed.
  `StateReading` gains `head` and `tamper: Tamper[]`; `StateCause` becomes `{cause: "tampered", commit,
  remaining}` or `{cause: "open_hold", id}`; `rebuilt`, `comment_url` and `tamper_released` go, and
  `ClaimRelease` loses `rebuilt`. A hold's release floor is its placing commit's `committedDate`; a tamper's, the
  earlier of the invalid commit's `committedDate` and that of the first GitHub-signed commit after it on `ledger`
  (its clearance is one). A tamper is releasable only once `remaining` (its files still at `head`) is empty and the
  release rule holds. No directory → `snapshot: null`. The orchestrator's `start.ts` `causeOf` and its test
  fixtures move to the new causes in the same PR.
- **Rationale**: FR-002, FR-022, FR-024, ADR-0011 d2, ADR-0013 d1–d3. Pinning every page to one oid makes the
  fold and the expected head of the next write the same state. GraphQL gives `wasSignedByGitHub` and trees;
  only REST names a bot author by login, which `[shared]` holds. With the three rulesets only the reviewer App and
  an admin commit there, but an admin's own-key commit carries a date of its author's choosing, and a date set
  ahead would wedge the release; GitHub's first signed commit after it bounds the floor. A repo without rulesets
  has only the fold's checks (OS-002). Root ADR-0003 d4: the one reader serves the orchestrator too.
- **Existing tools**: `core/src/state.ts` `judge`'s release rule (`releaseTerms`, `releaseOf`, `readyAfter`,
  `adminCommentAfter`, `questionTag`, `RESET_COMMAND`) kept unchanged; `core/src/github.ts` `graphqlPages`,
  `restPages`, `roleOf`, `restLogin`. Taking the newest event alone was rejected by ADR-0011 Option J.

## R7: Writes are add-only commits through `createCommitOnBranch`, each asserting GitHub's signature (core PR B)

- **Decision**: One private `commitEvents(writer, repo, issue, reading, events)` in `core/src/state.ts` is the
  only path to `ledger`: it refuses when `reading` has an unreleased tamper, unless the events release every one
  of them, which only `releaseOnClaim` sends and only when each is releasable (FR-002, FR-024; the refusal names
  the release), validates every event, drops events whose file the fold already holds (retry, FR-016), commits
  nothing when none is left, and otherwise calls `createCommitOnBranch` (`fileChanges.additions` only, `expectedHeadOid: reading.head`,
  headline `issues/<n>: <kinds>`), asking back `commit { oid signature { isValid wasSignedByGitHub } }`. An answer
  not both true throws `StateWriteUnsigned` naming the oid (FR-016). The public writes keep their roles and gain
  the reading: `writeState(…, reading, next, placements)` derives round, ruling, ruling-commit and pushback events
  from `checkTransition(reading.snapshot, next)`, stamps each new round's `at` from GitHub's clock, and adds a hold
  event per placement whose row is not OPEN, so a round and the holds its report places (escalation, pushback, audit,
  a verdict's rescope) are one commit (ADR-0013 d4, FR-015); `placeRescopeHold(…, reading, specPr)` for a spec PR
  seen open; `recordGates(…, reading, ref, gates, openings)`; `releaseOnClaim(…, reading)`, one commit of a release
  event for every releasable hold and releasable tamper. `placeHold` goes: no hold is placed apart from the round or
  the gates that place it. Each returns the advanced reading (R3).
- **Rationale**: ADR-0011 d1, d3; FR-001, FR-016, FR-020, FR-023. Core derives events from transitions, so
  reviewer never writes a file name or a path, and the add-only rule is the mutation's own shape.
- **Existing tools**: `checkTransition`, `withRow`/`openRow` (now the fold's), `writer.now()`; GitHub's
  `createCommitOnBranch` mutation, tested in #288. REST contents writes were rejected: a custom author is refused
  by the signed-commits rule (#288).

## R8: The gates section is the newest gates event, written with the holds it places (core PR B)

- **Decision**: `core/src/contracts/gates.ts` defines `Gates` as [contracts/gates-snapshot.md](contracts/gates-snapshot.md)
  gives it, and `Snapshot` gains `gates: Gates | null`, the payload of the newest `gates` event in the fold, null
  before the story's first check. Only `recordGates` writes a `gates` event, in one commit with the `claim-`/`shim-`
  hold events its counts place. `Hold.question` is allowed on `escalation`, `claim` and a verdict-placed `rescope`
  (ADR-0013 d4–d5). The comment's size rule is dropped: no record is capped.
- **Rationale**: FR-015, FR-016, ADR-0011 d1, ADR-0013 d4: a count and its hold land in one commit, so no run dies
  between them. The section is one value replaced whole, so its newest event is its state; the story's state stays
  the fold of every event.
- **Existing tools**: today's `claimcheck.py`/`shimcheck.py`/`claimgate.py`/`shimgate.py` fields (each cited by its
  reader in the contract). A second record (comment or file outside the fold) was rejected by ADR-0011 d1.

## R9: Gate counts derive from times in the gates section

- **Decision**: The gates section holds what today's claim and shim gates read again in a later run (every field
  cites its reader): [contracts/gates-snapshot.md](contracts/gates-snapshot.md). It holds the story's one branch
  (root ADR-0005) and its anchor commit; lineage counts are distinct WRONG check refs after the reset, bug counts are
  members after the reset, and a merge keeps the higher count (ADR-0008 d2). The check that reaches a threshold
  places the hold, with its question, in the same `recordGates` commit.
- **Rationale**: FR-015: counts never stored, so a reset or a release needs no gates write, and no count drifts
  from its evidence.
- **Existing tools**: `claimcheck.py`/`shimcheck.py` count rules (ported), thresholds `claim_hold_at`,
  `shim_deep_at`, `shim_hold_at` as `[reviewer]` keys; `StateReading.reset` and the hold row's `released` from core.

## R10: Session issue record read through core

- **Decision**: reviewer reads the record only through `readSessionRecord(sessionsFolder(home), sessionId)`
  (`SessionRecord {v, repo, issue, taken: claim|resume, at}`), keyed by the hook's `session_id`. `null` → "no
  recorded issue"; `SessionRecordRefused` → could not run (P4).
- **Rationale**: FR-013; P6 (the orchestrator is its one writer). This spec adds nothing to it.
- **Existing tools**: `core/src/session-record.ts` `readSessionRecord`, `core/src/orchestrator-paths.ts`
  `sessionsFolder` (#174, PR #216, on main).

## R11: The fence is a pure function applied by the after-commit check

- **Decision**: `fence(record, branch, lane, switchOn): Allow | Refuse` in `lib/rules/fence.ts`, applying
  ADR-0015 d1–d3: the branch prefix through core `parseBranch` (story = record issue), the missing record, and the
  issue's lane on `[shared] board` read at each check. It is the first step of the after-commit check (R13), so a
  commit made by any route is fenced; a fenced-out commit is never recorded as passed, and the PostToolUse hook
  blocks with the refusal.
- **Rationale**: ADR-0015 d1–d3; ADR-0020 d2 enforces commit refusals through the check of the commits, which are
  pushed only once passed. One enforcement point, so `git commit`, rebase and scripts behave alike.
- **Existing tools**: `core/src/identity.ts` `parseBranch`; `core/src/board.ts` `laneOf`. A PreToolUse match on
  `git commit` (today's `shell.py`) was rejected: it misses other routes and would be a second fence.

## R12: Release on claim exactly once, first in the run

- **Decision**: Every hook entry that gates a commit, a round launch or a state write (PostToolUse `Bash`,
  `Workflow` and `StructuredOutput`; PreToolUse launches) first runs `claimStep(record, marker)`; `Read|Glob|Grep`,
  `reviewer on|off`, Subagent* and SessionStart entries skip it, so an unanswered GitHub after a claim blocks no
  read and `reviewer off` still lands (FR-007). `claimStep`: if the record names a claim and no marker
  `released-<issue>-<at>` exists in the session folder, read the state and call `releaseOnClaim(…, reading)`
  (retrying on `StateStale` as R3), then write the marker; the advanced reading serves the rest of the run. On a
  resume or with no record it does nothing. If the call throws, the run refuses as could not run and writes no
  marker, so the next run retries; a retry whose releases are in the fold commits nothing (R7).
- **Rationale**: FR-007, FR-024, ADR-0013 d2, orchestrator ADR-0002 d3; two claims in one session get two markers.
  A marker is keyed by the claim's time, so a second claim of the same issue releases again.
- **Existing tools**: `core/src/state.ts` `releaseOnClaim` (handles resets, VP-004).

## R13: After-commit check over a hooks-owned bare copy

- **Decision**: PostToolUse on every Bash command compares the model clone's branch head to the head before the
  command (ADR-0020 d2). For new commits the hook fetches them into a bare copy at
  `~/.local/state/codeworks/reviewer/sessions/<session>/repo.git` (created on first use; taken only by
  `git fetch --no-tags` from the clone into the copy's own refs, ADR-0021 d6), then grades the range `base..head`,
  `base` the newest commit-check pass on that branch or, at the branch's first check in the session, the story
  branch's head on GitHub (merge base with the default branch when the branch is not on GitHub): its sha is read
  by the API with the session token, and the object is fetched from the model's clone first, content-addressed,
  and from GitHub only when the clone lacks it, so a first check moves no full history inside the hook's timeout.
  `base` must be an ancestor of `head`: when it is not, `base` becomes the branch's head on GitHub;
  when that is not an ancestor either, pushed history was rewritten and the check refuses, naming the pushed head
  to restore (FR-021). Steps, in order: fence (R11); open holds that refuse commits (`escalation-`, `rescope-`
  except a default-branch merge, `claim-<id>` only for a range touching its lineage's `file`, `shim-<id>` only one
  touching its bug's `ranges`, any unreleased `tamper-<oid>`; ADR-0013 d1, d4–d5); a protected-path touch through
  core's `protectedPaths(changed, {tickOnly, adrFolders})` (ADR-0002 d4); merge resolution only for merges
  (ADR-0002 d3); then the claim and shim checks as workflows the model launches on the range (ADR-0003 d2). Their
  running state and memos are files in the same session folder (FR-017). A pass records every commit of the range
  (R14).
- **Rationale**: ADR-0002 d1–d4, ADR-0021 d6, VP-005 (none of this exists). Grading from GitHub's head means a dead
  session's unpushed passes are graded again (FR-014).
- **Existing tools**: `core/src/git.ts` `runGit`, `fetchWithGhCredential`; `core/src/tree.ts` `gitTree`;
  `snapshot.py`'s export for sweepers (ported to export from the bare copy). `protectedPaths` is
  `core/src/protected-paths.ts`; its `{tickOnly, adrFolders}` argument and core's `isTickOnly` land in #177 US5
  (`specs/177-plan-adr-check` T050–T052), not yet on main: `tickOnly` the story's `tasks.md` when `isTickOnly` finds
  its base and head versions TICK_ONLY, else null; `adrFolders` the `inside` folders of core's `adrFolders`.

## R14: Commit-check pass record as a core contract on local disk (core PR C)

- **Decision**: A core PR adds `core/src/contracts/commit-pass.ts` (Zod) and `core/src/commit-pass.ts`
  (`readCommitPasses`, `recordCommitPasses`, `setReviewerOff`), one JSON file per session at
  `~/.local/state/codeworks/reviewer/sessions/<session>/commit-passes.json`, passes keyed by branch, written
  atomically (temp file, rename, 0600 in a 0700 folder). Reviewer's hook is its one writer; the orchestrator reads
  it through the same module. [contracts/commit-pass-record.md](contracts/commit-pass-record.md).
- **Rationale**: FR-014, FR-019, VP-003 (#174 Story 2 needs it); P6. The folder is a deny path for the model
  (`core/src/keys.ts` `HOME_FOLDERS`), so the model cannot forge a pass. A pass precedes the push, so it has nothing
  on GitHub to live in.
- **Existing tools**: `core/src/gh-config.ts` `writeGhToken` and `core/src/session-record.ts`
  `writeSessionRecord` (the atomic 0700/0600 write, reused).

## R15: `log` mode downgrades refusals only

- **Decision**: `refuse()` in `lib/hook-io.ts` returns `deny` under `enforce` and appends `would_deny` to the
  session's `gate.log` under `log`; per-check settings (`claim_checks`, `shim_checks`, `decision_checks`) gate their
  own refusals as today. Rounds, holds, releases and passes are written in both modes; a tamper, a missing `ledger`
  and every could-not-run refuse in both. Every core write and every refusal is appended to `gate.log` with the
  hook event, the call, the oid or outcome and its latency, in both modes: the one trace on the agent machine of
  what a stalled story's runs wrote or refused.
- **Rationale**: ADR-0006 d1; spec edge case "reviewer in `log` mode"; P4 (a check that could not run is no
  downgradable finding).
- **Existing tools**: `hookio.py` `refuse`/`block`/`refuse_claim` (ported unchanged in meaning).

## R16: What is deleted at cutover; reviewer posts nothing

- **Decision**: Delete `ledger.py` and its SQLite file, the `unlock` / `override shim-` prompts, `pre_merge_gate.py`
  (internal-review attestation for ready/merge), `ledger.ingest_inbox` with the poller's inbox hand-off, and every
  comment-posting function of `github.py` (none is ported). No ledger row migrates and no tagged comment is read; a
  PR open at cutover needs a fresh internal round. The deletions and the `hooks.json` flip land in one cutover
  story after US4; until it the TypeScript hook path is unregistered and the Python hooks run unchanged, so one
  runtime decides each hook run at every merge (plan, Delivery order). There is no rollback past cutover: the
  previous plugin reads neither `ledger` nor the orchestrator's records; a defect is fixed forward.
- **Rationale**: FR-008, FR-018, FR-023. Ready, merge and attestation are the orchestrator's (orchestrator ADR-0004,
  ADR-0007, ADR-0009); a hold's question and claim comments are the orchestrator's (OS-001); the App can no longer
  post.
- **Existing tools**: None fit. Looked at: `ledger.py` (`unlock`, `ingest_inbox`), `pre_merge_gate.py`,
  `skills/github-pr-review/poll-pr-review.sh`, `github.py`.

## R17: Tests on `node:test` against core's GitHub recorder, a fake ledger and temp repositories

- **Decision**: `reviewer/tests/*.test.ts` run by `node --test` after `tsc -p .`, same as core, planner and the
  orchestrator. Core PR B adds `core/tests/fixtures/state/ledger.ts`: an in-memory `ledger` branch on `fakeGitHub`
  answering the ref, history, tree, blob and REST commit-list reads and `createCommitOnBranch` with expected-head
  refusal and a settable signature answer, plus builders for event, clearance and invalid commits. Git is real
  temp repositories (clone + bare copy). Python tests of retired modules are deleted with them; behaviour they
  pinned is re-pinned in TS tests written red first.
- **Rationale**: Constitution IV; CI already runs every `<component>/tests/` folder. The recorder lets SC-006
  assert no reviewer comment and FR-020 drive two writers from one reading.
- **Existing tools**: `core/tests/support/fake-github.ts`, `core/tests/fixtures/state/issue.ts`,
  `orchestrator/tests/support/story.ts`, `reviewer/tests/workflow_harness.mjs` (kept for the workflows).
