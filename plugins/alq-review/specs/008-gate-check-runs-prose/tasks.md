---

description: "Task list for #9: gate verdicts are check runs"
---

# Tasks: Gate verdicts are check runs (#9)

**Input**: Design documents from `specs/008-gate-check-runs-prose/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/gate-prose.md, quickstart.md

**Tests**: Prose has no unit under test. The red/green checks are the quickstart greps (Constitution
IV): run red on `main` first, then green on the branch. No test files are added (FR-007).

**Organization**: Tasks are grouped by user story. Both stories edit
`.claude/skills/alq-github-pr-review/SKILL.md`, so US2 runs after US1 on that file.

**State at task time**: commit `2e484ad` holds most of the change; the working tree holds the
uncommitted R2 rule edit (`pr-review-loop.md:15`) and the R3 SKILL.md rewrite (`SKILL.md:12`). Tasks
verify and finish that diff; they do not start over.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 or US2 from spec.md

---

## Phase 1: Setup (red checks on `main`)

**Purpose**: Prove the checks fail on `main` for the stated reason before the branch is checked green.

- [X] T001 Run quickstart step 1 against `main`: `git grep -n "commit status" main -- .claude/rules .claude/skills/alq-github-pr-review/SKILL.md`. Expected matches: `.claude/rules/pr-review-loop.md:15`, `.claude/skills/alq-github-pr-review/SKILL.md:12` and `:20`. Record the actual output in the PR body (critique E4).
- [X] T002 [P] Run quickstart step 4 against `main`: `git grep -n "gate statuses\|description" main -- .claude/skills/alq-github-pr-review/SKILL.md` and confirm `main` says "description" about `codex-review` (`SKILL.md:12-16`) and has no "gate check runs". Record the output in the PR body.

---

## Phase 2: Foundational (gate facts pinned at a SHA)

**Purpose**: Every gate fact the prose keeps must be read at the source this session (critique E3, blocking).

**⚠️ CRITICAL**: US1 and US2 cannot be checked green until this phase is done.

- [X] T003 Fetch `pr-gate.js` at `9bd2b2997c038dd60dea1f1464189c029ac33cfa`: `gh api "repos/analitiq-ai/.github/contents/.github/scripts/pr-gate.js?ref=9bd2b2997c038dd60dea1f1464189c029ac33cfa" --jq .content | base64 -d`. Confirm: (a) every outcome sets its reason as the check run title (`:215-263`, `:511`); (b) a 👍 tied to the head counts (`:131-156`); (c) `:446-448` maps `pending`/`success`/`error` to `in_progress`/completed-`success`/completed-`failure`. If any line reference is wrong, correct it in `specs/008-gate-check-runs-prose/research.md` R3 and `specs/008-gate-check-runs-prose/quickstart.md` step 3 before going on.
- [X] T004 [P] Confirm the poller facts R5 relies on in `.claude/skills/alq-github-pr-review/poll-pr-review.sh` (read-only, not edited): `GATE_APP="analitiq-pr-gate"` (`:52`); app filter (`:176`); `$running` excludes `.gate` (`:190`) and ignored checks (`:186`); `gate_lags` with `GATE_SWEEP_MINUTES=20` (`:56`, `:213-215`) counts only when `.findings == 0` (`:229`); `dispatched` set once (`:339-341`); severity only for Codex, CodeRabbit, DeepSource (`:137-140`); author threads filtered (`:196`); heading `Gate check runs:` (`:235`).

**Checkpoint**: gate and poller facts confirmed at a fixed revision.

---

## Phase 3: User Story 1 - Agent reads the gate's verdict from the right object (Priority: P1) 🎯 MVP

**Goal**: Both files name `codex-review` (and SKILL.md also `internal-review`) as check runs from the `analitiq-pr-gate` App; the rule points to the skill.

**Independent Test**: quickstart steps 1, 2 and 4 are green on the branch.

- [X] T005 [P] [US1] In `.claude/rules/pr-review-loop.md:15`, confirm the bullet reads: "The executor responds ~10–15 min after the request. Its verdict is the `codex-review` check run the `analitiq-pr-gate` App posts on the head; the `alq-github-pr-review` skill says what its states mean." It MUST NOT mention states, the title, the 👍, `WAIVED`, or "commit status" (contracts/gate-prose.md; FR-001, SC-002). Fix the bullet if it differs.
- [X] T006 [P] [US1] In `.claude/skills/alq-github-pr-review/SKILL.md`, confirm `codex-review` and `internal-review` are called check runs from the `analitiq-pr-gate` App (`:12` and the blockers paragraph at `:18`), and that no sentence calls a gate run a "commit status" or speaks of its "description" (FR-002). Leave the DeepSource "no status carries that" clause (`:18`) unchanged (contracts/gate-prose.md).
- [X] T007 [US1] In `.claude/skills/alq-github-pr-review/SKILL.md`, confirm every reference to the poller's gate output says "gate check runs" / *Gate check runs* — the settle paragraph (`:35`) and the exit-4 row (`:43`) — and none says "gate statuses" (FR-004). Depends on T006 (same file).
- [X] T008 [US1] Confirm the poller-describing clauses in `.claude/skills/alq-github-pr-review/SKILL.md:35` match T004's findings (settle rule excludes gate runs and ignored checks; lagging in-progress `codex-review` holds only with nothing to triage and only for 20 min after Codex's answer; one gate sweep; severity only for Codex, CodeRabbit and DeepSource; PR-author threads left out) (FR-005). Depends on T004, T007.
- [X] T009 [US1] Confirm neither file mentions override-merge, on `main` or the branch: `grep -n override-merge .claude/rules/pr-review-loop.md .claude/skills/alq-github-pr-review/SKILL.md` and `git grep -n override-merge main -- <same files>` print nothing (FR-006).
- [X] T010 [US1] Run quickstart steps 1, 2 and 4 on the working tree: step 1 prints nothing; step 2 counts ≥1 `analitiq-pr-gate` in each file and the `👍|title|WAIVED` grep on `.claude/rules/pr-review-loop.md` prints nothing; step 4 shows "gate check runs" in SKILL.md and no "gate statuses".

**Checkpoint**: an agent reading either file looks for the right object.

---

## Phase 4: User Story 2 - Agent reads the gate's verdict from its title (Priority: P2)

**Goal**: SKILL.md tells agents to act on the run's state and title as the poller prints them, and lists no gate states or success conditions.

**Independent Test**: quickstart step 3 is green; no SKILL.md sentence names a gate outcome list.

- [X] T011 [US2] In `.claude/skills/alq-github-pr-review/SKILL.md:12`, confirm the three-state bullet list (`success` … / in progress … / `failure` …) is gone and the paragraph ends: "Act on that run's state and title as the poller prints them under *Gate check runs*; the title gives the reason for the state." (R3; FR-003). Depends on T007 (same file).
- [X] T012 [US2] Check the 👍 paragraph at `.claude/skills/alq-github-pr-review/SKILL.md:14` against T003(b): it states only that the gate may count a 👍 tied to the head (else says why in the `codex-review` title) and that a reaction starts no workflow, so the poller dispatches one gate sweep. It MUST NOT add success conditions. Depends on T003, T011.
- [X] T013 [US2] Run quickstart step 3: `grep -nE "^- .*(success|pending|in progress|failure)" .claude/skills/alq-github-pr-review/SKILL.md` prints nothing (SC-003).

**Checkpoint**: no SKILL.md sentence becomes false if the gate adds or renames an outcome.

---

## Phase 5: Polish & delivery

**Purpose**: Scope check, cleanup, commit, PR.

- [X] T014 Keep `specs/9.md` untracked: it is `alq-issue-tackle`'s local copy of the issue spec and leaves with the worktree (critique E5 pushed back, 2026-10-04).
- [X] T015 Commit `.claude/rules/pr-review-loop.md`, `.claude/skills/alq-github-pr-review/SKILL.md` and `specs/008-gate-check-runs-prose/` with message `docs(#9): …`, the `alq-session-id:` trailer and the `Co-Authored-By` line.
- [X] T016 Run quickstart step 5: `git diff --name-only main...HEAD` lists only `.md` files under `.claude/rules/`, `.claude/skills/` and `specs/` (SC-004, FR-007). Run the tripwire `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; flag any file above 3.
- [X] T017 Run quickstart step 6: read both files against `specs/008-gate-check-runs-prose/contracts/gate-prose.md`, every MUST / MUST NOT.
- [X] T018 Push `docs/9-gate-check-runs-prose` and open a DRAFT PR on `analitiq-ai/engineering` closing #9, with T001/T002 red output and the green quickstart output in the body.
- [ ] T019 Run the internal review loop per `.claude/rules/pr-review-loop.md` (`alq-review:review-round`, stage `internal`; `assess-round` on findings) until clean or CONVERGED_PUSHBACK; then mark ready. This repo has no Codex/DeepSource; merge with a normal squash once CI is green, keeping the `alq-session-id:` trailer.

---

## Dependencies & Execution Order

- **Phase 1** (T001–T002): no dependencies; must run before any green check.
- **Phase 2** (T003–T004): blocks T008 and T012.
- **US1** (T005–T010): after Phase 1. T005 and T006 are parallel (different files); T007 → T008 serial on SKILL.md.
- **US2** (T011–T013): after T007 (shared SKILL.md); T012 needs T003.
- **Polish** (T014–T019): after US1 and US2; T015 → T016 → T018 → T019 serial.

### Parallel Opportunities

- T001 ∥ T002; T003 ∥ T004 (one reads another repo, the other this repo's poller).
- T005 ∥ T006 (rule file vs skill file).
- T017 runs after T015.

## Parallel Example: User Story 1

```text
Task: "T005 Confirm pr-review-loop.md:15 names the run, the App and points to the skill"
Task: "T006 Confirm SKILL.md names codex-review/internal-review as analitiq-pr-gate App check runs"
```

## Implementation Strategy

1. Phase 1 red checks → Phase 2 source reads.
2. US1 (MVP): agents read the right object. Validate with quickstart 1, 2, 4.
3. US2: drop the copied state list. Validate with quickstart 3.
4. Polish: scope check, commit, draft PR, internal review, merge.

## Notes

- Out of scope: the `codex_gate_missing` WARNING guidance (spec Edge Cases), override-merge semantics and retiring `pr-gate.yml` (#17), `tests/test_poll_pr_review.py:19` "gate status" wording (next poller code PR, critique E6).
