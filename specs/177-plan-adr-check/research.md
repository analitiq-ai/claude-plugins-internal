# Research: planner checks the plan against the ADR folders it is given

Each decision below settles one mechanism `plan.md` lists under `## Mechanisms`.

## R1: The `[shared]` key that lists the ADR folders

- **Decision**: `adr_folders`, a required array of non-empty strings in `[shared]`, possibly empty; core's `Shared`
  schema refuses a missing key, a non-array, an empty string and an entry written twice (as `validators` refuses a
  repeat today). This repo lists `docs/adr`, `planner/docs/adr`, `reviewer/docs/adr`, `builder/docs/adr`,
  `orchestrator/docs/adr`, `auditor/docs/adr` (every tracked `docs/adr` today) and `../engineering/docs/adr`. Every test fixture that
  writes a `[shared]` section gains `adr_folders = []`: `core/tests/fixtures/state/issue.ts`,
  `planner/tests/support/checkout.ts`, `planner/tests/token.test.ts`, `orchestrator/tests/support/{story,checkout}.ts`,
  and every typed `Shared` literal `tsc -p core` checks: `core/tests/{could-not-run,threads,required-checks,contract,state-read}.test.ts`.
- **Rationale**: root ADR-0002 d2: planner and reviewer both read it, so it is `[shared]`; d3: no environment
  variable. Required (Clarifications) so a repo that forgot it is refused, not checked against nothing.
- **Existing tools**: `Shared` in `core/src/settings.ts` (extended, not replaced); `REVIEWER_ORG_ADR_DIR`
  (`reviewer/plugin/scripts/adrkit.py:22`) rejected by root ADR-0002 d3; reviewer's `worktree.decision_folders`
  (finds tracked `docs/adr`) rejected by Clarifications: only listed folders are checked.

## R2: Resolving an entry to a folder

- **Decision**: `adrFolders(checkout, shared)` in new `core/src/adr-folders.ts`. Absolute entry: as written.
  Relative entry: joined to the main checkout, the parent of `git rev-parse --path-format=absolute
  --git-common-dir`, and normalised; if that path lies inside the main checkout, it is re-rooted at the same repo
  path under `git rev-parse --show-toplevel` of `checkout`. Each result: `{entry, path, readable}`; readable is a
  directory with read and search access. Two entries whose resolved paths (realpath when it exists) are one folder:
  `SettingsError` on `SHARED_SECTION` naming both. Git is called through core's `runGit`. No env var, no network.
- **Rationale**: `../engineering/docs/adr` must be the same folder from every worktree (issue). An in-repo folder
  read from the main checkout would be main's working tree, not the branch's: a superseding record drafted into the
  spec PR (ADR-0009 d3, US3 AS2's next step) would never be seen, and reviewer would stop seeing a changed record's
  own error. Spec FR-004, US2 and SC-004 amended to say so (plan, Spec amendments).
- **Existing tools**: `runGit` (`core/src/git.ts`) used; `gitTree` (`core/src/tree.ts`) reads committed files, not
  folders on disk, so does not fit; reviewer's `corpora()` (`adrkit.py:39`) realpath-dedups and is the model for
  the duplicate rule, but is Python and reads the env var.

## R3: Running `adr check` and reading its answer

- **Decision**: new `core/src/adr.ts`: `ADR_VERSION = "0.20.0"`, `ADR_INSTALL`, `checkAdrFolder(cwd, folder,
  paths)` and the pure `readAdrAnswer(raw)`, ported from `adrkit.py`'s `check`/`parse`/`_outcome`: `adr --version`
  must say `ADR_VERSION`; `adr check --dir <folder> --json -- <paths>` from the checkout root, the folder given
  relative when inside it (adrkit 0.20.0 misses changed records otherwise); exit 0/1 with readable JSON is an answer,
  anything else could not run; capped-scan rules are could not run. Returns `{governing, broken}` or `CouldNotRun`.
  No deadline: planner has none (spec Edge Cases); the shell step's timeout is 1800 s.
- **Rationale**: FR-013: the version once, in core. Reviewer's US5 then calls the same reader, so `adr`'s answer
  grammar has one home (Principle I).
- **Existing tools**: `reviewer/plugin/scripts/adrkit.py` and `decisions.py` (Python; no Python calls core, root
  ADR-0009; #235 deletes them); `.specify/extensions/adrkit/scripts/check.sh` (one `ADRKIT_DIR`, prose report
  through a model, an optional hook) does not fit; `@adrkit/cli` exposes no library API reviewer pins, so the CLI
  is the interface.

## R4: The paths `plan.md` names

- **Decision**: a `## Touches` section in `plan.md`, one `` - `<path>` `` bullet per file the plan creates, changes
  or deletes, the path in the one path grammar (R5); no glob, no trailing `/`, no `..`. Added to the
  settled-design preset's plan template (`planner/plugin/speckit/presets/settled-design/templates/plan-template.md`);
  read by `readTouches` in `core/src/contracts/decision-check.ts`. A bullet not in the grammar is refused (exit 1,
  naming the line); a section with none is could not run (spec Edge Cases).
- **Rationale**: P7: paths read from a key with a grammar, not from the Project Structure tree. Same shape as
  `## Mechanisms`, which `settled_design.py` reads.
- **Existing tools**: the template's Project Structure tree (ASCII art, no grammar); `## Mechanisms` (names
  mechanisms, not paths); adrkit's `check.md` falls back to the plan file itself as the only path, which governs
  nothing useful.

## R5: The paths `tasks.md` names

- **Decision**: one path grammar for both artifacts, one pure function `artifactPath` in
  `core/src/contracts/decision-check.ts` (artifact-grammar.md, Path): one `{a,b}` group expanded. A task line is
  Spec Kit's `- [ ] T<n> …`; its paths are its backticked spans `artifactPath` accepts: a span with a `/` always,
  one with no `/` only when it is in `rootFiles`: the `git ls-files` entries with no `/` together with the
  `## Touches` entries with no `/`, both read by the ask step and passed in, so the reader stays pure. Touches
  carries a root file a task creates, which git does not track yet (codex on #279). A Touches bullet is a path by its place, so no root
  check. Its story is its `[US<k>]` tag, else its phase heading. `readTaskPaths` sits in `core/src/contracts/tasks.ts`
  beside the task-block label (that file's comment: the grammar has one home) and calls `artifactPath`.
- **Rationale**: FR-012: one grammar, so a task naming `codeworks.toml` (governed by root ADR-0002) is checked as
  the plan's Touches would check it. Without the root rule every backticked word would be a path. Planner ADR-0008
  d2 keeps the stock template, whose tasks already name files in backticks
  (`specs/209-rebuild-reviewer-on-core/tasks.md`), so no template change is needed.
- **Existing tools**: `readTaskBlockLabels` in `core/src/contracts/tasks.ts` (labels, not paths; extended beside
  it).

## R6: Where the check runs in the workflow

- **Decision**: two top-level `if` blocks on `*spec-is-written` in `workflow.yml`: `to-adr-plan` after
  `to-settled-design`, before `to-mark-critiques`; `to-adr-tasks` after `to-tasks`. Each holds three steps:
  `adr-<a>-ask` (shell, `node "$PLANNER_ROOT/scripts/adr_check.ts" ask <a> …`, `output_format: json`), an `if` on
  `steps.adr-<a>-ask.output.data.judge`, holding `adr-<a>-judge` (Spec Kit `prompt` step following
  `adr-judge.md`), then `adr-<a>-decide` (shell, `… decide <a> …`). One block per check, so a resume re-runs ask,
  judge and decide on the artifact as it now stands (US3 AS4).
- **Rationale**: P1 (planner): a workflow step that runs a script decides; FR-006; the workflow's own rule that a
  resume re-runs the top-level step it stopped in.
- **Existing tools**: `command: speckit.adrkit.check` (prose answer, one folder) does not fit P7; Spec Kit's
  `prompt` step (`specify_cli/workflows/step/prompt`) sends an inline prompt to the integration with the same
  `SPECKIT_INTEGRATION_CLAUDE_EXTRA_ARGS` tools as a command step: used for the judge; the critique pattern
  (`mark-critiques` → command → `find`) is the model for script → model → script.

## R7: The judge's verdict

- **Decision**: the ask step writes `<run>/adr-<a>-asked.json` (per folder: entry, path, outcome or governing
  records and broken records; the artifact's paths). The judge reads it, the artifact and the spec folder's rulings
  file, and writes
  `<run>/adr-<a>-verdict.json`: `{v: 1, artifact, verdicts: [{folder, record, judgment, paths, why}]}`, `judgment`
  from new core enum `AdrJudgment` (`WITHIN`, `DEPARTS`), `paths` non-empty for `DEPARTS`. Zod schema in
  `core/src/contracts/decision-check.ts`. A verdict missing, unparsable, missing a governing record, naming one
  not governing, or naming a path not asked is could not run for that folder. The judge's instructions live in
  `planner/plugin/speckit/workflows/issue-spec/adr-judge.md`.
- **Rationale**: FR-015, P7, root ADR-0010 d1 (an agent's answer set is an enum in core); P4.
- **Existing tools**: reviewer's `agents/decision-reviewer.md` judges a diff in a review round and answers through
  the Workflow tool's StructuredOutput, which a Spec Kit step cannot use; its definition of a departure is reused
  in `adr-judge.md`. `CheckOutcome` reused for the folder outcome.

## R8: Each folder's outcome and the step's exit

- **Decision**: pure `decideFolder` and `decideCheck` in `planner/plugin/lib/adr-check.ts`. Per folder:
  `COULD_NOT_RUN` (unreadable, `adr` missing or other version, answer or verdict unreadable) else `FAIL` (a broken
  record, or a `DEPARTS` no rulings-file entry names) else `PASS`. Empty list: no folder, prints that none is
  listed, exit 0. Every folder's outcome is printed.
  Every stop of every check step (ask, judge, decide; plan and tasks) goes through one pure function, `adrStop`, in
  the same module: it maps the stop (folder outcomes, a refused line, a guard difference, a judge that did not
  answer) to lines `<label>: <FAIL|COULD_NOT_RUN>: <what>. Next step: <next>.` and to the exit: 2 when any is
  `COULD_NOT_RUN`, else 1 when any is `FAIL`, else 0. Next steps: change the artifact, draft a superseding record
  into the spec PR (ADR-0009 d3), or resume with a ruling; for could not run, what to fix; for the judge, resume to
  retry. ask and decide call it in-process; the judge step runs no script, so `drive_workflow.py report` gets its
  lines from `adr_check.ts stop <a> judge`, which calls the same function. `report` sets `adr: true` for every
  `adr-*` step and SKILL.md handles all of them by that one mapping (workflow-steps.md).
- **Rationale**: FR-008, FR-009, FR-018; P3; P4; exit codes as `settled_design.py` and `spec_facts.ts` (1 refused,
  2 could not run). Could not run wins the exit: a fixed plan would still go unchecked in that folder. The function
  sits in planner's TypeScript because the steps are TypeScript and `drive_workflow.py` calls no core (root
  ADR-0009); calling the script keeps one formatter instead of a Python copy. A failed prompt step records no
  output (`prompt/__init__.py:246–250`), so without this the judge's stop would surface as a generic error.
- **Existing tools**: `CheckOutcome` and `couldNotRun` (`core/src/outcomes.ts`) reused; `report()`'s per-step
  `stderr` (`drive_workflow.py`) extended, not duplicated.

## R9: The user's ruling on a departure

- **Decision**: the rulings live in one file, `<spec folder>/adr-rulings.json` (artifact-grammar.md), holding only
  the user's rulings `{folder, record, path, reason}`; it lands in the spec PR. No workflow input: the skill runs
  `drive_workflow.py resume <run> adr_ruling=<JSON array>` only on the user's words, and `drive_workflow.py` exports
  `ADR_RULING` to that one `specify resume` call, never passing it as an input or writing it to `inputs.json`.
  - Validation, deterministic, against `adr` and never the judge: a ruling is refused (exit 1) only when its folder
    is not listed, its path is not an asked path, or `checkAdrFolder` run on that folder with that one path does not
    name its record as governing. `adr check` answers governing records for the whole path set, so the asked record
    cannot say which record governs which path; one call per new ruling, only on a resume that carries one, makes the
    pair exact. A call that could not run makes the check could not run. Entries already in the file are not
    re-checked. A valid ruling is appended to the rulings file, also when the judge did not name that departure
    this time (a re-run judge need not repeat it); one already there is satisfied.
  - Honouring: the judge is given the file (`adr-judge.md`), and decide drops every departure whose
    `(folder, record, path)` an entry names, at every check of the spec folder: the after-tasks check, a rerun, a
    rescope (the file survives a regenerated `tasks.md`).
  - One writer, decide. Writer guard, one function `changedSince(recorded, now) → {added, removed}` in
    `planner/plugin/lib/adr-check.ts`, used three ways: (a) ask and decide: a rulings-file entry added beyond the
    file at `HEAD` and `<run>/adr-rulings-written.json` (decide's record of every entry it appended) is could not
    run, naming it; (b) decide: the artifact's paths re-read against the asked record's, any difference could not
    run; (c) decide: the asked record's sha256 against the `asked` digest ask printed, which the workflow passes as
    an argument, any difference could not run. Each names what changed (FR-019).
- **Rationale**: FR-016, FR-017, FR-019; ADR-0004's "a way past it that can succeed"; P2: the user releases the
  stop; P6: one writer. A resume re-runs the whole block, judge included (workflow.yml:110–111), so a ruling checked
  against the judge's answer would be refused when the model does not repeat it; a persisted input
  (`engine.py:1159–1163`, `_step_env`) would reach the after-tasks check. The headless steps hold Write/Edit
  (`AGENT_ARGS`), so a file only decide writes, checked against `HEAD` and decide's run record, is what keeps a
  model from adding a ruling; an entry committed by hand is seen in spec-PR review (amended ADR-0009, R11).
- **Existing tools**: gate `verdict_input` (a choice from fixed options; a ruling carries data, so a gate does not
  fit); `drive_workflow.py resume <run> <input>=<value>` (extended to intercept `adr_ruling`); notes in `plan.md` /
  `tasks.md` (rejected: two locations and grammars, and a rescope regenerates `tasks.md`).

## R10: Reviewer reads the same list (US5, after #235)

- **Decision**: `reviewer/plugin/lib/round/decisions.ts` takes folders from `adrFolders` and runs `checkAdrFolder`
  per readable one; an unreadable one is could not run; it drops `decision_folders` discovery and
  `REVIEWER_ORG_ADR_DIR` (code, README, tests); it reads the spec folder's rulings file through core's
  `readRulings` and reports no departure an entry names. A folder's label is its entry as written; "org"
  becomes "outside the repo" (resolved path not under the checkout). Its deadline stays reviewer's own.
- **Rationale**: FR-014, FR-017; SC-005.
- **Existing tools**: #235's port of `adrkit.py`/`decisions.py` (changed, not duplicated).

## R11: Decision records first, and PR order

- **Decision**: PR 1 amends planner ADR-0009: d1 checks each folder `[shared] adr_folders` lists, after plan and
  again after tasks, public repo lists no private path; d2 replaced by "the folder on disk is checked, no network,
  kept current by the admin", Option C accepted with why; the judge's `AdrJudgment` set and the user's ruling
  (FR-016) decided, in the rulings file with decide its only writer, and spec-PR review named as the check on an
  entry committed by hand; `affects` adds `core/src/{adr,adr-folders}.ts`, `core/src/contracts/decision-check.ts`,
  `planner/plugin/scripts/adr_check.ts`, `planner/plugin/lib/**`. PR 2 adds a reviewer record: the decision check
  honours the spec folder's rulings file and checks only listed folders. `0022` is its working name only; its
  number is the next free one when it is drafted, since #209/#235 may add reviewer records first. Then US2 (core +
  `codeworks.toml` + fixtures), US3+US4 (planner), US5 after #235 and that record.
- **Rationale**: Principle VI; FR-001; root ADR-0010 d3 (a set is added with the record that owns it).
- **Existing tools**: `/speckit-adrkit-draft` drafts the records.
