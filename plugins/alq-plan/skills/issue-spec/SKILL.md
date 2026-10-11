---
name: issue-spec
description: Scope or re-scope a change in a spec folder before it is built, by running the alq-spec Spec Kit workflow (premise → specify → grill → plan → critique → tasks; a re-scope starts at grill). For an issue, the workflow first asks whether it is worth a spec at all. Use for a GitHub issue that needs scoping (`/alq-plan:issue-spec #<issue>`) or a spec folder that needs re-scoping (`/alq-plan:issue-spec rescope <spec folder> #<issue>`).
argument-hint: "#<issue> [<dir>] | rescope <spec folder> #<issue>"
---

Drive the `alq-spec` Spec Kit workflow (this plugin's `speckit/workflows/alq-spec/workflow.yml`, which each
start installs into the checkout with the settled-design preset). The workflow owns
the step order and the checks; this skill picks the checkout and the inputs, runs the three interactive steps
in this session, and passes the user's verdicts on resume. Never reimplement a workflow step here.

`PREMISE` is `../../scripts/premise_report.py` from this skill's base directory.

## 1. Resolve the entry point

`$ARGUMENTS` is one of:

- **`#<issue> [<dir>]`** - scope a new bug or feature. `ISSUE` is the issue number. `CHECKOUT` is the issue's
  worktree (create it per the repo's branch rules if there is none). `PROJECT` is `<dir>`, relative to
  `CHECKOUT`, or `CHECKOUT` without one. Write the issue to `SPEC_FILE`:
  `repo=$(git remote get-url origin) && gh issue view <ISSUE> --repo "$repo" --json url,title,body --jq '"\(.url)\n# \(.title)\n\n\(.body)"' > <SPEC_FILE>`.
  No `SPEC_DIR`: the workflow's `specify` step creates a new spec folder in `PROJECT/specs/`.
- **`rescope <spec folder> #<issue>`** - re-scope that spec folder in place; both are required. `ISSUE` is as
  above. `CHECKOUT` is the issue's worktree on the branch of the PR bound to that spec folder: a rescope never creates one.
  With no such worktree, stop and ask the user where it is. The folder is relative to `CHECKOUT`: for
  `<p>/specs/<feature>`, `PROJECT` is `<p>` in `CHECKOUT` (`CHECKOUT` itself for `specs/<feature>`) and
  `SPEC_DIR` is `specs/<feature>`. The folder may
  hold the wrong scope, so the issue is re-read as first stated: write it to `SPEC_FILE` with the same
  `gh issue view` command, then append, with the Edit tool, a blank line and `Open decision: …`, the decision
  to re-scope as this conversation states it. If the conversation states none, ask the user for it.

Anything else, a folder whose parent is not named `specs` included: tell the user the two forms and stop.

`SPEC_FILE` is a new file in the session scratchpad. Issue and conversation text never go into a command line.

## 2. Run it

`DRIVE` is `scripts/drive_workflow.py` in this skill's base directory. It passes the inputs to
`specify workflow`, and prints one JSON report: `run_id`, `status`, `step`; on a failed step also `stderr`
and `open_markers`; paused at `review-critique` also `critique`. `specify` takes the directory it runs in as its
project (it must hold `.specify/`; a parent's does not count), so the spec folder lands in its `specs/`. Run every `DRIVE` call from `PROJECT` with
`run_in_background: true` (headless steps take up to ~10 min each).

1. **Start.** `python3 DRIVE start <SPEC_FILE> <ISSUE>`, plus `<SPEC_DIR>` on a rescope. Note the `run_id`.
   Expect `paused` at `premise`; on a rescope, `paused` at `grill`, and the next step is 4.
2. **Premise.** Write the output of `python3 PREMISE form` to
   `.specify/workflows/runs/<run_id>/premise-report.md` in `PROJECT`. Answer each of its questions in this
   session, from the issue and the code, each with its source. Ask the user only what the issue and the code
   cannot answer. Show the user the answers and your recommendation, and write it in `Recommendation:`. It is
   one of the three outcomes: `write the spec`, `no spec needed`, `not worth doing`. Ask the user to pick one
   of the three by name. Never ask for approve or reject at this step. Write the user's pick in `Pick:`, and
   for either of the two stop picks the question it rests on and the reason, as the form says.
3. **Resume past premise.** `python3 DRIVE resume <run_id> "premise_verdict=<pick>"`. After `write the spec`,
   expect `paused` at `grill`. After either stop pick, expect `completed`; no spec was written. After
   `not worth doing`, the workflow has closed the issue as not planned with the reason: tell the user so and
   stop. After `no spec needed`, nothing was posted: tell the user to pass `spec: null` when the work is
   reviewed, and stop.
4. **Grill.** Invoke `/speckit-grill-me` in this session, from `PROJECT`. On a rescope, give grill the open
   decision first: it is the first question. The user answers every question. Do not answer for the user.
5. **Resume past grill.** Only after grill finished: `python3 DRIVE resume <run_id> grill_verdict=approve`.
   If the user wants to stop, pass `grill_verdict=reject`. Expect `paused` at `review-critique`.
6. **Critique review.** Read the report's `critique` file and show the user its findings. Apply to
   spec.md/plan.md only the findings the user accepts.
7. **Resume past critique.** Only when the user approves: `python3 DRIVE resume <run_id> critique_verdict=approve`
   (or `reject`). Expect `completed`.
8. When the report says `completed`, in `CHECKOUT`: stage the spec folder, `git commit` it and `git push` the
   branch. End with two lines and nothing after them: `Spec folder: <path>`, the folder relative to
   `CHECKOUT`, and `Branch: <branch>`, the output of `git rev-parse --abbrev-ref HEAD` in `CHECKOUT`. Name no
   other plugin's command. A run that is rejected or fails commits nothing and pushes nothing.

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
