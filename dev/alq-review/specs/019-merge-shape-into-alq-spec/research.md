# Research: One planning skill, `alq-spec`

Every unknown the plan had is settled below. Paths are from the repo root. Nothing here was run against a live
Spec Kit workflow yet; where a decision rests on how Spec Kit 1.0.7 behaves and that was only read, the decision
says so and the first task proves it with a failing test (R10).

## R1: The workflow gains a `premise` gate, a report check and a record step, and no later step runs on a stop pick

- **Decision**: `workflow.yml` starts with an `if` step that runs only for a new spec (`inputs.spec_dir` empty). Its
  `then` holds `premise` (a `gate`, `options: [write the spec, no spec needed, not worth doing]`, `on_reject: skip`,
  `verdict_input: premise_verdict`), then `premise-report` (a shell step that runs `premise_report.py check`), then
  `record-outcome` (a shell step that runs `premise_report.py record`, doing nothing for "write the spec"). Every later step stays
  top-level, inside an `if` of its own. From `grill` on, and for `scope`, that `if` runs when `inputs.spec_dir` is set or
  the choice is "write the spec", one condition shared through a YAML anchor; `scope` then runs `select-spec` on a
  re-scope and `specify` otherwise, and `root-cause` runs only when the choice is "write the spec". The two other picks therefore end the run `completed` with no spec
  folder, after the location comment is posted. One `if` holding all of today's steps does not fit: a resume re-runs
  the top-level step the run stopped in with everything nested in it, so resuming past grill would run `specify`
  again and overwrite the spec. `test_drive_workflow.py` pins this (the spec edited after grill is the one graded).
- **Rationale**: FR-001 and FR-003 want a pause before `specify` with three named outcomes, and FR-011 wants the checks to be
  steps. `on_reject: skip` is the only setting that lets a gate with three non-reject options finish, because `abort` and
  `retry` need a `reject` option. A re-scope must skip the step (spec edge case), and the `if` on `spec_dir` is the way
  the workflow already tells the two entries apart.
- **Existing tools**: the Spec Kit `gate` step (read in `specify_cli/workflows/steps/gate`) takes any list of option names,
  matches a resumed verdict to them case-insensitively, and stores the pick in `output.choice`; the `grill` and
  `review-critique` gates are the precedent for pausing with a headless `verdict_input`. The `if` step takes a
  `{{ }}` condition with `==`, `or` and `not`, and runs `then` or `else`; `scope` is the precedent. A `switch` step was
  looked at and does not fit: it picks a branch from one value, but the re-scope test and the pick are two values.
  Nothing in Spec Kit stops a run without failing it, so ending by running no further step is the only clean stop.

## R2: One module, `premise_report.py`, owns the premise report's form, its check, and the stop outcomes

- **Decision**: A new `plugins/alq-review/scripts/premise_report.py` holds the report's form once: the six questions
  (harm if never done, can it happen on the default branch, does the change alter it, does something own the risk, is the
  premise inherited, does it need a spec), each with an `Answer:` and a `Source:` line, plus `Reports wrong behaviour:`,
  `Recommendation:`, `Pick:`, `Rests on:` and `Reason:`. It has three commands. `form` prints the empty report, so the questions are
  worded here and nowhere else. `check <report> <pick>` exits 1, one problem per line with its next step, when a question is
  unanswered, an answer has no source of the form `code: …`, `reproduction: …` or `user: …`, the reachability answer
  does not start `observed` or `predicted` (each of these on all six questions for "write the spec"; for a stop pick only
  on the questions up to and including the one `Rests on:` names, since the outcome makes the later ones moot), a stop pick
  has no `Rests on:` naming a question, a recommendation or pick is not one of the three outcomes, `Pick:` differs
  from the gate's choice, a stop outcome has no `Reason:`, or the recommendation is "no spec needed" for a report that
  says wrong behaviour. `record <report> <pick>` posts the location comment for "no spec needed" (through
  `speclocation`, R6) or "not worth doing", with the report's `Reason:`.
- **Rationale**: FR-002, FR-004, FR-005, FR-011 and FR-018 make the questions and the checks binding on a skill, a script
  step and a comment writer. Defined once, the skill's prose cannot drift from the check: the skill runs `form` instead of
  carrying its own copy of the questions (contract-shaped prose is a copy). The `Pick:` cross-check keeps the user's pick
  single-sourced: the gate's verdict decides, and the report is a copy that is refused when it disagrees.
- **Existing tools**: `settled_design.py` is the precedent for a plugin script a workflow shell step runs
  (`python3 "$ALQ_REVIEW_ROOT/scripts/…" "$dir"`, one problem per line, exit 1 for problems, 2 for cannot run); its section
  and field parsing is for `## R<n>:` research decisions, a different shape, so it does not fit and only its CLI
  conventions are reused. `claimcheck.validate_verdict` checks a model's JSON verdict against a schema; the report is
  prose a person edits in the session, so a JSON schema does not fit. `speclocation.py` writes the location comment, so
  `record` calls it rather than posting itself.

## R3: The report lives in the run's own folder and reaches `specify` as a path in its arguments

- **Decision**: The skill writes the report to `.specify/workflows/runs/<run_id>/premise-report.md` in the project, once the
  run has paused at `premise` and told it the run id. The `premise-report` and `record-outcome` steps read
  `.specify/workflows/runs/{{ context.run_id }}/premise-report.md`. `specify` gets
  `{{ inputs.spec }}` plus a closing line naming that path; the settled-design preset's `speckit.specify` text (R4) tells it to copy
  the answers from there.
- **Rationale**: FR-010 needs the premise answers in `spec.md`, and `specify` is the step that writes it. A path keyed by
  run id cannot be satisfied by an earlier run's report: with a fixed path, a skipped write would pass the check on a stale
  file (fail loud, no silent pass). `context.run_id` is in the expression namespace
  (`expressions._build_namespace`).
- **Existing tools**: `drive_workflow.py` already reads `.specify/workflows/runs/<run_id>/state.json`, so the folder is the
  run's own and exists from the first step. `.specify/feature.json` is written by `specify` itself and does not exist before
  it. `SPEC_FILE` carries the issue text only and is written before the run starts, so it cannot hold an answer given
  after the pause.

## R4: The settled-design preset adds the premise and root cause sections to the spec template, and tells `specify` where to take them from

- **Decision**: The preset gains a `spec-template` template (`strategy: append`) that adds a `## Why this is worth doing`
  section (the premise answers, each with its source) and a `## Root cause` section whose guidance reproduces what
  `alq-shape` asked for, kept to the part FR-006 to FR-008 move: open with `Observed:` or the statement that it does
  not apply, keep what was examined and ruled out apart from what was not investigated, label each claim about other
  callers verified or predicted. It also gains a `speckit.specify` command (`strategy: append`) saying: copy the premise answers
  from the report named in the arguments, and trace the cause only after reading the code. The preset's version moves to 1.1.0.
- **Rationale**: FR-021 puts the root cause in `spec.md`, written by `specify` from a template section, so the
  template is the one definition of the section's shape and the check (R5) is its gate. The preset is where this
  plugin already changes Spec Kit's templates, and the project's own `.specify/templates/` are not edited, so no
  other plugin's project is affected.
- **Existing tools**: the preset's `plan-template` and `speckit.plan` appends (`preset.yml`) are the precedent, and
  `test_plan_template.py` already installs the preset into a real Spec Kit project and reads the result. Not verified:
  that `spec-template` accepts `append` the way `plan-template` does. R10 proves it before anything else is built on it.
  Editing `.specify/templates/spec-template.md` directly was looked at and does not fit: that file is the project's, not the
  plugin's, and a start would not carry it to another checkout.

## R5: A second script checks the section, right after `specify` and again after grill

- **Decision**: A new `plugins/alq-review/scripts/rootcause.py` has one command, `check <spec folder> [<premise report>]`. It fails, with a next step,
  when `spec.md` has no `## Root cause` heading, the first non-blank line under it neither starts `Observed:` nor
  is `Not a defect report.`, or it is `Not a defect report.` while the report says `Reports wrong behaviour: yes`. The
  report's flag is the one answer to "is this a defect"; the section does not get a second say. The workflow runs the
  script as `root-cause`, directly after `specify`, and as `root-cause-after-grill`, after
  `no-open-markers`, because the user may edit the section in grill. Both steps call the one script. On a re-scope there
  is no report and no `specify`: the first step is skipped and the second runs as `root-cause-of-rescope`, without the
  report argument. The constant `Not a defect report.` is defined here and the
  template (R4) names the same sentence.
- **Rationale**: FR-021 asks for exactly this check: the section is there and labelled, not that the trace is
  right. `alq-root-cause-check` already looks for the `## Root cause` heading and an `Observed:` line, and
  reads `Not a defect report.` as a stop, so the check enforces the form its reader expects. It is a separate
  module from `premise_report.py` because it grades `spec.md`, not the report: one reason to change each.
- **Existing tools**: `settled_design.py` has `_sections`, which splits a markdown file into `## ` sections;
  it is a private helper of a module with another purpose, so importing it would couple the two. Looked at and not
  reused for that reason: the heading scan is four lines. No markdown parser is in the standard library.

## R6: The "not worth doing" finding is a third form of the location comment

- **Decision**: `speclocation.py` gains `NotWorthDoing(reason)`, parsed from `spec: not worth doing` + `reason: <line>`
  (still exactly two lines after the marker), `render_not_worth_doing`, `post_not_worth_doing` and the CLI command
  `not-worth-doing <checkout> <reason>`. `located` raises `SpecLocationError` for this form, saying the issue was judged
  not worth doing, the reason, and the next step: run `/alq-review:design-doc #<n>` to put the question again.
  Because `show`, `resolve` and so the gate all go through `located`, `alq-issue-tackle` and the gate refuse in
  code, with one message. A new CLI command, `status <issue>`, prints exactly one of `located`, `none`, `not worth doing`
  or `no comment` and exits 0; a comment that cannot be read, or more than one, exits 1 with the existing refusal. It is
  what the planning skill asks before starting, since `show`'s exit 1 does not tell "no comment" from "not worth doing"
  from "malformed".
- **Rationale**: FR-018 forbids a second comment and a second parser. Making `located` raise is the one place that
  refuses all three consumers (P1: code decides; tackle's existing "exits non-zero: show the message and stop"
  already handles it), instead of each skill learning a new branch of prose.
- **Existing tools**: `speclocation.parse`, `render`, `_upsert` and `post_none` are the form and writer; the new form follows
  `NoSpec` line for line. The `<!-- analitiq-premise -->` comment and its free-text layout are `alq-shape`'s and go with it.

## R7: The skills are edited in text; `alq-shape` is deleted; the driver is untouched

- **Decision**: `design-doc/SKILL.md` gains a premise step between "start" and "grill": on `paused` at `premise`,
  run `premise_report.py form`, write the report to the run's folder, answer the questions in the session (dispatching
  `Explore` for what the code can answer, and asking the user only what it cannot), state the recommendation, ask the user for
  one of the three picks by name, write `Pick:`, and resume with `premise_verdict=<pick>`. Its description
  and argument hint keep every entry point (FR-016), and the `none` entry stays a shortcut with no workflow. Before the
  workflow starts, the skill runs `speclocation.py status <n>` (R6): `located` means the spec exists, and the skill says where
  and stops; the three other results start the workflow; a non-zero exit is a refusal the skill shows. `alq-issue-tackle` names `design-doc` where it named `alq-shape` and loses the `(code)` re-check paragraph (FR-019);
  `alq-root-cause-check` loses "a spec written by design-doc has no Root cause section yet". `skills/alq-shape/` is deleted.
  `drive_workflow.py` changes only in the `resume` argument it already takes, which is generic (`<input>=<value>`), so it
  is not edited in the merge.
- **Rationale**: FR-012, FR-014, FR-016, FR-019. The workflow carries the checks (R1 to R5); the skill only does the two
  things a headless step cannot: talk to the user and ask the code questions in the session, as `grill` already does.
- **Existing tools**: the skill's grill step is the pattern for an interactive pause: invoke, let the user answer, then
  resume with a verdict. `alq-shape` steps 2 to 4 are the source of the question wording, which moves into `form` (R2).
  Nothing else in `alq-shape` moves (FR-009, FR-019): the surface list, the source tags and answering from industry practice go with it.

## R8: Order the delivery as two pull requests; the rename is mechanical

- **Decision**: PR 1 is R1 to R7 and every test for them. PR 2 renames `design-doc` to `alq-spec` and nothing else: the skill
  folder; the workflow id, title and folder, and the dev project's installed copy; `drive_workflow.py` constants and docstring;
  `policy.py` `RESCOPE_SKILL`; the names in `gate.py`, `speclocation.py` messages and `settled_design.py` messages; the README
  rows and the `/alq-review:design-doc rescope` keyword text; `.github/workflows/tests.yml`; and the tests that name it.
  The settled-design check's "design document" wording (`settled_design.py` lines 10, 123, 141, 150) is the rule from
  #29 and stays; line 151's `/alq-review:design-doc` is the skill's name and changes.
- **Rationale**: FR-020. A rename that changes no behaviour is reviewable as a rename only if it carries no other
  change (FR-017). Principle VI is not engaged: no rule file moves with the code it governs.
- **Existing tools**: `grep -rn "design-doc"` is the list of places; a test pins that none is left (R9). A sed script was
  looked at and does not fit for the tests: `test_gate.py` has `/design-doc` typed-prompt cases whose expected
  results depend on the keyword, so each hit is read.

## R9: Tests start from a failing test per check, and a final pair pins the names

- **Decision**: New `tests/test_premise_report.py`, `tests/test_rootcause.py`, additions to `tests/test_speclocation.py`
  (third form, `located` refusal, `not-worth-doing` command), `tests/test_drive_workflow.py` and
  `tests/test_plan_template.py` (the premise gate pauses first and is skipped on a re-scope; the three picks; the
  installed preset carries the new sections). `test_spec_source.py` is updated for the merged skill. Two repo-wide pins:
  PR 1 adds a test that nothing under `plugins/` or `dev/alq-review/tests/` names `alq-shape`; PR 2 adds the same for `design-doc` as a skill
  or workflow name, allowing the settled-design rule's "design document".
- **Rationale**: SC-001, SC-002, SC-005 and the red-test-first rule. The pins grade a count of zero, so they cannot pass before the
  work is done.
- **Existing tools**: `test_spec_source.py` and `test_plan_template.py` are the precedent for pinning skill text and for
  installing the preset in a real project. `unittest` with the fake `gh` of `test_gate.py`, as in spec 018.

## R10: First prove what Spec Kit does with the new workflow shape and the template append

- **Decision**: Before any other task, a failing test in `test_plan_template.py` / `test_drive_workflow.py` installs the preset and
  workflow into a real Spec Kit project (CI's pinned `specify-cli==1.0.7`) and asserts: (1) a `spec-template` `append` lands in a
  generated spec; (2) a run started with no `spec_dir` pauses at `premise`; (3) a resume with `premise_verdict=no spec needed`
  completes without running `specify`; (4) a start with `spec_dir` skips `premise`; (5) steps nested two `if`s deep appear
  in `steps.<id>.output` for the second `if`'s condition. If any fails for a Spec Kit reason, the plan changes before code does.
- **Rationale**: Reading the engine is not running it. The whole shape in R1 rests on (2) to (5), and R4 on (1); they are the
  parts of this plan nobody has executed.
- **Existing tools**: `Rescope` and `Install` in `test_drive_workflow.py` already run the real CLI and read `state.json`; the new cases
  use the same `Project` helper.
