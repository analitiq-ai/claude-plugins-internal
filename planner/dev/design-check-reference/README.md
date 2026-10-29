# Design-check reference model

This folder is the regression fixture for issue #143 (planner: design-check). It holds the model, the
runner scripts, the trust matrix and the expected outputs from a design check of the Codeworks design,
run on 2026-10-20. The design-check skill must reproduce the 9 known gaps, the 10 new violations and the
clean fix set listed below.

It lives outside `planner/plugin/`, so it does not ship with the plugin.

## Files

| Path | What it is |
|---|---|
| `codeworks_model.py` | Explicit-state model of the Codeworks state machine, checked by exhaustive breadth-first search. Python standard library only. Its docstring lists the abstractions. |
| `runsuite.sh` | Runs every scenario in the model's `SUITE`, three at a time. |
| `ablate.sh` | Runs "all fixes minus X" for every fix X, on the scenario that exercises X. |
| `trust-matrix.md` | The trust matrix: every piece of state × every actor × every write channel, with root causes and fixes. |
| `expected/as-written/` | One output per scenario with no fix applied: the gaps in the design as written. |
| `expected/all-fixes/` | The same scenarios with every fix applied: all clean. |
| `expected/ablation/` | "All fixes minus X" outputs, plus the extra runs listed under "Other runs". |

The model and the matrix cite the Codeworks design text of 2026-10-20 by line ("design l.N"), and the
decision records on the codeworks-layout branch (PR #142) by number ("reviewer 0020 d2"). That design text
is not in this folder.

## Scenarios

A scenario is a variant plus budgets, written `variant[budgets]`. An output file is named
`<variant>_<budgets>.txt`, with `=` and `,` turned into `_`.

- Variants: `one` (one story, no parent), `two` (two stories under a parent, the second blocked by the
  first), `new` (a new spec: planner is running and nothing has landed).
- Budgets cap disruptive events, 0 by default: `dis` (disruptive human act), `outs` (outsider thread),
  `crash` (orchestrator crash), `resc` (rescope), `ext` (extra external finding), `reo` (issue reopen),
  `h6` (a rescope that adds a parent and a story).

## What a run reproduces

### The 9 known gaps (design as written)

| Fix | Gap | Violation key in the output | Scenarios |
|---|---|---|---|
| K1 | The held-branch watch puts back the merge of main under a rescope hold. | `hold rsc-s0 has no reachable release: K1 …`, `progress s0: K1 …` | `one[resc=1]`, `one[resc=1,h6=1]` |
| K12 | An exempt story PR has no defined action (with `--literal-grid`: launch → REPEAT → Blocked). | `progress s0: K12 …`, `undefined_cell: … exempt=True …` | `one[dis=1]` |
| S3 | The escalation question (or a pushback or rescope reason) is never posted when another cause moves the card first. | `silent stall …: S3 …` | all |
| S4 | REPEAT blocks a clean relaunch at an unchanged head. | `spurious_blocked: S4 …`, `repeat_on_finished_head` | all |
| S5 | A crash between the reason post and the lane write loses the Blocked move. | `blocked_move_lost`, `… S5 launch already HANDLED …` | `two[crash=1]` |
| S9 | In review with a Codex failure and no findings stalls. | `progress …: S9 …`, `silent stall …: S9 …` | all |
| T9 | Reviewer refuses planner's spec commit, so the spec PR never opens. | `planner_commit_refused`, `progress planner: spec PR never opens` | `new[]`, `one[resc=1]`, `one[resc=1,h6=1]` |
| L4 | A Ready story launches during a rescope run. | `launch_during_rescope_run`, `merge_during_rescope`, `merge_outdated_spec` | `one[resc=1]`, `one[resc=1,h6=1]` |
| L6 | A reopened merged story freezes its blockedBy chain. | `progress s1: L6 …`, `progress parent: L6 …` | `two[reo=1]` |

### The 10 new violations (design as written)

| Fix | Violation | Violation key in the output | Scenarios |
|---|---|---|---|
| WV | A WAIVED Codex verdict counts as a pass, so a PR merges with no Codex review at the head. | `merge_codex_waived` | all |
| SIL | Codex is declared silent before the orchestrator asked it to review. | `silent_unrequested` | `one[dis=1]` |
| GHR | The GitHub round cap never bounds anything: a clean round or CONVERGED_PUSHBACK resets it. | `unbounded automated launch loop: CI failure / github round FIX / internal round CLEAN / launch` (and the `… audit …` loop) | all |
| LB | Nothing bounds relaunches that push but never attest. | `unbounded automated launch loop: internal round FIX / launch` | all |
| LOCK | A human runs issue-tackle beside a running launch: two sessions on one story. | `two_sessions` | `one[dis=1]` |
| SC | Deleting the newest state comment releases a hold. | `hold_released_by_non_owner` | `one[dis=1]` |
| PLW | Planner places the rescope hold while a builder session still runs. | `two_state_writers` | `one[resc=1]` |
| UNL | An unlock writes the state comment while planner runs on the same spec. | `two_state_writers` (unlock) | `one[resc=1]` with `--rescope-held` |
| OUT | An outsider's review thread buys a builder launch. | `outsider_launch` | `two[ext=1,outs=1]` |
| (S5) | A human drags a Blocked card with a handled no-PR launch back to a working lane: no cell applies. Fixed by S5. | `undefined_cell: InProgress x none …`, `undefined_cell: InReview x none …` | `one[dis=1]` |

### The clean fix set

`--fix all` applies all 20 fix switches in `ALL_FIXES`: the 9 known-gap fixes, the 9 named fixes above,
T7 and S2. T7 is needed only once K12 is applied: without it, a head pushed after the exempt label merges
unreviewed (`merge_exempt_label_predates_head`).

With every fix on, every scenario reports `total distinct: 0`: the 8 suite scenarios, the literal grid,
`two[resc=1]` and `one[resc=1]` with `--rescope-held`.

Ablation: removing any one fix brings back its violation, with three exceptions. S2 is covered by L4 and
PLW. S3 is covered by S5, which re-posts every missing reason from the Blocked lane on each tick. UNL shows
only with `--rescope-held` (`one_resc_held_minus_UNL.txt`).

## How to run

The model needs only Python 3. The scripts also need bash, xargs and timeout. Run the commands from any
directory.

One scenario:

```sh
python3 codeworks_model.py --variant one --budget dis=1             # design as written
python3 codeworks_model.py --variant one --budget dis=1 --fix all   # every fix on
python3 codeworks_model.py --variant one --budget dis=1 --fix K1,S3 # some fixes on
python3 codeworks_model.py --notes                                  # design/record disagreements
```

Other flags: `--literal-grid` models the design's grid where a record disagrees (exempt PRs),
`--rescope-held` lets a rescope start while a story holds a hold, and `--limit` caps the state count
(the scripts pass 7,000,000).

The suite, as written and with every fix on:

```sh
./runsuite.sh <outdir>
./runsuite.sh <outdir> --fix all
```

The ablation:

```sh
./ablate.sh <outdir>
```

The full suite is slow. On 2026-10-20 it took about 3.7 hours and up to about 10 GB of memory per
scenario. Each scenario has a 90-minute timeout in `runsuite.sh`, and 60 minutes in `ablate.sh`.

### Other runs

These outputs are not made by the scripts. `<all but X>` is the comma list of every `ALL_FIXES` id except X.

| Output | Command |
|---|---|
| `expected/as-written/one_dis_1_literal.txt` | `python3 codeworks_model.py --variant one --budget dis=1 --literal-grid --limit 7000000` |
| `expected/all-fixes/one_dis_1_literal.txt` | the same with `--fix all` |
| `expected/ablation/two_resc_all.txt` | `python3 codeworks_model.py --variant two --budget resc=1 --fix all --limit 7000000` |
| `expected/ablation/two_resc_minus_S2.txt` | the same with `--fix <all but S2>` |
| `expected/ablation/one_resc_held_all.txt` | `python3 codeworks_model.py --variant one --budget resc=1 --rescope-held --fix all --limit 7000000` |
| `expected/ablation/one_resc_held_minus_UNL.txt` | the same with `--fix <all but UNL>` |

## Known drift

The model was last edited after some outputs were written. On 2026-10-29 a fresh run of "all fixes minus
S4" reported `repeat_on_finished_head` (gap S4) where the saved file had none, so
`expected/ablation/minus_S4.txt` was replaced with the fresh output. Saved no-fix outputs can lack the same
key. Fresh runs matched the saved files for `all-fixes/` `two[]`, `two[reo=1]` and `new[]`, and for the
ablation of S3, S9, T9, L6, SIL, GHR, LB and WV. The longer runs were not repeated; a full re-run of both
scripts would refresh them.

## Trust matrix sources

The matrix was checked against these GitHub docs, read on 2026-10-20, and against the Claude Code docs
listed under its Citations:

- https://docs.github.com/en/apps/creating-github-apps/authenticating-with-a-github-app/managing-private-keys-for-github-apps
- https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/choosing-permissions-for-a-github-app
- https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens
- https://docs.github.com/en/communities/moderating-comments-and-conversations/managing-disruptive-comments
- https://docs.github.com/en/organizations/managing-programmatic-access-to-your-organization/setting-a-personal-access-token-policy-for-your-organization
- https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/collaborating-on-repositories-with-code-quality-features/about-status-checks
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/available-rules-for-rulesets
- https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-rulesets/creating-rulesets-for-a-repository
- https://docs.github.com/en/rest/apps/apps
- https://docs.github.com/en/rest/authentication/permissions-required-for-fine-grained-personal-access-tokens
- https://docs.github.com/en/rest/authentication/permissions-required-for-github-apps
- https://docs.github.com/en/rest/checks/runs
- https://docs.github.com/en/rest/commits/statuses
- https://docs.github.com/en/rest/orgs/rules
- https://docs.github.com/en/rest/projects/items
- https://docs.github.com/en/rest/repos/rules
