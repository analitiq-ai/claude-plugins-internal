# Contract: the premise report and its check

Owner: `plugins/alq-plan/scripts/premise_report.py`. This file describes the change; the script's `form()` is the
source of truth.

## `premise_report.py form`

Prints, in order: `Reports wrong behaviour:`, the six `## <question>` sections (`Question:`, `Answer:`,
`Source:`), then `Pick:`, `Rests on:`, `Reason:`, then the comment block. No `Recommendation:` line, and the
comment block no longer names it. The comment block gains the defect rule: a `no spec needed` pick on a report with
`Reports wrong behaviour: yes` cites `<path>:<line>` in the `harm` and `change-alters` `Answer:` lines, each with a
`code:` or `reproduction:` source (FR-006).

## `premise_report.py check <report> <pick>`

Exit 0 with no output, 1 with one problem per stderr line (`<report>: <problem> Next step: …`), 2 when it could
not run. Problems added or changed:

| Report | Problem names |
|---|---|
| `Pick:` ≠ `<pick>` | both outcomes and "resumed"; no mention of a user |
| `Reports wrong behaviour: yes`, `Pick: no spec needed`, `harm` or `change-alters` answer without `<path>:<line>` | the question and `<path>:<line>`; Next step: cite the file and line at fault, or pick `write the spec` |
| same, with that answer's source `user:` (or not `code:`/`reproduction:`) | the question, `code:`, `reproduction:` |

Removed: the problem "`Reports wrong behaviour: yes` and the recommendation is `no spec needed`".

`form`, `spec` and `reason` subcommands are otherwise unchanged. `rested_on()` and `reason()`, which `no_spec.py`
reads the report through, are unchanged (R7).

## `issue-spec` skill, step 2–3 (session behaviour)

- Never asks the user to pick, confirm, approve or reject the premise outcome.
- Asks the user only a premise question the issue and the code cannot answer; records it with `user:`.
- Resumes with `premise_verdict=<Pick>` after telling the user the pick, the question it rests on and the reason.
- The same at the premise pause of a rescope of a no-spec folder.
- Step 3's `no spec needed` sentence (the no-spec spec.md written, nothing posted, pass `spec: null`) is kept.
