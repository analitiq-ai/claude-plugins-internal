# Quickstart: validate the decision check

Prerequisites: Python 3.13, git, node ≥ 22, `pip install diff-match-patch==20241021`, and adrkit installed by the
README's install step.

## Suite

```bash
cd dev/alq-review/tests && python -m unittest -v
```

Expected: green, with no test skipped for want of `adr`.

## By hand, in this repo

ADR-0018 governs `plugins/alq-review/scripts/gate.py`, so a branch that changes it is a governed change.

1. On a draft PR's worktree whose diff touches `gate.py`, with `ALQ_ORG_ADR_DIR` unset, launch
   `Workflow(name='alq-review:review-round', args={worktree: '<abs>', spec: 'dev/alq-review/specs/020-decision-review'})`.
   Expected: the round opens; the last reviewer of the wave is `alq-review:decision-reviewer` and its prompt lists
   the governing records; the result's `decisions` has `corpora` = the three `dev/*/docs/adr`, `governing` including
   `dev/alq-review/docs/adr 0018` (adr 0.20.0 on 2026-10-13 also returned 0004, 0006, 0008, 0009, 0012, 0016 and
   0017), `org_corpus: "unset"`.
2. `gh pr ready` before the decision reviewer reports: refused (the round is collecting).
3. Set `ALQ_ORG_ADR_DIR=/abs/path/to/engineering/docs/adr` and launch on a new commit. Expected: `corpora` gains
   `org (/abs/path/to/engineering/docs/adr)`; an org record whose matcher covers a changed file is in `governing`.
4. Set `ALQ_ORG_ADR_DIR=/nowhere` and launch. Expected: refused, naming `/nowhere`, next step to point the variable at
   the org's `docs/adr` or unset it; `python3 scripts/ledger.py status --worktree <abs>` shows no new round.
5. Hide `adr` (`PATH` without it) and launch. Expected: refused with the install step.
6. Commit two records `dev/alq-review/docs/adr/0099-a.md` and `0099-b.md`, each `status: accepted` with id `0099`,
   launch. Expected: refused, naming `dev/alq-review/docs/adr`, both files and adrkit's `unique-id` message, next step "correct the record
   in this repo, commit and launch again". With `ALQ_REVIEW_MODE=log`: the round opens, `gate.log` has a `would_deny` line,
   `decisions.broken` names both 0099 files, and no 0099 is in `governing`.
7. Launch an audit round (`stage: 'audit'`). Expected: no decision reviewer, no `decisions` key in the result.
8. With `adr` hidden and `ALQ_REVIEW_DECISION_CHECKS=log`, launch. Expected: the round opens without a decision
   reviewer; `decisions.not_checked` names each corpus and why; `gate.log` has a `would_deny` line.
9. On a branch changing 51 files, launch. Expected: refused before any adrkit call, naming 51 and 50.
10. After an assessed round with a decision reviewer: `gate.log` has a `decision-review` line with each finding's
    ruling.
