# Quickstart: validate the on/off switch

Run from `dev/alq-review/` in the feature worktree. The keyword, the answers and the table of what off stops
are in [contracts/switch-keywords.md](contracts/switch-keywords.md).

## 1. Unit and gate tests (no model, no network)

```bash
python3 -m unittest discover -s tests
```

Expected: the switch cases in `test_gate.py` and `test_pre_merge_gate.py` pass, one per row of the contract's
table and one per answer; every test that existed before passes unchanged (SC-003).

## 2. Off and on (US1, live)

1. On a PR branch with an unassessed round, type `alq-review off` → told it is off.
2. Edit a file there, `git commit`, `git push` → none refused; no workflow was asked for.
3. Launch `alq-review:review-round` → answered: off, carry on.
4. In a second session on the same checkout, edit the same file → refused.
5. Type `alq-review on` → the edit is refused again; `python3 scripts/ledger.py status --worktree <checkout>`
   shows the round as it was before step 1.

## 3. Known to be off (US2, live)

1. With `alq-review off` typed, leave and resume the session → told it is off.
2. Start a new session → on.
3. `grep '"action": "switch"' "${XDG_STATE_HOME:-$HOME/.local/state}/alq-review/gate.log"` → one line per
   keyword typed, with the session and the words.
4. Type `alq-review off please` → nothing changed, the two forms named.
