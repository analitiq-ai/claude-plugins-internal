# Research: A PR labelled cleanup gets no alq-review gating

Every decision below was settled by reading the code at `aecf2a3`; none needed the user.

## R1: One decider, one reader

- **Decision**: `github.is_cleanup(labels: list[str]) -> bool` is the one function that decides (FR-002): true when a
  label is named exactly `cleanup`. One reader, `github.pr_labels(slug, pr) -> list[str]`, asks
  `gh pr view <pr> --repo <slug> --json labels` and raises `RuntimeError` in gh's words when gh gives no answer, as
  `pr_target` does. `pre_merge_gate` reads the labels in the `gh pr view` it already makes (`fetch`, one more JSON
  field) and hands them to `is_cleanup`. The poller calls `python3 scripts/github.py cleanup <repo> <pr>`, a `main`
  that runs `pr_labels` then `is_cleanup` (R7).
- **Rationale**: it mirrors the release exemption already there: a pure `version_only_release(runs)` and a reader
  `released(slug, commit)` (`github.py:63-81`). The decision is a name test, so every component deciding through
  `is_cleanup` cannot drift; the readers differ only in how they reach GitHub.
- **Existing tools**: `github.pr_head` / `pr_target` read other fields and swallow or raise differently; extending
  `pr_target` would change the tuple `gate.pr_of` and `gate._open_pr` unpack. `pre_merge_gate.fetch` already reads
  the PR and its failure already denies (`pre_merge_gate.py:436-441`), so adding `labels` there costs no call.
  The GraphQL snapshot of the poller could carry labels, but deciding on them in jq would be a second decider.

## R2: Marking ready (gate.py → policy.mark_ready)

- **Decision**: `policy.mark_ready` takes one more fact, `cleanup: Cleanup` (data-model), and allows when it is
  `LABELLED`, after `_obstacle` and beside `released`. `gate.on_bash` gets the fact from a new `_cleanup(event,
  action)`: the PR is `action.pr`, else `event.pr`, else `github.pr_target(event.repo, event.branch)`; then
  `github.pr_labels`. A `RuntimeError` anywhere is `Cleanup.unread(why)`; no open PR is `NOT_LABELLED`. When unread,
  the refusal starts with "The `cleanup` label of <PR> could not be read (<why>), so it is gated as unlabelled."
- **Rationale**: `released` is the pattern (`policy.py:216-222`), and its test pins that a release still waits for a
  round in flight (`test_policy.py:406`). `event.pr` is None for a branch no ledger names (`gate.pr_of`), which is
  the normal state of a cleanup PR, so the PR has to be looked up by branch.
- **Existing tools**: `github.released` returns None on failure, which would hide the reason FR-007 asks to name;
  `pr_target` already raises with gh's words.

## R3: Merging and readying (pre_merge_gate)

- **Decision**: `fetch` asks for `labels` too. `unmet` returns None when `is_cleanup` says so, after the `--admin`
  check and the head check and beside `attested` / `released`. `--admin` still needs `override-merge`. A `labels`
  field that is missing or not a list of `{name}` is unread: the refusal is prefixed as in R2.
- **Rationale**: FR-003/FR-004. `--admin` steps around GitHub's rules, not alq-review's (`admin_needs_override`);
  the label waives only the internal review.
- **Existing tools**: `unmet`'s `attested(...) or released(...)` line (`pre_merge_gate.py:395`) takes one more term.

## R4: Commit checks (claim-check, shim-check)

- **Decision**: in `gate.on_bash`, a `commit` action reads the checkout's branch's open PRs and their labels in one
  call, `github.branch_labels(slug, branch)` (`gh pr list --head <branch> --state open --json number,labels`),
  before `claimgate.on_commit` / `shimgate.on_commit`; `is_cleanup` on an open PR's labels true (`LABELLED`) skips
  both. `NOT_LABELLED` or unread runs both as today,
  with no note (FR-012).
- **Rationale**: Clarification 5. The check sits in the one place both are called (`gate.py:361-362`), so neither
  module learns about labels.
- **Existing tools**: `github.pr_target` + `github.pr_labels` was rejected: two sequential gh calls, up to 40 s of
  the hook's 60 s before claim-check starts when gh hangs (critique E2). One `gh pr list` call answers both. Asking only when a check would refuse was rejected: in `log` mode `refuse_claim` /
  `refuse_shim` record the refusal as they decide it, so the record would name a refusal the label lifted.

## R5: No grant

- **Decision**: the agent never adds `cleanup`. No prompt keyword, no session record; the user adds the label on
  GitHub (critique clarification).
- **Rationale**: the user's decision. There is no grant to spend.
- **Existing tools**: none needed.

## R6: No refusal of a label add

- **Decision**: this feature recognises and refuses no command that adds the label. Out of scope (user, 2026-10-14): refusing an agent's command that adds the label is left to a separate hook the user adds later.
- **Rationale**: the user's decision.
- **Existing tools**: none needed.

## R7: The poller on a cleanup PR

- **Decision**: before its first poll the poller runs `github.py cleanup "$repo" "$pr"` once. On `cleanup` it
  announces the PR as a cleanup PR, waits only while a non-gate check runs or mergeability is UNKNOWN (no draft
  shortcut, no Codex, no gate lag), and ends with exit `5` CLEANUP when no non-ignored check fails, or exit `4`
  BLOCKED naming the failing checks. It hands nothing to the gate's inbox, reports no thread as a finding and never
  prints `@codex review`. A reader failure prints `WARNING: the cleanup label of <repo>#<pr> could not be read
  (<why>); polling it as unlabelled.` and polls as today (FR-007).
- **Rationale**: FR-008, SC-002. A hand-over opens a github round in the ledger, which is alq-review gating. A new
  exit code lets the skill route by code, not by the agent reading a line (P1); `0` already means "run
  `deepsource-pr-gate.sh`". CI still has to be green (spec Assumptions), so failing checks still block.
- **Existing tools**: `READER` already calls a Python script from the poller; `WAITING_ON`, `settle` and `report`
  take the cleanup branch.

## R8: What the agent is told

- **Decision**: the ready and merge refusals end with "Only the user exempts a PR from review, by adding the
  `cleanup` label on GitHub." The skill gains a section *Cleanup PRs*:
  the label marks one; no `@codex review`, no `deepsource-pr-gate.sh`, no triage; exit `5`.
- **Rationale**: P1 (a refusal names the next legal step) and FR-009. Without it `/alq-post-merge`, which this
  feature does not change, leaves the agent with no route but the refusal.
- **Existing tools**: `how_to_attest` and `policy.mark_ready`'s refusal.

## R9: The decision record ships first

- **Decision**: a new ADR, drafted with `/speckit-adrkit-draft`, names the cleanup PR as the second kind of PR that
  needs no internal review (ADR-0003 point 2), says it also skips the commit checks (point 1), and that only the
  user adds the label. It relates to 0003 and 0004. Its own PR merges before the code.
- **Rationale**: ADR-0003 point 2: "We will name in this ADR every kind of PR that needs no internal review."
  Principle VI: the governing record and the governed code ship apart.
- **Existing tools**: `/speckit-adrkit-draft`, and `docs/adr/` for the record; ADR-0003 is not edited in place.

## R10: Holds the label does not lift

- **Decision**: a cleanup PR still meets `_obstacle` (a round in flight, a lock). The label waives a review; it
  releases no hold.
- **Rationale**: P2 and ADR-0018: a lock is released only by `unlock`. The label as a second way out would fail P2.
- **Existing tools**: `policy._obstacle`, already checked before `released` in `mark_ready`.

## R11: Tests

- **Decision**: `python -m unittest -v` in `dev/alq-review/tests/`, each acceptance scenario a test written to fail
  first: `test_policy` (mark_ready facts), `test_gate` (ready, commit skip), `test_pre_merge_gate` (merge, ready,
  an unreadable label), `test_poll_pr_review` and `test_poller_contract` (exit 5, no hand-over), a new
  `test_github.py` (`is_cleanup`, `pr_labels`, `main`).
- **Rationale**: Principle IV.
- **Existing tools**: these files already drive each component through its fakes, including `test_poll_pr_review`'s
  fake `gh`, which answers the poller's new `gh pr view` too.

## R12: The issue's open point

- **Decision**: not addressed here (Clarification 4). The label is read whatever the diff (FR-001), so a #113-shaped
  PR, citations included, qualifies once the user labels it.
- **Rationale**: the spec settles it.
- **Existing tools**: none needed.
