# Contract: grammars the check reads

## Path

One grammar for both artifacts, one function in core (`artifactPath`, `core/src/contracts/decision-check.ts`):

`PATH` = `^[A-Za-z0-9._-]+(/[A-Za-z0-9._-]+)*$`, no segment `.` or `..`: one literal repo-relative file path. No
glob, no brace group, no trailing `/`. A path with no `/` is a file at the checkout root.

`artifactPath(span, rootFiles)`:

- Under `"any"` (a `touches.json` entry): the entry if it is a `PATH`, else `PathRefused`.
- Otherwise (a `tasks.md` span): `PathRefused` naming the span when it has a `/`, no space, and a glob or brace
  character (`*`, `?`, `[`, `]`, `{`, `}`) or a `.`/`..` segment: it names paths the check cannot list. The span
  when it is a `PATH` with a `/`, or a `PATH` with no `/` that `rootFiles` holds. Else `null` (not a path: a
  command, a URL, a placeholder such as `<run>/x`, a word).

## `<run folder>/touches.json` (the plan's paths)

```json
{"v": 1, "paths": ["core/src/adr-folders.ts", "codeworks.toml"]}
```

- Deleted by `adr-clear` at the start of each round of the check loop, then written by the touches step,
  `adr-touches` (`adr-touches.md`): it reads `plan.md` as it then stands and writes one literal path per file the
  plan creates, changes or deletes. Each resume after a stop runs a new round, so the file follows every change to
  the plan, and ask never reads an earlier round's file; a touches step whose exit code is not `0` is
  `touches-missing`, whatever file it left. Not a section of `plan.md` (R4).
- `TouchedPaths`: exactly the keys `v` (`1`) and `paths`; each entry a `PATH`; no entry twice.
- Unparsable JSON or another shape: `touches-refused`, naming `touches.json` and the entry. No file, or `paths`
  empty: `touches-missing`.
- Read only by planner's check (`readTouchedPaths`). The run folder is gitignored (`.specify/.gitignore`:
  `workflows/runs/`); builders and reviewers never see it.

## Source hashes (`<run>/touches-from.json`, `<run>/tasks-sources.json`, `<run>/tasks-sources-next.json`, `<run>/adr-inputs.json`)

```json
{"v": 1, "files": {"specs/177-x/plan.md": "<sha256>", "specs/177-x/spec.md": "<sha256>"}}
```

- `SourceHashes`: exactly the keys `v` (`1`) and `files`, a map from a path to the sha256 of its bytes: repo-relative
  for a file under the checkout, absolute for a file of a listed folder outside it; an absent file is left out. Two are equal when they name the same paths with the same hashes. Computed by
  one core function, `sourceHashes(cwd, paths)`.
- `touches-from.json`: written by `adr-clear` from `plan.md` and `spec.md`, before the touches step reads them; ask
  hashes them again, and any difference is `touches-stale`.
- `tasks-sources-next.json`: written by `adr-tasks-due` from every file the tasks command reads (workflow-steps.md);
  renamed to `tasks-sources.json` by `adr-tasks-written` once the tasks command has written `tasks.md`. A round is
  due to write `tasks.md` when it is missing, `tasks-sources.json` is missing, or the two differ.
- `adr-inputs.json`: written by stories first, every round, from core's `roundInputPaths` (every file the round checks).
  report hashes them again, and `tasksSourcePaths` against `tasks-sources.json`, before it shows a stop of a step
  that answered or ends the loop: any difference runs a new round, the stop record left for `adr-clear`. A ruling
  decide appends is such a difference, so the round after it finds the ruling satisfied.

## `<run folder>/adr-stop.json` (a round's stop, until shown and resumed)

```json
{"v": 1, "exit": 1, "lines": ["FAIL: docs/adr: 0004 on core/src/x.ts: …. Next step: …."], "shown": false, "unanswered": false}
```

- `AdrStopRecord`: exactly the keys `v` (`1`), `exit` (`1` or `2`: 2 when any line is `COULD_NOT_RUN`, else 1),
  `lines` (non-empty, each a line `adrStop` rendered), `shown` (boolean) and `unanswered` (boolean: the stop is
  `touches-missing`, `verdict-unread` or `tasks-unfinished`).
- Written with `shown: false` by tasks-written, stories, ask or decide when the round stops, which then exit 0;
  deleted by `adr-clear` at the start of each round, so one that is there was written this round. `adr_check.ts
  report` prints the lines and writes it `shown: true`, then on the resume keeps it and asks for a new round, whose
  `adr-clear` deletes it; one that does not parse is shown as `stop-unread` (workflow-steps.md, report).

## `tasks.md` task lines

Written by the tasks command in a round that is due (Source hashes), never by hand (planner ADR-0009 d4). A task
line starts `- [ ] T<n>` or `- [x] T<n>` (any case of `x`). Its paths are its backticked spans
`artifactPath` returns, one literal path per span: a span with a `/` always; a span with no `/` only when it is in
`rootFiles`, the `git ls-files` entries with no `/` together with `touches.json`'s entries with no `/` (read by the
ask step and passed to the pure reader), so a root file a task creates is a path before git tracks it. A span
`artifactPath` refuses: `tasks-refused`, naming `tasks.md:<line>`. Its story is `US<k>` from a `[US<k>]` tag, else
the text of the `## ` heading above it without `## `. A task line above every `## ` heading: `tasks-refused`, naming
`tasks.md:<line>`. No path on any task line: `tasks-empty`. The settled-design preset's tasks
command tells the model to write one literal path per backtick span.

## Rulings file (`<spec folder>/adr-rulings.json`)

```json
{"v": 1, "rulings": [
  {"folder": "docs/adr", "record": "0004", "path": "core/src/adr.ts", "reason": "…"}
]}
```

- Holds only the user's rulings: each one `AdrRuling`, all four fields non-empty strings, no other key; `folder`
  is the entry as written in `[shared] adr_folders`; `path` a `PATH`. Key: `(folder, record, path)`, no key twice.
- No file: no ruling. A file that does not parse is refused (`RulingsRefused`, exit 1), never read as empty.
- Writer: the decide step only (R9). Readers: the judge, every later ask and decide, reviewer's decision check (US5).
- Writer guard: every entry, compared whole (reason included), must be in the file at `HEAD` or in
  `<run>/adr-rulings-written.json`; any other entry makes the check could not run, naming it (R9). A
  `adr-rulings-written.json` that does not parse is deleted and the guard runs without it, so it names every entry
  the run added.

## `ADR_RULING` (one resume's ruling)

A JSON array of `AdrRuling`. The session writes it, on the user's words only, to a scratch file with the Write tool;
`drive_workflow.py resume <run> adr_ruling=@<file>` reads the file and exports its content as `ADR_RULING` to that
one `specify resume` call, so the user's words never reach a command line (SKILL.md §1). It reaches every round
that call runs, and decide is its only reader. Decide refuses the whole array (`ruling-refused`, nothing
appended) when it is not JSON, not an array of `AdrRuling`, or any ruling's folder is not listed, its path is not
an asked path, `checkAdrFolder(cwd, folder, [path], deadlineMs)`, called once for that ruling, does not name its
record as governing, or its key names no departure this round found (the judge's or one found at review), matched
before any departure is dropped. Decide makes those calls concurrently under one 1500 s deadline, every call given
what is left of it; a call that could not run is exit 2, nothing appended. A ruling whose key the rulings file
already holds is satisfied, not refused, and not re-checked. Each valid new ruling is appended to
`<run>/adr-rulings-written.json` first, then to the rulings file, each append skipping an entry already there, so a
decide that fails between the two leaves no entry the writer guard refuses. A ruling a later round of the same call
finds in the rulings file is satisfied there. A resume whose rounds never apply it (they stop before decide, or a
decide that failed before appending, or report fails after a pass) leaves it out of the rulings file, and `drive_workflow.py`
names it in `ruling_unapplied` (workflow-steps.md). Unset: no ruling.

## Departure line (in a hold's question)

```text
ADR departure: docs/adr 0004 core/src/adr.ts — reads the folder from tracked discovery, which 0004 rejected
```

- A review question is the question of an open `escalation-<issue>` hold, or of an open `rescope-<issue>` hold
  with no spec PR, as text: why the
  round was raised and what must be decided (reviewer ADR-0013 d4–d5). Each departure ruled ESCALATE is one line of
  it, written by core's `renderAdrDeparture` only and read by `readAdrDepartures` only; the orchestrator posts the
  whole question as it stands (orchestrator ADR-0010 d1).
- A line is `ADR departure: ` then `<folder>`, `<record>`, `<path>` separated by one space, then ` — ` (U+2014
  between spaces), then `<what>`: `folder` an entry as written in `[shared] adr_folders` and `record` an id, both
  with no whitespace; `path` a `PATH`; `what` the rest of the line, non-empty.
- A line opening with `ADR departure: ` that breaks this is refused (`DepartureRefused`, naming the line). Every
  other line is not read.

## `<run folder>/review-questions.json` (a rescope's open decisions from review)

```json
{"v": 1, "questions": [
  {"issue": 285, "hold": "escalation-285", "question": "…\nADR departure: docs/adr 0004 core/src/adr.ts — …"}
]}
```

- `ReviewQuestions` (core): every review question of the open story issues under the spec's issue (planner ADR-0009 d9); no `(issue, hold)`
  twice; each question's departure lines read through `readAdrDepartures`.
- Written by `drive_workflow.py rescope … questions=@<file>`, copying the file `rescope_questions.ts` wrote, only on
  a rescope that found a question. Absent: no question carried. Present and not `ReviewQuestions`: refused (exit 1,
  naming it).
- Read by the check's ask step, which adds each departure's path to the paths it checks, and its decide step,
  which checks each `(folder, record, path)` with one `adr` call and stops once per key whose record governs it,
  however many questions name it (R13).
