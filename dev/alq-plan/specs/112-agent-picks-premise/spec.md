# Feature Specification: The agent picks the premise outcome

**Feature Branch**: `112-spec`

**Created**: 2026-10-14

**Status**: Draft

**Input**: Issue #112, "alq-plan: the agent picks the premise outcome from its research, without asking the user"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A planning run goes past premise without the user (Priority: P1)

The user starts a planning run on an issue. The agent answers the premise questions from the issue and the code,
picks the outcome itself by the pick rule, and the run goes on: to the spec and then grill on `write the spec`, to
the no-spec spec.md on `no spec needed`, to closing the issue on `not worth doing`. The user is not asked to pick.

**Why this priority**: It is the issue: every run stops at premise today, and an unattended run never gets past it.

**Independent Test**: Start a run on an issue the issue text and the code fully answer; it reaches the grill pause
with no input from the user between start and grill, and its premise report carries the agent's pick.

**Acceptance Scenarios**:

1. **Given** an issue with decisions in it, **When** the run reaches premise, **Then** the agent writes
   `Pick: write the spec`, resumes, and the run pauses next at grill.
2. **Given** an issue that only fixes a typo in prose, **When** the run reaches premise, **Then** the agent picks
   `no spec needed`, with `Rests on:` and `Reason:`, and the run completes with the issue's spec folder holding a
   spec.md that says no spec is needed (ADR-0008); nothing is posted on the issue.
3. **Given** an issue about code that no longer exists, **When** the run reaches premise, **Then** the agent picks
   `not worth doing`, and the run closes the issue as not planned with the reason as the comment.

---

### User Story 2 - The user reads what the agent picked, and why (Priority: P2)

After the run, the user can see which outcome the agent picked, the question it rests on and the reason, both in
the session and in the premise report.

**Why this priority**: The pick is no longer confirmed, so a wrong one is caught only after the fact.

**Independent Test**: For each of the three picks, the session names the pick, the question it rests on and the
reason; the premise report names the pick, and for a stop pick also `Rests on:` and `Reason:`.

**Acceptance Scenarios**:

1. **Given** the agent picked `not worth doing`, **When** the run completes, **Then** the session tells the user
   that the issue was closed, the question the pick rests on, and the reason.
2. **Given** the agent picked `no spec needed`, **When** the run completes, **Then** the session tells the user the
   pick, the question it rests on, the reason, and to pass `spec: null` when the work is reviewed.
3. **Given** the agent picked `write the spec`, **When** grill is about to start, **Then** the session shows one line
   with the pick, the question it rests on and the reason.

---

### User Story 3 - The decision is recorded before the code changes (Priority: P3)

Letting the agent pick, and close issues on its own, is recorded in the governing ADRs before the code changes:
ADR-0006 and ADR-0008, both still drafts, are amended in place in their own PR, which the user reviews and merges
before any code PR of this spec.

**Why this priority**: ADR-0006 and ADR-0008 state that the user picks; the code would otherwise contradict its
governing records.

**Independent Test**: The amended ADR-0006 and ADR-0008 are on main, merged in a PR that changes no code, before
the first code PR of this spec opens.

**Acceptance Scenarios**:

1. **Given** the amended ADR-0006, **When** it is read, **Then** it states the pick rule, that the agent records the
   pick, what stays the user's, and the risk of an agent-closed issue.
2. **Given** the amended ADR-0008, **When** it is read, **Then** no sentence presumes that the user picks.

### Edge Cases

- A premise question the issue and the code cannot answer: the agent asks the user that question, records the
  answer with a `user:` source, then picks on its own. It never asks the user for the pick.
- The agent cannot place the issue clearly in rule 1 or rule 2: the pick is `write the spec` (rule 3 is the default).
- The issue reports wrong behaviour (`Reports wrong behaviour: yes`) and looks minor: `no spec needed` only if the
  fault is located as FR-006 says; otherwise `write the spec`.
- The issue is already closed when the run tries to close it: the run fails as it does today (ADR-0006, R5).
- A rescope of a no-spec folder pauses at premise again (ADR-0008): the agent picks there too, by the same rule,
  reading the rescope's `Open decision:` as part of the issue. It never asks the user to pick there either.
- A second `start` on an issue that already has a no-spec folder is refused at `check-folder`, as on main; the
  agent's pick does not change that.
- Grill and critique gates: unchanged; they still wait for the user.

## Clarifications

### Session 2026-10-14

- Q: Can a reported defect be ruled `no spec needed`? → A: Only when the `harm` and `change-alters` answers name the file and line at fault, with a `code:` or `reproduction:` source.
- Q: Keep both `Recommendation:` and `Pick:`? → A: Drop `Recommendation:`; `Pick:` alone carries the outcome.
- Q: What happens with a premise question the issue and the code cannot answer? → A: The agent asks the user that question, as today; only the pick moves to the agent, which decides whether to scope the issue.
- Q: How is the decision recorded? → A: Amend the draft ADR-0006 and ADR-0008 in place, in their own PR, which the user reviews and merges before the code.
- Q: What does the session show after a `write the spec` pick? → A: One line before grill: the pick, the question it rests on and the reason.
- Q: Does `not worth doing` need code evidence beyond the rule? → A: No; rule 1 as the issue states it: obsolete or not applicable is closed with the rationale as the comment.


## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: At the premise step, the agent MUST pick one of `write the spec`, `no spec needed`, `not worth doing`
  itself and resume the run, without asking the user to pick or confirm.
- **FR-002**: The agent MUST pick by this rule, in order: `not worth doing` when the issue is obsolete or does not
  apply to the current codebase; `no spec needed` when the change is a minor mechanical bug fix with limited impact,
  or a no-brainer change of code or prose (typos, grammar, restatements, shortening text while keeping its meaning);
  `write the spec` for every other issue.
- **FR-003**: The agent MUST still answer every premise question it grades with a source, and write
  `Pick:`, and, for a stop pick, `Rests on:` and `Reason:`, on the report form.
- **FR-004**: The agent's pick MUST reach the workflow through the same premise verdict input that a user's pick
  uses today; there is no second path for an agent pick.
- **FR-005**: The report form MUST drop `Recommendation:`; `Pick:` is the one field that carries the outcome. The
  premise check MUST read the outcome from `Pick:`, including for the defect rule of FR-006.
- **FR-006**: A report with `Reports wrong behaviour: yes` MAY carry `no spec needed` only when its `harm` and
  `change-alters` answers each name the file and line at fault (`<path>:<line>`) and each has a `code:` or
  `reproduction:` source, not `user:`. The premise check MUST refuse any other defect report that carries
  `no spec needed`.
- **FR-007**: When a premise question cannot be answered from the issue or the code, the agent MUST ask the user
  that question and record the answer with a `user:` source. It MUST NOT ask the user to pick, confirm, approve or
  reject the outcome.
- **FR-008**: After every pick the agent MUST tell the user, in the session, the pick, the question it rests on and
  the reason: on `write the spec` in one line before grill starts; after `not worth doing` it MUST also say the
  issue was closed.
- **FR-009**: The skill's rule that a premise pick is the user's decision MUST be removed for premise only; the
  rule MUST still hold for the grill and critique verdicts.
- **FR-010**: ADR-0006 MUST be amended in place to record that the agent picks the premise outcome by the rule of
  FR-002 and may close an issue without a human; ADR-0008 MUST be amended so no sentence presumes a user pick. Both
  amendments MUST land in one PR that changes no code, reviewed and merged by the user before any code PR of this
  spec. No new ADR is written.
- **FR-011**: Every text that presumes a user pick MUST be reworded so it is true when the agent picks: the
  `premise_report.py` docstring, `problems()` docstring and its `Pick:` mismatch message; the `issue-spec` skill's
  description ("the workflow first asks whether it is worth a spec"), its opening paragraph ("runs the three
  interactive steps in this session, and passes the user's verdicts on resume") and steps 2–3; the two
  `workflow.yml` comments "never text the user typed" and "never the text the user typed" (comment-only edits).

### Key Entities

- **Premise report**: the run's answers to the premise questions, with `Reports wrong behaviour`, the six answers
  and sources, `Pick`, `Rests on`, `Reason`. It now records the agent's pick.
- **Premise verdict**: the workflow input that carries the pick on resume; one of the three outcomes.
- **Pick rule**: the three-way rule of FR-002, applied by the agent.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: No planning run asks the user to pick or confirm the premise outcome; between start and the grill
  pause (or completion, for a stop pick) the user is asked only premise questions the issue and the code cannot
  answer.
- **SC-002**: 100% of premise reports from agent-picked runs pass the premise check.
- **SC-003**: Every agent-closed issue carries a closing comment with the reason, and the session names the closure.
- **SC-004**: The grill and critique gates still wait for the user in 100% of runs.

## Assumptions

- Rule 3 is the default: any doubt between outcomes resolves to `write the spec`, the reversible and safe pick,
  since grill still puts every decision to the user.
- The premise check keeps grading form, not correctness: no script judges whether the agent's pick is right.
- #79 is on main (PRs #117, #120): every run is given its spec folder and kind, and a `no spec needed` pick has
  `no_spec.py write` write the folder's no-spec spec.md from the report's `Rests on:` and `Reason:`. That writer
  reads neither `Recommendation:` nor who picked, so it is not changed.
- The workflow already takes the pick as an input on resume, so the change is to the skill, the report check and
  the governing records, not to the workflow engine.
- The ADR amendments land first, in their own PR (constitution Principle VI).

## Why this is worth doing

### harm
Answer: Every new-spec planning run stops at the premise pause and waits for the user to type one of three picks, even when the agent's research already settles the outcome; the user is a manual step in every run, and a run left unattended never gets past premise.
Source: code: plugins/alq-plan/skills/issue-spec/SKILL.md step 2 ("Ask the user to pick one of the three by name") and its closing rule ("Never pass ... a premise pick without the user saying so")

### reachable
Answer: observed: the #111 run stopped at premise with a recommendation and waited for the user's pick, as quoted in issue #112.
Source: user: issue #112, the quoted agent response

### change-alters
Answer: Yes. With the change the agent applies the three-way rule (obsolete -> not worth doing; minor mechanical code or prose change -> no spec needed; else write the spec), writes its own Pick, and resumes with premise_verdict=<pick>; the run goes on to close the issue, record no spec, or reach grill, with no pause for the user. The workflow already takes the pick as an input on resume, so the pause is the skill's rule, not the engine's.
Source: code: plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml, premise gate with verdict_input: premise_verdict

### owner
Answer: No. Nothing guards the wait; the rules that exist enforce it: SKILL.md forbids a pick the user did not give, and premise_report.py check only grades the report's form and that Pick equals the pick passed. It refuses Reports wrong behaviour: yes with Recommendation: no spec needed, which conflicts with the issue's rule 2 for minor mechanical bugs.
Source: code: plugins/alq-plan/scripts/premise_report.py problems(); SKILL.md step 2

### inherited
Answer: Yes, partly. ADR-0006 and ADR-0008 both open with "the user picks one of three outcomes"; neither weighs who picks, they decide what each outcome does. Put to them: no harm is named that a human pick prevents; the risk the change brings is a wrong agent close or a wrongly skipped spec, which these ADRs did not consider because a human picked.
Source: code: dev/alq-plan/docs/adr/0006-close-an-issue-not-worth-doing-and-post-nothing-for-one-that-needs-no-spec.md and 0008-give-an-issue-that-needs-no-spec-a-spec-folder-that-says-so.md, Context

### needs-spec
Answer: It has decisions: whether a reported defect may be no spec needed (premise_report.py refuses it today), whether a run may still stop on a question only the user can answer, what Pick means when no user picks, and a new ADR superseding the user-picks premise of ADR-0006/0008.
Source: user: issue #112, Open decisions

## Root cause

Not a defect report.
