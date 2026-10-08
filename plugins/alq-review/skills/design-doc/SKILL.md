---
name: design-doc
description: Scope or re-scope a change in a spec folder before it is built, by running the design-doc Spec Kit workflow (premise → specify → grill → plan → critique → tasks; a re-scope starts at grill). For an issue, the workflow first asks whether it is worth a spec at all. Use for a GitHub issue that needs scoping (`/alq-review:design-doc #<issue>`) or a PR whose review round was ruled RESHAPE_SPEC (`/alq-review:design-doc rescope <ref>`). Use `/alq-review:design-doc #<issue> none <reason>` to record that an issue needs no spec.
argument-hint: "#<issue> [<dir>] | rescope <#pr | owner/repo#pr | branch> | #<issue> none <reason>"
---

Drive the `design-doc` Spec Kit workflow (this plugin's `speckit/workflows/design-doc/workflow.yml`, which each
start installs into the checkout with the settled-design preset). The workflow owns
the step order and the checks; this skill picks the checkout and the inputs, runs the three interactive steps
in this session, and passes the user's verdicts on resume. Never reimplement a workflow step here.

The spec's home is the spec folder. The issue carries one location comment that says where the folder is, and
this skill posts it. `SPECLOC` is `../../scripts/speclocation.py` and `PREMISE` is `../../scripts/premise_report.py`, both from this
skill's base directory.

## 1. Resolve the entry point

`$ARGUMENTS` is one of:

- **`#<issue> [<dir>]`** - scope a new bug or feature. First run `python3 SPECLOC status <issue>` in the repo.
  `located`: the issue's location comment names a spec folder. Run `python3 SPECLOC show <issue>`, show the user the location, and stop.
  `none`, `not worth doing` or `no comment`: go on; the workflow puts the question again. A non-zero exit: show
  the user its message and stop.
  `CHECKOUT` is the issue's worktree (create it per the
  repo's branch rules if there is none). `PROJECT` is `<dir>`, relative to `CHECKOUT`, or `CHECKOUT` without one.
  Write the issue to `SPEC_FILE`:
  `gh issue view <issue> --json url,title,body --jq '"\(.url)\n# \(.title)\n\n\(.body)"' > <SPEC_FILE>`.
  No `SPEC_DIR`: the workflow's `specify` step creates a new spec folder in `PROJECT/specs/`.
- **`rescope <ref>`** - re-scope a PR held by a RESHAPE_SPEC ruling; `<ref>` is `#<pr>`,
  `<owner>/<repo>#<pr>` or the branch. alq-review answered this prompt with an `[alq-review]` line. If it says
  nothing was unlocked, show it to the user and stop. Otherwise the branch is released, and every rescope
  value comes from that line: `REPO#PR` and the branch from `The user unlocked`, `CHECKOUT` from `Worktree:`,
  and the open decision, the rationale and the spec gaps.

  The spec folder is the one the PR changed, as the gate finds it, against the base branch GitHub names (one
  command, `SETTLED` being `../../scripts/settled_design.py` from this skill's base directory):
  `BASE=$(gh pr view <PR> -R <REPO> --json baseRefName --jq .baseRefName) && python3 SETTLED --spec-folders <CHECKOUT> "$BASE"`.
  A non-zero exit: show the user its stderr and stop. None or more than one folder printed: ask the user which. For the folder `<p>/specs/<feature>`, `PROJECT` is `<p>` in
  `CHECKOUT` (`CHECKOUT` itself for `specs/<feature>`) and `SPEC_DIR` is `specs/<feature>`.
  With the Write tool, write `SPEC_FILE`: `RESCOPE of <SPEC_DIR> (<REPO>#<PR>). Open decision: … Why: … Spec gaps: …`
  (from the line).

- **`#<issue> none <reason>`** - the user has decided the issue needs no spec. `CHECKOUT` is the issue's
  worktree (create it per the repo's branch rules if there is none). Run
  `python3 SPECLOC none <CHECKOUT> "<reason>"`, report the comment URL it prints, and stop. This entry starts no workflow and creates no spec folder.
  `#<issue> none` with no reason: ask the user for the reason and post nothing until they give one.

Anything else: tell the user the three forms and stop.

`SPEC_FILE` is a new file in the session scratchpad. Issue and ruling text never go into a command line.

## 2. Run it

`DRIVE` is `scripts/drive_workflow.py` in this skill's base directory. It passes the inputs to
`specify workflow`, and prints one JSON report: `run_id`, `status`, `step`; on a failed step also `stderr`
and `open_markers`; paused at `review-critique` also `critique`. `specify` takes the directory it runs in as its
project (it must hold `.specify/`; a parent's does not count), so the spec folder lands in its `specs/`. Run every `DRIVE` call from `PROJECT` with
`run_in_background: true` (headless steps take up to ~10 min each).

1. **Start.** `python3 DRIVE start <SPEC_FILE>`, plus `<SPEC_DIR>` on a rescope. Note the `run_id`. Expect
   `paused` at `premise`; on a rescope, `paused` at `grill`, and the next step is 4.
2. **Premise.** Write the output of `python3 PREMISE form` to
   `.specify/workflows/runs/<run_id>/premise-report.md` in `PROJECT`. Answer each of its questions in this
   session, from the issue and the code, each with its source. Ask the user only what the issue and the code
   cannot answer. Show the user the answers and your recommendation, and write it in `Recommendation:`. It is
   one of the three outcomes: `write the spec`, `no spec needed`, `not worth doing`. Ask the user to pick one
   of the three by name. Never ask for approve or reject at this step. Write the user's pick in `Pick:`, and
   for either of the two stop picks the question it rests on and the reason, as the form says.
3. **Resume past premise.** `python3 DRIVE resume <run_id> "premise_verdict=<pick>"`. After `write the spec`,
   expect `paused` at `grill`. After either stop pick, expect `completed`: the workflow has posted the
   location comment with the outcome and its reason. Tell the user the outcome and stop; no spec was written.
4. **Grill.** Invoke `/speckit-grill-me` in this session, from `PROJECT`. On a rescope, give grill the
   ruling first: its open decision is the first question. The user answers every question. Do not answer
   for the user.
5. **Resume past grill.** Only after grill finished: `python3 DRIVE resume <run_id> grill_verdict=approve`.
   If the user wants to stop, pass `grill_verdict=reject`. Expect `paused` at `review-critique`.
6. **Critique review.** Read the report's `critique` file and show the user its findings. Apply to
   spec.md/plan.md only the findings the user accepts.
7. **Resume past critique.** Only when the user approves: `python3 DRIVE resume <run_id> critique_verdict=approve`
   (or `reject`). Expect `completed`.
8. When the report says `completed`, in `CHECKOUT`: stage the spec folder, `git commit` it, `git push` the
   branch, then run `python3 SPECLOC post <PROJECT>`. Report the run status, the spec folder path and the
   comment URL it prints. A run that is rejected or fails commits nothing, pushes nothing and posts no location comment.

A verdict is the user's decision. Never pass `approve`, or a premise pick, without the user saying so in this session.

## Stops

`DRIVE` exiting non-zero, or a report other than the one the step expects: show the user the message or the
report (`stderr` included) and stop. The exceptions, each resumed with `python3 DRIVE resume <run_id>`:
- `step: premise-report`, with `stderr` lines that each name a Next step: complete the report as they say. An
  answer only the user has is the user's to give.
- `step: root-cause`, `root-cause-after-grill` or `root-cause-of-rescope`, with a `stderr` line that names a
  Next step: fix the `## Root cause` section of spec.md as it says.
- `step: premise-answers` or `premise-answers-after-grill`, with `stderr` lines that each name a Next step: copy
  the premise report's answers into the `## Why this is worth doing` section of spec.md as they say.
- `open_markers: true` goes back to step 4 first.
- `step: settled-design`: settle each `stderr` line with the user as its Next step says; do not fill in a
  decision for them.

On a rescope, every stop after a successful release, including an abort, tells the user that the branch is
already released and the open decision is still unanswered.
