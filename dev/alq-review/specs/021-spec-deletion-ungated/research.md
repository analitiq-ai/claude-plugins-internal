# Research: A PR labelled cleanup gets no alq-review gating

Each entry names its source: the code (read at `bdcbc83`) or a spec Clarification. What each consumer does is
stated once, in data-model.md; the entries below give the reasons.

## R1: One name test, one reader

- **Decision**: `github.is_cleanup` and `github.cleanup` (data-model.md § The label).
- **Source**: code (`version_only_release` / `released`, `pr_target`); Clarification Q7.
- **Rationale**: it mirrors the release exemption: a pure test beside a reader. A bool is enough: a failed read
  is gated as unlabelled (FR-007), and the reader's `RuntimeError` carries why to the one place that says it.
- **Existing tools**: `pr_target` reads the same PR but returns `(number, base)` to `gate.pr_of` and
  `gate._open_pr`; widening it would change both. `pre_merge_gate.fetch` already reads the PR, so it adds
  `labels` and calls only `is_cleanup`.

## R2: Ready and create (gate.py → policy.mark_ready)

- **Decision**: the label joins `released`, the version-only release fact `mark_ready` already takes. A comment
  carrying the attestation marker gets its own kind, `attest`, which keeps today's `released` only.
- **Source**: code (`gate.on_bash` lines 376-378, `policy.mark_ready`, `shell.py:141-152`); Clarification
  2026-10-15 (create).
- **Rationale**: a version-only release is today's one PR that needs no review, and `mark_ready` already
  checks `_obstacle` before it, so the holds of FR-013 keep refusing with no new code. `shell.py` gives an
  attestation comment, `gh pr ready` and `gh pr create` the same kind; without `attest`, the label would let an
  agent post an attestation with no review, which the org pr-gate takes for one (FR-011). `gh pr create` reads
  the branch's open PR, as `gate.target` already judges it against that PR's ledger.
- **Existing tools**: `mark_ready` and its refusal, unchanged.

## R3: Merge, and ready on a draft (pre_merge_gate)

- **Decision**: `unmet` allows a labelled PR beside `attested(...) or released(...)`.
- **Source**: code (`pre_merge_gate.py:383-397`, `fetch` at 222-241).
- **Rationale**: FR-003, FR-004. The `--admin` and head-commit checks come first, as today.
- **Existing tools**: `fetch`'s failure already denies, so an unread label has no case of its own here.

## R4: Commit checks

- **Decision**: `gate.on_bash` locates the checkout before the commit checks and skips both for a labelled branch.
- **Source**: code (`gate.on_bash` lines 361-364, `worktree.locate`); Clarification Q5.
- **Rationale**: it is the one place both checks are called, so neither module learns about labels. A failed
  read runs both checks: they fail closed, and each refusal names its own cause.
- **Existing tools**: none.

## R5: No grant

- **Decision**: no prompt keyword and no session record grants the label. The user adds it on GitHub.
- **Source**: Clarification Q2.

## R6: No refusal of a label add

- **Decision**: this feature refuses no command that adds the label (FR-010).
- **Source**: Clarification Q6.

## R7: The poller

- **Decision**: today's loop with a `cleanup` switch (data-model.md § Poller cleanup mode), and an `ERR` trap so
  an unhandled failure exits `1`.
- **Source**: code (`poll-pr-review.sh`: `ANALYZE`, `WAITING_ON`, `REPORT`, `settle`, the main loop); Clarification
  2026-10-15 (poller); FR-008, SC-002.
- **Rationale**: the checks, the merge state and the `Gate check runs:` lines are the same on a cleanup PR, so
  only the Codex, thread and hand-over terms change. A hand-over would open a github round in the ledger. Under
  `set -euo pipefail` a failing jq exits with jq's own code, which today can read as `3` TIMEOUT.
- **Existing tools**: `READER` already calls a Python script from the poller.

## R8: What the agent is told

- **Decision**: the skill gains a section *Cleanup PRs*: the `cleanup` label marks one and the user adds it on
  GitHub; no `@codex review`, no `deepsource-pr-gate.sh`, no thread triage; each exit's next step as in
  data-model.md. The header of `poll-pr-review.sh` and the skill's draft and exit-code prose say the same.
- **Source**: FR-009; P1 (a refusal or exit names the next step).

## R9: The decision record ships first

- **Decision**: ADR-0021 names the cleanup PR as the second kind of PR that needs no internal review (ADR-0003
  point 2), says it also skips the commit checks, that this plugin refuses no command adding the label, and which
  holds the label releases. Its own PR merges before the code. The amendment notes on ADR-0003 and ADR-0004 are
  added when 0021 is accepted, as the ADR-0014 note on ADR-0001 was.
- **Source**: ADR-0003 point 2; Principle VI.

## R10: Holds the label keeps

- **Decision**: a round in flight and a lock refuse a cleanup PR as any PR; `--admin` still needs
  `override-merge` (FR-013).
- **Source**: constitution P2 (3.0.0): ADR-0021 names the label as the release of the review holds only.
- **Rationale**: P2's other half, one approved entity, holds once the user's rule of FR-010 exists; until then an
  agent can add the label, which plan.md's Complexity Tracking records.
- **Existing tools**: `policy._obstacle`, checked before `released`; `policy.mutation` for commits.

## R11: Tests

- **Decision**: `python3 -m unittest -v` in `dev/alq-review/tests/`, each case written to fail first: `test_github`
  (new), `test_policy`, `test_shell`, `test_gate`, `test_pre_merge_gate`, `test_poll_pr_review`,
  `test_poller_contract`. Every gh fake answers the label read with no label unless a case sets one, so the
  existing cases keep testing the unlabelled path (SC-003).
- **Source**: Principle IV.

## R12: The issue's open point

- **Decision**: not addressed. The label is read whatever the diff (FR-001), so a #113-shaped PR qualifies once
  the user labels it.
- **Source**: Clarification Q4.
