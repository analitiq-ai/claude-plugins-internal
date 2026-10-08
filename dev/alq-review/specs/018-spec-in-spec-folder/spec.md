# Feature Specification: The spec lives in the spec folder

**Feature Branch**: `feat/25-spec-in-spec-folder` (#25)

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "The feature in issue #25" (issue #25, "alq-review: the spec lives in the spec folder, not in an issue comment")

**Decided before this spec (2026-10-06)**: the spec lives in the spec folder. An issue comment is no longer its home.
It is the user's decision. This spec says what that changes for the people and the gate that use the spec.

## Terms

- **Spec**: the problem, the acceptance criteria and the decisions of one issue's change.
- **Spec folder**: the folder under a project's `specs/` that holds the spec, e.g. `dev/alq-review/specs/017-merge-grants-state-folder`.
- **Location comment**: the one issue comment marked `<!-- analitiq-spec -->`. It holds where the spec is, not the spec.
- **Gate**: the plugin's review gate, which hands the internal reviewers and the assessor the spec the change is graded against.

## Today

The spec is an issue comment marked `<!-- analitiq-spec -->`. The shaping skill posts it, the tackle skill and the
root-cause check read it from the issue, and the gate hands the same comment to each internal reviewer and to the assessor.
A test pins that the skills name no copy of the spec in the worktree. Spec folders 007, 009, 010, 011, 012, 014 and
015 open by saying their problem and acceptance criteria are that comment and that the folder records only design
decisions. The design-doc skill already creates a spec folder, from the issue body.

Two places therefore claim to hold the spec, and they drift. Changing only the skills' wording would leave the
gate grading every review against a comment the skills no longer call the spec.

## Clarifications

### Session 2026-10-08

- Q: Which skill posts the location comment on the issue, as part of #25? → A: `design-doc` posts it. `alq-shape` is not changed in #25; #57 merges it into `design-doc`.
- Q: What does the gate do when the branch name has no issue number? → A: Keep today's behaviour: the review runs, and the reviewers get no spec.
- Q: Which files from the spec folder does the gate give the reviewers and the assessor? → A: The text of `spec.md` in the prompt, plus the folder's path so a reviewer can open the other files.
- Q: What does the gate do with an issue that still has an old-style spec comment (the marker followed by the whole spec)? → A: Refuse it like any other malformed location comment, and tell the user to run `design-doc` on the issue.
- Q: Where is the test for a committed `.specify/` beside `specs/` written: here or in #56? → A: Neither: at the critique review the user dropped the check from #25. The user's reason: `.specify/` is committed once, not in every PR. #56 writes the test for its own check.
- Q: At what point in a `design-doc` run is the location comment posted? → A: At the end, after `tasks.md` is written and the run completes. An aborted run posts none.
- Q: Who decides that an issue needs no spec, and how does `spec: none` get posted? → A: The user decides and runs `/alq-review:design-doc #<issue> none <reason>`, which posts the comment and runs nothing else.
- Q: `alq-issue-tackle` requires a Hand-maintained surfaces section and `alq-root-cause-check` a Root cause section, and a `design-doc` spec has neither. What happens between #25 and #57? → A: #25 removes the Hand-maintained surfaces stop from `alq-issue-tackle`, and accepts that `alq-root-cause-check` returns CANNOT TELL until #57.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The gate grades a change against the spec in its folder (Priority: P1)

A developer works on an issue whose location comment names a spec folder. When the gate runs a review round or an
assessment, the reviewers and the assessor are handed the spec from that folder, whatever else the branch changed.

**Why this priority**: the gate is what makes the spec binding. If it still reads the comment, nothing else in this
change holds.

**Independent Test**: on a branch whose issue has a location comment naming folder A, change files in spec folders A and B
(and, separately, in none). Run a review round. The reviewers' brief carries A's spec and no other.

**Acceptance Scenarios**:

1. **Given** an issue whose location comment names a spec folder that is in the checkout, **When** the gate runs a review round, **Then** each reviewer's prompt holds the text of that folder's `spec.md` and the folder's path, so the reviewer can open the folder's other files.
2. **Given** the same issue, **When** the gate runs an assessment, **Then** the assessor's prompt holds the same `spec.md` text and folder path.
3. **Given** a branch that changes two spec folders, or none, **When** the gate runs, **Then** it reads the folder the issue's location comment names, not a folder it guessed from the diff.
4. **Given** a location comment that says `spec: none` with its one-line reason, **When** the gate runs, **Then** the reviewers are handed no spec and are told the issue needs none, with the reason.

---

### User Story 2 - The gate refuses, and says what to do, when the spec cannot be found (Priority: P1)

When the issue's location comment is missing, or points at nothing usable, the gate does not carry on without a spec. It
refuses and names the next step.

**Why this priority**: today a missing spec is a silent, empty brief. A missing location comment must never read as "no spec".

**Independent Test**: for each of the failing states below, run the gate and read the refusal.

**Acceptance Scenarios**:

1. **Given** an issue with no location comment, **When** the gate runs, **Then** it refuses and names `design-doc` as the skill that posts the location comment.
2. **Given** a location comment naming a folder that is not in the checkout, **When** the gate runs, **Then** it refuses, names the folder, and names the branch the location comment says holds it.
3. **Given** a location comment that is not in the form `spec:` / `branch:` (or `spec: none` with a reason), **When** the gate runs, **Then** it refuses and says what the form is.

---

### User Story 3 - A finished `design-doc` run leaves the issue pointing at its spec folder (Priority: P1)

After a `design-doc` run completes (its last step has written `tasks.md`), the skill commits the spec folder, pushes
the branch, and then posts the location comment, so the comment means the spec is finished and work may start. A run that is rejected at grill or at critique, or that
fails, posts no location comment. The user decides that an issue needs no spec and runs
`/alq-review:design-doc #<issue> none <reason>`: the skill posts a location comment reading `spec: none` with that
reason, and runs no workflow and creates no folder.

**Why this priority**: the gate's refusals in Story 2 are only fair if the skill that creates the folder also
posts the location comment.

**Independent Test**: run `design-doc #<issue>` on a new issue and `design-doc #<issue> none <reason>` on another. Read each issue's comments.

**Acceptance Scenarios**:

1. **Given** an issue `design-doc` is run on, **When** the run completes, **Then** the spec folder is committed, the branch is pushed, and the issue has exactly one `<!-- analitiq-spec -->` comment, holding `spec:` (path from the repo root) and `branch:`, and no copy of the spec.
2. **Given** an issue that already has the location comment, **When** the step runs again, **Then** the one comment is updated, not a second one added.
3. **Given** a `design-doc` run that is rejected at grill or at critique, **When** it stops, **Then** the issue has no location comment.
4. **Given** the user runs `design-doc #<issue> none <reason>`, **When** it finishes, **Then** the issue's location comment reads `spec: none` with the reason, no spec folder is created, and no "No shape needed" comment is posted.
5. **Given** `design-doc #<issue> none` with no reason, **When** it is run, **Then** it posts nothing and asks for the reason.

---

### User Story 4 - Starting work reads the location comment, and the skills name one home for the spec (Priority: P2)

`alq-issue-tackle` reads the location comment to know that it may start and which branch to check out. The skills that
mention where the spec lives (`design-doc`, tackle, root-cause check) all say: the spec folder, found by the location comment.
None says the spec is an issue comment, and none forbids a copy of it in the worktree.

**Why this priority**: it removes the second home. It follows once the gate and the location comment exist.

**Independent Test**: read the three skills; run the tackle skill on an issue with a location comment and on one without.

**Acceptance Scenarios**:

1. **Given** an issue with a location comment naming a branch, **When** the tackle skill starts, **Then** it checks out that branch and works from the folder's spec.
2. **Given** an issue with no location comment, **When** the tackle skill starts, **Then** it does not start and names `design-doc` as the skill that posts the location comment.
3. **Given** a spec with no Hand-maintained surfaces section, **When** the tackle skill starts, **Then** it starts.
4. **Given** the three skills, **When** their text is read, **Then** none calls an issue comment the spec's home, and each names the location comment as the way to the folder.

### Edge Cases

- A location comment whose `spec` path leaves the repo (an absolute path, or `..`) is refused as not a spec folder.
- More than one `<!-- analitiq-spec -->` comment on an issue is refused; there is one location comment per issue.
- A location comment whose folder is in the checkout but whose `spec.md` is missing or empty is refused like a missing folder.
- The location comment's `branch` is not the branch under review: the gate reads the folder in the checkout it is in and does not fetch another branch.
- A branch whose name carries no issue number has no location comment to read: the review runs with no spec (FR-014).
- An issue shaped before this change has a comment with the marker and the whole spec, and no `spec:` line: refused as malformed (FR-010).
- `alq-shape` run by hand after this change still posts a comment with the marker and the whole spec; the gate refuses it as malformed (FR-010) until #57 deletes the skill.
- This issue's own spec folder (this one) is written before the rule exists; the location comment for #25 is posted by hand when the branch is pushed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The spec of an issue MUST live in a spec folder; no skill and no gate step may treat an issue comment as the spec.
- **FR-002**: The issue MUST carry exactly one comment marked `<!-- analitiq-spec -->`, the location comment, holding `spec: <folder path from the repo root>` and `branch: <branch that holds it>`, or `spec: none` with a one-line reason.
- **FR-003**: The `design-doc` skill, which creates the spec folder, MUST, after its run completes and not before, commit the spec folder, push the branch, and then post the location comment, and MUST update the existing location comment rather than add a second.
- **FR-004**: An issue that needs no spec MUST say so in its location comment (`spec: none` and why). A missing location comment MUST never be read as "no spec". The user makes that call: `design-doc #<issue> none <reason>` MUST post `spec: none` with the reason, create no folder, and refuse when the reason is empty.
- **FR-005**: The gate MUST get from the branch name to the issue and from the issue to the location comment, and MUST put into the prompt of each internal reviewer and of the assessor the text of `spec.md` from the folder the location comment names, and that folder's path. No other file of the folder is put into the prompt.
- **FR-006**: The gate MUST read the folder the location comment names, never one picked from what the branch changed.
- **FR-007**: The gate MUST refuse, naming the next step, when the issue has no location comment.
- **FR-008**: The gate MUST refuse, naming the folder and the branch the location comment names, when the folder is not in the checkout.
- **FR-010**: The gate MUST refuse a location comment that is malformed, repeated, or names a path outside the repo. A comment that carries the marker and the whole spec, as `alq-shape` posted it before this change, is malformed: the gate refuses it and names `design-doc` as the skill to run on the issue. The gate MUST NOT read such a comment as the spec.
- **FR-011**: `alq-issue-tackle` MUST read the location comment before starting, check out the branch it names, and refuse to start when there is no location comment, naming `design-doc` as the skill to run. It MUST NOT call `alq-shape`, and MUST NOT stop because the spec has no Hand-maintained surfaces section.
- **FR-012**: The `design-doc`, tackle and root-cause-check skills MUST name the spec folder, found by the location comment, as the spec's home, and MUST NOT forbid a copy of the spec in the worktree.
- **FR-013**: The test that pins "the skills name no copy of the spec in the worktree" MUST be replaced by tests that pin the new rule (FR-001 to FR-012).
- **FR-014**: When the branch name carries no issue number, the gate MUST run the review and hand the reviewers and the assessor no spec, as it does today. It MUST NOT refuse.

### Key Entities

- **Spec folder**: holds the spec and the design records of one issue's change; found only through the location comment.
- **Location comment**: the one issue comment that says where the spec is and which branch holds it, or that there is none and why.
- **Gate refusal**: a refusal that names the missing thing and the one next step that fixes it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In every refusal state (no location comment, folder not in checkout, malformed location comment) the gate hands the reviewers nothing and the refusal names the next step; no run ends with an empty spec and no message.
- **SC-002**: On a branch that changes two spec folders, and on one that changes none, the reviewers are handed the spec from the folder the location comment names, in 100% of runs.
- **SC-003**: Every issue `design-doc` is run on after this change has exactly one location comment and no comment that holds the spec's text.
- **SC-004**: A search of the three skills and the gate for the phrases "spec lives on the issue" and "its only home" finds none.
- **SC-005**: A developer can go from an issue to its spec by reading one comment and opening one path.

## Assumptions

- A `spec.md` that `design-doc` writes has no Root cause section and no Hand-maintained surfaces section; only `alq-shape` wrote those. Until #57, `alq-root-cause-check` therefore returns CANNOT TELL, which does not block, and no surfaces list is made. This gap is accepted.
- `alq-shape` is not changed here. No skill calls it after this change, and #57 merges its checks into `design-doc` and deletes it.
- `<!-- analitiq-premise -->`, the comment that challenges an issue's premise, is not touched by this change; it keeps its place on the issue.
- The existing spec folders are not edited to copy their acceptance criteria in. Folders of merged issues are not guaranteed to stay, and the issue comment keeps their text for as long as they need it; the opening lines of those folders that call the comment the spec stay as history.
- Spec 014 (the gate hands the reviewers the comment) is superseded by this one where they disagree.
- The gate does not test for a committed `.specify/` beside the folder's `specs/`, though issue #25 lists that refusal. The user dropped it, on the ground that `.specify/` is committed once, not in every PR. #56 keeps that test for the settled-design check.
- The location comment's `branch` and `spec` lines are plain `key: value` lines under the marker, as in the issue's example.
