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
  - `RuntimeError` in gh's words when gh fails or times out, its answer is not JSON, or its `labels` field is
    not a list of objects with a string `name`.

The label is read at each ready, merge, commit and poller run. It is never stored.

## What each consumer does

| Consumer | Reads | Labelled | Read failed |
|---|---|---|---|
| `gate.on_bash`, kind `ready`: `gh pr ready`, and `gh pr create` without `--draft` (Clarification 2026-10-15) | `cleanup(event.repo, pr=action.pr or event.pr, branch=event.branch)`, read only when `released` is false, so the ready path makes at most one gh call more than today | `policy.mark_ready` gets `released=True`, as for a version-only release. `_obstacle` (a round in flight, a lock) still refuses first, as today | not labelled: a clean round still allows it as today; a refusal ends with `The cleanup label could not be read (<why>).` |
| `gate.on_bash`, kind `attest`: a comment carrying the attestation marker, which `shell.py` classed as `ready` until now | nothing | — | — |
| `pre_merge_gate.unmet`: `gh pr merge`, and `gh pr ready` on a draft | `fetch` adds `labels` to its `--json` fields; `is_cleanup(pr["labels"])` | allowed after the `--admin` and head-commit checks, beside `attested` and `released` | cannot happen on its own: a failed `fetch` already refuses |
| `gate.on_bash`, `git commit` | `worktree.locate` first, then `cleanup(where.slug, branch=where.branch)`. With no checkout located, nothing is read | `claimgate.on_commit` and `shimgate.on_commit` are not called. `policy.mutation` runs as today | both checks run as today, each refusing for its own cause |
| `poll-pr-review.sh` | once before the first poll: `python3 scripts/github.py cleanup <repo> <pr>` | cleanup mode, below | anything but exit 0 with stdout `cleanup` or `gated`: stderr `WARNING: the cleanup label of <repo>#<pr> could not be read (<stderr>); polling it as unlabelled.`, then today's poll |

`attest` goes to `policy.mark_ready` with today's `released` only. The label does not stand in for an
attestation (FR-011), so an attestation comment is refused as today when the head has no settled round.

## Poller cleanup mode

On a cleanup PR the poller does what it does on any PR (snapshot, Codex reader, check classification,
`--ignore-check`, threads, findings, errors, the draft shortcut, the merge-state term, the `Gate check runs:`
lines, the hand-over to the gate's inbox, the deadline, every exit code), with these differences only. `ANALYZE`,
`WAITING_ON` and `REPORT` get `--argjson cleanup true`; a PR whose label was not read gets `false`.

- `WAITING_ON` has no Codex line, so the poller never waits for a Codex answer (FR-008).
- `$blocked_by` has no Codex term.
- `gate_lags` is false, so no pr-gate sweep is dispatched.
- `REPORT` prints `Codex: not waited on (cleanup PR)` in place of every Codex line it prints today (the state
  line, the `@codex review` instruction for a superseded review, the unknown-reply lines, the missing
  `codex-review` warning, the thumbs line and the Codex comments since the trigger).
- The first poll prints `Cleanup PR: <repo>#<pr> carries the cleanup label; Codex is not waited on.` in place of
  the line about a missing `@codex review` comment.

The Codex reader still runs, and its failure and its errors still exit `1`: Codex can review a cleanup PR
unasked, and its threads are triaged as on any PR (Clarification 2026-10-15, rulesets).

| Exit on a cleanup PR | Means | The skill's next step |
|---|---|---|
| `0` CLEAN | GitHub reports it mergeable; no check fails; no thread is unresolved | merge the PR. No `deepsource-pr-gate.sh` |
| `2` FINDINGS | a check fails or a thread is unresolved | as on any PR: fix a failing CI check; triage the threads with `assess-round`. A failing gate run (`codex-review`, `internal-review`): the org pr-gate holds the PR, which this feature does not lift (FR-005); tell the user |
| `4` BLOCKED | the merge state is not clean | `mergeStateStatus=DRAFT`: mark the PR ready, then run the poller again. Otherwise as today |
| `3` TIMEOUT, `1` error | as today | as today |

In both modes, a failure the poller does not handle itself exits `1`: `set -E` with an `ERR` trap that exits `1`.
An `ERR` trap does not fire for a command substitution inside an `if` or `[ ]` test, so every jq read the loop
tests (`.findings`, `.clean`, `.errors | length`, `.trigger_found`, `.gate_lags`, the ignore list's length) is
first assigned to a variable, then tested.
