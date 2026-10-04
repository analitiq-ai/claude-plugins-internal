# Plan: K9, what a test checks

`claimcheck.py`: `CATEGORIES` gains K9 and `JUDGED` becomes `("K1", "K9")`; every reader of `JUDGED` in
`claimcheck.py` and `claimgate.py` tests membership. `briefs.py`: K9's meaning, a K9 judge prompt, and
`_JUDGE_PROMPTS` mapping each judged category to its prompt builder; `claim_check_args` passes `judges` keyed
by category and each known claim's category; a contest uses its claim's prompt. The reader's MIXED label and
its no-claim rule name a test's name and failure messages. `claim-check.js` judges a claim when
`args.judges` has its category. README section 7 names where the categories are defined. Tests in
`tests/test_claimcheck.py` and `tests/test_claim_gate.py`; the K1 prompt is pinned by
`tests/fixtures/k1_judge_prompt.txt`.

## Mechanisms

- Judged categories defined once, each with its own judge prompt: R1
- A test's name and failure messages are claims of a MIXED hunk: R2
- A cached read or verdict stands only for the brief it answered: R3
