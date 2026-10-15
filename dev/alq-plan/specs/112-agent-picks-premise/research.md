# Research: The agent picks the premise outcome

Paths are relative to the repo root.

## R1: The agent's pick reaches the workflow through `premise_verdict`

- **Decision**: The skill resumes with `premise_verdict=<the agent's pick>`, exactly as it resumes with the user's
  pick today. `workflow.yml` is not changed: the `premise` gate, its options, `verdict_input` and the
  `premise-report` step that runs `premise_report.py check <report> <choice>` all stay. The check keeps refusing a
  report whose `Pick:` differs from the gate's choice; only its message is reworded (R3), since the agent now writes
  both.
- **Rationale**: FR-004 asks for one path. The gate already takes its verdict as an input on resume
  (`workflow.yml`, `premise` gate; `drive_workflow.py resume`), so the pause is the skill's rule, not the engine's.
  Keeping the equality check means a run cannot act on an outcome its report does not state: the comment that closes
  an issue is read from the report that names the same pick.
- **Existing tools**: `workflow.yml` `premise` gate with `verdict_input: premise_verdict` fits as it is.
  `drive_workflow.py resume <run_id> <input>=<value>` fits as it is. A new workflow input (e.g. `agent_pick`) was
  rejected: a second path for the same outcome (FR-004).

## R2: `Recommendation:` is dropped; `Pick:` alone carries the outcome

- **Decision**: `premise_report.form()` no longer prints `Recommendation:` or names it in its comment block.
  `problems()` reads the outcome from `Pick:` only; a `Recommendation:` line is no longer read.
- **Rationale**: With the agent picking, recommendation and pick are always the same text; two fields for one fact
  is where they diverge (FR-005, Clarifications). Reports are per-run and git-ignored, and the driver refuses runs
  started before #117, so no old-form report reaches the check; refusing one would guard nothing.
- **Existing tools**: The existing `for field, value in ((RECOMMENDATION, …), (PICK, …))`
  outcome loop shrinks to `Pick:` alone.

## R3: Text that presumes a user pick is reworded

- **Decision**: Reword, so each is true when the agent picks: the `premise_report.py` module docstring ("what the
  user picked there", "the user's pick is the judgement"), the `problems()` docstring ("whose user picked"), and the
  `Pick:` mismatch message, which becomes: `` `Pick:` is `<written>` and the run was resumed with `<pick>`. Next
  step: make the report's `Pick:` and the resumed pick the same outcome. ``; in `issue-spec/SKILL.md` the
  description ("the workflow first asks whether it is worth a spec"), the opening paragraph ("runs the three
  interactive steps in this session, and passes the user's verdicts on resume", which becomes: passes the agent's
  premise pick and the user's grill and critique verdicts on resume) and steps 2–3; in `workflow.yml` the comment
  above `premise-report`, "never the text the user typed", and the comment above `check-folder`, "never text the
  user typed", each reworded comment-only to "never free text"; in the tests, the `Premise`
  class docstring of `test_drive_workflow.py` and the test name `test_the_pick_is_the_one_the_user_gave_the_workflow`
  of `test_premise_report.py`. In `test_premise_report.py`, the `report()` helper loses its `recommendation`
  parameter and stops filling `Recommendation:`; its other callers (`test_no_spec.py`, `test_spec_folder.py`,
  `test_rootcause.py`, `test_drive_workflow.py` as `premise_report_text`) pass no `recommendation`, so they are not
  edited and must still pass.
- **Rationale**: FR-011, and the class-of-defect rule (constitution V): every instance in the files touched goes.
  The workflow's gate message ("answer the premise questions for this issue, then pick the outcome") and its
  `premise_verdict` comment ("the skill passes them on resume") are already true when the agent picks; its
  `premise-report` and kind-check comments are not, so they get comment-only edits.
- **Existing tools**: Found by grepping `plugins/alq-plan/`, `dev/alq-plan/tests/` and `dev/alq-plan/docs/` for
  `user pick`, `user's pick`, `user picked`, `the user picks`, `Recommendation`. ADR-0002's "a premise pick … is an
  answer" names no picker and stays.

## R4: A reported defect may be `no spec needed` only when it is located

- **Decision**: In `problems()`, when `Reports wrong behaviour: yes` and `Pick: no spec needed`, each of the `harm`
  and `change-alters` answers must contain a `<path>:<line>` citation and its source must start with `code:` or
  `reproduction:`. Each failing answer is one problem naming the question, what it lacks, and the Next step
  (cite the file and line at fault with a `code:` or `reproduction:` source, or pick `write the spec`). Both answers
  are read whatever `Rests on:` names: the rule is about the defect, not about how far a stop pick is graded. `form()`'s comment block states the rule, naming the `Answer:` lines as where the citation goes. The
  citation is one module-level pattern in `premise_report.py`, `(?<![\w/.:-])[\w./-]+:\d+\b`. Whether the cited file
  and line exist is not checked.
- **Rationale**: FR-006 and Clarifications: the old refusal held because a defect's fix size is unknown until
  traced; a located fault is traced, so the refusal narrows to the untraced case instead of going. A `user:` source
  is refused because the trace must come from the code or a run, not from the person reporting. The check grades
  form, not correctness (spec Assumptions), so no file is opened.
- **Existing tools**: `plugins/alq-review/scripts/claimcheck.py` `_CITATION` is the same shape and was the model,
  but alq-plan requires no other plugin (`plugins/alq-plan/.claude-plugin/plugin.json` has no `dependencies`;
  constitution, Platform Constraints), so it cannot import it; the pattern is restated, without its named groups,
  which nothing here reads. `rootcause.py` has no location pattern (it grades only an `Observed:` opening).
  `_answer_problems()` is the per-answer grader and fits for the source-kind test; the location test sits beside it
  in `problems()`, since it applies only to this pick on a defect.

## R5: The pick rule and the session line live in the skill's step 2

- **Decision**: `issue-spec/SKILL.md` step 2 states the pick rule in FR-002's order (`not worth doing` when the
  issue is obsolete or does not apply to the current codebase; `no spec needed` for a minor mechanical bug fix of
  limited impact or a no-brainer code or prose change, and for a reported defect only when located as R4 says;
  `write the spec` otherwise, and whenever in doubt). The agent still asks the user only what the issue and the
  code cannot answer, records it with a `user:` source, and never asks the user to pick, confirm, approve or reject
  the outcome (FR-007). It writes `Pick:` and, for a stop pick, `Rests on:` and `Reason:`, then tells the user the
  pick, the question it rests on and the reason (FR-008), and resumes. Step 3 keeps what each pick leads to; after
  `not worth doing` it says the issue was closed and why. The closing rule becomes: a grill or critique verdict is
  the user's decision; never pass `approve` without the user saying so in this session (FR-009).
- **Rationale**: Which rule an issue falls under is a judgement over the issue text and the code; no script can
  make it, which is why the user made it until now. What is mechanical is checked by script: `Pick:` is an outcome
  and equals the resumed pick (R1), a stop pick names its question and reason, a defect's `no spec needed` is
  located (R4). Defaulting to `write the spec` keeps every doubtful issue in front of the user at grill.
- **Existing tools**: `dev/alq-plan/tests/test_spec_source.py` `IssueSpecSkill` pins the skill's phrases and their
  order; it fits for pinning the new step 2 (the pick rule's three outcomes in order, "never asks the user to pick",
  the session line before the resume) and the narrowed closing rule, in place of the `Recommendation:` position it
  pins today.

## R6: ADR-0006 and ADR-0008 are amended in place, in their own PR first

- **Decision**: One PR, changing only `dev/alq-plan/docs/adr/0006-*.md` and `0008-*.md`, merged by the user before
  the code PR opens. ADR-0006: Context says the agent picks; decisions 1 and 2 say "an issue picked as …"; a new
  decision 4 records that the agent picks by the rule of FR-002 with `write the spec` as the default, that a premise
  question only the user can answer stays the user's, and that a `not worth doing` pick closes the issue with no
  human in the loop; Trade-offs gain the risk of a wrong agent close (reversed by reopening) and of a wrongly
  skipped spec; "Revisit if" stops naming the user as the only one who knows. `relatesTo`/`externalRefs` gain issue
  #112. ADR-0006 Trade-offs' "Whoever builds learns it from the user" and Consequences' "a `no spec needed` outcome lives
  only in the session that picked it" are reworded so neither names the user as the one who picked or knows.
  ADR-0008: Context's "lives only in the session that picked it" and its quote of ADR-0006's revisit line are
  reworded to match. Both stay `status: draft`.
- **Rationale**: FR-010 and Clarifications; constitution VI (the governing record lands apart from the code it
  governs). Both ADRs are unratified drafts, so amending is cheaper and truer than a superseding record.
- **Existing tools**: The adrkit corpus in `dev/alq-plan/docs/adr/` and its front matter fit as they are; the
  optional `speckit.adrkit.check` hook checks this plan against them. A new ADR was rejected by the user
  (Clarifications).

## R7: The no-spec path from #79 is used as it is on main

- **Decision**: No change to `no_spec.py`, `spec_folder.py`, `drive_workflow.py` or the `check-folder`,
  `no-spec-needed`/`write-no-spec` steps. An agent's `no spec needed` pick goes the way a user's does on main:
  `premise-report` checks the report, then `no_spec.py write "$SPECIFY_FEATURE_DIRECTORY" <report>` writes the
  folder's no-spec spec.md with `Rests on:` and `Reason:`, and nothing is posted. A located defect ruled
  `no spec needed` (R4) takes the same path. A rescope of a no-spec folder pauses at `premise`
  (`spec_folder.starts_at`), so the skill's step 2 runs there unchanged: the agent picks, reading the appended
  `Open decision:` with the issue. Skill step 3's sentence for `no spec needed` ("the workflow has written
  `SPEC_DIR` with a spec.md that says no spec is needed, and nothing was posted") stays, and stays pinned.
- **Rationale**: The issue's input says the plan must match the code on main. The writer reads the report through
  `premise_report.rested_on()` and `reason()`, neither of which reads `Recommendation:` or names a picker, so R2 and
  R3 do not reach it. A wrong agent `no spec needed` cannot be undone by a second `start` (refused at
  `check-folder`, `test_an_issue_judged_to_need_no_spec_is_not_scoped_again`); the rescope is the reversal, and
  its premise is the same agent pick, so no new path is needed.
- **Existing tools**: `plugins/alq-plan/scripts/no_spec.py` `text()`/`write`, `spec_folder.py` `starts_at`, the
  `write-no-spec` step and its Stops entry in the skill fit as they are. `test_drive_workflow.py` `Premise` and
  `NoSpecRescope`, `test_no_spec.py` and `test_spec_folder.py` already cover the path and are reused; the one new
  end-to-end case (a located defect, `no spec needed`) asserts the no-spec spec.md the same way
  `test_no_spec_needed_writes_the_folder_with_only_a_no_spec_spec_md_and_calls_github_for_nothing` does.
