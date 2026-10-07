# Quickstart: validating the claim check

Run from `.claude/plugins/alq-review`. State goes to a scratch directory so the real ledger is untouched.

```bash
export ALQ_REVIEW_STATE_DIR=$(mktemp -d)
python3 -m unittest discover -s tests            # all tests, including the claim-check ones
```

End-to-end, in a scratch repo with a GitHub-style `origin` (the plugin's tests build one in `tests/helpers.py`
and `test_worktree_facts.Repo`):

1. Commit `validator.py` whose `check(items)` accepts an empty list. Stage a `README.md` that says
   "the validator rejects an empty list". Run `git commit`: refused, naming the workflow call (spec US1 scenario 1).
2. Run the workflow call it names. Expected: `status: WRONG`, one entry quoting the sentence, with the failing
   case and `validator.py:<line>`.
3. Run the workflow again without fixing the sentence (reword it if you like): `WRONG` again. A repeated `git commit`
   against the same check adds no refusal. After the third check that rules that claim `WRONG`, the
   refusal asks the user and prints `unlock claim-<id>` (US2 scenario 4). A second claim ruled `WRONG` once in
   the same checks is still at 1. A launch in that state is refused with the same question (US2 scenario 5).
4. As the user, type `unlock claim-<id>`. Fix the sentence, stage, run the workflow: `COMPLETE`, and the commit goes through. Only the changed claim was
   judged (SC-005).
5. Stage only code: the workflow's reader runs and judges nothing; the commit goes through (US1 scenario 4).
6. Stage the removal of "only" from a committed sentence: the sentence is judged as it now reads (US1 scenario 5).
7. Leave an unstaged edit in a tracked file and launch the workflow: refused, naming the file.
8. Set `ALQ_REVIEW_CLAIM_CHECKS=log`: step 1 is recorded as `would_deny` and the commit goes through, while the
   review gate's own rules still enforce.

Steps 1-8 need real agents. The tests drive `gate.py` with recorded agent outputs instead, so the gate's
decisions are covered without calling a model; the first and last runs against real agents are in `tasks.md`.

## Run 2026-10-02

Real agents (Sonnet, effort medium) via `claude -p --plugin-dir <this plugin>` in scratch repos with scratch
`ALQ_REVIEW_STATE_DIR`s.

| Step | Result | Spec |
|---|---|---|
| 1 | Commit refused, naming the workflow call. | US1-1 |
| 2 | `WRONG`, 1 judged, 2 agents; failing case `check([])` returns True, evidence `validator.py:3`. 58 s, $0.20. | US1-1 |
| 3 | Reworded twice: `WRONG` each time; the third refusal asks the user and prints `unlock claim-<id>`. | US2-4 |
| 4 | `unlock` released the hold; the fixed sentence was `CORRECT` (1 judged) and the commit landed. | SC-005 |
| 5 | Code only: the reader ran, 0 judged, the commit landed. | US1-4 |
| 6 | "only" removed from a committed sentence: judged as it now reads, `WRONG` (`check("abc")` passes). | US1-5 |
| 7 | Unstaged edit to `validator.py`: launch refused, naming the file. | FR-016 |
| 8 | Log mode: `would_deny` recorded, the commit landed. | FR-018 |

SC-006: `git status --porcelain --untracked-files=all` was identical before and after every step in which no
commit landed; in steps 4, 5 and 8 the only difference is the commit itself.

Found and fixed in this run: a held new file was named "old lines 0-0" in the user question.

SC-001 (T047): the 30 study claims, each judged by `alq-review:claim-judge` in the plugins repo at its commit:
30 verdicts (20 `CORRECT`, 8 `WRONG`, 2 `UNSURE`); the hook refused 15 outputs before accepting. One accepted
`WRONG` carried a settled assertion with no `path:line` (a conclusion drawn from another assertion); the hook
now refuses that. 293 s, $5.28.

SC-002/SC-004 (T048): stub repo, one staged README with 30 claims (10 wrong, 20 meant true) about a 50-line
`inventory.py`. All 10 wrong claims refused. One claim meant true was refused too, and the judge was right:
`find()` sorts by code point, so "Cherry" comes before "apple". No true claim was refused. Launch to decision:
48 s for 30 judged claims (31 agents); commit attempt to final refusal: 86 s, $1.15.
