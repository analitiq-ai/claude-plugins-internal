# Plan: review-round cap after a settled round

Change `policy.py` only: add `_settled` and `_capped`, use them in `_cap_reached`, `rerequest` and
`mark_ready`. Tests in `tests/test_policy.py`. README section 4 and the `CAP` comment describe the new count.

## Mechanisms

- Cap counts rounds since the stage last settled: R1
