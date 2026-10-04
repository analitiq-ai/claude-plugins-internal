# Plan: a cause fix with no site left is complete

`shimcheck.verdict` takes `sites_left`, whether any SAME OPERATION site remains, and reads `coverage` only
when one does. `shimgate._judge`, through which every verdict of the gate is composed (first sweep, re-judge
after rulings, restarted check, deep-sweep target), passes it the list it asked Jev about. `_patch_report`
prints the site list and the contest step only when the list has a site. `tests/replay_shim.py` keeps
`sites_left=True`: its recorded sweeps are prose, never parsed into a `same_operation` list. Tests in
`tests/test_shimcheck.py` and `tests/test_shim_gate.py`.

## Mechanisms

- The verdict reads the list it judges, and coverage only over a non-empty one: R1
- A refusal names only steps that can succeed: R2
