# Contract: gates snapshot (core, PR B)

Owner: `core/src/contracts/gates.ts` (Zod); read/written only through `core/src/state.ts`. Writer: reviewer's hook
as the reviewer App (P6). Reader: reviewer's hook.

## Shape

Every field below is one the Python gates read again in a later run; each cites its reader in
`reviewer/plugin/scripts/` (cc `claimcheck.py`, cg `claimgate.py`, ln `lineage.py`, sc `shimcheck.py`,
sg `shimgate.py`). Open items only: an ended or merged item is absent.

```
Gates   { v: 1, branches: { <branch>: Branch } }
Branch  { anchor: sha40, lineages: Lineage[], bugs: Bug[] }
Lineage { id, file, places: {start, end, claim}[], chain: {ref, claim, line, words, ruling, at}[] }
Bug     { id, members: {tree, at}[], absorbed: {tree, at}[], ranges: {file, old_start, old_count}[],
          deep: {same_operation: string[], callers: string[]} | null,
          rulings: {site, ruling, issue: number | null}[] }
```

| field | why it is kept (reader) |
|---|---|
| `branches` key | lineages, bugs and their text are per branch today (cg:67-70, sg:48, ledger PKs); a lineage id is `hash(file, words)` with no branch (cc:55-62), so two `<s>-us*` branches would collide in one list |
| `anchor` | the commit whose file texts `places` and `ranges` index into; replaces the stored text (cg:67-70, sg:51-54), which is `git show <anchor>:<file>`. Both gates carry to the same commit: the head of the newest completed check on the branch |
| `places[].claim` | a CORRECT removes its places and ends the lineage when none is left (cc:260); words moved unchanged are inherited by claim id (ln:185, ADR-0001 d2) |
| `chain[].ref` | count = distinct checks ruling WRONG (cc:267); one entry per (ref, claim) (cc:250); a contest is its own ref (cc:394-396) |
| `chain[].claim`, `words` | first-words search when no place survived (ln:166) |
| `chain[].line` | the hold question's text (cc:298) |
| `chain[].ruling`, `at` | the counts and release floors below |
| `members`, `absorbed` | a tree in either is never counted again (sc:268); a merge keeps as `members` those of the bug with the higher count (sc:224, ADR-0008 d2) and moves the other's into `absorbed` |
| `ranges` | which bug a change belongs to, by overlap (sc:189); lines are in the anchor's text |
| `deep` | the deep sweep runs once; the next check reuses its lists (sg:219, 258) |
| `rulings` | a site is ruled once per bug (sg:302); not-shared/deferred sites leave the sweep (sg:392); a deferred ruling is dropped once its `issue` closes (sg:284-294) |

Validation: ids unique within a branch's list; times are core `Time`; shas 40 hex.

## Derived, never stored

- Lineage count: distinct `ref` with `ruling = WRONG` and `at` after the newest `/codeworks reset` (ADR-0013 d3).
- `claim-<id>` is placed when that count reaches `REFUSALS_BEFORE_USER = 3` and the hold has no row, or its newest
  row is RELEASED and a WRONG `ref` is later than that release ("until one more WRONG", ADR-0013 d4). A WRONG on
  words of a released hold counts like any other: today's `released.claims` exemption (cc:255, cg:86) is dropped
  with `unlock` (ADR-0013 Option E).
- Bug count: `members` with `at` after the newest reset. `DEEP_AT = 3` makes the deep sweep due; `HOLD_AT = 4`
  places `shim-<id>`. A RELEASED `shim-<id>` lets one commit touching its `ranges` through; that run places the
  hold again ("one such commit", ADR-0013 d4).
- A hold's question (the last WRONG's failing case and evidence, cc:301-306) is written into the hold row when
  it is placed, never into the gates comment.

## Not carried from the ledger

`held`, `ended`, `merged`, `overridden` and `deep_due` states (core's hold row; absent; `override` retired, FR-008;
derived from the count); `opened`; `into`, `ended.by` (read only within a run); `seen` (only the `shim-miss` log,
sg:425-431); ruling `reason`/`evidence` and `released.at` (never read); `released.claims` (dropped, above);
check records, claim reads and verdicts (session memos, FR-017).

## Anchor

A check reads the anchor from the hooks' bare copy; when it is absent (a new session), it is fetched from GitHub.
When GitHub does not have it, the check stops with an error naming the branch and the anchor commit: nothing is
graded and nothing is recorded as passed.

## Comment form

```
<!-- codeworks:reviewer-gates -->
```json
{ "v": 1, "branches": { "42-us1-login": { "anchor": "...", "lineages": [], "bugs": [] } } }
```
```

Same frame as the state comment (`snapshotOf`), different tag.

## Functions

- `readGates(reader, repo, issue, shared): Promise<GatesReading>` — `{gates, comment_url, rebuilt, held, causes}`.
- `writeGates(reader, writer, repo, issue, shared, gates): Promise<void>` — refuses with `StateWriteRefused` on
  tamper, contract break, or over `COMMENT_LIMIT`.

## Tag rules (apply to state and gates alike)

- Each reviewer App comment is classed by its first-line tag; the newest per tag wins.
- The story is held when any reviewer App comment was edited, carries no known tag, or a reviewer App comment
  was deleted after the newest of either tag. Release: Ready move + admin comment (ADR-0011 d2).
- When held-and-released, each tag's snapshot is rebuilt from its newest unedited comment.
