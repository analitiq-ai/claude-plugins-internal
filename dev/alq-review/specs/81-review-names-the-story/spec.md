# Feature Specification: The review launch names the user story

**Feature Branch**: `81-spec` (#81, part of #80)

**Created**: 2026-10-12

**Status**: Draft

**Input**: Issue #81, "alq-review: the review launch names the user story in two arguments, spec and story"

**Settled with the user**: in issue #81, "Wanted", "Not in scope" and "Unchanged" (2026-10-12). The launch takes
the spec folder and the story number as two arguments, not one string to parse, and the gate does not read the
PR body (2026-10-13). Decision record: ADR-0019.

## Terms

- **Spec folder**: `args.spec`, a spec folder path or `null`, read and shape-checked as today.
- **Story number**: `args.story`, a JSON integer of 1 or more. A boolean is not one.
- **Story**: the pair of a spec folder and a story number.
- **Story heading**: a line of `spec.md` that starts `### User Story <N>`, the number followed by a word
  boundary. Spec Kit writes `### User Story <N> - <title> (Priority: P<n>)`; older specs use `: ` for ` - `.

## The checks

**The arguments.** `F` is a folder that passes today's shape checks.

| `spec` | `story` | Outcome |
|---|---|---|
| `F` | `2` | accepted |
| `F` | absent, or `null` | refused: a spec folder needs a story |
| `F` | `0`, `-1` | refused: the story is 1 or more |
| `F` | `"2"`, `2.5`, `true` | refused: the story is a JSON integer |
| `null` | absent, or `null` | accepted: no spec |
| `null` | `2` | refused: no spec has no story |
| absent | `2` | refused with today's missing-`spec` message |
| a folder that fails today's shape checks | absent | refused with today's shape message |

A refusal for `story` names the form: `spec: '<folder>', story: <N>`, or `spec: null` with no `story`.

**The checks, in order.** A launch runs the rows from the top and stops at the first refusal. An audit launch is
a review-round launch here. Every refusal follows the plugin's `mode`.

| # | Check | Review-round, PR unbound | Review-round, PR bound | Assess-round |
|---|---|---|---|---|
| 1 | `spec` given, null or a non-empty string, folder shape | today's refusals and next steps | as unbound | not run: it reads the binding |
| 2 | `story`, by the arguments table | refused naming the form; next: launch with the form | as unbound | not run |
| 3 | the arguments against the binding | not run | other arguments: refused naming the binding; next: launch with the bound arguments | not run |
| 4 | `spec` is `null` | opens and binds `null` | opens | bound to `null`: opens |
| 5 | `<folder>/spec.md` in the commit and not empty | refused; next: commit it, then relaunch | as unbound | refused; next: stop and ask the user to restore it with a commit of their own |
| 6 | `spec.md`'s blob against the bound one | not run | same: go on. Changed and not released: held, recording `spec_held`, and the refusal shows the diff; next: the user's `unlock`. Changed and released by `unlock`: go on with the new blob | as bound review-round |
| 7 | the story heading for `<N>` in that `spec.md` | refused naming the heading; next: launch with a story `spec.md` has, or add the heading and commit it | refused naming the heading; next: put the heading back in `spec.md`, commit it and relaunch, which the user's `unlock` still releases | refused naming the heading; next: stop and ask the user to put it back with a commit of their own |
| 8 | all passed | opens and binds the folder, the story and the blob | opens; a released blob is bound | opens |

## Today

Read at `86a4b06` on 2026-10-12. "Run" means it was run; "read" means read in the code and not run.

- `args.spec` is a spec folder path or `null` (`plugins/alq-review/scripts/specbinding.py`, `parse`). The gate
  checks the folder's shape, that `spec.md` is in the reviewed commit and not empty, and binds the PR at its first
  round to the value and that `spec.md`'s blob id (`plugins/alq-review/scripts/gate.py`, `_spec_step`) (read).
- Each internal reviewer is told to read the whole `spec.md` and report every requirement the change does not meet
  (`plugins/alq-review/scripts/briefs.py`, `_graded_against`) (read). Under one PR per user story, every other
  story's requirements become findings against the PR.
- The assessor brief carries `spec_folder` and nothing about a story (`briefs.py`, `brief`) (read).
- The gate never reads a PR body (`plugins/alq-review/scripts/github.py` reads a PR's head and target) (read).
- A review-round launch is refused when its branch has no open PR (`gate.py`, `_open_pr`) (read).
- In `log` mode the refusals of a launch's `spec` let the round open (`plugins/alq-review/README.md`, Mode) (read).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A story PR is reviewed against its story (Priority: P1)

The caller launches a review round with `spec: '<folder>'` and `story: <N>`. The gate checks the story exists,
binds it, and the internal reviewers grade the change against that story alone.

**Why this priority**: it is the request. Without it, one PR per story is graded against every story.

**Independent Test**: launch rounds through the gate hook in `dev/alq-review/tests/test_gate.py`'s harness and
read the refusal or the injected reviewer prompts and brief.

**Acceptance Scenarios**:

1. **Given** `spec: 'dev/x/specs/7-demo'`, `story: 2` and a `spec.md` with `### User Story 2 - Reset (Priority:
   P2)` at the reviewed commit, **When** the round launches, **Then** it opens, and the PR is bound to the folder,
   the story number and the `spec.md` blob id.
2. **Given** each row of the arguments table, **When** the round launches with it, **Then** the outcome is the
   row's, and a refusal names the form.
3. **Given** each row and column of the checks table, **When** the round launches in that state, **Then** the
   outcome, any `spec_held` it records and the next step are the cell's. `### User Story 12` is no heading for
   `1`; `### User Story 1: Sign in` is one for `1`.
4. **Given** a PR bound to a story or to `null`, **When** a later launch gives other arguments (another story of
   the same spec, another folder, or `null`), **Then** it is refused as today, naming the bound arguments as the
   next launch.
5. **Given** `spec: null`, **When** the round launches, **Then** it opens, and the reviewers are told the change
   needs no spec, as today.
6. **Given** a bound story, **When** the internal reviewers are briefed, **Then** each is told to read the section
   under that story's heading in `<folder>/spec.md` and what the spec excludes, to report every acceptance scenario
   of that story the change does not meet, and to raise nothing about another story.
7. **Given** a bound story, **When** the assessor reads its brief, **Then** it carries `spec_folder` and
   `user_story`, the story number. With `spec: null` both are null.
8. **Given** a PR bound to a story whose `spec.md` changed after binding, **When** the hold refuses an edit,
   **Then** the reason names `<folder>/spec.md`, `User Story <N>`, both blob ids and the `git diff` that shows the
   change.
9. **Given** a PR bound to a story whose `spec.md` changed after binding, **When** a launch is held (checks row
   6), **Then** the refusal names `<folder>/spec.md` and `User Story <N>`.

---

### Edge Cases

- A story heading inside a fenced code block of `spec.md`: counted. The gate does not parse Markdown.
- An audit launch: names `spec` and `story` and is checked as a review-round launch. Audit reviewers still get no
  spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The launch MUST give `spec` and `story` as the arguments table accepts them. `spec` is checked as
  today.
- **FR-002**: `<folder>/spec.md` at the commit a launch checks MUST hold the story heading for `<N>`, matched at a
  word boundary after the number, in the order of the checks table. One pure function decides it, for
  review-round and assess-round launches alike.
- **FR-003**: The PR MUST be bound at its first round to the folder, the story number and the `spec.md` blob id,
  or to `null`. A later launch with other arguments MUST be refused.
- **FR-004**: The refusals of FR-001 to FR-003 MUST follow the plugin's `mode`, as today's `spec` refusals do.
- **FR-005**: Every refusal MUST name the next legal step (P1).
- **FR-006**: Internal reviewers MUST be told to grade the change against the section under the bound story's
  heading (its acceptance scenarios) and the spec's exclusions, and to raise nothing about another story.
- **FR-007**: The assessor brief MUST carry `user_story` beside `spec_folder`.
- **FR-008**: These surfaces MUST change: `plugins/alq-review/scripts/{specbinding,gate,briefs,policy}.py`,
  `plugins/alq-review/agents/assessor.md`, `plugins/alq-review/workflows/review-round.js` (`whenToUse`) and
  `plugins/alq-review/README.md`.
- **FR-009**: Tests MUST be written first and seen to fail for the reason expected, in
  `dev/alq-review/tests/test_specbinding.py`, `test_gate.py`, `test_policy.py` and `test_agents.py`, covering the
  scenarios and edge cases above.

### Key Entities

- **Story**: a spec folder and a story number, given as two launch arguments.
- **Binding**: the PR's ledger fields `spec` (the folder, or `null`) and `spec_blob`, as today, and `story`, the
  number, recorded and read only when `spec` is a folder. A row bound to `null` before this change already has
  this shape. A row whose `spec` is a folder and that has no `story` is not a binding the gate reads.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every scenario and edge case above has a test in `dev/alq-review/tests` that failed before the code
  and passes after.
- **SC-002**: A story PR's reviewers are named one story, never the whole spec: the injected prompt names `### User
  Story <N>` and no other story.
- **SC-003**: CI is green.

## Assumptions

- The caller is the source of the arguments; review reads neither the branch name nor the PR body (#80). The
  PR's `Implements:` line is a convention of the engineering git workflow, not something the gate checks.
- Out of scope: rounds before a PR exists (#70); the branch-name convention; `alq-build:issue-tackle` and the
  engineering repo's `pr-review-loop.md`, the callers that adapt (#82 and the engineering repo).
- Precondition of shipping: no open PR's ledger row is bound to a spec folder with no story, as rows bound before
  this change are. The gate does not handle older bindings (constitution III). On 2026-10-12 the only such rows
  are #77, #78 and #83, all merged.
- Unchanged: a story PR that edits `spec.md` is held until the user unlocks it (ADR-0016 decision 6, ADR-0018).

## Why this is worth doing

### harm
Answer: A story PR is graded against every story of its spec, so other stories' requirements come back as findings the PR cannot and must not meet.
Source: code: plugins/alq-review/scripts/briefs.py, `_graded_against`

### reachable
Answer: predicted. Every review round launched under one PR per user story with a spec folder.
Source: code: plugins/alq-review/scripts/briefs.py; analitiq-ai/engineering docs/engineering/git-workflow.md

### change-alters
Answer: Yes. The reviewers are named one story, and the gate refuses a story whose heading is missing.
Source: user: issue #81, "Wanted"

### owner
Answer: No. Nothing in review knows which story a PR delivers.
Source: code: plugins/alq-review/scripts/specbinding.py

### inherited
Answer: Yes. ADR-0016 decisions 1, 4 and 5 name, bind and compare `spec` alone, and ADR-0017 decision 2 names no spec headings in the reviewer prompt. ADR-0019 supersedes them: the launch also names `story`, the binding records it, a launch whose story differs is refused, and the reviewer prompt names the story's heading. ADR-0016 decision 2 stands.
Source: code: dev/alq-review/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md, dev/alq-review/docs/adr/0017-leave-the-spec-folder-s-contents-to-planning-review-reads-only-spec-md.md

### needs-spec
Answer: It changes the launch contract that alq-build and the engineering rules call, and supersedes four ADR decisions.
Source: user: issue #80, "Decided"

## Root cause

Not a defect report.
