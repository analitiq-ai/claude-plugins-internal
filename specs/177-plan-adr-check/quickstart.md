# Quickstart: validating the ADR check

Prerequisites: node ≥ 22.18, `npm install -g @adrkit/cli@0.20.0`, the `specify` CLI 1.1.3 (`pip install specify-cli==1.1.3`), analitiq-ai/engineering
checked out beside this repo (`../engineering`).

## Core (US2)

```sh
npm --prefix core test
```

Expect green, including `core/tests/adr-folders.test.ts`: a scratch repo with a worktree and a `codeworks.toml`
listing `../org/docs/adr`, `docs/adr`, an absolute folder, a missing one and an unreadable one:

1. `../org/docs/adr` resolves to the same path from the main checkout and the worktree, `inside: false` (US2 AS1).
2. `docs/adr` resolves to each checkout's own folder, `inside: true` (US2 AS2).
3. Missing, unreadable or a file: `readable: false`, others unchanged (AS3).
4. No key, non-list, empty entry, repeat, or two entries that are one folder: `SettingsError` on `[shared]` (AS4).
5. `adr_folders = []`: accepted, no folder (AS5).
6. Symlinks: a folder reached through a symlink and a checkout given through one resolve to realpaths, `inside`
   unchanged (ported from `test_adrkit.py`).

`core/tests/adr.test.ts`, ported case for case from `reviewer/tests/test_adrkit.py` and `test_decisions.py`:

| Case | Expect |
|---|---|
| `ok: true`, accepted records | `governing` lists them; a draft never governs |
| `ok: false`, an error finding naming a record | `broken` entry `{file, id?, rule, message}`; that record not in `governing` |
| an `affects-unresolvable` or `affects-repo-not-applicable` finding | `notices` entry naming record and matcher |
| any other finding | ignored |
| no boolean `ok`, bad `governing`, `findings` not a list, a finding missing `rule`/`severity`/`message`, an error with no `path`, a NOTICE with no `id`/`field`/`pattern`, `ok: false` with no error | `readAdrAnswer` throws `AdrAnswerUnread` |
| a `marker-scan-capped` or `marker-declarations-capped` finding | `readAdrAnswer` returns `AdrScanCapped`; `checkAdrFolder` `COULD_NOT_RUN` "split the change" |
| `adr` missing or cannot start; `--version` non-zero or `0.19.0` | `COULD_NOT_RUN` ending with `ADR_INSTALL` |
| exit 3; exit 1 with non-JSON stdout | `COULD_NOT_RUN` with adrkit's stderr |
| exit 0 with non-JSON stdout; an unread answer | `COULD_NOT_RUN` ending with `ADR_INSTALL` |
| past `deadlineMs` | `COULD_NOT_RUN` naming the deadline and each step's seconds |
| unreadable folder | `COULD_NOT_RUN`, `adr` not called |
| any `COULD_NOT_RUN` | its reason names the folder once |
| an in-repo folder / an outside one | `--dir` relative to `cwd` / absolute |

## Planner (US3, US4)

```sh
node --test planner/tests/adr-check.test.ts
python3 -m unittest discover -s planner/tests -p 'test_drive_workflow.py'
```

`planner/tests/adr-check.test.ts` drives `adr_check.ts ask`, `decide`, then `report` in a scratch spec folder with a
stand-in `adr`, a `<run>/touches.json` and a verdict file written by the test in the touches step's and the judge's
place. Every line is on stderr, as the stop table gives it. A stop's exit below is the one `report` exits with; ask
and decide exit 0 once they record it in `<run>/adr-<a>-stop.json`:

| Scenario | Expect |
|---|---|
| verdict all `WITHIN` | exit 0, `PASS: <entry>: governing: …` per folder (US3 AS1) |
| no record governs | exit 0, `PASS: <entry>: no record governs these paths`; no judge |
| one `DEPARTS` on `core/src/x.ts` from `0004` (folder inside) | exit 1, `FAIL: docs/adr: 0004 on core/src/x.ts: …`, next step: change `plan.md`, draft a superseding record into the spec PR, or resume with `adr_ruling` (AS2) |
| one `DEPARTS` from a record in `../org/docs/adr` (outside) | exit 1, next step: change record `<id>` in the repo that holds `../org/docs/adr` (AS2) |
| `adr` answers a record with its own error | exit 1, `FAIL` naming the file, rule and message, "fix that record" (AS8) |
| one entry missing, `adr` absent, or verdict missing a record | exit 2, other folders still printed, each label once (AS3) |
| verdict file missing or not an `AdrVerdict` | exit 2, `COULD_NOT_RUN: adr-plan-verdict.json: …` |
| `ADR_RULING` names the departure | exit 0, `adr-rulings.json` and `<run>/adr-rulings-written.json` gain it (AS5) |
| `ADR_RULING` valid, the verdict names no such departure | exit 0, still appended |
| `ADR_RULING` not JSON, or with an unlisted folder, an unasked path, or a record not governing its path, beside a valid one | exit 1, `FAIL: adr_ruling: …`; nothing appended |
| `ADR_RULING` already in `adr-rulings.json` | exit 0, file unchanged |
| `adr-rulings.json` holds the key; rerun or `tasks` check departs from it | exit 0 (AS6) |
| an entry, or an entry's `reason`, neither at `HEAD` nor in the run record | exit 2 naming the entry (AS7) |
| an entry removed by hand | no stop |
| asked record or `touches.json` changed between ask and decide | exit 2 naming what changed |
| `tasks.md` task `[US2]` and a `## Phase 4: …` task name one governed path | exit 1 naming `story US2, Phase 4: …` (US4 AS1) |
| `tasks.md` task names `` `codeworks.toml` `` (root file) / `` `adr check` `` / a URL | path checked / not a path / not a path |
| `tasks.md` task names `` `new.toml` ``, untracked, listed in `touches.json` | path checked |
| `tasks.md` task names `` `a/{b,c}.ts` `` or `` `a/*.ts` `` | exit 1, `FAIL: tasks.md:<line>: …` |
| a task line above every `## ` heading | exit 1 naming `tasks.md:<line>` |
| `touches.json` missing or `paths` empty (plan or tasks), or `tasks.md` names no path | exit 2 naming `touches.json` / `tasks.md` |
| `touches.json` unparsable, an extra key, an entry not a `PATH`, or an entry twice | exit 1 naming `touches.json` |
| `adr_folders = []`, with or without `touches.json` | exit 0, `PASS: codeworks.toml: No ADR folder is listed …`; no path read |
| `<run>/review-questions.json` has a departure line `docs/adr 0004 <path>` on a path `touches.json` lacks | ask's asked record holds the path |
| the same path, decide's own `adr check` of it naming `0004` governing, the verdict all `WITHIN` | exit 1, `FAIL: docs/adr: 0004 on <path>: found at review on #<issue>: …` (US6 AS3) |
| the same line in two stories' questions | exit 1, one `FAIL` line naming both issues (US6 AS3) |
| the same, and `adr-rulings.json` names it | exit 0 (US6 AS5) |
| the same, `0004` superseded and no longer governing | exit 0, no line for it |
| `<run>/review-questions.json` not `ReviewQuestions`, or with a departure line that does not read | exit 1, `FAIL: review-questions.json: …` |
| ask | stdout is `{"judge", "decide", "asked"}` only; `decide` true when it recorded no stop |
| ask records a stop (e.g. `touches.json` missing) | exit 0, stdout `{"judge": false, "decide": false, "asked": ""}`, the stop record written |
| ask with a stop record left from the last iteration | removes it first |
| `report`, stop record `shown: false` | its lines on stderr, exit its `exit`, record rewritten `shown: true` |
| `report`, stop record `shown: true` | record deleted, stdout `{"again": true}`, exit 0 |
| `report`, no stop record | stdout `{"again": false}`, exit 0 |
| `stop plan rounds` | exit 2, `COULD_NOT_RUN: adr-plan-check: the check stopped 100 times in one run. …` |

`test_drive_workflow.py`, with stand-in `claude` (writing a plan that passes `settled_design.py`; as the touches
step, a `touches.json` from it), a stand-in judge writing the verdict, stand-in `adr`, and a committed `codeworks.toml` with
`[planner] app_id` and `adr_folders`: a run stops at `adr-plan-report` before `mark-critiques`; `resume <run>
adr_ruling=@<file>` exports the file's content as `ADR_RULING` to that call only, `inputs.json` gains no
`adr_ruling`, the after-tasks check runs without it; `adr_ruling=<json>` with no `@` exits non-zero; each resume
after a stop runs a new iteration of the check loop, so a plan changed before a resume makes the touches step
rewrite `touches.json` from it; a touches step that fails or times out leaves no `touches.json` from the last
iteration and the run stops at `adr-plan-report` with `adr: true` and the `touches-missing` line;
a decide that crashes fails the run at `adr-plan-decide` and the resume runs decide again, not clear, touches or
ask; a stop in an iteration after the first, reported under a qualified id (`adr-plan-check:adr-plan-report:1`),
reports `adr: true`; a check that stops 100 times fails the run at `adr-plan-rounds` with `adr: true`; `rescope … questions=@<file>` lands the file as `<run>/review-questions.json`;
an ask stop and
a decide stop each stop the run at `adr-plan-report` and report `adr: true` with their lines; a judge that fails or times out stops the run at `adr-plan-report` with `adr: true` and the
`verdict-unread` line, and the resume runs the whole check again; a rescope runs both checks.

## End to end (manual)

From a worktree of this repo, `/planner:issue-spec #<issue>` on an issue whose plan touches
`planner/plugin/scripts/settled_design.py` with a design that contradicts planner ADR-0008: the run stops at
`adr-plan-report` naming `planner/docs/adr`, `0008` and the path. Rename `../engineering` and resume: stops with
`COULD_NOT_RUN` for `../engineering/docs/adr`.

## Protected paths (US5, core)

`core/tests/tasks.test.ts` `isTickOnly`, `core/tests/protected-paths.test.ts` with `adrFolders: ["notes/decisions"]`:

| Changed | Expect |
|---|---|
| `specs/177-x/tasks.md` only flips `[ ]` to `[x]` in the story's block, passed as `tickOnly` | nothing |
| the same file ticks another story's task, unticks, uses `[X]`, edits a task's text or a label, adds a line | `isTickOnly` false; `specs/177-x` |
| `specs/177-x/spec.md` | `specs/177-x` |
| `Specs/177-x/plan.md` | `Specs/177-x` |
| `src/specs/a.ts` | nothing |
| `planner/docs/adr/0009-….md` | `planner/docs/adr`, as today, listed or not |
| `notes/decisions/0001-x.md` / `Notes/Decisions/0001-x.md` | `notes/decisions` / `Notes/Decisions` |
| `src/notes/decisions/a.md` | nothing |

## Reviewer (US5, after #235)

```sh
npm --prefix reviewer test
```

`reviewer/tests/decisions.test.ts`: two listed folders, one outside the repo, one unlisted tracked `docs/adr`: one
`adr check` per listed folder, none for the unlisted; `REVIEWER_ORG_ADR_DIR` set changes nothing; notices still
reported; a departure finding matching a rulings entry's folder, record and path is dropped (US5 AS4); an
unparsable rulings file is could not run naming it; a changed record with its own error is FAIL, next step revert
the change (AS5). `git grep REVIEWER_ORG_ADR_DIR -- ':!specs'` finds nothing.

## A departure found at review (US6)

| Test | Case | Expect |
|---|---|---|
| `core/tests/decision-check.test.ts` | `readAdrDepartures(renderAdrDeparture(d))` / a question with a deadlock and two departure lines / a question with none | `[d]` / both departures / `[]` |
| `core/tests/decision-check.test.ts` | a line opening `ADR departure: ` with a field missing, no ` — `, an empty `what` or a non-`PATH` path / `renderAdrDeparture` of a folder with a space or a `what` spanning lines | `DepartureRefused` naming it |
| `core/tests/attest.test.ts` | the story's spec folder's `adr-rulings.json` differs between the default branch and the round's commit / another spec folder's does | the path is in `governingDiff`, the round lapses (US6 AS5) / it is not |
| `reviewer/tests/assess.test.ts` (after #235) | a decision-check departure ruled PUSH_BACK or DEFER / FIX / ESCALATE | refused as inadmissible / accepted / accepted (US6 AS1) |
| `reviewer/tests/round-record.test.ts` (after #235) | a round with two departures ruled ESCALATE | `escalation-<issue>` open, `readAdrDepartures` of its question gives both (US6 AS2) |
| `planner/tests/rescope-questions.test.ts` | a parent's two sub-issues with an open escalation hold and an open verdict rescope hold / an issue with no sub-issues / a rescope hold with a spec PR | file with both questions / the issue read itself / not taken |
| `planner/tests/rescope-questions.test.ts` | no open review question / an unreadable departure line | nothing written, exit 0 (US6 AS4) / exit 1 naming the issue and the line |
