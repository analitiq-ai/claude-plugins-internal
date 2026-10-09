# Quickstart: validating the merged skill

Run from `dev/alq-review/` in the issue's worktree. `specify-cli==1.0.7` and `gh` authenticated.

## Automated

```bash
python3 -m unittest discover -s tests
```

Expect green, including: the premise gate pauses first and is skipped on a re-scope; each of the three picks ends as
specified; the report check refuses each way in [contracts/premise-report.md](contracts/premise-report.md); the root
cause check refuses a spec without a labelled section; the third location form round-trips and is refused by `located`;
nothing under `plugins/` or the tests names `alq-shape`.

## By hand, on a scratch issue

1. **Defect, premise holds.** `/alq-review:design-doc #<issue>`. The run pauses at `premise`; answer the questions, pick
   "write the spec". After critique the spec folder's `spec.md` holds `## Why this is worth doing` with a source on every answer and
   `## Root cause` opening `Observed:`.
2. **Premise fails.** Pick "not worth doing". Expect: no new folder under `specs/`; the issue's location comment reads
   `spec: not worth doing` and a `reason:`; `/alq-review:alq-issue-tackle <issue>` refuses and says why.
3. **No spec needed.** On a plain typo issue, pick "no spec needed". Expect no new folder and a `spec: none` comment.
4. **Defect judged "no spec needed".** The skill must not recommend it for an issue that reports wrong behaviour; a report that
   says `Reports wrong behaviour: yes` with that recommendation fails `premise-report`.
5. **Incomplete report.** Delete one `Source:` and resume: the run fails at `premise-report` naming the question.

## After PR 2

`/alq-review:alq-spec #<issue>` runs the same. `grep -rn "design-doc" plugins dev/alq-review/tests .github` finds nothing.
