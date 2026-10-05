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
   make one. A `RESHAPE_SPEC` lock is also released by a prompt starting `/alq-review:design-doc rescope <same ref>`: the
   session is handed the ruling (open decision, rationale, `spec_gap` findings) and the round's worktree, and
   the `alq-review:design-doc` skill re-scopes that worktree's spec folder. Any other lock refuses it and names `unlock`. While a branch is held, every Bash command of the session that launched its round is checked
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
4. **The cap.** A stage gets 4 rounds without settling (a round settles when it is clean or ruled
   `CONVERGED_PUSHBACK`, and the count starts again after it). The fifth is refused and the audit is required;
   its assessment may not be `PATCH`. The second such audit that rules something must change locks the
   branch the same way `RESHAPE_SPEC` does; an audit ruled `CONVERGED_PUSHBACK` does not count. The user
   decides whether to go on and unlocks it, which grants 2 more audits. Every lock puts a question to the
   user: `RESHAPE_SPEC` and `ESCALATE` must carry `user_decision`, and the refusal shows it word for word.
5. **Convergence.** Round 1 reviews the whole change: everything since the branch left the branch its
   PR merges into (the repo's default branch while there is no PR), fetched fresh at each launch; a
   round whose base cannot be read is refused. Later rounds review only what changed since the
   previous round, and reviewers are told what has already been ruled on. Re-running a round on an
   unchanged commit is refused. On a branch named for an issue (`<type>/<n>-...`), every internal
   round, delta rounds included, puts that issue's `<!-- analitiq-spec -->` comment in full into each
   reviewer's prompt, and each Acceptance criterion the change does not meet is a finding; the
   assessor's brief carries the same text. A launch is refused when gh cannot read the issue's
   comments, or finds more than one spec among them. Audit reviewers are not given the spec.
6. **A settled design before the first round.** The first internal round on a branch that changes a
   spec folder (`<dir>/specs/<feature>/` at any depth, so each plugin of a repo can keep its own `specs/`) runs
   `scripts/settled_design.py` on each such folder: every
   mechanism under `plan.md`'s `## Mechanisms` cites a `research.md` decision with Decision, Rationale
   and Existing tools (or `None fit. Looked at: <where>`). A folder that fails refuses the round and is
   named with each problem. A branch that changes a design document (the `design_documents` path
   patterns in `config.json`: README, CLAUDE.md, AGENTS.md, ADRs, rule files) and no spec folder is
   refused too. Run it by hand with `python3 scripts/settled_design.py <spec folder>`, or as the gate
   runs it with `python3 scripts/settled_design.py --branch <checkout> <branch it merges into>`; `--spec-folders`
   in place of `--branch` lists the spec folders it would grade.
7. **Claims are checked before they are committed.** Every `git commit` an agent runs, with or without a PR,
   is refused until the `claim-check` workflow has checked that exact staged tree. Readers label each hunk
   code, prose or mixed and quote each claim its text makes, in one of the categories `scripts/briefs.py`
   lists; a judge per claim of a judged category (`claimcheck.JUDGED`) tries to break it and rules it
   `CORRECT`, `WRONG` or `UNSURE`, citing `path:line` evidence the gate checks against the staged tree. A claim
   about this repo's own behaviour is judged against the code; what a test says it checks (its name,
   description or failure message) is judged against that test alone, since its code may not exist yet. A `WRONG` refuses the
   commit with the claim, its failing case and its evidence; `UNSURE` is a note, also when every verdict is
   one. A check whose readers or judges did not all report refuses as a failed check, never as a wrong claim. The commit
   must run alone (only `cd` before it) and stage nothing itself (`-a`, `-i`, `-o`, pathspecs), since what was
   checked must be what lands; an empty commit or one that concludes a merge, cherry-pick or revert passes.
   A hunk's read is reused only while its words and the reader's task and labels are unchanged, and a `CORRECT`
   only while its claim keeps its category and every file it cited is unchanged (never for
   every/only/all/exactly/always/never claims). An author who thinks a verdict is wrong contests it
   with a `path:line` or an `https://` page; a fresh judge, which may read only the cited hosts, upholds it or
   rejects it, and a rejection counts as a refusal. After 3 refusals of one hunk the agent must stop and ask
   the user, who lets the words stand by typing `unlock claim-<id>`. What the repo's own commit hook changes
   during the commit is cosmetic and is not checked again.
8. **A fix reaches every site of its bug before it is committed.** A `git commit` that stages code is also refused
   until the `shim-check` workflow has checked that staged tree, or the user has overridden its bug; each refusal
   names the next step. Jev answers whether the change fixes a defect. For a fix, sweepers list the sites doing the
   same operation and the callers, reading a copy of `HEAD` in `<main checkout>/.claude/worktrees/`, which the
   repo's `.gitignore` should list. Jev then answers where the fix acts and whether it reaches every listed site
   with the same defect; anything short of a fix at the cause that reaches them all is a `patch`, and its commit is
   refused. With no listed site left, a fix at the cause is complete. Only the user overrides a bug, by typing the
   `override shim-<id>` that each refusal names. The full rules are in `specs/006-shim-check-gate/`, amended by
   `specs/011-shim-no-site-left/`.
   A commit whose code is all in test files skips this check (`specs/012-tests-only-tree/`).

## How an agent uses it

```
Workflow(name='alq-review:review-round', args={worktree: '/abs/checkout'})                  # internal review
Workflow(name='alq-review:review-round', args={worktree: '/abs/checkout', stage: 'audit'})  # anti-pattern audit
Workflow(name='alq-review:assess-round', args={worktree: '/abs/checkout'})                  # after the poller reports findings
Workflow(name='alq-review:claim-check', args={worktree: '/abs/checkout'})                   # before git commit
Workflow(name='alq-review:claim-check', args={worktree: '/abs/checkout', contests: [{claim: 'claim-<id>', evidence: 'path:line'}]})
Workflow(name='alq-review:shim-check', args={worktree: '/abs/checkout'})                    # before git commit
Workflow(name='alq-review:shim-check', args={worktree: '/abs/checkout', contests: [{site: '<id>', reason: '<why>'}]})
```

Agents do not need to be told any of this: every refusal names the next legal step.

## Mode

`config.json` holds `{"mode": "log"}` or `{"mode": "enforce"}`; `ALQ_REVIEW_MODE` overrides it.
In `log` mode nothing is blocked; each refusal is written as `would_deny` to `gate.log` so the rules
can be checked against real sessions before they can stall one.

The spec-folder checks (6) have their own `spec_checks` setting, overridden by `ALQ_REVIEW_SPEC_CHECKS`.
It ships `enforce`; the checks refuse only when both settings enforce.

The claim check (7) has its own `claim_checks` setting, overridden by `ALQ_REVIEW_CLAIM_CHECKS`, and refuses
only when both settings enforce. `claim_warn_over` (20) is the number of judged claims above which the
workflow's result suggests splitting the change.

The shim check (8) has its own `shim_checks` setting, overridden by `ALQ_REVIEW_SHIM_CHECKS`; when either it or the
plugin's mode is `log`, a commit the check would refuse is only recorded. Jev is reached through OpenRouter with the
key in `~/.config/openrouter/key` (`JEV_KEY_FILE` overrides it); when Jev cannot answer, the check is recorded as
failed, and a failed check refuses the commit as a patch does.

## State

`${ALQ_REVIEW_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/alq-review}`

- `ledger.db` - one SQLite file, WAL mode, every write inside a `BEGIN IMMEDIATE` transaction so
  concurrent writers take turns on it instead of losing each other's update the way a bare JSON file or a
  stale flock would:
  - `ledgers (repo, pr) -> doc` - one row per PR: its rounds, findings, assessments, epoch and unlocks
  - `open_prs (repo, branch, head) -> pr` - a cache of GitHub's answer to "which PR is open on this branch",
    kept per commit so a new commit asks again; "none" is never kept, since opening a PR does not move the branch
  - `claim_checks (repo, tree)`, `claim_reads (repo, patch_id)`, `claim_verdicts (repo, claim_id)`,
    `claim_holds (repo, base, file)` - the claim checks, keyed by repo, git's own fingerprints and the claim id, since a commit has no PR
  - `shim_checks (repo, tree)`, `shim_chains (repo, id)`, `shim_rulings (repo, chain, site)` - the shim checks, the
    chains of fixes of one bug, and the rulings on contested sites
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
| `scripts/settled_design.py` | the settled-design check over one spec folder or a branch |
| `scripts/config.py` | reads `config.json` |
| `scripts/claimcheck.py` | the claim check's rules - pure functions of a check, its holds and git's answers |
| `scripts/claimgate.py` | the claim check's hook handlers |
| `scripts/shimcheck.py` | the shim check's rules - pure functions of a check and its chains |
| `scripts/shimgate.py` | the shim check's hook handlers |
| `scripts/jev.py` | the Jev questions the shim check asks |
| `scripts/snapshot.py`, `scripts/sweeper_read.py` | the `HEAD` copy a sweeper reads, and the hook keeping it there |
| `scripts/hookio.py` | settings, refusals, `gate.log` and session state, shared by the handlers |
| `scripts/gate.py` | hook entrypoint |
| `scripts/pre_merge_gate.py` | a merge or ready needs the internal-review attestation on the head, or the org gate's version-only release; an admin merge needs the user's `override-merge #N` |
| `skills/` | `alq-shape`, `alq-issue-tackle`, `alq-root-cause-check`, `alq-github-pr-review`, `design-doc` |
| `speckit/` | the settled-design preset and design-doc workflow, installed into the project by each `design-doc` start |
| `workflows/` | orchestration only; everything else is injected by the hook |
| `agents/assessor.md` | the assessor |
| `agents/claim-*.md` | the claim reader, judge and contest judge |

Tests: `python3 -m unittest` in each `tests/` folder. The design-doc driver and plan-template tests need Spec Kit (CI pins `specify-cli==1.0.7`, the workflow's minimum);
`tests/test_shell.py` reads the org's `.github` repo checked out as `analitiq-org-github` beside this repo.

Depends on the `pr-review-toolkit` and `alq-anti-pattern` plugins for the reviewer agents.
