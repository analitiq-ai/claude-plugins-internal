# Data Model: One planning skill, `alq-spec`

## Premise report

A Markdown file written by the skill in the session, at `.specify/workflows/runs/<run_id>/premise-report.md`. Its form is
printed by `premise_report.py form` (see [contracts/premise-report.md](contracts/premise-report.md)).

| Field | Rule |
|---|---|
| `Reports wrong behaviour:` | `yes` or `no`. |
| Question `harm`, `reachable`, `change-alters`, `owner`, `inherited`, `needs-spec` | Each has an `Answer:` and a `Source:`. A missing question fails the check, as does an empty answer or source on a graded question (all six for `write the spec`; up to `Rests on:` for a stop pick). |
| `Source:` | `code: <module or path>`, `reproduction: <what was run>` or `user: <what they said>`. |
| `reachable` `Answer:` | Starts `observed` or `predicted`. |
| `Recommendation:` | One of `write the spec`, `no spec needed`, `not worth doing`. With `Reports wrong behaviour: yes`, never `no spec needed`. |
| `Pick:` | One of the same three; equals the gate's choice. |
| `Rests on:` | The heading of the question a stop pick rests on; required for a stop pick. Questions after it are not graded. |
| `Reason:` | One line; required when the pick is `no spec needed` or `not worth doing`. |

State: written once per run, read by `check`, `record` and `specify`. Not committed. A new run has a new folder, so a
report is never reused.

## Location comment (third form)

| Form | Lines after the marker | Read as |
|---|---|---|
| Located | `spec: <folder>`, `branch: <branch>` | `Located` |
| No spec | `spec: none`, `reason: <line>` | `NoSpec` |
| Not worth doing (new) | `spec: not worth doing`, `reason: <line>` | `NotWorthDoing`; `located` refuses it |

One comment per issue, replaced in place by the upsert. A new pick replaces the earlier form.

## Root cause section

In `spec.md`, the heading `## Root cause`, whose first non-blank line is `Observed: …` or `Not a defect report.` The second is refused when the premise report says `Reports wrong behaviour: yes`.

## Premise answers in `spec.md`

The `## Why this is worth doing` section: the six answers, each followed by its source, copied from the report.

## Workflow state

| Step | Runs when | Output used |
|---|---|---|
| `premise` (gate) | `inputs.spec_dir` empty | `choice` |
| `premise-report` (shell) | with `premise` | exit code |
| `record-outcome` (shell) | with `premise` | posts the comment for the two stop picks |
| `proceed` (if) | `inputs.spec_dir` set, or choice is `write the spec` | branches to the existing steps |
| `root-cause` (shell) | inside `proceed`, after `specify` only | exit code |
| `root-cause-after-grill` (shell) | inside `proceed`, after `no-open-markers` | exit code; the same script |
