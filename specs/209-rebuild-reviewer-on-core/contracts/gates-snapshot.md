# Contract: gates snapshot (core, PR B)

Owner: `core/src/contracts/gates.ts` (Zod); read/written only through `core/src/state.ts`. Writer: reviewer's hook
as the reviewer App (P6). Reader: reviewer's hook.

## Comment form

```
<!-- codeworks:reviewer-gates -->
```json
{ "v": 1, "lineages": [...], "bugs": [...] }
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
