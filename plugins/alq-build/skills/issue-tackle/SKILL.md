---
name: issue-tackle
description: Implement the fix for a GitHub issue against the spec folder it is handed, as `<n> spec=<folder|null> [branch=<branch>]`. Works in a git worktree on the branch that holds the spec, reads spec.md from that branch's HEAD, implements at the root cause the spec names rather than the symptom the issue reported, refuses shims and workarounds, then runs the internal review round with the same spec and the root-cause check before the PR goes to review. Use whenever the user names a GitHub issue number to work on, fix, implement, or tackle - "tackle 477", "fix issue 512", "work on #489", "start on 503" - or asks to begin work on an open issue.
---

You are given `<n> spec=<folder|null> [branch=<branch>]`. `<n>` is an issue open in GitHub, `spec` is
the spec folder this change is built against or `null` for a change with no spec, and `branch` is the
branch that folder was committed on.

## Step 1 - arguments

- With no `spec`, stop and give its two forms: `<n> spec=<folder> branch=<branch>` and `<n> spec=null`.
- A folder given without `branch` is refused: stop and name `branch` as the missing argument.

Write no code before both are settled.

## Step 2 - worktree and spec

With a folder, work in `.claude/worktrees/<n>` on `branch`: check `branch` out there, or reuse that
worktree when it is already on `branch`. A worktree there on another branch is a stop: say which
branch it is on.

Run `git show HEAD:<folder>/spec.md` in the worktree; when `spec.md` is missing or empty at that HEAD,
stop before writing any code and say so. The review gate reads `spec.md` at the head it reviews, so a
spec not committed on the branch is no spec to it.

Then read `<folder>/spec.md`. `plan.md` and `tasks.md` in the same folder say how it is to be built.
The requirements `spec.md` states are what this change is for.

With `spec=null`, create the branch `<type>/<n>-<short-description>` per the branch-naming rules, in
`.claude/worktrees/<n>`. There is no spec to read: the issue is what this change is for, and every
mention of the spec below does not apply.

Never work on main.

## Step 3 - implement

- Implement against the requirements `spec.md` states. Meeting every one is the definition of done.
- Ask any clarification questions you may have.
- Implement at the spec's **Root cause**, not at the site the issue reported. Working from
  the issue title instead of that section is how a symptom patch gets written.
- If the code contradicts the Root cause section - the trace was right weeks ago and the
  module has moved since - stop and say so. A spec nobody can satisfy gets silently ignored
  instead of corrected.
- Read the section's **Observed:** line first. If it says the trace is a hypothesis, or marks
  the affected callers as predicted rather than verified, confirm the mechanism yourself
  before building on it - reproduce it, or find the log or test that shows it. The spec was
  honest about being a guess; spending it as a measurement is what makes it wrong.
- Do not implement shims, workarounds or anti-patterns. Use best practices instead.
- Implement solutions that are considered best practices in the SaaS data integration
  industry.

## Step 4 - review against the spec

If `alq-review:review-round` is not among the workflows you can run, stop before the PR: say the
review step needs alq-review.

Commit and push, then open the PR as a draft: a review round is recorded against its PR. Launch every
review-round with the same `spec` this skill was given, the folder quoted or `null`:

```
Workflow(name='alq-review:review-round', args={worktree: '<absolute worktree path>', stage: 'internal', spec: '<folder>' | null})
```

The PR is bound to the value of its first round, and a different one is refused. You do not hand
reviewers the spec: the gate tells each reviewer to read `<folder>/spec.md` and to raise every
requirement it states that the change does not meet as a finding. A diff that is clean on its own terms and
does not satisfy the spec is a failure. When a round has findings, the gate names each next step: take
it, until the internal loop ends clean.

## Step 5 - root cause

With `spec=null` there is no trace to check against, so the root-cause check does not run: go on to
Step 6.

Otherwise, once the internal loop ends clean, invoke the `alq-build:root-cause-check` skill with
the spec folder as its argument. A symptom patch is clean code by every other measure, so it passes
every reviewer not asked whether the fix reached the cause; this check is the one that asks. Act on
its verdict:

- **AT CAUSE**: on to Step 6, the PR.
- **AT SYMPTOM**: back to Step 3; the new diff goes through the review loop and this check again.
- **SPEC WRONG**: stop writing code, and tell the user what the trace got wrong.
- **CANNOT TELL**: stop: say which case it is and what would resolve it. The PR stays a draft.

A spec whose Root cause section reads `Not a defect report.` gets no verdict, as there is no defect to
trace: go on to Step 6.

## Step 6 - PR

Mark the PR ready and run the GitHub review loop to green.

## Step 7 - cleanup

Once the PR is merged, remove the worktree.
