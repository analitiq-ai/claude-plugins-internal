# Data model: A PR labelled cleanup gets no alq-review gating

No ledger field and no new state file. Shapes below are what the code passes; GitHub's are GitHub's.

## Cleanup (fact passed to the rules)

`github.Cleanup`, one of:

| Value | Meaning | From |
|---|---|---|
| `Cleanup(labelled=True)` | the PR carries `cleanup` | there is a PR and `is_cleanup` is true for each |
| `Cleanup()` | it does not, or the branch has no open PR | `is_cleanup` false; no open PR |
| `Cleanup(unread=why)` | GitHub did not answer; gated as not labelled, and the ready/merge refusal is `refusal()` alone | `RuntimeError` from a reader; a `labels` field `label_names` rejects |

Built only by `github.read_cleanup(labels_of)`; labelled and unread at once is refused at construction. Names come
only from `github.label_names`; the name test is `github.is_cleanup` (R1). Never stored: read at each ready, merge,
commit and poller run (spec Edge Cases).

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
