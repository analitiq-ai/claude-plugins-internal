# Data Model

Shapes owned elsewhere are referenced, not restated.

## State snapshot (core, unchanged)

`core/src/contracts/snapshot.ts` `Snapshot {v, rounds, holds, pushbacks}`. Written only by reviewer's hook as
the reviewer App, tagged `codeworks:reviewer-state`, newest wins (R5).

Hold lifecycle (core-enforced, `checkTransition`): `absent → OPEN (placeHold, since=now) → RELEASED
(releaseOnClaim, released + released_by)`; a RELEASED row may be reopened by `placeHold`; rows are never
removed.

When each hold is placed, what it refuses and what its release grants: reviewer ADR-0013 d4's table and d5, the
one definition; not restated here. The core call each uses:

| hold id | core call |
|---|---|
| — (round recorded) | `writeState` (append `Round`) |
| `escalation-<issue>` (with question), `pushback-<issue>`, `audit-<issue>` | `placeHold` |
| `rescope-<issue>` | `placeRescopeHold(specPr)`: `null` on a RESCOPE verdict, the spec PR's number when one is seen open |
| `claim-<lineage>` (with question), `shim-<bug>` | `recordGates` |

## Gates section (core snapshot, new — PR B)

The state snapshot's `gates: Gates | null`, written only by `recordGates` together with the holds it places. See
[contracts/gates-snapshot.md](contracts/gates-snapshot.md).

Shape, readers and derivations: [contracts/gates-snapshot.md](contracts/gates-snapshot.md), the one definition. The story's one `branch`, its `anchor`, open `lineages`
(`places`, `chain` of `{ref, claim, line, words, ruling, at}`, each `ruling` a core `ClaimVerdict`) and open `bugs`
(`members`, `absorbed`, `ranges`, `deep`, `rulings`, each a core `ShimRuling`). Counts and floors are derived, never stored.

## Session issue record (#174's, read only)

Core's `SessionRecord {v, repo, issue, taken: claim|resume, at}`, read through `readSessionRecord(folder, sessionId)`.

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
| `released-<issue>-<at>` | hook after `releaseOnClaim` | session |
| `write.lock` | hook, held read→post for each state write and the claim step (FR-020) | one write |
| `gate.log` | hook | session |

## After-commit check state machine

`idle → fetched (new commits in bare copy) → based (newest branch pass, else GitHub head, if an ancestor of head;
else REFUSED: pushed history rewritten) → fenced → structural (holds, protected paths, merge) →
awaiting_checks (claim/shim workflows launched by the model) → PASS (record range) | FAIL | COULD_NOT_RUN`.
FAIL and COULD_NOT_RUN record nothing; the next commit's range starts at the same base.
