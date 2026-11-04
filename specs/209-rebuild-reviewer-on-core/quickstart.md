# Quickstart: validating #209

## Prerequisites

- Core PRs B (ledger record) and C (commit-check pass record) merged; #177 US5 (`protectedPaths` argument) merged
  before US2's protected-path step.
- Node ≥22.18; `npm ci` in `core/`, then in each carrier's `plugin/` and component folder, as
  `.github/workflows/tests.yml` does.

## Run

```sh
npm --prefix core test
npm --prefix orchestrator test            # PR B moves its StateCause reading
npm --prefix reviewer test                # tsc -p . && node --test, as core's and the orchestrator's
node core/scripts/check-carriers.ts --base origin/main
```

## Scenarios (all against `fakeGitHub` with the fake `ledger` + temp repositories)

| # | spec | setup | expect |
|---|---|---|---|
| 1 | US1-1, SC-001 | session record `#42` claim; branch `42-us1-login`; internal round CLEAN at `H` | one `createCommitOnBranch` by the reviewer client, `expectedHeadOid` = the head read, adding only `issues/42/round.<run>.json`; `readState` newest round INTERNAL/H/CLEAN; `attests` true |
| 2 | US1-2 | round DIRTY/ESCALATE | one commit adding the round and `hold.escalation-42.<since>.json`; reading `held` |
| 3 | US1-3 | an unsigned commit (or one by another author) adds a file under `issues/42/` | fold unchanged; `tamper-<oid>` cause with that file in `remaining`; no commit; refusal names the clearance, Ready move and admin comment |
| 4 | US1-4, SC-002 | hold placed; new session folder | hold still OPEN; no reviewer file holds rounds, holds or gates |
| 5 | US1-5 | gates with WRONG rulings from 2 checks; a third check rules WRONG; then the same tree re-checked in a new session | one commit with `gates.<ref>.json` and `hold.claim-<id>.<since>.json`; the re-check adds no count |
| 6 | US1-6, FR-020 | two writers from one reading (`recordGates` placing `claim-7`, and a round) | the second is refused by the expected head → `StateStale`; it reads and decides again; both events in the fold; a retry whose event is already there commits nothing |
| 7 | US1-7 | fake answers `wasSignedByGitHub: false` | `StateWriteUnsigned` naming the oid; nothing else committed; next read derives `tamper-<oid>` |
| 8 | FR-025 | no `ledger` ref | every read and write refuses as could not run, naming README step 6; nothing created |
| 9 | US3-1..2, SC-003 | commits on `42-us2-logout`, `43-us1-other`, `main` | first proceeds to checks; others refused naming `#42`, `42-us`; none recorded |
| 10 | US3-3..5 | no record / switch off / unreadable record | refuse naming both ways / fence skipped / could not run |
| 11 | US4-1..2, SC-004 | OPEN `claim-7`, Ready move + admin comment after its commit; record = claim; run hook twice | one commit adding `release.claim-7.<since>.json` naming the comment, first run only |
| 12 | US4-3..5 | record = resume / no admin comment / `/codeworks reset` | no commit / hold OPEN / RELEASED with `reset: true` |
| 13 | US4-6, FR-024 | `tamper-<oid>`, Ready + admin comment after it, its file still on `ledger`; then an admin's GitHub-signed deletion of it, claim again | first claim: hold OPEN, refusal names the file; second: one commit adding `release.tamper-<oid>.json` |
| 14 | FR-022 | an admin's deletion of an event file no invalid commit added | that commit is invalid: new `tamper-<oid>`; the deleted event still in the fold |
| 15 | US2-1..2, SC-005 | A pass, B fail, C pass | passes: A, then A,B,C; newest C |
| 16 | US2-3..4 | check could not run / range touches `.github/`, `docs/adr/`, `CLAUDE.md` or the spec folder beyond the story's ticks / range only ticks the story's task block | nothing recorded / nothing recorded / passes |
| 17 | US2-5 | GitHub branch at A; new session; B, C committed earlier unpushed | first range graded from A |
| 18 | log mode | `[reviewer] mode = "log"`, scenario 9 | `would_deny` logged; commit not blocked; range recorded as passed |
| 19 | FR-021 | pass at C; amend C→C'; then reset below GitHub head | C' graded from GitHub head; then refused naming it |
| 20 | FR-014 | claims `#42` then `#43` in one session; passes on `42-us1-login` then `43-us1-other` | each branch keeps its own newest pass |
| 21 | FR-019 | reviewer off; commit | no check runs; nothing recorded |
| 22 | FR-014, FR-021 | GitHub at A; pass B; amend to B′, pass; restore B, pass | newest pass (`head`) B, not B′ |
| 23 | SC-006, FR-023 | every scenario above | the recorder holds no issue or PR comment by the reviewer client; `APP_PERMISSIONS.reviewer` = `{contents: write}` equals SECURITY.md §3 |
| 24 | FR-007 | record = claim; GitHub unanswered; a `Read` call, then the `reviewer off` prompt, then a commit | the read and the switch land with no release attempted; the commit's hook refuses as could not run and retries the release |
| 25 | ledger-record.md Events | frozen `v: 1` event histories | the fold's answer is unchanged across later contract versions |
| 26 | FR-024, R6 | invalid commit dated a year ahead; an admin's GitHub-signed deletion of its file; Ready move + admin comment after the deletion | the tamper is releasable: its floor is the deletion's date |
| 27 | R3 | a write refused because another story's commit moved `ledger`; `issues/42/` untouched | `head` re-pointed, the same events committed, no second fold |
