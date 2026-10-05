# Plan: test files alone are not swept

Add `is_test_file(path)` to `scripts/shimcheck.py`, built from the test runners' default file name patterns plus a local folder rule (R2).
`shimcheck.swept` returns no hunks when every code hunk it keeps is in a test file, and what it returns today
otherwise. Its four callers (`commit_decision`, `shimgate.on_launch`, `shimgate.on_commit` chain matching,
`shimgate._override_tree`) then take the existing nothing-to-sweep path for a tests-only tree: the commit is
allowed with no launch, and a launch records mode `none`, verdict `complete`, with no Jev call. README §8
says such a commit skips the check. Tests in `tests/test_shimcheck.py` and
`tests/test_shim_gate.py`.

## Mechanisms

- Tests-only trees are dropped tree-wide inside `swept`, so every caller agrees; mixed trees are unchanged: R1
- One predicate for "test file": runner default file name patterns plus a local `tests`/`test`/`__tests__` folder rule: R2
- The decision is deterministic and precedes Jev's `kind` question: R3
