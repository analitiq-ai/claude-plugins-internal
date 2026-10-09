# Feature Specification: One planning skill, `alq-spec`

**Feature Branch**: `feat/57-merge-shape-into-alq-spec` (#57)

**Created**: 2026-10-08

**Status**: Draft

**Input**: User description: "The feature in issue #57" (issue #57, "alq-review: merge alq-shape into design-doc, then rename design-doc to alq-spec")

## Terms

- **Spec**: the problem, the acceptance criteria and the decisions of one issue's change.
- **Spec folder**: the folder under a project's `specs/` that holds the spec, e.g. `dev/alq-review/specs/018-spec-in-spec-folder`.
- **Planning skill**: the skill a person runs on an issue before any code is written, to produce its spec.
- **Premise**: the claim an issue makes that something is worth changing. It has two halves: the issue fixes a real harm, and the proposed change reaches that harm.

## Today

Two planning skills exist, and they write to different places. `alq-shape` posts a spec as an issue comment. `design-doc` runs the
specify, grill, plan, critique, tasks cycle and writes a spec folder. Since #25, the spec folder is the spec's home, and `design-doc`
posts the location comment that points at it. `alq-shape` still posts a spec comment.

Each skill does checks the other lacks:

- Only `alq-shape` challenges the premise, judges whether the issue needs a spec at all, traces a defect to its root cause (labelled
  observed or predicted), and lists the hand-maintained surfaces the design adds (copies a person must keep in step with their source by hand).
- Only `design-doc` produces the spec folder with its plan, critique and tasks.

Neither can be dropped as it stands, and an issue can end up with two specs that disagree. The name `design-doc` also misleads: the
skill produces a spec folder, not a design document, the settled-design check uses "design document" for something else, and every
other skill in the plugin is named `alq-<thing>`.

## Clarifications

### Session 2026-10-08

- Q: Where do the premise test and the "does this need a spec" judgement run? → A: In a new pause step, `premise`, the first step of the workflow, before `specify`. It is built like grill: the workflow pauses, the skill answers the premise questions in the session and asks the user what the code cannot answer, writes the answers to a premise report, and states its verdict. The user then picks the outcome. A script step right after fails the run when the report is incomplete.
- Q: When the user picks "not worth doing" at the `premise` step, where does the finding go? → A: It is posted as a comment on the issue, in the same format as the location comment (a marker line, then `key: value` lines), so the issue's machine-read comments stay one format.
- Q: How does the user decide at the `premise` step, and who marks the issue when no spec is needed? → A: The user does not approve or reject. The skill gives its recommendation and the user picks one of three outcomes by name: "write the spec" (the workflow continues to `specify`), "no spec needed" (the run stops and the skill posts the `spec: none` location comment with the reason), or "not worth doing" (the run stops and the skill posts the premise finding). The user's pick decides, whatever the skill recommended.
- Q: `alq-shape` has three behaviours beyond the four checks this change moves (a defect's acceptance criteria must name the root-cause module and a second caller; a source tag on every decision; answering from industry practice before asking the user). Keep any? → A: Drop all three from this change. The acceptance-criteria rule is filed as its own feature, #59.
- Q: Which file of the spec folder holds the root cause section? → A: `spec.md`. `alq-issue-tackle`, `alq-root-cause-check` and the review gate all read `spec.md` only, so no reader changes.
- Q: One pull request or two? → A: Two. The first merges `alq-shape` into `design-doc` and deletes `alq-shape`; the second renames `design-doc` to `alq-spec` and changes no behaviour.
- Q: Five next-step messages the rename touches say what the skill does not do (#64). Correct them in a third pull request? → A: No. The rename pull request corrects them, each with a test.
- Q: How does a "not worth doing" finding fit the location comment's format? → A: As a third form of the location comment itself, strictly two lines after the marker: a `spec:` line saying the issue is not worth doing, and a one-line `reason:`. No further fields, and no second comment.
- Q: Is `alq-shape`'s list of hand-maintained surfaces moved into the merged skill? → A: No. It is dropped with `alq-shape`. Three checks move: the premise test, the needs-a-spec judgement and the root cause.
- Q: Is the up-front root cause trace kept, given the assessor names each review finding's mechanism during review? → A: Kept. The assessor works after the code is written; the trace aims the fix before it is.
- Q: Who writes the root cause into `spec.md`, and when? → A: The `specify` step writes the `## Root cause` section, from a section added to the spec template. A script step right after `specify` fails the run when the section or its `Observed:` line is missing. The user corrects the trace in grill.
- Q: Is the direct `#<issue> none <reason>` entry kept, now that "no spec needed" is also a pick at the `premise` step? → A: Kept. An issue that is plainly worth doing and needs no spec, such as a typo fix, is marked directly, without the premise questions.
- Q: Which critique findings are accepted? → A: Five. The root cause check fails a section that says "does not apply" for an issue the premise report calls a defect. The skill learns an issue's state as one of four named results. A stop pick needs only the answers up to the one it rests on. The root cause check runs again after grill. The root cause step belongs to the first pull request.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One skill plans an issue, with every check (Priority: P1)

A developer runs one skill on an issue. The workflow's first step, `premise`, pauses before a spec folder exists: in the session, the
skill tests the issue's premise, judges whether a spec is needed, and recommends an outcome. The user picks one of three: write the spec, no spec needed, or not worth doing. On "write the spec", the workflow runs the specify, grill, plan, critique, tasks cycle, and the resulting spec folder holds what `alq-shape`
used to put in its comment.

**Why this priority**: the merge is the point of the issue. Until one skill carries every check, neither skill can be removed.

**Independent Test**: run the skill on a defect issue, on an issue whose premise fails, and on an issue that needs no spec. Read what
each run leaves behind.

**Acceptance Scenarios**:

1. **Given** a defect issue whose premise holds, **When** the skill runs to completion, **Then** the spec folder holds the premise answers and the root cause with its `Observed:` line.
2. **Given** an issue whose premise fails, **When** the `premise` step runs, **Then** the skill says which premise question failed and why and recommends "not worth doing"; when the user picks it, the run stops with no spec folder created and the issue's location comment says it is not worth doing, with the reason.
3. **Given** an issue that needs no spec, **When** the `premise` step runs, **Then** the skill says why and recommends "no spec needed"; when the user picks it, the run stops with no spec folder created and the issue's location comment reads `spec: none` with the reason.
4. **Given** an issue that reports something behaving wrongly, **When** the skill judges whether a spec is needed, **Then** it never answers "no spec needed", however small the fix looks. The size of a defect's fix is an output of tracing it.
5. **Given** a root cause the run could not observe, **When** the spec is written, **Then** its `Observed:` line says the trace is a hypothesis, in that word.

---

### User Story 2 - There is one skill name, and it fits (Priority: P1)

The merged skill is invoked as `/alq-review:alq-spec`. Nothing in the repo names the skill or its workflow `design-doc`, and nothing
names `alq-shape`. Uses of "design document" that mean the settled-design rule (#29) are not the skill's name and stay as they are.

**Why this priority**: a skill that is half renamed is invoked under a name that does not resolve.

**Independent Test**: search the repo for `design-doc` and `alq-shape`; invoke `/alq-review:alq-spec`.

**Acceptance Scenarios**:

1. **Given** the change is done, **When** `plugins/` and `dev/alq-review/tests/` are searched for `alq-shape`, **Then** nothing matches and `skills/alq-shape/` does not exist.
2. **Given** the change is done, **When** the repo is searched for `design-doc` as a skill or workflow name, **Then** nothing matches. The workflow id, its install path, the skill folder, the gate, the policy, the settled-design check, the config, the README, the CI workflow and the tests all use `alq-spec`.
3. **Given** the change is done, **When** a user runs `/alq-review:alq-spec #<issue>`, **Then** the merged skill runs.
4. **Given** text that uses "design document" for the settled-design rule, **When** the rename is applied, **Then** that text is unchanged.

---

### User Story 3 - The skills that depended on `alq-shape` keep working (Priority: P1)

`alq-issue-tackle` calls `alq-shape` when an issue has no spec. `alq-root-cause-check` reads the `## Root cause` section and its
`Observed:` line. After the merge both work against the spec folder.

**Why this priority**: removing `alq-shape` while tackle still calls it leaves tackle pointing at nothing.

**Independent Test**: run tackle on an issue with no spec; run the root-cause check on a spec folder produced by the merged skill.

**Acceptance Scenarios**:

1. **Given** an issue with no spec, **When** `alq-issue-tackle` starts, **Then** it names `alq-spec`, not `alq-shape`, as the skill that produces it.
2. **Given** a spec folder produced by the merged skill, **When** `alq-root-cause-check` reads it, **Then** it finds the `## Root cause` section and its `Observed:` line and does not return CANNOT TELL for want of them.

---

### Edge Cases

- An issue that already has a location comment or a spec folder: the merged skill does not create a second spec for it. It tells the user the spec exists and where.
- An issue whose premise is inherited from another spec's decision: the inherited decision is put to the premise questions itself. That the files it names still exist does not re-verify it.
- A re-run on an issue marked "no spec needed" or "not worth doing": the `premise` step runs as on any issue, and the user's new pick replaces the location comment.
- Before the workflow starts, the skill learns the issue's state from the code that owns the location comment, as exactly one of: has a spec folder, no spec needed, not worth doing, no location comment. A comment that cannot be read is a refusal, not one of the four. Only "has a spec folder" stops the skill.
- A re-scope of a pull request held by a RESHAPE_SPEC ruling: the `premise` step does not run, as `specify` does not. The spec folder exists and the issue was judged when it was first scoped.
- The user disagrees with the skill's recommendation: the pick at the `premise` step is the user's, so they pick another outcome and it decides. The premise report records both the recommendation and the pick.
- The premise report is missing, lacks an answer, or has an answer with no source: the script step after `premise` fails the run, whatever verdict was passed.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The planning workflow's first step MUST be a pause step, `premise`, that runs before `specify` and so before any spec folder is created. In it the skill MUST test the issue's premise in the session, for every issue, including a sub-issue and a request the issue fully determines, asking the user only what the code cannot answer, and MUST write the answers to a premise report.
- **FR-002**: The premise test MUST ask: what goes wrong if the issue is never done; can that happen on the default branch (labelled observed or predicted); does the proposed change alter that outcome; does something already own the risk; is the premise inherited. Each answer MUST carry its source.
- **FR-003**: At the `premise` step the skill MUST recommend one of three outcomes and the user MUST pick one by name: "write the spec", "no spec needed" or "not worth doing". The step MUST NOT ask for approve or reject. The user's pick decides: "write the spec" continues to `specify`; the other two stop the run with no spec folder created. When the premise fails, the skill MUST say which question failed, with its evidence. The premise report MUST record the recommendation and the pick.
- **FR-004**: The skill MUST judge, in the `premise` step, whether the issue needs a spec. An issue that reports wrong behaviour MUST NOT be judged as needing none.
- **FR-005**: When the skill judges that no spec is needed, it MUST say why. When the user picks "no spec needed", the skill MUST post the `spec: none` location comment with the reason, in the same run; the user runs no second command.
- **FR-006**: For a defect, `spec.md` MUST hold a `## Root cause` section that opens with an `Observed:` line, naming the observation the trace is anchored to or stating that the trace is a hypothesis.
- **FR-007**: A root cause MUST keep what was examined and ruled out apart from what was not investigated, and MUST label each claim about other callers verified or predicted.
- **FR-008**: For a change that is not a defect report, `spec.md` MUST keep the `## Root cause` heading and state under it that the section does not apply, so a reader can tell the trace was considered rather than skipped.
- **FR-021**: The `specify` step MUST write the `## Root cause` section, from a section of the spec template. A script step right after `specify` MUST fail the run when `spec.md` has no `## Root cause` section, or the section opens with neither an `Observed:` line nor the statement that it does not apply, or the section states that it does not apply while the premise report says the issue reports wrong behaviour. The same script step MUST run again after grill, since the user may edit the section there. The script checks that the section is there and labelled, not that the trace is right; the user corrects the trace in grill.
- **FR-009**: `alq-shape`'s list of hand-maintained surfaces MUST NOT be carried into the workflow. It goes with `alq-shape`.
- **FR-010**: For an issue whose premise holds, `spec.md` MUST hold the premise answers, with their sources, since `spec.md` is the one file `alq-issue-tackle`, `alq-root-cause-check` and the review gate read.
- **FR-011**: The checks in FR-001 to FR-010 MUST be steps of the planning workflow itself, so a run that skips one fails; they MUST NOT be prose a skill asks the model to remember. A script step right after `premise` MUST fail the run when the premise report is missing, lacks an answer to a premise question or to the needs-a-spec judgement, or holds an answer with no source. For "write the spec" every question MUST be answered. For "no spec needed" and "not worth doing" the script MUST require only the questions up to and including the one the outcome rests on, and the reason; it MUST NOT make the skill invent an answer to a question the outcome made moot.
- **FR-012**: `plugins/alq-review/skills/alq-shape/` MUST be deleted, and no file under `plugins/` or `dev/alq-review/tests/` may name `alq-shape`. Accepted ADRs and other spec folders are records and are left as written.
- **FR-013**: The skill and its workflow MUST be renamed from `design-doc` to `alq-spec`, in every place the skill or workflow is named: the skill folder, the workflow id, the workflow's install path, the gate, the policy, the settled-design check, the plugin config, the README, the CI workflow and the tests. Uses of "design document" that mean the settled-design rule MUST be left alone.
- **FR-014**: `alq-issue-tackle` MUST name the merged skill where it named `alq-shape`: `design-doc` after the first pull request, `alq-spec` after the second.
- **FR-019**: Of `alq-shape`, only the premise test, the needs-a-spec judgement and the root cause (FR-001 to FR-008, FR-010) move into the workflow. Its rule for a defect's acceptance criteria (#59), its source tag on every decision, and its answering from industry practice MUST NOT be carried over. Text in another skill that depends on a dropped behaviour, such as `alq-issue-tackle`'s instruction to re-check a decision tagged `(code)`, MUST be removed with it.
- **FR-020**: The change MUST land as two pull requests, in this order: the merge (FR-001 to FR-012, FR-014 to FR-016, FR-018, FR-019, FR-021), then the rename (FR-013, FR-017, FR-022). The rename pull request MUST change no behaviour other than the messages of FR-022. Between the two, the merged skill is still named `design-doc`, and `alq-issue-tackle` names it so.
- **FR-015**: `alq-root-cause-check` MUST find the `## Root cause` section and its `Observed:` line in the spec folder a merged-skill run produces.
- **FR-016**: The merged skill MUST keep every entry point `design-doc` has: scope an issue, re-scope a PR held by a RESHAPE_SPEC ruling, and record that an issue needs no spec. The direct `#<issue> none <reason>` entry MUST stay a shortcut that starts no workflow and runs no `premise` step.
- **FR-017**: The `design-doc` content moved by the rename MUST be unchanged except for the name, apart from the steps this change adds and the messages of FR-022.
- **FR-022**: The rename pull request MUST correct the five next-step messages of #64, which tell the user what the planning skill does not do: `speclocation.py`'s refusals of a comment with text and no `spec:` line (delete the comment, then run the skill), of an issue with no location comment and of an issue judged not worth doing (the command, with no promise of its outcome), and `alq-issue-tackle`'s step on a SPEC WRONG verdict (no more code; tell the user what the trace got wrong) and its no-comment step (the command, with no promise). A test MUST pin each message. The two test names in `test_spec_source.py` that the rename touches and that say more than their tests check are corrected too.
- **FR-018**: When the user picks "not worth doing" at the `premise` step, the skill MUST write the issue's location comment in a third form: the marker, a `spec:` line saying the issue is not worth doing, and a one-line `reason:`. It is the same one comment per issue, written and read by the code that owns the location comment; there MUST NOT be a second comment or a second parser. `alq-issue-tackle` MUST refuse to start on an issue whose location comment has this form, and say why.

### Key Entities

- **Premise answers**: the answers to the premise questions, each with its source (code, a reproduction, or the user), held in the spec folder.
- **Root cause**: the mechanism and the module where the wrong decision is made, anchored to an `Observed:` line.
- **Premise report**: what the `premise` step writes: the premise answers, the needs-a-spec judgement, the skill's verdict and the user's.
- **Premise finding**: what the skill reports in the session when the premise fails. On "not worth doing", its one-line reason goes into the location comment.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A search of `plugins/` and `dev/alq-review/tests/` for `alq-shape` returns no matches.
- **SC-002**: A search of the repo for `design-doc` as a skill or workflow name returns no matches; the only remaining uses of "design document" are the settled-design rule's.
- **SC-003**: A run on a defect issue with a holding premise leaves one spec folder in which both the premise answers and a root cause with an `Observed:` line are present.
- **SC-004**: A run where the user picks "not worth doing" leaves zero new spec folders and a location comment on the issue that says it is not worth doing, with the reason; a run where the user picks "no spec needed" leaves zero new spec folders and a `spec: none` location comment on the issue.
- **SC-005**: The plugin's test suite passes after the change, with the tests that named `design-doc` renamed and a test for each new check.
- **SC-006**: After the change, a person who wants to plan an issue has one skill to run, not two.

## Assumptions

- #25 is merged (PR #58), so the spec folder is the spec's home and the gate, tackle and the root-cause check already read it. This change lands after it.
- The premise comment `<!-- analitiq-premise -->` and its free-text layout are `alq-shape`'s and go with it (FR-018 replaces it).
- Out of scope: requiring a defect's acceptance criteria to name the root-cause module and a caller other than the reported one. It is #59, which depends on this change.
- The rename leaves the "design document" rule (#29) alone; which occurrences are the rule and which are the skill's name is decided file by file during planning.
- The user decides, as today, when to run the skill. The skill does not decide to run itself.
