---

description: "Task list for 021: a PR labelled cleanup gets no alq-review gating"
---

# Tasks: A PR labelled cleanup gets no alq-review gating

**Input**: Design documents from `dev/alq-review/specs/021-spec-deletion-ungated/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: Requested (Principle IV, research R11). Every test task is written first, run, and must fail for the
reason it names before the implementation task after it starts. Every gh fake answers the label read with no
label unless a case sets one (SC-003).

**Organization**: Grouped by user story. Paths are from the repository root. Tests run with
`cd dev/alq-review/tests && python3 -m unittest -v`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2 from spec.md

---

## Phase 1: Setup — the decision record ships first (R9)

- [ ] T001 ADR-0021 on branch `114-adr`, its own PR, merged before any code below.
- [ ] T002 Rebase the code branch `114-spec` on the updated `main`.

---

## Phase 2: Foundational — the name test and the reader (R1)

- [ ] T003 [P] Create `dev/alq-review/tests/test_github.py` (fake-`gh` style of `test_pre_merge_gate.py`) with failing tests: `is_cleanup` true for `[{"name": "cleanup"}]` and `[{"name": "Cleanup"}]`, false for `[]`, `cleanup-ish`, `bug`; `cleanup(slug, pr=N)` runs `gh pr view N --repo <slug> --json labels`; `cleanup(slug, branch=B)` runs `gh pr list --repo <slug> --head B --state open --json labels` and reads the first PR listed, false with none; `RuntimeError` carrying gh's words when gh fails or times out, and when the answer is not JSON.
- [ ] T004 In `plugins/alq-review/scripts/github.py` add `CLEANUP_LABEL`, `is_cleanup` and `cleanup` (data-model.md § The label). `pr_target` is unchanged. Makes T003 pass.

---

## Phase 3: User Story 1 — A cleanup PR is readied and merged without review (P1) 🎯 MVP

### Tests (write first, confirm they fail)

- [ ] T005 [P] [US1] `dev/alq-review/tests/test_shell.py`: a comment carrying the attestation marker classifies as `attest` (the expectations that say `ready` flip); `gh pr ready` and `gh pr create` without `--draft` stay `ready`.
- [ ] T006 [P] [US1] `dev/alq-review/tests/test_gate.py`, through `gate.on_bash`: `gh pr ready` by number and from the checkout, and `gh pr create` without `--draft`, on a labelled PR with no round → allowed; the same with a round in flight or a lock → refused with that hold's reason; unlabelled → today's refusal; label read fails → today's refusal ending with `The cleanup label could not be read (<why>).`; an attestation comment on a labelled PR with no round → today's refusal. A `git commit` on a labelled branch → neither `claimgate.on_commit` nor `shimgate.on_commit` is called, and a lock still refuses it; unlabelled, read failed, or no checkout located → both run as today. Every gh stub in the file, `ReleaseReady`'s included, answers the label read with no label unless a case sets one.
- [ ] T007 [P] [US1] `dev/alq-review/tests/test_pre_merge_gate.py`, for `gh pr merge` and `gh pr ready` on a draft: `fetch` asks for `labels`; labelled with no attestation → allowed; `--admin` without `override-merge` on a labelled PR → refused as today; unlabelled with no attestation → today's refusal. `github_has` and `counting_gh` answer `labels: []` unless a case sets it.

### Implementation

- [ ] T008 [US1] `plugins/alq-review/scripts/shell.py`: `_posts` returns `attest` for the marker. `plugins/alq-review/scripts/gate.py` `on_bash`: kind `ready` passes `released` as the version-only release or `github.cleanup(...)`, and appends the read-failed sentence to its refusal; kind `attest` decides `policy.mark_ready` with today's `released`; a `git commit` locates the checkout first and skips both commit checks when labelled. Callers: `gate.main` on `PreToolUse`. Makes T005 and T006 pass.
- [ ] T009 [US1] `plugins/alq-review/scripts/pre_merge_gate.py`: `fetch` adds `labels`; `unmet` allows `github.is_cleanup(pr["labels"])` beside `attested` and `released`. Callers: `gated` ← `main` on `PreToolUse`. Makes T007 pass.

---

## Phase 4: User Story 2 — The poller and the skill apply no review gating to a cleanup PR (P2)

### Tests (write first, confirm they fail)

- [ ] T010 [P] [US2] `dev/alq-review/tests/test_github.py`, the CLI: `cleanup` and `gated` with exit 0; a failed read → why on stderr, exit 1; bad usage → exit 2.
- [ ] T011 [P] [US2] `dev/alq-review/tests/test_poll_pr_review.py` (its fake `gh` and a fake label reader): on a cleanup PR, the `Cleanup PR:` line; Codex not started, reviewing or superseded and an unresolved thread change nothing; no `@codex review` line; no inbox file; a draft → exit `4` naming `DRAFT`; mergeable with a check running → waits, then exit `0`; a failing CI check → exit `2`; the reader failing or printing anything but `cleanup`/`gated` → the `WARNING:` line and today's poll. In both modes a jq failure inside the loop → exit `1`.
- [ ] T012 [P] [US2] `dev/alq-review/tests/test_poller_contract.py`: the skill has a *Cleanup PRs* section naming the `cleanup` label and stating no `@codex review`, no `deepsource-pr-gate.sh`, no triage, and the next step for exits `0`, `2` and `4`.

### Implementation

- [ ] T013 [US2] `plugins/alq-review/scripts/github.py`: `main()` with `cleanup <owner/repo> <pr>` and an `if __name__ == "__main__"` entry. Makes T010 pass.
- [ ] T014 [US2] `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh`: read the label once before the first poll; implement data-model.md § Poller cleanup mode and the `ERR` trap; update the header's settled rules and exit codes. Makes T011 pass.
- [ ] T015 [US2] `plugins/alq-review/skills/alq-github-pr-review/SKILL.md`: the *Cleanup PRs* section (R8); the draft and exit-code prose names the cleanup case. Makes T012 pass.

---

## Phase 5: Polish

- [ ] T016 [P] `plugins/alq-review/README.md` as contracts/interfaces.md § README says.
- [ ] T017 [P] MINOR-bump `version` in `plugins/alq-review/.claude-plugin/plugin.json`.
- [ ] T018 Full suite green, every pre-existing ready/merge refusal case unchanged (SC-003).
- [ ] T019 The by-hand steps of quickstart.md in `claude-plugins-internal`; record any step that did not hold.

---

## Dependencies

- Phase 1 blocks everything; Phase 2 blocks both stories.
- US1: T005 ∥ T006 ∥ T007, then T008 and T009.
- US2: T010 after T003 (same file); T013 before T014.
- Polish after both stories.
