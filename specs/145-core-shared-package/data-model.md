# Data model: core

Shapes core defines. The three contracts are Zod strict objects with generated JSON Schemas (R8); the rest are
return types of core's functions, TypeScript types, not contracts. Contract fields are snake_case, as the JSON is
written.

## Value sets (`core/src/values.ts`, R7; FR-012a)

Each set once, value → meaning, with a `z.enum` over its values (root ADR-0010).

| Set | Values | Used by |
|---|---|---|
| Round result | CLEAN, DIRTY, INCOMPLETE | Snapshot round |
| Round verdict | PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK, ESCALATE | Snapshot round, DIRTY only |
| Finding ruling | FIX, PUSH_BACK, DEFER | defined for readers; no core field in this spec |
| Root cause | AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL, NOT_APPLICABLE | Snapshot round |
| Check outcome | PENDING, PASS, FAIL, SILENT, COULD_NOT_RUN, WAIVED | module and reader answers |
| Hold kind | rescope, escalation, pushback, claim, shim, audit | Snapshot hold |
| Hold state | OPEN, RELEASED | Snapshot hold |
| Round stage | INTERNAL, AUDIT, GITHUB | Snapshot round, pushback |
| Module name | codex, coderabbit, deepsource, threads, required-checks | Finding `source`; `validators` takes the first three |

Hold kind and module name are lower case: a hold kind is a hold id's prefix, a module name a `codeworks.toml`
entry and part of a check name (root ADR-0010 d2).

## Contracts

### Finding (FR-012)

| Field | Type | Rule |
|---|---|---|
| `source` | module name | the module that returned it |
| `key` | string, non-empty | names one item across heads; below |
| `author` | string | REST login (`name[bot]` for an App, GraphQL's bare `Bot` login gaining `[bot]`); for a required check, its App slug |
| `file` | string or null | repo-relative path |
| `line` | integer ≥ 1 or null | |
| `text` | string | the item's text, or a thread's first comment |
| `thread_id` | string or null | GraphQL node id |
| `resolvable` | boolean | true exactly when `thread_id` is set |
| `trusted_comments` | list of `{id, author, body}` | a thread's comments by trusted authors, oldest first; empty without a thread |
| `latest_trusted_comment_id` | string or null | set exactly when `thread_id` is set |

| Source | `key` |
|---|---|
| any thread | `thread:<thread_id>` |
| CodeRabbit outside-diff item | `coderabbit:<cr-comment id>` (R19) |
| DeepSource item with no thread | `deepsource:<path>:<issue code, else annotation title>:<SHA-256 of the message, hex>` (R20) |
| required check | `required-check:<check name>` (R22) |

A thread's finding is identified across heads by its thread and `latest_trusted_comment_id` (reviewer ADR-0016
d3).

### Snapshot (FR-012, FR-017)

```text
Snapshot
  v: 1
  rounds: [Round]          # oldest first; the newest is last
  holds: [Hold]            # one row per id; a released hold keeps its row
  pushbacks: [Pushback]

Round
  stage: Round stage
  n: int ≥ 1               # per stage
  head: 40-hex sha
  result: Round result
  verdict: Round verdict or null      # non-null exactly when result is DIRTY
  root_cause: Root cause or null      # reviewer ADR-0017 d2

Hold
  id: string               # "<kind>-<issue>", but "claim-<lineage id>" and "shim-<bug id>" (reviewer ADR-0013 d1)
  kind: Hold kind
  state: Hold state
  spec_md_blob: 40-hex sha or null    # non-null exactly when kind is rescope

Pushback
  key: string              # a Finding key
  round: {stage, n}        # names a round in rounds
```

Checked by the schema and its refinements: `(stage, n)` unique; hold `id` unique and starting `<kind>-`; the
`verdict` and `spec_md_blob` rules above; each pushback's round exists.

Transitions a write may make against the current snapshot (R16): append rounds; add hold rows; move a hold
`OPEN → RELEASED` or `RELEASED → OPEN`; add pushbacks. Nothing else is removed or rewritten: a rescope row's
`spec_md_blob` changes only with its `RELEASED → OPEN` move (R16).

### SpecFacts (FR-010; planner ADR-0008 d1)

```text
codeworks:
  v: 1
  kind: "feature" | "defect" | "no_spec"
  root_cause:
    observed: "anchored" | "hypothesis" | "none"
```

`kind` and `observed` are named enums, `SpecKind` and `RootCauseObserved`, exported from
`contracts/spec-facts.ts` and covered by the value-string test (R7). Read from `spec.md` front matter (R9).
Missing, unparsable or refused → derivation fails naming the file.

## Return types

### Branch (R10)

`{story: number, k: number, slug: string}` · `{spec: number}` · `null`.

### Story identity (R13)

| Function | Returns | Fails when |
|---|---|---|
| `specIssue(reader, repo, s)` | number | parent in another repo |
| `specFolder(tree, p)` | `specs/<p>-…` | none or several |
| `storyPr(reader, repo, branch)` | `{number, head, merged}` or null | |
| `storyBranch(reader, repo, s)` | string or null | several |
| `requirement(tree, folder, issueBody)` | `{kind, text, source}` | facts missing or invalid |
| `isDone(reader, repo, s)` | boolean | |

### Settings (R14)

`{shared: Shared, section(name): unknown}`; `section` returns the component's parsed table, or `{}` when the file
has none. `Shared` in contracts/codeworks-toml.md.

### StateReading (R15; FR-016, FR-017)

| Field | Type |
|---|---|
| `snapshot` | Snapshot or null |
| `comment_url` | string or null |
| `held` | boolean |
| `causes` | list of `{cause: "tampered"}`, `{cause: "deleted"}`, `{cause: "invalid", error}`, `{cause: "open_hold", id}` |
| `newest_round` | Round or null |
| `pushed_back` | map finding key → `{stage, n}` |

`held` is true exactly when `causes` is not empty. No snapshot and no cause is "no state", not held. Causes are a
`StateReading` field, not a value set: no component but core writes or compares them. `attests(reader, repo,
reading, head)` is R16's predicate; `passingHeads(reading)` lists the commits of INTERNAL and AUDIT rounds that
passed, newest first. The state comment's `createdAt` orders it against deletions (R15).

### Module answers (R17; FR-022 to FR-024)

- `status(...)` → `{outcome: Check outcome, reason: string | null}`; `reason` is set for SILENT, WAIVED and
  COULD_NOT_RUN.
- `findings(...)` → `Finding[]` or `{outcome: COULD_NOT_RUN, reason}`; never an empty list in place of the
  latter.

### UntrustedThread (FR-029)

`{thread_id, url, author}`, from the threads module beside its findings.

### Errors

| Error | Thrown by | Meaning |
|---|---|---|
| `MissingDependency(name, root)` | `guard.ts` | a core dependency is not installed (FR-003) |
| `GitHubUnanswered(reason)` | the client | no answer; modules turn it into COULD_NOT_RUN at their boundary (R12) |
| `GitHubRefused(status, message)` | the client | GitHub answered 4xx |
| `DerivationError(what, found)` | identity | names what was found |
| `SettingsError(where, why)` | settings | file missing or `[shared]` refused |
| `StateWriteRefused(cause, release)` | state | a write while held, one that drops a row, or one over the size limit |
| `KeyReadRefused(path, reasons)` | keys | settings not in effect, file mode or owner, platform |
| `MintError(cause)` | tokens | never falls back |

### Minted token (R24)

`{value, app, repo, expires_at, permissions}`; `value` is never logged or put in an error.

## Where each shape lives

| Shape | File |
|---|---|
| value sets | `core/src/values.ts` |
| Finding, Snapshot, SpecFacts | `core/src/contracts/{finding,snapshot,spec-facts}.ts`; schemas in `core/schemas/` |
| Shared | `core/src/settings.ts` |
| Branch, identity | `core/src/identity.ts` |
| StateReading | `core/src/state.ts` |
| check-outcome mapping, module answers | `core/src/outcomes.ts` |
| token | `core/src/tokens.ts` |
