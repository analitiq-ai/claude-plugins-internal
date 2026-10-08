# Tasks: The spec lives in the spec folder

**Input**: `specs/018-spec-in-spec-folder/` (plan.md, spec.md, research.md R1–R9, data-model.md, contracts/speclocation-cli.md, quickstart.md)

**Tests**: Required. Constitution IV and R9: every implementation task is preceded by its failing test, run and seen to fail for the stated reason.

**Paths** (from the worktree root): plugin code `plugins/alq-review/`; tests `dev/alq-review/tests/`; this spec `dev/alq-review/specs/018-spec-in-spec-folder/`. Tests run from `dev/alq-review/`: `python3 -m unittest discover tests`.

**Shared files**: `speclocation.py` and `test_speclocation.py` are edited by several stories. Tasks touching the same file are not marked [P] against each other.

## Phase 1: Setup

- [ ] T001 Read `tests/test_gate.py` (`Gate` base class, fake `gh`, `GH_ISSUE_COMMENTS`, `GH_LOG`, `GH_COMMENTS_ERROR`) and `tests/helpers.py`, and `plugins/alq-review/scripts/{github,briefs,gate,worktree}.py`; state in the working note the callers of `github.issue_spec`, `briefs.branch_spec`, `briefs._graded_against` and `briefs.brief` before the first edit (coding principle: name the callers).

## Phase 2: Foundational (blocks every story)

**Purpose**: the one module that owns the location comment's form (R1), and `issue_spec` returning the comment id.

- [ ] T002 Write failing tests in `dev/alq-review/tests/test_speclocation.py` for `render`/`render_none`/`parse` per data-model.md: Located (`spec:` then `branch:`) and NoSpec (`spec: none` then `reason:`) round-trip; refusals for the marker followed by a whole spec, wrong line order, extra lines, empty or multi-line values, absolute `spec`, a `..` part, a `spec` whose last-but-one part is not `specs`. Each refusal raises `SpecLocationError`. Run; confirm they fail because the module does not exist.
- [ ] T003 Create `plugins/alq-review/scripts/speclocation.py` with `Located`, `NoSpec`, `FoundSpec`, `NoSpecNeeded`, `SpecLocationError(RuntimeError)`, pure `render`, `render_none`, `parse` (plain `key: value` lines, no YAML). The old whole-spec comment's error names `design-doc`. Make T002 pass.
- [ ] T004 Write a failing test in `dev/alq-review/tests/test_gate.py` (or a new `IssueSpec` case) that `github.issue_spec` returns `(comment_id, body)` and still refuses two marker comments; update the one mock in `dev/alq-review/tests/test_worktree_facts.py` to the new return. Run; confirm failure is the return shape.
- [ ] T005 Change `github.issue_spec` in `plugins/alq-review/scripts/github.py` to return `(id, body)` or `None`; add the `gh api` create/PATCH upsert helper with the body passed on stdin as `-F body=@-` (R4), reusing `github._answer`. Fix the callers named in T001 that break. Make T004 pass.

**Checkpoint**: form defined once; story work can begin.

## Phase 3: User Story 1 - The gate grades a change against the spec in its folder (P1) 🎯 MVP

**Goal**: reviewers and the assessor get `spec.md` text and the folder path from the folder the location comment names.

**Independent test**: issue's comment names folder A; branch changes folders A and B (and, separately, none); the reviewers' brief carries A's spec only. `spec: none` hands no spec and says why.

- [ ] T006 [US1] Write failing tests in `dev/alq-review/tests/test_speclocation.py` for `resolve(slug, branch, root)` against a temporary git checkout and the fake `gh`: returns `FoundSpec(folder, text)` with `spec.md` as committed at HEAD (an uncommitted edit is not read); returns `NoSpecNeeded(reason)` for `spec: none`; returns `None` when the branch names no issue (FR-014); picks the named folder when the branch also changes another spec folder or none (FR-006). Confirm they fail because `resolve` is missing.
- [ ] T007 [US1] Implement `resolve` in `plugins/alq-review/scripts/speclocation.py`: `briefs.issue_number` → `github.issue_spec` → `parse` → read `spec.md` via `worktree.head_tree` + `worktree.tree_text` (R2). A `gh` failure passes through as `RuntimeError` unchanged (P4). Make T006 pass.
- [ ] T008 [US1] Write failing tests in `dev/alq-review/tests/test_gate.py` (`IssueSpec` rewritten for the folder form): each internal reviewer prompt holds the folder's `spec.md` text and the folder path (FR-005); the assess launch brief holds the same; `spec: none` renders "needs no spec" plus the reason; no issue number leaves the prompt as today; audit review launches still get no spec (R7, R8). Confirm failure.
- [ ] T009 [US1] In `plugins/alq-review/scripts/briefs.py` delete `branch_spec`; make `_graded_against`, `_review_prompt` and `brief` take the `resolve` result (R8). In `plugins/alq-review/scripts/gate.py` call `resolve` at internal review launch and at assess launch. Make T008 pass.

**Checkpoint**: the gate grades against the named folder.

## Phase 4: User Story 2 - The gate refuses, and says what to do, when the spec cannot be found (P1)

**Goal**: no run ends with an empty spec and no message.

**Independent test**: for each failing state, run the gate and read the refusal.

- [ ] T010 [US2] Write failing tests in `dev/alq-review/tests/test_speclocation.py` and `dev/alq-review/tests/test_gate.py`: `resolve` raises `SpecLocationError` for (a) no location comment, naming `design-doc`; (b) folder not in the checkout, naming the folder and the `branch:` value; (c) `spec.md` missing or empty, worded as (b); (d) malformed, two comments, or out-of-repo path, stating the form. The gate launch (review and assess) denies, opens no round, and the reason carries the message. A `gh` failure refuses in gh's words, not as "no location comment" (P4). Confirm failure.
- [ ] T011 [US2] Add the refusals to `resolve` in `plugins/alq-review/scripts/speclocation.py`; map `SpecLocationError` to `refuse` in `plugins/alq-review/scripts/gate.py` for both launches (R7). Make T010 pass.

**Checkpoint**: Stories 1 and 2 give the full gate behaviour.

## Phase 5: User Story 3 - A finished `design-doc` run leaves the issue pointing at its spec folder (P1)

**Goal**: one location comment, posted only after a completed run, and `none` posted by the user's command.

**Independent test**: run `design-doc #<issue>` and `design-doc #<issue> none <reason>`; read each issue's comments.

- [ ] T012 [US3] Write failing tests in `dev/alq-review/tests/test_speclocation.py` for the CLI (contracts/speclocation-cli.md) using the fake `gh` with a POST/PATCH log: `post <checkout>` derives repo, branch, issue and the folder from `.specify/feature.json` and creates one comment holding `spec:` and `branch:` and no spec text; run again PATCHes the same comment; `none <checkout> <reason>` posts `spec: none` + `reason:`, creates no folder; empty reason exits 2 and posts nothing; issue and reason text never appear on a command line (R4). Confirm failure.
- [ ] T013 [US3] Add the `post` and `none` commands and `main` to `plugins/alq-review/scripts/speclocation.py` (R4), exit codes 0 / 1 / 2 as in the contract. Make T012 pass.
- [ ] T014 [US3] Write failing tests in `dev/alq-review/tests/test_spec_source.py` that `plugins/alq-review/skills/design-doc/SKILL.md` has the `#<issue> none <reason>` entry running `speclocation.py none` and starting no workflow, and that on a `completed` report it commits the spec folder, pushes the branch, then runs `speclocation.py post`, in that order, and posts nothing on rejection or failure (R5). Confirm failure.
- [ ] T015 [US3] Edit `plugins/alq-review/skills/design-doc/SKILL.md`: add the `none` entry; after `completed`: commit the spec folder, push, run `post`, report the comment URL; state that an aborted run posts none; name the spec folder, found by the location comment, as the spec's home. The workflow file is not changed. Make T014 pass.

**Checkpoint**: gate refusals in Story 2 are now fair; the skill that creates the folder posts the location comment.

## Phase 6: User Story 4 - Starting work reads the location comment (P2)

**Goal**: tackle and root-cause check use `show`; none of the three skills calls a comment the spec's home.

**Independent test**: read the three skills; run tackle on an issue with and without a location comment.

- [ ] T016 [US4] Write failing tests in `dev/alq-review/tests/test_speclocation.py` for `show <issue> [--repo]`: prints `spec:` and `branch:` or `spec: none` and `reason:`; exits 1 with the refusal on stderr for no comment or a malformed one. Confirm failure.
- [ ] T017 [US4] Add `show` to `plugins/alq-review/scripts/speclocation.py`. Make T016 pass.
- [ ] T018 [US4] Rewrite `dev/alq-review/tests/test_spec_source.py` (replaces the old "no copy in the worktree" pin, FR-013): `alq-issue-tackle`, `alq-root-cause-check` and `design-doc` each call `speclocation.py show` (design-doc via `post`/`none`), name no issue comment as the spec's home, do not forbid a worktree copy, name `design-doc` in their refusals; tackle has no `alq-shape` call and no Hand-maintained surfaces stop; none of the three, nor `gate.py`, contains "spec lives on the issue" or "its only home" (SC-004). Confirm failure against the current skills.
- [ ] T019 [P] [US4] Edit `plugins/alq-review/skills/alq-issue-tackle/SKILL.md`: run `show`, check out the named branch, read `spec.md` from the named folder; refuse with `design-doc` when there is no location comment; delete the forbids-a-copy paragraph, the Hand-maintained surfaces stop and the `alq-shape` fallback (R6, FR-011).
- [ ] T020 [P] [US4] Edit `plugins/alq-review/skills/alq-root-cause-check/SKILL.md`: run `show`, read `spec.md`; with no Root cause section return CANNOT TELL (accepted gap until #57); delete its inline `--jq` marker filter.
- [ ] T021 [US4] Run `dev/alq-review/tests/test_spec_source.py`; make T018 pass.

**Checkpoint**: all four stories work.

## Phase 7: Polish

- [ ] T022 Update `plugins/alq-review/README.md` enforcement item 5 (line ~52) to say the gate reads the spec folder the location comment names.
- [ ] T023 Grep `plugins/alq-review` for `branch_spec`, `<!-- analitiq-spec -->` and `--jq` marker filters; the marker must appear only in `speclocation.py` and `github.SPEC_MARKER`'s use. Remove orphans (no dead code).
- [ ] T024 Run `python3 -m unittest discover tests` from `dev/alq-review/`, then the quickstart steps 1–6 that can run against the fake `gh`; state which steps were not run against a real issue.
- [ ] T025 Tripwire before the PR: `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; any file above ~3 edits is rewritten once, not patched (pr-review-loop).
- [ ] T026 When the branch is pushed, post #25's own location comment by hand with `python3 plugins/alq-review/scripts/speclocation.py post <checkout>` (spec Edge Cases).

## Dependencies & Order

- Phase 2 blocks all stories. T003 before T005's callers compile; T004 before T005.
- US1 (T006–T009) first: it is the MVP. US2 (T010–T011) extends `resolve` and `gate.py` from US1, so it follows US1.
- US3 needs only Phase 2 and T005's upsert helper; it can run in parallel with US1/US2 by a second worker except for edits to `speclocation.py` and `test_speclocation.py` (serialize those).
- US4: T016–T017 need Phase 2 only; T018–T021 can follow US3's T015 (same test file `test_spec_source.py`: T014 then T018).
- Polish last.

## Parallel Opportunities

- T019 and T020 (different skill files) once T018 is red.
- US3's skill work (T014–T015) with US1's gate work (T008–T009): different files.

## Implementation Strategy

MVP = Phase 2 + US1 + US2 (the gate reads the folder and refuses with a next step). Then US3 (the location comment gets posted), then US4 (skills stop naming the comment). Land as one PR (Complexity Tracking row VI).
