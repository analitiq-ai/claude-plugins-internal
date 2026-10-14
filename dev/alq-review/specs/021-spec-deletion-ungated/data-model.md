# Data model: A PR labelled cleanup gets no alq-review gating

No ledger field and no new state file. Shapes below are what the code passes; GitHub's are GitHub's.

## Cleanup (fact passed to the rules)

| Value | Meaning | From |
|---|---|---|
| `LABELLED` | the PR carries `cleanup` | `is_cleanup` true |
| `NOT_LABELLED` | it does not, or the branch has no open PR | `is_cleanup` false; `pr_target` None |
| `unread(why)` | GitHub did not answer; gated as `NOT_LABELLED`, and the ready/merge refusal names `why` | `RuntimeError` from a reader; a `labels` field that is not a list of `{name: str}` |

Decided by `github.is_cleanup(labels: list[str]) -> bool` only (R1). Never stored: read at each ready, merge, commit
and poller run (spec Edge Cases).

## Poller outcome on a cleanup PR

| Exit | When | Hand-over to the gate |
|---|---|---|
| `5` CLEANUP | settled, no non-ignored check failing | none |
| `4` BLOCKED | settled, a non-ignored check failing | none |
| `3` TIMEOUT | a check still running at the deadline | none |
| `1` ERROR | as today | none |

Settled for a cleanup PR: no non-gate, non-ignored check running, and `mergeStateStatus` is not `UNKNOWN`.

## Transitions

Unlabelled → cleanup: the user adds the label on GitHub.
Cleanup → unlabelled: the label is removed, by anyone. Pushes change nothing (FR-001).
