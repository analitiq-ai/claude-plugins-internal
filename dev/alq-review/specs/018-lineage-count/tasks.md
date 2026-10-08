# Tasks: A held region stays the same through rewording

**Input**: `specs/018-lineage-count/` (plan.md, spec.md, research.md, data-model.md, contracts/lineage.md, quickstart.md)

**Tests**: Requested. Constitution IV and R15 require each contract sequence as a test, written and seen to fail
for its stated reason before the code. Every test task below is run red first; a test that is green on its first
run is reported as such (it then grades only wiring) and not counted as proof.

**Organization**: by user story. Phase 2 holds what every story needs (the pure mapping, the git diff of two
texts, the new tables).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: different files, no dependency on an incomplete task
- Paths are from the repository root. Run tests from `dev/alq-review/`:
  `python3 -m unittest discover -s tests`
- Source is `plugins/alq-review/scripts/`; tests are `dev/alq-review/tests/`
- Row names (C1, B3, X1 ...) are the sequences in `contracts/lineage.md`; R-numbers are `research.md`

## Rules for every task

- Before editing code that runs, name its callers in the message first (plan.md, Structure Decision lists them).
- Third edit to one file: stop and diagnose (pr-review-loop). Files touched in more than one task below, with the
  reason: `claimgate.py` (T017, T021, T023), `claimcheck.py` (T015, T020), `shimcheck.py` (T016, T026),
  `ledger.py` (T012, T029), `lineage.py` (T010, T011). Where a task is the third, rewrite once from the settled
  shape instead of patching.

---

## Phase 1: Setup (measurements; nothing is edited but research.md and tests.yml)

**Purpose**: the three facts the plan marks "To measure" are settled before code rests on them.

- [X] T001 Run `python3 -m pip install diff-match-patch` in a scratch venv and on the system Python: record the latest PyPI version and whether the command named in the refusal succeeds on a system-managed Python (R13). Write both into the R13 "To measure" paragraph of `specs/018-lineage-count/research.md`; if the plain command fails there, record the form that works, which the refusal must then name.
- [X] T002 [P] Measure R3: in a scratch repo write two texts as blobs with `git hash-object -w --stdin`, run `git diff -U0 <old blob> <new blob>`, and confirm `worktree._hunks` in `plugins/alq-review/scripts/worktree.py` parses the `+++ b/<sha>` header. Record the result in R3 of `research.md`.
- [X] T003 [P] Measure R4: time `diff_main` with `Diff_Timeout = 0` then `diff_cleanupSemantic` on one replaced range of 2,000 lines. Record the time in R4 of `research.md` and choose the single budget constant `lineage.py` will use, inside the hook's 60 s.
- [X] T004 Add the pinned `diff-match-patch` install (version from T001) to `.github/workflows/tests.yml`, before the test step. Depends on T001.

---

## Phase 2: Foundational (blocks every user story)

**Purpose**: `lineage.py` (pure), `worktree.text_hunks`, and the three new tables.

**⚠️ CRITICAL**: no story starts until T005 to T012 are done and green.

### Tests first (write, run, see red for the stated reason)

- [X] T005 Create `dev/alq-review/tests/test_lineage.py` with the `span_of` and `carry` tests: `span_of` finds a sentence that wraps across lines and skips the comment marks `claimcheck.plain` drops, and raises when the words are not in the file (R5); `carry` shifts a span outside every hunk by the lines earlier hunks added or removed, maps an offset inside a replaced range by character diff, maps an offset inside a pure deletion to where the text was, and returns none for a span whose two ends meet (R4). Texts are strings in the test, hunks are built by hand: no git.
- [X] T006 In `dev/alq-review/tests/test_lineage.py` add the `succeed` tests (the mapping, not the count): C4 split in place gives one lineage to both halves; C5 two lineages merged into one sentence, the one with the higher count goes on and the other is marked `ended` by `merged` naming it; C6 words deleted ends the lineage `deleted`; C7 words moved unchanged keep the lineage by id; C11 one hunk over two lineages continues both, each by its own place; C12 moved and reworded ends the old lineage `deleted` and inherits nothing; C14 reflow with words unchanged keeps the lineage; C19 split with the second half elsewhere: only the half in the rewritten range inherits. Also: a place carried to text no claim was read in stays open (R6 Derived). `succeed` takes the count as a function argument (T011), so the merge rule is tested with a stub. Depends on T005 (same file).
- [X] T007 [P] Add a test for `worktree.text_hunks(root, old, new)` in `dev/alq-review/tests/test_worktree.py` (existing file, else create): two texts that differ give the same hunks `_hunks` gives for a staged diff; identical texts give none; the diff does not depend on which objects git kept.
- [X] T008 [P] Add round-trip tests for the new tables in `dev/alq-review/tests/test_ledger.py` (existing file, else create): `claim_lineages (repo, branch, id, opened)`, `seen_files (repo, branch, gate, file)` and `shim_bugs (repo, id)` save and load their documents exactly as `data-model.md` states them, inside the ledger's transaction.

### Implementation

- [X] T009 [P] Add `text_hunks(root, old, new)` to `plugins/alq-review/scripts/worktree.py`: write both texts with `git hash-object -w --stdin`, run `git diff -U0 <old blob> <new blob>`, return what `_hunks` returns (R3). Reuse `_hunks` and `_stdin`. Depends on T002, T007.
- [X] T010 Create `plugins/alq-review/scripts/lineage.py` with: `Unavailable` (library missing) and `BudgetExceeded` (the T003 budget passed), both naming the next step; `differ()` importing `diff_match_patch` inside the function, `Diff_Timeout = 0`, raising `Unavailable` with `install_step(...)` (R13: the pip form, or the OS package where the interpreter is managed); `span_of(text, line, quote)` (R5, reusing `claimcheck.plain` and `claimcheck._COMMENT_MARK`); `carry(spans, old, new, hunks)` (R4: ends mapped apart, shift outside hunks, `diff_main` + `diff_cleanupSemantic` + `diff_xIndex` inside). No I/O. Depends on T003, T005.
- [X] T011 In `plugins/alq-review/scripts/lineage.py` add `succeed(lineages, old, new, hunks, claims, count)` per R6: inheritance by place (several = split), then by id, merge at the higher `count(lineage)` with the others ended `merged` naming it, a lineage with no place left ended `deleted`, a place carried to unread text kept. Returns the lineages and `{claim id: [lineage ids]}`. `count` is passed in so the module stays pure and does not import `claimcheck`. Depends on T010, T006.
- [X] T012 [P] Add the tables `claim_lineages`, `shim_bugs`, `seen_files` to `SCHEMA` in `plugins/alq-review/scripts/ledger.py` with their accessors (documents as in `data-model.md`; `claim_checks` gains `branch` and `lineages`). Do not remove `claim_holds`, `shim_chains`, `chains_at` yet: their callers are replaced in US1 and US4 and the removal is T029. Depends on T008.

**Checkpoint**: `python3 -m unittest discover -s tests -p 'test_lineage.py'` and the T007/T008 tests are green; the pre-existing suite still passes.

---

## Phase 3: User Story 1 - The count follows a claim through its rewordings (Priority: P1) 🎯 MVP

**Goal**: one count per claim lineage, independent of commits, shown as a whole chain at 3. Closes #15 and #16.

**Independent Test**: three `WRONG` rulings on reworded versions with an unrelated commit and an amend between: the third holds; the same check twice adds one.

### Tests first

- [ ] T013 [US1] In `dev/alq-review/tests/test_claimcheck.py` delete the hunk-hold tests and add: `count(lineage)` is the distinct refs of `WRONG` rulings not released; an entry whose ref is already in the chain adds nothing; a rejected contest enters as `<check ref>/contest-<n>` and adds one (C16); an upheld contest as `UNSURE` lowers nothing (C17); `held(lineage)` is `open`, count 3 or more, and above `released.count` when there is one; the refusal text lists one line per version `file:line "words" - ruling (check)`, the last failing case and evidence, and the `unlock claim-<id>` line (FR-005).
- [ ] T014 [US1] In `dev/alq-review/tests/test_claim_gate.py` add the hook-level sequences: C1, C2 (unstage, commit another file, stage again: count 3, held), C3 (amend), C9 (completion step run twice: rises once), C15 (`CORRECT` ends it, next `WRONG` starts at 1), C16, C17, C18's launch half is in US2. Add X1 and X2 for the claim check: library not importable, and a character diff over its budget, at launch and at commit: refused, install command or "split the change" named, never a pass; in `log` mode recorded only. C1/C2/C9 must fail on the code before this change for the reasons #15 and #16 give.

### Implementation

- [ ] T015 [US1] In `plugins/alq-review/scripts/claimcheck.py` replace the hunk-hold section with `count`, `held`, the chain wording (extending `user_question`) and a new-chain-entry constructor reusing `ruled_wrong` and `check_ref`; delete `find_hold`, `hunk_state`, `_refuse_hunk`, `_name_claims`, `count_refusals`, `standing`, `release`, `_old_side` and `Claims.holds`, `save_holds`, `claim_holders`; keep `REFUSALS_BEFORE_USER = 3`; `commit_decision` takes held lineages and released claim ids. `touches` is deleted here too, after T016 has moved it. Before editing, list the callers (claimgate `_completed`, `on_commit`, `on_launch`, `after_output`, `on_prompt`; `shimcheck.overlaps` for `touches`). Depends on T013, T016.
- [ ] T016 [US1] Do before T015: move `touches` into `plugins/alq-review/scripts/shimcheck.py` (its only remaining caller, `overlaps`), leaving the `claimcheck.py` copy for T015 to delete; update the import in `dev/alq-review/tests/test_shimcheck.py`.
- [ ] T017 [US1] Rewrite the launch, commit, completion and contest paths of `plugins/alq-review/scripts/claimgate.py` once from the shape in R2, R6, R7, R8: `lineage.differ()` called first in `on_launch` and `on_commit`, a `Unavailable` or `BudgetExceeded` refused through `hookio.refuse_claim`; launch and commit carry each staged file's places from `seen_files` with `worktree.text_hunks` and `lineage.carry`/`succeed` without saving, and refuse when a held lineage still has a place; completion mints one lineage per `WRONG` claim not already in an open one (an id equal to an open lineage's id joins it, R1), settles `succeed`, adds chain entries by ref, advances `seen_files` only for files the check had (R2), and stores `branch` and `lineages` on the `claim_checks` record so a contest counts on the same lineage; nothing keyed on `HEAD`, a tree or a commit (FR-019). Depends on T012, T014, T015, T011.
- [ ] T018 [US1] Run `python3 -m unittest discover -s tests`; T013 and T014 pass, and C1/C2/C9 are shown to have been red before T017. Report any test that was green on first run.

**Checkpoint**: US1 works alone: the count survives other commits and amends, the same check twice adds one, a missing library refuses.

---

## Phase 4: User Story 2 - Only the user lowers the count, and a release lasts (Priority: P1)

**Goal**: `unlock claim-<id>` releases the words as they are; the lineage keeps its chain and count.

**Independent Test**: hold, unlock, reword, rule `WRONG`: held at once.

### Tests first

- [ ] T019 [US2] In `dev/alq-review/tests/test_claimcheck.py` add `release(lineage, ...)` tests: records `{count, claims, at}`; a later `WRONG` on those same words enters as released and neither counts nor refuses; a later `WRONG` on new words is above `released.count` and holds. In `dev/alq-review/tests/test_claim_gate.py` add C8 (held, `unlock`, commit passes, reword, `WRONG`, held at once with the chain whole), C18 (held, reword without `unlock`: launch refused), C20 (a released lineage at 3 merged with one at 1, `WRONG`: held), `unlock` naming the lineage id and naming the current words' id, `unlock` naming nothing (says so, changes nothing), and an agent's commit elsewhere, amend or reflow leaving the hold in place.

### Implementation

- [ ] T020 [US2] Add the new `release` to `plugins/alq-review/scripts/claimcheck.py` (R7). Depends on T019.
- [ ] T021 [US2] Wire `unlock claim-<id>` in `plugins/alq-review/scripts/claimgate.py` `on_prompt`: resolve a lineage id or the id of words a lineage holds now, call `claimcheck.release`, save, change nothing when it names nothing. Depends on T020, T017. This is the second edit to `claimgate.py` after T017; if T022 follows, rewrite per the rule above.

**Checkpoint**: US1 and US2 pass together.

---

## Phase 5: User Story 3 - Splitting, merging, moving and deleting are followed (Priority: P2)

**Goal**: reshaping the text does not reset the count; a moved file does (ADR-0013).

**Independent Test**: each of split in place, merge two, delete, move unchanged, ends at the count the contract gives.

- [ ] T022 [US3] In `dev/alq-review/tests/test_claim_gate.py` add the hook-level rows: C4, C5 (one lineage at 3, the other ended `merged`), C6, C7, C11 (both held claims continue, each with its own chain, FR-015), C12, C13 (file moved: new lineage at 1 at the new path), C14, C19. Run them. Those red are the gaps in T017; those already green are reported as covered by T017 and Phase 2, not as new proof.
- [ ] T023 [US3] Close the gaps T022 shows in `plugins/alq-review/scripts/claimgate.py` (completion persists split and merged lineages; commit and launch continue every held lineage reached, not the first). This is the third edit to `claimgate.py` if T021 landed: stop, and rewrite the launch/commit/completion/prompt paths once from the settled shape, then re-run T014, T019, T022. Skip if T022 is all green. Depends on T022.

**Checkpoint**: US1 to US3 pass.

---

## Phase 6: User Story 4 - A bug's count follows it too (Priority: P2)

**Goal**: bugs found by branch with carried ranges; converging bugs are one; a refusal lists altered lines. Closes #16.

**Independent Test**: patch twice with another file committed between: count survives. Overlap two bugs: one at the higher count. Edit line 333 of a function at 329: the refusal lists 333.

Depends on Phase 2 and T016. Independent of US1 to US3 otherwise, so it can run in parallel with them.

### Tests first

- [ ] T024 [P] [US4] In `dev/alq-review/tests/test_shimcheck.py` add: `altered(sites, hunks)` gives per site the staged hunks' line ranges in the site's file, or marks the file as not in the change (B3 at the unit level); `settled_chains` merges bugs a change overlaps at the higher count, the others `merged` naming it, rulings copied where the survivor has none, counts once (B2: 1 and 3 become 3, then 4 with this patch, held); `held` at a count of 4 or more, `deep_due` at 3 (FR-004); a bug with no range left is `ended` (B4). Delete the `touched` tests.
- [ ] T025 [P] [US4] In `dev/alq-review/tests/test_shim_gate.py` rewrite `test_head_moving_leaves_the_chain_behind` and `test_one_patch_reaching_two_chains_counts_for_both` to assert the opposite (count survives, bugs become one); add B1, B3 (refusal lists 333), B4, B5 (lines added above: same bug, count 2), B6 (held, `override`, commit, patch again: held), B7 (an overridden bug and another overlapped: the check is required), and X1/X2 for the shim check (library missing, diff over budget: refused, next step named, `log` mode recorded only).

### Implementation

- [ ] T026 [US4] In `plugins/alq-review/scripts/shimcheck.py` add `altered`, merge in `settled_chains` (R10), `held` at 4 or more, carried ranges through `lineage.carry` (R9, ranges turned back into lines), the new bug without `head`; delete `touched`. Depends on T024, T016.
- [ ] T027 [US4] In `plugins/alq-review/scripts/shimgate.py`: `lineage.differ()` first in `on_launch` and `on_commit` (refuse through `hookio.refuse_shim`); `Shims.open_bugs(branch)` in place of `chains_at(branch, head)`; ranges carried against `seen_files` (gate `shim`), saved when a check settles its bugs and computed without saving at launch and commit; `_patch_report` prints `alters lines 333, 340-352 of this file` or `this file is not in the staged change` in place of `touched`; an override ends when a commit changes the bug's code (R11); no key on `HEAD`. Name callers first (`on_commit`, `on_launch`, `_save`, `_override_tree`, `_override_chain`, the tests). Depends on T012, T025, T026.

**Checkpoint**: US4 passes on its own; US1 to US3 unaffected.

---

## Phase 7: User Story 5 - Progress is not punished (Priority: P3)

**Goal**: three claims in one hunk do not share a count.

**Independent Test**: three claims, one hunk, each `WRONG` once over three checks: three lineages at 1, no hold.

- [ ] T028 [US5] Add C10 to `dev/alq-review/tests/test_claim_gate.py`. Run it. It should already pass because T017 mints per claim; report that plainly if so. If it fails, fix the minting in `plugins/alq-review/scripts/claimgate.py` (one lineage per `WRONG` claim, never per hunk) as part of the same rewrite rule as T023. Depends on T017.

---

## Phase 8: Polish & cross-cutting

- [ ] T029 Remove `claim_holds` and `shim_chains` from `SCHEMA` and delete `chains_at`, `save_holds` and `claim_holders` from `plugins/alq-review/scripts/ledger.py` (R14: rows already in a store stay, nothing reads them). Name the callers first; grep must show none left. Depends on US1 and US4 complete.
- [ ] T030 [P] Update `plugins/alq-review/README.md`: items 7 and 8, State (the three tables, held rows no longer read), Layout (`lineage.py`), and the Dependencies section, which says there is no third-party import and now names `diff-match-patch` and which hooks need it (R13).
- [ ] T031 [P] Update `specs/018-lineage-count/contracts/lineage.md` so `succeed` shows its `count` and `ref` arguments (T011), the one change from the contract as written.
- [ ] T032 Run `python3 -m unittest discover -s tests` from `dev/alq-review/`: no failure. Run `quickstart.md` steps 1 to 3.
- [ ] T033 Dead-code and key check: grep `plugins/alq-review/` for `find_hold`, `hunk_state`, `_refuse_hunk`, `_name_claims`, `count_refusals`, `standing`, `_old_side`, `save_holds`, `claim_holders`, `chains_at`, `touched` and for any lineage, bug or hold keyed on `HEAD`, a tree or a commit (FR-019). None may remain.
- [ ] T034 Run the tripwire before opening the PR: `git log --name-only main..HEAD | sort | uniq -c | sort -rn`. Any file above about 3 means split or rewrite before pushing.
- [ ] T035 Run `quickstart.md` steps 4 and 5 (live #15 and the missing library) in a scratch repo with the plugin enabled. They need an interactive session; if not run, say so rather than marking it done.

---

## Dependencies & Execution Order

- Phase 1 first; T004 waits for T001.
- Phase 2 blocks all stories. Inside it: tests T005 to T008 first (T007, T008 parallel with T005/T006), then T009, T010 to T012; T011 after T010.
- US1 (Phase 3) then US2 (needs `held`/`count` from T015 and the gate from T017) then US3 (tests on the US1 gate).
- US4 (Phase 6) needs Phase 2 and T016 only; run it in parallel with US1 to US3 if two people are on it.
- US5 needs T017.
- Polish needs every story; T029 needs US1 and US4 done.

### Parallel opportunities

- T002, T003 together; T007, T008 together; T009 and T012 together after their tests.
- T024 and T025 together (different test files).
- T030 and T031 together.
- US4 alongside US1 to US3.

```text
Task: "Add text_hunks to worktree.py"            (T009)
Task: "Add the three tables to ledger.py"         (T012)
Task: "shimcheck unit tests"                      (T024)
Task: "shim gate sequences"                       (T025)
```

## Implementation Strategy

### MVP: User Story 1

1. Phase 1 and Phase 2.
2. Phase 3 (US1). Stop and validate: C1, C2, C3, C9 pass, X1/X2 refuse for the claim check.
3. US2 next, since a hold without a lasting release breaks P2; ship US1 and US2 together.

### Incremental

US3 and US5 are mostly verification of the US1 wiring. US4 is the shim half and can land in the same PR (one PR per the plan) after its own checkpoint.

## Notes

- The note ADR-0001 needs on merging (ADR-0014 governs the shim merge) is a decision record and goes in its own PR, not here (plan, Constitution VI).
- To file, not to do here: a site is one line, so a patch lower in the function does not match its bug by the site (R9). The sweeper needs to report an end line.
- Commit after each phase checkpoint; every commit carries the `alq-session-id` trailer.
