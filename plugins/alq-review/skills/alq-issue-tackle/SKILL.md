---
name: alq-issue-tackle
description: Implement the fix for a GitHub issue given its issue number, working in a git worktree against the spec stored on the issue. Materialises that spec into the worktree, shaping the issue first if it has none, implements at the root cause the spec names rather than the symptom the issue reported, refuses shims and workarounds, and reviews the diff against the spec before opening a PR. Use whenever the user names a GitHub issue number to work on, fix, implement, or tackle - "tackle 477", "fix issue 512", "work on #489", "start on 503" - or asks to begin work on an open issue.
---

You will be given a number that represents an issue open in GitHub. Call it `<n>`.

## Step 1 - worktree

Create a worktree under `.git/wt/<n>` on a branch named `<type>/<n>-<short-description>` per
the branch-naming rules. All work happens there. Never work on main.

## Step 2 - materialise the spec into the worktree

The spec lives on the issue, as a comment marked `<!-- analitiq-spec -->`. It was probably
written days before this worktree existed. Fetch it:

```
gh api repos/{owner}/{repo}/issues/<n>/comments \
  --jq '.[] | select(.body | contains("<!-- analitiq-spec -->")) | .body'
```

- Nothing came back: invoke the `alq-shape` skill with `<n>` and wait for it, then fetch again.
  It either posts the spec, posts a "No shape needed" marker, or challenges the issue's premise
  and posts no spec. If the second fetch still returns nothing, stop and report the premise
  challenge; the user decides whether the issue is worked at all.
- It came back: write it to `specs/<n>.md` in the worktree. `specs/` is gitignored, so the
  file is never committed.

Fetch it **every time this skill starts**, overwriting any `specs/<n>.md` already there. The
local file is a cache; the issue is the home. A spec revised after the worktree was created
must win, and it only wins if the cache is never trusted over the source.

Read it before writing any code. The Acceptance section is what this change is for.

Then check that it has a **Hand-maintained surfaces** section. A spec without one predates
`alq-shape`'s Step 6: **stop** and report that it needs a re-shape. Write no code.

Do not start implementing before the spec exists. The commit gate will refuse the commit
anyway, and finding that out after writing the code wastes the work.

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

Run the internal PR review. Give every reviewer subagent the contents of `specs/<n>.md` and
tell it to check the diff against the Acceptance section - not just for general defects. A
diff that is clean on its own terms and does not satisfy the spec is a failure.

Then invoke the `alq-root-cause-check` skill. A symptom patch is clean code by every other measure,
so it passes every reviewer not specifically asked whether the fix reached the cause - that
skill is the one that asks. Treat a verdict of AT SYMPTOM or SPEC WRONG as blocking: the first
means going back to Step 3, the second means re-shaping the issue before any more code.

## Step 5 - PR

Open the PR in DRAFT and run the review loops to green.

## Step 6 - cleanup

Once the PR is merged, remove the worktree. `specs/<n>.md` is gitignored and uncommitted, so
it goes with the worktree, and nothing is lost - it was only ever a copy of the issue comment,
which stays.
