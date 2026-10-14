---

description: "Task list for 021: a PR labelled cleanup gets no alq-review gating"
---

# Tasks: A PR labelled cleanup gets no alq-review gating

**Input**: Design documents from `dev/alq-review/specs/021-spec-deletion-ungated/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/interfaces.md, quickstart.md

**Tests**: Requested (constitution Principle IV, research R11). Every test task is written first, run, and must
fail for the reason it names before the implementation task after it starts.

**Organization**: Grouped by user story. Paths are from the repository root. Tests run with
`cd dev/alq-review/tests && python -m unittest -v`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2 from spec.md

---

## Phase 1: Setup — the decision record ships first (R9)

**Purpose**: Principle VI — the governing ADR lands in its own PR, merged before any code below.

- [ ] T001 Create branch `114-adr` from `main` and draft ADR-0021 with `/speckit-adrkit-draft` at `dev/alq-review/docs/adr/0021-<slug>.md`: the cleanup PR (label `cleanup`, read at each check, whatever the diff, pushes after labelling stay exempt) is the second kind of PR needing no internal review beside the version-only release (ADR-0003 point 2); it also skips claim-check and shim-check (ADR-0003 point 1); this plugin refuses no command that adds the label, and the README names the user's rule forbidding an agent to add it as a requirement (FR-010); the label releases only the review holds, while rounds in flight, locks (ADR-0018) and `--admin` keep theirs (FR-013). Relate it to 0003, 0004, 0009 and 0018. The amendment notes on ADR-0003 and ADR-0004 are added when 0021 is accepted (R9).
- [ ] T002 Commit, open the ADR PR, run the internal and Codex review loops per `.claude/rules/pr-review-loop.md`, and merge it before the code PR. The code is on branch `114-spec`, rebased on the updated `main`.

**Checkpoint**: ADR merged on `main`; code branch created.

---

## Phase 2: Foundational — the one decider and its readers (R1, data-model § Cleanup)

**Purpose**: FR-002. Every later phase gets the fact from `github.read_cleanup`; nothing decides on labels elsewhere.

**⚠️ CRITICAL**: No user story work begins until this phase is complete.

### Tests (write first, confirm they fail)

- [ ] T003 [P] Create `dev/alq-review/tests/test_github.py` (new file, following the import and fake-`gh` style of `dev/alq-review/tests/test_pre_merge_gate.py`) with failing tests: `is_cleanup(["cleanup"])` and `is_cleanup(["Cleanup"])` true; `is_cleanup([])`, `is_cleanup(["cleanup-ish"])`, `is_cleanup(["bug"])` false; `pr_labels(slug, pr)` runs `gh pr view <pr> --repo <slug> --json labels` and returns the label names; `pr_labels` raises `RuntimeError` carrying gh's words when gh exits non-zero or times out, and when gh's answer is not JSON; it raises `RuntimeError` when `labels` is missing or not a list of `{name: str}` (via `label_names`); `branch_labels(slug, branch)` runs `gh pr list --head <branch> --state open --json number,labels` and returns the label names of the first open PR gh lists, as `pr_target` does, `[]` when no open PR, `RuntimeError` on no answer, non-JSON or a malformed field.
- [ ] T004 [P] Add failing tests to `dev/alq-review/tests/test_github.py` for the fact: `Cleanup(labelled=True, unread=...)` raises; `read_cleanup` gives labelled when `is_cleanup` holds for the PR's labels; a reader raising `RuntimeError` gives `Cleanup(unread=why)`, whose `refusal()` names why; any other exception propagates.

### Implementation

- [ ] T005 In `plugins/alq-review/scripts/github.py` add `CLEANUP_LABEL = "cleanup"`, the pure `is_cleanup(labels: list[str]) -> bool` (beside `version_only_release`), the one `labels` parser `label_names(labels) -> list[str]`, and the readers `pr_labels(slug, pr)` and `branch_labels(slug, branch)` that go through `_answer` (20 s) and `label_names`, raising `RuntimeError` in gh's words and on non-JSON. Do not change `pr_target`'s return tuple (callers `gate.pr_of`, `gate._open_pr`). Makes T003 pass.
- [ ] T006 In `plugins/alq-review/scripts/github.py` add `Cleanup` (data-model.md § Cleanup), `read_cleanup(labels_of)` and `Cleanup.refusal()`. Makes T004 pass.

**Checkpoint**: `test_github` passes; full suite still green.

---

## Phase 3: User Story 1 — A cleanup PR is readied and merged without review (P1) 🎯 MVP

**Goal**: `gh pr ready` and `gh pr merge` by the agent go through on a PR labelled `cleanup` with no internal round
and no attestation; commits on its branch skip claim-check and shim-check; every unlabelled PR is gated as today.

**Independent Test**: Label a PR `cleanup`; `gh pr ready` and `gh pr merge` both pass `gate.py` and
`pre_merge_gate.py` with no round on the branch and no attestation comment; remove the label and both refuse as today.

### Tests for User Story 1 (write first, confirm they fail)

- [ ] T007 [P] [US1] Add failing tests to `dev/alq-review/tests/test_policy.py` for `mark_ready(..., cleanup)`: labelled with no clean round at the head → allowed; labelled with a round in flight or a lock (`_obstacle`) → still refused with the obstacle's reason (R10); not labelled → refused exactly as today, ending with `github.CLEANUP_EXEMPTION`; unread with no clean round → `Decision(False, cleanup.refusal())` (FR-007); unread with a clean round at the head → allowed. And for `attest`: refused on no clean round with a refusal that names the clean round and neither `github.CLEANUP_EXEMPTION` nor `gh pr ready`; refused while a round is in flight or the branch is locked, a release notwithstanding, and with a clean round at another head; allowed on a clean or CONVERGED_PUSHBACK round at the head or a release (FR-011, FR-013).
- [ ] T008 [P] [US1] Add failing tests to `dev/alq-review/tests/test_pre_merge_gate.py`: `fetch` requests the `labels` JSON field; `gh pr merge` and `gh pr ready` on a PR whose labels include `cleanup` with no attestation → allowed (`unmet` returns None); same PR with `--admin` and no `override-merge` → still refused (R3); unlabelled PR → refused exactly as today plus the cleanup sentence at the end (R8); a `labels` field missing or not a list of `{name}` → refused with the unread refusal alone, naming no attestation (FR-007); an unread label with an attestation or a release → allowed; the release path (`released`) still allows. `github_has` and `counting_gh` give `labels: []` unless told otherwise, so every existing refusal case keeps passing (SC-003).
- [ ] T009 [P] [US1] Add failing tests to `dev/alq-review/tests/test_gate.py` and `dev/alq-review/tests/test_shell.py`: `gh pr ready` on a PR the ledger names reads its labels by number; on a branch no ledger names, by the branch's open PR (`github.branch_labels`); labelled → allowed; no open PR → not labelled; a reader `RuntimeError` → refused with the unread refusal alone; a comment carrying the attestation marker classifies as `attest` (the `test_shell` expectations that classify it as `ready` flip to `attest`) and is refused on a labelled PR with no clean round; a `git commit` on a branch whose open PR carries `cleanup` → neither `claimgate.on_commit` nor `shimgate.on_commit` is called; a branch with no open PR, an unlabelled PR, or `branch_labels` raising → both run as today with no note (FR-012).

### Implementation for User Story 1

- [ ] T010 [US1] In `plugins/alq-review/scripts/policy.py` give `mark_ready` the `cleanup: github.Cleanup` parameter: allow on labelled after `_obstacle` and beside `released`; when unread and no clean round stands, return `cleanup.refusal()` alone; append the cleanup sentence (R8) to the not-ready refusal. Add `attest`, which shares `mark_ready`'s check for a hold, the release and a clean round at the head, takes no cleanup fact, and has its own refusal naming the clean round as the only way through. Update the callers: `gate.on_bash` and `test_policy`. Makes T007 pass.
- [ ] T011 [US1] In `plugins/alq-review/scripts/shell.py` classify a comment carrying the attestation marker as `attest`. In `plugins/alq-review/scripts/gate.py` add `cleanup_of(repo, pr, branch) -> github.Cleanup` (the PR named via `pr_labels`, else the branch's open PR via `branch_labels`, through `read_cleanup`) and pass it to `policy.mark_ready` for `ready`; route `attest` to `policy.attest`. For a `commit` action, before `claimgate.on_commit` / `shimgate.on_commit`, skip both when `cleanup_of` is labelled; otherwise run both as today. Makes T009 pass.
- [ ] T012 [US1] In `plugins/alq-review/scripts/pre_merge_gate.py` add `labels` to the `gh pr view --json` fields in `fetch`; build the fact with `read_cleanup` over `label_names` of that field; in `unmet`, after the `--admin` and head checks, return None when labelled, beside `attested(...) or released(...)`; when unread and neither attested nor released, return `refusal()` alone; append the cleanup sentence (R8) to `how_to_attest`. Callers: `gated` ← `main` on `PreToolUse`. Makes T008 pass.

**Checkpoint**: US1 complete — full suite green; quickstart steps 3, 4 (ready), 5 and 6 hold.

---

## Phase 4: removed

Out of scope (user, 2026-10-14): refusing an agent's command that adds the label is left to a separate hook the user adds later. T013 and T014 are dropped.

---

## Phase 5: User Story 2 — The poller and the skill apply no review gating to a cleanup PR (P2)

**Goal**: The poller recognises a cleanup PR via `github.py cleanup`, never requests or waits on Codex, hands nothing
to the gate's inbox, treats no thread or DeepSource grade as blocking, and ends with exit `5` (or `4` on a failing
check); the skill routes exit `5` and documents cleanup PRs.

**Independent Test**: Run `poll-pr-review.sh` against a cleanup PR with no Codex activity: it prints the `Cleanup PR:`
line, ends with exit `5` once checks are green, prints no `@codex review`, and writes no inbox file.

### Tests for User Story 2 (write first, confirm they fail)

- [ ] T015 [P] [US2] Add failing tests to `dev/alq-review/tests/test_github.py` for the CLI: `python3 scripts/github.py cleanup <owner/repo> <pr>` prints `cleanup` (exit 0) for a labelled PR, `gated` (exit 0) for an unlabelled one, prints the reason to stderr with exit 1 when gh gives no answer or labels `label_names` rejects, exits 2 on bad usage (contracts/interfaces.md § `scripts/github.py` command line).
- [ ] T016 [P] [US2] Add failing tests to `dev/alq-review/tests/test_poll_pr_review.py` (extend its fake `gh` to answer the label read): a ready cleanup PR, no Codex comment, checks green → prints `Cleanup PR: <repo>#<pr> carries the cleanup label; no Codex, no internal review, no triage.` and `CLEANUP: no check is failing; merge once the PR is ready.`, exit `5`, no `@codex review` text, no inbox file under the state dir; a cleanup PR with an unresolved thread (Codex unasked, DeepSource, human) or a non-A DeepSource grade → still exit `5`; a non-ignored check failing → exit `4` naming it, no hand-over; a check still running at the deadline → exit `3`; a draft cleanup PR → no draft shortcut, polled to settle; `mergeStateStatus` `UNKNOWN` → keeps waiting; the reader exits 1, 2 or 127, or exits 0 with output other than exactly `cleanup` or `gated` → prints `WARNING: the cleanup label of <repo>#<pr> could not be read (<why>); polling it as unlabelled.` and behaves as today; an unlabelled PR → behaves exactly as today (FR-006).
- [ ] T017 [P] [US2] Add failing tests to `dev/alq-review/tests/test_poller_contract.py`: the exit-code table the poller and `plugins/alq-review/skills/alq-github-pr-review/SKILL.md` share includes `5` CLEANUP; the skill has a *Cleanup PRs* section naming the `cleanup` label and stating no `@codex review`, no `deepsource-pr-gate.sh`, no triage.

### Implementation for User Story 2

- [ ] T018 [US2] In `plugins/alq-review/scripts/github.py` add `main()` with the `cleanup <owner/repo> <pr>` subcommand taking the fact from `read_cleanup` over `pr_labels` (stdout `cleanup`/`gated`, exit 0; unread → its reason on stderr, exit 1; usage → exit 2) and an `if __name__ == "__main__"` entry. Makes T015 pass.
- [ ] T019 [US2] In `plugins/alq-review/skills/alq-github-pr-review/poll-pr-review.sh` run `python3 <scripts>/github.py cleanup "$repo" "$pr"` once before the first poll (as `READER` already calls Python). On `cleanup`: print the `Cleanup PR:` line; in `WAITING_ON` / `settle` wait only while a non-gate, non-ignored check runs or `mergeStateStatus` is `UNKNOWN` (no draft shortcut, no Codex, no gate lag); exit `5` with the `CLEANUP:` line when no non-ignored check fails, else exit `4` naming the failing checks; never hand over to the gate's inbox, never report a thread as a finding, never print `@codex review`. Only exit 0 with exactly `gated` is unlabelled: unchanged. Every other result (any non-zero exit, any other output) prints the `WARNING:` line and polls as today. Makes T016 pass.
- [ ] T020 [US2] In `plugins/alq-review/skills/alq-github-pr-review/SKILL.md` add exit `5` CLEANUP to the exit table and a *Cleanup PRs* section: the `cleanup` label marks one, and the user adds it on GitHub, not the agent; no `@codex review`, no `deepsource-pr-gate.sh`, no thread triage; exit `5` means merge once the PR is ready and CI is green; exit `4` on a cleanup PR means a failing check. Makes T017 pass.

**Checkpoint**: Both stories pass; quickstart step 4 (poller) holds.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T021 [P] Update `plugins/alq-review/README.md`: § *What it enforces* names the `cleanup` label beside the version-only release in the ready/merge gate, the cleanup exemption in the commit checks, and that an attestation still needs a round; a § *Requirements* names the rule, still to be created, that forbids an agent from applying the label, and says that until it exists an agent can add it (contracts/interfaces.md § README).
- [ ] T022 [P] MINOR-bump `version` in `plugins/alq-review/.claude-plugin/plugin.json`.
- [ ] T023 Run `cd dev/alq-review/tests && python -m unittest -v` and confirm every test passes, including every pre-existing ready/merge refusal case unchanged (SC-003).
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

## Parallel Example: User Story 1

```bash
Task: "Failing mark_ready(..., cleanup) tests in dev/alq-review/tests/test_policy.py"
Task: "Failing ready/merge cleanup tests in dev/alq-review/tests/test_pre_merge_gate.py"
Task: "Failing ready, attest + commit-skip tests in dev/alq-review/tests/test_gate.py and test_shell.py"
```

## Parallel Example: User Story 2

```bash
Task: "Failing github.py cleanup CLI tests in dev/alq-review/tests/test_github.py"
Task: "Failing poller cleanup tests in dev/alq-review/tests/test_poll_pr_review.py"
Task: "Failing exit-5 / Cleanup PRs contract tests in dev/alq-review/tests/test_poller_contract.py"
```

---

## Implementation Strategy

### MVP (User Story 1)

Phases 1 → 2 → 3, then validate: a labelled PR readies and merges through both hooks. The label-add refusal is
out of scope (FR-010).

### Incremental Delivery

1. ADR PR (Phase 1).
2. Code PR on `114-spec`: Phase 2 + US1 + US2 + Polish — one PR, since the README, skill and version
   bump describe the whole change.

---

## Notes

- Nothing in `/alq-post-merge` changes (R12); the org pr-gate is untouched (FR-005); `hooks.json` is unchanged.
- Commit after each task or logical group.
