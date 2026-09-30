# alq-review

Review rounds as a gated process. Code, not prose, decides when an agent may touch a branch
that is under review.

## What it enforces

1. **Every reviewer reports before anything is acted on.** Reviews run as one workflow with all
   reviewers behind a barrier. Dispatching `pr-review-toolkit` reviewers one by one from the main
   thread, or running the `review-pr` or anti-pattern `pr-audit` skill outside the workflow, is
   refused, and no file changes while any reviewer subagent is still running.
2. **Every round is assessed before it is fixed.** An independent assessor rules on each finding
   (`FIX` / `PUSH_BACK` / `DEFER`, with a kind such as `bikeshed`, `gold_plating`, `fix_induced`,
   `class_sibling`, `spec_gap`) and on the round: `PATCH`, `CLASS_FIX`, `REDESIGN`, `RESHAPE_SPEC`,
   `CONVERGED_PUSHBACK` or `ESCALATE`. Until a valid assessment is in the ledger, `Edit`/`Write`,
   `git commit`, `git push` and the `@codex review` re-request are refused. `RESHAPE_SPEC` and
   `ESCALATE` hand the branch to the user: it stays locked until the user starts a prompt with
   `unlock #<pr>` (or `unlock <branch>`, or `unlock <owner>/<repo>#<pr>` when two repos share the number),
   and the refusal tells the agent to ask for exactly that. A spec edit does not release it: the agent can
   make one. A `RESHAPE_SPEC` lock is also released by a prompt starting `/design-doc rescope <same ref>`: the
   session is handed the ruling (open decision, rationale, `spec_gap` findings) and the round's worktree, and
   the `design-doc` skill re-scopes that worktree's spec folder. Any other lock refuses it and names `unlock`. While a branch is held, every Bash command of the session that launched its round is checked
   against the branch's tip and, while its checkout has the branch checked out, every tracked and untracked
   change there, as they stood before the command. A file written or a commit made by any route is caught
   and the agent told to put it back, even if the command then leaves the branch; checking another branch
   out is not a move. If that checkout cannot be read — its `.git` is gone, corrupted, or the directory
   itself was removed — the command is not blocked on it; alq-review reports `cannot verify <root>` and
   that nothing there is watched, instead of silently treating it as unchanged. A file or directory in it
   that cannot be read is reported as `cannot verify <paths> in <root>` and is never counted as a change,
   while the branch tip and every other change there are still watched; when git complains without naming
   a path, no file there is compared (`cannot verify files in <root>`) and the tip still is. A ledger
   belongs to one PR, and a checkout means its branch's open PR on GitHub - nothing local decides it.
   GitHub is asked only for a branch some ledger names, once per commit once it names a PR; a round
   launch records the PR it names at that commit. A merged or closed PR holds
   nothing from the next commit on; a new PR on the same branch name has a ledger of its own. When GitHub
   cannot say which PR is open, the call is refused with GitHub's error rather than guessed.
3. **The order of the stages.** Declaring the internal review done is refused until it came back clean
   (no findings, or every finding pushed back) at the current commit: `gh pr ready`, `gh pr create`
   without `--draft`, and any comment carrying the `internal-review` attestation marker the org pr-gate
   reads. A comment is judged by what it posts, body files included, however `gh` posts or edits it.
4. **The cap.** A stage gets 4 rounds. The fifth is refused and the anti-pattern audit is required;
   its assessment may not be `PATCH`. The second such audit that rules something must change locks the
   branch the same way `RESHAPE_SPEC` does; an audit ruled `CONVERGED_PUSHBACK` does not count. The user
   decides whether to go on and unlocks it, which grants 2 more audits. Every lock puts a question to the
   user: `RESHAPE_SPEC` and `ESCALATE` must carry `user_decision`, and the refusal shows it word for word.
5. **Convergence.** Round 1 reviews the whole change: everything since the branch left the branch its
   PR merges into (the repo's default branch while there is no PR), fetched fresh at each launch; a
   round whose base cannot be read is refused. Later rounds review only what changed since the
   previous round, and reviewers are told what has already been ruled on. Re-running a round on an
   unchanged commit is refused.
6. **A settled design before the first round.** The first internal round on a branch that changes a
   spec folder (`specs/<feature>/`) runs `scripts/settled_design.py` on each such folder: every
   mechanism under `plan.md`'s `## Mechanisms` cites a `research.md` decision with Decision, Rationale
   and Existing tools (or `None fit. Looked at: <where>`). A folder that fails refuses the round and is
   named with each problem. Run it by hand with `python3 scripts/settled_design.py <spec folder>`.

## How an agent uses it

```
Workflow(name='alq-review:review-round', args={worktree: '/abs/checkout'})                  # internal review
Workflow(name='alq-review:review-round', args={worktree: '/abs/checkout', stage: 'audit'})  # anti-pattern audit
Workflow(name='alq-review:assess-round', args={worktree: '/abs/checkout'})                  # after the poller reports findings
```

Agents do not need to be told any of this: every refusal names the next legal step.

## Mode

`config.json` holds `{"mode": "log"}` or `{"mode": "enforce"}`; `ALQ_REVIEW_MODE` overrides it.
In `log` mode nothing is blocked; each refusal is written as `would_deny` to `gate.log` so the rules
can be checked against real sessions before they can stall one.

The spec-folder checks (6) have their own `spec_checks` setting, overridden by `ALQ_REVIEW_SPEC_CHECKS`.
It stays `log` until every existing spec folder passes; they refuse only when both settings enforce.

## State

`${ALQ_REVIEW_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/alq-review}`

- `ledger.db` - one SQLite file, WAL mode, every write inside a `BEGIN IMMEDIATE` transaction so
  concurrent writers take turns on it instead of losing each other's update the way a bare JSON file or a
  stale flock would:
  - `ledgers (repo, pr) -> doc` - one row per PR: its rounds, findings, assessments, epoch and unlocks
  - `open_prs (repo, branch, head) -> pr` - a cache of GitHub's answer to "which PR is open on this branch",
    kept per commit so a new commit asks again; "none" is never kept, since opening a PR does not move the branch
- `inbox/<owner>__<repo>__<pr>.json` - written by `alq-github-pr-review/poll-pr-review.sh` on CLEAN and
  FINDINGS; stored under its PR once per hook event, before anything is judged (`tests/test_poller_contract.py` pins the two ends together)
- `gate.log`, `errors.log` - every refusal and recording; every gate failure (a crash refuses the call it was deciding and fails open everywhere else, loudly)

```
python3 scripts/ledger.py status --worktree /abs/checkout
python3 scripts/ledger.py unlock --worktree /abs/checkout --reason "why"    # user only; refused to agents
```

## Layout

| | |
|---|---|
| `scripts/policy.py` | what is permitted next - pure functions of the ledger |
| `scripts/ledger.py` | round state |
| `scripts/assessment.py` | output schemas and the cross-field validator |
| `scripts/facts.py` | git/ledger measurements that put the burden of proof on `PATCH` |
| `scripts/briefs.py` | reviewer list, prompts, audit scope packet, assessor brief |
| `scripts/settled_design.py` | the settled-design check over one spec folder |
| `scripts/gate.py` | hook entrypoint |
| `workflows/` | orchestration only; everything else is injected by the hook |
| `agents/assessor.md` | the assessor |

Tests: `python3 -m unittest discover -s tests`

Depends on the `pr-review-toolkit` and `alq-anti-pattern` plugins for the reviewer agents.
