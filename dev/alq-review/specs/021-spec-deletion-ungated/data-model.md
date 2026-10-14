# Data model: A PR labelled cleanup gets no alq-review gating

No ledger field and no new state file. Shapes below are what the code passes; GitHub's are GitHub's.

## Cleanup (fact passed to the rules)

`github.Cleanup`, one of:

| Value | Meaning | From |
|---|---|---|
| `Cleanup(labelled=True)` | the PR carries `cleanup` | `is_cleanup` true for the PR's labels |
| `Cleanup()` | it does not, or the branch has no open PR | `is_cleanup` false; no open PR |
| `Cleanup(unread=why)` | GitHub did not answer; gated as not labelled (step 3 of each row below) | `RuntimeError` from a reader: gh failed, timed out or gave no JSON, or `label_names` rejected the `labels` field |

Built only by `github.read_cleanup(labels_of)`, which every consumer calls, the CLI's `main` included; it catches
`RuntimeError` only, so any other error propagates. Labelled and unread at once is refused at construction.
`branch_labels` reads the first open PR gh lists, as `pr_target` does (spec Clarifications). Names come only from
`github.label_names`; the name test is `github.is_cleanup`. Never stored: read at each ready, merge, commit and
poller run (spec Edge Cases).

## Decisions per consumer

The one statement of how each consumer decides. research.md, contracts/interfaces.md and tasks.md cite these rows
and do not restate them. Each row is taken step by step; the first step that answers decides.

| Row | Consumer and its fact | 1. Holds the label keeps (own refusal, no cleanup sentence) | 2. Allowed | 3. Unread | 4. Otherwise |
|---|---|---|---|---|---|
| **D1** | `policy.mark_ready` (`gate.py`, `gh pr ready`); fact from `gate.cleanup_of(repo, pr, branch)`: the PR named via `pr_labels`, else the branch's open PR via `branch_labels` | `_obstacle`: a round in flight, a lock | a release, a settled round (clean or CONVERGED_PUSHBACK) at the head, or labelled | `cleanup.refusal()` alone | today's not-ready refusal + `CLEANUP_EXEMPTION` |
| **D2** | `policy.attest` (`gate.py`, a comment carrying the attestation marker, kind `attest`); takes no fact (FR-011) | `_obstacle` | a release or a settled round at the head | — (no label is read) | its own refusal, naming the clean internal round only; no `CLEANUP_EXEMPTION`, no `gh pr ready` |
| **D3** | `pre_merge_gate.unmet` (`gh pr merge`, `gh pr ready`); fact from `read_cleanup` over `label_names` of the `labels` field `fetch` already reads | `--admin` without `override-merge`; no head commit. (`gh pr ready` on a PR already published is not gated, as today.) | attested at the head, released, or labelled | `cleanup.refusal()` alone | `how_to_attest` + `CLEANUP_EXEMPTION` |
| **D4** | commit path (`gate.on_bash`, `git commit`); fact from `cleanup_of(where.slug, None, where.branch)`, asked only when `worktree.locate` found a checkout | `policy.mutation` (a lock, a round in flight) still runs after claim and shim, labelled or not | labelled: `claimgate.on_commit` and `shimgate.on_commit` are skipped | both run as today, no note (FR-012) | both run as today; no checkout located → both run as today, no label read |
| **D5** | poller (`poll-pr-review.sh`); fact from `github.py cleanup <repo> <pr>` (`main` → `read_cleanup` over `pr_labels`). Only exit 0 with exactly `cleanup` or `gated` is a read | — (the poller holds nothing) | labelled: cleanup mode, below | `WARNING: the cleanup label of <repo>#<pr> could not be read (<why>); polling it as unlabelled.`, then as today | `gated`: as today |

### D5 cleanup mode

Today's clean test with only its Codex and thread terms removed; everything else, `mergeStateStatus` included, is kept.

| Exit | When | Hand-over to the gate |
|---|---|---|
| — wait | a non-gate, non-ignored check runs, or `mergeStateStatus` is `UNKNOWN` | none |
| `5` CLEANUP | `mergeStateStatus` is `CLEAN`, or `UNSTABLE` with every non-passing check ignored (today's merge-state term) | none |
| `4` BLOCKED | any other `mergeStateStatus` (`BLOCKED`, `DIRTY`, `BEHIND`, …) or a non-ignored check failing, with today's reasons (`GitHub reports mergeStateStatus=X`, the failing checks) | none |
| `3` TIMEOUT | still waiting at the deadline | none |
| `1` ERROR | as today | none |

No draft shortcut, no Codex request or wait, no gate lag, no thread reported as a finding, no `@codex review`.

### Test matrix

Every row is tested for each fact it can get, labelled, unlabelled, unread, and no PR (D4 also no checkout), and
for each hold its step 1 keeps. Every `gh` fake answers `labels` as JSON (`[]` unless a case sets it), so the
existing cases take the unlabelled path (SC-003).

## Transitions

Unlabelled → cleanup: the user adds the label on GitHub.
Cleanup → unlabelled: the label is removed, by anyone. Pushes change nothing (FR-001).
