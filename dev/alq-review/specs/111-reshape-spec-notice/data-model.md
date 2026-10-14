# Data Model: RESHAPE_SPEC notice

All state lives in the PR's ledger document (`ledger.db`, `ledgers (repo, pr) -> doc`). No table changes.

## Round (existing) — new key `notice`

Set only on a round whose assessment's `round_verdict` is `RESHAPE_SPEC`, on a PR whose `spec` is a folder. It is
absent on every other round, and its absence means "no notice was owed".

```json
"notice": {
  "issue": 123,
  "comment": null | {"done": true} | {"error": "<gh's message>"},
  "edit":    null | {"done": true} | {"error": "<gh's message, or the escalate_to config error>"}
}
```

| Field | Meaning |
|---|---|
| `issue` | `reshape.issue_of(state["spec"])`, or `null` when the folder name gives none. With `null`, both outcomes are stored as `{"error": "spec folder <path> names no issue"}` at claim time and no call is made. |
| `comment`, `edit` | `null` from the claim until the outcome is stored. If it is still `null` later, the hook ended before storing GitHub's answer. |

### Transitions (R4)

1. Absent → `{issue, comment: null, edit: null}`: `ledger.claim_notice`, in the same transaction as
   `ledger.record_assessment`.
2. → each call's outcome set: `ledger.record_notice`, in a second transaction after both calls.
3. Nothing changes it after that. `unlock` does not read or clear it, and a later `RESHAPE_SPEC` round gets its own
   `notice` (spec US2 scenario 4).

### Validation

- `claim_notice` returns the new notice, or `None` when the round already has one (a repeated PostToolUse delivery).
  The gate makes a call only for a notice it has just claimed.
- `record_notice` raises `LedgerError` if the round has no `notice`, or if an outcome is already set.

## Config (existing file) — new key `escalate_to`

`plugins/alq-review/config.json`: `"escalate_to": "Analitiq-Bot-Wonka"`, a non-blank string with no default.
It is read by `hookio.escalate_to()`, which raises `ValueError` when the key is missing, not a string, or blank.

## Workflow args / result (see contracts/)

- `spec_folder: string | null`: injected into review-round and assess-round args, forwarded by review-round, and
  returned by assess-round.

## Derived (not stored)

- **Reshape summary**: `reshape.summary(folder, assessment)`.
- **Comment body**: `reshape.comment(folder, assessment, pr, rnd)`.
- **Failure text**: `reshape.notice_failures(rnd)`.
