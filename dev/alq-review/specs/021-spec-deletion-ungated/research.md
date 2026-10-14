# Research: A PR labelled cleanup gets no alq-review gating

Every decision below was settled by reading the code at `aecf2a3`; none needed the user.

## R1: One fact, one reader, one decider

- **Decision**: `github.is_cleanup(labels: list[str]) -> bool` is the one name test (FR-002): true when a label is
  named `cleanup`, without case, as GitHub matches names. `github.label_names(labels)` is the one parser of gh's
  `labels` field; it raises `RuntimeError` when the field is not a list of `{name: str}`. `pr_labels(slug, pr)` and
  `branch_labels(slug, branch)` read through it, and `pre_merge_gate` calls it on the `labels` of the `gh pr view` it
  already makes. `github.Cleanup` is the one fact, labelled, not labelled or unread with why; it cannot be labelled
  and unread at once. `github.read_cleanup(labels_of)` alone builds it: unread when `labels_of` raises
  `RuntimeError` (any other error propagates), else labelled when `is_cleanup` holds for the PR's labels. The
  readers raise `RuntimeError` when gh fails, times out or gives no JSON. `branch_labels` reads the first
  open PR gh lists for the branch, as `pr_target` does. `Cleanup.refusal()` is the one unread refusal. The poller
  calls `python3 scripts/github.py cleanup <repo> <pr>`, whose `main` goes through `read_cleanup` (R7).
- **Rationale**: it mirrors the release exemption: a pure `version_only_release(runs)` beside a reader
  `released(slug, commit)`. Every component decides through `read_cleanup`, so none can read the label or render
  the unread case its own way.
- **Existing tools**: `github.pr_head` / `pr_target` read other fields and swallow or raise differently; extending
  `pr_target` would change the tuple `gate.pr_of` and `gate._open_pr` unpack. `pre_merge_gate.fetch` already reads
  the PR and its failure already denies, so adding `labels` there costs no call. The GraphQL snapshot of the
  poller could carry labels, but deciding on them in jq would be a second decider.

## R2: Marking ready and attesting (gate.py → policy)

- **Decision**: `policy.mark_ready` takes one more fact, `cleanup: github.Cleanup`, and allows when it is labelled,
  after `_obstacle` and beside `released`. When the label is unread and no clean round stands at the head, the
  refusal is `Cleanup.refusal()` alone: it names the unread label and says to retry, not that a review is missing
  (FR-007). `gate.cleanup_of(repo, pr, branch)` reads the PR named, else the branch's open PR through
  `branch_labels`. A comment carrying the attestation marker is its own action kind, `attest`, decided by
  `policy.attest`: a clean round or a release, never the label, since the org pr-gate takes the attestation for the
  review (FR-011).
- **Rationale**: `released` is the pattern, and its test pins that a release still waits for a round in flight.
  `event.pr` is None for a branch no ledger names, the normal state of a cleanup PR, so the branch is asked.
- **Existing tools**: `github.released` returns None on failure, which would hide the reason FR-007 asks to name.

## R3: Merging and readying (pre_merge_gate)

- **Decision**: `fetch` asks for `labels` too; `pre_merge_gate` builds the fact with `read_cleanup` over
  `label_names` of that field. `unmet` returns None when the fact is labelled, after the `--admin` check and the
  head check and beside `attested` / `released`. `--admin` still needs `override-merge`. A `labels` field that is
  missing or not a list of `{name}` is unread: when neither an attestation nor a release lets the PR through, the
  refusal is `Cleanup.refusal()` alone, as in R2.
- **Rationale**: FR-003/FR-004. `--admin` steps around GitHub's rules, not alq-review's (`admin_needs_override`);
  the label waives only the internal review.
- **Existing tools**: `unmet`'s `attested(...) or released(...)` line (`pre_merge_gate.py:395`) takes one more term.

## R4: Commit checks (claim-check, shim-check)

- **Decision**: in `gate.on_bash`, a `commit` action reads the checkout's branch's open PR and its labels in one
  call, `gate.cleanup_of(slug, None, branch)` over `github.branch_labels` (`gh pr list --head <branch> --state open
  --json number,labels`), before `claimgate.on_commit` / `shimgate.on_commit`. A labelled fact skips both; not
  labelled or unread runs both as today, with no note (FR-012).
- **Rationale**: Clarification 5. The check sits in the one place both are called (`gate.py:361-362`), so neither
  module learns about labels.
- **Existing tools**: `github.pr_target` + `github.pr_labels` was rejected: two sequential gh calls, up to 40 s of
  the hook's 60 s before claim-check starts when gh hangs (critique E2). One `gh pr list` call answers both. Asking only when a check would refuse was rejected: in `log` mode `refuse_claim` /
  `refuse_shim` record the refusal as they decide it, so the record would name a refusal the label lifted.

## R5: No grant

- **Decision**: no prompt keyword and no session record grant the label. The user adds it on GitHub.
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
  (<why>); polling it as unlabelled.` and polls as today (FR-007). Only exit 0 with exactly `cleanup` or exactly
  `gated` is a label read; every other exit or output is unread.
- **Rationale**: FR-008, SC-002. A hand-over opens a github round in the ledger, which is alq-review gating. A new
  exit code lets the skill route by code, not by the agent reading a line (P1); `0` already means "run
  `deepsource-pr-gate.sh`". CI still has to be green (spec Assumptions), so failing checks still block.
- **Existing tools**: `READER` already calls a Python script from the poller; `WAITING_ON`, `settle` and `report`
  take the cleanup branch.

## R8: What the agent is told

- **Decision**: the ready and merge refusals end with `github.CLEANUP_EXEMPTION`: "To exempt this PR from review,
  the user adds the `cleanup` label to it on GitHub; an agent does not." The skill gains a section *Cleanup PRs*:
  the label marks one; no `@codex review`, no `deepsource-pr-gate.sh`, no triage; exit `5`.
- **Rationale**: P1 (a refusal names the next legal step) and FR-009. Without it `/alq-post-merge`, which this
  feature does not change, leaves the agent with no route but the refusal.
- **Existing tools**: `how_to_attest` and `policy.mark_ready`'s refusal.

## R9: The decision record ships first

- **Decision**: ADR-0021, drafted with `/speckit-adrkit-draft` on branch `114-adr`, names the cleanup PR as the
  second kind of PR that needs no internal review (ADR-0003 point 2), says it also skips the commit checks (point 1),
  that this plugin refuses no command that adds the label, and which holds the label releases. It relates to 0003,
  0004, 0009 and 0018. Its own PR merges before the code. The amendment notes on ADR-0003 and ADR-0004 are added
  when 0021 is accepted, as the ADR-0014 note on ADR-0001 was.
- **Rationale**: ADR-0003 point 2: "We will name in this ADR every kind of PR that needs no internal review."
  Principle VI: the governing record and the governed code ship apart.
- **Existing tools**: `/speckit-adrkit-draft`, and `docs/adr/` for the record.

## R10: Holds the label keeps

- **Decision**: the label releases the review holds only (ADR-0021 point 3). A cleanup PR still meets `_obstacle`
  (a round in flight, a lock), and `--admin` still needs `override-merge` (FR-013).
- **Rationale**: P2 and ADR-0018: a lock is released only by `unlock`. The review hold the label does release is a
  second way out of that hold until the user's rule exists; plan.md's Complexity Tracking records it.
- **Existing tools**: `policy._obstacle`, already checked before `released` in `mark_ready`.

## R11: Tests

- **Decision**: `python -m unittest -v` in `dev/alq-review/tests/`, each acceptance scenario a test written to fail
  first: `test_policy` (mark_ready and attest facts), `test_shell` (the `attest` kind), `test_gate` (ready,
  attest, commit skip), `test_pre_merge_gate` (merge, ready,
  an unreadable label), `test_poll_pr_review` and `test_poller_contract` (exit 5, no hand-over), a new
  `test_github.py` (`is_cleanup`, `Cleanup`, `read_cleanup`, the readers, `main`).
- **Rationale**: Principle IV.
- **Existing tools**: these files already drive each component through its fakes, including `test_poll_pr_review`'s
  fake `gh`, which answers the poller's new `gh pr view` too.

## R12: The issue's open point

- **Decision**: not addressed here (Clarification 4). The label is read whatever the diff (FR-001), so a #113-shaped
  PR, citations included, qualifies once the user labels it.
- **Rationale**: the spec settles it.
- **Existing tools**: none needed.
