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

## Hold (`claim_holds`: key `repo`, `base`, `file`; JSON `doc` = the file's list of holds)

The bound and the release (FR-011, FR-017). One hold per git hunk, named by its old-side range against `base`
(`{file, old_start, old_count, refusals, claims, patch_id, released_patch_id}`). A new file is one hunk.

| Field | Meaning |
|---|---|
| `refusals` | completed checks, and rejected contests, that ruled a claim in this hunk `WRONG` |
| `claims[]` | each claim last ruled `WRONG` here, as `{id, file, line, quote, failing_case, evidence}`: the refusal shows them, since the hold outlives the check that ruled them; `unlock claim-<id>` resolves `id` |
| `released_patch_id` | the hunk's patch-id when the user typed `unlock`; empty until then |

A later hunk whose old-side range overlaps or touches the hold's continues it. State: `refusals < 3` → the
check runs; `refusals == 3` and not released → refused and the user asked; released and the hunk's patch-id
equals `released_patch_id` → passes; a different patch-id → `refusals` restarts at 0. A repeated commit against
the same check adds no refusal. Counts are per hunk; nothing sums them.
