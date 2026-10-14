---

description: "Task list for 021: a PR labelled cleanup gets no alq-review gating"
---

# Tasks: A PR labelled cleanup gets no alq-review gating

**Input**: Design documents from `dev/alq-review/specs/021-spec-deletion-ungated/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: Requested (constitution Principle IV, research R11). Every test task is written first, run, and must
fail for the reason it names before the implementation task after it starts. Test cases are enumerated from
data-model.md § Test matrix: for each row (D1–D5), every fact it can get and every hold its step 1 keeps.

**Organization**: Grouped by user story. Paths are from the repository root. Tests run with
`cd dev/alq-review/tests && python3 -m unittest -v`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2 from spec.md

---

## Phase 1: Setup — the decision record ships first (R9)

**Purpose**: Principle VI — the governing ADR lands in its own PR, merged before any code below.

- [ ] T001 Create branch `114-adr` from `main` and draft ADR-0021 with `/speckit-adrkit-draft` at `dev/alq-review/docs/adr/0021-<slug>.md`, as R9 says. Relate it to 0003, 0004, 0009, 0018 and 0020.
- [ ] T002 Commit, open the ADR PR, run the internal and Codex review loops per `.claude/rules/pr-review-loop.md`, and merge it before the code PR. The code is on branch `114-spec`, rebased on the updated `main`.

**Checkpoint**: ADR merged on `main`; code branch created.

---

## Phase 2: Foundational — the one decider and its readers (R1, data-model § Cleanup)

**Purpose**: FR-002. Every later phase gets the fact from `github.read_cleanup`; nothing decides on labels elsewhere.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Tests (write first, confirm they fail)

- [ ] T003 [P] Create `dev/alq-review/tests/test_github.py` (new file, following the import and fake-`gh` style of `dev/alq-review/tests/test_pre_merge_gate.py`) with failing tests: `is_cleanup(["cleanup"])` and `is_cleanup(["Cleanup"])` true; `is_cleanup([])`, `is_cleanup(["cleanup-ish"])`, `is_cleanup(["bug"])` false; `label_names` returns the names of a list of `{name: str}` and raises `RuntimeError` on anything else, missing included; `pr_labels(slug, pr)` runs `gh pr view <pr> --repo <slug> --json labels` and returns the names; `branch_labels(slug, branch)` runs `gh pr list --repo <slug> --head <branch> --state open --json number,labels` and returns the names of the first open PR gh lists (two open PRs, in both orders), `[]` with no open PR; both readers raise `RuntimeError` carrying gh's words when gh exits non-zero or times out, and when its answer is not JSON.
- [ ] T004 [P] Add failing tests to `dev/alq-review/tests/test_github.py` for the fact: `Cleanup(labelled=True, unread=...)` raises; `read_cleanup` gives labelled when `is_cleanup` holds and not labelled when it does not; a reader raising `RuntimeError` gives `Cleanup(unread=why)`, whose `refusal()` names why; any other exception propagates.

### Implementation

- [ ] T005 In `plugins/alq-review/scripts/github.py` add `CLEANUP_LABEL = "cleanup"`, `is_cleanup` (beside `version_only_release`), `label_names`, and the readers `pr_labels` and `branch_labels` through `_answer` (20 s) and `label_names`. Do not change `pr_target`'s return tuple (callers `gate.pr_of`, `gate._open_pr`). Makes T003 pass.
- [ ] T006 In `plugins/alq-review/scripts/github.py` add `Cleanup` (data-model.md § Cleanup), `read_cleanup(labels_of)`, `Cleanup.refusal()` and `CLEANUP_EXEMPTION` (R8). Makes T004 pass.

**Checkpoint**: `test_github` passes; full suite still green.

---

## Phase 3: User Story 1 — A cleanup PR is readied and merged without review (P1) 🎯 MVP

**Goal**: rows D1–D4.

**Independent Test**: Label a PR `cleanup`; `gh pr ready` and `gh pr merge` both pass `gate.py` and
`pre_merge_gate.py` with no round on the branch and no attestation comment; remove the label and both refuse as today.

### Tests for User Story 1 (write first, confirm they fail)

- [ ] T007 [P] [US1] Add failing tests to `dev/alq-review/tests/test_policy.py` for rows D1 (`mark_ready(..., cleanup)`) and D2 (`attest`): each step 1 hold (a round in flight, a lock) refuses with its own reason and no `CLEANUP_EXEMPTION`, labelled or not and a release notwithstanding; each step 2 allowance (a release, a clean round at the head, a CONVERGED_PUSHBACK round at the head, and for D1 labelled) is allowed, including with an unread fact; a settled round at another head does not count; D1 unread → `cleanup.refusal()` alone; D1 not labelled → today's refusal + `CLEANUP_EXEMPTION`; D2 labelled with nothing else → refused with its own refusal, which names neither `CLEANUP_EXEMPTION` nor `gh pr ready`.
- [ ] T008 [P] [US1] Add failing tests to `dev/alq-review/tests/test_pre_merge_gate.py` for row D3, for `gh pr merge` and `gh pr ready`: `fetch` requests `labels`; `--admin` without `override-merge` → refused as today, labelled or not; labelled with no attestation → allowed; an attestation at the head or a release → allowed, also when the label is unread; unread with neither → `refusal()` alone, naming no attestation; unlabelled → today's refusal + `CLEANUP_EXEMPTION`. `github_has` and `counting_gh` answer `labels: []` unless a case sets it (data-model § Test matrix).
- [ ] T009 [P] [US1] Add failing tests to `dev/alq-review/tests/test_gate.py` and `dev/alq-review/tests/test_shell.py` for rows D1, D2 and D4 through `gate.on_bash`: `gh pr ready` reads the labels of the PR the ledger names by number, else of the branch's open PR; labelled / unlabelled / unread / no open PR each decide as D1. A comment carrying the attestation marker classifies as `attest` (the `test_shell` expectations that say `ready` flip) and decides as D2. A `git commit`: labelled → neither `claimgate.on_commit` nor `shimgate.on_commit` is called, and a lock or a round in flight still refuses it through `policy.mutation`; unlabelled, unread, no open PR → both run, no note; no checkout located (`worktree.locate` None) → both run and no label is read. Every gh stub in `test_gate.py`, `ReleaseReady`'s included, answers `pr list` / `pr view` with JSON carrying `labels: []` unless a case sets it.

### Implementation for User Story 1

- [ ] T010 [US1] In `plugins/alq-review/scripts/policy.py` give `mark_ready` the `cleanup: github.Cleanup` parameter and add `attest`, both as rows D1 and D2, sharing one step 1 + 2 check. Update the callers: `gate.on_bash` and `test_policy`. Makes T007 pass.
- [ ] T011 [US1] In `plugins/alq-review/scripts/shell.py` classify a comment carrying the attestation marker as `attest`. In `plugins/alq-review/scripts/gate.py` add `cleanup_of(repo, pr, branch) -> github.Cleanup`, pass it to `policy.mark_ready` for `ready`, route `attest` to `policy.attest`, and implement row D4 for `commit`. Makes T009 pass.
- [ ] T012 [US1] In `plugins/alq-review/scripts/pre_merge_gate.py` add `labels` to `fetch`'s `--json` fields and implement row D3 in `unmet`; append `CLEANUP_EXEMPTION` to `how_to_attest`. Callers: `gated` ← `main` on `PreToolUse`. Makes T008 pass.

**Checkpoint**: US1 complete — full suite green; quickstart steps 3, 4 (ready), 5 and 6 hold.

---

## Phase 4: removed

Out of scope (FR-010): refusing an agent's command that adds the label is left to a separate rule the user adds later. T013 and T014 are dropped.

---

## Phase 5: User Story 2 — The poller and the skill apply no review gating to a cleanup PR (P2)

**Goal**: row D5; the skill routes exit `5` and documents cleanup PRs.

**Independent Test**: Run `poll-pr-review.sh` against a mergeable cleanup PR with no Codex activity: it prints the
`Cleanup PR:` line, ends with exit `5`, prints no `@codex review`, and writes no inbox file.

### Tests for User Story 2 (write first, confirm they fail)

- [ ] T015 [P] [US2] Add failing tests to `dev/alq-review/tests/test_github.py` for the CLI (contracts/interfaces.md § `scripts/github.py` command line): `cleanup` (exit 0) for a labelled PR, `gated` (exit 0) for an unlabelled one, the reason on stderr with exit 1 for each unread fact (gh fails, non-JSON, a malformed `labels`), exit 2 on bad usage.
- [ ] T016 [P] [US2] Add failing tests to `dev/alq-review/tests/test_poll_pr_review.py` for row D5, one per line of § D5 cleanup mode (extend its fake `gh` to answer the label read): a check running or `mergeStateStatus` `UNKNOWN` → waits; `CLEAN`, and `UNSTABLE` with every non-passing check ignored → exit `5` with the `Cleanup PR:` and `CLEANUP:` lines, no `@codex review`, no inbox file; `BLOCKED`, `DIRTY` or `BEHIND` with no check failing, and a non-ignored check failing → exit `4` with today's reason; still waiting at the deadline → exit `3`; a draft cleanup PR → no draft shortcut; an unresolved thread (Codex unasked, DeepSource, human) or a non-A DeepSource grade → no effect on the outcome. The reader exits 1, 2 or 127, or exits 0 with output other than exactly `cleanup` or `gated` → the `WARNING:` line and polled as today; `gated` → exactly as today (FR-006).
- [ ] T017 [P] [US2] Add failing tests to `dev/alq-review/tests/test_poller_contract.py`: the exit-code table the poller and `plugins/alq-review/skills/alq-github-pr-review/SKILL.md` share includes `5` CLEANUP; the skill has a *Cleanup PRs* section naming the `cleanup` label and stating no `@codex review`, no `deepsource-pr-gate.sh`, no triage.

### Implementation for User Story 2

- [ ] T018 [US2] In `plugins/alq-review/scripts/github.py` add `main()` with the `cleanup <owner/repo> <pr>` subcommand over `read_cleanup(lambda: pr_labels(...))`, and an `if __name__ == "__main__"` entry. Makes T015 pass.
- [ ] T019 [US2] In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` run `python3 <scripts>/github.py cleanup "$repo" "$pr"` once before the first poll (as `READER` already calls Python) and implement row D5: cleanup mode derives its outcome from today's `$blocked_by` with the Codex term dropped, so the merge-state term and its reason stay. Makes T016 pass.
- [ ] T020 [US2] In `plugins/alq-review/skills/alq-github-pr-review/SKILL.md` add exit `5` CLEANUP to the exit table and a *Cleanup PRs* section: the `cleanup` label marks one, and the user adds it on GitHub, not the agent; no `@codex review`, no `deepsource-pr-gate.sh`, no thread triage; exit `5` means merge once the PR is ready; exit `4` on a cleanup PR means GitHub does not report it mergeable or a check is failing. Makes T017 pass.

**Checkpoint**: Both stories pass; quickstart step 4 (poller) holds.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T021 [P] Update `plugins/alq-review/README.md` as contracts/interfaces.md § README says.
- [ ] T022 [P] MINOR-bump `version` in `plugins/alq-review/.claude-plugin/plugin.json`.
- [ ] T023 Run `cd dev/alq-review/tests && python3 -m unittest -v` and confirm every test passes, including every pre-existing ready/merge refusal case unchanged (SC-003).
- [ ] T024 Run the by-hand steps 1–6 of `dev/alq-review/specs/021-spec-deletion-ungated/quickstart.md` in `claude-plugins-internal` with alq-review installed from `114-spec`; record any step that did not hold.
- [ ] T025 Run the tripwire `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; any file above ~3 edits gets the one-shot rewrite before the PR is opened (`.claude/rules/pr-review-loop.md`).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: ADR PR merged first (Principle VI) — blocks everything.
- **Foundational (Phase 2)**: `is_cleanup`, `label_names`, the readers, `Cleanup`, `read_cleanup` — blocks all stories.
- **US1 (Phase 3)**: after Phase 2.
- **US2 (Phase 5)**: after Phase 2; independent of US1 code. T015 after T003 (same file).
- **Polish (Phase 6)**: after all stories.

### Within Each Story

- Tests written, run, failing for the named reason before implementation.
- US1: T010 (policy) before T011 (gate passes the new parameter); T012 independent of T010/T011.
- US2: T018 before T019 (poller calls the CLI); T020 independent.

### Parallel Opportunities

- T003 before T004 (same file); T005 before T006 (same file).
- T007 ∥ T008 ∥ T009 (three test files).
- T015 ∥ T016 ∥ T017.
- US2 (Phase 5) can run alongside US1 once Phase 2 is done.
- T021 ∥ T022.

---

## Implementation Strategy

### MVP (User Story 1)

Phases 1 → 2 → 3, then validate: a labelled PR readies and merges through both hooks.

### Incremental Delivery

1. ADR PR (Phase 1).
2. Code PR on `114-spec`: Phase 2 + US1 + US2 + Polish — one PR, since the README, skill and version
   bump describe the whole change.

---

## Notes

- Nothing in `/alq-post-merge` changes (R12); the org pr-gate is untouched (FR-005); `hooks.json` is unchanged.
- Commit after each task or logical group.
