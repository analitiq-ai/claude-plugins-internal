# Contract: planner's TypeScript scripts and workflow steps

Each script is `node "$PLANNER_ROOT/scripts/<name>.ts" …`, guarded (R3). Exit 0 done; 1 the run stops, each
stderr line naming the next step; 2 could not run (missing dependency, GitHub unanswered, bad arguments).
A script that calls GitHub gets planner's token through `plannerToken` (R5), which mints when the stored one is
missing, another repository's, or under 10 minutes left; a refused mint is exit 2 with core's reason, and a
missing key fails the script with the read's error, naming the file.

## `spec_facts.ts write <spec folder> [<premise report>]` (US3)

Writes the `codeworks` block into `<spec folder>/spec.md` ([data-model](../data-model.md) "Spec facts"). With
no report the spec.md must be a no-spec one. Exit 1 when the report's `Reports wrong behaviour` or the root
cause opening is missing or not one of the vocabulary's values.

Workflow: step `spec-facts-no-spec` after `write-no-spec`; step `spec-facts` after
`premise-answers-after-grill`.

## `preflight.ts <issue>` (US4)

Reads `[shared] board`, the issue's state and its lane. Exit 1 when the issue is closed, has no card
(`add #<issue> to <board>`), or its card is outside Backlog and Blocked (`move #<issue> from <lane> to Backlog
or Blocked`). Workflow: the first step, before `check-folder`, and the workflow's one step that calls GitHub.

## `land.ts <issue> <spec dir> <kind>` (US4)

Run by SKILL step 8 from `CHECKOUT`. Fetches the default branch and `<p>-spec`, then stops, before any write
(exit 1):

| Condition | Next step named |
|---|---|
| `kind` is `rescope` | landing a rescope is #178 |
| several `specs/<p>-*` at `HEAD`, or the spec's folder already on the default branch | the folders found |
| a path changed since `merge-base(HEAD, origin/<default>)` outside the spec folder and `docs/adr/` folders | the paths, to remove from the commit |
| spec PR closed unmerged | delete branch `<p>-spec` |
| spec PR merged | the spec is on the default branch; a rescope is #178 |
| spec PR open and `origin/<p>-spec` not an ancestor of `HEAD` | check out `<p>-spec` |
| more sub-issues than stories | the extra issues |
| a sub-issue at position `i` other than the issue tasks.md labels `US<i+1>` with | both issues |

Then writes: story issues and links, tasks.md labels, a commit authored as the planner App, the push, the
draft PR when none is open. Stdout, last three lines: `Spec folder: <path>`, `Branch: <p>-spec`,
`Spec PR: <url>`.

## `gh.ts <gh args…>` (US6)

Runs `gh <gh args…>` as the planner App for origin's repository (R9): the token through `plannerToken`,
`GH_CONFIG_DIR` set to `ghFolder(repo)`, core's `GH_TOKEN_VARIABLES` removed; stdin, stdout and stderr passed
through. Exit code: gh's. Exit 2, with no gh run, on a missing dependency, a refused `codeworks.toml`, no GitHub
origin, or a refused mint; a missing key fails it, naming the file, with no gh run. Its caller is `new_issue.py`,
for each of its `gh` calls.

## `name-close` step (US5)

Replaces `close-not-worth-doing`. Prints `Close #<issue> as not planned: <reason>`. Calls no `gh`.
