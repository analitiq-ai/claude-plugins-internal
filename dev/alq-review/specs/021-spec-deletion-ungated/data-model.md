# Data model: A PR labelled cleanup gets no alq-review gating

No ledger field and no new state file. Shapes below are what the code passes; GitHub's are GitHub's.

## Cleanup (fact passed to the rules)

`github.Cleanup`, one of:

| Value | Meaning | From |
|---|---|---|
| `Cleanup(labelled=True)` | the PR carries `cleanup` | `is_cleanup` true for the PR's labels |
| `Cleanup()` | it does not, or the branch has no open PR | `is_cleanup` false; no open PR |
| `Cleanup(unread=why)` | the label was not read; gated as not labelled | `RuntimeError` from a reader: gh failed, timed out or gave no JSON, or `label_names` rejected the `labels` field |

Built only by `github.read_cleanup(labels_of)`, which every consumer calls, the CLI's `main` included; it catches
`RuntimeError` only, so any other error propagates. Labelled and unread at once is refused at construction.
`pr_labels` and `branch_labels` both take their names from `github.label_names`, which raises `RuntimeError` on a
`labels` field that is missing or not a list of `{name: str}`. `branch_labels` reads the first open PR gh lists, as
`pr_target` does (spec Clarifications). The name test is `github.is_cleanup`. Never stored: read at each ready,
merge, commit and poller run (spec Edge Cases).

`Cleanup.refusal()` is the one unread refusal (ADR-0009 point 3, FR-007):
"The cleanup label of this PR could not be read (<why>). This refusal is about the label, not about a missing
review. Next step: if gh failed or timed out, run `gh auth status` and retry; otherwise go on as for an unlabelled
PR: a clean internal round at the head, attested on the PR."

`CLEANUP_EXEMPTION` (R8): "To exempt this PR from review, the user adds the `cleanup` label to it on GitHub; an agent
does not."

## Decisions per consumer

The one statement of how each consumer decides and what each outcome says. research.md, contracts/interfaces.md
and tasks.md cite these cells and do not restate them. Each row is taken step by step; the first step that answers
decides. "Today's" means the text the function returns at `fabc417`.

| Row | Consumer; entry routes → fact | 1. Holds the label keeps | 2. Allowed | 3. Unread | 4. Otherwise |
|---|---|---|---|---|---|
| **D1** | `policy.mark_ready` (`gate.py`). `gh pr ready`: `gate.cleanup_of(repo, pr, branch)`, the PR the ledger names via `pr_labels`, else the branch's open PR via `branch_labels`. `gh pr create` without `--draft`: no PR exists, so no label is read and the fact is `None` | `_obstacle` (a round in flight, a lock): today's refusal, no `CLEANUP_EXEMPTION` | a release; a settled round (clean or CONVERGED_PUSHBACK) at the head; labelled | `cleanup.refusal()` alone | today's refusal + `CLEANUP_EXEMPTION`; fact `None`: today's refusal alone |
| **D2** | `policy.attest` (`gate.py`). A `gh pr comment`, `gh issue comment` or `gh api` write carrying the attestation marker, kind `attest`; no fact (FR-011) | `_obstacle`: today's refusal | a release; a settled round at the head | — | its own refusal: the internal review has not come back clean at the head; next step: today's review call. It names neither `gh pr ready` nor `CLEANUP_EXEMPTION`. Labelled or not |
| **D3** | `pre_merge_gate.unmet`. `gh pr merge`, and `gh pr ready` on a draft; fact from `read_cleanup` over `label_names` of the `labels` field `fetch` already reads | `--admin` without `override-merge`; no head commit: today's refusals | attested at the head; released; labelled | `cleanup.refusal()` alone | `how_to_attest` + `CLEANUP_EXEMPTION` |
| **D4** | `gate.on_bash`, `git commit`. Checkout located by `worktree.locate`: `cleanup_of(where.slug, None, where.branch)`. None located: no label is read | — | labelled: `claimgate.on_commit` and `shimgate.on_commit` are not called | both run as today, no note (FR-012) | both run as today. In every column `policy.mutation` (a lock, a round in flight) then runs as today |
| **D5** | `poll-pr-review.sh`, once before the first poll: `github.py cleanup <repo> <pr>` (`main` → `read_cleanup` over `pr_labels`). Only exit 0 with stdout exactly `cleanup` or `gated` is a read | — | `cleanup`: § D5 cleanup mode | any other result: stderr `WARNING: the cleanup label of <repo>#<pr> could not be read (<why>); polling it as unlabelled.`, then as today | `gated`: as today |

### D5 cleanup mode

The poller's states are taken in this order; the first that holds decides. Threads never count: `.findings` is
not consulted, so `settle()`'s findings branch and `hand_over` are never reached, and no exit writes an inbox file.
The `Cleanup PR: <repo>#<pr> carries the cleanup label; no Codex, no internal review, no triage.` line is printed
once, before the first poll.

| State | Exit | Last stdout line |
|---|---|---|
| a non-gate, non-ignored check runs, or `mergeStateStatus` is `UNKNOWN` | wait | today's waiting lines |
| a non-ignored check fails | `4` | `BLOCKED: <the failing checks>. Fix them and push; then run the poller again.` |
| `mergeStateStatus` is `DRAFT` | `5` | `CLEANUP: no check is failing and the PR is a draft. Next step: gh pr ready <pr>, then run the poller again.` |
| `CLEAN`, or `UNSTABLE` with every non-passing check ignored | `5` | `CLEANUP: GitHub reports the PR mergeable and no check is failing. Next step: gh pr merge <pr>.` |
| any other `mergeStateStatus` (`BLOCKED`, `DIRTY`, `BEHIND`, …) | `4` | `BLOCKED: GitHub reports mergeStateStatus=<X>. Act on it on GitHub; then run the poller again.` |
| still waiting at the deadline | `3` | as today |
| the poller fails | `1` | as today |

No Codex request or wait, no gate lag, no `@codex review`, no DeepSource grade.

### Test matrix

Cases are enumerated as row × entry route × fact × outcome cell, each case asserting the cell's whole outcome:
decision, text (or exit and last stdout line), and for D5 that no inbox file is written.

- **Facts.** D1 `gh pr ready`, D3 and D5: labelled, unlabelled, unread, no PR. D1 `gh pr create`: `None`. D4:
  labelled, unlabelled, unread, no open PR, no checkout located. D2 takes no fact, so it is run through
  `gate.on_bash` on a PR whose label read answers `cleanup`, and on one that answers `[]`.
- **Holds.** Every step-1 hold, labelled and unlabelled, a release notwithstanding; for D4, a lock and a round in
  flight on a labelled branch.
- **D5 states.** One case per line of § D5 cleanup mode, plus a `DRAFT` with a failing check (exit `4`), an
  unresolved thread and a non-A DeepSource grade (no effect), and every unread reader result.
- **Readers.** `pr_labels` and `branch_labels` each with gh failing, timing out, non-JSON, and a `labels` field
  missing or malformed: each raises `RuntimeError`, and through `read_cleanup` gives unread.
- **Fakes.** Every `gh` fake answers `labels` as JSON (`[]` unless a case sets it), so the existing cases take the
  unlabelled path (SC-003).

## Transitions

Unlabelled → cleanup: the user adds the label on GitHub.
Cleanup → unlabelled: the label is removed, by anyone. Pushes change nothing (FR-001).
