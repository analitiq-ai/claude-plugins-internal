# Quickstart: validating #209

## Prerequisites

- PRs A, B, C merged; #174's session record merged in core.
- Node ≥22.18; `npm ci` in `core/` and `reviewer/plugin/`.

## Run

```sh
npm --prefix core test
npm --prefix reviewer/plugin test        # tsc -p . && node --test 'tests/**/*.test.ts' (run from reviewer/)
node core/scripts/check-carriers.ts --base origin/main
```

## Scenarios (all against `fakeGitHub` + temp repositories)

| # | spec | setup | expect |
|---|---|---|---|
| 1 | US1-1, SC-001 | session record `#42` claim; branch `42-us1-login`; internal round CLEAN at `H` | one POST on `#42` by the reviewer client; `readState` newest round INTERNAL/H/CLEAN; `attests` true |
| 2 | US1-2 | round DIRTY/ESCALATE | snapshot has round + OPEN `escalation-42`; reading `held` |
| 3 | US1-3 | newest state comment `lastEditedAt` set | no POST; refusal names Ready move + admin comment |
| 4 | US1-4, SC-002 | hold placed; new session dir | hold still OPEN; no reviewer file holds rounds/holds |
| 5 | US1-5 | gates with WRONG rulings from 2 checks; a third check rules WRONG; then the same tree re-checked in a new session | `claim-<id>` OPEN; the re-check adds no count |
| 6 | US1-6 | snapshot near the limit; a check's gates write would leave no room to release every open hold and add a round | refused naming the sizes; nothing posted |
| 7 | US3-1..2, SC-003 | commits on `42-us2-logout`, `43-us1-other`, `main` | first proceeds to checks; others refused naming `#42`, `42-us`; none recorded |
| 8 | US3-3..5 | no record / switch off / unreadable record | refuse naming both ways / fence skipped / could not run |
| 9 | US4-1..2, SC-004 | OPEN `claim-7`, Ready move + admin comment after; record = claim; run hook twice | one release POST, first run only |
| 10 | US4-3..5 | record = resume / no admin comment / `/codeworks reset` | no POST / hold OPEN / RELEASED with `reset: true` |
| 11 | US2-1..2, SC-005 | A pass, B fail, C pass | passes: A, then A,B,C; newest C |
| 12 | US2-3..4 | check could not run / range touches `.github/` | nothing recorded |
| 13 | US2-5 | GitHub branch at A; new session; B, C committed earlier unpushed | first range graded from A |
| 14 | log mode | `[reviewer] mode = "log"`, scenario 7 | `would_deny` logged; still nothing recorded as passed |
| 15 | FR-020 | two hook runs post `placeHold(claim-7)` and a round concurrently | both in the newest snapshot |
| 16 | FR-021 | pass at C; amend C→C'; then reset below GitHub head | C' graded from GitHub head; then refused naming it |
| 17 | FR-014 | passes on `42-us1-login` then `42-us2-logout` in one session | each branch keeps its own newest pass |
| 18 | FR-019 | reviewer off; commit | no check runs; nothing recorded |
| 19 | FR-016 | a round written from a reading older than a gates post | refused as stale; the gates post's count kept |
| 20 | FR-014, FR-021 | GitHub at A; pass B; amend to B′, pass; restore B, pass | newest pass (`head`) B, not B′ |
