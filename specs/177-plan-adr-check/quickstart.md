# Quickstart: validating the ADR check

Prerequisites: node ≥ 22.18, `npm install -g @adrkit/cli@0.20.0`, the `specify` CLI, analitiq-ai/engineering
checked out beside this repo (`../engineering`).

## Core (US2)

```sh
npm --prefix core test
```

Expect green, including `core/tests/adr-folders.test.ts`: a scratch repo with a worktree and a `codeworks.toml`
listing `../org/docs/adr`, `docs/adr`, an absolute folder, a missing one and an unreadable one:

1. `../org/docs/adr` resolves to the same path from the main checkout and the worktree (US2 AS1).
2. `docs/adr` resolves to each checkout's own folder (US2 AS2).
3. Missing and unreadable: `readable: false`, others unchanged (AS3).
4. No key, non-list, empty entry, repeat, or two entries that are one folder: `SettingsError` on `[shared]` (AS4).
5. `adr_folders = []`: accepted, no folder (AS5).

`core/tests/adr.test.ts`: `readAdrAnswer` on adrkit 0.20.0 answers (ok, failed with error, capped, malformed);
`checkAdrFolder` with a stand-in `adr` that is missing, at 0.19.0, exits 3: each `COULD_NOT_RUN`, never an answer.

## Planner (US3, US4)

```sh
node --test planner/tests/adr-check.test.ts
python3 -m unittest discover -s planner/tests -p 'test_drive_workflow.py'
```

`planner/tests/adr-check.test.ts` drives `adr_check.ts ask` then `decide` in a scratch spec folder with a stand-in
`adr`, a `<run>/touches.json` and a verdict file written by the test in the plan step's and the judge's place:

| Scenario | Expect |
|---|---|
| verdict all `WITHIN` | exit 0, each folder `PASS` with its governing ids (US3 AS1) |
| one `DEPARTS` on `core/src/x.ts` from `0004` | exit 1, line names folder, `0004`, path, next steps: change the artifact, draft a superseding record into the spec PR, or rule (AS2) |
| one `DEPARTS` from a record in `../org/docs/adr` (outside the repo) | exit 1, next step names changing the record in the repo that holds `../org/docs/adr`, not drafting into the spec PR (AS2) |
| `adr` answers a governing record with its own error | exit 1, line names the record file, adrkit's rule and message, next step "fix that record" (AS8) |
| one entry missing, `adr` absent, or verdict missing a record | exit 2, other folders still printed (AS3) |
| `ADR_RULING` names the departure | exit 0, `adr-rulings.json` and `<run>/adr-rulings-written.json` gain it (AS5) |
| `ADR_RULING` valid, the verdict names no such departure | exit 0, the entry is still appended |
| `ADR_RULING` with an unlisted folder, or a path not asked | exit 1, naming it |
| `ADR_RULING` names a record governing another asked path but not its own (`adr check` on its path alone omits it) | exit 1, naming it |
| `ADR_RULING` already in `adr-rulings.json` | exit 0, file unchanged |
| `adr-rulings.json` holds the key; rerun or `tasks` check departs from it | exit 0 (AS6) |
| entry in `adr-rulings.json` neither at `HEAD` nor in the run record | exit 2 naming the entry (AS7) |
| asked record or `touches.json` changed between ask and decide | exit 2 naming what changed |
| `tasks.md` task `[US2]` names a governed path | exit 1 naming the story (US4 AS1) |
| `tasks.md` task names `` `codeworks.toml` `` (root file) / `` `adr check` `` (no file) | path checked / not a path |
| `tasks.md` task names `` `new.toml` ``, untracked, listed in `touches.json` | path checked |
| `touches.json` missing or `paths` empty, or `tasks.md` names no path | exit 2 naming `touches.json` / `tasks.md` |
| `touches.json` unparsable, an extra key, an entry not a `PATH`, or an entry twice | exit 1 naming `touches.json` |
| `adr_folders = []` | exit 0, "No ADR folder is listed" |
| `adr_folders = []` and no `touches.json` | exit 0, "No ADR folder is listed"; no path read |

`test_drive_workflow.py`: with stand-in `claude` and `adr`, a run stops at `adr-plan-decide` before
`mark-critiques`; `resume <run> adr_ruling=[…]` passes it, `inputs.json` gains no `adr_ruling` and the
after-tasks check runs without `ADR_RULING`; an ask stop and a judge that fails or times out each report
`adr: true` with lines from `adrStop` (the judge's: could not run, resume to retry); a rescope also runs both
checks.

## End to end (manual)

From a worktree of this repo, `/planner:issue-spec #<issue>` on an issue whose plan touches
`planner/plugin/scripts/settled_design.py` with a design that contradicts planner ADR-0008: the run stops at
`adr-plan-decide` naming `planner/docs/adr`, `0008` and the path. Rename `../engineering` and resume: stops with
`COULD_NOT_RUN` for `../engineering/docs/adr`.

## Reviewer (US5, after #235)

```sh
npm --prefix reviewer test
```

`reviewer/tests/decisions.test.ts`: two listed folders, one outside the repo, one unlisted tracked `docs/adr`: one
`adr check` per listed folder, none for the unlisted; `REVIEWER_ORG_ADR_DIR` set changes nothing; an entry in the
spec folder's `adr-rulings.json` silences its departure (US5 AS4). `git grep REVIEWER_ORG_ADR_DIR -- ':!specs'` finds nothing.

Hold `adr-<issue>` (FR-020):

| Scenario | Expect |
|---|---|
| a listed folder holds a record with its own `adr check` error | hold `adr-<issue>` placed; comment names the record file, adrkit's rule and message, and that planner fixes it; commits and rounds refused (US5 AS5) |
| the story PR changes `specs/<n>-x/spec.md` | hold `adr-<issue>`; comment names the file and that planner fixes it (AS6) |
| the story PR changes a file under a `docs/adr/` folder at any depth (e.g. `planner/docs/adr/0009-….md`) | hold `adr-<issue>` naming it (AS6) |
| the story PR only flips `[ ]` to `[x]` in its own task block of `tasks.md` | no hold (TICK_ONLY) |
| the story PR ticks another story's task, or edits a task line's text | hold `adr-<issue>` naming `tasks.md` (AS6) |
| the story PR changes neither | no `adr` hold |
| the hold open; a Ready move or an admin's `/codeworks reset` | released (reviewer ADR-0013 d2) |
