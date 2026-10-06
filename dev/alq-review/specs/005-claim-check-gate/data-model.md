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

| Field | Meaning |
|---|---|
| `id` | first 16 hex of sha256(check ref that minted the row \0 claim id of its first own version); never recomputed |
| `file` | the file the claim is in |
| `versions[]` | the chain, oldest first, as `{check, tree, id, line, quote, ruling, failing_case, evidence}`. At most one per check ref, so a repeated check adds nothing. The last one is the current claim; its `tree` names the version of the file the next check diffs against |
| `contests[]` | the check ref of each rejected contest |
| `released` | `{id, count}`: the current claim's id and the count when the user typed `unlock`; empty until then |
| `ended` | `correct`, `gone` or `merged`; empty while the row is open |

Count: the versions ruled `WRONG`, plus the rejected contests. Nothing lowers it.

Minting. A row is minted when a check rules `WRONG` a claim that continues no open row. A claim whose words
were in a row that has ended gets a new row: the minting check differs, so the id does.

Succession (R12), at each completed check, for each open row of a file in the staged change. The diff is
`git diff -U0` of the file's blob in the current version's `tree` against the staged blob:

- its line is outside every hunk → same row, line shifted;
- its line is inside a replaced range → the sentence's character span is mapped into the staged blob. One
  claim found there is the row's next version. Several claims found there fork the row: the first continues
  it, and each other gets a new row, minted at this check, that starts with a copy of the parent's `versions`
  and `contests`, so it starts at the parent's count;
- its words are unchanged at another place in the file → found by its claim id;
- two open rows whose next version is the same claim → the row with the larger count continues, the other
  ends `merged`;
- nothing is mapped and the id is not found → `ended: gone`.

A `CORRECT` ruling sets `ended: correct`. Not followed: a claim moved and reworded in one step, and the half of
a split that lands in a pure insertion. So at most one open row has a given current claim id.

State, per open row:

- count below 3 → the check runs.
- stopped: count 3 or more and above `released.count` (or never released). The launch and the commit are both
  refused, and the user is asked with every version's words and ruling.
- current claim id equals `released.id` → that claim passes the commit although its ruling is `WRONG`.
- words changed after a release → the count still equals `released.count`, so the check runs; `CORRECT` ends the
  row, `WRONG` raises the count and stops it again at once.

`unlock claim-<id>` resolves `<id>` first as the current claim id of an open row, then as a row `id`. No count
and no lineage is keyed on `HEAD` or a commit, and a row carries no line range. Rows of the earlier
`claim_holds` table are not migrated.
