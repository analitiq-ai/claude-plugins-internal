# Data Model: The agent picks the premise outcome

## Premise report (`.specify/workflows/runs/<run_id>/premise-report.md`)

Written by the agent in step 2, graded by `premise_report.py check <report> <pick>`. The form is in
[contracts/premise-report.md](contracts/premise-report.md).

| Field | Values | Rule |
|---|---|---|
| `Reports wrong behaviour` | `yes` \| `no` | required |
| `## <question>` × 6 | `Answer:`, `Source:` | `Source:` starts `code:`, `reproduction:` or `user:`; `reachable` starts `observed`/`predicted`; graded: all for `write the spec`, up to `Rests on` for a stop pick |
| `Pick` | one of the three outcomes | must equal the resumed `premise_verdict` (R1) |
| `Rests on` | a question heading | required for a stop pick |
| `Reason` | one line | required for a stop pick; the closing comment for `not worth doing` |
| `Recommendation` | — | removed (R2) |

**Defect rule (R4)**: `Reports wrong behaviour: yes` with `Pick: no spec needed` requires both `harm` and
`change-alters` to cite `<path>:<line>` in `Answer:` and to have a `code:` or `reproduction:` source.

## Premise verdict (workflow input `premise_verdict`)

One of `write the spec`, `no spec needed`, `not worth doing`. Set by the skill on resume; now from the agent's
pick. Unchanged in `workflow.yml`.

## No-spec spec.md (`specs/<issue>-<short name>/spec.md`, unchanged)

Written by `no_spec.py write` on a `no spec needed` pick: `# No spec needed`, then `Rests on:` and `Reason:` from
the report (R7). It reads neither `Recommendation:` nor a picker.

## Run flow after premise (unchanged)

The same on a new scope and on a rescope of a no-spec folder, which pauses at premise too (R7).

| Pick | Workflow | Session (FR-008) |
|---|---|---|
| `write the spec` | specify → root cause → premise answers → grill gate | one line before grill: pick, rests-on question, reason |
| `no spec needed` | no-spec spec.md written in the run's spec folder; nothing posted; completed | pick, rests-on question, reason, pass `spec: null` at review |
| `not worth doing` | issue closed as not planned with `Reason`; no folder written; completed | pick, rests-on question, reason, issue closed |
