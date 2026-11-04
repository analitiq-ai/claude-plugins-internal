# Data Model

Shapes owned elsewhere are referenced, not restated.

## Ledger record (core, PR B)

The story's directory `issues/<n>/` on the served repo's `ledger` branch: one event per file, each written by an
event commit of the reviewer App. Event kinds, file names, the fold's commit classes and the writes:
[contracts/ledger-record.md](contracts/ledger-record.md), the one definition.

Commit classes (ADR-0011 d2): event commit → applies its events; clearance → nothing; invalid → derives
`tamper-<oid>` with its `remaining` files.

## State snapshot (core, changed in PR B)

`core/src/contracts/snapshot.ts` `Snapshot {v, rounds, holds, pushbacks, rulings, gates}`, the fold's answer, never
stored. Changes: `Round` gains `run`; `Hold.question` also on `claim` and verdict-placed `rescope`; `gates: Gates |
null` added.

Hold lifecycle (fold-enforced): `absent → OPEN (hold event, since = GitHub's now) → RELEASED (release event:
released, released_by) → OPEN again (a new hold event, new since)`; rows are never removed. `tamper-<oid>`: derived
`OPEN` from the invalid commit → `RELEASED` by a release event, written only when `remaining` is empty and the
release rule holds. Release floor: the placing commit's `committedDate`; a tamper's, the earlier of its commit's
and its first GitHub-signed successor's.

When each hold is placed, what it refuses and what its release grants: reviewer ADR-0013 d4's table and d5; not
restated here. The core call each uses:

| hold id | core call |
|---|---|
| — (round recorded) | `writeState` (appends a `Round`, file named by its `run`, with the holds its report places) |
| `escalation-<issue>` (with question), `pushback-<issue>`, `audit-<issue>`, `rescope-<issue>` on a RESCOPE verdict (with question) | `writeState`'s `placements`, in the round's commit |
| `rescope-<issue>` for a spec PR seen open | `placeRescopeHold(specPr)` |
| `claim-<lineage>` (with question), `shim-<bug>` | `recordGates` |
| release of any, `tamper-<oid>` included | `releaseOnClaim` |

## State reading (core, changed in PR B)

`StateReading {head, snapshot, held, causes, tamper, newest_round, pushed_back, releasable, startable, reset}`;
`StateCause` is `tampered {commit, remaining}` or `open_hold {id}`; `ClaimRelease {released, reset}`
([contracts/ledger-record.md](contracts/ledger-record.md#fold)). One per hook run, advanced by each write.

## Gates section (core snapshot, new in PR B)

The payload of the story's newest `gates` event, written only by `recordGates` together with the holds it places.
Shape, readers and derivations: [contracts/gates-snapshot.md](contracts/gates-snapshot.md), the one definition. The
story's one `branch`, its `anchor`, open `lineages` (`places`, `chain` of `{ref, claim, line, words, ruling, at}`)
and open `bugs` (`members`, `absorbed`, `ranges`, `deep`, `rulings`). Counts and floors are derived, never stored.

## Session issue record (#174's, read only)

Core's `SessionRecord {v, repo, issue, taken: claim|resume, at}`, read through `readSessionRecord(folder, sessionId)`.

## Commit-check pass record (core, new in PR C)

See [contracts/commit-pass-record.md](contracts/commit-pass-record.md).
`{v: 1, repository, off, branches: {<branch>: {issue, head: {sha, range_from, at}, passes: {sha, range_from, at}[]}}}`;
per branch, newest pass = `head`, set on every pass, even of a sha already in `passes`. Append-only within a session;
a commit appears once per branch.

## Session folder (reviewer, local, not a contract)

`~/.local/state/codeworks/reviewer/sessions/<session>/`. Nothing here holds a round, hold or gates item (FR-004).

| file | written by | lifetime |
|---|---|---|
| `repo.git/` | hook, `git fetch <clone> <sha>` only | session |
| `commit-passes.json` (passes and the `off` switch) | hook via core (PR C) | session |
| `check.json` (running range, step, workflow run ids) | hook | until the range passes or fails |
| `memos/*.json` (claim reads, verdicts) | hook | session (FR-017) |
| `released-<issue>-<at>` | hook after `releaseOnClaim` | session |
| `gate.log` | hook | session |

## After-commit check state machine

`idle → fetched (new commits in bare copy) → based (newest branch pass, else GitHub head, if an ancestor of head;
else REFUSED: pushed history rewritten) → fenced → structural (holds and tampers, protected paths, merge) →
awaiting_checks (claim/shim workflows launched by the model) → PASS (record range) | FAIL | COULD_NOT_RUN`.
FAIL and COULD_NOT_RUN record nothing; the next commit's range starts at the same base.

## State write step (reviewer, per hook run)

`read (StateReading) → decide (pure rule over the reading) → write (core, expectedHeadOid = head) → advanced
reading | StateStale → path history from the new head: untouched → `head` re-pointed, retry; touched → read
again, decide again (≤3 attempts) → COULD_NOT_RUN | StateWriteUnsigned / refused →
COULD_NOT_RUN or the refusal`.
