# Tasks: One planning skill, `alq-spec`

**Input**: `specs/019-merge-shape-into-alq-spec/` (plan.md, spec.md, research.md R1–R10, data-model.md, contracts/, quickstart.md)

**Tests**: Required. Constitution IV and R9: every implementation task is preceded by its failing test, run and seen to fail for the stated reason.

**Paths** (from the worktree root): plugin code `plugins/alq-review/`; tests `dev/alq-review/tests/`; this spec `dev/alq-review/specs/019-merge-shape-into-alq-spec/`. Tests run from `dev/alq-review/`: `python3 -m unittest discover tests`.

**Two pull requests (FR-020)**: Phases 1–5 and 7 are PR 1 (the merge, `alq-shape` deleted, skill still named `design-doc`). Phase 6 is PR 2 (the rename, no behaviour change). Do not start Phase 6 until PR 1 is merged.

**Shared files**: `speclocation.py`, `test_speclocation.py`, `workflow.yml`, `design-doc/SKILL.md` and `test_spec_source.py` are edited by several stories. Tasks touching the same file are not marked [P] against each other.

## Phase 1: Setup

- [x] T001 Read `plugins/alq-review/scripts/speclocation.py`, `plugins/alq-review/scripts/settled_design.py`, `plugins/alq-review/skills/design-doc/{SKILL.md,scripts/drive_workflow.py}`, `plugins/alq-review/speckit/presets/settled-design/`, `dev/alq-review/tests/{test_speclocation,test_drive_workflow,test_plan_template,test_spec_source}.py`. In the working note, name the callers of `speclocation.located`, `speclocation.parse`, `speclocation.main` and `drive_workflow.resume` before the first edit (coding principle: name the callers).

## Phase 2: Foundational (blocks every story)

**Purpose**: prove what Spec Kit does (R10), then land the third location-comment form that `record` and tackle's refusal both rest on (R6).

- [x] T002 Write a failing test in `dev/alq-review/tests/test_plan_template.py` that installs the `settled-design` preset into a real Spec Kit project (`specify-cli==1.0.7`) and asserts the generated `spec.md` template holds `## Why this is worth doing` and `## Root cause` (R10 case 1). Run; confirm it fails because the preset has no `spec-template`.
- [x] T003 Add a `spec-template` template (`strategy: append`) to `plugins/alq-review/speckit/presets/settled-design/` with the two sections per R4: `## Why this is worth doing` (the six premise answers, each followed by its source) and `## Root cause` whose guidance opens with `Observed:` or the sentence `Not a defect report.`, keeps what was examined and ruled out apart from what was not investigated, and labels each claim about other callers verified or predicted. Add a `speckit.specify` command (`strategy: append`) telling `specify` to copy the premise answers from the report path named at the end of its arguments and to trace the cause only after reading the code. Bump the preset to `1.1.0` in `preset.yml`. Make T002 pass. If `append` is refused for `spec-template`, stop: the plan changes before code does.
- [x] T004 Write probe tests in `dev/alq-review/tests/test_drive_workflow.py` (a new `SpecKitShape` case using the `Project` helper and an inline throwaway workflow whose shell steps are `true`) for R10 cases 2–5: a run with no `spec_dir` pauses at a gate named `premise` with options `write the spec`, `no spec needed`, `not worth doing` and `on_reject: skip`; resuming with `premise_verdict=no spec needed` completes without running the step after it; a start with `spec_dir` set skips the `premise` branch; a step nested two `if`s deep is readable as `steps.<id>.output` in the second `if`'s condition. These probe Spec Kit, not our code: run them; if any fails for a Spec Kit reason, stop and change the plan (R10).
- [x] T005 Write failing tests in `dev/alq-review/tests/test_speclocation.py` for the third form per `contracts/speclocation-cli.md`: `render_not_worth_doing`/`parse` round-trip `spec: not worth doing` + `reason:` as `NotWorthDoing(reason)`; refusals (still `SpecLocationError`) for a third line, wrong key, empty or multi-line reason; `located` raises `SpecLocationError` for this form with the message `<slug>#<n> was judged not worth doing: <reason>. Next step: run /alq-review:design-doc #<n> to put the question again; its premise step replaces this comment.`; `show` and `resolve` exit 1 / raise with the same message; CLI `not-worth-doing <checkout> <reason>` upserts the one comment (a second call PATCHes it, no second comment) and prints its URL, exits 2 on an empty reason or when gh fails; CLI `status <issue>` prints exactly one of `located`, `none`, `not worth doing`, `no comment` and exits 0, and exits 1 with the existing refusal for an unreadable or doubled comment. Run; confirm they fail because `NotWorthDoing` is missing.
- [x] T006 Implement the third form in `plugins/alq-review/scripts/speclocation.py`: `NotWorthDoing`, `render_not_worth_doing`, `post_not_worth_doing` (body on stdin through the existing upsert, never a command line), the refusal in `located`, and the `not-worth-doing` and `status` commands, following `NoSpec` line for line. Make T005 pass.

**Checkpoint**: Spec Kit shape proven; one module owns all three location forms.

## Phase 3: User Story 1 - One skill plans an issue, with every check (P1) 🎯 MVP

**Goal**: `design-doc` pauses at `premise`, grades the report, posts the stop comments, and fails a spec with no labelled root cause.

**Independent test**: run the workflow on a defect issue with a holding premise, on a failing premise, and on a no-spec issue; read what each leaves behind.

- [x] T007 [US1] Write failing tests in `dev/alq-review/tests/test_premise_report.py` for `premise_report.py form` and `check` per `contracts/premise-report.md`: `form` prints the six questions (`harm`, `reachable`, `change-alters`, `owner`, `inherited`, `needs-spec`) each with `Answer:`/`Source:`, plus `Reports wrong behaviour:`, `Recommendation:`, `Pick:`, `Rests on:`, `Reason:`; `check` exits 1 with one problem per line and a next step for each of: missing file; missing question section; empty graded `Answer:` or `Source:`; a `Source:` not starting `code:`, `reproduction:` or `user:` with text after it; a `reachable` answer not starting `observed` or `predicted`; `Recommendation:` or `Pick:` outside the three outcomes; `Pick:` differing from the argument; a stop pick with empty `Reason:` or `Rests on:` naming no question; `Reports wrong behaviour: yes` with recommendation `no spec needed`. A `write the spec` pick grades all six questions; a stop pick grades only up to and including the `Rests on:` question and does not require later ones. Exit 2 when it cannot run. Run; confirm failure because the module does not exist.
- [x] T008 [US1] Create `plugins/alq-review/scripts/premise_report.py` (stdlib only) with `form` and `check` as pure functions of text and a thin CLI (exit 0/1/2, conventions of `settled_design.py`). The question wording lives only here. Make T007 pass.
- [x] T009 [US1] Write failing tests in `dev/alq-review/tests/test_premise_report.py` for `record <report> <pick>` with the fake `gh` of `test_gate.py`: `no spec needed` posts `spec: none` + the report's `Reason:`; `not worth doing` posts `spec: not worth doing` + the `Reason:`; `write the spec` posts nothing; the reason never appears on a command line; a `gh` failure exits non-zero in gh's words and posts nothing (P4). Confirm failure.
- [x] T010 [US1] Add `record` to `plugins/alq-review/scripts/premise_report.py`, calling `speclocation.post_none` / `speclocation.post_not_worth_doing` rather than posting itself. Make T009 pass.
- [x] T011 [P] [US1] Write failing tests in `dev/alq-review/tests/test_rootcause.py` for `rootcause.py check <spec folder> [<premise report>]`: exits 1 with a next step when `spec.md` has no `## Root cause` heading; when the first non-blank line under it neither starts `Observed:` nor is `Not a defect report.`; when it is `Not a defect report.` and the report says `Reports wrong behaviour: yes`. Exits 0 for `Observed: …` (including `Observed: hypothesis …`) and for `Not a defect report.` with `Reports wrong behaviour: no` or no report argument (the re-scope run). Confirm failure.
- [x] T012 [US1] Create `plugins/alq-review/scripts/rootcause.py` with the check as a pure function of text and a thin CLI; define the constant `Not a defect report.` here. Make T011 pass.
- [x] T013 [US1] Write failing tests in `dev/alq-review/tests/test_drive_workflow.py` against the installed real workflow: a start with no `spec_dir` pauses at `premise` before `specify`; a start with `spec_dir` (re-scope) runs neither `premise`, `premise-report`, `record-outcome` nor `specify`, and still runs `root-cause-after-grill`; resume with `no spec needed` and with `not worth doing` each runs `premise-report` then `record-outcome`, completes, creates no spec folder and runs no `specify`; resume with `write the spec` pauses at `grill`; an incomplete report fails the run at `premise-report`; a spec with no labelled root cause fails the run at `root-cause`, and one edited after grill fails at `root-cause-after-grill`. Confirm failure (no `premise` step yet).
- [x] T014 [US1] Reshape `plugins/alq-review/speckit/workflows/design-doc/workflow.yml` per R1: add input `premise_verdict` (default `""`); first an `if` (new spec only: `inputs.spec_dir` empty) whose `then` holds the `premise` gate (`options: [write the spec, no spec needed, not worth doing]`, `on_reject: skip`, `verdict_input: premise_verdict`), the `premise-report` shell step (`premise_report.py check .specify/workflows/runs/{{ context.run_id }}/premise-report.md "<choice>"`) and the `record-outcome` shell step (`premise_report.py record …`); then today's steps, each top-level in its own `if` (runs when `inputs.spec_dir` is set or the choice is `write the spec`). `specify`'s args become `{{ inputs.spec }}` plus a closing line naming the report path (R3). Add `root-cause` (`rootcause.py check "$dir" <report>`) directly after `specify` and `root-cause-after-grill` (same script, report only when one exists) after `no-open-markers`. Pass the choice to the shell only as the matched option string, never raw input. Bump the workflow version. Make T013 pass.
- [x] T015 [US1] Write failing tests in `dev/alq-review/tests/test_spec_source.py` that `plugins/alq-review/skills/design-doc/SKILL.md`: runs `speclocation.py status <n>` before starting and stops only on `located`, showing the location, while `none`, `not worth doing` and `no comment` start the workflow and a non-zero exit shows the refusal; on `paused` at `premise` runs `premise_report.py form`, writes the report to `.specify/workflows/runs/<run_id>/premise-report.md`, answers the questions in the session (asking the user only what the code cannot answer), states a recommendation, asks for one of the three picks by name, writes `Pick:`, and resumes with `premise_verdict=<pick>`; never asks for approve or reject at `premise`; keeps the re-scope entry and the `#<issue> none <reason>` shortcut (no workflow, no `premise`). Confirm failure.
- [x] T016 [US1] Edit `plugins/alq-review/skills/design-doc/SKILL.md` for T015: add the existing-spec stop and the premise step between start and grill; keep the description and argument hint covering every entry point (FR-016). Do not edit `plugins/alq-review/skills/design-doc/scripts/drive_workflow.py` (R7): its `resume` already takes `<input>=<value>`; confirm with T013's resume cases. Make T015 pass.
- [x] T017 [US1] Write a failing test in `dev/alq-review/tests/test_spec_source.py` that nothing under `plugins/` or `dev/alq-review/tests/` names `alq-shape` (R9 pin, PR 1). Confirm it fails on the files that still name it.
- [x] T018 [US1] Delete `plugins/alq-review/skills/alq-shape/`. Update `plugins/alq-review/README.md`: remove the `alq-shape` row, describe the `premise` step and the new checks in the `design-doc` row and workflow steps. Update the one `alq-shape` mention in `dev/alq-review/tests/test_spec_source.py` so T017 passes.
- [x] T019 [US1] Regenerate the dev project's installed copy `dev/alq-review/.specify/workflows/design-doc/workflow.yml` by running a start (do not hand-edit). Run the full suite: `python3 -m unittest discover tests`.

**Checkpoint**: one skill carries every check; US1 works end to end.

## Phase 4: User Story 3 - The skills that depended on `alq-shape` keep working (P1)

**Goal**: tackle and the root-cause check work against the spec folder; tackle refuses a "not worth doing" issue.

**Independent test**: run tackle on an issue with no spec and on a "not worth doing" issue; run the root-cause check on a folder the merged skill produced.

- [x] T020 [US3] Write failing tests in `dev/alq-review/tests/test_spec_source.py` that `plugins/alq-review/skills/alq-issue-tackle/SKILL.md` names `design-doc` (not `alq-shape`) as the skill that produces the spec; no longer carries the paragraph re-checking a decision tagged `(code)` (FR-019); and refuses an issue whose location comment is the third form by showing `speclocation.py show`'s message and stopping (FR-018); that `plugins/alq-review/skills/alq-root-cause-check/SKILL.md` no longer carries the sentence that a `design-doc` spec has no Root cause section yet, and still reads `## Root cause`, its `Observed:` line, and stops on `Not a defect report.` (FR-015). Confirm failure.
- [x] T021 [US3] Edit `plugins/alq-review/skills/alq-issue-tackle/SKILL.md` and `plugins/alq-review/skills/alq-root-cause-check/SKILL.md` for T020. Make T020 pass. The pin on skill text and the skills it grades land in this PR as the one path the plan's Complexity Tracking records.
- [x] T022 [P] [US3] Write a test in `dev/alq-review/tests/test_rootcause.py` that a `spec.md` produced from the installed preset's template, with the sections filled as the template directs, passes `rootcause.py check` and carries the line `alq-root-cause-check` looks for (`Observed:`). Run; it should pass given T003 and T012; if it fails, the template and the check disagree and the template is the one to fix.

**Checkpoint**: nothing in PR 1 names `alq-shape`; both dependents work against the spec folder.

## Phase 5: PR 1 review

- [ ] T023 Before opening PR 1, run the tripwire `git log --name-only main..HEAD | sort | uniq -c | sort -rn`; any file above ~3 edits means split or rewrite once (pr-review-loop). Commit with the `alq-session-id` trailer, push, open the PR as a draft, run the internal review loop. No Codex or DeepSource loop for this repo; merge after internal review and CI.

## Phase 6: User Story 2 - There is one skill name, and it fits (P1) — PR 2, after PR 1 merges

**Goal**: `design-doc` becomes `alq-spec` everywhere it names the skill or workflow; no behaviour changes (FR-017).

**Independent test**: `grep -rn "design-doc" plugins dev/alq-review/tests .github` finds nothing; `/alq-review:alq-spec #<issue>` runs the skill.

- [ ] T024 [US2] Create a fresh branch and worktree for PR 2 from the merged `main`. Write a failing test in `dev/alq-review/tests/test_spec_source.py` that nothing under `plugins/`, `dev/alq-review/tests/` or `.github/` names `design-doc` as a skill or workflow, allowing "design document" where it means the settled-design rule (R9). Confirm it fails on the current hits.
- [ ] T025 [US2] Rename `plugins/alq-review/skills/design-doc/` to `plugins/alq-review/skills/alq-spec/` and `plugins/alq-review/speckit/workflows/design-doc/` to `plugins/alq-review/speckit/workflows/alq-spec/` (`git mv`); change the workflow `id`, `name` and install path, and the dev project's installed copy `dev/alq-review/.specify/workflows/design-doc/` (regenerate by a start).
- [ ] T026 [US2] Change the names inside `plugins/alq-review/skills/alq-spec/scripts/drive_workflow.py` (constants, docstring), `plugins/alq-review/scripts/policy.py` (`RESCOPE_SKILL`), `gate.py`, `speclocation.py` (including the refusal text's `/alq-review:design-doc`), `settled_design.py` (line 151's skill name only; the "design document" wording at lines 10, 123, 141 and 150 is the settled-design rule from #29 and stays), `plugins/alq-review/skills/alq-spec/SKILL.md`, `alq-issue-tackle/SKILL.md`, `alq-root-cause-check/SKILL.md`, the rows and the `/alq-review:design-doc rescope` keyword text in `plugins/alq-review/README.md`, and `.github/workflows/tests.yml`. Read each hit; do not sed.
- [ ] T027 [US2] Update the tests that name `design-doc` (`test_gate.py`, `test_policy.py`, `test_speclocation.py`, `test_drive_workflow.py`, `test_plan_template.py`, `test_critique_report.py`, `test_spec_source.py`), reading each hit: `test_gate.py`'s typed-prompt cases depend on the keyword. Make T024 pass and the full suite pass with no other behaviour change.
- [ ] T028 [US2] Confirm no behaviour moved: `git diff main --stat` shows renames and name changes only; open PR 2 as a draft and run the internal review loop, then merge.

**Checkpoint**: one name, `alq-spec`.

## Phase 7: Polish & Cross-Cutting

- [ ] T029 Run `quickstart.md` by hand on a scratch issue: defect with holding premise, premise fails, no spec needed, defect recommended "no spec needed" (must fail `premise-report`), incomplete report (must fail at `premise-report`); after PR 2 repeat one with `/alq-review:alq-spec`.
- [ ] T030 Delete the working note and any task-state memories; delete this spec folder through the post-merge flow (`alq-post-merge`), not by hand.

## Dependencies & Execution Order

- Phase 1 → Phase 2 → Phase 3 (US1) → Phase 4 (US3) → Phase 5 → PR 1 merged → Phase 6 (US2) → Phase 7.
- Inside Phase 2: T002→T003; T004 independent of both (probe); T005→T006.
- Inside Phase 3: T007→T008→T009→T010; T011→T012 is independent of the report tasks ([P]) but both feed T013→T014; T015→T016 need T014; T017→T018 can run once T016 is in.
- US3 depends on US1's skill text (T016) and on T006 (the refusal text). US2 depends on all of PR 1 merged.

## Parallel Opportunities

- T004 beside T002/T003 and T005/T006 (different files).
- T011/T012 (`rootcause`) beside T007–T010 (`premise_report`): different files.
- T022 beside T020/T021.

## Implementation Strategy

MVP is Phases 1–3: the premise gate, the two checks and the stop outcomes work with `design-doc` still named as is. Phase 4 finishes PR 1 (deleting `alq-shape` is only safe once tackle and the root-cause check stop naming it, so T018 and T021 land in the same PR). Phase 6 is the mechanical rename in its own PR.

## Notes

- Spec and plan scope the `alq-shape` and `design-doc` pins to `plugins/`, `dev/alq-review/tests/` and `.github/` (R9), while FR-012 and SC-001 say "the repo". `docs/adr/` records (0004, 0008, 0012) name both. They are accepted records and are left as written.
- Verify each new test fails for the stated reason before writing the code that makes it pass.
