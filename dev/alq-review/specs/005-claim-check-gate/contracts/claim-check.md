# Contract: claim-check interfaces

The interfaces this feature adds to alq-review. Shapes are defined once, in the modules named; this file
describes them for the author and the user and is the reference the tests in `tasks.md` are written from.

## 1. What the author sees

Refusals come from `gate.refuse()` under the `claim_checks` setting, and name the next step.

| Situation | Refusal says |
|---|---|
| No check for the staged tree | `Next step: Workflow(name='alq-review:claim-check', args={worktree: '<abs path>'})` |
| `git commit` has a staging flag or shares its command with anything but `cd` | stage with `git add` in an earlier command, then run `git commit` alone |
| Check launch while tracked files have unstaged changes | the files; stage or discard them, then launch again |
| Check still `reading` or `judging` | the check failed, not that a claim is wrong; relaunch the same call |
| One or more `WRONG` | per claim: `file:line`, the quoted claim, the failing case, the evidence `file:line`; then: fix the claim or the code, or contest with evidence |
| Any one claim ruled `WRONG` by 3 checks | the open question for the user, that claim's words and ruling at each check, and `unlock claim-<id>` |

A commit with an empty staged diff, or one that concludes a merge, cherry-pick or revert, is not refused.
`UNSURE` verdicts and the large-commit warning never refuse; they come back in the workflow result.

## 2. `alq-review:claim-check` (workflow)

Launch: `args = {worktree: <absolute path>, contests?: [{claim, evidence}]}`, where `claim` is a claim id printed
in the refusal. `evidence` holds a `path:line` in the staged tree or an `https://` URL; a contest without one is
refused at launch, before any agent runs.

The gate replaces `args` at launch with the hunks, the reader and judge prompts and schemas, and `check_ref`
(see `data-model.md`). The script only orders the work and returns:

```
{status: "COMPLETE" | "INCOMPLETE",
 check_ref, judged, agents,
 wrong:    [{file, line, claim, failing_case, evidence: ["path:line", ...]}],
 unsure:   [{file, line, claim, gap}],
 contests: [{claim_id, outcome: "upheld" | "rejected", basis}],
 not_judged_categories: {K2: n, ...},
 warning?: "N claims were judged; consider splitting the change into several PRs",
 did_not_report?: [...],
 next_step}
```

`wrong`, `unsure` and `contests` are what this run judged. Whether the commit may land is the gate's decision
alone, made at `git commit`: it also weighs verdicts settled before this run and the user's releases, so
`COMPLETE` names `git commit` as the next step either way. `INCOMPLETE` lists the agents that did not report and tells the author to launch again; the check stays
unfinished and the commit stays refused. The claim ids to contest are in the commit's refusal: the gate is the
one that computes them.

## 3. Agent outputs (StructuredOutput, validated by the hook)

Each carries `check_ref`, which the hook uses to find the check, and is rejected with reasons on a rule below.
Paths are checked against the checked tree object (`git cat-file blob <tree>:<path>`), never the worktree.

Reader (one per batch of up to 16 hunks), agent type `alq-review:claim-reader`:
`{check_ref, batch, hunks: [{id, kind: CODE|PROSE|MIXED, claims: [{line, quote, category: K1..K8}]}]}`
Rules: every hunk id of the batch appears exactly once; a `quote` is verbatim in the staged file at `line`, and
`line` is inside the hunk's paragraph; a CODE hunk has no claims.

Judge (one per K1 claim), agent type `alq-review:claim-judge`; a contest is judged by
`alq-review:claim-contest-judge`, which has the same output and may also cite an `https://` URL:
`{check_ref, file, quote, verdict: CORRECT|WRONG|UNSURE, assertions: [{text, confirmed, evidence}],
failing_case?, gap?, basis}`; the workflow pins `file` and `quote` in each judge's schema to its claim, and the
hook derives the claim id from them.
Rules: every settled assertion (all of them in `CORRECT` and `WRONG`, the confirmed ones in `UNSURE`) has a
`path:line` in the staged tree as evidence; `CORRECT` needs every assertion confirmed; `WRONG` needs
`failing_case` and at least one unconfirmed assertion; `UNSURE` needs `gap`.

The contest judge's `WebFetch` calls pass the gate only when the URL's host is a host of a URL cited in its
contest.

## 4. Settings and the user's release

`config.json`: `claim_checks` (`log` | `enforce`, default `enforce`, env `ALQ_REVIEW_CLAIM_CHECKS`) and
`claim_warn_over` (default 20). Every check, refusal, contest outcome and release is written to `gate.log`.
Release: a user prompt starting `unlock claim-<id>`, handled by `gate.on_prompt` beside `unlock #<pr>`. `<id>` is
the current claim id or the lineage id. Until then a launch for a tree with a stopped claim is refused with
the same question.
