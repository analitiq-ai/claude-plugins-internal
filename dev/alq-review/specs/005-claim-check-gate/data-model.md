# Data Model: Claim check before commit

Entities from the spec, as the gate stores them. Four tables are added to the existing `ledger.db`
(`scripts/ledger.py`), opened through the same `BEGIN IMMEDIATE` transaction as the PR ledgers. None is keyed by
PR: a commit happens with no PR open. The shapes agents exchange and the result the author reads are defined
once, in [contracts/claim-check.md](contracts/claim-check.md); this file does not repeat them.

Fingerprints are git's own: a staged tree id (`git write-tree`), a hunk's `git patch-id --stable`, and a file's
blob id in a tree (`git rev-parse <tree>:<path>`).

## Check (`claim_checks`: key `repo`, `tree`; JSON `doc`)

One check of one staged tree. A check is read back only for exactly the content a commit would record.

| Field | Meaning |
|---|---|
| `repo`, `root`, `tree`, `base` | slug, checkout, the checked tree id, the tree it is diffed against (HEAD's tree, or the empty tree before the first commit) |
| `ref` | `<repo>#tree:<tree>`, the full tree id, carried in every agent output so the hook can find the check |
| `status` | `reading` → `judging` → `complete` |
| `hunks[]` | `{id, file, old_start, old_count, new_start, new_count, removed, added, patch_id}` from `git diff -U0 -M <base> <tree>`, removal-only hunks included, linguist-generated files left out |
| `batches[]` | the hunk ids each reader was given, by batch index |
| `labels{}` | hunk id → `CODE` / `PROSE` / `MIXED` |
| `claims{}` | claim id → `{id, hunk, file, line, quote, category}`; `category` is K1..K8; only K1 is judged |
| `verdicts{}` | claim id → Verdict |
| `contests{}` | claim id → `pending`, `upheld` or `rejected` |
| `cost` | `{judged, agents}` |

A check is `complete` when every hunk has a label and every K1 claim has a verdict, and settles once: a contest
answered later replaces a verdict without reopening it. A
check whose agents did not all report stays `reading` or `judging`, which refuses the commit as a failed check
(FR-015). Files are read from the tree object (`git cat-file blob <tree>:<path>`), never the checkout.

## Read (`claim_reads`: key `repo`, `patch_id`; JSON `doc`)

A reader's output for one hunk: `{kind, claims: [{offset, quote, category}]}`, where `offset` is the claim's line
less the hunk's `new_start`. A hunk with the same patch-id (same words, any spacing) is not read again, so its
claims keep their quotes and ids (FR-010); a cached claim whose quote no longer sits at its line is read again.

## Claim

`id = sha256(file, quote with comment markers and whitespace runs reduced)[:16]`. The quote is verbatim in the staged file at `line`, inside the hunk's paragraph. Only
`K1` is judged (FR-005); the other categories are recorded and counted in the result.

## Verdict (inside a Check; `CORRECT` is also cached in `claim_verdicts`)

`verdict` is `CORRECT`, `WRONG` or `UNSURE`, with `assertions[]` (`{text, confirmed, evidence}`),
`failing_case` for `WRONG`, `gap` for `UNSURE`, and `basis`. The hook's rules are in the contract.

### Cached `CORRECT` (`claim_verdicts`: key `repo`, `claim_id`; JSON `doc`)

`doc = {verdict, evidence_blobs: {path: blob id}}`. Reused only while every cited path has the same blob id in the
checked tree. Not kept for a claim saying every, only, all, exactly, always or never. `WRONG` and `UNSURE` are never
cached across trees.

## Lineage (`claim_lineages`: key `repo`, `branch`, `id`; JSON `doc`)

The bound and the release (FR-011, FR-017, ADR-0001). One row is one chain of versions with one current claim.
Every rule about a row's state is in this section. Other documents cite it and decide nothing about state.

| Field | Meaning |
|---|---|
| `id` | first 16 hex of sha256(check ref that minted the row \0 id of the claim it was minted for); never recomputed |
| `file` | the file the claim is in |
| `versions[]` | oldest first, as `{check, tree, id, line, quote, ruling, failing_case, evidence}`. At most one per check ref. The last one is the current claim; its `tree` names the version of the file the next check diffs against |
| `contests[]` | the check ref of each rejected contest that was counted |
| `released` | `{id, count}`: the current claim's id and the count when the user typed `unlock`; empty until then |
| `ended` | `correct`, `gone` or `merged`; empty while the row is open. An ended row is not changed again |

Count: the versions ruled `WRONG`, plus the entries of `contests[]`. Nothing lowers it.

### State

A function of the stored fields, for an open row. Ordered; the first match is the state.

1. `released`: `released.id` is the current claim's id.
2. `stopped`: the count is 3 or more, and `released` is empty or the count is above `released.count`.
3. `checked`: any other row.

### Transitions

A completed check is applied to every open row of its repo and branch whose `file` is in the staged change. The
column is the row's state before the check. Succession is applied first, then the ruling. The state after an
event is read from the list above.

A `stopped` row is changed by the user's `unlock` and by nothing else: the tree rule below refuses the launch,
and a check that was already running when the row stopped writes nothing to it.

| Event | `checked` | `released` |
|---|---|---|
| **Succession** (R12): `git diff -U0` of the file's blob in the current version's `tree` against the staged blob | | |
| Words unchanged: the line is outside every hunk, or the claim id is found at another place in the file | nothing written | nothing written |
| Reworded: this row wins one claim in the span its sentence maps to in the staged blob | a version is appended for that claim, which is now current | the same; the row is then `checked`, with its count equal to `released.count` |
| Split: this row wins several claims in that span | the first by line continues the row as a rewording. Each other one gets a row minted at this check, starting with a copy of `versions`, `contests` and `released`, then continued as a rewording | the same |
| Merged: other rows win every claim this row reaches | `ended: merged`; its `released` ends with it | the same |
| Deleted: nothing is mapped and the id is not found | `ended: gone` | `ended: gone` |
| **Ruling** of the current claim by this check | | |
| `WRONG` | recorded on this check's version, which is appended if succession appended none; the count rises by one | nothing written |
| `CORRECT` | `ended: correct` | `ended: correct` |
| `UNSURE`, or the claim is not judged | recorded on this check's version if succession appended one; nothing is counted | nothing written |
| **Other events** | | |
| A contest of the current claim is rejected | the check ref is appended to `contests[]`; the count rises by one | nothing written |
| A contest of the current claim is upheld | the new ruling is applied as above; the `WRONG` it replaces stays counted | the new ruling is applied as above |
| The user types `unlock claim-<id>` | `released` is set to the current claim's id and the count | `released` is written again with the same values |
| A commit, an amend or a rebase lands | nothing written | nothing written |

The same events on a `stopped` row: the user's `unlock` sets `released` to the current claim's id and the count,
so the row is `released`; a commit writes nothing; every other event cannot occur or writes nothing, as said above.

Who wins a claim. A claim reached by several rows is won by the row with the largest count; rows with equal
counts, by the smaller `id`. Wins are decided for the whole file before any row is minted, so every claim has one
winner and at most one open row has a given current claim id.

Minting. A check that rules `WRONG` a claim no open row wins mints a row with that one version, at count 1. A
row with that `id` already exists only when the same tree was checked a second time; then nothing is written.
For the same reason a check ref adds at most one version to a row.

A contest is accepted only for a claim that is the current claim of an open row
([contracts/claim-check.md](contracts/claim-check.md) §2). So a rejected contest always has a row to be counted on.

Not followed: a claim moved and reworded in one step, and the half of a split that lands in a pure insertion.
Each is a claim no row wins.

### Tree rule

How a staged tree is matched to rows before any check of it exists. The launch and the commit use it unchanged.

A staged tree matches every open row of its repo and branch whose `file` is in the staged change, under its old
or its new name when the file is renamed.

- A matched row is `stopped` → the launch and the commit are both refused. The refusal asks the user, per
  stopped row, with every version's words and ruling and `unlock claim-<id>`. This holds whether the row's words
  are unchanged, reworded or deleted in the staged tree.
- No matched row is `stopped` → the check may be launched, and the commit is decided by the tree's check: a
  `WRONG` claim refuses it unless its id is the `released.id` of a matched row.

`unlock claim-<id>` names every open row whose current claim id is `<id>`; when there is none, the row whose
`id` is `<id>`. No count and no lineage is keyed on `HEAD` or a commit, and a row carries no line range. Rows of
the earlier `claim_holds` table are not migrated.
