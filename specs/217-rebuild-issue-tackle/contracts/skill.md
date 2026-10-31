# Contract: `builder:issue-tackle <s>`

Caller: the orchestrator's UserPromptSubmit or Stop hook, naming `builder:issue-tackle <s>` (#174
contracts/hooks.md). One form: `<s>`, a story issue number. Any other text after it: refuse, naming
`issue-tackle <s>` (FR-001); the script's own argument check is the enforcement.

## Loop (one turn)

1. Run the step script (contracts/step-script.md).
2. Exit 1 or 2: end the turn, quoting the script's reason or stderr line. Nothing else is done.
3. Exit 0, by `kind`:

| `kind` | The skill | Then |
|---|---|---|
| `merge` | runs `argv` in `worktree` (none when a merge is already in progress); on a conflict resolves it in that merge commit and commits | step 1 |
| `implement` | per listed task, in order: build it against the requirement, at the spec's Root cause, confirming the mechanism first when `observed` is `hypothesis`; commit; then a commit that only flips that task's `[ ]` to `[x]` in `tasks.md`. With no task listed, builds the requirement as one change. Then launches the internal round | step 1 is not re-run; the round ends the step |
| `internal_round` | launches `Workflow(name='reviewer:review-round', args=<the step JSON's args>)`, stage internal, no `spec`; takes each step the gate names until clean | end the turn |
| `github_round` | the same, stage github | end the turn |
| `nothing_to_do` | nothing | end the turn |

## Never

Push; open, ready or comment on a PR; request a review; write a lane or label; `git rebase`; `git reset` past a
pushed commit; `git push --force`; read the spec folder, branch or PR from anything but the step JSON; carry
state from an earlier turn; invoke `root-cause-check`; name or run a planning command.

## Where the turn ends

At a clean internal round (the Stop hook then pushes, opens the draft and attests: builder ADR-0003 d1–d2), at a
github round's end, at `nothing_to_do`, or at a stop with its reason.
