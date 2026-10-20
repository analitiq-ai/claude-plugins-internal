---

description: "Task list for 111: a RESHAPE_SPEC ruling names its spec and tells the spec's issue"
---

# Tasks: A RESHAPE_SPEC ruling names its spec and tells the spec's issue

**Input**: Design documents from `specs/111-reshape-spec-notice/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Required. The constitution (IV. Test-first) and quickstart.md require every scenario written red first:
write the test, run `cd reviewer/tests && python3 -m unittest <module>`, confirm it fails for the expected
reason, then implement.

**Organization**: Grouped by user story. Paths are from the repo root (`git rev-parse --show-toplevel`). Plugin
code: `reviewer/plugin/`. Tests: `reviewer/tests/`.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1, US2, US3 per spec.md

---

## Phase 1: Setup

**Purpose**: Test infrastructure the notice tests need.

- [ ] T001 Extend the stub `gh` in `GateTest.setUp` in `reviewer/tests/test_gate.py` (line ~51) so `issue comment*` and `issue edit*` exit 0 by default, and fail with the message in `$GH_FAIL_COMMENT` / `$GH_FAIL_EDIT` on stderr (exit 1) when that variable is set. Keep the existing `*) exit 1` for every other call. Run the full `test_gate` module afterwards: no existing test may change outcome.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The new pure module and the one reshape-summary renderer (R2, R8), shared by the comment (US2) and the unlock reply (US1, US3).

**⚠️ CRITICAL**: US1 scenario 2 and all of US2/US3 read `reshape.summary`.

- [ ] T002 [P] Write red tests in new `reviewer/tests/test_reshape.py` for `reshape.summary(folder, assessment)`: for an assessment with `user_decision`, `rationale` and two `kind == "spec_gap"` findings (plus one non-`spec_gap` finding), it returns exactly `Open decision: <user_decision> Why: <rationale> Spec gaps: <mechanism> (<spec_ref>); <mechanism> (<spec_ref>) Spec folder: <folder>.` (contracts/github-notice.md), and the non-`spec_gap` finding is absent. Pin the expected string against the folder branch of today's `_reshape_brief` output in `reviewer/plugin/scripts/gate.py:128` minus its `"It was held by a RESHAPE_SPEC ruling. "` opener.
- [ ] T003 [P] Write a red test in `reviewer/tests/test_gate.py` (quickstart #12, FR-003/SC-005): after a `RESHAPE_SPEC` ruling on PR 7 bound to `specs/123-login`, the `unlock #7` reply contains `reshape.summary("specs/123-login", assessment)` verbatim.
- [ ] T004 Create `reviewer/plugin/scripts/reshape.py` with `summary(folder: str, assessment: dict) -> str`, moved out of the folder branch of `gate._reshape_brief`. Pure: imports no I/O module, nor `policy` or `gate`. Module docstring states it holds the reshape rules (R8).
- [ ] T005 Change `_reshape_brief` in `reviewer/plugin/scripts/gate.py` to keep its `NoSpec` branch and return `"It was held by a RESHAPE_SPEC ruling. " + reshape.summary(...)` for a folder. Callers: `_unlock` ← `_on_release` ← `on_prompt`. T002, T003 and every existing unlock test in `test_gate.py` pass.

**Checkpoint**: One renderer; unlock reply unchanged in text.

---

## Phase 3: User Story 1 - The ruling says which spec to reshape and why (Priority: P1) 🎯 MVP

**Goal**: The `assess-round` result carries `spec_folder` from both launch paths (R1, contracts/assess-round-result.md).

**Independent Test**: Direct launch injects `spec_folder`; review-round forwards it to the nested assess-round; assess-round returns it next to `assessment` holding the `spec_gap` findings.

### Tests for User Story 1 ⚠️ (write first, confirm red)

- [ ] T006 [P] [US1] Red test in `reviewer/tests/test_gate.py` (quickstart #1): a direct `alq-review:assess-round` launch on PR 7 bound to `specs/123-login` gets `updatedInput.args.spec_folder == "specs/123-login"`; bound to `spec: null` it gets `spec_folder: null`.
- [ ] T007 [P] [US1] Red test in `reviewer/tests/test_gate.py` (review-round launch): injected review-round args carry `spec_folder: "specs/123-login"`.
- [ ] T008 [P] [US1] Red test in `reviewer/tests/test_gate.py` next to `ReviewRoundResult` (line ~2087) using `HARNESS` (quickstart #2a): running `reviewer/plugin/workflows/review-round.js` with `spec_folder: "specs/123-login"` in args records a nested `alq-review:assess-round` call whose args carry that `spec_folder`.
- [ ] T009 [P] [US1] Red test in `reviewer/tests/test_gate.py` using `HARNESS` (quickstart #2b, SC-001): running `reviewer/plugin/workflows/assess-round.js` with `spec_folder: "specs/123-login"` and a canned `RESHAPE_SPEC` assessment with two `spec_gap` findings returns `status: "ASSESSED"`, `spec_folder: "specs/123-login"`, and `assessment.findings` holding both gaps; `REFUSED`/`INCOMPLETE` results carry no new key.

### Implementation for User Story 1

- [ ] T010 [US1] Add `spec_folder(state) -> str | None` to `reviewer/plugin/scripts/briefs.py` (the bound folder's repo-relative path; None for `spec: null` or no binding), and make `brief()` (line ~188) use it instead of its inline computation. Keep `bound_spec` for `_reshape_brief`. Caller of `brief`: `briefs.main`.
- [ ] T011 [US1] Inject `spec_folder: spec_folder(state)` in `assess_args` (line ~178) and `review_args` (line ~151) in `reviewer/plugin/scripts/briefs.py`. Caller: `gate.on_workflow`. T006, T007 pass.
- [ ] T012 [P] [US1] In `reviewer/plugin/workflows/review-round.js`, forward `args.spec_folder` in the nested `workflow('alq-review:assess-round', …)` call alongside `assess`/`findings`. T008 passes.
- [ ] T013 [P] [US1] In `reviewer/plugin/workflows/assess-round.js` (return at line ~25), add `spec_folder: args.spec_folder` to the `ASSESSED` result only. Render no summary text (FR-002). T009 passes.

**Checkpoint**: US1 complete: every `ASSESSED` result names the folder; the unlock summary (T003) already matches.

---

## Phase 4: User Story 2 - The spec's issue records that a reshape is waiting (Priority: P1)

**Goal**: On a `RESHAPE_SPEC` ruling for a folder-bound PR, the gate claims a notice in the ruling's transaction, makes `gh issue comment` then `gh issue edit --add-label reshape_spec --add-assignee <escalate_to>`, and stores each outcome (R3–R6, contracts/github-notice.md, data-model.md).

**Independent Test**: With the stub gh, a recorded `RESHAPE_SPEC` assessment for PR 7 bound to `specs/123-login` leaves `$GH_LOG` with exactly the comment then the edit on issue 123; a repeated delivery adds nothing.

### Tests for User Story 2 ⚠️ (write first, confirm red)

- [ ] T014 [P] [US2] Red tests in `reviewer/tests/test_reshape.py` (quickstart #16): `issue_of("specs/123-x") == 123`, `issue_of("dev/a/specs/111-x") == 111`, and `None` for `specs/020-x`, `specs/x`, `specs/0-x` (regex `^([1-9][0-9]*)-` on the last path segment).
- [ ] T015 [P] [US2] Red tests in `reviewer/tests/test_reshape.py` (quickstart #15, FR-013): `reshape.comment(folder, assessment, pr=118, rnd)` for an internal round 3 equals `alq-review ruled #118, internal round 3 RESHAPE_SPEC: the spec has to be reshaped before this PR's code may change.\n\n` + `reshape.summary(folder, assessment)`, and contains no checkout root, round ref or session id.
- [ ] T016 [P] [US2] Red tests in `reviewer/tests/test_ledger.py` (data-model.md Transitions/Validation): `claim_notice(state, ref, issue)` sets `rnd["notice"] = {"issue": 123, "comment": None, "edit": None}` and returns it; a second claim returns `None` and changes nothing; with `issue=None` both outcomes are stored at claim time as `{"error": "spec folder <path> names no issue"}`. `record_notice(state, ref, outcomes)` sets `comment`/`edit` to `{"done": true}` or `{"error": "<msg>"}`, and raises `LedgerError` when the round has no `notice` or an outcome is already set.
- [ ] T017 [P] [US2] Red tests in `reviewer/tests/test_gate.py` for `hookio.escalate_to()` (quickstart #13 unit part): returns the config value; raises `ValueError` naming `escalate_to` when the key is missing, not a string, or blank. No default.
- [ ] T018 [US2] Red tests in `reviewer/tests/test_gate.py` (quickstart #3, #4, #5): recording a `RESHAPE_SPEC` assessment (PostToolUse StructuredOutput) for PR 7 bound to `specs/123-login` leaves `$GH_LOG` with exactly `issue comment 123 --repo acme/demo --body …` then `issue edit 123 --repo acme/demo --add-label reshape_spec --add-assignee <config escalate_to>`; the stored `notice` has both outcomes `{"done": true}`; delivering the same payload again makes no gh call; a later round ruled `RESHAPE_SPEC` gets its own comment and edit.
- [ ] T019 [US2] Red tests in `reviewer/tests/test_gate.py` (quickstart #6, #7, #8, #14): no gh call for verdict `PATCH`, `ESCALATE`, or a spec-held launch; none for `spec: null` (and its `unlock #7` reply is today's close-and-restart text); none for `specs/020-decision-review` (stored notice errors name the folder); `ALQ_REVIEW_MODE=log` still posts both calls.
- [ ] T020 [US2] Red test in `reviewer/tests/test_gate.py` (quickstart #13 gate part): with `escalate_to` blank in a test config, the comment is posted, `gh issue edit` is not run, and the edit's stored outcome is the `ValueError` text.

### Implementation for User Story 2

- [ ] T021 [P] [US2] Add `issue_of(folder: str) -> int | None` and `comment(folder, assessment, pr, rnd) -> str` to `reviewer/plugin/scripts/reshape.py` per contracts/github-notice.md; `comment` embeds `summary`. T014, T015 pass.
- [ ] T022 [P] [US2] Add `claim_notice(state, ref, issue)` and `record_notice(state, ref, outcomes)` to `reviewer/plugin/scripts/ledger.py` per data-model.md, raising `LedgerError` as specified. T016 passes.
- [ ] T023 [P] [US2] Add `comment_issue(slug, number, body)` (`gh issue comment N --repo slug --body body`) and `escalate_issue(slug, number, label, assignee)` (`gh issue edit N --repo slug --add-label label --add-assignee assignee`) to `reviewer/plugin/scripts/github.py`, both through `_answer` (line ~18) so they raise `RuntimeError` in gh's words. Never create a label.
- [ ] T024 [P] [US2] Add `"escalate_to": "Analitiq-Bot-Wonka"` to `reviewer/plugin/config.json` and `escalate_to() -> str` to `reviewer/plugin/scripts/hookio.py`, modelled on `max_review_files` (line ~44): raise `ValueError` naming the key when missing, not a string, or blank. The account name appears nowhere in code. T017 passes.
- [ ] T025 [US2] In `after_structured_output` in `reviewer/plugin/scripts/gate.py` (line ~715; caller: `handle` on PostToolUse StructuredOutput): inside the `open_ledger` block that calls `ledger.record_assessment`, when the recorded verdict is `RESHAPE_SPEC` and `briefs.spec_folder(state)` is a folder, call `ledger.claim_notice(state, ref, reshape.issue_of(folder))`. After the block commits, only for a notice just claimed with a non-null issue: call `github.comment_issue` (catch `RuntimeError` → `{"error": msg}`), then read `hookio.escalate_to()` (catch `ValueError` → edit `{"error": msg}`, no call) and call `github.escalate_issue(..., "reshape_spec", assignee)` (catch `RuntimeError`), whatever the comment returned. Then reopen the ledger and `ledger.record_notice`. Do not hold the ledger transaction across `gh` calls; no retry; never change the ruling or lock (FR-011). Depends on T021–T024. T018, T019, T020 pass.

**Checkpoint**: US2 complete: one notice per ruling, on the folder's issue, with label and assignee.

---

## Phase 5: User Story 3 - A notice that cannot be posted is said, not swallowed (Priority: P2)

**Goal**: A failed or unrecorded call is shown, by one renderer, in the lock refusal and the `unlock` reply (R7). The lock is unchanged.

**Independent Test**: Stub gh fails the edit; the lock refusal and `unlock #7` reply both quote the error; no later event calls gh.

### Tests for User Story 3 ⚠️ (write first, confirm red)

- [ ] T026 [P] [US3] Red tests in `reviewer/tests/test_reshape.py` for `notice_failures(rnd)`: `""` with no `notice` or both `{"done": true}`; for an `{"error": e}` edit, `The RESHAPE_SPEC notice on <owner/repo>#<issue> failed: the reshape_spec label and assignee was not posted (<e>). Do it by hand.`; same shape for the comment (`the comment`); a `null` outcome reads `GitHub's answer was not recorded` followed by "check the issue"; the no-issue failure names the folder instead of an issue. One sentence per failed call.
- [ ] T027 [P] [US3] Red tests in `reviewer/tests/test_policy.py` (quickstart #11, FR-011): a verdict-locked state whose round has a failed `notice` still makes `policy.mutation` refuse, its reason contains `reshape.notice_failures(rnd)`; with a fully done notice the reason is unchanged from today.
- [ ] T028 [US3] Red tests in `reviewer/tests/test_gate.py` (quickstart #9, #10, #17, US3-3): with `GH_FAIL_EDIT="could not add label: 'reshape_spec' not found"`, the comment is still made, the next edit/commit on the locked branch is refused naming issue #123 and the error, the `unlock #7` reply says the same, and no later event logs a gh call; with `GH_FAIL_COMMENT` set the edit is still attempted and both outcomes are stored; with both calls done neither text carries a notice sentence; with a claimed notice whose outcomes are left `null` both texts say GitHub's answer was not recorded for issue #123.

### Implementation for User Story 3

- [ ] T029 [US3] Add `notice_failures(rnd) -> str` to `reviewer/plugin/scripts/reshape.py` per contracts/github-notice.md "Failure text". T026 passes.
- [ ] T030 [US3] In `_holds` in `reviewer/plugin/scripts/policy.py` (line ~84; callers: `locked`, `_lock_reason` ← `_obstacle` / `launch_round` ← `mutation`, `rerequest`, `mark_ready`, and gate's `_held` / `hold` / `_unlock`), append `reshape.notice_failures(rnd)` to the verdict-lock hold's "why". `_verdict_locked` must not read `notice`. T027 passes.
- [ ] T031 [US3] In `_unlock` in `reviewer/plugin/scripts/gate.py` (line ~214), append `reshape.notice_failures(rnd)` for the ruled round to the reply. Do not remove the label or assignee, and do not clear `notice` (FR-011a). T028 passes.

**Checkpoint**: All stories pass independently.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T032 [P] Update `reviewer/plugin/README.md`: the enforces-2 text (ruling → result names the spec folder; notice posted to the spec's issue with `reshape_spec` label and `escalate_to` assignee; failures shown in the lock refusal and unlock reply), the Mode/config section with the `escalate_to` key, and a Layout row for `scripts/reshape.py`.
- [ ] T033 Run the full suite `cd reviewer/tests && python3 -m unittest` and walk quickstart.md scenarios 1–17, confirming each maps to a passing test.
- [ ] T034 Before shipping, by hand (needs user confirmation; outward-facing): `gh label create reshape_spec --repo analitiq-ai/claude-plugins-internal --description "A review ruled the spec must be reshaped"`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)**: none. Blocks every `test_gate.py` gh-call test (T018–T020, T028).
- **Foundational (T002–T005)**: after Setup. Blocks US1's unlock check and all of US2/US3.
- **US1 (T006–T013)**: after Foundational.
- **US2 (T014–T025)**: after Foundational; T025 reads `briefs.spec_folder` from T010, so after T010.
- **US3 (T026–T031)**: after US2 (it renders the `notice` US2 stores).
- **Polish (T032–T034)**: after all stories.

### Within Each Story

- Tests first and red, then implementation.
- `reshape.py` / `ledger.py` / `github.py` / `hookio.py` before `gate.after_structured_output` (T025).
- `reshape.notice_failures` (T029) before `policy._holds` (T030) and `gate._unlock` (T031).

### Parallel Opportunities

- T002 ∥ T003 (different files).
- US1 tests T006–T009 together (same file, independent test classes); T012 ∥ T013 (different JS files).
- US2: T014 ∥ T015 ∥ T016 ∥ T017 as tests; T021 ∥ T022 ∥ T023 ∥ T024 as implementation.
- US3: T026 ∥ T027.

---

## Parallel Example: User Story 2

```bash
# Implementation of the four leaf modules together:
Task: "issue_of + comment in reviewer/plugin/scripts/reshape.py"
Task: "claim_notice + record_notice in reviewer/plugin/scripts/ledger.py"
Task: "comment_issue + escalate_issue in reviewer/plugin/scripts/github.py"
Task: "escalate_to in reviewer/plugin/config.json + scripts/hookio.py"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. T001–T005 (setup + one renderer)
2. T006–T013 (spec_folder on both paths)
3. Validate: the `assess-round` result names the folder and the unlock text is unchanged.

### Incremental Delivery

1. MVP → US2 (GitHub notice) → US3 (failure shown). US2 alone posts notices but its failures are only in the ledger, so US2 and US3 ship in the same PR.

### Notes

- `test_gate.py` and `gate.py` are touched by several tasks; batch each file's edits into one commit per story to stay under the pr-review-loop three-edit tripwire.
- `config.json` names the account; no code literal may.
