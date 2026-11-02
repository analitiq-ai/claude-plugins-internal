# Contract: grammars in the spec folder

## Path

One grammar for both artifacts, one function in core (`artifactPath`, `core/src/contracts/decision-check.ts`):

`PATH` = `^[A-Za-z0-9._-]+(/[A-Za-z0-9._{},-]+)*$`, no segment `.` or `..`, at most one `{a,b,…}` group, which is
expanded (a second group is refused). A path with no `/` is a file at the checkout root.

## `plan.md` `## Touches`

```markdown
## Touches

- `core/src/adr-folders.ts`
- `codeworks.toml`
```

Under the one `## Touches` heading, every line starting `- ` is `` - `<PATH>` `` and nothing else; other lines
(prose, comments) are ignored. A `- ` line not in that form refuses the section (exit 1, naming `plan.md:<line>`).
No such line, or no heading: could not run, naming the artifact.

## `tasks.md` task lines

A task line starts `- [ ] T<n>` or `- [x] T<n>` (any case of `x`). Its paths are its backticked spans that are a
`PATH`: a span with a `/` always; a span with no `/` only when it names a file at the checkout root (git's answer:
`git ls-files` at the root, read by the ask step and passed to the pure reader). A span with a second `{…}` group is
refused (exit 1, naming `tasks.md:<line>`). Its story is `US<k>` from a `[US<k>]` tag, else the text of the
`## Phase` heading above it. No path on any task line: could not run.

## Rulings file (`<spec folder>/adr-rulings.json`)

```json
{"v": 1, "rulings": [
  {"folder": "docs/adr", "record": "0004", "path": "core/src/adr.ts", "reason": "…"}
]}
```

- Holds only the user's rulings: each one `AdrRuling`, all four fields non-empty strings, no other key; `folder`
  is the entry as written in `[shared] adr_folders`; `path` a `PATH`. Key: `(folder, record, path)`, no key twice.
- No file: no ruling. A file that does not parse is refused (exit 1), never read as empty.
- Writer: the decide step only (R9). Readers: the judge, every later decide, reviewer's decision check (US5).
- Every entry must be in the file at `HEAD` or in `<run>/adr-rulings-written.json`; any other entry makes the
  check could not run, naming it (R9).

## `ADR_RULING` (one resume's ruling)

A JSON array of `AdrRuling`, set by `drive_workflow.py resume <run> adr_ruling=<json>` for that invocation only.
Decide refuses a ruling (exit 1, naming it) only when its folder is not listed, its path is not an asked path, or
`checkAdrFolder(folder, [path])`, called once for that ruling, does not name its record as governing (a call that
could not run is exit 2). Entries already in the rulings file are not re-checked. A valid ruling is appended to
the rulings file whether or not the judge named that departure this time; one whose key is already there is
satisfied, not refused. Empty or unset: no ruling.
