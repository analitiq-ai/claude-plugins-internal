# Research: review-round cap after a settled round

## R1: The cap counts rounds since the stage last settled

- **Decision**: A round is settled when it is `clean`, or `assessed` with round verdict
  `CONVERGED_PUSHBACK`. The cap refuses a round once `CAP` rounds of the stage have completed since its last
  settled round, within the current epoch. One `_settled` predicate in `policy.py` serves the cap,
  `rerequest` and `mark_ready`.
- **Rationale**: The cap exists to stop a run of rounds that are not converging. A settled round ends that
  run, so a commit pushed after it starts a new one; counting it sent PR #50 to an audit after a clean
  round 4. Refusing only when the latest round is unsettled was rejected: the first finding after a clean
  round would then go straight to an audit.
- **Existing tools**: `policy.mark_ready`'s inline settled rule: fit, now shared as `_settled`.
  `ledger.counted`: kept for the epoch boundary; on its own it counts settled rounds too.
