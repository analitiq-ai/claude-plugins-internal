# Data model: lineages

All in `ledger.db` under the state root (ADR-0002). Each row is one JSON doc, written inside the ledger's
transaction. No count, hold or bug is looked up by `HEAD`, a tree or a commit (FR-019): lineages are read by branch, file or id, and bugs by branch or id. Only a check's own record is kept by the tree it checked.

## Claim lineage: `claim_lineages (repo, branch, id, opened)` (R1, R7)

| Field | Meaning |
|---|---|
| `id` | the claim id of the version first ruled `WRONG`; carried, never recomputed |
| `opened` | the ref of the check that minted it |
| `file` | the path its claims are in |
| `state` | `open` or `ended` |
| `ended` | none, or `{by, ref, into}`: `by` is `correct`, `deleted` or `merged`; `into` is the lineage a merged one went into |
| `places` | where its words are in the file's seen text: `[{start, end, claim}]`, character offsets (`end` one past the last character) and a claim id: that of the claim read there, or for words no claim was read in, the id the place already had. More than one after a split |
| `chain` | its versions in order: `[{ref, claim, line, words, ruling, failing_case, evidence, released}]` |
| `released` | none, or `{count, claims, at}`: the count and the ids of the words when the user typed `unlock` |

Rules:

- A branch has at most one `open` row per `id`. An `ended` row is never opened again.
- The count is `claimcheck.count(lineage)`: distinct `ref`s in `chain` with `ruling` `WRONG` and `released`
  false. It is not stored.
- `ref` is a check's ref, or `<check ref>/contest-<n>` for the nth rejected contest of that claim in that
  check. An entry is added once per `ref` and claim id: the same check ruled again adds nothing, and the halves of a split claim each add theirs.
- Held: `state` is `open`, the count is 3 or more, and above `released.count` when there is one.
- `ruling` is `WRONG`, `UNSURE` or `CORRECT`. A claim that was not judged adds no entry.

State transitions:

```text
(first WRONG) -> open
open --WRONG, UNSURE, a place moved--> open
open --CORRECT on its last place--> ended (correct)
open --its last place carried to nothing, and its words found nowhere in the file--> ended (deleted)
open --its file is in neither the staged tree nor the checkout--> ended (deleted)
open --a claim inherits it and a lineage with a higher count--> ended (merged, into)
open --unlock claim-<id>--> open, released
```

## Seen file: `seen_files (repo, branch, gate, file)` (R2, R9)

| Field | Meaning |
|---|---|
| `gate` | `claim` or `shim` |
| `text` | `claim`: the staged file as the last completed claim check that had it saw it. `shim`: the file in the tree commits were measured against when its bugs were last carried |
| `ref` | the check that wrote it |

Every place of an open claim lineage, and every range of an open bug, in `file` is in the numbering of this
text. Written only together with them.

## Bug: `shim_bugs (repo, id)` (R9, R10, R11)

Today's chain without `head`, with two more states.

| Field | Meaning |
|---|---|
| `id` | `sha256(repo, branch, opening tree)[:16]` |
| `branch` | the branch it is tracked on |
| `count` | its refusals |
| `members` | the staged trees counted, so a tree counts once |
| `state` | `open`, `deep_due`, `deep_done`, `held`, `overridden`, `ended`, `merged` |
| `into` | for `merged`, the bug it went into |
| `ranges` | `[{file, old_start, old_count}]` in the numbering of that file's text in `seen_files` (`shim`), lines as git numbers them. A file `HEAD` lacks (new, or the new path of a move) has empty saved text: its range is measured against nothing and becomes the whole file once `HEAD` has text for it |
| `seen`, `target` | as today: the trees that listed each site, and the deep sweep's lists |

- `held` at a count of 4 or more; `deep_due` at 3 (FR-004).
- `overridden` ends when a range of the bug is carried through a change (R11).
- A bug with no range left is `ended`.

## Claim check: `claim_checks (repo, tree)` (existing, two fields added)

| Field | Meaning |
|---|---|
| `branch` | the branch the check was launched on, so its completion finds its lineages |
| `lineages` | `{claim id: lineage id}` as settled when the check completed, so a later contest counts on the same lineage without mapping again |

## Not read any more (R14)

`claim_holds (repo, base, file)` and `shim_chains (repo, chain_id)`. Their rows stay in a store that has them.
