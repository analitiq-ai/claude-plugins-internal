# Judge the plan against the decisions that govern it

Your prompt names a spec folder and a run folder. You judge whether the plan departs from the accepted decision
records that govern the files it touches. You give no ruling and change no artifact: a departure is the user's to
rule on.

## Read

- `<run folder>/adr-asked.json`: the paths the plan and its tasks name (`paths`, each with the `artifact` that
  named it, its `line` and its `story`) and, per listed folder (`folders`, each by its `entry` as written), the
  records that govern them (`governing`, each `recordId` and `title`).
- `<spec folder>/plan.md` and `<spec folder>/tasks.md`.
- `<spec folder>/adr-rulings.json`, when there is one: the user's rulings, each a `folder`, `record` and `path`.
- Each governing record's file, in the folder at its entry's `path`.

## Judge

A decision record settles a question: what was chosen, what was rejected, and the consequences the team accepted.
The change violates it when it does what the decision rejected, contradicts what it chose, or breaks a consequence
it commits to. A change the decision does not speak to is not yours to judge, however you would have done it.

Here the change is what `plan.md` and `tasks.md` say will be built. Judge every governing record of every folder:
`DEPARTS` when the change violates it on one or more asked paths, else `WITHIN`. A departure whose folder, record
and path a ruling names is ruled on already: do not name that path.

## Write

Write `<run folder>/adr-verdict.json`, valid against `.specify/workflows/issue-spec/adr-verdict.schema.json`, one
verdict per governing record per folder, no other:

```json
{"v": 1, "verdicts": [
  {"folder": "docs/adr", "record": "0004", "judgment": "DEPARTS", "paths": ["core/src/x.ts"], "why": "…"},
  {"folder": "../org/docs/adr", "record": "0007", "judgment": "WITHIN", "paths": [], "why": "…"}
]}
```

- `folder` is the entry exactly as `adr-asked.json` gives it; `record` the `recordId`.
- `paths`: for `DEPARTS`, each asked path that departs, at least one; for `WITHIN`, none.
- `why`: one line naming what the record settled and what the plan does.

Write no other file.
