# Contract: planner's check steps

## `planner/plugin/scripts/adr_check.ts`

```text
adr_check.ts ask    <plan|tasks> <spec folder> <run folder>
adr_check.ts decide <plan|tasks> <spec folder> <run folder> <asked digest>
adr_check.ts stop   <plan|tasks> judge
```

Run from the project root (the workflow's cwd). Settings: `codeworks.toml` at the checkout's HEAD, through
`readPlannerSettings`. Every outcome line and every stop of every subcommand is printed by one function,
`adrStop` (`planner/plugin/lib/adr-check.ts`, R8): it maps the stop to one line per folder or artifact,
`<label>: PASS (…)` or `<label>: <FAIL|COULD_NOT_RUN>: <what>. Next step: <next>.`, and to the exit (2 any COULD_NOT_RUN, else 1 any
FAIL, else 0). No subcommand formats a stop of its own.

### ask

Removes any `<run>/adr-<a>-verdict.json` first, so a stale verdict is never read. Reads the artifact's paths (root
files from `git ls-files` and `plan.md`'s `## Touches`), then the rulings file through core's `readRulings` and runs the writer guard (R9): an
entry in neither the file at `HEAD` nor `<run>/adr-rulings-written.json` is could not run. Resolves the folders
(`adrFolders`), runs `checkAdrFolder` once per readable folder, writes `<run>/adr-<a>-asked.json`, prints
`{"judge": <bool>, "asked": "<sha256 of the asked record>"}` on stdout. Exit 0 when it wrote the record (folder
outcomes are decide's); 1 when the artifact's or the rulings file's grammar is refused; 2 when the guard fails or
settings, git or the run folder could not be read.

### judge (prompt step, `adr-judge.md`)

A judge step that fails or reaches its timeout records no output (the prompt step captures none), so
`drive_workflow.py` reports it through `adr_check.ts stop <a> judge`: `COULD_NOT_RUN: the judge did not answer.
Next step: resume to retry.`

### decide

First the writer guard again (R9), on what ask recorded: the asked record's sha256 against `<asked digest>` (the
ask step's output, which the workflow passes and no model step writes), the artifact's paths re-read against the
asked record's, the rulings file against `HEAD` and `<run>/adr-rulings-written.json`. Any difference: exit 2,
naming what changed. Then reads the verdict (when `judge`) and `ADR_RULING`; validates each ruling against the
asked record and one `checkAdrFolder(folder, [path])` call per new ruling (artifact-grammar.md, `ADR_RULING`); appends each valid one not already there to the rulings file and
to `<run>/adr-rulings-written.json`; drops every departure whose `(folder, record, path)` an entry names; decides
each folder (data-model, Folder outcome); prints through `adrStop`:

```text
docs/adr: PASS (governing: 0004 Treat a check that could not run…, 0009 …)
../engineering/docs/adr: COULD_NOT_RUN: /…/engineering/docs/adr is not a readable folder. Next step: check
  analitiq-ai/engineering out beside this repo, or remove the entry from [shared] adr_folders.
planner/docs/adr: FAIL: 0009 on planner/plugin/scripts/x.py (story US3): <why>. Next step: change tasks.md, draft
  a superseding record into the spec PR (ADR-0009 d3), or resume with adr_ruling naming planner/docs/adr, 0009,
  planner/plugin/scripts/x.py and your reason.
```

No folder listed: prints `No ADR folder is listed in codeworks.toml [shared] adr_folders.`, exit 0.

## `workflow.yml` (version 1.7.0)

No new input: a ruling reaches the run only as `ADR_RULING` from the resume that carries it.

```yaml
  - id: to-adr-plan            # after to-settled-design, before to-mark-critiques
    type: if
    condition: *spec-is-written
    then:
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
        run: node "$PLANNER_ROOT/scripts/adr_check.ts" decide plan "$SPECIFY_FEATURE_DIRECTORY" ".specify/workflows/runs/{{ context.run_id }}" "{{ steps.adr-plan-ask.output.data.asked }}"
  # to-adr-tasks: the same with `tasks`, after to-tasks.
```

## `adr-judge.md` (installed with the workflow)

Read `<run>/adr-<a>-asked.json`, the artifact, the spec folder's `adr-rulings.json` and each governing record's
file in its folder; judge each record as `agents/decision-reviewer.md` defines a departure, naming no departure an
entry of the rulings file already rules on; write `<run>/adr-<a>-verdict.json` per `AdrVerdict`; write no other
file; give no ruling.

## `drive_workflow.py`

- `resume <run> adr_ruling=<json>` exports `ADR_RULING=<json>` to that invocation's `specify resume` only; it is
  not passed as a workflow input and not written to `inputs.json`, so no later resume or check sees it.
- `report` sets `adr: true` when the failed step is any `adr-{plan,tasks}-{ask,judge,decide}`. For a judge step,
  `stderr` is what `adr_check.ts stop <a> judge` prints; for ask and decide, the step's own stderr.
- `test_drive_workflow.py` cases: an ask stop (grammar refused) and an ask guard stop each report `adr: true` with
  their lines; a judge that fails, and one that times out, report `adr: true` and the could-not-run line; a decide
  stop reports `adr: true`; `resume … adr_ruling=[…]` sets `ADR_RULING` for that call, `inputs.json` gains no
  `adr_ruling`, and the next resume runs without it.

## Skill stop (`SKILL.md`)

One rule for every report with `adr: true` (ask, judge, decide; plan or tasks): show every stderr line, then act on
each by its outcome. FAIL naming a departure (record and path): the user picks: change the artifact, draft a
superseding record (`/speckit-adrkit-draft`) into the spec folder's component `docs/adr`, or rule; resume with
`adr_ruling=[…]` only with the user's reason in their words. Any other FAIL: change the artifact as the line says.
COULD_NOT_RUN: the user fixes what the line names (for the judge, nothing: resume to retry); resume once they say it
is done.
