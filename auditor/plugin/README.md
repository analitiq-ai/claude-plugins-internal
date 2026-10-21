# auditor

Two entry points over one set of detectors.

| Skill | Audits | Dispatches |
|---|---|---|
| `pr-audit` | a branch's delta against its merge-base | every detector, one `delta` packet |
| `codebase-audit` | a whole repo or subsystem at its current state | five detectors, one `unit` packet per audit unit, plus repo-wide cross-unit sweeps |

## Why the detectors split where they do

Not by subject matter — by **the evidence each one must gather**. That is what
makes each internally homogeneous (one collection method, one verification
protocol) and mutually heterogeneous (no two read the same evidence).

| Detector | Reads | Modes |
|---|---|---|
| `history-shape` | git commit metadata only, never code | `delta` |
| `mechanism-depth` | whole function bodies, plus every other call site | both |
| `failure-evasion` | the region, plus the call stack around it | both |
| `duplication` | the region, plus a search for an existing equivalent | both |
| `code-shape` | the region and its own module, nothing else | both |
| `boundary-trust` | literals, trust boundaries, repo visibility | both |
| `semantic-parity` | execution paths traced under the conditions siblings branch on | both, repo-wide only in `unit` |

`mechanism-depth` is identical in both modes but for its seed: `delta` seeds from
the functions the diff touched, `unit` from the unit's whole surface.

`semantic-parity` is the one that reasons rather than matches: it enforces the
consistent-semantics rule by hunting a counterexample — an input combination under
which paths that should agree observably do not, including where both return the
same value but one skipped a downstream call. `duplication` finds the pair; this
one proves the divergence.

**Nothing here is a maintained list.** Every sibling family is derived by reading
the tree on the run — what implements an interface, what a dispatch table holds,
what shares a contract type, what name substitutions the codebase actually repeats.
Add a connector and it joins its family on the next run; delete one and it is gone.
A seed source that cannot be recomputed from the tree is not a seed source.

## What is shared, and how

`reference/scope-packet.md` is the interface a skill fills and a detector reads —
the only thing the two skills have in common. `reference/finding-format.md` is the
severity scale, the finding blocks and the clean-scope requirement, read by both
skills and every detector. `reference/reporting.md` is the orchestrator's output
discipline: silence from dispatch until the report, and how little the report says.

An orchestrator does not narrate. A detector's claim is not a finding until it has
been verified, deduped and ranked, so relaying claims as they arrive publishes
conclusions that have not survived synthesis. One report, at the end.

Neither skill carries a hunt list. Each detector's remit lives once, in its own
body. A skill that spells out what to look for has started the second copy this
layout exists to avoid.
