# Contract: planner's check steps

## `planner/plugin/scripts/adr_check.ts`

```text
adr_check.ts clear        <spec folder> <run folder>
adr_check.ts tasks-due    <spec folder> <run folder>
adr_check.ts tasks-written <run folder> <tasks exit code>
adr_check.ts stories      <issue> <kind> <spec folder> <run folder>
adr_check.ts ask          <spec folder> <run folder> <touches exit code>
adr_check.ts decide       <spec folder> <run folder> <asked digest> <judge exit code>
adr_check.ts report       <spec folder> <run folder>
adr_check.ts stop         rounds <kind> <issue> <spec folder>
```

Run from the project root (the workflow's cwd). stories, ask, decide and report read settings from `codeworks.toml`
at the checkout's HEAD, through `readPlannerSettings`; the others read none. Each `adr` call gets
`ADR_DEADLINE_MS = 1_500_000`, under the steps' 1800 s timeout, so the script reports a slow `adr` before the
engine kills the step; the folders are checked at the same time. Every line of every subcommand goes to stderr,
printed by one function, `adrStop` (`planner/plugin/lib/adr-check.ts`, R8), from the stop table below; the stdout of
tasks-due, ask and report carries their JSON only. A stop's exit: 2 when any line is `COULD_NOT_RUN`, else 1 when
any is `FAIL`. A round step that records a stop (the stop table's Step column; report and rounds excepted) exits 0
once it reaches an answer: on a stop it writes it to `<run>/adr-stop.json` (`AdrStopRecord`) and prints nothing
else, and report exits with it. The round's first stop is the one shown: a step that finds a stop record already
written this round checks nothing and writes no stop. `stop` prints its row and
exits 2. No subcommand formats a line of its own. Every run-folder record a subcommand writes is written to a
temporary file in the run folder, then renamed over the record, so a step killed mid-write leaves the old record or
the new one, never a torn one.

Past clear, a round fails only at its last step. Three rules, one for every step:

- Every step after `adr-clear` but `adr-report` has `continue_on_error: true`, so the round always reaches report.
  Each step `AdrStepDone` names (data-model.md) writes its done record, `<run>/adr-steps/<step>.json`, as its last
  act, after every other file it writes, whatever its answer; the outcome of a model step (touches, the tasks
  command, judge) is recorded by the shell step after it from its exit code. A missing done record means the step
  did not finish.
- `adr-clear` deletes core's `ROUND_FILES` first, done records included, so every record report reads was written
  this round. clear and `adr-settled-design` before it have no `continue_on_error`: a failure halts the run
  there, and the resume runs that step, then the whole round after it.
- report has no `continue_on_error`, reads files only, and decides alone: a new round, a stop shown, or the end of
  the loop. Past clear the run fails only at report or `adr-rounds`; a resume after report failed re-runs report alone, which
  finds the stop it showed and asks for a new round.

So no step but report is ever re-run alone, and no step needs to tell a re-run from a first run. A check stop is a
stop a round recorded and report showed; each resume after one runs a new round of the check loop.

A model step (touches, the tasks command, judge) has answered only when its exit code argument is the literal `0`;
any other value, empty included, is not answered, whatever file the step left.

A step reads another step's output (`steps.<id>.output…`) only when that step runs earlier in every round
(touches, tasks-due, ask, report) or when a record written this round shows it ran (tasks-written reads the tasks
command's exit code only in the `if` on tasks-due's `due`; decide reads the judge's exit code only when the asked
record ask wrote this round says `judge`). A step skipped in a round keeps the output of the round it last ran, and
the engine serves that value (R6); every other decision reads a run-folder file written this round.

### clear

The round's first step after settled-design. Deletes core's `ROUND_FILES` (the stop the last round showed among
them), so no step reads an earlier round's, then writes `<run>/touches-from.json` (`SourceHashes`:
`plan.md` and `spec.md` as they stand, the files the touches step is about to read). Exit 0; any other exit halts
the run at clear.

### tasks-due

Writes `<run>/tasks-sources-next.json` (`SourceHashes` of core's `tasksSourcePaths`) and prints `{"due": <bool>}`:
true when `<spec folder>/tasks.md` is missing, `<run>/tasks-sources.json` is missing, or the two hash sets differ.
When due, it first deletes `<run>/tasks-sources.json`, so only a tasks command that finished restores it
(tasks-written's rename); one that failed, even after writing part of `tasks.md`, leaves the next round due.

### tasks-written

After the tasks command, in the same `if`. A tasks command that did not answer (its exit code not `0`) is
`tasks-unfinished`, recorded as a stop, `tasks-sources-next.json` left unrenamed so the next round is due.
Otherwise renames `<run>/tasks-sources-next.json` to `<run>/tasks-sources.json`. The hashes are those taken before
the command ran, so a source changed while it ran makes the next round due again, and report, finding them
changed, runs that round.

### stories

First writes `<run>/adr-inputs.json` (`SourceHashes` of core's `roundInputPaths`, the folders `[shared] adr_folders`
lists), whatever follows: it is the round's first step after `tasks.md` is written, so the hashes are of the files
every later step of the round reads. Then the checks landing makes of `tasks.md`, through the pure functions `land.ts` calls (`planner/plugin/lib/story-plan.ts`,
R15): the story plan (`storyPlan`, task-block labels) and, when `<kind>` is `new`, the spec issue's sub-issues
(extra, in another repository, or out of story order), read as the planner App (`planner/plugin/lib/github.ts`). A
rescope's sub-issues are its existing stories, which its new `tasks.md` may drop or reorder; reconciling them is
landing a rescope's (#178, planner ADR-0010 d5).

### ask

Its done record carries the `decide` it prints. On a stop, its own or one already recorded this round, it prints
`{"judge": false, "decide": false, "asked": ""}`. Otherwise reads settings before the artifacts: on an empty `[shared] adr_folders` it writes the
asked record with no paths and no folders and prints `{"judge": false, "decide": true, "asked": "<sha256>"}`
without reading the paths (decide then passes). Otherwise: a touches step that did not answer is
`touches-missing`, whatever the file holds; `plan.md` or `spec.md` hashing other than `<run>/touches-from.json`
records is `touches-stale`. Then reads `<run>/touches.json` (the plan's paths, `artifact: plan`) and
`<spec folder>/tasks.md` (its task lines' paths, `artifact: tasks`, each with its story), adds the path of each
departure line in `<run>/review-questions.json` (R13), so its record is matched and the user can rule on it; then
the rulings file through core's `readRulings` and the writer guard (R9 a). Resolves the folders (`adrFolders`),
runs `checkAdrFolder` per folder over every asked path, writes `<run>/adr-asked.json` (`AdrAsked`), prints
`{"judge": <bool>, "decide": true, "asked": "<sha256 of the asked record's bytes>"}` on stdout. `judge` is true
when any folder has a governing record. Folder outcomes are decide's.

### judge (prompt step, `adr-judge.md`)

A judge step that fails or reaches its timeout has not answered: decide records its stop (the stop table's
Unanswered column), whatever verdict file it left.

### decide

Settings first: on an empty `[shared] adr_folders` decide prints the empty-list line and exits 0, reading no path.
Otherwise the writer guard (R9 a–c) on what ask recorded; then the verdict (when the asked record says `judge`;
a judge that did not answer is `verdict-unread`, the verdict file not read; when the asked record says no judge,
decide ignores the judge exit code, which may be an earlier round's); calls `checkAdrFolder(cwd, folder, [path], …)`
once per `(folder, record, path)` of the departure lines in `<run>/review-questions.json` and adds each departure
whose record that call names as governing as a departure the judge named, once per key (R13); a call that could
not run is could not run. Then `ADR_RULING`, validated whole (artifact-grammar.md) against this round's
departures, before any is dropped; a ruling whose key the rulings file already holds (an earlier round of the
same resume wrote it) is satisfied, not refused; each valid new ruling is appended to
`<run>/adr-rulings-written.json` first, then to the rulings file, each append skipping an entry already there.
Then drops every departure whose `(folder, record, path)` a rulings entry names, and decides each folder
(data-model, Folder outcome). The `checkAdrFolder` calls, departure lines' and rulings' alike, run at the same time
under one 1500 s deadline. A pass prints every folder's lines through `adrStop`.

### report

The round's last step (R6), with no `continue_on_error`. It reads files only and writes only the stop
record. In order, the first that holds decides:

1. Stop record with `shown: true` (the resume after a stop): keeps it, prints `{"again": true}`, exit 0; the loop
   runs a new round with that resume's `ADR_RULING`, whose `adr-clear` deletes it.
2. A done record missing: every step `AdrStepDone` names is expected, tasks-written only when tasks-due's record
   says `due` and decide only when ask's says `decide`. Any missing is `step-unfinished`, naming each, shown as
   below.
3. Stop record of a model step that did not answer (`unanswered: true`): shown, whatever else changed.
4. Hashes again every file of core's `roundInputPaths` (the folders `[shared] adr_folders` lists as it now stands)
   and of `tasksSourcePaths`. When the first set differs from `<run>/adr-inputs.json`, or the second from
   `<run>/tasks-sources.json` (`tasks.md` written from older sources, or by a tasks command that did not finish),
   or `adr-inputs.json` does not read: prints `{"again": true}`, exit 0, showing nothing; the new round's
   `adr-clear` deletes the stop record. A file changed after stories hashed it (by a model step writing what it must
   not, by hand, or by decide appending a ruling, which the next round of the same resume finds satisfied), so that
   round's stop is out of date and its pass is no pass.
5. Stop record: shown.
6. No stop record: prints `{"again": false}`, exit 0.

Shown: prints the lines to stderr, writes the record with `shown: true`, and exits with its `exit`, so the run
stops at `adr-report`. A record that does not parse (`stop-unread`) is shown as that line, so the resume after asks
for a new round. A report killed before it printed re-runs on the resume from the same files and decides again.

## Stop table (`ADR_STOPS`, `planner/plugin/lib/adr-check.ts`)

A typed constant, `ADR_STOPS: Record<StopKind, {outcome: CheckOutcome; label; what; next}>`, so a stop kind with no
row does not compile; each outcome is a value of core's `CheckOutcome`, never a string literal. Step is the step
that finds the stop, and the one list of the steps that record one; `adr-report` prints every round step's.
Unanswered names the model step that did not answer: a row with one is a stop record written `unanswered: true`
(every other `false`), and `drive_workflow.py` adds that step's error. One row per stop kind;
`adrStop` renders each line as `<OUTCOME>: <label>: <what>. Next step: <next>.`, the PASS rows with no next step.
A `CouldNotRun` from core already reads `<label>: <what>. Next step: <next>.` and is printed after
`COULD_NOT_RUN: ` as it is, so the label appears once. One line per departure and per broken record; titles in
full.

| Kind | Step | Outcome | Label | What | Next step | Unanswered |
|---|---|---|---|---|---|---|
| `empty` | ask, decide | PASS | `codeworks.toml` | No ADR folder is listed in `[shared] adr_folders` | — | — |
| `governed` | decide | PASS | entry | governing: `<id> <title>`, … | — | — |
| `ungoverned` | decide | PASS | entry | no record governs these paths | — | — |
| `departure-inside` | decide | FAIL | entry | `<id>` on `<path>` (story `<s>`, …): `<why>`; for a departure found at review, `found at review on #<issue>, …: <what>; …`, each issue and each distinct `what` | change `plan.md` (the next round writes `tasks.md` again from it); draft a superseding record into the spec PR (planner ADR-0009 d3); or resume with `adr_ruling` naming `<entry>`, `<id>`, `<path>` and your reason. A departure found at review: the last two only (planner ADR-0009 d8) | — |
| `departure-outside` | decide | FAIL | entry | as above | change `plan.md` (the next round writes `tasks.md` again from it); change record `<id>` in the repo that holds `<entry>`; or resume with `adr_ruling` as above. A departure found at review: the last two only | — |
| `broken` | decide | FAIL | entry | `<file>`: `<rule>`: `<message>` | fix that record (in the spec PR, or in the repo that holds `<entry>`) | — |
| `folder` | ask, decide | COULD_NOT_RUN | entry | core's `CouldNotRun` reason | core's | — |
| `verdict-unread` | decide | COULD_NOT_RUN | `adr-verdict.json` | the judge did not answer (its exit code not `0`), or the file is missing or not an `AdrVerdict` (what) | resume to run the check again | `adr-judge` |
| `verdict-mismatch` | decide | COULD_NOT_RUN | entry | the verdict misses governing `<id>`, names `<id>` not governing, or names `<path>` not asked | resume to run the check again | — |
| `rounds` | rounds | COULD_NOT_RUN | `adr-check` | the check ran 100 rounds in one run | discard the run's changes to `<spec folder>`, then start again: a `new` run, remove `<spec folder>` and run `/planner:issue-spec #<issue> [<dir>]`; a `rescope`, restore `<spec folder>` to the branch's last commit and run `/planner:issue-spec rescope <spec folder> #<issue>` | — |
| `stop-unread` | report | COULD_NOT_RUN | `adr-stop.json` | does not parse | resume to run the check again | — |
| `step-unfinished` | report | COULD_NOT_RUN | `adr-check` | step `<id>`, … did not finish this round (no done record) | fix what the step's error names, then resume | — |
| `tasks-unfinished` | tasks-written | COULD_NOT_RUN | `tasks.md` | the tasks command did not answer (its exit code not `0`) | resume to run the check again | `adr-tasks` |
| `touches-refused` | ask | COULD_NOT_RUN | `touches.json` | `<entry>`: what is wrong | resume to run the check again | — |
| `touches-missing` | ask | COULD_NOT_RUN | `touches.json` | the touches step did not answer (its exit code not `0`), or the file is missing or has no path | resume to run the check again | `adr-touches` |
| `touches-stale` | ask | COULD_NOT_RUN | `touches.json` | `plan.md` or `spec.md` changed after this round listed the plan's paths | resume to run the check again | — |
| `questions-refused` | ask, decide | FAIL | `review-questions.json` | what does not parse | rerun the rescope from `/planner:issue-spec rescope` | — |
| `tasks-refused` | stories, ask | FAIL | `tasks.md:<line>` | `<span>`: what is wrong, a task line above every phase heading, or the story plan or a task-block label `tasks.md` breaks | delete `tasks.md`, then resume: the next round writes it again from the plan; if the line comes back, change `spec.md` or `plan.md` first | — |
| `tasks-empty` | ask | COULD_NOT_RUN | `tasks.md` | no task line names a path | delete `tasks.md`, then resume: the next round writes it again from the plan | — |
| `sub-issues-extra` | stories | FAIL | `#<issue>` | `<n>` sub-issues for `<k>` stories; the extra: `#<m>`, … | remove them from `#<issue>`'s sub-issues, or add their stories to `spec.md`, then resume | — |
| `sub-issues-foreign` | stories | FAIL | `#<issue>` | sub-issue `<owner>/<repo>#<m>` is in another repository | remove it from `#<issue>`'s sub-issues, then resume | — |
| `sub-issues-misplaced` | stories | FAIL | `#<issue>` | sub-issue `<i>` is `#<m>`, but `tasks.md` labels US`<i>` with `#<l>` | order `#<issue>`'s sub-issues so sub-issue `<i>` is US`<i>`'s issue, then resume | — |
| `github` | stories | COULD_NOT_RUN | `GitHub` | the `GitHubUnanswered`, `GitHubRefused` or planner App credential message | resume to run the check again | — |
| `rulings-refused` | ask, decide | FAIL | `adr-rulings.json` | what does not parse | correct `<spec folder>/adr-rulings.json`, then resume | — |
| `ruling-refused` | decide | FAIL | `adr_ruling` | not JSON, not rulings, folder not listed, path not asked, `<id>` not governing `<path>`, or no departure this round on `<entry>` `<id>` `<path>` | resume with a corrected `adr_ruling`, or without one | — |
| `guard-rulings` | ask, decide | COULD_NOT_RUN | `adr-rulings.json` | entry `<folder> <id> <path>` was not written by the check | remove the entry; only a resume with `adr_ruling` adds one | — |
| `guard-paths` | decide | COULD_NOT_RUN | `touches.json` or `tasks.md` | changed after ask: added `<p>`, removed `<p>` | resume to run the check again | — |
| `guard-asked` | decide | COULD_NOT_RUN | `adr-asked.json` | changed after ask | resume to run the check again | — |
| `settings` | stories, ask, decide, report | COULD_NOT_RUN | `codeworks.toml` | the `SettingsError` message | fix `codeworks.toml` at HEAD, then resume | — |
| `git` | stories, ask, decide, report | COULD_NOT_RUN | `git` | the `GitFailed` message | run from a git checkout of the repo, then resume | — |

## `workflow.yml` (version 1.7.0)

The `to-tasks` block goes: the loop's first round writes `tasks.md`, since no `tasks-sources.json` exists yet. No
new input: a ruling reaches the run only as `ADR_RULING` from the resume that carries it.

```yaml
  - id: to-adr-check                 # after to-review-critique, in place of to-tasks
    type: if
    condition: *spec-is-written
    then:
      - id: adr-check                # one round works everything out again; each resume after a stop runs a new one;
                                     # every step after adr-clear but adr-report continues on error
        type: do-while
        max_iterations: 100
        condition: "{{ steps.adr-report.output.data.again }}"
        steps:
          - id: adr-settled-design
            type: shell
            run: |
              set -eu
              python3 "$PLANNER_ROOT/scripts/settled_design.py" "$SPECIFY_FEATURE_DIRECTORY"
          - id: adr-clear            # never an earlier round's files; records the plan the touches step reads
            type: shell
            timeout: 60
            run: node "$PLANNER_ROOT/scripts/adr_check.ts" clear "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}"
          - id: adr-touches          # exit code not 0: its Unanswered stop (stop table)
            type: prompt
            integration: "{{ inputs.integration }}"
            timeout: 1800
            continue_on_error: true
            prompt: "Follow .specify/workflows/issue-spec/adr-touches.md for spec folder {{ inputs.spec_dir }}, run folder .specify/workflows/runs/{{ context.run_id }}."
          - id: adr-tasks-due
            type: shell
            output_format: json
            timeout: 60
            continue_on_error: true
            run: node "$PLANNER_ROOT/scripts/adr_check.ts" tasks-due "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}"
          - id: adr-tasks-writing
            type: if
            condition: "{{ steps.adr-tasks-due.output.data.due }}"
            then:
              - id: adr-tasks        # exit code not 0: its Unanswered stop (stop table)
                command: speckit.tasks
                integration: "{{ inputs.integration }}"
                continue_on_error: true
              - id: adr-tasks-written
                type: shell
                timeout: 60
                continue_on_error: true
                run: node "$PLANNER_ROOT/scripts/adr_check.ts" tasks-written ".specify/workflows/runs/{{ context.run_id }}" "{{ steps.adr-tasks.output.exit_code }}"
          - id: adr-stories
            type: shell
            timeout: 300
            continue_on_error: true
            run: node "$PLANNER_ROOT/scripts/adr_check.ts" stories "$ISSUE" "{{ inputs.kind }}" "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}"
          - id: adr-ask
            type: shell
            output_format: json
            timeout: 1800
            continue_on_error: true
            run: node "$PLANNER_ROOT/scripts/adr_check.ts" ask "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}" "{{ steps.adr-touches.output.exit_code }}"
          - id: adr-judging
            type: if
            condition: "{{ steps.adr-ask.output.data.judge }}"
            then:
              - id: adr-judge        # exit code not 0: its Unanswered stop (stop table)
                type: prompt
                integration: "{{ inputs.integration }}"
                timeout: 1800
                continue_on_error: true
                prompt: "Follow .specify/workflows/issue-spec/adr-judge.md for spec folder {{ inputs.spec_dir }}, run folder .specify/workflows/runs/{{ context.run_id }}."
          - id: adr-deciding
            type: if
            condition: "{{ steps.adr-ask.output.data.decide }}"
            then:
              - id: adr-decide
                type: shell
                timeout: 1800
                continue_on_error: true
                run: node "$PLANNER_ROOT/scripts/adr_check.ts" decide "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}" "{{ steps.adr-ask.output.data.asked }}" "{{ steps.adr-judge.output.exit_code }}"
          - id: adr-report           # no continue_on_error: the round's one stop point
            type: shell
            output_format: json
            timeout: 60
            run: node "$PLANNER_ROOT/scripts/adr_check.ts" report "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}"
      - id: adr-out-of-rounds        # the loop ended at max_iterations still wanting another
        type: if
        condition: "{{ steps.adr-report.output.data.again }}"
        then:
          - id: adr-rounds
            type: shell
            timeout: 60
            run: node "$PLANNER_ROOT/scripts/adr_check.ts" stop rounds "{{ inputs.kind }}" "$ISSUE" "$SPECIFY_FEATURE_DIRECTORY"
```

## `adr-touches.md` (installed with the workflow)

Read `<spec folder>/plan.md`; write `<run>/touches.json` per `TouchedPaths` (artifact-grammar.md), one literal
path per file the plan creates, changes or deletes, no glob, no brace group; write no other file; change no
artifact.

## `adr-judge.md` (installed with the workflow)

Read `<run>/adr-asked.json`, `plan.md` and `tasks.md` (`touches.json` only lists the plan's paths), the spec
folder's `adr-rulings.json` and each governing record's file in its folder; judge each record as
`agents/decision-reviewer.md` defines a departure, naming no departure an entry of the rulings file already rules
on; write `<run>/adr-verdict.json` per `AdrVerdict`, `folder` the entry as the asked record gives it; write no
other file; give no ruling.

## `planner/plugin/scripts/land.ts`

`read` calls the same `story-plan.ts` functions as `stories` (R15). Its stops never send the admin to edit
`tasks.md`: extra sub-issues, "remove them from #p's sub-issues"; a sub-issue out of story order, "order #p's
sub-issues so sub-issue k is US<k>'s issue"; a `tasks.md` it refuses, "tasks.md is not as the run wrote it; remove
`<spec folder>`, then run `/planner:issue-spec #p [<dir>]` again" (nothing has landed, so there is no spec PR a
rescope could run on). A `tasks.md` edited after the run is seen only in spec-PR review
(planner ADR-0009 d4).

## `planner/plugin/scripts/rescope_questions.ts`

```text
rescope_questions.ts <issue> <out file>
```

`<issue>` is the spec's issue. Lists its open sub-issues as the planner App (`planner/plugin/lib/github.ts`), or
takes the issue itself when it has none; reads each one's state through core's `readState`; takes every review
question (artifact-grammar.md): the question of every open `escalation-<issue>` hold and every open
`rescope-<issue>` hold with no spec PR, checks each one's
departure lines through `readAdrDepartures`, and writes `<out file>` as `ReviewQuestions`, exit 0. No such
question: writes nothing, exit 0. A departure line that does not read: exit 1 naming the issue and the line.
GitHub unanswered or a settings error: exit 2 naming it. Not a check step: it runs before the run, from the skill.

## `drive_workflow.py`

- `resume <run> adr_ruling=@<file>` reads the file and exports its content as `ADR_RULING` to that invocation's
  `specify resume` only, so every round that call runs sees it; it is not passed as a workflow input and not
  written to `inputs.json`, so no later resume sees it. A value without `@`, or a file it cannot read, exits
  non-zero before resuming. The ruling's text never reaches a command line (SKILL.md §1). Once the call returns,
  each ruling whose key `<spec folder>/adr-rulings.json` does not hold, unless the call's stderr holds a
  `ruling-refused` line (the ruling was refused whole), is named in the report's `ruling_unapplied`: on a stop,
  `ruling not applied: <folder> <record> <path>. Next step: resume with it again.`, the rounds of that call having
  stopped before a decide applied it; on `completed`, `ruling not applied: <folder> <record> <path>: the run
  completed with no departure on it.`
- `rescope <spec file> <issue> <spec dir> questions=@<file>` copies the file to
  `<run>/review-questions.json` once the run has started, before it resumes past grill; a file it cannot read
  exits non-zero.
- `report` sets `adr: true` when the failed step is any of `adr-clear`, `adr-report`, `adr-rounds` (every other
  step of the round continues on error, so the run never fails there; `adr-settled-design` reports as the step it
  is), matched by the step's
  own id: in a loop round after the first, specify reports a qualified id, `<loop>:<step>:<n>` (e.g.
  `adr-check:adr-report:1`), whose middle segment is it. `stderr` is the step's own; `drive_workflow.py` runs no
  `stop`. A stop at `adr-report` whose lines hold a stop with an Unanswered step (stop table) or `step-unfinished`
  also gets each named step's own error: `state.json`'s `step_results` entry for that Unanswered step (`adr-judge`
  only when this round's `<run>/adr-asked.json` names a governing record, ask's `judge`), or each step
  `step-unfinished` names, keyed by the bare id, which holds the step's latest round; a skipped
  judge's entry is an earlier round's and is not shown.

## Skill (`SKILL.md`)

- §1 `rescope <spec folder> #<issue>`: before starting the run, `node <plugin>/scripts/rescope_questions.ts
  <issue> <file>` writes the open questions review left under the issue to a scratch file; on a non-zero exit the
  skill shows its line and stops. §2 passes `questions=@<file>` when it wrote one. Step 4 gives grill those
  questions as the open decision, or, when there are none, the admin's words as today.
- §2's report fields gain `adr` and `ruling_unapplied`: show its lines; after a stop, the next resume carries
  that ruling again beside what the stop's lines say. Step 7: a report with `adr: true` may come back in place of the completed one it
  expects; handle it by the stop rule, then resume. `## Stops`: `step: settled-design` covers `adr-settled-design`
  too.
- Stops, one rule for every report with `adr: true`: show every stderr line, then act on each by its outcome.
  FAIL `departure-*`: the user picks change `plan.md`, supersede the record (with `/speckit-adrkit-draft` into
  the spec PR when the line says so, or in the repo that holds the folder), or rule, as the line offers; write the
  user's ruling, reason in their words, to a scratch file with the Write tool and resume with
  `adr_ruling=@<file>`. FAIL `broken`: fix that record, then resume. Any other FAIL: do what its next step says,
  then resume. COULD_NOT_RUN: the user fixes what the line names (verdict, touches and guard lines: nothing), then
  resume. `tasks.md` is never edited by hand.
