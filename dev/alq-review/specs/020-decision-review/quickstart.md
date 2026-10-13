# Quickstart: validate the decision check

Prerequisites: Python 3.13, git, node ≥ 22, `pip install diff-match-patch==20241021`,
the install command `decisions.INSTALL` (then `adr --version` prints `decisions.ADRKIT_VERSION`), as in CI after R12.

## Suite

```bash
cd dev/alq-review/tests && python -m unittest -v
```

Expected: green, with no `skipped` line for `test_decisions.Contract`, `test_adrkit` or `test_gate.DecisionReview`
(each skips only when `adr` is absent). The scenario table in [contracts/interfaces.md](contracts/interfaces.md) names
the test for each spec scenario.

## By hand, in this repo

ADR-0018 governs `plugins/alq-review/scripts/gate.py`, so a branch that changes it is a governed change.

1. On a draft PR's worktree whose diff touches `gate.py`, with `ALQ_ORG_ADR_DIR` unset, launch
   `Workflow(name='alq-review:review-round', args={worktree: '<abs>', spec: 'dev/alq-review/specs/020-decision-review'})`.
   Expected: the round opens; the last reviewer of the wave is `alq-review:decision-reviewer` and its prompt lists
   `dev/alq-review/docs/adr 0018 "Release a RESHAPE_SPEC lock only by unlock"`; the result's `decisions` has
   `corpora` = the three `dev/*/docs/adr`, `governing` = that record, `org_corpus: "unset"`.
2. `gh pr ready` before the decision reviewer reports: refused (the round is collecting).
3. Set `ALQ_ORG_ADR_DIR=/abs/path/to/engineering/docs/adr` and launch on a new commit. Expected: `corpora` gains
   `org (/abs/path/to/engineering/docs/adr)`; an org record whose matcher covers a changed file is in `governing`.
4. Set `ALQ_ORG_ADR_DIR=/nowhere` and launch. Expected: refused, naming `/nowhere`, next step to point the variable at
   the org's `docs/adr` or unset it; `python3 scripts/ledger.py status --worktree <abs>` shows no new round.
5. Hide `adr` (`PATH` without it) and launch. Expected: refused with `decisions.INSTALL`.
6. Commit a record `dev/alq-review/docs/adr/0099-broken.md` with `status: accepted` and `deciders: 7`, launch.
   Expected: refused, naming `dev/alq-review/docs/adr 0099` and adrkit's message, next step to correct it in this repo
   and commit. With `ALQ_REVIEW_MODE=log`: the round opens, `gate.log` has a `would_deny` line, and the reviewer's
   brief lists 0018 only.
7. Launch an audit round (`stage: 'audit'`). Expected: no decision reviewer, no `decisions` key in the result.
8. With `adr` hidden and `ALQ_REVIEW_DECISION_CHECKS=log`, launch. Expected: the round opens without a decision
   reviewer; `decisions.not_checked` names each corpus and why; `gate.log` has a `would_deny` line.
9. On a branch changing 51 files, launch. Expected: refused before any adrkit call, naming 51 and 50.
10. After an assessed round with a decision reviewer: `gate.log` has a `decision-review` line with each finding's
    ruling.
