# Research: test files alone are not swept

## R1: The filter is tree-level, inside `shimcheck.swept`

- **Decision**: when every code hunk of a tree is in a test file, `swept` returns `[]`; otherwise it returns
  every `CODE`/`MIXED` hunk, test hunks included.
- **Rationale**: `swept` is the one place that decides what the gate sweeps, and it has four callers (commit
  refusal, launch, chain matching, override seeding); a check anywhere else would leave some of them
  disagreeing. Dropping test hunks from mixed trees would change the diff Jev's `level`/`coverage` answers
  were calibrated on (the replay of the evidence fixes) and the chain ranges, which the issue does not ask for.
- **Existing tools**: the "nothing to sweep" path (`commit_decision` `if not code`, `on_launch` `if not code`,
  mode `none`) that all-prose trees already take: fit, reused unchanged; no new mode.

## R2: Which paths count as test files

- **Decision**: `shimcheck.is_test_file` holds for a path with a folder named `tests`, `test` or `__tests__`,
  or a file named `test_*.py` / `*_test.py` (pytest), `*_test.go` (go test), `*.test.<ext>` / `*.spec.<ext>`
  for js, jsx, ts, tsx, mjs, cjs (Jest `testMatch`), or `*.tftest.hcl` (terraform test).
- **Rationale**: the file name patterns are taken from the runners' defaults, the convention test files
  follow. Counting every file under a `tests`, `test` or `__tests__` folder is a local addition, so that the
  fixtures and helpers kept there count too; Jest's own `__tests__` default matches only JS/TS files. The
  drift runs both ways: a test file outside the patterns is swept as before (fails closed), and a commit whose
  only code is a non-test source file under a `tests`, `test` or `__tests__` folder skips the sweep (fails
  open).
- **Existing tools**: pytest `python_files`, Jest `testMatch`, `go test`, `terraform test` define these
  defaults but are compiled into the runners, not written in any repo file, so there is nothing to read;
  git has no standard attribute marking tests (unlike `linguist-generated`, which `worktree.tree_hunks`
  reads). No definition existed in the plugin to reuse.

## R3: The gate does not ask Jev about a tests-only tree

- **Decision**: a tests-only tree never reaches `shimgate._is_fix`.
- **Rationale**: red tests written against a defect are reasonably labelled `fix`, so leaving the outcome to
  Jev's `kind` answer keeps red-test-first commits refusable; a deterministic rule ahead of a probabilistic
  one removes that and saves a call.
- **Existing tools**: Jev's `kind` question (`jev.KIND`): kept for trees with code outside test files.
