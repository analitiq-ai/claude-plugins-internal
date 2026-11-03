# Data model: planner checks the plan against the ADR folders it is given

Every schema below is Zod in core unless named otherwise; value sets live in `core/src/values.ts` (root ADR-0010).

## ADR folder list (`[shared] adr_folders`)

| Field | Type | Rule |
|---|---|---|
| `adr_folders` | `string[]` | required; may be empty; each entry non-empty; no entry written twice (R1) |

Writer: the admin, in `codeworks.toml` (root ADR-0002 d1). Readers: core `adrFolders`, for planner and reviewer.

## Resolved ADR folder (`ResolvedAdrFolder`, `core/src/adr-folders.ts`)

| Field | Type | Meaning |
|---|---|---|
| `entry` | string | as the admin wrote it; the folder's label in every message |
| `path` | string | absolute path resolved per R2 |
| `inside` | boolean | `path` lies in the calling checkout (an in-repo folder) |
| `readable` | boolean | a directory with read and search access |

Two entries whose `path` (realpath where it exists) is one folder: `SettingsError(SHARED_SECTION, …)` naming both.

## adr answer (`AdrAnswer`, `core/src/adr.ts`)

`{governing: {recordId, title}[], broken: {file, id?, rule, message}[]}` or `CouldNotRun` (`core/src/outcomes.ts`).
Read from `adr check --json` at `ADR_VERSION` (R3).

## Checked artifact (`CheckedArtifact`, value set)

`plan` (paths from the plan step's `<run>/touches.json`), `tasks` (paths from `tasks.md` task lines). Owner: planner
ADR-0009.

## Touched paths (`TouchedPaths`, `<run>/touches.json`)

`{v: 1, paths: PATH[]}`, no entry twice (artifact-grammar.md). Writer: the plan step (the model writing `plan.md`,
told by `speckit.plan.md`). Readers: `adr_check.ts` ask and decide only (plan's paths; tasks' `rootFiles`). The run
folder is gitignored; builders and reviewers never see it. Unparsable or wrong shape: refused; missing or empty:
could not run, naming `touches.json`.

## Artifact path (`core/src/contracts/decision-check.ts`, `tasks.ts`)

| Field | Type | Meaning |
|---|---|---|
| `path` | string | repo-relative file path, the one path grammar (R5) |
| `line` | number | line in the artifact; for `touches.json`, the entry's 1-based index in `paths` |
| `story` | string \| null | `tasks` only: `US<k>` or the phase heading |

## Asked record (`<run>/adr-<artifact>-asked.json`)

Writer: `adr_check.ts ask`. Readers: the judge, `adr_check.ts decide`.

| Field | Type |
|---|---|
| `v` | `1` |
| `artifact` | `CheckedArtifact` |
| `paths` | Artifact path[] |
| `folders` | per listed folder: `{entry, path, outcome: CouldNotRun}` or `{entry, path, governing, broken}` |

Stdout JSON only: `judge`, true when any folder has a governing record; `asked`, the record's sha256, which the
workflow passes to decide (R9: the writer guard). Settings are read first: on an empty `adr_folders` the record has
no paths and no folders, no artifact is read, and `judge` is false.

## Verdict (`AdrVerdict`, `<run>/adr-<artifact>-verdict.json`)

Writer: the judge (prompt step). Reader: `adr_check.ts decide`.

| Field | Type | Rule |
|---|---|---|
| `v` | `1` | |
| `artifact` | `CheckedArtifact` | equals the asked one |
| `verdicts[]` | `{folder, record, judgment, paths, why}` | exactly one per governing record per folder |
| `judgment` | `AdrJudgment`: `WITHIN`, `DEPARTS` | owner planner ADR-0009 |
| `paths` | string[] | non-empty for `DEPARTS`, each an asked path; empty for `WITHIN` |
| `why` | string | non-empty |

## Ruling (`AdrRuling`, `AdrRulings`)

`{folder, record, path, reason}`, all non-empty strings; `folder` is the entry as written. Key:
`(folder, record, path)`.

- Rulings file: `<spec folder>/adr-rulings.json`, `{v: 1, rulings: AdrRuling[]}`, no key twice; only the user's
  rulings. Writer: `adr_check.ts decide`, from `ADR_RULING` only. Readers: the judge, every later ask and decide
  (through core's `readRulings`), reviewer's decision check (US5). An entry honours every departure with its key, in
  either artifact.
- One resume's ruling: `ADR_RULING`, a JSON array of rulings, set by `drive_workflow.py resume … adr_ruling=<json>`
  for that invocation only. Writer: the skill, on the user's words only. Validated against the asked record (R9).

## Rulings written (`<run>/adr-rulings-written.json`)

`{v: 1, rulings: AdrRuling[]}`: every entry decide appended to the rulings file in this run. Writer:
`adr_check.ts decide`. Readers: the writer guard in ask and decide (R9): a rulings-file entry in neither this record
nor the file at `HEAD` is could not run.

## Folder outcome (`FolderOutcome`, `planner/plugin/lib/adr-check.ts`)

| Field | Type |
|---|---|
| `entry` | string |
| `outcome` | `CheckOutcome`: `PASS`, `FAIL`, `COULD_NOT_RUN` |
| `governing` | `{recordId, title}[]` |
| `departures` | `{record, path, story?, why}[]` not ruled on |
| `broken` | as in adr answer; each one makes the folder `FAIL`, its line naming the record file, adrkit's rule and message, next step "fix that record" |
| `reason` | string, for `COULD_NOT_RUN`, ending with the next step |

Transitions: per check run, computed from the asked record, the verdict and the rulings file (R8); nothing is
stored between runs but the rulings file.

## Check stop (`AdrStop`, `planner/plugin/lib/adr-check.ts`)

What any check step stops on (next steps per R8: a departure's change the artifact, supersede the record in the
spec PR or in the repo that holds an outside folder, or rule; a broken record's fix that record): folder outcomes (decide), a refused artifact or rulings line (ask, decide), a guard
difference (ask, decide), or a judge that did not answer. `adrStop` maps it to lines
`<label>: <FAIL|COULD_NOT_RUN>: <what>. Next step: <next>.` and an exit (R8).

## Hold `adr-<issue>` (reviewer, US5)

A hold row (`core/src/contracts/snapshot.ts`) of new `HoldKind` `adr` (`core/src/values.ts`): placed by reviewer when
its decision check finds a record with its own `adr check` error, or a story PR changes a file under `specs/**` or
under a `docs/adr/` folder at any depth (root ADR-0011); refuses commits and rounds; its comment names the file(s)
(and rule and message for a broken record) and that planner fixes it. Released as every hold (reviewer ADR-0013 d2). Owner: reviewer ADR-0013 d4.
