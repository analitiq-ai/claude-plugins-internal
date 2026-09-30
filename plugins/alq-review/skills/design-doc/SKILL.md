---
name: design-doc
description: Scope or re-scope a change in a spec folder before it is built, by running the design-doc Spec Kit workflow (specify → grill → plan → critique → tasks). Use for a GitHub issue that needs scoping (`/design-doc #<issue>`) or a PR whose review round was ruled RESHAPE_SPEC (`/design-doc rescope <ref>`).
argument-hint: "#<issue> | rescope <#pr | owner/repo#pr | branch>"
---

Drive the `design-doc` Spec Kit workflow (`.specify/workflows/design-doc/workflow.yml`). The workflow owns
the step order and the checks; this skill picks the checkout and the inputs, runs the two interactive steps
in this session, and passes the user's verdicts on resume. Never reimplement a workflow step here.

## 1. Resolve the entry point

`$ARGUMENTS` is one of:

- **`#<issue>`** - scope a new bug or feature. `CHECKOUT` is the issue's worktree (create it per the
  repo's branch rules if there is none). Write the issue to `SPEC_FILE`:
  `gh issue view <issue> --json url,title,body --jq '"\(.url)\n# \(.title)\n\n\(.body)"' > <SPEC_FILE>`.
  No `SPEC_DIR`: the workflow's `specify` step creates a new spec folder.
- **`rescope <ref>`** - re-scope a PR held by a RESHAPE_SPEC ruling; `<ref>` is `#<pr>`,
  `<owner>/<repo>#<pr>` or the branch. alq-review answered this prompt with an `[alq-review]` line. If it says
  nothing was unlocked, show it to the user and stop. Otherwise the branch is released, and every rescope
  value comes from that line: `REPO#PR` and the branch from `The user unlocked`, `CHECKOUT` from `Worktree:`,
  and the open decision, the rationale and the spec gaps.

  `SPEC_DIR` is the one `specs/<feature>` directory the PR changed, against the base branch GitHub names (one
  command): `BASE=$(gh pr view <PR> -R <REPO> --json baseRefName --jq .baseRefName) && git -C <CHECKOUT> diff --name-only "$(git -C <CHECKOUT> merge-base HEAD "origin/$BASE")" HEAD -- specs/ | cut -d/ -f1-2 | sort -u`.
  None or more than one: ask the user which.
  With the Write tool, write `SPEC_FILE`: `RESCOPE of <SPEC_DIR> (<REPO>#<PR>). Open decision: … Why: … Spec gaps: …`
  (from the line).

Anything else: tell the user the two forms and stop.

`SPEC_FILE` is a new file in the session scratchpad. Issue and ruling text never go into a command line.

## 2. Run it

`DRIVE` is `scripts/drive_workflow.py` in this skill's base directory. It passes the inputs to
`specify workflow`, and prints one JSON report: `run_id`, `status`, `step`; on a failed step also `stderr`
and `open_markers`; paused at `review-critique` also `critique`. Run every `DRIVE` call from `CHECKOUT` with
`run_in_background: true` (headless steps take up to ~10 min each).

1. **Start.** `python3 DRIVE start <SPEC_FILE>`, plus `<SPEC_DIR>` on a rescope. Expect `paused` at `grill`;
   note the `run_id`.
2. **Grill.** Invoke `/speckit-grill-me` in this session, from `CHECKOUT`. On a rescope, give grill the
   ruling first: its open decision is the first question. The user answers every question. Do not answer
   for the user.
3. **Resume past grill.** Only after grill finished: `python3 DRIVE resume <run_id> grill_verdict=approve`.
   If the user wants to stop, pass `grill_verdict=reject`. Expect `paused` at `review-critique`.
4. **Critique review.** Read the report's `critique` file and show the user its findings. Apply to
   spec.md/plan.md only the findings the user accepts.
5. **Resume past critique.** Only when the user approves: `python3 DRIVE resume <run_id> critique_verdict=approve`
   (or `reject`). Expect `completed`.
6. Report the run status and the spec folder path.

A verdict is the user's decision. Never pass `approve` without the user saying so in this session.

## Stops

`DRIVE` exiting non-zero, or a report other than the one the step expects: show the user the message or the
report (`stderr` included) and stop. One exception: `open_markers: true` goes back to step 2, then
`python3 DRIVE resume <run_id>`.

On a rescope, every stop after a successful release, including an abort, tells the user that the branch is
already released and the open decision is still unanswered.
