# Data Model

Shapes owned elsewhere are referenced, not restated.

## State snapshot (core, unchanged)

`core/src/contracts/snapshot.ts` `Snapshot {v, rounds, holds, pushbacks}`. Written only by reviewer's hook as
the reviewer App, tagged `codeworks:reviewer-state`, newest wins (R5).

Hold lifecycle (core-enforced, `checkTransition`): `absent → OPEN (placeHold, since=now) → RELEASED
(releaseOnClaim, released + released_by)`; a RELEASED row may be reopened by `placeHold`; rows are never
removed.

| reviewer event | core call | hold id |
|---|---|---|
| round recorded | `writeState` (append `Round`) | — |
| DIRTY / ESCALATE | `placeHold` | `escalation-<issue>` (with question) |
| DIRTY / RESCOPE (was RESHAPE_SPEC) | `placeRescopeHold(specPr)` | `rescope-<issue>` |
| audits spent | `placeHold` | `audit-<issue>` |
| stage cap with open pushback | `placeHold` | `pushback-<issue>` |
| lineage WRONG count ≥ 3 | `placeHold` | `claim-<lineage>` |
| bug count ≥ 4 | `placeHold` | `shim-<bug>` |

## Gates snapshot (core, new — PR B)

Tag `codeworks:reviewer-gates`; full snapshot, newest wins; same fail-closed rules. See
[contracts/gates-snapshot.md](contracts/gates-snapshot.md).

Shape, readers and derivations: [contracts/gates-snapshot.md](contracts/gates-snapshot.md), the one definition. Per branch: `anchor`, open `lineages`
(`places`, `chain` of `{ref, claim, line, words, ruling, at}`) and open `bugs` (`members`, `absorbed`, `ranges`,
`deep`, `rulings`). Counts and floors are derived, never stored.

## Session issue record (#174's, read only)

`{repository, issue, kind: claim|resume, claimed_at}` at the path VP-001 names, through #174's core reader.

## Commit-check pass record (core, new — PR C)

See [contracts/commit-pass-record.md](contracts/commit-pass-record.md).
`{v: 1, repository, off, branches: {<branch>: {issue, head: {sha, range_from, at}, passes: {sha, range_from, at}[]}}}`;
per branch, newest pass = `head`, set on every pass, even of a sha already in `passes`. Append-only within a session; a commit appears once per branch.

## Session folder (reviewer, local, not a contract)

`~/.local/state/codeworks/reviewer/sessions/<session>/`

| file | written by | lifetime |
|---|---|---|
| `repo.git/` | hook, `git fetch <clone> <sha>` only | session |
| `commit-passes.json` (passes and the `off` switch) | hook via core (PR C) | session |
| `check.json` (running range, step, workflow run ids) | hook | until the range passes or fails |
| `memos/*.json` (claim reads, verdicts) | hook | session (FR-017) |
| `released-<issue>-<claimed_at>` | hook after `releaseOnClaim` | session |
| `write.lock` | hook, held read→post for each state/gates write and the claim step (FR-020) | one write |
| `gate.log` | hook | session |

## After-commit check state machine

`idle → fetched (new commits in bare copy) → based (newest branch pass, else GitHub head, if an ancestor of head;
else REFUSED: pushed history rewritten) → fenced → structural (holds, protected paths, merge) →
awaiting_checks (claim/shim workflows launched by the model) → PASS (record range) | FAIL | COULD_NOT_RUN`.
FAIL and COULD_NOT_RUN record nothing; the next commit's range starts at the same base.
