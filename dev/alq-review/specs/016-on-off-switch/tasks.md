---

description: "Task list for the alq-review on/off switch"
---

# Tasks: On/off switch for alq-review

**Input**: Design documents from `/specs/016-on-off-switch/`

**Prerequisites**: plan.md, spec.md, research.md (R1–R8), data-model.md, contracts/switch-keywords.md, quickstart.md

**Tests**: Required. Constitution IV: every mechanism starts from a test that is written, run, and fails for the
reason it names before the implementation task after it begins. Gate tests drive `scripts/gate.py` and
`scripts/pre_merge_gate.py` with hook payloads; no test calls a model. T001 and T002 are live measurements.

**Organization**: by user story from spec.md, in priority order.

**Before T001**: work in a worktree at `.claude/worktrees/35` on `feat/35-on-off-switch` (#35). One PR.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: US1, US2 from spec.md

## Path Conventions

Code paths are relative to `plugins/alq-review/`; test paths to `dev/alq-review/`; `specs/` paths to
`dev/alq-review/`. Tests run from `dev/alq-review/` with
`ALQ_REVIEW_STATE_DIR=$(mktemp -d) python3 -m unittest discover -s tests`. Switch gate tests go in a new
`tests/test_switch.py` whose `Switch` class subclasses `Gate` from `tests/test_gate.py`, as
`tests/test_claim_gate.py` does; merge-gate cases go in `tests/test_pre_merge_gate.py` beside `MergeOverride`.

Callers before this feature's edits (coding principles): `hookio.session_file` was called by
`hookio.session_state` and by `gate.inflight_count`, so by every reviewer count, held-branch snapshot and fetch-host read;
`gate.handle` by `gate.main`; `gate.on_prompt` and `gate.on_workflow` by `gate.handle`; `pre_merge_gate.main`
by the PreToolUse `Bash` hook and the `UserPromptSubmit` hook. A task that edits one of these re-runs the full suite
before it is done.

---

## Phase 1: Setup (two measurements)

**Purpose**: settle the two facts the plan leaves unmeasured. Each uses a throwaway hook that appends its
payload to a file in the scratch directory; delete the hook afterwards. Neither changes shipped code.

- [X] T001 Measure and record in `specs/016-on-off-switch/research.md` R7: register a throwaway `SessionStart`
  and `UserPromptSubmit` hook that logs `session_id` and `source`. Start a session, note its id, leave, resume
  it (`claude --resume`, then `claude --continue`), submit a prompt, and trigger a compaction. Record for each
  whether `session_id` is unchanged and which `source` arrived. If a resumed session gets a new id: amend
  spec.md's Assumptions and FR-009 (the switch ends at resume), build T017 for `compact` only, and say so in
  the PR. Do not carry a switch across ids.
- [ ] T002 [P] Measure and record in `specs/016-on-off-switch/research.md` R3: with the same throwaway
  `UserPromptSubmit` hook, deliver a prompt that starts with `alq-review off` by each route an agent controls:
  a `ScheduleWakeup` prompt, a cron prompt (`CronCreate`), and a `SendMessage` from another session. Record for
  each whether the hook fired and every payload field that differs from a typed prompt. Add one line to
  spec.md's Assumptions with the result. This does not gate the feature (R3, R8); if a route fires and cannot be
  told from typing, recommend an issue for it covering `unlock` too, and wait for the user.

---

## Phase 2: Foundational (the switch's state)

**Purpose**: the one fact every later task reads.

**⚠️ CRITICAL**: no user story work begins until this phase is complete.

- [X] T003 Write failing tests in `tests/test_switch.py` for `hookio.session_file` and `hookio.switch_state`:
  a `session_id` that does not match `[\w-]+` (`../x`, empty, missing) builds no path and holds no state; no
  file → `on`; a file `{"at": <stamp>, "by": <string>}` → `off`; a file that is not JSON, lacks a field, has a
  non-string field or an extra field → `unreadable`, and one entry is appended to `errors.log`; `switch_state`
  creates no file and takes no lock. Run them; confirm each fails because the function or the check is missing.
- [X] T004 Implement in `scripts/hookio.py`: the id check inside `session_file` (one place, every caller);
  `switch_state(payload) -> "on" | "off" | "unreadable"` reading `session_file(payload, ".off")` with a plain
  read. Shape per data-model.md: "Both fields are required, both strings; nothing else is allowed." Run the
  full suite: the reviewer-count, held-snapshot and fetch-host tests must pass unchanged.

**Checkpoint**: the state can be read; nothing writes it or acts on it yet.

---

## Phase 3: User Story 1 - Turn the plugin off and on again (Priority: P1) 🎯 MVP

**Goal**: `alq-review off` stops every rule in that session; `alq-review on` brings them back with nothing reset.

**Independent Test**: quickstart.md section 2.

### Tests for User Story 1

> Write these first; run them; each must fail because nothing reads or writes the switch yet.

- [X] T005 [US1] In `tests/test_switch.py`, the keyword: `alq-review off` at the start of a prompt (leading
  whitespace allowed) creates the session's `.off.json` with `at` and `by` ("the first line of the prompt … at
  most 200 characters"), answers with both `systemMessage` and `additionalContext` carrying the contract's off
  text, and writes one `gate.log` line with `action` `switch`, `decision` `off`; `alq-review on` deletes the
  file, answers with the on text, logs `on`; each typed again answers "already off" / "already on", changes
  nothing, logs `unchanged`; the words in the middle of a prompt, or after other text on the first line, change
  nothing and answer nothing.
- [X] T006 [US1] In `tests/test_switch.py`, one test per "stopped" row of the contract's table, each first
  shown refused with the plugin on, then not refused after `alq-review off`, with no `gate.log` line and no
  `git`/`gh` call made (stub them to fail if called): Edit on a branch with an unassessed round; Bash `git
  commit` with no claim or shim check; `git push`; `gh pr ready`; an attestation comment; `ledger.py unlock`;
  a command that changes a held branch (no snapshot before, no block after); Agent dispatch of an internal
  reviewer; Skill `pr-review-toolkit:review-pr`; a reviewer's StructuredOutput (neither validated nor
  recorded); an inbox file left unread.
- [X] T007 [US1] In `tests/test_switch.py`, one test per "runs" row while off: `unlock #<pr>` releases a
  locked ledger; `override shim-<id>` and `unlock claim-<id>` are handled; SubagentStart/Stop still change the
  reviewer count; the contest judge's WebFetch to an uncited host is still refused.
- [X] T008 [US1] In `tests/test_switch.py`, the launch answer: with the plugin off, a `Workflow` call for each
  of `alq-review:review-round`, `assess-round`, `claim-check`, `shim-check` is denied with the contract's text
  naming that workflow, in `enforce` and in `log` mode, and writes nothing to `ledger.db`; a `Workflow` call for
  any other name gets no answer.
- [X] T009 [US1] In `tests/test_switch.py`, scope and restoration: a payload with another `session_id` is
  refused exactly as before while the first session is off (SC-006); after `alq-review on` the first session's
  Edit is refused again with the same reason; a byte copy of `ledger.db` taken before `alq-review off` equals
  the one after `alq-review on` when nothing else ran (SC-005); with `ALQ_REVIEW_MODE=log`, off records no
  `would_deny` and on records them again (FR-013).
- [X] T010 [P] [US1] In `tests/test_pre_merge_gate.py`, a `MergeSwitch` class: with the session off, `gh pr
  merge` without an attestation, `gh pr ready`, `gh pr merge --admin` and `gh api --method PUT
  .../pulls/N/merge` all exit 0 with no `gh` call; another session is refused as before; an `override-merge #N`
  prompt is still granted while off; an `unreadable` switch file gates as on.

### Implementation for User Story 1

- [X] T011 [US1] In `scripts/gate.py`: the keyword pattern `alq-review\s+(on|off)\b` beside `UNLOCK`, and its
  branch at the top of `on_prompt` (before the claim, shim and unlock patterns): write or unlink
  `hookio.session_file(payload, ".off")` (not `session_state`, which writes the file back on exit, so it cannot
  delete one), `hookio.record(payload, "switch", ...)`, and one output with
  `systemMessage` and `additionalContext`. Answer texts are the contract's, defined once. Passes T005.
- [X] T012 [US1] In `scripts/gate.py` `handle`: read `hookio.switch_state(payload)` once; `UserPromptSubmit`,
  `SubagentStart`/`SubagentStop` and the contest judge's `WebFetch` are dispatched whatever it says; when it is
  `off`, a `Workflow` call naming one of the plugin's four workflows is denied with the contract's launch
  answer, and every other event returns nothing, before `ledger.ingest_inbox` runs. Passes T006–T009.
- [X] T013 [US1] In `scripts/pre_merge_gate.py` `main`: after the `UserPromptSubmit` branch, return 0 when
  `hookio.switch_state(payload)` is `off`, importing `hookio` inside `main`'s guard as `released` imports
  `github`. Passes T010.
- [X] T014 [US1] Run the full suite from `dev/alq-review/`. Every test that existed before this branch passes
  unchanged (SC-003).

**Checkpoint**: quickstart.md section 2 passes live. The feature is usable.

---

## Phase 4: User Story 2 - Know that it is off (Priority: P2)

**Goal**: a wrong keyword is answered, a damaged switch is reported, a resumed session says it is off.

**Independent Test**: quickstart.md section 3.

### Tests for User Story 2

- [X] T015 [US2] In `tests/test_switch.py`: `alq-review off please` and `alq-review on claim-check` change
  nothing, answer with the contract's "is not a switch" text quoting the line, and log `unknown`; with an
  `unreadable` file, any prompt's output carries a `systemMessage` saying the switch could not be read and the
  plugin counts as on, an Edit that would be refused is still refused, `alq-review off` rewrites the file to a
  valid one and `alq-review on` deletes it.
- [X] T016 [US2] In `tests/test_switch.py`: a `SessionStart` payload with `source` `resume` for a session that
  is off returns `systemMessage` and `additionalContext` "alq-review is off in this session."; `source`
  `compact` returns `additionalContext` only; a session that is on returns nothing for either; `hooks.json`
  registers `SessionStart` with matcher `resume|compact` running `scripts/gate.py`. Adjust to T001's result
  before writing.

### Implementation for User Story 2

- [X] T017 [US2] In `scripts/gate.py`: the further-word answer and the unreadable `systemMessage` in
  `on_prompt`; a `SessionStart` branch in `handle`. In `hooks/hooks.json`: the `SessionStart` registration.
  Passes T015, T016.

**Checkpoint**: quickstart.md section 3 passes live.

---

## Phase 5: Polish & Cross-Cutting Concerns

- [X] T018 [P] `README.md`: a `## Switch` section after `## Mode` (the two keywords, session scope, what off
  lifts including locks, the attestation and `--admin` / `gh api` merges, what keeps running, that `gate.log`
  shows nothing between the off line and the on line, and that off differs from `log`); `sessions/<id>.off.json`
  under `## State`. Change the crash message in `gate.main` only if it names a step that is now wrong; it does
  not today.
- [ ] T019 Run quickstart.md sections 2 and 3 live in a scratch GitHub-origin repo and note the result in the PR.
- [ ] T020 Tripwire before opening the PR: `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; any
  file above 3 edits is rewritten once from the settled shape, not patched again.

---

## Dependencies & Execution Order

- **Phase 1**: T001 and T002 are independent of each other and of Phase 2; T001 must finish before T016.
- **Phase 2**: T003 → T004. Blocks everything after.
- **US1**: T005–T010 (tests) before T011–T013; T011 before T012 (the tests of T012 type the keyword); T013 is
  independent of T011–T012 once T004 is done; T014 last.
- **US2**: needs T011 and T012. T015, T016 → T017.
- **Polish**: after US2.

### Parallel Opportunities

- T001 ‖ T002.
- T010 and T013 (`test_pre_merge_gate.py`, `pre_merge_gate.py`) ‖ T005–T009 and T011–T012 (`test_switch.py`, `gate.py`).
- T018 ‖ T019.

T005–T009 share `tests/test_switch.py` and T011, T012, T017 share `scripts/gate.py`, so they run in order.

## Implementation Strategy

MVP is Phases 1–3: the switch works and is recorded. US2 adds the answers that keep it from being forgotten or
mistyped; ship both in the one PR. `gate.py` is edited by three tasks (T011, T012, T017): write the switch's
part of `on_prompt` and `handle` once from the contract, in that order, so the third edit adds branches and
reshapes nothing.
