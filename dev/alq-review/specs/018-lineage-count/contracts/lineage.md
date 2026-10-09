# Contract: lineages

What the rest of the plugin, the agent and the user can rely on. Shapes are in [../data-model.md](../data-model.md).

## The module: `scripts/lineage.py`

No I/O. Git's hunks and the texts reach it as arguments.

| Function | Takes | Gives |
|---|---|---|
| `span_of(text, line, quote)` | a file's text, a claim's line and quote | `(start, end)` of the sentence; raises when the words are not there |
| `line_span(text, first, count)`, `lines_of(text, span)` | a range of lines; a span | the span from the start of the first line to the end of the last; the first line and line count a span covers. How a bug's lines are carried by `carry` and turned back |
| `carry(spans, old, new, hunks)` | spans in `old`, the two texts, their `-U0` hunks | each span in `new`, or none when it is gone |
| `succeed(lineages, old, new, hunks, claims, count, ref)` | the file's open lineages, the two texts, their hunks, the claims read in `new`, `count(lineage)` to choose the higher in a merge, and the check ref that ends a lineage | the lineages with places moved and ended ones marked, and `{claim id: [lineage ids]}` |
| `differ()` | | the `diff-match-patch` object, timeout off; raises `Unavailable` naming the install command |

Callers: `claimgate.on_launch`, `on_commit` and the completion step (`carry`, `succeed`);
`shimgate.on_launch`, `on_commit` and `_save` through `shimcheck` (`carry`); all four launch and commit
handlers (`differ`, first).

## What the user types

| Typed | Effect |
|---|---|
| `unlock claim-<id>` | `<id>` is a lineage's id or the id of words it holds now. Those words may be committed. Chain and count stay. Names nothing: says so, changes nothing |
| `override shim-<id>` | as today; lasts until a commit changes the bug's code |

Nothing an agent does lowers a count, releases a hold or starts a lineage again.

## Refusals

| When | Says |
|---|---|
| a claim lineage is held (launch or commit) | stop and ask the user; per lineage its chain, one line per version: `file:line "words" - ruling (check)`; the last failing case and evidence; `unlock claim-<id>` |
| `diff-match-patch` cannot be imported (launch or commit of either check) | the check could not run, not that the work is wrong; the install command; then launch again |
| a shim patch | as today, with each site followed by the lines the staged change alters in its file, or that the file is not in the change |

## Sequences

Each row is one test, written and seen to fail before the code. Counts are after the last step.

### Claims

| # | Steps | Result |
|---|---|---|
| C1 | `WRONG`; reword in place; `WRONG` | one lineage, count 2 |
| C2 | C1; unstage it, commit another file, stage it again; `WRONG` | count 3, held (#15) |
| C3 | C1; amend the last commit | count 2 |
| C4 | at 2; split into two sentences in place | both in the lineage, count 2 |
| C5 | lineages at 1 and 2; merge into one sentence; `WRONG` | one lineage at 3, the other ended `merged` |
| C6 | at 2; delete the words | ended `deleted` |
| C7 | at 2; move the words unchanged within the file; `WRONG` | count 3 |
| C8 | held; `unlock`; commit passes; reword; `WRONG` | held at once, chain whole |
| C9 | a check completes; its completion step runs again | count rises once (#16) |
| C10 | three claims in one hunk of a new file, each `WRONG` once over three checks | three lineages at 1, no hold |
| C11 | two held claims; one hunk rewrites both | both continue, each with its own chain |
| C12 | at 2; move and reword in one step; `WRONG` | new lineage at 1; the old one `deleted` |
| C13 | at 2; move the file; `WRONG` at the new path | new lineage at 1; the old path's `deleted` (ADR-0013) |
| C21 | at 2; the file never committed; unstage it, commit another file | count 2 kept: the file is still on disk |
| C22 | at 2; the file never committed; delete it from disk; a check completes | ended `deleted` |
| C14 | at 2; reflow the paragraph, words unchanged | count 2, same lineage |
| C15 | at 2; reword; `CORRECT`; reword; `WRONG` | first ended `correct`; a new lineage at 1 |
| C16 | `WRONG`; contest rejected | count 2 |
| C17 | at 2; contest upheld as `UNSURE` | count 2 |
| C18 | held; reword without `unlock` | launch refused, still held |
| C19 | at 2; split, second half placed elsewhere | first half in the lineage; second a new claim |
| C20 | lineages at 3 (released) and 1; merge; `WRONG` | held |

### Bugs

| # | Steps | Result |
|---|---|---|
| B1 | patch; commit another file; patch the same lines | one bug, count 2 |
| B2 | bugs at 1 and 3; one change overlaps both; patch | one bug, 3 from the merge and 4 once this patch counts, so held; the other `merged`, its count not raised |
| B3 | a site at line 329; the staged change edits line 333 | the refusal lists 333 for that site |
| B4 | a bug's lines deleted by a commit | bug `ended` |
| B8 | a bug in a never-committed file; unstage it, check another file, stage it again and patch | same bug, count 2 |
| B9 | a bug in a never-committed file; delete it from disk; a check completes | bug `ended` |
| B5 | lines added above a bug by a commit; patch the bug | same bug, count 2 |
| B6 | held; `override`; commit; patch again | held |
| B7 | an overridden bug and another; one change overlaps both | the check is required |

### Both

| # | Steps | Result |
|---|---|---|
| X1 | `diff_match_patch` not importable; launch; commit | both refused, the install command named; in `log` mode recorded only |
| X2 | a character diff over its budget; launch; commit | both refused as a failed check, the next step named (split the change); never a pass; in `log` mode recorded only |
