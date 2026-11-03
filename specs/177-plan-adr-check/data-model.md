# Data model: planner checks the plan against the ADR folders it is given

Every schema below is Zod in core unless named otherwise; value sets live in `core/src/values.ts` (root ADR-0010).
The run-folder and spec-folder files are one schema each in `core/src/contracts/decision-check.ts` (contracts/core.md).

## ADR folder list (`[shared] adr_folders`)

| Field | Type | Rule |
|---|---|---|
| `adr_folders` | `string[]` | required; may be empty; each entry non-empty; no entry written twice (R1) |

Writer: the admin, in `codeworks.toml` (root ADR-0002 d1). Readers: core `adrFolders`, for planner and reviewer.

## Resolved ADR folder (`ResolvedAdrFolder`, `core/src/adr-folders.ts`)

| Field | Type | Meaning |
|---|---|---|
| `entry` | string | as the admin wrote it; the folder's label in every message |
| `path` | string | realpath when the folder exists, else the normalised absolute path (R2) |
| `inside` | boolean | `path` lies under the calling checkout's realpath toplevel |
| `readable` | boolean | a directory with read and search access |

Two entries that are one folder: `SettingsError(SHARED_SECTION, …)` naming both. The `inside` folders are protected
paths (R12).

## adr answer (`AdrAnswer`, `AdrScanCapped`, `core/src/adr.ts`)

`readAdrAnswer` gives `{governing: {recordId, title}[], broken: {file, id?, rule, message}[], notices: {id,
matcher, message}[]}`, `governing` never naming a broken record, or `{capped: {rule, message}[]}`.
`checkAdrFolder` gives `AdrAnswer` or `CouldNotRun` (`core/src/outcomes.ts`), a capped scan among the latter.
Planner reads `governing` and `broken`; reviewer also reports `notices`. Read from `adr check --json` at
`ADR_VERSION` (R3).

## Checked artifact (`CheckedArtifact`, value set)

`plan` (paths from the touches step's `<run>/touches.json`), `tasks` (paths from `tasks.md` task lines). Owner: planner
ADR-0009.

## Touched paths (`TouchedPaths`, `<run>/touches.json`)

`{v: 1, paths: PATH[]}`, no entry twice (artifact-grammar.md). Deleted by `adr-plan-clear`, the after-plan check's
first step; written by the touches step `adr-plan-touches`, its second, from `plan.md` as it then stands
(`adr-touches.md`), rebuilt at every resume. Readers: `adr_check.ts` ask and decide only (plan's paths; tasks' root entries). The run
folder is gitignored; builders and reviewers never see it. Unparsable or wrong shape: refused; missing or empty:
could not run, naming `touches.json`, for both artifacts.

## Artifact path (`ArtifactPath`, `core/src/contracts/decision-check.ts`)

| Field | Type | Meaning |
|---|---|---|
| `path` | string | one literal `PATH` (artifact-grammar.md) |
| `line` | number | line in `tasks.md`; for `touches.json`, the entry's 1-based index in `paths` |
| `story` | string \| null | `tasks` only: `US<k>` from the tag, else the phase heading's text without `## ` |

## Asked record (`AdrAsked`, `<run>/adr-<artifact>-asked.json`)

Writer: `adr_check.ts ask`. Readers: the judge, `adr_check.ts decide`.

| Field | Type |
|---|---|
| `v` | `1` |
| `artifact` | `CheckedArtifact` |
| `paths` | `ArtifactPath[]` |
| `folders` | per listed folder, in list order: `{entry, path, inside, outcome: CouldNotRun}` or `{entry, path, inside, governing, broken}` |

Stdout JSON only: `judge`, true when any folder has a governing record; `asked`, the sha256 of the record's bytes,
which the workflow passes to decide (R9 c). On an empty `adr_folders` the record has no paths and no folders, no
artifact is read, and `judge` is false.

## Verdict (`AdrVerdict`, `<run>/adr-<artifact>-verdict.json`)

Writer: the judge (prompt step). Reader: `adr_check.ts decide`.

| Field | Type | Rule |
|---|---|---|
| `v` | `1` | |
| `artifact` | `CheckedArtifact` | equals the asked one |
| `verdicts[]` | `{folder, record, judgment, paths, why}` | exactly one per governing record per folder |
| `folder` | string | the entry as written, as the asked record gives it |
| `judgment` | `AdrJudgment`: `WITHIN`, `DEPARTS` | owner planner ADR-0009 |
| `paths` | string[] | non-empty for `DEPARTS`, each an asked path; empty for `WITHIN` |
| `why` | string | non-empty |

## Ruling (`AdrRuling`, `AdrRulings`)

`{folder, record, path, reason}`, all non-empty strings, no other key; `folder` the entry as written; `path` a
`PATH`. Key: `(folder, record, path)`.

- Rulings file: `<spec folder>/adr-rulings.json`, `AdrRulings` (`{v: 1, rulings}`, no key twice); only the user's
  rulings. Writer: `adr_check.ts decide`, from `ADR_RULING` only. Readers: the judge, every later ask and decide
  (through core's `readRulings`), reviewer's decision check (US5). An entry honours every departure with its key, in
  either artifact.
- One resume's ruling: `ADR_RULING`, an `AdrRuling[]` as JSON, read by `drive_workflow.py` from the file named in
  `adr_ruling=@<file>` and exported to that invocation only. Writer: the session, with the Write tool, on the user's
  words only. Validated whole (artifact-grammar.md): one refused ruling refuses them all.

## Departure found at review (`AdrDeparture`, `ReviewQuestions`)

`AdrDeparture` `{folder, record, path, what}`; `folder` an entry as written and `record` an id, both with no
whitespace; `path` a `PATH`; `what` one non-empty line. `ReviewQuestions` `{v: 1, questions: {issue, hold,
question}[]}`, no `(issue, hold)` twice.

- A verdict-placed hold's `question` (core `Hold`, a string): why the round was raised and what must be decided,
  each departure ruled ESCALATE one line of it (artifact-grammar.md). Writer: reviewer's round record, the lines
  through core's `renderAdrDeparture`. Readers: the orchestrator (posts the question as it stands), planner's
  `rescope_questions.ts` (the lines through `readAdrDepartures`).
- `<run>/review-questions.json`: the open verdict-placed questions under the spec's issue, copied by
  `drive_workflow.py rescope … questions=@<file>`. Readers: the plan check's ask step, which adds each departure's
  path to the paths it checks, and its decide step, which adds each departure whose record governs its path as a
  departure the judge named, once per `(folder, record, path)`, before rulings are applied (R13). A ruling is keyed
  on `(folder, record, path)`, never on a story.

## Rulings written (`<run>/adr-rulings-written.json`)

`AdrRulings`: every entry decide appended to the rulings file in this run. Writer: `adr_check.ts decide`. Readers:
the writer guard in ask and decide (R9 a): a rulings-file entry, compared whole, in neither this record nor the file
at `HEAD` is could not run.

## Folder outcome (`FolderOutcome`, `planner/plugin/lib/adr-check.ts`)

| Field | Type |
|---|---|
| `entry` | string |
| `inside` | boolean |
| `outcome` | `CheckOutcome`: `PASS`, `FAIL`, `COULD_NOT_RUN` |
| `governing` | `{recordId, title}[]` |
| `departures` | `{record, path, stories: string[], why}[]` not ruled on; `stories` every story whose task names `path` (tasks only) |
| `broken` | as in adr answer; each one makes the folder `FAIL` |
| `couldNotRun` | `CouldNotRun` or null |

Per check run, computed from the asked record, the verdict and the rulings file (R8); nothing is stored between runs
but the rulings file.

## Check stop (`AdrStop`, `ADR_STOPS`, `planner/plugin/lib/adr-check.ts`)

A stop is a list of `{kind, label, what}` items, `kind` a row of the stop table (workflow-steps.md); `adrStop`
renders each as a line and the list as an exit (R8). Every subcommand's every line goes through it.
