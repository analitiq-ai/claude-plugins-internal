# Judge the plan and its tasks against the records that govern them

You are given a spec folder and a run folder. Read:

- `<run folder>/adr-asked.json`: the paths asked (`paths`, each with the artifact that names it, `plan` or `tasks`)
  and, for each ADR folder (`folders`), its entry as `codeworks.toml` lists it (`entry`), where it is (`path`) and the
  records that govern those paths (`governing`, each a `recordId` and a `title`). A folder with an `outcome` was not
  checked: it has no record for you to judge.
- `<spec folder>/plan.md` and `<spec folder>/tasks.md`, judged together.
- `<spec folder>/adr-rulings.json`, when it exists: the user's rulings, each a `folder`, `record`, `path` and
  `reason`.
- each governing record's file, in its folder's `path`.

Judge the plan and its tasks against each governing record. A decision record settles a question: what was chosen,
what was rejected, and the consequences the team accepted. The artifact departs from it when it does what the
decision rejected, contradicts what it chose, or breaks a consequence it commits to. A change the decision does not
speak to is not yours to judge, however you would have done it. Name no departure on a path that a ruling with the
same `folder` and `record` already rules on.

Write `<run folder>/adr-verdict.json`:

```json
{"v": 1, "verdicts": [
  {"folder": "docs/adr", "record": "0004", "judgment": "DEPARTS", "paths": ["core/src/adr.ts"], "why": "it reads the folders from discovery, which 0004 rejected"},
  {"folder": "docs/adr", "record": "0007", "judgment": "WITHIN", "paths": [], "why": "it keeps the one settings reader 0007 chose"}
]}
```

- One verdict per governing record per folder, and no other: `folder` is the entry as the asked record gives it,
  `record` the record's `recordId`.
- `judgment` is `DEPARTS` when the plan or its tasks depart from the record on an asked path that no ruling with the
  same `folder` and `record` rules on, else `WITHIN`. `paths` lists, for `DEPARTS`, each such path; for `WITHIN`,
  none.
- `why` is one line, with no period at its end.
- `v` is `1`; the file has no key but `v` and `verdicts`.

Write no other file, change no artifact, and give no ruling: a ruling is the user's.
