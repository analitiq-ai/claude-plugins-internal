# Research: one printed form for claim ids

## R1: Claims are named `claim-<hex>` outside the plugin, parsed once at the contest boundary

- **Decision**: `claimcheck` owns the printed form: `claim_ref` renders it, `parse_claim_ref` (via
  `CLAIM_REF`) parses it. `claimgate._accepted_contests` parses every `args.contests[].claim` before
  anything else reads it, so the ledger, the check record and the briefs see only the bare hash. A bare
  hash in a contest is refused like any unknown id, and the refusal lists the check's WRONG claims in the
  printed form.
- **Rationale**: the gate already printed `claim-<hex>` in its refusals and accepted it in
  `unlock claim-<hex>`; only the contest input took the bare hash, so copying the printed id failed.
  Validating input at the boundary and keeping one internal representation is standard practice.
  Accepting both forms was rejected: the coding rules forbid compatibility paths unless asked, and two
  accepted forms keep the ambiguity that caused the bug.
- **Existing tools**: `claimgate.UNLOCK_CLAIM`, the one existing parser of the printed form: fit, now
  built from `CLAIM_REF`. The ledger's bare-hash keys (`ledger.claim_holders`): kept as the internal form.
