---
name: issue-spec
description: Scope or re-scope a change in a spec folder before it is built, by running the alq-spec Spec Kit workflow (premise → specify → grill → plan → critique → tasks; a re-scope of a spec starts at grill). For an issue, the workflow first asks whether it is worth a spec at all. A new scope lands its spec through its own draft PR, on branch `<issue>-spec`. Use for a GitHub issue that needs scoping (`/alq-plan:issue-spec #<issue>`), a spec folder that needs re-scoping (`/alq-plan:issue-spec rescope <spec folder> #<issue>`), or a change that has no issue yet (`/alq-plan:issue-spec untracked "<what changes>"`).
argument-hint: '#<issue> [<dir>] | rescope <spec folder> #<issue> | untracked "<what changes>" [<dir>]'
---

Drive the `alq-spec` Spec Kit workflow (this plugin's `speckit/workflows/alq-spec/workflow.yml`, which each
start installs into the checkout with the settled-design preset). The workflow owns
the step order and the checks; this skill picks the checkout and the inputs, runs the three interactive steps
in this session, and passes the user's verdicts on resume. Never reimplement a workflow step here.

`PREMISE` is `../../scripts/premise_report.py` from this skill's base directory. `BRANCH` is
`scripts/spec_branch.py` in this skill's base directory.

## 1. Resolve the entry point

`$ARGUMENTS` is one of:

- **`#<issue> [<dir>]`** - scope a new bug or feature. `ISSUE` is the issue number. Write the issue to `SPEC_FILE`,
  from the checkout this session is in:
  `repo=$(git remote get-url origin) && gh issue view <ISSUE> --repo "$repo" --json url,title,body --jq '"\(.url)\n# \(.title)\n\n\(.body)"' > <SPEC_FILE>`.
  `SPEC_DIR` is `specs/<ISSUE>-<short name>`, picked once, here, and never changed for the run: the workflow's
  `specify` step writes the spec there, in `PROJECT`. `<short name>` is 1 to 4 words of the issue title, lowercased,
  each a run of `[a-z0-9]`, joined by single hyphens: the words that name the change. A title with no such word: stop
  before writing anything, and tell the user to retitle the issue. Then, with nothing written yet, run
  `python3 BRANCH create <ISSUE>` from the same checkout. It creates branch `<ISSUE>-spec` from the default branch as
  origin has it, in worktree `.claude/worktrees/<ISSUE>-spec` of the repo, and prints `branch`, `worktree` and
  `base` as JSON. It refuses a branch `<ISSUE>-spec` that exists locally or on origin: show the user its message and
  stop. `CHECKOUT` is its `worktree`. `PROJECT` is `<dir>`, relative to `CHECKOUT`, or `CHECKOUT` without one.
- **`rescope <spec folder> #<issue>`** - re-scope that spec folder in place; both are required. `ISSUE` is as
  above. `CHECKOUT` is the worktree this session runs in, a story's or the spec's: the spec edit lands on its branch,
  in the PR it is run from. A rescope creates no branch, worktree or PR. The folder is relative to `CHECKOUT`: for
  `<p>/specs/<feature>`, `PROJECT` is `<p>` in `CHECKOUT` (`CHECKOUT` itself for `specs/<feature>`) and
  `SPEC_DIR` is `specs/<feature>`. The folder may
  hold the wrong scope, so the issue is re-read as first stated: write it to `SPEC_FILE` with the same
  `gh issue view` command, then append, with the Edit tool, a blank line and `Open decision: …`, the decision
  to re-scope as this conversation states it. If the conversation states none, ask the user for it.
- **`untracked "<what changes>" [<dir>]`** - scope a change that has no issue, after creating its issue. If
  `<what changes>` is empty or only spaces, tell the user so and stop: no issue is created. `NEW_ISSUE` is
  `scripts/new_issue.py` in this skill's base directory; run it from the checkout this session is in. Run
  `python3 NEW_ISSUE types`, then draft from the text a one-line title, a body, and one of the types it prints.
  Ask the user to confirm the title, body and type, or to change them, and create nothing until they do. Write
  `# <title>`, a blank line and the body to `ISSUE_FILE`, a new file in the session scratchpad, with the Write
  tool. Run `python3 NEW_ISSUE create <TYPE> <ISSUE_FILE>`. If it exits non-zero, show its message and stop: no
  run is started. It prints the new issue's `issue` and `url`: go on as `#<issue> [<dir>]` with `ISSUE` the new
  issue, and every stop from here on names the issue created, by its `url`.

Anything else, a folder whose parent is not named `specs` included: tell the user the three forms and stop.

`SPEC_FILE` is a new file in the session scratchpad. Issue and conversation text never go into a command line.

## 2. Run it

`DRIVE` is `scripts/drive_workflow.py` in this skill's base directory. It passes the inputs to
`specify workflow`, and prints one JSON report: `run_id`, `status`, `step`; on a failed step also `stderr`
and `open_markers`; paused at `review-critique` also `critique`. `specify` takes the directory it runs in as its
project (it must hold `.specify/`; a parent's does not count), so the spec folder lands in its `specs/`. Run every `DRIVE` call from `PROJECT` with
`run_in_background: true` (headless steps take up to ~10 min each).

1. **Start.** `python3 DRIVE start <SPEC_FILE> <ISSUE> <SPEC_DIR>` on a new scope,
   `python3 DRIVE rescope <SPEC_FILE> <ISSUE> <SPEC_DIR>` on a rescope. Note the `run_id`.
   Expect `paused` at `premise`; on a rescope of a spec, `paused` at `grill`, and the next step is 4; on a rescope
   of a folder whose spec.md says no spec is needed, `paused` at `premise`.
2. **Premise.** Write the output of `python3 PREMISE form` to
   `.specify/workflows/runs/<run_id>/premise-report.md` in `PROJECT`. Answer each of its questions in this
   session, from the issue and the code, each with its source. Ask the user only what the issue and the code
   cannot answer. Show the user the answers and your recommendation, and write it in `Recommendation:`. It is
   one of the three outcomes: `write the spec`, `no spec needed`, `not worth doing`. Ask the user to pick one
   of the three by name. Never ask for approve or reject at this step. Write the user's pick in `Pick:`, and
   for either of the two stop picks the question it rests on and the reason, as the form says.
3. **Resume past premise.** `python3 DRIVE resume <run_id> "premise_verdict=<pick>"`. After `write the spec`,
   expect `paused` at `grill`. After either stop pick, expect `completed`. After `not worth doing`, the workflow has
   closed the issue as not planned with the reason: on a new scope, run `python3 BRANCH discard <ISSUE>` as **A new
   scope that does not land** says, then tell the user so and stop. After `no spec needed`, the workflow has written
   `SPEC_DIR` with a spec.md that says no spec is needed, and nothing was posted: land it as step 8 says. On a
   rescope that ended on `no spec needed`, tell the user to pass `spec: null` when the work is reviewed, before
   step 8's end lines; a new scope's end lines say so.
4. **Grill.** Invoke `/speckit-grill-me` in this session, from `PROJECT`. On a rescope, give grill the open
   decision first: it is the first question. The user answers every question. Do not answer for the user.
5. **Resume past grill.** Only after grill finished: `python3 DRIVE resume <run_id> grill_verdict=approve`.
   If the user wants to stop, pass `grill_verdict=reject`. Expect `paused` at `review-critique`.
6. **Critique review.** Read the report's `critique` file and show the user its findings. Apply to
   spec.md/plan.md only the findings the user accepts.
7. **Resume past critique.** Only when the user approves: `python3 DRIVE resume <run_id> critique_verdict=approve`
   (or `reject`). Expect `completed`.
8. When the report says `completed`, from `PROJECT`. `BRANCH` takes the folder and the kind of scope from the run
   itself:
   1. `python3 BRANCH check <run_id>`. It refuses a run that has not completed, a new scope off its spec branch, and
      anything staged outside the folder, and prints `folder` (relative to `CHECKOUT`), `branch` and `message` as
      JSON. A run that is rejected or fails commits nothing, pushes nothing and opens nothing.
   2. Run these yourself, in this order, so the commit gate sees the commit: `git add -- <SPEC_DIR>`,
      `git commit -m "<message>"` with the check's `message`, and `git push --set-upstream origin HEAD`.
   3. On a new scope, `python3 BRANCH open-pr <run_id>`. It refuses a branch origin does not have
      at `HEAD`, opens a draft PR into the default branch whose body starts `Part of #<ISSUE>`, and prints `pr`.
      Launch no review. End with four lines and nothing after them: `Spec folder: <folder>`, `Branch: <branch>`,
      `PR: <pr>` and `Review: spec: null`, the spec a review started by hand takes.

   On a rescope, end with two lines and nothing after them: `Spec folder: <folder>` and `Branch: <branch>`. Name no
   other plugin's command.

**A new scope that does not land.** Once `BRANCH create` has made the spec branch, a new scope that stops before
step 8 lands it runs `python3 BRANCH discard <ISSUE>` from the checkout `BRANCH create` ran in, then stops: after
`not worth doing`, a rejected run, a failed run the user does not resume, or any other stop. It removes the spec
worktree, with what the run left in it, and the local branch, so that a later new scope of the issue is not told
to rescope a spec that does not exist. It keeps a branch that holds a commit or is on origin: show the user its
message.

A verdict is the user's decision. Never pass `approve`, or a premise pick, without the user saying so in this session.

## Stops

`DRIVE` exiting non-zero, or a report other than the one the step expects: show the user the message or the
report (`stderr` included) and stop; on a new scope, first as A new scope that does not land says. The exceptions, each resumed with `python3 DRIVE resume <run_id>`:
- `step: premise-report`, with `stderr` lines that each name a Next step: complete the report as they say. An
  answer only the user has is the user's to give.
- `step: root-cause`, `root-cause-after-grill` or `root-cause-of-rescope`, with a `stderr` line that names a
  Next step: fix the `## Root cause` section of spec.md as it says.
- `step: premise-answers` or `premise-answers-after-grill`, with `stderr` lines that each name a Next step: copy
  the premise report's answers into the `## Why this is worth doing` section of spec.md as they say.
- `step: write-no-spec`, with a `stderr` line that names a Next step: show the user the message. When it names a
  path to clear or make writable, the user does that, not you; resume only once they say it is done. When it
  names `premise_report.py check`, complete the report as it says.
- `step: story-headings-after-specify`, `story-headings-after-grill`, `story-headings-after-critique`,
  `rescope-story-headings-after-grill` or `rescope-story-headings-after-critique`, with `stderr` lines that each
  name a Next step: fix the story headings of spec.md as they say, with the user where a number is theirs to pick.
- `open_markers: true` goes back to step 4 first.
- `step: settled-design`: settle each `stderr` line with the user as its Next step says; do not fill in a
  decision for them.
