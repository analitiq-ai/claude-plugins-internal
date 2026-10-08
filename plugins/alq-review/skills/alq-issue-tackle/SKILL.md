---
name: alq-issue-tackle
description: Implement the fix for a GitHub issue given its issue number, working in a git worktree against the spec in the spec folder that the issue's location comment names. Reads that spec from the folder, stops and names /alq-review:design-doc when the issue has no location comment, implements at the root cause the spec names rather than the symptom the issue reported, refuses shims and workarounds, and reviews the diff against the spec before opening a PR. Use whenever the user names a GitHub issue number to work on, fix, implement, or tackle - "tackle 477", "fix issue 512", "work on #489", "start on 503" - or asks to begin work on an open issue.
---

You will be given a number that represents an issue open in GitHub. Call it `<n>`.

## Step 1 - find the spec

Name the script once: `SPECLOC` is `../../scripts/speclocation.py`, from this skill's base directory.

Run `python3 SPECLOC show <n>` **every time this skill starts**, never from memory of an earlier run.
A location that changed since the last run must win. There are three outcomes:

- It prints `spec: <folder>` and `branch: <branch>`: the spec is in that folder on that branch.
- It prints `spec: none` and a reason: the user decided the issue needs no spec. Work from the issue itself.
- It exits non-zero: show the user its message and stop. Write no code. With no location comment,
  the next step is `/alq-review:design-doc #<n>`, which creates the spec folder and posts the comment.

## Step 2 - worktree and spec

Work in a worktree at `.claude/worktrees/<n>`. With a location comment that names a branch, the
worktree is on that branch. Reuse the worktree if it exists. Never work on main. With `spec: none`,
create the branch `<type>/<n>-<short-description>` per the branch-naming rules.

With `spec: none` there is no spec to read: the issue is what this change is for, and the rest of
this step and every mention of the spec below do not apply.

Otherwise read `<folder>/spec.md` in the worktree before writing any code. `plan.md` and `tasks.md`
in the same folder say how it is to be built. The Acceptance section is what this change is for.

Do not start implementing before the spec exists. Each internal review round grades the diff
against the spec the gate reads from the spec folder the location comment names; code written
before there is one has nothing to be graded against.

A decision tagged `(code)` was true of the default branch when the spec was written, which
may have been weeks ago. Re-check the module it names before relying on it; a stale (code)
decision is the one failure this flow invites.

## Step 3 - implement

- Implement against the spec's Acceptance section. That section is the definition of done.
- Ask any clarification questions you may have.
- Implement at the spec's **Root cause**, not at the site the issue reported. The trace was
  done at shaping time; re-deriving it here is how a symptom patch gets written by a fresh
  reader of the issue title.
- If the code contradicts the Root cause section - the trace was right weeks ago and the
  module has moved since - stop and say so. Re-shaping is cheap; a spec nobody can satisfy
  gets silently ignored instead of corrected.
- Read the section's **Observed:** line first. If it says the trace is a hypothesis, or marks
  the affected callers as predicted rather than verified, confirm the mechanism yourself
  before building on it - reproduce it, or find the log or test that shows it. The spec was
  honest about being a guess; spending it as a measurement is what makes it wrong.
- Do not implement shims, workarounds or anti-patterns. Use best practices instead.
- Implement solutions that are considered best practices in the SaaS data integration
  industry.

## Step 4 - review against the spec

Run the internal PR review. You do not hand reviewers the spec: for an internal round, the
alq-review gate reads `spec.md` from the folder the issue's location comment names and puts it in full
into each reviewer's prompt, asking for each unmet Acceptance criterion as a finding. A
diff that is clean on its own terms and does not satisfy the spec is a failure.

Then invoke the `alq-review:alq-root-cause-check` skill. A symptom patch is clean code by every other measure,
so it passes every reviewer not specifically asked whether the fix reached the cause - that
skill is the one that asks. Treat a verdict of AT SYMPTOM or SPEC WRONG as blocking: the first
means going back to Step 3, the second means re-scoping it with /alq-review:design-doc before any more code.

## Step 5 - PR

Open the PR in DRAFT and run the review loops to green.

## Step 6 - cleanup

Once the PR is merged, remove the worktree.
