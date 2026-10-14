# Contract: the GitHub notice for one RESHAPE_SPEC ruling

Made by `gate.after_structured_output` after the ruling is recorded. There are at most two `gh` calls, made in
this order. Both are made even when the first fails.

## Call 1: comment

```text
gh issue comment <issue> --repo <owner/repo> --body <body>
```

`<body>` is `reshape.comment(folder, assessment, pr, rnd)`:

```text
alq-review ruled #<pr>, <stage> round <n> RESHAPE_SPEC: the spec has to be reshaped before this PR's code may change.

<reshape.summary(folder, assessment)>
```

`reshape.summary` renders the text the `unlock` reply ends with, word for word:

```text
Open decision: <user_decision> Why: <rationale> Spec gaps: <mechanism> (<spec_ref>); … Spec folder: <folder>.
```

The gate adds nothing beyond this (FR-013): no checkout path, no ledger ref, no session id.

## Call 2: label and assignee

```text
gh issue edit <issue> --repo <owner/repo> --add-label reshape_spec --add-assignee <config escalate_to>
```

- The label is never created. If it is missing, gh fails, and its error is stored.
- If `escalate_to` cannot be read, this call is not run, and the config error is stored as its outcome.

## Not made

- No call when the PR is bound to `spec: null` or to nothing, for any verdict other than `RESHAPE_SPEC`, when the
  plugin is off, or at any later event for the same round.
- No call when the folder's name gives no issue. The failure is stored instead.
- No retry, no label removal, no unassign: not at `unlock`, not ever (FR-010, FR-011a).

## Failure text (lock refusal and unlock reply)

`reshape.notice_failures(rnd)`. Empty when both calls are done, otherwise one sentence per failed call:

```text
The RESHAPE_SPEC notice on <owner/repo>#<issue> failed: the <comment | reshape_spec label and assignee> was not
posted (<error>). Do it by hand.
```

An outcome still `null` reads `GitHub's answer was not recorded` in place of `<error>`, followed by "check the
issue". The no-issue failure names the folder instead of an issue.
