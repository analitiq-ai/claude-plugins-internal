# Contract: gates section of the state snapshot (core, PR B)

Owner: `core/src/contracts/gates.ts` (Zod), the `gates` field of core's `Snapshot`
(`core/src/contracts/snapshot.ts`); written only by `recordGates` in `core/src/state.ts`. Writer: reviewer's hook as
the reviewer App (P6). Reader: reviewer's hook, through `readState`.

The counts live in the state comment, not a second comment, so a WRONG ruling or bug member and the hold its
count places land in one post: there is no window in which a count is on GitHub and its hold is not.

## Shape

Every field below is one the Python gates read again in a later run; each cites its reader in
`reviewer/plugin/scripts/` (cc `claimcheck.py`, cg `claimgate.py`, ln `lineage.py`, sc `shimcheck.py`,
sg `shimgate.py`). Open items only: an ended or merged item is absent.

```
Snapshot.gates: Gates | null    (null until the story's first check; v is the snapshot's)
Gates   { branch, anchor: sha40, lineages: Lineage[], bugs: Bug[] }
Lineage { id, file, places: {start, end, claim}[], chain: {ref, claim, line, words, ruling, at}[] }
Bug     { id, members: {tree, at}[], absorbed: {tree, at}[], ranges: {file, old_start, old_count}[],
          deep: {same_operation: Site[], callers: Site[]} | null,
          rulings: {site, ruling, issue: number | null}[] }
Site    { file, line, function, does }
```

| field | why it is kept (reader) |
|---|---|
| `branch` | a story issue has one branch (root ADR-0005, reviewer ADR-0015 context), so the story's snapshot holds that branch's items; lineages, bugs and their text are per branch today (cg:67-70, sg:48, ledger PKs). A check on another branch stops with an error naming both, never mixing two branches' items under one hold id |
| `anchor` | the commit whose file texts `places` and `ranges` index into; replaces the stored text (cg:67-70, sg:51-54), which is `git show <anchor>:<file>`. Both gates carry to the same commit: the head of the newest completed check on the branch |
| `places[].claim` | a CORRECT removes its places and ends the lineage when none is left (cc:260); words moved unchanged are inherited by claim id (ln:185, ADR-0001 d2) |
| `chain[].ref` | count = distinct checks ruling WRONG (cc:267); one entry per (ref, claim) (cc:250); a contest is its own ref (cc:394-396) |
| `chain[].claim`, `words` | first-words search when no place survived (ln:166) |
| `chain[].line` | the hold question's text (cc:298) |
| `chain[].ruling`, `at` | the counts and release floors below |
| `members`, `absorbed` | a tree in either is never counted again (sc:268); a merge keeps as `members` those of the bug with the higher count (sc:224, ADR-0008 d2) and moves the other's into `absorbed` |
| `ranges` | which bug a change belongs to, by overlap (sc:189); lines are in the anchor's text |
| `deep` | the deep sweep runs once; the next check reuses its lists (sg:172-175, 219, 258). A site keeps `file`, `function` (site id, sc:35-36, 67), `line` (its range, sc:120-121) and `does` (the judge's prompt, jev.py:109-110) |
| `rulings` | a site is ruled once per bug (sg:302); not-shared/deferred sites leave the sweep (sg:392); a deferred ruling is dropped once its `issue` closes (sg:284-294) |

Validation: ids unique within each list; times are core `Time`; shas 40 hex.

## Derived, never stored

- Lineage count: distinct `ref` with `ruling = WRONG` and `at` after the newest `/codeworks reset` (ADR-0013 d3).
- `claim-<id>` is placed when that count reaches `REFUSALS_BEFORE_USER = 3` and the hold has no row, or its newest
  row is RELEASED and a WRONG `ref` is later than that release ("until one more WRONG", ADR-0013 d4). A WRONG on
  words of a released hold counts like any other: today's `released.claims` exemption (cc:255, cg:86) is dropped
  with `unlock` (ADR-0013 Option E).
- Bug count: `members` with `at` after the newest reset. `DEEP_AT = 3` makes the deep sweep due; `HOLD_AT = 4`
  places `shim-<id>`. A RELEASED `shim-<id>` lets one commit touching its `ranges` through; that run places the
  hold again ("one such commit", ADR-0013 d4).
- A `claim-<id>` hold's question (the last WRONG's failing case and evidence, cc:301-306) is written into the
  hold row in the post that records that WRONG, never into `gates`. Core's snapshot contract allows a question only on
  `escalation-` holds today (`core/src/contracts/snapshot.ts:53`); PR B extends it to `claim-` holds.

## Not carried from the ledger

`held`, `ended`, `merged`, `overridden` and `deep_due` states (core's hold row; absent; `override` retired, FR-008;
derived from the count); `opened`; `into`, `ended.by` (read only within a run); `seen` (only the `shim-miss` log,
sg:425-431); ruling `reason`/`evidence` and `released.at` (never read); `released.claims` (dropped, above);
check records, claim reads and verdicts (session memos, FR-017).

## Anchor

A check reads the anchor from the hooks' bare copy; when it is absent (a new session), it is fetched from GitHub.
When GitHub does not have it, the check stops with an error naming the branch and the anchor commit: nothing is
graded and nothing is recorded as passed.

## Functions

- Read: `readState(...)` → `snapshot.gates`; one reading per run (FR-004).
- `recordGates(reader, writer, repo, issue, shared, read: StateReading, gates: Gates, openings: Opening[]): Promise<void>`
  with `Opening {id: "claim-<id>" | "shim-<id>", question: string | null}`: one post of the snapshot `read` holds,
  with `gates` replaced and each opening placed (a hold with no row, or a new row after a RELEASED one). A hold
  already OPEN is left as it is; the `gates` change is posted regardless. Refuses with `StateWriteRefused`, posting
  nothing, on tamper, contract break, a `gates` on GitHub differing from `read`'s (a stale reading), or the size rule.
- `writeState`, `placeHold`, `placeRescopeHold` and `releaseOnClaim` refuse a snapshot whose `gates` differs from
  the one they read (`checkTransition`): only `recordGates` changes `gates`, so no write built from an older
  reading drops a count.

## Size rule

All writers share the state comment's `COMMENT_LIMIT` (65 536). `recordGates` refuses unless the snapshot it would
post still fits after every OPEN hold is released and one more round of the largest size the snapshot contract
allows is appended. A count can therefore never take the room a release needs: an admin's release and the next
round always fit. The refusal names the snapshot's size, that reserve and the limit; nothing is dropped to fit.

## Comment form

The state comment (`STATE_TAG`, `snapshotOf`'s frame), its snapshot carrying `gates`:

```json
{ "v": 1, "rounds": [], "holds": [], "pushbacks": [],
  "gates": { "branch": "42-us1-login", "anchor": "...", "lineages": [], "bugs": [] } }
```
