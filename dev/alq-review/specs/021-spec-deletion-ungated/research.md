# Research: A PR labelled cleanup gets no alq-review gating

Each entry names its source: the code (read at `fabc417`) or a spec Clarification. How each consumer decides is
stated once, in data-model.md § Decisions per consumer (rows D1–D5); the entries below cite those rows.

## R1: One fact, one reader, one decider

- **Decision**: data-model.md § Cleanup. `github.is_cleanup(labels: list[str]) -> bool` is the one name test
  (FR-002): true when a label is named `cleanup`, without case, as GitHub matches names. `github.label_names` is
  the one parser of gh's `labels` field. `github.read_cleanup(labels_of)` alone builds `github.Cleanup`.
  The readers and the four values of `Cleanup` are data-model.md § Cleanup. The poller calls `python3 scripts/github.py cleanup <repo> <pr>`, whose `main` goes through
  `read_cleanup` (D5).
- **Source**: code (`version_only_release` / `released`, `pr_target`); which PR a branch's label is read from:
  spec Clarifications.
- **Rationale**: it mirrors the release exemption: a pure `version_only_release(runs)` beside a reader
  `released(slug, commit)`. Every component decides through `read_cleanup`, so none can read the label or render
  the unread case its own way.
- **Existing tools**: `github.pr_head` / `pr_target` read other fields and swallow or raise differently; extending
  `pr_target` would change the tuple `gate.pr_of` and `gate._open_pr` unpack. `pre_merge_gate.fetch` already reads
  the PR and its failure already denies, so adding `labels` there costs no call. The GraphQL snapshot of the
  poller could carry labels, but deciding on them in jq would be a second decider.

## R2: Marking ready and attesting (gate.py → policy)

- **Decision**: rows D1 and D2. `policy.mark_ready` takes one more fact, `cleanup: github.Cleanup`.
  `gate.cleanup_of(repo, pr, branch)` builds it. A comment carrying the attestation marker is its own action kind,
  `attest`, decided by `policy.attest`, which shares `mark_ready`'s steps 1 and 2 without the label. `gh pr create`
  without `--draft` is kind `ready` too; its branch has no open PR yet, so the reader gives no PR.
- **Source**: code (`policy.mark_ready`, `_obstacle`, `_settled`, `shell.py`'s marker classification); the
  attestation needing a round: FR-011.
- **Rationale**: `released` is the pattern, and its test pins that a release still waits for a round in flight.
  `event.pr` is None for a branch no ledger names, the normal state of a cleanup PR, so the branch is asked. The
  org pr-gate takes the attestation for the internal review, so the label cannot stand in for it.
- **Existing tools**: `github.released` returns None on failure, which would hide the reason FR-007 asks to name.

## R3: Merging and readying (pre_merge_gate)

- **Decision**: row D3. `fetch` asks for `labels` too.
- **Source**: code (`unmet`, `admin_needs_override`, `pre_merge_gate.py:395`'s `attested(...) or released(...)`).
- **Rationale**: FR-003/FR-004. `--admin` steps around GitHub's rules, not alq-review's; the label waives only
  the internal review.
- **Existing tools**: `unmet`'s `attested(...) or released(...)` line takes one more term.

## R4: Commit checks (claim-check, shim-check)

- **Decision**: row D4. One call, `gate.cleanup_of(slug, None, branch)` over `github.branch_labels`
  (`gh pr list --repo <slug> --head <branch> --state open --json number,labels`), answers both which PR and its
  labels.
- **Source**: Clarification 5; code (`gate.on_bash`, `worktree.locate` returning None on a detached HEAD or a
  non-GitHub origin).
- **Rationale**: the check sits in the one place both checks are called, so neither module learns about labels.
- **Existing tools**: `github.pr_target` + `github.pr_labels` was rejected: two sequential gh calls, up to 40 s of
  the hook's 60 s before claim-check starts when gh hangs (critique E2). Asking only when a check would refuse was
  rejected: in `log` mode `refuse_claim` / `refuse_shim` record the refusal as they decide it, so the record would
  name a refusal the label lifted.

## R5: No grant

- **Decision**: no prompt keyword and no session record grant the label. The user adds it on GitHub.
- **Source**: spec Clarifications (the user's answer).
- **Rationale**: there is no grant to spend.
- **Existing tools**: none needed.

## R6: No refusal of a label add

- **Decision**: this feature recognises and refuses no command that adds the label; refusing an agent's label add
  is left to a separate rule the user adds later (FR-010).
- **Source**: spec Clarifications (the user's answer).
- **Rationale**: a hook reads only the `gh` forms it knows, so no refusal here closes every route.
- **Existing tools**: none needed.

## R7: The poller on a cleanup PR

- **Decision**: row D5 and § D5 cleanup mode: a loop of its own, sharing only the check classification and the
  merge-state test with today's loop.
- **Source**: code (`poll-pr-review.sh`: `snapshot`, `ANALYZE`, `WAITING_ON`, `settle`, `report`, `hand_to_gate`,
  `dispatch_sweep` and the main loop); FR-008, SC-002; US1 (the agent readies the PR once CI is green).
- **Rationale**: every step of today's loop past the checks reads Codex, reviews or threads: its wait, its error
  set, its report, its hand-over (which opens a github round in the ledger) and its sweep. A branch inside that
  loop would have to switch each off; a loop of its own reads none of them. One exit per next step lets the skill
  route by the code (P1); `0` already means "run `deepsource-pr-gate.sh`". CI and GitHub's merge state still have
  to be green (spec Assumptions; P4).
- **Existing tools**: `READER` already calls a Python script from the poller; the check classification and the
  merge-state test move out of `ANALYZE` into definitions both loops use.

## R8: What the agent is told

- **Decision**: the missing-review refusals of D1 and D3 (step 4) end with `github.CLEANUP_EXEMPTION`
  (data-model.md § Cleanup). No other refusal carries it. The skill gains a section *Cleanup PRs*: the label marks one; no `@codex review`, no
  `deepsource-pr-gate.sh`, no triage; exits `5` and `6` as § D5 cleanup mode.
- **Source**: P1 (a refusal names the next legal step); FR-009, FR-013.
- **Rationale**: the label clears only the missing review, so only that refusal names it. Without it
  `/alq-post-merge`, which this feature does not change, leaves the agent with no route but the refusal.
- **Existing tools**: `how_to_attest` and `policy.mark_ready`'s refusal.

## R9: The decision record ships first

- **Decision**: ADR-0021, drafted with `/speckit-adrkit-draft` on branch `114-adr`, names the cleanup PR as the
  second kind of PR that needs no internal review (ADR-0003 point 2), says it also skips the commit checks (point 1),
  that this plugin refuses no command that adds the label, and which holds the label releases. It relates to 0003,
  0004, 0009, 0018 and 0020. Its own PR merges before the code. The amendment notes on ADR-0003 and ADR-0004 are
  added when 0021 is accepted, as the ADR-0014 note on ADR-0001 was.
- **Source**: ADR-0003 point 2: "We will name in this ADR every kind of PR that needs no internal review."
- **Rationale**: Principle VI: the governing record and the governed code ship apart.
- **Existing tools**: `/speckit-adrkit-draft`, and `docs/adr/` for the record.

## R10: Holds the label keeps

- **Decision**: step 1 of rows D1–D4. The label releases the review holds only (ADR-0021 point 3); each lock keeps
  the releases its own decision record names (ADR-0018, ADR-0020).
- **Source**: constitution P2 (3.0.0): every action that releases a hold is named by a decision record. ADR-0021
  names the label as the release of the review holds, and of nothing else.
- **Rationale**: P2's other half, one approved entity, holds once the user's rule of FR-010 exists; until then an
  agent can add the label, which plan.md's Complexity Tracking records.
- **Existing tools**: `policy._obstacle`, already checked before `released` in `mark_ready`.

## R11: Tests

- **Decision**: `python3 -m unittest -v` in `dev/alq-review/tests/`, each case written to fail first, enumerated
  from data-model.md § Test matrix: `test_policy` (D1, D2), `test_shell` (the `attest` kind), `test_gate` (D1, D2,
  D4), `test_pre_merge_gate` (D3), `test_poll_pr_review` and `test_poller_contract` (D5), a new `test_github.py`
  (`is_cleanup`, `label_names`, `Cleanup`, `read_cleanup`, the readers, `main`).
- **Source**: Principle IV.
- **Rationale**: one matrix keeps the cases of one row from drifting from another's.
- **Existing tools**: these files already drive each component through its fakes, including `test_poll_pr_review`'s
  fake `gh`, which answers the poller's new label read too.

## R12: The issue's open point

- **Decision**: not addressed here. The label is read whatever the diff (FR-001), so a #113-shaped PR, citations
  included, qualifies once the user labels it.
- **Source**: Clarification 4.
- **Rationale**: the spec settles it.
- **Existing tools**: none needed.
