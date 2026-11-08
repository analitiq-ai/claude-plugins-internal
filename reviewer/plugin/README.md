# reviewer

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
   `ESCALATE` hand the branch to the user, as does a changed `spec.md` (5): it stays locked until the user
   starts a prompt with `unlock #<pr>` (or `unlock <branch>`, or `unlock <owner>/<repo>#<pr>` when two repos
   share the number), and the refusal tells the agent to ask for exactly that. One unlock releases every hold
   on the branch, so the refusal names each hold and the question it asks. A spec edit does not release it:
   the agent can make one. An unlock that releases a `RESHAPE_SPEC` lock replies with the ruling, since nothing
   else hands it on: the open decision, its rationale, the `spec_gap` findings and the PR's spec folder. On a PR
   bound to `spec: null` it says instead to close the PR and restart the work on a new PR bound to a spec that
   settles the decision. On a PR bound to a spec folder, the ruling also tells the spec's issue, the number the
   folder's name starts with (`<issue>-<name>`): the gate posts one comment naming the PR and round with that
   ruling, then makes one edit adding the `reshape_spec` label and the `escalate_to` assignee. Each call is tried
   once; one that fails is named, with GitHub's error, in the lock's refusal and in the unlock's reply, to be done
   by hand. The gate never creates the label, and never removes it or the assignee. While a branch is held, every Bash command of the session that launched its round is checked
   against the branch's tip and, while its checkout has the branch checked out, every tracked and untracked
   change there, as they stood before the command. A file written or a commit made by any route is caught
   and the agent told to put it back, even if the command then leaves the branch; checking another branch
   out is not a move. If that checkout cannot be read — its `.git` is gone, corrupted, or the directory
   itself was removed — the command is not blocked on it; reviewer reports `cannot verify <root>` and
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
   unchanged commit is refused.
   Every review-round launch, audits included, names in `args.spec` the spec its PR is reviewed against: a
   spec folder's path from the repo root, or `null` for a change that needs no spec. The launch is refused,
   with the call to make, when `spec` is missing or is neither `null` nor a non-empty string. A folder is
   refused, naming the step, when its path is absolute, has a `..` segment, is not in a folder named
   `specs` or is not written the one way git names it (`shape`), or when its `spec.md` is missing or empty at the commit the round reviews, or git
   cannot read it there (`spec.md`). The gate reads nothing else in the folder. The first round that opens
   binds the PR to that value and, for a folder, to the blob id of its `spec.md`; the value never changes,
   and a launch that names another is refused with both. Each internal reviewer is told to read the bound
   folder's `spec.md`: every requirement it states that the change does not meet is a finding, and what it
   excludes bounds what may be asked for. The assessor's brief names the same folder. Under `null`, reviewers
   are told the change needs no spec and to raise no finding about an unmet requirement of one. Audit
   reviewers are not given the spec. When `spec.md` at the commit of a review-round or assess-round launch is
   not the bound text, the launch is refused with the `git diff` from the bound blob to that one (git's error
   in its place when it cannot make the diff), and the PR is held as a `RESHAPE_SPEC`
   ruling holds it (2); each launch while it is held is refused with the diff again. After the user's
   `unlock`, the next review-round or assess-round launch that gets through binds `spec.md` as it then is. Any
   launch whose spec check passes clears the hold, so a later change, a re-scope's included, is held again.
6. **Claims are checked before they are committed.** Every `git commit` an agent runs, with or without a PR,
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
   rejects it, and a rejection counts as a refusal. A claim is counted as one lineage that follows its words from
   edit to edit, whatever else is committed in between: the staged file is diffed against the text the last
   completed check saw (`diff-match-patch` inside a rewritten range, a shift outside it), and a lineage ends
   when its last words are ruled `CORRECT`, deleted or merged into another lineage's, or when the staged tree no longer
   has its file and the disk has none either (a file only unstaged keeps its count). At 3 `WRONG` rulings the agent must stop
   and ask the user, who lets the words stand by typing `unlock claim-<id>`; one more `WRONG` ruling holds it again.
   What the repo's own commit hook changes during the commit is cosmetic and is not checked again.
7. **A fix reaches every site of its bug before it is committed.** A `git commit` that stages code is also refused
   until the `shim-check` workflow has checked that staged tree, or the user has overridden its bug; each refusal
   names the next step. Jev answers whether the change fixes a defect. For a fix, sweepers list the sites doing the
   same operation and the callers, reading a copy of `HEAD` in `<main checkout>/.claude/worktrees/`, which the
   repo's `.gitignore` should list. Jev then answers where the fix acts and whether it reaches every listed site
   with the same defect; anything short of a fix at the cause that reaches them all is a `patch`, and its commit is
   refused. With no listed site left, a fix at the cause is complete. Only the user overrides a bug, by typing the
   `override shim-<id>` that this check's refusal of a commit names, except the refusal that says to run
   `git commit` alone. An overridden bug lets the commit through only after the claim check has labelled every
   staged hunk. A bug belongs to its branch, not to a `HEAD`: its line ranges are carried from commit to commit
   by the same diff that follows a claim's words, bugs that one staged change reaches become one at the higher
   count, a bug whose lines are all deleted or whose file left both HEAD and the disk ends, and an override lasts until a commit changes the bug's code. The
   deep sweep comes at a count of 3: two of the usual sweeps and one that searches from the callers, their lists
   merged, and the next check of that bug is judged against the merged lists with no new sweep. The hold comes at 4.
   A refusal lists, per site, the lines the staged change alters in its file. The author may contest a listed site;
   a judge rules it `shares` (it stays), `not_shared` (it is dropped) or `deferred` to an open issue of the repo,
   which keeps it dropped only while that issue is open. A change Jev does not call a fix passes unswept. A check is
   kept against its staged tree: one that reached a verdict, `complete` or `patch`, is not run again at the same
   `HEAD` unless a bug the change reaches is due a deep sweep, and one at the same `HEAD` that stopped after its
   sweeps recorded their lists is judged again without new sweeps. `gate.log` records each check of code with its
   verdict, or that it failed, Jev's answers, how many listed sites the rulings left and what it cost (agents,
   seconds, Jev's price); for a `patch` or deep check it also records each site the check lists that an earlier
   check of the same bug left out.
   A commit whose code is all in test files skips this check (`specs/012-tests-only-tree/`).
8. **An internal round is checked against the decisions that govern its change.** At launch, the gate asks adrkit's
   `adr check` which accepted decision records (ADRs) govern the files of the round's own diff range: the whole
   change for a full round, what the branch changed since the last round for a delta, less what it merged from
   the branch it merges into. It asks once per corpus, all at once: every tracked `docs/adr` folder of the repo, and
   the org's at `REVIEWER_ORG_ADR_DIR` when it is set; a folder reached both ways is checked once, as the org's.
   When a record governs the change, `reviewer:decision-reviewer` joins the round, briefed with each record by its
   corpus and id, and the round waits for it like any reviewer; its findings are assessed with the others, and the
   rulings on them are written to `gate.log` as a `decision-review` line. A matcher adrkit cannot evaluate in one
   repo (a `package` or `entity` matcher, or one qualified with a repo)
   is a notice, and the round runs; every other adrkit finding is ignored. The launch is refused when a round reviews
   more than `max_review_files` files, when a corpus cannot be checked (`adr` missing or not the version below, its
   answer unreadable, a call past the hook's deadline, a capped marker scan, an `REVIEWER_ORG_ADR_DIR` that is no
   absolute readable folder), and when the change touches a record `adr check` fails on; each refusal names the
   corpus and a fix that works there. The round's result carries a `decisions` block: the corpora checked, the
   records that govern, the notices, the broken records and corpora not checked when their refusal did not block,
   and the org corpus or `unset`. Audit rounds run no decision check.
9. **A story branch never changes a spec.md.** On a story branch (`<issue>-us<n>-<slug>`), `Edit`, `Write` and
   `NotebookEdit` of a spec folder's `spec.md` are refused, read from the branch and the path alone, with or without
   a PR. The next step: stop and raise the spec problem to the user, who lands it in a spec-only PR on
   `<issue>-spec`; once it merges, the story branch merges the default branch. The folder's other files stay
   editable, so a story PR ticks its tasks.
   Decided otherwise by root ADR-0012 and reviewer ADR-0023 (#342): `spec.md`'s intent sections, `adr-rulings.json` and
   the `codeworks` front matter admit no change on a story branch; its design sections, the other spec files and the
   records change on the story branch in `spec:` commits, `tasks.md` only inside the story's own block, a tick in any
   commit; this
   refusal, the spec binding of (5) and the decision check of (8) follow those records once their gates land
   (`reviewer/docs/adr/0023-grade-a-story-against-its-frozen-intent-tagged-acceptance-tests-spec-commits-the.md`, action items).

## How an agent uses it

```
Workflow(name='reviewer:review-round', args={worktree: '/abs/checkout', spec: '<spec folder>'})                  # internal review
Workflow(name='reviewer:review-round', args={worktree: '/abs/checkout', spec: null})                             # internal review, no spec
Workflow(name='reviewer:review-round', args={worktree: '/abs/checkout', stage: 'audit', spec: '<spec folder>'})  # anti-pattern audit
Workflow(name='reviewer:assess-round', args={worktree: '/abs/checkout'})                                         # after the poller reports findings
Workflow(name='reviewer:claim-check', args={worktree: '/abs/checkout'})                                          # before git commit
Workflow(name='reviewer:claim-check', args={worktree: '/abs/checkout', contests: [{claim: 'claim-<id>', evidence: 'path:line'}]})
Workflow(name='reviewer:shim-check', args={worktree: '/abs/checkout'})                                           # before git commit
Workflow(name='reviewer:shim-check', args={worktree: '/abs/checkout', contests: [{site: '<id>', reason: '<why>'}]})
```

Agents do not need to be told any of this: every refusal names the next legal step.

## Mode

`config.json` holds `{"mode": "log"}` or `{"mode": "enforce"}`; `REVIEWER_MODE` overrides it.
It ships `enforce`, as does each check's own setting below.
In `log` mode a refusal made through `hookio.refuse` does not block; it is written as `would_deny` to `gate.log`.
The edit rule (9) is made that way. So are the refusals of a launch's `spec` (5): in `log` mode the round opens, a refused first launch
binds nothing, and a changed `spec.md` holds nothing, leaves the binding as it was and does not release a hold
recorded before.
A workflow launched without `args.worktree`, a review or assess launch whose round cannot open (no open PR, a
review base that cannot be read, no round awaiting assessment), an agent's rejected output, a shim sweeper's read
outside its snapshot and `scripts/pre_merge_gate.py` refuse in either mode.

The claim check (6) has its own `claim_checks` setting, overridden by `REVIEWER_CLAIM_CHECKS`, and refuses
only when both settings enforce. `claim_warn_over` (20) is the number of judged claims above which the
workflow's result suggests splitting the change.

The decision check (8) has its own `decision_checks` setting, overridden by `REVIEWER_DECISION_CHECKS`. A
corpus that could not be checked refuses whenever it enforces, in either plugin mode; a broken record refuses only
when both settings enforce; at `log`, each is a `would_deny` and the round opens on what was read.
`max_review_files` (50) is the most files an internal round may review; past it the launch is refused before any
adrkit call, following the plugin's mode.

`escalate_to` names the GitHub account a `RESHAPE_SPEC` ruling assigns the spec's issue to. It has no default: a
missing or blank one fails that edit, and the lock names the failure.

The shim check (7) has its own `shim_checks` setting, overridden by `REVIEWER_SHIM_CHECKS`; when either it or the
plugin's mode is `log`, a commit the check would refuse is only recorded. Jev is reached through OpenRouter with the
key in `~/.config/openrouter/key` (`JEV_KEY_FILE` overrides it); when Jev cannot answer, the check is recorded as
failed, and a failed check refuses the commit as a patch does.

The numbers the decision records leave to reviewer's settings default to: 4 github rounds before the audit
stage; a claim hold at 3 `WRONG` rulings on one lineage; a shim hold at a bug's count of 4; an audit hold
after 2 escalation audits not ruled `CONVERGED_PUSHBACK`, whose release grants 2 more.

The shim check's Jev call is the only model call made inside a hook. Its questions are kept word for word as
they were replayed over recorded commits: a change to their wording, or to the request's shape, needs a new
replay first.

## What the user types

`unlock`, `override`, `override-merge` and the switch are read from a prompt's first words, by
one reader. A space, a tab or a line break parts two words, and nothing else does. A word is read whole:
`unlock #7.` names no PR, since `#7.` is not a number. A PR's name is `owner/repo#N`, in ASCII, its number
without a leading zero; capitals in it do not matter.

## Switch

A prompt that starts with `reviewer off` switches the plugin off for the session it was typed in, and
`reviewer on` switches it on again. Anything else after `reviewer` on that line changes nothing and is
answered with the two forms. The switch covers that session, its subagents and workflows
included, and ends with it; no other session is affected.

Off lifts every rule: the commit checks, the order of the stages, locked branches, the attestation, and the
ready and merge rules, `--admin` and `gh api` merges included. Nothing is released: locks, counts, holds and
overrides stay recorded and apply again when it is on.

Still running while off: `unlock`, `override` and `override-merge`; the count of reviewers already running;
and the confinement of the plugin's own agents. A launch of `review-round`, `assess-round`, `claim-check` or
`shim-check` while off is refused, in `log` mode too, with `reviewer on` as the keyword that turns it on,
and the agent is told to carry on without it.

Off differs from `log`: in `log` the rules still run, as Mode describes; off, the rules listed above do not.

A resumed session is told it is off. A switch file that cannot be opened, or is not one the plugin wrote, counts as on and is reported.

## State

The plugin writes in two places:

| Place | Files |
|---|---|
| The state folder, `${REVIEWER_STATE_DIR:-${XDG_STATE_HOME:-~/.local/state}/codeworks/reviewer}` | `ledger.db`<br>`inbox/<owner>__<repo>__<pr>.json`<br>`sessions/<session id>.json`, `.held.json`, `.fetch.json`, `.merge.json`, each with a `.lock` beside it<br>`sessions/<session id>.off.json`<br>`gate.log`<br>`errors.log` |
| `<main checkout>/.claude/worktrees/` | `shim-<12 hex>/`, the copy of `HEAD` a shim sweeper reads |

In the state folder:

- `ledger.db` - one SQLite file, WAL mode, every write inside a `BEGIN IMMEDIATE` transaction so
  concurrent writers take turns on it:
  - `ledgers (repo, pr) -> doc` - one row per PR: its rounds, findings, assessments, epoch and unlocks, and its
    spec binding: `spec`, the spec folder or `null`; `spec_blob`, the blob id of the bound `spec.md` (`null` with
    no spec); and `spec_held`, the `bound` and `head` blob ids and the `at` stamp of the hold a changed `spec.md`
    put on the PR, until a review-round or assess-round launch whose spec check passes
  - `open_prs (repo, branch, head) -> pr` - a cache of GitHub's answer to "which PR is open on this branch",
    kept per commit so a new commit asks again; "none" is never kept, since opening a PR does not move the branch
  - `claim_checks (repo, tree)`, `claim_reads (repo, patch_id)`, `claim_verdicts (repo, claim_id)`,
    `claim_lineages (repo, branch, id, opened)` - the claim checks, keyed by repo, git's own fingerprints and the
    claim id, and each claim's lineage, kept per branch since a commit has no PR
  - `shim_checks (repo, tree)`, `shim_bugs (repo, id)`, `shim_rulings (repo, chain, site)` - the shim checks, the
    bugs (the fixes of one defect) with their line ranges, and the rulings on contested sites
  - `seen_files (repo, branch, gate, file)` - each file's text as the last completed check saw it, which the
    lineages and the bug ranges of that file are measured in. Rows of the old `claim_holds` and `shim_chains`
    tables stay in a store that has them; nothing reads them
- `inbox/<owner>__<repo>__<pr>.json` - written by `github-pr-review/poll-pr-review.sh` on CLEAN and
  FINDINGS; stored under its PR once per hook event, before anything is judged (`test_poller_contract.py` pins the two ends together)
- `sessions/<session id>.off.json` - present while the user has the plugin switched off in that session
- `sessions/<session id>.merge.json` - the merge overrides the user typed in that session and no merge has used, one `owner/repo#N` per PR
- `gate.log`, `errors.log` - every refusal and recording; every gate failure (a crash refuses the call it was deciding wherever the settings let the gate refuse it, so a round's launch and an output the gate checks in log mode too, and fails open everywhere else, loudly)

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
| `scripts/reshape.py` | a `RESHAPE_SPEC` ruling's summary, the notice it owes the spec's issue, and what is said when that notice failed - pure |
| `scripts/specbinding.py` | what a spec folder, a spec.md and a story branch are; the review-round `spec` argument: what it says, whether its folder has a spec folder's shape, whether it matches the PR's binding, and what a changed `spec.md` does to that binding; the edit rule's refusal (9) |
| `scripts/config.py` | reads `config.json` |
| `scripts/codexstate.py` | Codex's state for a review round, read from its status card and its known comment forms - a pure function the poller calls |
| `scripts/claimcheck.py` | the claim check's rules - pure functions of a check, its lineages and git's answers |
| `scripts/lineage.py` | where a piece of text is after an edit: the mapping both checks use to carry a claim or a bug across versions |
| `scripts/claimgate.py` | the claim check's hook handlers |
| `scripts/shimcheck.py` | the shim check's rules - pure functions of a check and its bugs |
| `scripts/shimgate.py` | the shim check's hook handlers |
| `scripts/jev.py` | the Jev questions the shim check asks |
| `scripts/snapshot.py`, `scripts/sweeper_read.py` | the `HEAD` copy a sweeper reads, and the hook keeping it there |
| `scripts/adrkit.py` | the decision check's corpora and every call to `adr` |
| `scripts/decisions.py` | the decision check's rules - pure functions of adrkit's answers |
| `scripts/hookio.py` | settings, refusals, `gate.log`, session state and the switch, shared by the handlers |
| `scripts/gate.py` | hook entrypoint |
| `scripts/pre_merge_gate.py` | a merge or ready needs the internal-review attestation on the head, or the org gate's version-only release; an admin merge needs the user's `override-merge owner/repo#N` |
| `skills/` | `github-pr-review` |
| `workflows/` | orchestration only; everything else is injected by the hook |
| `agents/assessor.md` | the assessor |
| `agents/claim-*.md` | the claim reader, judge and contest judge |
| `agents/decision-reviewer.md` | the decision reviewer |

Tests: `python3 -m unittest` in this repo's `reviewer/tests/`, which an install does not copy.
`test_shell.py` reads the org's `.github` repo checked out as `analitiq-org-github` beside this repo.

Depends on the `pr-review-toolkit` and `auditor` plugins for the reviewer agents.

## Dependencies

A Python script that a hook runs imports only the standard library and the plugin's own files, with one
exception: `diff-match-patch`, which the claim check and the shim check need to follow words and lines across
edits. Installing the plugin copies files and installs no package, so install it for the interpreter that runs the
hooks (`python3 -m pip install diff-match-patch`; on a Debian or Ubuntu system Python without a virtual environment,
`sudo apt install python3-diff-match-patch`). Without it both checks refuse a launch and a commit as a check that
could not run, and the refusal names this step. Any other import fails on a machine that lacks it.

The decision check (8) runs adrkit's command `adr`, version 0.20.0, on the machine that launches rounds: node 22 or
later, then `npm install -g @adrkit/cli@0.20.0`. It is needed only when the repo has a tracked `docs/adr` or
`REVIEWER_ORG_ADR_DIR` is set; without it, or at another version, the launch is refused as a check that could not run,
and the refusal names this step.
