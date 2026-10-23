# Contract: core's library surface

The only way into core is importing a module of `core/src` (in a carrier, `${CLAUDE_PLUGIN_ROOT}/core/`). No
command, `bin` or module that acts on import (R25). Every function that touches GitHub takes its client from the
caller (R12). Shapes and errors are in data-model.md. GitHub calls are `async`. The story in brackets is the one
whose PR adds the module (R26).

## `guard.ts` (US1)

`requireDependencies(): void` (R4; contracts/carrying-core.md).

## `github.ts` (US1)

`gitHub(token, api = "https://api.github.com")` → `{rest(method, path, body?), restPages(path), graphql(query,
vars), graphqlPages(query, vars, connectionPath)}`. No token, no client. A GraphQL answer with `errors` throws;
it never returns partial `data` (R12).

## `tree.ts` (US1)

`Tree` = `{listDir(path), readText(path), blobSha(path)}`; `gitTree(checkout, ref)`, `gitHubTree(client, repo,
ref)` (R11).

## `identity.ts` (US1)

`parseBranch(name)`, `specIssue`, `specFolder`, `storyPr`, `storyBranch`, `requirement`, `isDone` (data-model.md,
Story identity). Pure: `parseBranch`, `pickStoryPr(prs, branch)`, `pickSpecFolder(names, p)`, `doneFrom(prs,
closeEvents)`.

## `values.ts` (US1)

The value sets of data-model.md, each `{schema: z.enum, meaning: Record<value, string>}`.

## `contracts/` (US1 SpecFacts, US2 Snapshot, US3 Finding)

`SpecFacts`, `Snapshot`, `Finding` (Zod schemas and their `z.infer` types); `readSpecFacts(text)`.

## `settings.ts` (US2)

`readSettings(tree)` → `Settings` (contracts/codeworks-toml.md).

## `state.ts` (US2)

| Call | Client(s) | Effect |
|---|---|---|
| `readState(reader, repo, issue, reviewerLogin)` → `StateReading` | any token that reads issues | none |
| `writeState(reader, writer, repo, issue, reviewerLogin, snapshot)` | `writer`: reviewer App | one new comment, or `StateWriteRefused` |
| `placeRescopeHold(reader, writer, repo, issue, reviewerLogin)` | `reader` also reads contents and refs | one new comment |
| `releaseState(reader, writer, repo, issue, reviewerLogin)` | `writer`: reviewer App | one new comment; called after a human's Ready |
| `attests(reader, repo, reading, head)` → boolean | reads compares | none |

Pure: `parseState(comments, deletions, reviewerLogin)`, `renderState(snapshot)`, `checkTransition(old, new)`,
`passingHeads(reading)`. Format in contracts/state-comment.md.

## `outcomes.ts` (US3)

`outcomeOf(checkRunOrStatus)` (R17); the `StatusAnswer` and `CouldNotRun` types.

## `validators/` (US3)

`enabledModules(settings, reader, plugin)` → map of `codex` · `coderabbit` · `deepsource` to a module, for those
in `validators`; `plugin` names the caller for the DeepSource `api` source's key read (R23):

| Method | Returns |
|---|---|
| `trigger(pr, head, writer)` | nothing; Codex posts `@codex review` with `writer`; the others do nothing |
| `status(pr, head, timeoutSeconds, requestedBy)` | `StatusAnswer`; `requestedBy` is the login whose request starts Codex's timer |
| `findings(pr, head)` | `Finding[]` or `CouldNotRun`; its own vendor's unresolved threads among them |

`threadsModule(settings, reader)` → `{findings(pr, head), untrusted(pr)}`; throws `SettingsError` when
`trusted_reviewers` is absent. `requiredChecks(settings, reader)` → `{status(pr, head), findings(pr, head)}`, with
no `trigger`, never SILENT.

## `keys.ts` (US3)

`readKey(name, plugin)` → `Buffer` (R23; contracts/key-files.md).

## `tokens.ts` (US5)

`mintToken(app, appId, keyFile, plugin, repo)` → token (R24). `app` is `session` · `orchestrator` · `reviewer`, each
with its permission set. Nothing is cached; two mints are two calls.
