# Research: planner checks the plan against the ADR folders it is given

Each decision below settles one mechanism `plan.md` lists under `## Mechanisms`.

## R1: The `[shared]` key that lists the ADR folders

- **Decision**: `adr_folders`, a required array of non-empty strings in `[shared]`, possibly empty; core's `Shared`
  schema refuses a missing key, a non-array, an empty string and an entry written twice (as `validators` refuses a
  repeat today). This repo lists `docs/adr`, `planner/docs/adr`, `reviewer/docs/adr`, `builder/docs/adr`,
  `orchestrator/docs/adr`, `auditor/docs/adr` (every tracked `docs/adr` today) and `../engineering/docs/adr`. Every test fixture that
  writes a `[shared]` section gains `adr_folders = []`: `core/tests/fixtures/state/issue.ts`,
  `planner/tests/support/checkout.ts`, `planner/tests/token.test.ts`, `orchestrator/tests/support/story.ts`,
  `orchestrator/tests/support/checkout.ts`, and every typed `Shared` literal `tsc -p core` checks:
  `core/tests/could-not-run.test.ts`, `core/tests/threads.test.ts`, `core/tests/required-checks.test.ts`,
  `core/tests/contract.test.ts`, `core/tests/state-read.test.ts`.
- **Rationale**: root ADR-0002 d2: planner and reviewer both read it, so it is `[shared]`; d3: no environment
  variable. Required (Clarifications) so a repo that forgot it is refused, not checked against nothing.
- **Existing tools**: `Shared` in `core/src/settings.ts` (extended, not replaced); `REVIEWER_ORG_ADR_DIR`
  (`reviewer/plugin/scripts/adrkit.py`) rejected by root ADR-0002 d3; reviewer's `worktree.decision_folders`
  (finds tracked `docs/adr`) rejected by Clarifications: only listed folders are checked.

## R2: Resolving an entry to a folder

- **Decision**: `adrFolders(checkout, shared)` in new `core/src/adr-folders.ts`. Absolute entry: as written.
  Relative entry: joined to the main checkout, the parent of `git rev-parse --path-format=absolute
  --git-common-dir`, and normalised; if that path lies inside the main checkout, it is re-rooted at the same repo
  path under `git rev-parse --show-toplevel` of `checkout`. Each result: `{entry, path, inside, readable}`: `path` the
  realpath when the folder exists, else the normalised path; `inside` when `path` lies under the realpath of
  `checkout`'s toplevel, both compared as realpaths; `readable` a directory with read and search access. Two entries
  that are one folder: `SettingsError` on `SHARED_SECTION` naming both. The `inside` folders are protected paths
  (R12). Git is called through core's `runGit`. No env var, no network.
- **Rationale**: `../engineering/docs/adr` must be the same folder from every worktree (issue). An in-repo folder
  read from the main checkout would be main's working tree, not the branch's: a superseding record drafted into the
  spec PR (ADR-0009 d3, US3 AS2's next step) would never be seen. Realpaths on both sides: on macOS `/tmp` is
  `/private/tmp`, and git answers the latter; `adrkit.py`'s corpora compare realpaths for the same reason.
- **Existing tools**: `runGit` (`core/src/git.ts`) used; `gitTree` (`core/src/tree.ts`) reads committed files, not
  folders on disk, so does not fit; reviewer's `corpora()` (`adrkit.py`) realpath-dedups and is the model for the
  duplicate and symlink rules, but is Python and reads the env var. Its tests are ported to T006 (R3).

## R3: Running `adr check` and reading its answer

- **Decision**: new `core/src/adr.ts` (contracts/core.md): `ADR_VERSION = "0.20.0"`, `ADR_INSTALL`,
  `checkAdrFolder(cwd, folder, paths, deadlineMs)` and the pure `readAdrAnswer(raw)`, a port of `adrkit.py`'s
  `check`/`parse`/`_finding`/`_failed`/`_unread` and `decisions.py`'s `judge`, held to parity by test: T006 and T007
  port `reviewer/tests/test_adrkit.py` and the answer-reading cases of `reviewer/tests/test_decisions.py` case for
  case, so every branch the Python takes is a red test first.
  - `readAdrAnswer` reads `raw.ok` itself; the exit status is consumed before, by `checkAdrFolder`.
  - `governing` leaves out a record `broken` names (`decisions.py`'s `unbriefed`): a broken record is not judged.
  - NOTICE findings become `notices`: reviewer reports them today (`reviewer/plugin/README.md`); planner ignores them.
  - A capped finding returns `AdrScanCapped`: the answer was read, so it is not `AdrAnswerUnread`, and its next step
    differs. `checkAdrFolder`, which has the folder's label, makes it could not run, "split the change".
  - `checkAdrFolder` makes an unreadable folder could not run itself, so no caller writes that reason.
  - `deadlineMs` is required, a subprocess timeout as `adrkit.py` sets: planner passes 1 500 000 (under the steps'
    1800 s timeout, so the script, not the engine, reports it), reviewer its own.
  - `adr check --dir <folder> --json -- <paths>` runs from `cwd`, the realpath toplevel, the folder relative when
    `inside` (adrkit 0.20.0 misses changed records otherwise).
  - The real 0.20.0 answer: `{changedFiles, governedBy, governing, activeProposals, history, changedRecords,
    findings, markerScan, ok}`; `governing` holds accepted records only; `ok` is false only on a changed record's
    error; capped rules come as `warn` findings.
- **Rationale**: FR-013: the version once, in core. Reviewer's US5 calls the same reader, so `adr`'s answer
  grammar has one home (Principle I), and a port proved by the old tests drops no behaviour.
- **Existing tools**: `reviewer/plugin/scripts/adrkit.py`, `decisions.py` and their tests (Python; no Python calls
  core, root ADR-0009; #235 deletes them); `couldNotRun` (`core/src/outcomes.ts`), whose `source` names the folder
  once; `.specify/extensions/adrkit/scripts/check.sh` (one `ADRKIT_DIR`, prose report) does not fit; `@adrkit/cli`
  exposes no library API reviewer pins, so the CLI is the interface.

## R4: The paths `plan.md` names

- **Decision** (2026-11-04; supersedes a `## Touches` section in `plan.md`, then the plan step writing the file):
  a headless prompt step, `adr-touches`, in every round of the check loop (R6), reads `plan.md` as it then stands
  and writes `<run folder>/touches.json`, `{"v": 1, "paths": ["<PATH>", …]}`, one literal path per file the plan
  creates, changes or deletes, no entry twice (artifact-grammar.md), following
  `planner/plugin/speckit/workflows/issue-spec/adr-touches.md`. The round's `adr-clear` (shell) deletes the last
  file first and records the hashes of `plan.md` and `spec.md` in `<run>/touches-from.json`; ask hashes them again
  and stops as `touches-stale` on any difference, so the paths it checks are those of the plan it judges. A touches
  step whose exit code is not `0` has not answered, and ask stops on it whatever file it left (R6). Read by
  `readTouchedPaths` in `core/src/contracts/decision-check.ts`. Unparsable or wrong shape is `touches-refused`; a
  missing file or an empty list is `touches-missing`, both could not run. The run folder is gitignored
  (`.specify/.gitignore`: `workflows/runs/`). `plan.md`, its template, the `plan` step and `speckit.plan.md` are not
  changed.
- **Rationale**: P7: paths read from a file with a grammar, not from the Project Structure tree. The paths are the
  check's input only, so they stay out of `plan.md`, which builders and reviewers read. Written inside the check
  loop, not by the plan step, because a resume after a stop runs a new round, not the plan step: paths the plan step
  wrote would still be the old plan's after a fix (planner ADR-0009 d7, Option I). A model step cannot be made to
  read a file at a given moment, so the shell step before it records what it read.
- **Existing tools**: the template's Project Structure tree (ASCII art, no grammar); `## Mechanisms` (names
  mechanisms, not paths); a `## Touches` section in `plan.md` (rejected 2026-11-03: puts check input in an artifact
  downstream actors read); the plan step writing the file (rejected 2026-11-03, above); Spec Kit's `prompt` step
  (the judge's pattern, reused).

## R5: The paths `tasks.md` names

- **Decision** (2026-11-03; supersedes one expanded `{a,b}` group): one path grammar for both artifacts, a
  literal repo-relative path, one pure function `artifactPath` in `core/src/contracts/decision-check.ts`
  (artifact-grammar.md). A task line is Spec Kit's `- [ ] T<n> …`; its paths are its backticked spans
  `artifactPath` returns: a span with a `/` always, one with no `/` only when it is in `rootFiles`: the
  `git ls-files` entries with no `/` together with the `touches.json` entries with no `/`, both read by the ask step
  and passed in, so the reader stays pure. A path-shaped span with a glob or brace character is refused, naming
  `tasks.md:<line>`: it names files the check cannot list. A command, URL or placeholder is not a path. The
  settled-design preset's tasks command tells the model to write one literal path per span. A task's story is its
  `[US<k>]` tag, else its phase heading's text without `## `; a task line above every heading is refused.
  `readTaskPaths` sits in `core/src/contracts/tasks.ts` beside the task-block label and calls `artifactPath`.
- **Rationale**: FR-012: one grammar, so a task naming `codeworks.toml` (governed by root ADR-0002) is checked as
  the plan's `touches.json` would check it. A brace grammar needs rules for nesting, spanning segments, empty
  alternatives and duplicates after expansion; a literal path needs none, and `touches.json`, being JSON, never
  needed one. Without the root rule every backticked word would be a path.
- **Existing tools**: `readTaskBlockLabels` and `isPhaseHeading` in `core/src/contracts/tasks.ts` (extended beside
  them); no glob or brace library is in any lockfile, and none is needed once paths are literal.

## R6: Where the check runs in the workflow

- **Decision** (2026-11-04; supersedes a check after plan and a second after tasks, Option K): one top-level `if`
  on `*spec-is-written` in `workflow.yml`, `to-adr-check`, after `to-review-critique`, in place of `to-tasks`. It
  holds a `do-while` loop, `adr-check` (`max_iterations: 100`, condition `steps.adr-report.output.data.again`), one
  round per resume after a stop, then `adr-out-of-rounds`. A round, every part every time (workflow-steps.md):
  `adr-settled-design`; `adr-clear` (shell: deletes `touches.json`, the asked, verdict and stop records, writes
  `touches-from.json`); `adr-touches` (prompt, `timeout: 1800`, `continue_on_error: true`, R4); `adr-tasks-due`
  (shell, `output_format: json`) and an `if` on its `due` holding `adr-tasks` (`command: speckit.tasks`) and
  `adr-tasks-written` (R15); `adr-stories` (shell, R15); `adr-ask` (shell, `output_format: json`,
  `timeout: 1800`); an `if` on `steps.adr-ask.output.data.judge` holding `adr-judge` (Spec Kit `prompt` step
  following `adr-judge.md`, `timeout: 1800`, `continue_on_error: true`); an `if` on
  `steps.adr-ask.output.data.decide` holding `adr-decide` (shell, `timeout: 1800`: decide calls `adr` once per new
  ruling, concurrently under one 1500 s deadline, past the shell step's 300 s default); `adr-report` (shell,
  `output_format: json`). The judge reads `plan.md` and `tasks.md` together, so one verdict covers both.
  - stories, ask and decide exit 0 once they reach an answer; a stop they write to `<run>/adr-stop.json`
    (data-model.md) and print nothing else, and ask, finding one stories wrote, asks nothing. A touches or judge
    step that fails or times out continues. One rule for both: a model step that did not finish with exit code `0`
    has not answered, whatever file it left, since it may have written a valid partial file first. ask takes
    `steps.adr-touches.output.exit_code` and records `touches-missing`; decide takes
    `steps.adr-judge.output.exit_code` and, when the asked record says `judge`, records `verdict-unread` without
    reading the verdict. Only the literal `0` is answered (on 1.1.3 a non-zero dispatch records its code, a timeout
    `-1`, a missing CLI `1`; an invalid timeout is refused when the workflow loads). Without a judge, decide ignores
    the value, stale from an earlier round or empty. So every check stop, an outcome stories, ask or decide
    recorded and report showed, halts the run at `adr-report`, the one stop point.
  - Round outputs: a step skipped in a round keeps the output of the round it last ran, and a later template reads
    that value (executed on 1.1.3: `steps.<id>.output.data` of a step under a false `if` held the earlier round's).
    So a step reads another step's output only when that step runs earlier in every round, or when a record written
    this round shows it ran (contracts/workflow-steps.md); every other decision reads a run-folder file written this
    round.
  - A step that crashes without an answer (any shell step of the round exiting non-zero, or rounds) is no check
    stop: the run fails at that step and the resume runs that step, then the rest of its round (R14). The rest of
    that round is what the earlier run left: touches, the tasks, ask and the judge are not run again. So report
    trusts a round only when every file it checked is unchanged: stories, the round's first step after `tasks.md` is written, records them first (`adr-inputs.json`,
    `roundInputPaths`), and report, before it shows a stop or ends the loop, hashes them again and the tasks sources
    against `tasks-sources.json`; any difference drops the round's stop and runs a new round at once (executed on
    1.1.3, stand-in). One rule covers a plan edited before a resume that re-runs only decide or report (its old stop
    not shown, its old pass no pass), a model step writing `plan.md`, a hand-deleted ruling, a newly listed folder and
    a tasks source changed while the tasks command ran.
  - report: a stop not yet shown is printed and the run stops at `adr-report` with the stop's exit; the resume runs
    report again, which keeps the shown stop and prints `{"again": true}`, so the loop runs a new round on the
    artifacts as they then stand, with that resume's `ADR_RULING`; the round's `adr-clear` deletes it. Deleting it
    in report would let a report killed between the delete and its print find no stop on the resume and end the
    loop unchecked. No stop: `{"again": false}`, the loop ends. A stop record that does not parse is shown as
    `stop-unread` and rewritten valid, so the resume asks for a new round instead of failing at report again.
    Every run-folder record is written to a temporary file, then renamed.
  - `adr-rounds`, under an `if` on `again` after the loop: a loop that ended at `max_iterations` still wanting
    another stops the run as could not run (`stop rounds`), never walking past the check. Its next step discards the
    run's changes to the spec folder and starts again with the run's own kind: a `new` run cannot start over an
    existing folder (`spec_folder.py`), and a rescope's folder is restored to the branch, not removed.
- **Rationale**: P1 (planner): a workflow step that runs a script decides; FR-006; planner ADR-0009 d1 and d7:
  every round works everything out again, so no part is skipped as unchanged and nothing an earlier round found
  is trusted. One check after the tasks sees what landing lands; the critique gate before it reviews a plan the
  check has not yet seen (planner ADR-0009, trade-offs). Spec Kit ≥ 1.1 re-executes only from the halted step
  (R14), so a round that stops at its last step and asks for another is how a resume gets the whole round. A shell
  step with `output_format: json` parses stdout into `output.data`; an `if` and a `do-while` read a boolean from one
  `{{ }}` expression; shell and prompt steps inherit the resume's environment, so `ADR_RULING` reaches every round
  of that resume and no later one. Moving the tasks command into the round writes `tasks.md` once per change of its sources, not once
  before the loop and again in it.
- **Alternatives considered** (2026-11-04): a check after plan and a second after tasks (Option K, rejected: two
  loops, two sets of files, and a plan fixed at the second check never re-checked by the first); a tasks step
  before the loop and one in it (rejected: `tasks.md` written twice on a run that never stops).
- **Existing tools**: `command: speckit.adrkit.check` (prose answer, one folder) does not fit P7; Spec Kit's
  `prompt` step sends an inline prompt to the integration with the same tools as a command step: used for the
  judge; the critique pattern (`mark-critiques` → command → `find`) is the model for script → model → script.

## R7: The judge's verdict

- **Decision**: the ask step writes `<run>/adr-asked.json` (`AdrAsked`: per folder entry, path, `inside`, and
  could-not-run or governing and broken records; the plan's and the tasks' paths, each with the artifact that named
  it). The judge reads it, `plan.md`, `tasks.md` and the spec folder's rulings file, and writes
  `<run>/adr-verdict.json`: `{v: 1, verdicts: [{folder, record, judgment, paths, why}]}`, `folder` the entry as written, `judgment`
  from core enum `AdrJudgment` (`WITHIN`, `DEPARTS`), `paths` non-empty for `DEPARTS`. Zod schemas in
  `core/src/contracts/decision-check.ts`. A verdict missing or unparsable is could not run for the check; one
  missing a governing record, naming one not governing, or naming a path not asked is could not run for that
  folder. The judge's instructions live in `planner/plugin/speckit/workflows/issue-spec/adr-judge.md`.
- **Rationale**: FR-015, P7, root ADR-0010 d1 (an agent's answer set is an enum in core); P4.
- **Existing tools**: reviewer's `agents/decision-reviewer.md` judges a diff in a review round and answers through
  the Workflow tool's StructuredOutput, which a Spec Kit step cannot use; its definition of a departure is reused
  in `adr-judge.md`. `CheckOutcome` reused for the folder outcome.

## R8: Each folder's outcome and the step's exit

- **Decision**: pure `decideFolder` and `decideCheck` in `planner/plugin/lib/adr-check.ts`. Per folder:
  `COULD_NOT_RUN` (core's `CouldNotRun`, or the verdict mismatching the asked record) else `FAIL` (a broken record,
  or a `DEPARTS` no rulings entry names) else `PASS`. Empty list: passes first, before the artifact's paths are
  read. Every stop of every check step (stories, ask, decide, rounds) is a list of items rendered by one pure
  function, `adrStop`, from one table as data, `ADR_STOPS` (workflow-steps.md): kind → outcome → label → what →
  next step.
  - A line reads `<OUTCOME>: <label>: <what>. Next step: <next>.` That order lets core's `CouldNotRun` reason, which
    already starts with its folder's label (`couldNotRun(source, …)`), be printed after `COULD_NOT_RUN: ` unchanged,
    so the label appears once.
  - One line per departure and per broken record; a PASS line names the governing records, or that none governs;
    titles in full. A tasks departure names every story whose task names its path.
  - Every line on stderr; ask's and report's stdout is their JSON only.
  - A stop's exit: 2 when any line is `COULD_NOT_RUN`, else 1 when any is `FAIL`. stories, ask and decide record it
    with the lines in `<run>/adr-stop.json` and exit 0; `adr-report` prints the lines and exits with it (R6).
  - A judge or touches step that does not answer (exit code not `0`) continues on error, and its stop is the
    `verdict-unread` or `touches-missing` row decide or ask records; `drive_workflow.py` runs no `stop`.
- **Rationale**: FR-008, FR-009, FR-018; P3; P4; exit codes as `settled_design.py` and `spec_facts.ts` (1 refused,
  2 could not run); stderr for lines as `spec_facts.ts`, since `report()` passes on only stderr. Could not run wins
  the exit: a fixed plan would still go unchecked in that folder. The table lives in planner, not core: its next
  steps name planner's resume and `adr_ruling`, which reviewer never offers.
- **Existing tools**: `CheckOutcome` and `couldNotRun` (`core/src/outcomes.ts`) reused; `report()`'s per-step
  `stderr` (`drive_workflow.py`) extended, not duplicated.

## R9: The user's ruling on a departure

- **Decision**: the rulings live in one file, `<spec folder>/adr-rulings.json` (artifact-grammar.md), holding only
  the user's rulings `{folder, record, path, reason}`; it lands in the spec PR. No workflow input: the session writes the
  user's ruling, on their words only, to a scratch file with the Write tool and runs `drive_workflow.py resume
  <run> adr_ruling=@<file>`; `drive_workflow.py` reads the file and exports `ADR_RULING` to that one
  `specify resume` call, never passing it as an input or writing it to `inputs.json`, so the user's words never
  reach a command line (SKILL.md §1, unchanged). A value without `@` exits non-zero.
  - Validation, deterministic, against `adr` and never the judge, all or nothing: the whole `ADR_RULING` is refused
    (exit 1, nothing appended) when it is not JSON or not `AdrRuling[]`, or any ruling's folder is not listed, its
    path is not an asked path, or `checkAdrFolder` run on that folder with that one path does not name its record as
    governing, or its key names no departure this round found (the judge's or one found at review), matched before
    any departure is dropped. One call per new ruling makes the record–path pair exact, since `adr check` answers
    for the whole path set. A call that could not run makes the check could not run, nothing appended. A ruling
    whose key the file already holds is satisfied, not refused or re-checked. Each valid new ruling is appended to
    `<run>/adr-rulings-written.json`, then to the rulings file, each append skipping an entry already there.
    `ADR_RULING` reaches every round of the resume that carries it; a later round finds the applied ruling in the
    rulings file, satisfied. A resume none of whose rounds applies it (they stop before decide, or report fails after
    a pass and the resume re-runs report only) is seen once the call returns: `drive_workflow.py` names every ruling
    the rulings file does not hold and no `ruling-refused` line refused (`ruling_unapplied`), so a ruling is never
    lost unseen. The driver, not a step, checks it, because the ruling's life is the resume, not a round.
  - Honouring: the judge is given the file (`adr-judge.md`), and decide drops every departure whose
    `(folder, record, path)` an entry names, at every check of the spec folder.
  - One writer, decide. Writer guard, one function `changedSince(recorded, now) → {added, removed}` in
    `planner/plugin/lib/adr-check.ts`, used three ways: (a) ask and decide: a rulings-file entry, compared whole
    (reason included, so a hand-edited reason is seen), in neither the file at `HEAD` nor
    `<run>/adr-rulings-written.json` is could not run, naming it; `removed` is no stop there (a ruling deleted by
    hand only makes the check stricter); (b) decide: `touches.json`'s and `tasks.md`'s paths re-read against the
    asked record's,
    compared as `{path, line, story}`, any `added` or `removed` could not run; (c) decide: the asked record's sha256
    against the `asked` digest ask printed, which the workflow passes as an argument. Each names what changed
    (FR-019).
- **Rationale**: FR-016, FR-017, FR-019; ADR-0004's "a way past it that can succeed"; P2: the user releases the
  stop; P6: one writer. A resume after a stop runs a new round, judge included (R6), so a ruling is matched against
  the departures that round found, the judge's and review's alike; a ruling naming none rules on nothing the user
  saw, so it is refused rather than written. A persisted input would reach every later round.
  The headless steps hold Write/Edit, so a file only decide writes, checked against `HEAD` and decide's run record,
  is what keeps a model from adding a ruling; an entry committed by hand is seen in spec-PR review.
- **Existing tools**: gate `verdict_input` (a choice from fixed options; a ruling carries data, so a gate does not
  fit); `drive_workflow.py resume <run> <input>=<value>` (extended to intercept `adr_ruling`); notes in `plan.md` /
  `tasks.md` (rejected: two locations and grammars, and a rescope regenerates `tasks.md`).

## R10: Reviewer reads the same list (US5, after #235)

- **Decision**: `reviewer/plugin/lib/round/decisions.ts` takes folders from `adrFolders` and runs
  `checkAdrFolder(cwd, folder, paths, deadline)` per folder at the same time, with the round's paths as #235 gives
  them and reviewer's own deadline; it drops `decision_folders` discovery and `REVIEWER_ORG_ADR_DIR` (code, README,
  tests); it keeps reporting `notices`. A folder's label is always its entry as written, in departure lines and
  ruling matches alike; "outside the repo" is only wording in a message about a folder with `inside` false, and
  "org" goes.
  - Rulings: it reads the rulings file of the spec folder in the checkout through core's `readRulings` (a ruling
    reaches a story with a merge of the default branch, reviewer ADR-0010 d2) and drops, in code, every departure
    finding whose folder label, record id and file match an entry's `folder`, `record` and `path`. A
    `RulingsRefused` makes the decision check could not run, naming the file.
  - A broken record: adrkit fails only on a record the change itself touches, which is a protected path (R12), so
    the decision check reports it as FAIL naming the file, rule and message, next step "revert the change to that
    record; planner fixes records (root ADR-0011)". No hold.
- **Rationale**: FR-014, FR-017, FR-020; SC-005; reviewer ADR-0022. Filtering in code, not by leaving ruled records
  out of the brief: `adr` names governing records for the whole path set, so a record ruled on one path still
  governs others, and a finding dropped by key is deterministic where a brief is not.
- **Existing tools**: #235's port of `adrkit.py`/`decisions.py` (changed, not duplicated); core's `readRulings`
  (T021) and `checkAdrFolder` (T010).

## R11: Decision records first, and PR order

- **Decision** (2026-11-03): the planning PRs, which precede any code of US2–US6, amend planner ADR-0009 (folders
  listed in `[shared] adr_folders`; on disk, no network; one check after tasks, every round redoing everything, d1;
  `tasks.md` derived, landing's story checks in every round, d4; the judge's `AdrJudgment`; the
  rulings file with decide its only writer; next steps per stop; the plan's paths in `<run folder>/touches.json`,
  written by the check's own touches step, d7; a rescope takes its open decision from review's hold questions, d9), orchestrator
  ADR-0004 d4 (the root `specs/` folder beyond TICK_ONLY and every in-repo listed folder are protected paths),
  reviewer ADR-0002 d4 (a commit check fails on any of them), orchestrator ADR-0002 d5 and root ADR-0010 (no `adr`
  hold kind), reviewer ADR-0017 d2 (a departure admits only FIX or ESCALATE; the first-match verdict rule), reviewer
  ADR-0013 d4–d5 and orchestrator ADR-0010 d1 (a verdict's escalation or rescope hold carries and posts its
  question), orchestrator ADR-0004 d1 (the spec folder's rulings file lapses a round), root ADR-0010 (FindingRuling
  ESCALATE), and add root ADR-0011 (planner alone creates and edits
  spec folders and decision records; a story PR that changes one is never attested) and reviewer ADR-0022 (the
  decision check reads only the listed folders and honours the rulings file), both accepted 2026-11-03. Then US2
  (core + `codeworks.toml` + fixtures), US3 (planner; US4 merged into it 2026-11-04), US5 (core's protected paths, then reviewer after
  #235), US6 (#285, after #278: core's departure line and lapse, reviewer after #235, planner's rescope).
- **Rationale**: Principle VI; FR-001; ADRs and specs are written in planning only, never by an implementation
  story; root ADR-0010 d3 (a set is added with the record that owns it).
- **Existing tools**: `/speckit-adrkit-draft` drafts the records.

## R12: A story PR that changes a spec folder or a record

- **Decision** (2026-11-03; supersedes a reviewer hold of its own): orchestrator ADR-0004 d4's protected paths gain
  the root `specs/` folder beyond TICK_ONLY and every in-repo folder `[shared] adr_folders` lists, as root ADR-0011
  d1 names them; `docs/adr/` folders at any depth are already among them. Core's existing `protectedPaths`
  (`core/src/protected-paths.ts`, #230) gains both rules through one argument `{tickOnly, adrFolders}`: each listed
  in-repo folder, from the repo root, holding a changed file; each root `specs/<name>` holding a changed file other
  than `tickOnly`, the one `tasks.md` its caller found TICK_ONLY through core's new pure
  `isTickOnly(baseText, headText, issue)` (contracts/core.md). The function stays pure: its callers read settings. It is then
  the one definition for orchestrator's refusal to attest (#174), whose card goes to Blocked naming the paths, and
  for reviewer ADR-0010 d1's commit refusal (#209's after-commit check), which both call `protectedPaths`; each
  reads `tasks.md` at the merge base and at the head, and settings through `adrFolders`, and passes both. Only the root `specs/` folder: root
  ADR-0001 d3 keeps one Spec Kit project at the root, and a source folder named `specs` is no spec.
- **Rationale**: one gate per rule: a hold over the same change as ADR-0004 d4 would be a second gate, with its own
  placement, comment, release and re-placement rules. A broken record reviewer could meet is always a changed one,
  so it needs no gate of its own either (R10).
- **Existing tools**: `protectedPaths` (extended; no caller yet); `readTaskBlockLabels` (`isTickOnly` reads blocks
  through it); a hold row of reviewer ADR-0013 (rejected, above).

## R13: A departure found at review reaches planner (US6)

- **Decision** (2026-11-03): one mechanism for every hold a verdict places: a RESCOPE's `rescope-<issue>` and an
  ESCALATE's `escalation-<issue>` each carry, as `question` (text), why the round was raised and what must be
  decided, and the orchestrator posts it (reviewer ADR-0013 d4–d5, orchestrator ADR-0010 d1; the schema, store and
  ruling value are #209's T010a–T010c). The assessor rules a decision-check departure only FIX (the code changes to
  comply; the record is untouched) or ESCALATE (FindingRuling, root ADR-0010), never PUSH_BACK or DEFER (reviewer
  ADR-0017 d2); a finding ruled ESCALATE makes the round ESCALATE. Each departure ruled ESCALATE is one line of the
  question, `ADR departure: <folder> <record> <path> — <what>`, written by core's `renderAdrDeparture` and read by
  `readAdrDepartures`, like a deadlock in every other respect. The admin's comment and a Ready move release the hold
  (reviewer ADR-0013 d2); the next round is briefed with the comment (orchestrator ADR-0004 d1).
  - When the admin wants the record or the plan changed, they run planner's `rescope <spec folder> #<issue>`. It
    runs `rescope_questions.ts`, which takes the open review questions (every open escalation hold's, and a verdict's open rescope hold's) of every open story issue under the
    spec's issue (core `readState` as the planner App) into a scratch file; `drive_workflow.py rescope …
    questions=@<file>` copies it to `<run>/review-questions.json`. Grill gets them as the open decision; with none,
    the admin's words as today. The check's ask adds every departure line's path to the paths it checks, so its
    record is matched and the user can rule (FR-016); decide checks each `(folder, record, path)` with one
    `checkAdrFolder(cwd, folder, [path], …)` call, concurrently with the ruling checks under the same 1500 s
    deadline (the asked record says which records govern a folder, not which path), and adds each departure whose
    record that call names as a departure the judge named, once per key however many stories name it, so it stops through
    the same `departure-*` rows until the user rules (R9) or a superseding record no longer departs.
  - The ruling, keyed on `(folder, record, path)`, lands in `adr-rulings.json` through the rescope's spec PR. Core's
    `governingDiff` compares that file, so its change on the default branch lapses every story's round under the
    spec (orchestrator ADR-0004 d1); each merges the default branch (builder ADR-0004) and a new round reads the
    ruling (R10).
- **Rationale**: planner ADR-0009 d9; reviewer ADR-0017 d2, ADR-0022 d4. Only planner may overrule a record (root
  ADR-0011), and a builder unsupervised at review cannot ask the user, so a departure it cannot fix goes to the
  admin. A departure is one more reason a round was raised, so it rides the question every escalation hold
  already carries; one render/read pair keeps the posted line and the parsed data one grammar.
- **Alternatives considered** (2026-11-03): a separate block grammar for departures (rejected: a second format in
  one question); a JSON question (rejected: the orchestrator posts it to people as it stands); merging one
  departure across stories into one entry (rejected: the ruling is keyed on the record and the file, not the story).
- **Existing tools**: the escalation and rescope holds and their release (reviewer ADR-0013 d2); `readState` (used);
  `governingDiff` (extended); SKILL.md step 4's open decision for grill (fed, not duplicated); the decide step's
  departure rows (reused).

## R14: How a Spec Kit resume continues a run

- **Decision** (2026-11-04): Spec Kit `>=1.1.3,<1.2.0` for the `issue-spec` workflow and the settled-design preset
  (`requires: speckit_version`), CI pinned at `specify-cli==1.1.3`. On 1.1.x a resume replays the result of every
  step already done and re-executes only from the step the run halted at; each resume after a stop runs a new
  round of the check loop (R6). A step that failed is run again, then the rest of its round; a step inside a loop iteration after the first
  is reported with a qualified id, `<loop>:<step>:<n>` (observed `to-check:check-stop:1`), others possibly
  unqualified, so `drive_workflow.py` matches an ADR step by its own id, the qualified id's middle segment. A step
  with `continue_on_error: true` that fails is recorded and the run goes on, which is how touches and judge reach
  report (R6).
- **Rationale**: verified with a stand-in workflow on 1.0.7, 1.1.3 and 1.3.0: 1.0.7 re-runs the top-level step a
  run stopped in with everything nested in it (module `specify_cli.workflows.engine`); 1.1.3 and 1.3.0 keep an
  execution tree and replay steps whose phase is `done` (module `specify_cli.workflows._execution`), so "change
  `plan.md`, then resume" rebuilt `touches.json` on 1.0.7 only, and three tests of the one-block design fail on
  1.1.3. The loop gives the same answer on all three. 1.1.3 is this repo's `.specify/init-options.json` version;
  ADR Kit's extension caps Spec Kit below 1.2.0.
- **Existing tools**: Spec Kit's `do-while` step (`max_iterations`, `condition`), used; the workflow's per-step
  top-level layout, whose comment states the 1.0.x resume and is corrected (T025).

## R15: `tasks.md` in the round, and landing's checks of it

- **Decision** (2026-11-04): `tasks.md` is derived, never edited by hand (planner ADR-0009 d4). Each round's
  `adr-tasks-due` hashes every file the tasks command reads (the spec folder's `spec.md`, `plan.md`, `research.md`,
  `data-model.md`, `quickstart.md`, `contracts/**`, and `.specify/memory/constitution.md`) into
  `<run>/tasks-sources-next.json` and is due when `tasks.md` is missing, `<run>/tasks-sources.json` is missing, or
  the two differ; then the tasks command runs and `adr-tasks-written` renames the first to the second. Hashes taken
  before the command, promoted after it, so a halt mid-command or a source changed while it ran leaves the next
  round due. `adr-stories` then runs the checks `land.ts` makes of `tasks.md` through the same pure functions,
  extracted to `planner/plugin/lib/story-plan.ts`: the story plan (`storyPlan`, `TasksRefused`,
  `TaskBlockLabelRefused`) and, on a `new` run, the spec issue's sub-issues (extra, in another repository, out of
  story order), read as the planner App. A rescope's sub-issues are its existing stories, which its new `tasks.md`
  may drop or reorder; reconciling them belongs to landing a rescope (#178, planner ADR-0010 d5), not to this check.
  `land.ts`'s next steps stop sending the admin to `tasks.md`: extra sub-issues are removed from the issue, an
  out-of-order one reordered, a refused `tasks.md` removed with its spec folder and the run started again (nothing
  has landed, so no spec PR exists for a rescope to run on). Folds in #303.
- **Rationale**: a `tasks.md` landing refuses after the run has completed can only be fixed by hand or by a rescope;
  checked in every round, it stops while the run can still resume, and a stop's next step deletes `tasks.md` so the
  next round writes it again. Hashing the sources keeps a round that changed nothing from writing `tasks.md` again
  and losing nothing a re-run would not also lose. One set of functions for both callers keeps the two checks one
  rule (Principle I). The ADR steps stay offline (FR-010); the sub-issues are GitHub's, read as landing reads them.
- **Alternatives considered**: writing `tasks.md` in every round (rejected: a model step re-run on unchanged input
  for nothing); hand edits to `tasks.md` as a next step (rejected: the next tasks run discards them, and the check
  would grade a file no command wrote); the checks only in `land.ts` (rejected: they stop after the run has
  completed).
- **Existing tools**: `land.ts`'s `read` (`storyPlan`, `TasksRefused`, `TaskBlockLabelRefused`, the sub-issue
  checks), moved, not duplicated; `planner/plugin/lib/github.ts`; core's `sourceHashes` (new, beside
  `decision-check.ts`).
