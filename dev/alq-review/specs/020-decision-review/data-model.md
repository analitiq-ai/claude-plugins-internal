# Data model: the internal review round checks the diff against the decisions that govern it

Nothing here is stored. Every shape lives for one launch, in `decisions.py` as frozen dataclasses, and leaves the gate
only as the injected `args.decisions` (§ Round arguments and result). This file is the one statement of the check's
outcomes and refusals; research.md, contracts/interfaces.md and tasks.md refer to it and do not restate it.

## Corpus

| Field | Repo corpus | Org corpus |
|---|---|---|
| `label` | path from the repo root, e.g. `dev/alq-review/docs/adr` | `org (<value of ALQ_ORG_ADR_DIR>)` |
| `dir` | the same path, given to `--dir` relative to the checkout | the absolute path, given to `--dir` |
| `kind` | `repo` | `org` |

- Repo corpora: for each tracked path, every prefix of it that ends in the segments `docs/adr`; distinct, sorted. A
  `docs/adr` whose tracked files all sit in subfolders is still a corpus. No tracked file under it, no corpus.
- Org corpus: `ALQ_ORG_ADR_DIR`, when set and non-empty; empty counts as unset. When its resolved path equals a repo
  corpus's, that corpus is checked once, as the org corpus.
- A record is named `<label> <id>` everywhere: brief, notice, refusal, result.

## Status

One classifier, `decisions.status_class(text: str | None)`, serves loaded records and skipped files alike:

| Status text read | Class |
|---|---|
| `accepted` | `accepted` |
| `draft`, `proposed`, `rejected`, `superseded`, `deprecated` | `not governing` |
| any other value, no `status:` line, a file that cannot be read or is not UTF-8 | `unreadable` |

The text is what `adrkit.py` reads from the frontmatter with `^status:\s*["']?([\w-]+)` (multiline): an opening quote
and anything after the word, a closing quote or a `# comment` included, are not part of it.

## Finding (adrkit's, as read)

`rule`, `severity`, `message`, `source` (`lint` or `check`), and optionally `path`, `id`, `field`, `pattern`.

## Corpus report (what `adrkit.py` hands to `decisions.judge`)

| Field | Content |
|---|---|
| `corpus` | the Corpus |
| `findings` | lint's and check's |
| `governing` | check's `governing[]` as `(id, title)` |
| `files` | `id -> tuple of absolute paths` of `<dir>/<id>-*.md`, for each governing id |
| `statuses` | `path -> status text or None`, for every path a finding names |
| `unreadable_regular` | the paths of `markerScan.unreadablePaths` that `lstat` reports as regular files |

Every path adrkit names is relative to the directory it ran in, the checkout root (an org record outside the repo
comes back as `../../engineering/docs/adr/0007-x.md`); `adrkit.py` resolves each against the checkout root before
reading, `lstat`ing or globbing.

## Corpus outcome

Each corpus yields exactly one value, never an exception:

- `NotChecked(corpus, reason)`: the corpus could not be checked. `reason` is one sentence ending `Next step: ...`.
- `Judgement(corpus, records, notices, broken)`: the corpus was checked.

| Cause of `NotChecked` | Made by | `reason` names | Next step |
|---|---|---|---|
| the round's files number more than `max_review_files` | gate, for every corpus, before any call | the count and the limit | full round: split the PR; delta round: commit in smaller steps and launch after each |
| a repo corpus holds a file not as HEAD has it (`git status --porcelain --untracked-files=all --ignored -- <dir>` lists it) | gate, before any call | the files | commit or remove them |
| `ALQ_ORG_ADR_DIR` not an absolute path to a readable folder | `adrkit.org_corpus` | the variable and its value | point it at the org's `docs/adr` as an absolute path, or unset it |
| `adr` not on `PATH` | `adrkit.outcomes`, for every corpus | | `npm install -g @adrkit/cli@0.20.0` |
| a call exits other than 0 or 1 | `adrkit.outcomes` | the call and its stderr | what stderr says |
| a call's stdout is not a JSON object, or a field read is of another shape | `adrkit.outcomes` | the call and the field | `npm install -g @adrkit/cli@0.20.0` |
| a call has not ended by the deadline | `adrkit.outcomes` | the call, the deadline in seconds, and the seconds each step spent (review-base fetch, `gh` calls, each `adr` call) | the step that spent the time |
| a governing id that is not broken has no file, or more than one | `decisions.judge` | the id and the files | `npm install -g @adrkit/cli@0.20.0` (adrkit and the gate disagree on record names) |
| `marker-scan-capped` or `marker-declarations-capped` (a finding with no `path`) | `decisions.judge` | adrkit's message | split the change |
| a path in `unreadable_regular` | `decisions.judge` | the file | make it readable |

Every next step ends with `policy.review_call(state, 'internal')`. A corpus that is not checked contributes no record,
notice or broken line: what it would have said is unknown.

## Judgement (per corpus, pure)

A finding's record class is `status_class(statuses[path])`; a governing record is one whose class is `accepted` or
`unreadable` (an unreadable status must not hide adrkit's `error` on it, FR-004).

| Finding | Outcome |
|---|---|
| no `path`, rule other than the two caps | ignored |
| `corpus-file-skipped`, skipped file `accepted` | **broken** (FR-008) |
| `corpus-file-skipped`, skipped file `unreadable` | **notice** naming the file (FR-012) |
| `corpus-file-skipped`, skipped file `not governing` | ignored |
| severity `error` (`unique-id` included), `affects-bad-pattern`, `affects-unknown-type`, on a governing record | **broken** (FR-008) |
| `affects-unresolvable` or `affects-repo-not-applicable`, source `check`, on a governing record | **notice** naming the matcher (FR-012) |
| any finding on a `not governing` record | ignored (FR-004) |
| anything else | ignored (FR-013) |

- `records`: each `governing` entry whose id has no broken line, as `Record(corpus, id, title, file)`, `file` the one
  path in `files[id]`. An id with a broken line is left out with all its files, so two records sharing an id
  (`unique-id`) are both left out.
- `notices`: `MatcherNotice(corpus, id, matcher, reason)`, `matcher` = `field` + ` ` + quoted `pattern` (e.g.
  `affects.path "src/**"`), `reason` = adrkit's message; and `FileNotice(corpus, file, reason)`.
- `broken`: `Broken(corpus, subject, rule, message)`, `subject` the id, or the file when adrkit gives no id.

## Governance (per launch)

`decisions.governance(outcomes, org_label) -> Governance`, `org_label` the org corpus's label or `None`:

| Field | Content |
|---|---|
| `corpora` | the labels of the judged corpora, in order |
| `records` | every judgement's records, in corpus order; the same id from two corpora is two records |
| `notices` | every judgement's notices |
| `broken` | every judgement's broken lines |
| `not_checked` | every `NotChecked` |
| `org_corpus` | the org label, or `unset` |

## Refusals

The gate refuses at most once per launch, in this order, after every corpus has its outcome:

| # | Refusal | When | Made with | Blocks when | Text |
|---|---|---|---|---|---|
| 1 | too big | the files number more than `max_review_files` | `hookio.refuse` | the plugin's mode is `enforce` | "The change is too big to review: ..." and its `NotChecked` next step |
| 2 | not checked | `not_checked` non-empty (any cause but 1) | `hookio.block_decision` | `decision_checks` is `enforce`, in both plugin modes | "The decision check could not run:" then each `<corpus>: <reason>` |
| 3 | broken | `broken` non-empty | `hookio.refuse_decision` | the plugin's mode and `decision_checks` are both `enforce` | "The decision check found a record it cannot judge against:" then each `<corpus> <subject>: <message> (<rule>)`, then each corpus's fix |

A corpus's fix (refusal 3): repo corpus, "correct the record in this repo, commit, then <call>"; org corpus, "fix the
org's records at <path> or unset ALQ_ORG_ADR_DIR, then <call>", never containing "commit".

A refusal that blocks opens no round. One that does not is recorded as `would_deny` in `gate.log`, and the launch goes
on to the next row and then opens the round on `Governance` as it stands: the decision reviewer is briefed with
`records` only (nothing not checked or broken is located or briefed), and the result names what was not checked and
what was broken. Refusal 1 that does not block still makes no `adr` call: every corpus is `NotChecked` for it.

## Round arguments and result

`args.decisions`, injected for an internal round, echoed by the workflow as `decisions` in its result:

```json
{
  "corpora": ["dev/alq-review/docs/adr", "org (/home/me/engineering/docs/adr)"],
  "governing": [{"corpus": "dev/alq-review/docs/adr", "id": "0018", "title": "Release a RESHAPE_SPEC lock only by unlock",
                 "file": "/abs/checkout/dev/alq-review/docs/adr/0018-release-a-reshape-spec-lock-only-by-unlock.md"}],
  "notices": [{"corpus": "org (/home/me/engineering/docs/adr)", "id": "0007", "matcher": "affects.package \"core\"",
               "reason": "<adrkit's message>"},
              {"corpus": "dev/alq-review/docs/adr", "file": "dev/alq-review/docs/adr/notes.md",
               "reason": "<adrkit's message>; its status cannot be read"}],
  "broken": [],
  "not_checked": [],
  "org_corpus": "org (/home/me/engineering/docs/adr)"
}
```

- `broken` is `[{corpus, subject, rule, message}]`; `not_checked` is `[{corpus, reason}]`. Each is non-empty only when
  its refusal did not block.
- `org_corpus` is `unset` when the variable is unset or empty.
- `corpora: []` with `not_checked: []` and `org_corpus: "unset"` is "no corpus was found"; `corpora` non-empty with
  `governing: []` is "nothing in those corpora governs this change".

## Round record (ledger, existing)

`expected` gains `alq-review:decision-reviewer` when `records` is non-empty. No other field changes.
