# Interfaces: split alq-review into review, plan and build plugins

## Review-round launch

```
Workflow(name='alq-review:review-round', args={worktree: '<absolute worktree path>', stage: 'internal'|'audit', spec: '<spec folder>' | null})
```

Assess-round is unchanged: `args={worktree}`. It takes the spec folder from the binding.

### Refusals, in the order they are checked

Each is a test, written to fail first. "Call" is `policy.review_call` filled with the bound value when there is one,
and with `'<spec folder>' | null` when there isn't.

| # | Input | Refusal names |
|---|---|---|
| 1 | no `spec` key | the missing argument, and the full call |
| 2 | neither `null` nor a non-empty string | the two forms, and the call |
| 3 | absolute path, a `..` segment, a parent not named `specs`, or a spelling other than the folder's one (`./`, a trailing or doubled `/`) | step "shape" and the rule broken |
| 6 | a value different from the PR's binding | both values; that the bound value never changes |
| 4 | `<path>/spec.md` missing or empty at the round's head sha | step "spec.md" and the path |
| 5 | git fails while reading 4 | the step and git's error |
| 7 | `spec.md` in HEAD differs from the bound text, and no unlock since the hold | the diff from the bound text to HEAD's (git's error in its place when git cannot make it); that the PR is held until `unlock <ref>` |

All of these go through `hookio.refuse` (under `mode`), and run before `policy.launch_round`. None reaches the
top-level handler. Row 7 records the hold (R18) only when it blocks (`enforce`); in `log` mode the launch is logged as
a would-deny, the binding stays as it was, and the round opens. No row records a binding.

Row 6 is checked before the folder's `spec.md` is read: on a PR already bound, the binding is the fault.

An assess-round launch on a PR bound to a folder runs rows 4, 5 and 7 against the bound folder at its head; one
released by an unlock binds HEAD's `spec.md`. Its row 4 sends the agent to the user, who restores `spec.md` with
their own commit: a round awaiting assessment lets no agent commit.

A launch whose round cannot open (no open PR, no readable review base, no round awaiting assessment) is denied in
every mode (`hookio.block`), not under `mode`.

### Binding cases

| Case | Expected |
|---|---|
| First launch, folder valid | round opens; `spec` and `spec_blob` recorded |
| First launch refused (any row above, or another gate rule) | nothing recorded |
| Second launch, same value | round opens |
| Second launch, same value, `spec.md` since deleted in HEAD | refusal 4 |
| Two PRs on one issue, each with its own folder | each bound and reviewed against its own |
| `null` | round opens with no spec; `spec` recorded as `null` |
| Later launch, same value, `spec.md` changed in HEAD | refusal 7; `spec_held` recorded; edits and git moves on the branch refused with the lock reason |
| The same in `log` mode | logged as a would-deny; no `spec_held`; `spec_blob` unchanged; round opens |
| Launch again while held | refusal 7 again |
| `unlock <ref>`, then launch | round opens; `spec_blob` is HEAD's; `spec_held` deleted |
| RESHAPE_SPEC ruling, `unlock <ref>`, rescope commits a new `spec.md`, launch | refusal 7: the rescope needs its own unlock |

## Release prompt

- `unlock <ref>` on a RESHAPE_SPEC lock: released; the reply follows data-model.md.
- `unlock <ref>` on a PR held by a changed `spec.md`: released; the next launch binds HEAD's `spec.md`.
- `/alq-review:alq-spec rescope <ref>`, or any prompt naming a planning command: not a release. It gets the gate's
  ordinary answer for an unrecognised prompt.

## `/alq-plan:issue-spec`

| Form | Effect |
|---|---|
| `#<issue> [<dir>]` | starts a run with `issue=<issue>`; no comment lookup |
| `rescope <spec folder> #<issue>` | both required; starts at grill on that folder; spec input is the issue's title and description, then the open decision from the conversation |
| anything else | refused, listing the two forms |

Completed run, last message: `Spec folder: <path>` and `Branch: <branch>`, and nothing else naming another plugin.
"Not worth doing": `gh issue close <issue> --repo <origin> --reason "not planned" --comment "<Reason line>"`. "No spec needed": nothing
is posted, and the message says to pass `spec: null` at review.

`premise_report.py reason <report>` prints the `Reason:` text, and exits 1 when it is empty.

## `/alq-build:issue-tackle`

`<n> spec=<folder> branch=<branch>`, or `<n> spec=null`.

| Situation | Behaviour |
|---|---|
| folder given without `branch` | stop: name the missing argument |
| `<folder>/spec.md` missing or empty at the branch's HEAD | stop before writing code |
| review-round not installed | stop before opening the draft PR: "the review step needs alq-review" |
| root-cause AT CAUSE / AT SYMPTOM / SPEC WRONG / CANNOT TELL | mark the PR ready / back to implementing / stop, say what the trace got wrong / stop, say which case and what resolves it |
| Root cause section `Not a defect report.` (no verdict) | mark the PR ready |
| `spec=null` | no root-cause check |

`/alq-build:root-cause-check <spec folder>` reads `<folder>/spec.md`'s `## Root cause`. A missing section gives
CANNOT TELL.
