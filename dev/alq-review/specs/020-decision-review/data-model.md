# Data model: the internal review round checks the diff against the decisions that govern it

Nothing is stored. Every shape lives for one launch and leaves the gate only as `args.decisions`. How adrkit is
called and how its answer is read is implementation, settled by the code PR's tests (research R4, R5).

## Corpus

| | Repo corpus | Org corpus |
|---|---|---|
| Found by | every tracked `docs/adr` folder, at any depth | `ALQ_ORG_ADR_DIR`; unset or empty means no org corpus |
| Label | its path from the repo root, e.g. `dev/alq-review/docs/adr` | `org (<value of ALQ_ORG_ADR_DIR>)` |

An org path that is also a repo corpus is checked once, as the org corpus.

## Records

- **Governing**: status `accepted`, or a status adrkit cannot read (FR-004). One rule classifies a record and a
  skipped file alike: `accepted`, not governing (any other status adrkit knows), or unreadable.
- **Record**: corpus label, id, title, and the record's file as an absolute path. The same id in two corpora is two
  records.
- **Broken record**: corpus, file, id when adrkit gives one, adrkit's rule and message (FR-008). It is never briefed.
- **Notice**: for a matcher (corpus, id, matcher, adrkit's reason) or for a skipped file (corpus, file, reason) (FR-012).

## Corpus outcome

Each corpus yields exactly one outcome: **judged** (its governing records, notices and broken records), or **not
checked** (a cause and a reason that ends with the next step). A corpus not checked contributes nothing else.

| Cause | When | Next step |
|---|---|---|
| too big | the round's files number more than `max_review_files` (no adrkit call is made) | full round: split the PR; delta round: commit in smaller steps |
| could not run | `ALQ_ORG_ADR_DIR` is not an absolute path to a readable folder | point it at the org corpus, or unset it |
| could not run | a repo corpus holds a file not as HEAD has it | commit or remove those files |
| could not run | adrkit cannot be started, is not the version the plugin is built for, or answers in a shape the plugin cannot read | the install step |
| could not run | adrkit fails in any other way | what adrkit's error says |
| could not run | a call reaches the deadline | the step that spent the time; the reason names each step's seconds |
| could not run | adrkit's marker scan was capped | split the change |
| could not run | a changed regular file cannot be read | make it readable |

## Refusals

At most one blocks a launch; they are taken in this order. `P` is the plugin's mode, `D` is `decision_checks`.

| # | Refusal | When | Blocks when |
|---|---|---|---|
| 1 | too big | the round's files number more than `max_review_files` | `P` is `enforce` |
| 2 | not checked | a corpus could not run | `D` is `enforce` |
| 3 | broken | a broken record | `P` and `D` are both `enforce` |

Every refusal says the check failed and names the corpus (or file, or command) and a fix that works there (FR-011).
Refusals 1 and 2 give the next step of their cause (§ Corpus outcome). Refusal 3 gives the record's fix: for a repo
corpus, correct the record in this repo, commit and launch again; for the org corpus, fix the org's records or unset
`ALQ_ORG_ADR_DIR`, never "commit". No org refusal says "commit". A refusal that does not block writes a `would_deny` line to `gate.log`, and
the round opens on what was read.

## Round arguments and result

`args.decisions`, injected for an internal round and echoed by the workflow as `decisions` in its result:

```json
{
  "corpora": ["dev/alq-review/docs/adr", "org (/home/me/engineering/docs/adr)"],
  "governing": [{"corpus": "dev/alq-review/docs/adr", "id": "0018", "title": "Release a RESHAPE_SPEC lock only by unlock",
                 "file": "/abs/checkout/dev/alq-review/docs/adr/0018-release-a-reshape-spec-lock-only-by-unlock.md"}],
  "notices": [{"corpus": "org (/home/me/engineering/docs/adr)", "id": "0007", "matcher": "affects.package \"core\"",
               "reason": "<adrkit's message>"}],
  "broken": [],
  "not_checked": [],
  "org_corpus": "org (/home/me/engineering/docs/adr)"
}
```

- `broken` and `not_checked` are non-empty only when their refusal did not block.
- `corpora` lists the judged corpora only.
- Reading it (SC-008): `corpora: []`, `not_checked: []` and `org_corpus: "unset"` means no corpus was found;
  `governing: []` with `not_checked: []` means nothing governs the change; `governing: []` with `not_checked`
  non-empty means nothing in the judged corpora governs it.

## Round record (ledger, existing)

`expected` gains `alq-review:decision-reviewer` when any record governs the change. No other field changes.
