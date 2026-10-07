# Quickstart: validate the shim check

Run from `.claude/plugins/alq-review/` in the feature worktree. Shapes are in [data-model.md](data-model.md) and
[contracts/shim-check.md](contracts/shim-check.md).

## 1. Unit and gate tests (no model, no network)

```bash
python3 -m unittest discover -s tests
```

Expected: `test_shimcheck.py` (verdict rule, site ids, sweep validation, chain matching, commit decision) and the
shim cases in `test_gate.py` pass. Gate tests drive `scripts/gate.py` with hook payloads and recorded agent
outputs; Jev is replaced through `JEV_ENDPOINT` pointing at a local stub.

## 2. One-sibling fix is refused (US1, live)

The sweeper's transcript shows only Read, Glob and Grep calls under `<main checkout>/.claude/worktrees/shim-<12 hex>/`,
and no permission prompt in a headless run started inside the worktree; the worktree's `git status` and
`ls -a` do not show it; it is gone after the verdict.

1. In a scratch GitHub-origin repo, commit two functions with the same unchecked input.
2. Fix one, `git add`, run `git commit` → refused: claim check first, then shim check.
3. Run both workflows, commit again → refused as `patch`, coverage `edited_only`, the other function listed.
4. Fix the second, stage, rerun both, commit → allowed.

## 3. Contest (US2, live)

From step 2.3, contest the listed site with `args.contests` → the site judge rules; with `not_shared` the re-judge
needs no sweep and the commit is allowed; contesting the same site again is refused at launch.

## 4. Chain, deep sweep and override (US3, gate test with recorded outputs)

Feed four recorded sweep outputs that each list one new site, with a commit of an unrelated file landing after
the first → refusals 1–3, the third naming
the deep sweep; the deep launch runs three agents; one more `patch` → held, and a launch is refused too; a user prompt `override shim-<id>` →
that tree commits, and so does a re-staged tree of the same bug, with no launch; a tree of an unrelated bug is
still refused; after the commit lands, a new tree of that bug is checked again: a `patch` is held at once, a `complete` ends the bug. Override a `not checked` refusal
by its tree id → that tree commits, and the bug goes on from count 0. `gate.log` holds a `shim-miss` per newly listed site and one `shim-override`.
A `patch` refusal gives, per listed site, the staged-tree line ranges of the hunks in its file.

## 5. Restart a stopped check

Stop a workflow mid-sweep, relaunch → it sweeps again. Kill the recording hook before Jev answers (stub endpoint
that hangs), relaunch → Jev only, no sweep, chain count unchanged.

## 6. Reuse per tree (US4)

Retry `git commit` on a checked tree → no launch needed; change one line → refused, naming the launch.

## 7. Replay (SC-001, live Jev)

```bash
python3 tests/replay_shim.py   # recorded diffs + sweeps of the design's evidence table, in tests/fixtures/shim-replay/
```

Expected: `complete` for 6aa17485, 29ade9e4, 053e0ec9; `patch` for the 8 patches and bf12120a. 49320e88 comes out
`complete` (the known sweep miss).

## 8. Settings

`ALQ_REVIEW_SHIM_CHECKS=log` → a `patch` commit goes through and `gate.log` has `would_deny`.

## 9. Before release on the bot

On the bot, before the version that turns the check on is installed: the key file is readable and one Jev `kind`
call returns an answer. If not, do not bump.
