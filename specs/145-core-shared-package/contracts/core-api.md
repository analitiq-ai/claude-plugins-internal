# Contract: core's library surface

The only way into core is importing a module of `core/src` (in a carrier, `${CLAUDE_PLUGIN_ROOT}/core/`). No
command, `bin` or module that acts on import (R25). Every function that touches GitHub takes its client from the
caller (R12). Shapes and errors are in data-model.md. GitHub calls are `async`. The story in brackets is the one
whose PR adds the module (R26).

## `guard.ts` (US1)

`requireDependencies(): void` (R4; contracts/carrying-core.md).

## `github.ts` (US1)

`gitHub(token, api = "https://api.github.com")` → `{rest(method, path, body?), restPages(path), graphql(query,
vars), graphqlPages(query, vars, connectionPath), now()}`. No token, no client. A GraphQL answer with `errors`
throws; it never returns partial `data`. `now()` is GitHub's time, from the `Date` of `GET /rate_limit` (R12).

## `git.ts` (US1)

`runGit(checkout, args, answers = [])` → `{code, stdout}`: git with no global or system config, no credential
helper, `core.fsmonitor` and `core.hooksPath` off; an exit code outside 0 and `answers` throws `GitFailed` (R11).

## `tree.ts` (US1)

`Tree` = `{listDir(path), readText(path)}`; `gitTree(checkout, ref)`, `gitHubTree(client, repo, ref)` (R11).

## `identity.ts` (US1)

`parseBranch(name)`, `specIssue`, `specFolder`, `storyPr`, `requirement`, `isDone` (data-model.md, Story
identity). Pure: `parseBranch`, `pickStoryPr(prs, branch)`, `pickSpecFolder(names, p)`, `doneFrom(prs,
closeEvents)`.

## `values.ts` (US1)

The value sets of data-model.md, each `{schema: z.enum, meaning: Record<value, string>}`; `CoreSource`,
`ModuleName` and `FindingSource`.

## `contracts/` (US1 SpecFacts, US2 Snapshot, US3 Finding)

`SpecFacts`, `Snapshot`, `Finding` (Zod schemas and their `z.infer` types); `readSpecFacts(text)`.

## `settings.ts` (US2)

`readSettings(tree)` → `Settings` (contracts/codeworks-toml.md).

## `state.ts` (US2)

`shared` is the `[shared]` section: its four App logins and `board`. Every write reads first and posts at most one
comment with `writer`, the reviewer App's client; refusals throw `StateWriteRefused`.

| Call | Client(s) | Effect |
|---|---|---|
| `readState(reader, repo, issue, shared)` → `StateReading` | a token that reads issues and the board: the session App's or the orchestrator App's | none |
| `writeState(reader, writer, repo, issue, shared, snapshot)` | `writer`: reviewer App | rounds, stamped with `at`, and pushbacks appended |
| `placeHold(reader, writer, repo, issue, shared, {id, kind, question})` | as above | a hold row OPEN; not `rescope` |
| `placeRescopeHold(reader, writer, repo, issue, shared, specPr)` | as above | `rescope-<issue>` OPEN recording `specPr`, a number or null |
| `releaseOnClaim(reader, writer, repo, issue, shared)` → `{released, rebuilt, reset}` | `writer`: reviewer App | every releasable hold released, each with its comment, and a released tamper cause's working snapshot posted; reviewer calls it on the orchestrator's claim |

The orchestrator reads `StateReading.startable` to stop a start (orchestrator ADR-0002 d3); reviewer releases with
`releaseOnClaim`. Both get their answer from one pure function, `stateFrom(...)`.

Pure: `stateFrom(comments, deletions, moves, shared)`, `renderState(snapshot)`, `checkTransition(old, new)`,
`questionTag(hold)`. Format and rules in contracts/state-comment.md.

## `attest.ts` (US2)

`attests(checkout, reading, head, base, specFolder)` → `{attested, reason}`, reading git through `runGit` in a
clone holding `head` and `base` (R16). Pure: `passingRounds(snapshot)`, `governingDiff(atBase, atRound,
specFolder)`, `releasedByComment(snapshot, round)`.

## `outcomes.ts` (US3)

`outcomeOf(checkRunOrStatus)`, the required checks' mapping (R17); the `StatusAnswer` and `CouldNotRun` types.

## `validation/` (US3)

`contract.ts`: `loadValidators(shared, dir, deps)` → `Validators` (R18); `dir` is the caller's validators folder,
`${CLAUDE_PLUGIN_ROOT}/validators` in a carrier. A loaded module carries the `deps` and `shared` it was loaded
with: its client's `now()` times SILENT, and `shared`'s App logins filter its findings. Core's answers over a
loaded module (R19):

| Call | Returns |
|---|---|
| `trigger(module, repo, pr, head)` | nothing, or COULD_NOT_RUN |
| `status(module, repo, pr, head, {timeoutSeconds, since})` | `StatusAnswer`; PASS or FAIL only for the head asked; SILENT once `timeoutSeconds` has run from `since` |
| `findings(module, repo, pr, head)` | `Finding[]` or `CouldNotRun`; its provider's unresolved threads among them |

`threads.ts`: `threadsModule(shared, reader, validators)` → `{findings(repo, pr, head), untrusted(repo, pr)}`;
throws `SettingsError` when `trusted_reviewers` is absent (R21). `required-checks.ts`: `requiredChecks(shared,
reader, validators)` → `{status(repo, pr, head), findings(repo, pr, head)}`, with no `trigger`, never SILENT
(R22).

## `keys.ts` (US3)

`readKey(file, plugin)` → `Buffer` (R23; contracts/key-files.md). A package gets it bound to the caller's plugin
as `deps.readKey`.

## `tokens.ts` (US5)

`mintToken(app, appId, keyFile, plugin, repo)` → token (R24). `app` is `session` · `orchestrator` · `reviewer` ·
`planner`, each with its permission set; `appId` comes from the caller's own section. Nothing is cached; two mints
are two calls.
