# Plan: one printed form for claim ids

Add `CLAIM_REF`, `claim_ref` and `parse_claim_ref` to `claimcheck.py`. `accept_contest` parses the contest's
id and returns it; `claimgate._accepted_contests` passes on only the accepted contests, each under its
internal id. Every `claim-{id}` message in `claimcheck.py`, `claimgate.py` and `briefs.py` renders through
`claim_ref`; `UNLOCK_CLAIM` is built from `CLAIM_REF`. README "Calls" and `claim-check.js` `whenToUse` show
`claim: 'claim-<id>'`. Tests in `tests/test_claimcheck.py` and `tests/test_claim_gate.py`.

## Mechanisms

- One render and one parse of the printed claim id, applied once at the contest boundary: R1
