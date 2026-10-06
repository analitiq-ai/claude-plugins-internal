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

The bound and the release (FR-011, FR-017, ADR-0001). One lineage per claim, minted when a check first rules it
`WRONG`. Its `id` is that version's claim id and is never recomputed from later words.

| Field | Meaning |
|---|---|
| `file` | the file the claim is in |
| `versions[]` | one per check that saw the claim, as `{check, tree, id, line, quote, ruling, failing_case, evidence}`. `check` is the check ref, so a repeated check adds nothing. `tree` names the version of the file the next check diffs against |
| `contests[]` | the check ref of each rejected contest |
| `released` | the claim id of the version the user released with `unlock`; empty until then |
| `ended` | `correct` or `gone`; empty while the lineage is open |

Count: the versions ruled `WRONG`, plus the rejected contests. Nothing lowers it.

Succession (R12), at each completed check, for each open lineage of a file in the staged change. The diff is
`git diff -U0` of the file's blob in the last version's `tree` against the staged blob:

- its line is outside every hunk → same lineage, line shifted;
- its line is inside a replaced range → the sentence's character span is mapped into the staged blob, and each
  claim the reader finds in that span is the lineage's next version. Several claims may continue one lineage. A
  claim that continues several lineages is a version of each, and its count is the largest of theirs;
- its words are unchanged at another place in the file → found by its claim id;
- nothing is mapped and the id is not found → `ended: gone`.

A `CORRECT` ruling sets `ended: correct`. Not followed: a claim moved and reworded in one step, and the half of
a split that lands in a pure insertion.

State: count below 3 → the check runs. Count 3 or more and the last version not `released` → refused, and the
user is asked with every version's words and ruling. Last version `released` → passes. Words changed after a
release → checked again, and a `WRONG` ruling stops it again. `unlock claim-<id>` takes the id of the current
words or of the lineage. Nothing is keyed on `HEAD` or a commit, and a lineage carries no line range. Rows of
the earlier `claim_holds` table are not migrated.
