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

## Label-adding command (recognised, not stored)

| Form | PR resolved by | Answer |
|---|---|---|
| `gh pr edit [ref] --add-label …cleanup…` | `fetch(ref, -R)` → `name_of` | refused |
| `gh issue edit N --add-label …cleanup…` | `fetch(N, -R)` | refused; not gated when `fetch` says N is not a PR |
| `gh api` write to `repos/O/R/issues/N/labels` or `repos/O/R/issues/N` with `cleanup` in fields / `--input` | `fetch(N)` from the endpoint | refused; not gated when `fetch` says N is not a PR |
| `gh pr create --label/-l …cleanup…` | none: no number yet | refused |
| `gh api graphql` naming `addLabelsToLabelable` or `labelIds` | none: label is an id | refused |
| any form above, `fetch` fails otherwise | none | refused, naming why |
| unparseable, text matches a form above | none | refused |
| `--remove-label`, `gh issue/pr` without `cleanup` | n/a | not gated |

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
Cleanup → unlabelled: the label is removed, by anyone; never refused. Pushes change nothing (FR-001).
