# Data model: A PR labelled cleanup gets no alq-review gating

No ledger field, no new state file and no new type. GitHub's shapes are GitHub's.

## The label

- `github.CLEANUP_LABEL = "cleanup"`.
- `github.is_cleanup(labels) -> bool`: true when an entry of gh's `labels` field (`[{name, ...}]`) is named
  `cleanup`, without case, as GitHub matches label names. The one name test (FR-002).
- `github.cleanup(slug, *, pr=None, branch=None) -> bool`: the one reader, through `_answer` (20 s), then
  `is_cleanup`.
  - With `pr`: `gh pr view <pr> --repo <slug> --json labels`.
  - Else with `branch`: `gh pr list --repo <slug> --head <branch> --state open --json labels`. It reads the first
    PR listed, as `pr_target` does (Clarification Q7). A branch with no open PR is not labelled.
  - `RuntimeError` in gh's words when gh fails or times out, or its answer is not JSON.

The label is read at each ready, merge, commit and poller run. It is never stored.

## What each consumer does

| Consumer | Reads | Labelled | Read failed |
|---|---|---|---|
| `gate.on_bash`, kind `ready`: `gh pr ready`, and `gh pr create` without `--draft` (Clarification 2026-10-15) | `cleanup(event.repo, pr=action.pr or event.pr, branch=event.branch)` | `policy.mark_ready` gets `released=True`, as for a version-only release. `_obstacle` (a round in flight, a lock) still refuses first, as today | not labelled; the refusal, if any, ends with `The cleanup label could not be read (<why>).` |
| `gate.on_bash`, kind `attest`: a comment carrying the attestation marker, which `shell.py` classed as `ready` until now | nothing | — | — |
| `pre_merge_gate.unmet`: `gh pr merge`, and `gh pr ready` on a draft | `fetch` adds `labels` to its `--json` fields; `is_cleanup(pr["labels"])` | allowed after the `--admin` and head-commit checks, beside `attested` and `released` | cannot happen on its own: a failed `fetch` already refuses |
| `gate.on_bash`, `git commit` | `worktree.locate` first, then `cleanup(where.slug, branch=where.branch)`. With no checkout located, nothing is read | `claimgate.on_commit` and `shimgate.on_commit` are not called. `policy.mutation` runs as today | both checks run as today |
| `poll-pr-review.sh` | once before the first poll: `python3 scripts/github.py cleanup <repo> <pr>` | cleanup mode, below | anything but exit 0 with stdout `cleanup` or `gated`: stderr `WARNING: the cleanup label of <repo>#<pr> could not be read (<stderr>); polling it as unlabelled.`, then today's poll |

`attest` goes to `policy.mark_ready` with today's `released` only. The label does not stand in for an
attestation (FR-011), so an attestation comment is refused as today when the head has no settled round.

## Poller cleanup mode

Today's loop, snapshot, report and exit codes. `ANALYZE`, `WAITING_ON` and `REPORT` get `--argjson cleanup true`.
In cleanup mode, these are switched off:

- **Codex.** There is no Codex term in `WAITING_ON` or in `$blocked_by`. `gate_lags` is false, so no sweep is
  dispatched. The report prints `Codex: not asked (cleanup PR)` in place of its Codex lines, and none of the
  superseded, declined, missing-`codex-review`, thumbs and Codex-comment lines.
- **Threads.** `threads` is empty, so `findings` counts failing checks only.
- **Errors.** Only the overflow of status check contexts counts. Overflows of reviews, comments, reactions and
  threads, the CodeRabbit parse error and the Codex reader's errors do not.
- **Hand-over.** `settle` hands nothing to the gate's inbox.

These stay as today: the check classification (gate runs, `--ignore-check`), the wait on running checks and on
`UNKNOWN`, the draft shortcut, the merge-state term of `$blocked_by`, the `Gate check runs:` lines, and the
deadline.

Before the first poll it prints `Cleanup PR: <repo>#<pr> carries the cleanup label; Codex is not asked and review
threads do not block.`

| Exit on a cleanup PR | Means | The skill's next step |
|---|---|---|
| `0` CLEAN | GitHub reports it mergeable; no check fails | merge the PR. No `deepsource-pr-gate.sh` |
| `2` FINDINGS | a check fails; the report lists it | A CI check: fix it, push, run the poller again. A gate run (`codex-review`, `internal-review`): the org pr-gate holds the PR, which this feature does not lift (FR-005). Tell the user |
| `4` BLOCKED | the merge state is not clean | `mergeStateStatus=DRAFT`: mark the PR ready, then run the poller again. Otherwise act on the gate runs and the merge state the report prints |
| `3` TIMEOUT, `1` error | as today | as today |

In both modes, a failure the poller does not handle itself exits `1`: `set -E` with an `ERR` trap that exits `1`.
A jq or gh failure then never exits with a code the poller gives a meaning to.
