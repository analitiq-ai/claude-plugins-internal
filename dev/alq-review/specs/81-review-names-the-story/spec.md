# Feature Specification: The review launch names the user story

**Feature Branch**: `81-spec` (#81, part of #80)

**Created**: 2026-10-12

**Status**: Draft

**Input**: Issue #81, "alq-review: the launch names the user story, spec: '<folder>/spec.md § User Story <N>', and
the gate checks it against the PR header"

**Settled with the user (2026-10-12)**: in issue #81, "Wanted", "Not in scope" and "Unchanged". Decision record:
ADR-0019.

## Terms

- **Story value**: `<folder>/spec.md § User Story <N>`, the notation of a PR body's `Implements:` line.
  `<folder>` is a spec folder's path from the repo root; `<N>` is a story number of its `spec.md`. It has one
  spelling: nothing before or after it, one ASCII space on each side of `§` and between `Story` and `<N>`, and
  `<N>` with no leading zero. So two story values name the same folder and story exactly when they are the same
  string. Each input says where its value starts and ends: `args.spec` and the binding are the whole string, the
  Implements line's value is defined below; the one spelling is checked on that, nothing stripped from it.
- **Story heading**: a line of `spec.md` that starts `### User Story <N>`, the number followed by a word
  boundary. Spec Kit writes `### User Story <N> - <title> (Priority: P<n>)`; older specs use `: ` for ` - `.
- **Implements line**: the PR body's first line that starts `Implements:`, wherever it is in the body. A line ends
  at `\n` or `\r\n`, which is not part of it, or at the end of the body. Its value is the rest of the line after
  `Implements: ` (the colon and one ASCII space), nothing stripped. A story PR's is `Implements: <story value>`.

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

The caller launches a review round with `spec: '<folder>/spec.md § User Story <N>'`, as the PR's `Implements:`
line names it. The gate checks the story exists and agrees with the PR's Implements line, binds it, and the internal
reviewers grade the change against that story alone.

**Why this priority**: it is the request. Without it, one PR per story is graded against every story.

**Independent Test**: launch rounds through the gate hook in `dev/alq-review/tests/test_gate.py`'s harness, with
a stand-in `gh` that answers the PR body, and read the refusal or the injected reviewer prompts and brief.

**Acceptance Scenarios**:

1. **Given** `spec: 'dev/x/specs/7-demo/spec.md § User Story 2'`, a `spec.md` with `### User Story 2 - Reset
   (Priority: P2)` at the reviewed commit, and a PR body whose first `Implements:` line is the same value, **When**
   the round launches, **Then** it opens, and the PR is bound to the whole value and the `spec.md` blob id.
2. **Given** a value that is not `<folder>/spec.md § User Story <N>` or `null` (a bare folder, `§ US2`,
   `User Story 02`, `User Story 0`, `<folder>/spec.md  §  User Story 2`, a value with a space before or after
   it), **When** the round launches, **Then** it is refused, and the message names the form.
3. **Given** a folder that fails today's shape checks, **When** the round launches, **Then** it is refused as
   today (`shape`).
4. **Given** a `spec.md` with no story heading for `<N>` at the reviewed commit, **When** the round launches,
   **Then** it is refused, and the message names the heading it looked for. `### User Story 12` is no heading for
   `1`. `### User Story 1: Sign in` is one for `1`.
5. **Given** a PR bound to one value, **When** a later launch gives another (another story of the same spec, or
   `null`), **Then** it is refused as today, naming the bound value.
6. **Given** a PR body whose first `Implements:` line names another folder or story than the value, **When** the
   round launches, **Then** it is refused, and the message quotes both.
7. **Given** a non-null value and a PR body with no `Implements:` line, **When** the round launches, **Then** it is
   refused, and the message names the line to add.
8. **Given** `spec: null` and a PR body with an `Implements:` line, **When** the round launches, **Then** it is
   refused, and the message names both ways out: launch with the line's value, or remove the line.
9. **Given** `spec: null` and a PR body with no `Implements:` line, **When** the round launches, **Then** it opens,
   and the reviewers are told the change needs no spec, as today.
10. **Given** a bound story value, **When** the internal reviewers are briefed, **Then** each is told to read the
    section under that story's heading in `<folder>/spec.md` and what the spec excludes, to report every
    acceptance scenario of that story the change does not meet, and to raise nothing about another story.
11. **Given** a bound story value, **When** the assessor reads its brief, **Then** it carries `spec_folder` and
    `user_story`, the story number. With `spec: null` both are null.
12. **Given** `gh` cannot answer the PR body, **When** the round launches, **Then** in `enforce` mode it is
    refused, and the message says the check could not run and names the next step. In `log` mode it is recorded as
    `would_deny` and the round opens, as every `spec` refusal is (FR-007). It is never recorded as a pass.
13. **Given** a PR bound to a story value whose `spec.md` changed after binding, **When** the hold refuses an edit,
    **Then** the reason names `<folder>/spec.md`, `User Story <N>`, both blob ids and the `git diff` that shows the
    change.
14. **Given** a PR bound to a story value whose `spec.md` changed after binding, **When** a review-round or
    assess-round launch finds it changed, **Then** the refusal names `<folder>/spec.md` and `User Story <N>`, never
    the whole value as a folder.

---

### Edge Cases

- The Implements line, one case per clause of its definition in Terms. Each refused case quotes the line and names
  the form.
  - Which line: of two lines that start `Implements:`, the first counts, the second in prose further down does
    not; a body whose only such line is further down counts it. A line with anything before `Implements:` (a
    space, other text) is not an Implements line.
  - Where the value starts: exactly one ASCII space after `Implements:` counts; no space or two spaces is refused.
  - Where the value ends: each counts on its own — a line ending `\n`, a line ending `\r\n`, and the body's last
    line with no line end after the value.
  - What lies between: a story value in its one spelling counts. Anything else is refused: a space or tab after
    the value, a bare `\r` inside the line, `§` with two spaces before it, a value not in the story form.
- A story heading inside a fenced code block of `spec.md`: counted. The gate does not parse Markdown.
- `spec.md` changes after binding and the user unlocks it: the next launch binds the new blob, and the story
  heading is checked again in it. A heading the change removed refuses the launch.
- An assess-round launch: it checks `<folder>/spec.md` of the parsed binding at its commit, as today, and the
  story heading in it. It does not read the PR body.
- An audit launch: names `spec` and is checked as above. Audit reviewers still get no spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `args.spec`, the whole string with nothing stripped, MUST be a story value in its one spelling, or
  `null`. Any other value, another spelling of a story value included, MUST be refused, naming the form.
- **FR-002**: The folder of a story value MUST pass today's shape checks.
- **FR-003**: `<folder>/spec.md` at the commit a launch checks MUST hold the story heading for `<N>`, matched at a
  word boundary after the number. One pure function decides it, for review-round and assess-round launches alike.
- **FR-004**: The PR MUST be bound at its first round to the whole value and the `spec.md` blob id. A later launch
  with another value MUST be refused.
- **FR-005**: At every review-round launch the gate MUST read the PR body. Its first line that starts
  `Implements:` MUST name the same folder and story as a non-null value, MUST be present for a non-null value, and
  MUST be absent for `null`. The line's value, as Terms defines it, MUST be parsed by the same function as
  `args.spec`. One pure function decides the comparison.
- **FR-006**: A PR body `gh` cannot read MUST refuse the launch as a check that could not run (P4).
- **FR-007**: The refusals of FR-001 to FR-006 MUST follow the plugin's `mode`, as today's `spec` refusals do.
- **FR-008**: Every refusal MUST name the next legal step (P1).
- **FR-009**: Internal reviewers MUST be told to grade the change against the section under the bound story's
  heading (its acceptance scenarios) and the spec's exclusions, and to raise nothing about another story.
- **FR-010**: The assessor brief MUST carry `user_story` beside `spec_folder`.
- **FR-011**: These surfaces MUST change: `plugins/alq-review/scripts/{specbinding,gate,github,briefs,policy}.py`,
  `plugins/alq-review/agents/assessor.md`, `plugins/alq-review/workflows/review-round.js` (`whenToUse`) and
  `plugins/alq-review/README.md`.
- **FR-012**: Tests MUST be written first and seen to fail for the reason expected, in
  `dev/alq-review/tests/test_specbinding.py`, `test_gate.py`, `test_policy.py` and `test_agents.py`, covering the
  scenarios and edge cases above.

### Key Entities

- **Story value**: folder and story number, parsed by one function from the bounded value of each input: the whole
  of `args.spec`, the Implements line's value (Terms), the whole stored binding.
- **Binding**: the PR's ledger fields `spec` (the whole value, or `null`) and `spec_blob`, as today, read only
  through the function that parses `args.spec`, which gives its folder and story. No reader uses the raw string as
  a folder.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every scenario and edge case above has a test in `dev/alq-review/tests` that failed before the code
  and passes after.
- **SC-002**: A story PR's reviewers are named one story, never the whole spec: the injected prompt names `### User
  Story <N>` and no other story.
- **SC-003**: CI is green.

## Assumptions

- The caller is the source of the value; review reads neither the branch name nor the PR body for it, only checks
  the body against it (#80).
- Out of scope: rounds before a PR exists (#70); the branch-name convention; `alq-build:issue-tackle` and the
  engineering repo's `pr-review-loop.md`, the callers that adapt (#82 and the engineering repo).
- Precondition of shipping: no open PR's ledger row is bound to a bare spec folder, as rows bound before this
  change are. The gate reads only story values and `null`; it does not handle older bindings (constitution III).
  On 2026-10-12 the only such rows are #77, #78 and #83, all merged.
- Unchanged: a story PR that edits `spec.md` is held until the user unlocks it (ADR-0016 decision 6, ADR-0018).

## Why this is worth doing

### harm
Answer: A story PR is graded against every story of its spec, so other stories' requirements come back as findings the PR cannot and must not meet.
Source: code: plugins/alq-review/scripts/briefs.py, `_graded_against`

### reachable
Answer: predicted. Every review round launched under one PR per user story with a spec folder.
Source: code: plugins/alq-review/scripts/briefs.py; analitiq-ai/engineering docs/engineering/git-workflow.md

### change-alters
Answer: Yes. The reviewers are named one story, and the gate refuses a story that is missing or disagrees with the PR's Implements line.
Source: user: issue #81, "Wanted"

### owner
Answer: No. Nothing in review knows which story a PR delivers.
Source: code: plugins/alq-review/scripts/specbinding.py

### inherited
Answer: Yes. ADR-0016 decision 2 takes a folder path or null, and ADR-0017 decision 2 names no spec headings in the reviewer prompt. ADR-0019 supersedes both.
Source: code: dev/alq-review/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md, dev/alq-review/docs/adr/0017-leave-the-spec-folder-s-contents-to-planning-review-reads-only-spec-md.md

### needs-spec
Answer: It changes the launch contract that alq-build and the engineering rules call, and supersedes two ADR decisions.
Source: user: issue #80, "Decided"

## Root cause

Not a defect report.
