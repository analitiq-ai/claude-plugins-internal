# Data model: A PR labelled cleanup gets no alq-review gating

No ledger field and no new state file. Shapes below are what the code passes; GitHub's are GitHub's.

## Cleanup (fact passed to the rules)

`github.Cleanup`, one of:

| Value | Meaning | From |
|---|---|---|
| `Cleanup(labelled=True)` | the PR carries `cleanup` | `is_cleanup` true for the PR's labels |
| `Cleanup()` | it does not, or the branch has no open PR | `is_cleanup` false; no open PR |
| `Cleanup(unread=why)` | GitHub did not answer; gated as not labelled, and the ready/merge refusal is `refusal()` alone when nothing else lets the PR through | `RuntimeError` from a reader: gh failed, timed out or gave no JSON, `label_names` rejected the `labels` field, or gh gave a branch more than one open PR |

Built only by `github.read_cleanup(labels_of)`, which every consumer calls, the CLI's `main` included; it catches
`RuntimeError` only, so any other error propagates. Labelled and unread at once is refused at construction.
A branch is merged through one PR (git workflow), so `branch_labels` reads that one. Names come
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
