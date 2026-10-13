# Data model: the internal review round checks the diff against the decisions that govern it

Nothing here is stored. Every shape lives for one launch, in `decisions.py` as frozen dataclasses, and leaves the gate
only as the injected `args.decisions` (last section).

## Corpus

| Field | Repo corpus | Org corpus |
|---|---|---|
| `label` | path from the repo root, e.g. `dev/alq-review/docs/adr` | `org (<absolute path>)` |
| `dir` | the same path, given to `--dir` relative to the checkout | the absolute path, given to `--dir` |
| `kind` | `repo` | `org` |

- Repo corpora: each distinct parent of a tracked path under a `docs/adr` segment pair, sorted. No tracked file, no
  corpus.
- Org corpus: `ALQ_ORG_ADR_DIR`, when set and non-empty. Empty counts as unset. It must be absolute and a readable
  folder, else the launch is refused (FR-010). When its resolved path equals a repo corpus's, that corpus is checked
  once, as the org corpus.
- A record is named `<label> <id>` everywhere: brief, notice, refusal, result.

## Finding (adrkit's, as read)

`rule: str`, `severity: str`, `message: str`, and optionally `path: str`, `id: str`, `field: str`, `pattern: str`.
From `lint --json` `findings[]` and `check --json` `findings[]`; any entry of another shape makes the corpus unreadable
(R5). `source` is `lint` or `check`, so the notice rule is read from `check` only.

## Corpus report (what `adrkit.py` hands to `decisions.judge`)

| Field | Source |
|---|---|
| `corpus` | the Corpus |
| `findings` | lint's and check's, each tagged with its source |
| `governing` | check's `governing[]`: `(recordId, title)`; the file is located as `<dir>/<id>-*.md` only after judging, since two files for one id is adrkit's `unique-id` error and refused as broken first |
| `statuses` | `path -> status string or None`, for every path a finding names, resolved against the checkout root (adrkit names paths relative to where it ran, e.g. `../../engineering/docs/adr/0007-x.md`): the `status:` scalar of the file's frontmatter, None when the line or the file cannot be read |
| `unreadable_regular` | the paths of `markerScan.unreadablePaths` that `lstat` reports as regular files |

## Record status

| Status read | Governing? |
|---|---|
| `draft`, `proposed`, `rejected`, `superseded`, `deprecated` | no |
| `accepted` | yes |
| any other value, no `status:` line, file unreadable | yes (adrkit cannot read it; its `error` finding must refuse, FR-004) |

A finding with no `path` has no record; it is judged by its rule alone.

## Judgement (per corpus, pure)

| Finding | Governing record? | Outcome |
|---|---|---|
| no `path`, rule `marker-scan-capped` or `marker-declarations-capped` | n/a | **failed** (FR-009) |
| no `path`, any other rule | n/a | ignored |
| rule `corpus-file-skipped`, the skipped file's status `accepted` | n/a (not loaded) | **broken** (FR-008) |
| rule `corpus-file-skipped`, no status that can be read | n/a | **notice** naming the file (FR-012) |
| rule `corpus-file-skipped`, any other status | n/a | ignored |
| severity `error` (including `unique-id`, two records with one id) | yes | **broken** (FR-008) |
| rule `affects-bad-pattern` or `affects-unknown-type` | yes | **broken** (FR-008) |
| rule `affects-unresolvable` or `affects-repo-not-applicable`, source `check` | yes | **notice** (FR-012) |
| any of the above | no | ignored (FR-004) |
| anything else | any | ignored (FR-013) |
| path in `unreadable_regular` | n/a | **failed** (FR-009) |

`Judgement(corpus, records, notices, broken, failed)`: `records` are the governing entries as records
`(corpus, id, title, file)`; `notices` are `(corpus, id, matcher, reason)` with `matcher` = `field` + `pattern`
(e.g. `affects.path "src/**"`) and `reason` = adrkit's message; `broken` and `failed` are lines `<corpus> <id or path>:
<message> (<rule>)`.

## Governance (per launch)

| Field | Content |
|---|---|
| `corpora` | the labels checked, in order |
| `records` | every judgement's records, in corpus order; two corpora may hold the same id |
| `notices` | every judgement's notices |
| `broken` | every judgement's broken lines, with each corpus's fix |
| `failed` | every judgement's failed lines, with each corpus's fix |
| `org_corpus` | the org label, or `unset` |
| `not_checked` | `(corpus, reason)` for each corpus that could not be checked, when `decision_checks` is `log` |

`adrkit.Unavailable` (a corpus that could not be checked at all, FR-010) is raised, not a field: it carries the corpus,
the call, what happened and the next step.

## Refusal kinds

| Kind | Trigger | Made with | Mode |
|---|---|---|---|
| too big | the round's files number more than `max_review_files` | `hookio.refuse` | `log`: would-deny |
| could not run | `adr` missing while a corpus is to be checked; `ALQ_ORG_ADR_DIR` not an absolute readable folder; a call exits other than 0/1, prints no JSON object, answers in another shape, or reaches the deadline | `hookio.block` | refuses in both plugin modes; `decision_checks: log`: would-deny, the corpus listed in `not_checked` |
| failed | `Governance.failed` non-empty | `hookio.block` | as could not run |
| broken | `Governance.broken` non-empty, nothing failed | `hookio.refuse` | refuses only when the plugin's mode and `decision_checks` both enforce; else would-deny, the round opens with `records` |

## Round arguments and result

`args.decisions`, injected for an internal round, echoed by the workflow as `decisions` in its result:

```json
{
  "corpora": ["dev/alq-review/docs/adr", "org (/home/me/engineering/docs/adr)"],
  "governing": [{"corpus": "dev/alq-review/docs/adr", "id": "0018", "title": "Release a RESHAPE_SPEC lock only by unlock",
                 "file": "/abs/checkout/dev/alq-review/docs/adr/0018-release-a-reshape-spec-lock-only-by-unlock.md"}],
  "notices": [{"corpus": "org (/home/me/engineering/docs/adr)", "id": "0007", "matcher": "affects.path \"src/**\"",
               "reason": "path matcher \"src/**\" is qualified with repo \"engine\" and cannot apply in a single-repository corpus; it was skipped, and is kept for a federation that includes that repository."}],
  "org_corpus": "org (/home/me/engineering/docs/adr)",
  "not_checked": []
}
```

`org_corpus` is the string `unset` when the variable is unset or empty. `not_checked` is `[{corpus, reason}...]`, non-empty only with `decision_checks: log` (R15). `corpora: []` with `org_corpus: "unset"` is
"no corpus was checked"; `corpora` non-empty with `governing: []` is "nothing governs this change".

## Round record (ledger, existing)

`expected` gains `alq-review:decision-reviewer` when `governing` is non-empty. No other field changes.
