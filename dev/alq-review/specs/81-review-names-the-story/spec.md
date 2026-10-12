# Feature Specification: The review launch names the user story

**Feature Branch**: `81-spec` (#81, part of #80)

**Created**: 2026-10-12

**Status**: Draft

**Input**: Issue #81, "alq-review: the launch names the user story, spec: '<folder>/spec.md § User Story <N>', and
the gate checks it against the PR header"

**Settled with the user (2026-10-12)**: in issue #81, "Wanted", "Not in scope" and "Unchanged". Decision record:
ADR-0019.

## Terms

- **Story value**: a string both stages of Table A accept. Two story values name the same folder and story
  exactly when they are the same string. `args.spec`, the Implements line's value and the binding are each one
  whole string, nothing stripped, checked by the same function.
- **Story heading**: a line of `spec.md` that starts `### User Story <N>`, the number followed by a word
  boundary. Spec Kit writes `### User Story <N> - <title> (Priority: P<n>)`; older specs use `: ` for ` - `.
- **PR body**: the PR's `body` field as GitHub holds it, read as JSON, nothing stripped. An empty body has been
  read and has no Implements line. A body `gh` does not return is a check that could not run (FR-006).
- **Line**: the body is cut into lines at `\n` and at `\r\n` only, neither part of a line; the last line ends at
  the end of the body. A bare `\r` is a character inside a line.
- **Implements line**: the body's first line that starts `Implements:`. The rest of the line MUST be one U+0020
  followed by a story value, nothing else; that story value is the line's value (Table B).

## The story value and the refusals

These tables are the rules. Scenarios 2, 3 and 6 to 8, the Implements-line edge case and FR-001, FR-002 and FR-005
point at them. A clause added to one of them later adds its row in the same edit.

**Table A — the story value.** Stage 1, the form: the whole string MUST match `<folder>/spec.md § User Story <N>`
exactly, where `<folder>` is one or more characters of any kind and `<N>` is `[1-9][0-9]*` in ASCII digits. Every
other character is the literal shown: each space is one U+0020 and `§` is U+00A7. The end of the string is its
end, so a trailing `\n` is a character. A stage-1 failure is refused naming the form. Stage 2, the shape: today's
shape checks run unchanged on the folder stage 1 took out; a failure gets today's shape message. One row per
element, each refused unless marked:

| Value (`F` is `dev/x/specs/7-demo`) | Stage | Outcome |
|---|---|---|
| `F/spec.md § User Story 2` | — | accepted |
| `F` (a bare folder) | 1 | form |
| `F/plan.md § User Story 2` | 1 | form |
| `F/spec.md § US2` | 1 | form |
| `F/spec.md $ User Story 2` (`§` replaced) | 1 | form |
| `F/spec.md  § User Story 2` (space doubled) | 1 | form |
| `F/spec.md §User Story 2` (space missing) | 1 | form |
| `F/spec.md § User<tab>Story 2` (a tab for a space) | 1 | form |
| `F/spec.md § User Story<U+00A0>2` (an NBSP for a space) | 1 | form |
| `F/spec.md § user story 2` | 1 | form |
| `F/spec.md § User Story 0`, `… 02`, `… ٢`, `… 2a` | 1 | form |
| a space before the value; a space after it; a `\n` after it | 1 | form |
| `/abs/specs/7/spec.md § User Story 2` (absolute) | 2 | shape |
| `dev/x/specs/../specs/7/spec.md § User Story 2` (a `..` segment) | 2 | shape |
| `dev/x/7-demo/spec.md § User Story 2` (not in `specs`) | 2 | shape |
| `dev/x//specs/7-demo/spec.md § User Story 2` (not the one spelling) | 2 | shape |

**Table B — the Implements line.** Each value row of Table A, written after `Implements: `, gives that row's
outcome through the same function. Each refused row below quotes the line and names the form.

| Body | Outcome |
|---|---|
| the line ends `\n` | counts |
| the line ends `\r\n` | counts |
| the line is the body's last, with no line end after it | counts |
| the line is the body's first | counts |
| two lines start `Implements:`: the first counts, the second, further down, does not | first counts |
| the only line that starts `Implements:` is further down in the body | counts |
| ` Implements: <value>` or `See Implements: <value>` (text before it) | not an Implements line |
| an empty body | no Implements line |
| `Implements:<value>` (no space), `Implements:  <value>` (two), a tab, an NBSP | refused |
| `Implements: <value> ` or a tab after the value, as the body's last line too | refused |
| a bare `\r` inside the line | refused |

**Table C — the refusals.** The binding is checked first (scenario 5). Each way out is a step the next launch
accepts under that binding. Under `spec: null` the form of an Implements line is never checked: any line that
starts `Implements:` is refused as present.

| Launch | Binding | Body | Outcome | Ways out |
|---|---|---|---|---|
| a value | bound to another value | any | refused, naming the bound value | launch with the bound value |
| story `S` | none, or `S` | no Implements line, empty body included | refused | add `Implements: S` |
| story `S` | none, or `S` | a line that breaks Table B | refused, quoting it | make the line `Implements: S` |
| story `S` | none | a line naming story `T` | refused, quoting both | launch with `T`, or make the line `Implements: S` |
| story `S` | `S` | a line naming story `T` | refused, quoting both | make the line `Implements: S` |
| story `S` | none, or `S` | `Implements: S` | opens; binds `S` when unbound | — |
| `null` | none, or `null` | no Implements line | opens; binds `null` when unbound | — |
| `null` | none | a line naming story `T` | refused, quoting it | launch with `T`, or remove the line |
| `null` | none | a line that breaks Table B | refused, quoting it | remove the line |
| `null` | `null` | any line that starts `Implements:` | refused, quoting it | remove the line |
| any | any | `gh` does not return the body | could not run (FR-006) | as scenario 12 |

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
  Every `gh` answer there passes through `_answer`, which strips its output (read).
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
2. **Given** each stage-1 row of Table A, **When** the round launches with it, **Then** it is refused, and the
   message names the form.
3. **Given** each stage-2 row of Table A, **When** the round launches with it, **Then** it is refused with today's
   shape message (`shape`).
4. **Given** a `spec.md` with no story heading for `<N>` at the reviewed commit, **When** the round launches,
   **Then** it is refused, and the message names the heading it looked for. `### User Story 12` is no heading for
   `1`. `### User Story 1: Sign in` is one for `1`.
5. **Given** a PR bound to one value, **When** a later launch gives another (another story of the same spec, or
   `null`), **Then** it is refused as today, naming the bound value.
6. **Given** each row of Table C whose launch is a story, **When** the round launches, **Then** the outcome and
   the ways out are the row's.
7. **Given** a non-null value and a PR body with no Implements line, the empty body included, **When** the round
   launches, **Then** it is refused, and the message names the line to add (Table C).
8. **Given** each row of Table C whose launch is `null`, **When** the round launches, **Then** the outcome and the
   ways out are the row's.
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

- The PR body and the Implements line: one case per row of Table B, for a story launch and, where the row is
  a line, for a `null` launch (Table C).
- A story heading inside a fenced code block of `spec.md`: counted. The gate does not parse Markdown.
- `spec.md` changes after binding and the user unlocks it: the next launch binds the new blob, and the story
  heading is checked again in it. A heading the change removed refuses the launch.
- An assess-round launch: it checks `<folder>/spec.md` of the parsed binding at its commit, as today, and the
  story heading in it. It does not read the PR body.
- An audit launch: names `spec` and is checked as above. Audit reviewers still get no spec.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `args.spec` MUST be `null` or a string both stages of Table A accept. A stage-1 failure MUST be
  refused naming the form.
- **FR-002**: Stage 2 MUST be today's shape checks, unchanged, run on the folder stage 1 took out, for every input:
  `args.spec`, the Implements line's value and the binding. A failure gets today's shape message.
- **FR-003**: `<folder>/spec.md` at the commit a launch checks MUST hold the story heading for `<N>`, matched at a
  word boundary after the number. One pure function decides it, for review-round and assess-round launches alike.
- **FR-004**: The PR MUST be bound at its first round to the whole value and the `spec.md` blob id. A later launch
  with another value MUST be refused.
- **FR-005**: At every review-round launch the gate MUST read the PR body and decide by Table C, after the binding
  check. The line's value MUST be parsed by the same function as `args.spec` (Table B). One pure function decides
  the comparison and the ways out, given the launch value, the binding and the body.
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
