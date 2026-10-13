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

- **Governing**: a record `adr check` lists as governing (FR-004). The plugin reads no record itself.
- **Record**: corpus label, id and title, as `adr check` gives them. The same id in two corpora is two
  records.
- **Broken record**: a record the change touches that `adr check` fails on (FR-008): corpus, file, id, adrkit's rule and message. It is never briefed.
- **Notice**: corpus, id, matcher, adrkit's reason (FR-012).

## Corpus outcome

Each corpus yields exactly one outcome: **judged** (its governing records, notices and broken records), or **not
checked** (the corpus, a cause, and a reason that ends with the next step). A corpus not checked contributes nothing
else. A cause known before any adrkit call (an invalid `ALQ_ORG_ADR_DIR`, a repo corpus not as HEAD) is that
corpus's outcome; `too big` applies only to the corpora still to be checked.

| Cause | When | Next step |
|---|---|---|
| too big | the round's files number more than `max_review_files` (no adrkit call is made) | full round: split the PR; delta round: commit in smaller steps |
| could not run | `ALQ_ORG_ADR_DIR` is not an absolute path to a readable folder | point it at the org corpus, or unset it |
| could not run | a repo corpus holds a file not as HEAD has it | commit or remove those files |
| could not run | `adr` cannot be started, `adr --version` is not the version the plugin is built for, or answers in a shape the plugin cannot read | the install step |
| could not run | adrkit fails in any other way | what adrkit's error says |
| could not run | a call reaches the deadline | the step that spent the time; the reason names each step's seconds |
| could not run | adrkit's marker scan was capped | split the change |

## Refusals

At most one blocks a launch; they are taken in this order. `P` is the plugin's mode, `D` is `decision_checks`.

| # | Refusal | When | Blocks when |
|---|---|---|---|
| 1 | too big | the round's files number more than `max_review_files` | `P` is `enforce` |
| 2 | not checked | a corpus could not run | `D` is `enforce` |
| 3 | broken | a broken record | `P` and `D` are both `enforce` |

Every refusal says the check failed and names the corpus (or file, or command) and a fix that works there (FR-011).
Refusals 1 and 2 give the next step of their cause (§ Corpus outcome). Refusal 3 gives the record's fix, worded as FR-011
states it. A refusal that blocks opens no round and writes nothing to the ledger. One that does not block writes a
`would_deny` line to `gate.log`; the launch takes the next refusal, then opens on what was read.

## Round arguments and result

`args.decisions`, injected for an internal round and echoed by the workflow as `decisions` in its result:

```json
{
  "corpora": ["dev/alq-review/docs/adr", "org (/home/me/engineering/docs/adr)"],
  "governing": [{"corpus": "dev/alq-review/docs/adr", "id": "0018", "title": "Release a RESHAPE_SPEC lock only by unlock"}],
  "notices": [{"corpus": "org (/home/me/engineering/docs/adr)", "id": "0007", "matcher": "affects.package \"core\"",
               "reason": "<adrkit's message>"}],
  "broken": [],
  "not_checked": [],
  "org_corpus": "org (/home/me/engineering/docs/adr)"
}
```

- `not_checked` is `[{corpus, cause, reason}]`; `broken` is `[{corpus, file, id, rule, message}]`. Both are
  non-empty only when their refusal did not block.
- `corpora` lists the judged corpora only.
- Reading it (SC-008):
  - `corpora: []`, `not_checked: []` and `org_corpus: "unset"`: no corpus was found.
  - `governing: []` with `not_checked: []` and `broken: []`: nothing governs the change.
  - `governing: []` with `not_checked` or `broken` non-empty: nothing among the records that were judged governs it.

## Round record (ledger, existing)

`expected` gains `alq-review:decision-reviewer` when any record governs the change. No other field changes.
