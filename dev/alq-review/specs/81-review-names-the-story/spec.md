# Feature Specification: The review launch names the user story

**Feature Branch**: `81-spec` (#81, part of #80)

**Created**: 2026-10-12

**Status**: Draft

**Input**: Issue #81, "alq-review: the review launch names the user story in two arguments, spec and story"

**Settled with the user**: in issue #81, "Wanted", "Not in scope" and "Unchanged" (2026-10-12). The launch takes
the spec folder and the story number as two arguments, not one string to parse, and the gate does not read the
PR body (2026-10-13). This spec states the behaviour wanted, at the level of its scenarios. The outcome in each
binding state, round kind and mode, and the wording of each refusal and next step, are the plan's and the tests'
(2026-10-13); this spec is not graded for them. Decision record: ADR-0019.

## What we want

Under one PR per user story, a PR delivers one story of its spec. Every review round names that story, the gate
checks the spec has it and holds the PR to it, and the internal reviewers grade the change against that story
alone.

## Terms

- **Spec folder**: the launch's `spec`, a spec folder path or `null`, checked as today by
  `specbinding.shape_problem` (unchanged).
- **Story number**: the launch's `story`, a JSON integer of 1 or more. A boolean is not one.
- **Story heading**: a line of `spec.md` that starts `### User Story <N>`, the number followed by a word
  boundary. Spec Kit writes `### User Story <N> - <title> (Priority: P<n>)`; older specs use `: ` for ` - `.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A story PR is reviewed against its story (Priority: P1)

The caller launches a review round with `spec: '<folder>'` and `story: <N>`. The gate checks the story is in the
spec, binds the PR to it, and the internal reviewers grade the change against that story alone.

**Why this priority**: it is the request. Without it, one PR per story is graded against every story.

**Independent Test**: launch rounds through the gate hook in `dev/alq-review/tests/test_gate.py`'s harness and
read the refusal or the injected reviewer prompts and brief.

**Acceptance Scenarios**:

1. **Given** `spec: 'dev/x/specs/7-demo'`, `story: 2` and a `spec.md` with `### User Story 2 - Reset (Priority:
   P2)` at the reviewed commit, **When** the round launches, **Then** it opens, and the PR is bound to the folder,
   story 2 and that `spec.md` text.
2. **Given** each row of the arguments table, **When** the round launches with it, **Then** the outcome is the
   row's.
3. **Given** a `spec.md` with no heading for the story (the launch's on a review round, the bound one on an assess
   round), **When** the round launches, **Then** it is refused, naming the heading it looked for. `### User Story 12` is no heading for `1`;
   `### User Story 1: Sign in` is one for `1`.
4. **Given** a PR bound to a story or to `null`, **When** a later launch gives other arguments, **Then** it is
   refused, naming the bound arguments to launch with.
5. **Given** `spec: null`, **When** the round launches, **Then** it opens, and the reviewers are told the change
   needs no spec.
6. **Given** a bound story, **When** the internal reviewers are briefed, **Then** each is told to read the section
   under that story's heading in `<folder>/spec.md` and what the spec excludes, to report every acceptance scenario
   of that story the change does not meet, and to raise nothing about another story.
7. **Given** a bound story, **When** the assessor reads its brief, **Then** it carries `spec_folder` and
   `user_story`. Bound to `null`, or not yet bound, both are null.
8. **Given** a PR bound to a story whose `spec.md` changed after binding, **When** a launch or an edit is held,
   **Then** the refusal names `<folder>/spec.md`, `User Story <N>` and the change.
9. **Given** a PR whose `spec.md` change also removed the story heading, **When** a round launches before the user
   has unlocked it, **Then** it is held for the change, not refused for the heading, so the user sees the change.
10. **Given** that PR after the user's `unlock`, **When** the heading is committed back and the round relaunches,
    **Then** it opens with no second `unlock`.
11. **Given** any refusal whose next step is to launch a review round, **When** it is given, **Then** the launch it
    names carries the bound `spec` and `story`, or `spec: null` when bound to `null`, or both forms when the PR is
    not yet bound.

---

### The arguments

`F` is a folder that `specbinding.shape_problem` accepts.

| `spec` | `story` | Outcome |
|---|---|---|
| `F` | `2` | accepted |
| `F` | absent, or `null` | refused: a spec folder needs a story |
| `F` | `0`, `-1` | refused: the story is 1 or more |
| `F` | `"2"`, `2.5`, `true` | refused: the story is a JSON integer |
| `null` | absent, or `null` | accepted: no spec |
| `null` | `2` | refused: no spec has no story |
| absent | `2` | refused for the missing `spec`, as before this change |
| a folder `specbinding.shape_problem` refuses | absent | refused for the folder, as before this change |

A refusal for `story` names the form: `spec: '<folder>', story: <N>`, or `spec: null` with no `story`.

### Edge Cases

- A story heading inside a fenced code block of `spec.md` counts: the gate does not parse Markdown.
- An audit launch names `spec` and `story` and is checked like a review-round launch. Audit reviewers still get no
  spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A review-round launch MUST give `spec` and `story` as the arguments table accepts them.
- **FR-002**: A launch MUST be refused when `<folder>/spec.md` at the commit it checks has no heading for the
  story scenario 3 names. One function decides it, for review-round and assess-round launches alike.
- **FR-003**: The PR MUST be bound at its first round to the folder, the story and the `spec.md` text, or to
  `null`. A later launch with other arguments MUST be refused.
- **FR-004**: A changed `spec.md` MUST be held before the heading is checked (scenarios 9 and 10).
- **FR-005**: A next step that launches a review round MUST carry the arguments scenario 11 names.
- **FR-006**: Internal reviewers MUST be told to grade the change against the section under the bound story's
  heading and the spec's exclusions, and to raise nothing about another story.
- **FR-007**: The assessor brief MUST carry `user_story` beside `spec_folder`.
- **FR-008**: Tests MUST be written first and seen to fail for the reason expected, covering the scenarios and
  edge cases above.

### Key Entities

- **Binding**: what a PR is held to. A PR is not yet bound, bound to `null`, or bound to a spec folder, a story
  number and the `spec.md` text. A story exists only beside a folder.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every scenario and edge case above has a test in `dev/alq-review/tests` that failed before the code
  and passes after.
- **SC-002**: A story PR's reviewers are named one story, never the whole spec: the injected prompt names `### User
  Story <N>` and no other story.
- **SC-003**: CI is green.

## Assumptions

- ADR-0019 decision 1: "The caller gives both; review reads neither the branch name nor the PR body." The PR's `Implements:` line is a convention of the engineering git workflow, not something the gate
  checks.
- Out of scope: rounds before a PR exists (#70); the branch-name convention; `alq-build:issue-tackle` and the
  engineering repo's `pr-review-loop.md`, the callers that adapt (#82 and the engineering repo).
- Precondition of shipping: no open PR is bound to a spec folder with no story. The gate does not handle such
  bindings (constitution III). On 2026-10-12 the only ones are #77, #78 and #83, all merged.
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
Answer: Yes. ADR-0019 "extends ADR-0016, decision 1" and "extends ADR-0016, decisions 4 and 5": the launch also names `story`, the binding records it, and a launch whose story differs is refused. It "supersedes ADR-0017, decision 2": the reviewer prompt names the story's heading. "ADR-0016, decision 2 stands."
Source: code: dev/alq-review/docs/adr/0019-name-the-user-story-at-each-round-launch-as-a-story-argument-beside-spec.md (#93), dev/alq-review/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md, dev/alq-review/docs/adr/0017-leave-the-spec-folder-s-contents-to-planning-review-reads-only-spec-md.md

### needs-spec
Answer: It changes the launch contract that alq-build and the engineering rules call, extends three ADR decisions and supersedes one (ADR-0019).
Source: user: issue #80, "Decided"

## Root cause

Not a defect report.
