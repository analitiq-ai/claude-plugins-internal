# Data Model

## Location comment (the issue's one `<!-- analitiq-spec -->` comment)

Plain text; first line is the marker `<!-- analitiq-spec -->`, then `key: value` lines.

| Form | Lines after the marker |
|---|---|
| Located | `spec: <folder path from the repo root>` then `branch: <branch that holds it>` |
| No spec needed | `spec: none` then `reason: <one line>` |

Rules, each a refusal when broken (FR-010): exactly the lines of one form, in that order, one `key: value` per
line, values non-empty and single-line; `spec` has no `..` part, is not absolute, and its last-but-one part is
`specs`; at most one such comment on the issue. Anything else, including the marker followed by a whole spec, is
malformed.

## Parsed values (`speclocation.py`)

- `Located(folder: str, branch: str)`
- `NoSpec(reason: str)`
- `FoundSpec(folder: str, text: str)`: `text` is `spec.md` as committed at HEAD of the checkout.
- `SpecLocationError(RuntimeError)`: message = what is missing + one next step.

## Resolution (`resolve(slug, branch, root)`)

```
branch --issue_number (in speclocation.py)--> issue | None ──None──> None (no spec handed; FR-014)
issue --github.issue_spec--> (id, body) | None ──None──> refuse: run design-doc
body --parse--> NoSpec(reason) ──> returned as it is
              \-> Located
Located.folder in root?            no ──> refuse: names folder + Located.branch
spec.md at HEAD, non-empty?        no ──> refuse: as folder missing
                                   yes ─> FoundSpec(folder, text)
```

`gh` failing at the second arrow raises `RuntimeError` in gh's words (not a `SpecLocationError`).

## State transitions of the comment

absent → (design-doc run completes, or `none`) → present → (re-run / `none` again) → updated in place.
It is never deleted by the plugin, and a run that aborts leaves it as it was.
