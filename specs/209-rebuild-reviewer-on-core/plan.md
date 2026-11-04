# Implementation Plan: reviewer writes the records the orchestrator acts on, through core

**Branch**: `209-spec` | **Date**: 2026-11-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/209-rebuild-reviewer-on-core/spec.md`

## Summary

reviewer's hook path is rebuilt in TypeScript on core (root ADR-0009 d2). It records rounds, holds, releases and the
claim/shim gates section as the reviewer App's GitHub-signed, add-only commits under `issues/<n>/` on the served
repo's `ledger` branch, through core's state module, each naming the head it read and asserting GitHub's
signature; it reads a story's state only as core's fold of that directory, where an invalid commit holds the story
as `tamper-<oid>` (reviewer ADR-0011, ADR-0013 as merged in #290). It reads the session's issue from the
orchestrator's record and fences commits on it; calls `releaseOnClaim` once per claim, first in a run; and grades
each new commit after it is made from a hooks-owned bare copy, recording passes in a session-scoped commit-check pass
record core owns. reviewer posts no comment; its App holds `contents: write` only. The SQLite ledger, `unlock` /
`override` prompts and `pre_merge_gate.py` are deleted; nothing migrates.

Two core PRs land before reviewer's code (Principle VI, FR-016): B, core's state module moved from the tagged
comment to the ledger record (events, fold, writes, gates, the App's permission and SECURITY.md §3, the
orchestrator's reading of the new causes); C, the commit-check pass record. The ADR amendments are merged (#259,
#290). #174's session record is on main (`core/src/session-record.ts`). #177 US5 (`protectedPaths`' `{tickOnly,
adrFolders}` argument) is external and gates only US2's protected-path step.

## Technical Context

**Language/Version**: TypeScript (tsc 7.0.2, `noEmit`, `erasableSyntaxOnly`) on Node ≥22.18 type stripping

**Primary Dependencies**: core (`state.ts`, `contracts/{snapshot,ledger,gates,commit-pass,session-record}.ts`,
`tokens.ts`, `gh-config.ts`, `settings.ts`, `git.ts`, `tree.ts`, `identity.ts`, `board.ts`, `protected-paths.ts`,
`session-record.ts`); `zod 4.6.7`, `smol-toml 1.9.1`, `yaml 2.9.1` (core's pins); `diff-match-patch` (npm) for
lineages; GitHub GraphQL (`ref`/`history(path:)`/tree and blob objects, `createCommitOnBranch`) and REST (commit list
by path, collaborator role)

**Storage**: the served repo's `ledger` branch, `issues/<n>/`, through core (R5–R8); session-scoped files under
`~/.local/state/codeworks/reviewer/sessions/<session>/` (bare copy, pass record, running check, memos, claim
markers, `gate.log`); no database, no copy of the state

**Testing**: `node:test` + `node:assert/strict`, `fakeGitHub` recorder with a fake `ledger` (R17), temp git
repositories

**Target Platform**: the agent machine (Linux, managed settings, root ADR-0008); Claude Code hooks

**Project Type**: Claude Code plugin (hooks + workflows + agents) over a shared TS library

**Performance Goals**: a hook run does no slow work (ADR-0003 d1): at most one `readState` per decided step (≤3 on
`StateStale`), one mint per writing run, one commit per write, one `git fetch` into the bare copy; claim/shim checks
run as workflows, not in the hook. A read grows with the story's events (ADR-0011 Consequences)

**Constraints**: hook timeouts (60 s today); fail closed on every unanswered read (P4); the model cannot write the
session folder (`HOME_FOLDERS` deny path); reviewer App `contents: write` only

**Scale/Scope**: ~21 Python modules ported, 2 deleted; 4 workflows and 7 agents kept; one story issue per claim

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Answer | Pass |
|---|---|---|
| I Contract-first | Events, file names, snapshot (with `gates`), reading and pass record are core Zod contracts with generated JSON Schemas (root ADR-0003 d3), each with one owner; reviewer is an adapter that never names a file. No second validator over the state. | ✅ |
| II Ownership | Core changes in `core/` (plus the orchestrator's one adaptation to the changed `StateCause`, and SECURITY.md's table the core test pins); reviewer code in `reviewer/`; the session record is read, not written; `ledger` and its rulesets are setup's. No secrets: `app_id` in `codeworks.toml`, key by `readKey`. | ✅ |
| III Fail loud | Unanswered read, missing `ledger`, unsigned commit, stale head past 3 attempts, unreadable record → could not run; tamper refuses naming its release; no fallback to a local copy or the old comment; nothing migrates (FR-018). | ✅ |
| IV Test-first | Each task starts from a red `node:test`; quickstart scenarios are the spec's acceptance scenarios against the recorder and fake `ledger`. | ✅ |
| V Smallest change | Only the hook path moves (root ADR-0009 d2, R1); retired modules and tests deleted; the state-comment parsing (`snapshotOf`, `STATE_TAG`, `renderState`, `COMMENT_LIMIT`, the deletion-based tamper) deleted, not kept beside the fold; `issueComments` and the timeline, project-item and role reads stay, since the release rule and the orchestrator's `keyed.ts` call them. | ✅ (see Complexity) |
| VI Governing rule apart | ADRs merged first (#259, #290); core's state rules (PR B) and pass record (PR C) land before reviewer's code. | ✅ |
| P1 Code decides | Fence, release, holds, counts, passes and tamper are decided in hook and core code; every refusal names its next step ([contracts/refusals.md](contracts/refusals.md)). | ✅ |
| P2 Approved release | Every hold, `tamper-<oid>` included, is released only by `releaseOnClaim` (Ready move + admin comment, or `/codeworks reset`; a tamper only after a repository admin's clearance), ADR-0011 d2, ADR-0013 d2–d3; `unlock`/`override` removed (FR-008). Tampered state reads as held. | ✅ |
| P3 Pure rules | `lib/rules/*` (fence, claim step, round→events, counts, range) and core's fold and commit classing are pure over read data; hooks and core's GitHub calls do I/O only. | ✅ |
| P4 Could not run | Every unanswered or malformed read, `LedgerMissing`, `StateWriteUnsigned`, exhausted `StateStale`, bare-copy fetch failure → could not run, never a pass; commit not recorded. | ✅ |
| P5 Settled design | Planner-only; complied with anyway: every mechanism cites research.md. | n/a |
| P6 One writer | `ledger` events: reviewer hook as the reviewer App; clearance: a repository admin. Session record: orchestrator. Pass record: reviewer hook. Comments, lanes, pushes, check runs: orchestrator. The model's token writes nothing on GitHub (root ADR-0007); reviewer refuses its tool writes to the session folder and `codeworks.toml` (ADR-0012 d1). | ✅ |
| P7 Facts as data | Events are Zod JSON named by their keys; commit class from signature fields, REST login and role; stale write told by re-reading the ref, never from GitHub's error text. | ✅ |
| P8 Generic | Branch grammar, `ledger` + `issues/<n>/`, `codeworks.toml [shared]`/`[reviewer]`, GitHub objects only. | ✅ |
| P9 Named identities | Event commits by `[shared] reviewer_app_login`; clearances by a login whose role is `admin`; admin comments by writer role; the model's commands never count. | ✅ |

Post-design re-check: unchanged, all pass.

## Mechanisms

- Hook path in TypeScript, Python retired, carrier link to core: R1
- Reader from the session token, writer minted as the reviewer App with `contents: write`, `[reviewer]` settings: R2
- One reading per run, advanced by each write; expected head serialises writers; `StateStale` retry: R3
- Round results, verdicts and hold kinds mapped onto core's value sets; `Round.run`: R4
- Ledger events and file names as core contracts, JSON Schemas generated: R5
- State read as the fold of `issues/<n>/`, commits classed, `tamper-<oid>` derived, `LedgerMissing`: R6
- Add-only writes through `createCommitOnBranch`, signature asserted, events derived from transitions: R7
- Gates section as the newest gates event, written with the holds it places: R8
- Claim/shim counts derived from times in the gates section: R9
- Session issue record read through core: R10
- Commit fence as a pure rule applied in the after-commit check: R11
- Release on claim once per claim, first in the run, marker file: R12
- After-commit check over a hooks-owned bare copy, graded from GitHub's branch head; protected paths via core: R13
- Commit-check pass record in core: R14
- `log` mode downgrades refusals only: R15
- Deleting the ledger, `unlock`/`override`, `pre_merge_gate.py`, the poller inbox and every comment post: R16
- `node:test` against the GitHub recorder, a fake `ledger` and temp repositories: R17

## Project Structure

### Documentation (this feature)

```text
specs/209-rebuild-reviewer-on-core/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── ledger-record.md
│   ├── gates-snapshot.md
│   ├── commit-pass-record.md
│   ├── hooks.md
│   └── refusals.md
└── tasks.md             # /speckit-tasks (stale until regenerated for this plan)
```

### Source Code (repository root)

```text
core/src/
├── contracts/ledger.ts            # PR B: LedgerEvent, eventFile
├── contracts/gates.ts             # PR B
├── contracts/snapshot.ts          # PR B: Round.run, Hold.question kinds, gates
├── state.ts                       # PR B: fold reader, commitEvents, writes take the reading; state-comment parsing deleted, issueComments and the issue reads kept
├── tokens.ts                      # PR B: APP_PERMISSIONS.reviewer = {contents: write}
├── contracts/commit-pass.ts       # PR C
├── commit-pass.ts                 # PR C: read/record/setReviewerOff, atomic session file
└── protected-paths.ts             # #177 US5: {tickOnly, adrFolders}
core/scripts/write-schemas.ts      # PR B: ledger-event.schema.json
core/schemas/                      # PR B: regenerated
core/tests/                        # PR B (fixtures/state/ledger.ts), PR C
SECURITY.md                        # PR B: §3 reviewer row
orchestrator/plugin/lib/start.ts   # PR B: causeOf over the new StateCause
orchestrator/tests/                # PR B: fixtures on the fake ledger

reviewer/plugin/
├── core -> ../../core/src         # carrier link
├── package.json, package-lock.json
├── .claude-plugin/plugin.json     # version bump
├── hooks/hooks.json               # node *.ts entries, flipped at CUT
├── hooks/{pre-tool-use,post-tool-use,user-prompt-submit,subagent,session-start}.ts
├── lib/
│   ├── settings.ts  github.ts  run-state.ts  session.ts  hook-io.ts
│   ├── rules/       fence.ts claim-step.ts rounds.ts counts.ts range.ts launch.ts ...   # pure
│   ├── check/       bare-copy.ts after-commit.ts claim.ts shim.ts lineage.ts
│   └── round/       launch.ts record.ts assess.ts decisions.ts
├── workflows/*.js  agents/*.md    # kept
└── scripts/*.py, config.json      # hook-path modules deleted at CUT; codexstate.py stays
reviewer/package.json, reviewer/tests/*.test.ts   # Python tests of retired modules deleted
codeworks.toml                     # [reviewer] section
```

**Structure Decision**: follow the orchestrator's and planner's carrier layout (`lib/` + `core` link); pure rules
under `lib/rules/` (P3); one hook file per event; `run-state.ts` holds the run's one reading and the `StateStale`
retry (R3).

## Delivery order

| # | PR | Blocks | Live on main after its merge |
|---|---|---|---|
| — | ADR amendments (#259, #290), merged | — | — |
| — | #174 core: session issue record (#216), merged | — | — |
| B | core: ledger record (R5–R8), App permission + SECURITY.md §3, orchestrator's causes | US1, US4 | the orchestrator reads the fold; reviewer's Python hooks unchanged |
| C | core: commit-check pass record (R14) | US2, #174 Story 2 | unchanged |
| — | #177 US5: `protectedPaths` `{tickOnly, adrFolders}` (external) | US2's protected-path step | — |
| S | carrier, hook skeleton, session folder, run-state with `StateStale` retry | all stories | TS unregistered; Python hooks unchanged |
| US1 | settings, round/hold/gates recording through core, no comment path | — | same |
| US2 | bare copy, after-commit check, ancestry base (FR-021), per-branch pass record writes | US3 | same |
| US3 | fence in the after-commit check | — | same |
| US4 | release on claim, tamper release | — | same |
| CUT | `hooks.json` flipped to the TS entries; `ledger.py`, `pre_merge_gate.py`, the hook-path Python modules and their tests deleted; version bumped (R16, FR-018) | — | TS hooks; Python gone |

Order: B → C → S → US1 → US2 → US3 → US4 → CUT. Every merge before CUT leaves `hooks.json` and the Python
modules (`gate.py` imports `ledger.py`) untouched, so one runtime decides each hook run at every point; CUT is
the cutover FR-018 names.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| Whole hook path ported, not only the state calls (V) | Root ADR-0009 d2; `gate.py` dispatches every event and imports every rule module | A TS hook shelling out to Python keeps two runtimes deciding one hook run (R1) |
| Core PR B touches `orchestrator/plugin/lib/start.ts` (II) | The one reader's `StateCause` changes (root ADR-0003 d4); the orchestrator's carrier breaks otherwise | Keeping the old causes beside the new would be a compatibility branch (III) |
