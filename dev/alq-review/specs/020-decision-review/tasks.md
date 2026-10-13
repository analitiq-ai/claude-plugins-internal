---

description: "Task list: the internal review round checks the diff against the decisions that govern it"
---

# Tasks: The internal review round checks the diff against the decisions that govern it

**Input**: Design documents from `dev/alq-review/specs/020-decision-review/`

**Tests**: every implementation task follows a test task whose first run fails for the reason it names
(constitution IV). Which cases each test covers is decided when it is written, from the spec's scenarios and
data-model.md; this list does not enumerate them.

**Organization**: one user story (US1), one PR. The ADR and the constitution lines ship first, in their own PR
(constitution VI, FR-019, FR-021).

Paths are from the repository root. Tests run with `python -m unittest -v` from `dev/alq-review/tests/`.

---

## Phase 1: The governing rule, its own PR first

Branch `88-adr-notice`, merged before any code task (R13).

- [ ] T001 Write ADR-0020 in `dev/alq-review/docs/adr/` in ADR-0018's form: the user's notice choice (FR-012, FR-019). `adr lint` reports no error on it.
- [ ] T002 In `dev/alq-review/.specify/memory/constitution.md` Platform Constraints, name `decision_checks` beside the claim and shim settings, and the decision reviewer as this plugin's own agent.
- [ ] T003 Open the PR, run the review loops (`.claude/rules/pr-review-loop.md`), merge.

---

## Phase 2: Foundation

Branch `88-us1-decision-review`.

- [ ] T004 [P] `config.json`: `decision_checks` and `max_review_files` (R15, R16). `plugin.json`: 0.14.0.
- [ ] T005 [P] `.github/workflows/tests.yml`: node 22 and the pinned adrkit install (R12).
- [ ] T006 Red, then green: `worktree.files_in` over a range, replacing `changed_files`; tracked corpora (R2).
- [ ] T006a Red, then green: `worktree.is_dirty` counts untracked files and `policy.launch_round`'s refusal names commit, delete or ignore (R18, FR-023).
- [ ] T007 Red, then green: `hookio` reads `decision_checks` and `max_review_files`, and each refusal helper blocks as data-model § Refusals says (R15).
- [ ] T008 Red, then green: the gate's deadline, pinned to `hooks/hooks.json`, and the seconds each launch step spends (R7).

---

## Phase 3: User Story 1 - A review round is checked against every decision that governs the change (P1)

**Independent Test**: launch internal rounds through the gate's hook handler for each spec scenario and read the
injected arguments, the refusal or the round's result.

- [ ] T009 [US1] Capture `adr check --json`'s answer on a fixture corpus outside any `docs/adr` path; a test re-runs it and compares (R4, R14).
- [ ] T010 [US1] Red, then green: `scripts/decisions.py`, the pure rules (R6, data-model), tested on the captured answer.
- [ ] T011 [US1] Red, then green: `scripts/adrkit.py`, one outcome per corpus, every cause of data-model § Corpus outcome (R5); contract tests run the real adrkit.
- [ ] T012 [US1] Red, then green: `briefs.py` adds the decision reviewer and its prompt, and injects `args.decisions` (R8, R9, contracts/interfaces.md).
- [ ] T013 [P] [US1] Red, then green: `agents/decision-reviewer.md` (R8).
- [ ] T014 [US1] Red, then green: `gate.py` runs the check at internal launches, refuses per data-model § Refusals in each mode, refuses solo dispatch of the decision reviewer, and writes its rulings to `gate.log` (R1, R10, R17). One test per spec scenario the gate decides.
- [ ] T015 [US1] Red, then green: `review-round.js` echoes `decisions` in every result (R9).
- [ ] T016 [US1] README: item 8, Mode, Layout, Dependencies (FR-020, R12), with a test that the README gives the install step.

---

## Phase 4: Finish

- [ ] T017 Run the suite with `CI=1` and adrkit installed, then quickstart.md by hand on the PR's own branch; record what ran in the PR description.
- [ ] T018 Tripwire (`git log --name-only main..HEAD | sort | uniq -c | sort -rn`), open the PR, run the review loops.

---

## Order

- Phase 1 merges before Phase 2 starts.
- T004–T008 are independent of each other.
- T009 → T010 → T011; T012 needs T010; T014 needs T007, T008, T011, T012, T013; T015 and T016 follow T014.
