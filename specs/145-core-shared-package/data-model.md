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

Hold kinds are lower case: a hold kind is a hold id's prefix (root ADR-0010 d2).

**Finding source** (root ADR-0010 d2): `threads` or `required-checks` (the enum `CoreSource`), or a `ModuleName`:
`^[a-z][a-z0-9-]*$` and neither of those two. A `ModuleName` is a package's folder name, a `[shared] validators`
entry and part of the check name `<module>-review`.

## Contracts

### Finding (FR-012)

| Field | Type | Rule |
|---|---|---|
| `source` | Finding source | the module that returned it |
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
| a module's item with no thread | `<module>:<id>`, the id its package's spec fixes |
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
  at: time                 # when it was recorded, set by writeState

Hold
  id: string               # "<kind>-<issue>", but "claim-<lineage id>" and "shim-<bug id>" (reviewer ADR-0013 d1)
  kind: Hold kind
  state: Hold state
  since: time              # GitHub's time just before the comment that placed it was posted
  released: time or null   # non-null exactly when state is RELEASED
  released_by: {comment: int, reset: bool} or null   # the releasing comment's databaseId; non-null exactly when RELEASED
  question: string or null # non-null, non-empty exactly when kind is escalation (orchestrator ADR-0010 d1)
  spec_pr: int ≥ 1 or null # the spec PR that placed it; null for every kind but rescope, and for a rescope placed by a verdict

Pushback
  key: string              # a Finding key
  round: {stage, n}        # names a round in rounds
```

A `time` is `YYYY-MM-DDTHH:MM:SSZ`, UTC, whole seconds, from the client's `now()`; no caller supplies one.

Checked by the schema and its refinements: `(stage, n)` unique; hold `id` unique and starting `<kind>-`; the
`verdict`, `released`, `released_by`, `question` and `spec_pr` rules above; each pushback's round exists.

Transitions against the current snapshot (R16), each by one call:

| Call | May |
|---|---|
| `writeState` | append rounds, setting each one's `at`; add pushbacks; no hold row changes |
| `placeHold` | add a row OPEN, or move one `RELEASED → OPEN`, setting `since` and `question`, clearing `released` and `released_by` |
| `placeRescopeHold` | set `rescope-<issue>` OPEN when absent, RELEASED or recording another spec PR, setting `since` and `spec_pr`, clearing `released` and `released_by` |
| `releaseOnClaim` | move releasable rows `OPEN → RELEASED`, setting `released` and `released_by` |

Nothing else is removed or rewritten.

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
| `requirement(tree, folder, issueBody)` | `{kind, text, source}` | facts missing or invalid |
| `isDone(reader, repo, s)` | boolean | |

### Settings (R14)

`{shared: Shared, section(name): unknown}`; `section` returns the component's parsed table, or `{}` when the file
has none. `Shared` in contracts/codeworks-toml.md.

### StateReading (R15; FR-016, FR-017)

| Field | Type |
|---|---|
| `snapshot` | the working snapshot (R15 step 3), or null when there is no state |
| `comment_url` | the state comment's URL, or null |
| `rebuilt` | true when `snapshot` is not the state comment's |
| `held` | boolean |
| `causes` | list of `{cause: "tampered"}`, `{cause: "deleted"}`, `{cause: "invalid", error}`, `{cause: "open_hold", id}` |
| `newest_round` | Round or null |
| `pushed_back` | map finding key → `{stage, n}` |
| `releasable` | list of `{id, comment: {id, url, at}, reset}`: each open hold a start releases and the comment that releases it (contracts/state-comment.md, Release) |
| `tamper_released` | true when a `tampered`, `deleted` or `invalid` cause stands and a Ready move and a human comment release it |
| `startable` | true when every tamper cause is released and every open hold is in `releasable` |
| `reset` | `{url, at}` of the newest human `/codeworks reset`, or null |

`held` is true exactly when `causes` is not empty. No snapshot and no cause is "no state", not held. Causes are a
`StateReading` field, not a value set: no component but core writes or compares them. The state comment's
`createdAt` orders it against deletions (R15). Every field comes from one pure function over one read (R15, R27);
reviewer and the orchestrator read the same answer.

### Attestation (R16)

`attests(checkout, reading, head, base, specFolder)` → `{attested: boolean, reason: string | null}`; `reason`
names the lapse (governing paths, the merge commit, the releasing hold), the holding cause, or "no passing round".

### Validator package and modules (R18, R19; FR-022 to FR-025)

- A package's `index.ts`: `logins: string[]`; `open(deps)` → `{trigger, status, findings}`, each `(repo, pr,
  head)`. Its `status` answers `{outcome: PENDING | PASS | FAIL | WAIVED, head: sha | null, reason: string |
  null}`; its `findings` a list of Findings.
- `deps`: `{reader, writer, readKey(file), providerThreads(repo, pr)}`.
- `Validators` from `loadValidators`: `{modules: Map<ModuleName, Module>, logins: Set<string>}`; a `Module` is
  the package's three functions with the `deps` and `shared` it was loaded with.
- Core's answers: `status(...)` → `{outcome: Check outcome, reason: string | null}`, `reason` set for SILENT,
  WAIVED and COULD_NOT_RUN; `findings(...)` → `Finding[]` or `{outcome: COULD_NOT_RUN, reason}`, never an empty
  list in place of the latter; `trigger(...)` → nothing or `{outcome: COULD_NOT_RUN, reason}`.

### UntrustedThread (FR-029)

`{thread_id, url, author}`, from the threads module beside its findings.

### Errors

| Error | Thrown by | Meaning |
|---|---|---|
| `MissingDependency(name, root)` | `guard.ts` | a core dependency is not installed (FR-003) |
| `GitHubUnanswered(reason)` | the client | no answer (R12) |
| `GitHubRefused(status, message)` | the client | GitHub answered 4xx |
| `GitFailed(args, code, stderr)` | `git.ts` | git exited with a code its caller did not name as an answer |
| `DerivationError(what, found)` | identity | names what was found |
| `SettingsError(where, why)` | settings | file missing or `[shared]` refused |
| `BoardNotVisible(board)` | state | the issue has no item on `[shared] board` the reader sees |
| `StateWriteRefused(cause, release)` | state | a write while a tampered, deleted or invalid cause stands, one that drops or rewrites a row or changes a hold outside its call, a `rescope` kind through `placeHold`, an escalation without a question, or one over the size limit |
| `ValidatorLoadError(name, why)` | validation | a `validators` entry outside `ModuleName`, with no package, or a package missing a part of the contract |
| `KeyReadRefused(path, reasons)` | keys | not a bare file name, settings not in effect or not the one source, file mode or owner, platform |
| `MintError(cause)` | tokens | never falls back |

### Minted token (R24)

`{value, app, repo, expires_at, permissions}`; `value` is never logged or put in an error.

## Where each shape lives

| Shape | File |
|---|---|
| value sets, finding source | `core/src/values.ts` |
| Finding, Snapshot, SpecFacts | `core/src/contracts/{finding,snapshot,spec-facts}.ts`; schemas in `core/schemas/` |
| Shared | `core/src/settings.ts` |
| Branch, identity | `core/src/identity.ts` |
| StateReading, the release rule | `core/src/state.ts` |
| attestation | `core/src/attest.ts` |
| required checks' outcome mapping | `core/src/outcomes.ts` |
| validator contract, Validators, module answers | `core/src/validation/contract.ts` |
| token | `core/src/tokens.ts` |
