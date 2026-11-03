# Contract: planner's check steps

## `planner/plugin/scripts/adr_check.ts`

```text
adr_check.ts ask    <plan|tasks> <spec folder> <run folder>
adr_check.ts decide <plan|tasks> <spec folder> <run folder> <asked digest>
adr_check.ts stop   <plan|tasks> judge
adr_check.ts stop   plan touches
```

Run from the project root (the workflow's cwd; `drive_workflow.py` runs `stop` there too). ask and decide read
settings from `codeworks.toml` at the checkout's HEAD, through `readPlannerSettings`; `stop` reads no settings.
Each `adr` call gets `ADR_DEADLINE_MS = 1_500_000`, under the steps' 1800 s timeout, so the script reports a slow
`adr` before the engine kills the step; the folders are checked at the same time. Every line of every subcommand
goes to stderr, printed by one function, `adrStop` (`planner/plugin/lib/adr-check.ts`, R8), from the stop table
below; ask's stdout carries its JSON only. Exit: 2 when any line is `COULD_NOT_RUN`, else 1 when any is `FAIL`,
else 0. No subcommand formats a line of its own.

### ask

Removes `<run>/adr-<a>-verdict.json` first, so a stale verdict is never read. Reads settings before the artifact:
on an empty `[shared] adr_folders` it writes the asked record with no paths and no folders and prints
`{"judge": false, "asked": "<sha256>"}` without reading the paths (decide then passes). Otherwise reads
`<run>/touches.json` (both artifacts: the plan's paths, or the tasks check's root entries) and, for tasks,
`tasks.md`; on a plan check, adds to the paths the path of each departure line in `<run>/review-questions.json`
(R13), so its record is matched and the user can rule on it; then the rulings file through core's `readRulings` and the writer guard (R9 a). Resolves the folders
(`adrFolders`), runs `checkAdrFolder` per folder, writes `<run>/adr-<a>-asked.json` (`AdrAsked`), prints
`{"judge": <bool>, "asked": "<sha256 of the asked record's bytes>"}` on stdout. `judge` is true when any folder
has a governing record. Exit 0 when it wrote the record (folder outcomes are decide's), else as its stop lines give.

### judge (prompt step, `adr-judge.md`)

A judge step that fails or reaches its timeout records `exit_code`, `stderr` and `error` but writes no verdict, so
`drive_workflow.py` reports it through `adr_check.ts stop <a> judge`, which prints the `judge` row below.

### decide

Settings first: on an empty `[shared] adr_folders` decide prints the empty-list line and exits 0, reading no path.
Otherwise the writer guard (R9 a–c) on what ask recorded; then the verdict (when the asked record says `judge`)
and `ADR_RULING`; validates `ADR_RULING` whole (artifact-grammar.md); appends each valid new ruling to the rulings
file and to `<run>/adr-rulings-written.json`; on a plan check, adds each departure line in `<run>/review-questions.json`
whose record governs its path in the asked record as a departure the judge named, once per `(folder, record,
path)` (R13); drops every departure whose `(folder, record, path)` a rulings entry names; decides each folder (data-model, Folder outcome); prints every folder's lines through `adrStop`.

## Stop table (`ADR_STOPS`, `planner/plugin/lib/adr-check.ts`)

A typed constant, `ADR_STOPS: Record<StopKind, {outcome: CheckOutcome; label; what; next}>`, so a stop kind with no
row does not compile; each outcome is a value of core's `CheckOutcome`, never a string literal. One row per stop kind; `adrStop` renders each line as `<OUTCOME>: <label>: <what>. Next step: <next>.`, the
PASS rows with no next step. A `CouldNotRun` from core already reads `<label>: <what>. Next step: <next>.` and is
printed after `COULD_NOT_RUN: ` as it is, so the label appears once. `<artifact>` is `plan.md` for
plan, `tasks.md` for tasks. One line per departure and per broken record; titles in full.

| Kind | Step | Outcome | Label | What | Next step |
|---|---|---|---|---|---|
| `empty` | ask, decide | PASS | `codeworks.toml` | No ADR folder is listed in `[shared] adr_folders` | — |
| `governed` | decide | PASS | entry | governing: `<id> <title>`, … | — |
| `ungoverned` | decide | PASS | entry | no record governs these paths | — |
| `departure-inside` | decide | FAIL | entry | `<id>` on `<path>` (story `<s>`, …): `<why>`; for a departure found at review, `found at review on #<issue>, …: <what>; …`, each issue and each distinct `what` | change `<artifact>`; draft a superseding record into the spec PR (planner ADR-0009 d3); or resume with `adr_ruling` naming `<entry>`, `<id>`, `<path>` and your reason |
| `departure-outside` | decide | FAIL | entry | as above | change `<artifact>`; change record `<id>` in the repo that holds `<entry>`; or resume with `adr_ruling` as above |
| `broken` | decide | FAIL | entry | `<file>`: `<rule>`: `<message>` | fix that record (in the spec PR, or in the repo that holds `<entry>`) |
| `folder` | ask, decide | COULD_NOT_RUN | entry | core's `CouldNotRun` reason | core's |
| `verdict-unread` | decide | COULD_NOT_RUN | `adr-<a>-verdict.json` | missing, or not an `AdrVerdict` (what) | resume to run the judge again |
| `verdict-mismatch` | decide | COULD_NOT_RUN | entry | the verdict misses governing `<id>`, names `<id>` not governing, or names `<path>` not asked | resume to run the judge again |
| `judge` | judge | COULD_NOT_RUN | `adr-<a>-judge` | the judge did not answer | resume to run the judge again |
| `touches` | touches | COULD_NOT_RUN | `adr-plan-touches` | the touches step did not answer | resume to run it again |
| `touches-refused` | ask, decide | FAIL | `touches.json` | `<entry>`: what is wrong | correct `<run>/touches.json`, then resume |
| `touches-missing` | ask | COULD_NOT_RUN | `touches.json` | missing, or no path | resume to run the touches step again |
| `questions-refused` | ask, decide | FAIL | `review-questions.json` | what does not parse | rerun the rescope from `/planner:issue-spec rescope` |
| `tasks-refused` | ask, decide | FAIL | `tasks.md:<line>` | `<span>`: what is wrong, or a task line above every phase heading | change `tasks.md`, then resume |
| `tasks-empty` | ask | COULD_NOT_RUN | `tasks.md` | no task line names a path | name each task's files, one per backtick span, then resume |
| `rulings-refused` | ask, decide | FAIL | `adr-rulings.json` | what does not parse | correct `<spec folder>/adr-rulings.json`, then resume |
| `ruling-refused` | decide | FAIL | `adr_ruling` | not JSON, not rulings, folder not listed, path not asked, or `<id>` not governing `<path>` | resume with a corrected `adr_ruling`, or without one |
| `guard-rulings` | ask, decide | COULD_NOT_RUN | `adr-rulings.json` | entry `<folder> <id> <path>` was not written by the check | remove the entry; only a resume with `adr_ruling` adds one |
| `guard-paths` | decide | COULD_NOT_RUN | `touches.json` or `tasks.md` | changed after ask: added `<p>`, removed `<p>` | resume to run the check again |
| `guard-asked` | decide | COULD_NOT_RUN | `adr-<a>-asked.json` | changed after ask | resume to run the check again |
| `settings` | ask, decide | COULD_NOT_RUN | `codeworks.toml` | the `SettingsError` message | fix `codeworks.toml` at HEAD, then resume |
| `git` | ask, decide | COULD_NOT_RUN | `git` | the `GitFailed` message | run from a git checkout of the repo, then resume |

## `workflow.yml` (version 1.7.0)

No new input: a ruling reaches the run only as `ADR_RULING` from the resume that carries it.

```yaml
  - id: to-adr-plan            # after to-settled-design, before to-mark-critiques
    type: if
    condition: *spec-is-written
    then:
      - id: adr-plan-clear       # a resume re-runs the block: no touches step leaves the last run's paths
        type: shell
        timeout: 60
        run: rm -f ".specify/workflows/runs/{{ context.run_id }}/touches.json"
      - id: adr-plan-touches
        type: prompt
        integration: "{{ inputs.integration }}"
        timeout: 1800
        prompt: "Follow .specify/workflows/issue-spec/adr-touches.md for spec folder {{ inputs.spec_dir }}, run folder .specify/workflows/runs/{{ context.run_id }}."
      - id: adr-plan-ask
        type: shell
        output_format: json
        timeout: 1800
        run: node "$PLANNER_ROOT/scripts/adr_check.ts" ask plan "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}"
      - id: adr-plan-judging
        type: if
        condition: "{{ steps.adr-plan-ask.output.data.judge }}"
        then:
          - id: adr-plan-judge
            type: prompt
            integration: "{{ inputs.integration }}"
            timeout: 1800
            prompt: "Follow .specify/workflows/issue-spec/adr-judge.md for artifact plan, spec folder {{ inputs.spec_dir }}, run folder .specify/workflows/runs/{{ context.run_id }}."
      - id: adr-plan-decide
        type: shell
        timeout: 1800
        run: node "$PLANNER_ROOT/scripts/adr_check.ts" decide plan "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}" "{{ steps.adr-plan-ask.output.data.asked }}"
  # to-adr-tasks: the same with `tasks`, after to-tasks, with no touches step: it reads the plan's touches.json.
```

## `adr-touches.md` (installed with the workflow)

Read `<spec folder>/plan.md`; write `<run>/touches.json` per `TouchedPaths` (artifact-grammar.md), one literal
path per file the plan creates, changes or deletes, no glob, no brace group; write no other file; change no
artifact.

## `adr-judge.md` (installed with the workflow)

Read `<run>/adr-<a>-asked.json`, the artifact (`plan.md` for plan, `tasks.md` for tasks; `touches.json` only lists
the plan's paths), the spec folder's `adr-rulings.json` and each governing record's file in its folder; judge each
record as `agents/decision-reviewer.md` defines a departure, naming no departure an entry of the rulings file
already rules on; write `<run>/adr-<a>-verdict.json` per `AdrVerdict`, `folder` the entry as the asked record
gives it; write no other file; give no ruling.

## `planner/plugin/scripts/rescope_questions.ts`

```text
rescope_questions.ts <issue> <out file>
```

`<issue>` is the spec's issue. Lists its open sub-issues as the planner App (`planner/plugin/lib/github.ts`), or
takes the issue itself when it has none; reads each one's state through core's `readState`; takes the question of
every open `escalation-<issue>` hold and every open `rescope-<issue>` hold with no spec PR, checks each one's
departure lines through `readAdrDepartures`, and writes `<out file>` as `ReviewQuestions`, exit 0. No such
question: writes nothing, exit 0. A departure line that does not read: exit 1 naming the issue and the line.
GitHub unanswered or a settings error: exit 2 naming it. Not a check step: it runs before the run, from the skill.

## `drive_workflow.py`

- `resume <run> adr_ruling=@<file>` reads the file and exports its content as `ADR_RULING` to that invocation's
  `specify resume` only; it is not passed as a workflow input and not written to `inputs.json`, so no later resume
  or check sees it. A value without `@`, or a file it cannot read, exits non-zero before resuming. The ruling's
  text never reaches a command line (SKILL.md §1).
- `rescope <spec file> <issue> <spec dir> questions=@<file>` copies the file to
  `<run>/review-questions.json` once the run has started, before it resumes past grill; a file it cannot read
  exits non-zero.
- `report` sets `adr: true` when the failed step is any of `adr-plan-clear`, `adr-plan-touches`, `adr-plan-ask`, `adr-plan-judge`, `adr-plan-decide`,
  `adr-tasks-ask`, `adr-tasks-judge`, `adr-tasks-decide`. For a judge or touches step, `stderr` is what
  `node <plugin>/scripts/adr_check.ts stop <a> judge` (or `stop plan touches`) prints, run from the project root; if that cannot run or
  exits other than 2, `drive_workflow.py` exits non-zero naming it. For ask and decide, the step's own stderr.

## Skill (`SKILL.md`)

- §1 `rescope <spec folder> #<issue>`: before starting the run, `node <plugin>/scripts/rescope_questions.ts
  <issue> <file>` writes the open questions review left under the issue to a scratch file; on a non-zero exit the
  skill shows its line and stops. §2 passes `questions=@<file>` when it wrote one. Step 4 gives grill those
  questions as the open decision, or, when there are none, the admin's words as today.
- §2's report fields gain `adr`. Steps 5 and 7: a report with `adr: true` may come back in place of the paused
  or completed one they expect; handle it by the stop rule, then resume.
- Stops, one rule for every report with `adr: true`: show every stderr line, then act on each by its outcome.
  FAIL `departure-*`: the user picks change the artifact, supersede the record (with `/speckit-adrkit-draft` into
  the spec PR when the line says so, or in the repo that holds the folder), or rule; write the user's
  ruling, reason in their words, to a scratch file with the Write tool and resume with `adr_ruling=@<file>`. FAIL `broken`: fix that record, then resume. Any other FAIL: do what its next step says,
  then resume. COULD_NOT_RUN: the user fixes what the line names (judge, verdict and guard lines: nothing), then
  resume.
