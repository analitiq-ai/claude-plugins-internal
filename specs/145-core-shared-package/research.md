# Research: core, the shared package every Codeworks component imports

Read for this: `spec.md` (Clarifications through Session 2026-10-27, records of #153); the constitution 1.2.2; root ADR-0001
to ADR-0010; orchestrator ADR-0001, 0002, 0004, 0007 to 0010; reviewer ADR-0011, 0013, 0016, 0017, 0019; planner
ADR-0008; builder ADR-0003, 0004; `SECURITY.md` §2, §3, §5 and §7; all as on branch `145-spec` at e476454, whose
records are commit ab83f33, and for Session 2026-10-27 the records as #153 merged them (main at 74ef3d1). Also `.github/workflows/tests.yml`, `.gitignore`, `.deepsource.toml`,
`.claude-plugin/marketplace.json`; `reviewer/plugin/scripts/{specbinding,policy,ledger}.py` (parts);
`reviewer/plugin/skills/github-pr-review/poll-pr-review.sh`; the org gate
`analitiq-org-github/.github/scripts/pr-gate.js`; Claude Code's plugin docs (manifest reference, plugin loading,
host a marketplace, plugin commands).

Tested on Claude Code 2.1.308 (spec Clarifications), not re-run: a symlink inside a plugin to elsewhere in the same
git-hosted marketplace is copied into the installed plugin as files; with `version` pinned, a core-only change is
not delivered on update and a bump delivers it; Claude Code installs a plugin's npm dependencies from
`package.json` and a lockfile at the plugin root (registry only, `--ignore-scripts`) and no Python dependency; a
failed npm install still loads the plugin.

Run on the planning machine (Linux) on 2026-10-22, not re-run: `node --version` → v22.18.0 (still so today),
`npm --version` → 10.9.3. In a scratch folder: a `.ts` file with type annotations and a `.ts` import runs under
plain `node`; a TS `enum` is refused at run time; `typeof fetch` and `crypto.createSign` exist; zod 4.6.7
`z.toJSONSchema` writes `enum` and `additionalProperties: false` for a strict object; smol-toml 1.9.1 and yaml 2.9.1
parse a sample; an RS256 signature from `node:crypto`; `import.meta.resolve` of a missing package throws
`ERR_MODULE_NOT_FOUND`; `node --test 'tests/**/*.test.ts'` runs a TS test; typescript 7.0.2 `tsc` with
`erasableSyntaxOnly` refuses the `enum` and passes the rest; `python3 -m unittest` in a folder with no tests exits
5; a `.ts` file starts in about 84 ms bare and 155 ms importing zod, smol-toml and yaml (seven runs each). `npm
view` lists no dependencies for zod 4.6.7, smol-toml 1.9.1 or yaml 2.9.1.

Run on 2026-10-26 in a scratch repository, git 2.47.3: `git merge-tree --write-tree` of a clean merge's two
parents gives that merge's own tree, differs from it once the merge is amended, and exits 1 on a conflict; `git
merge-base --is-ancestor` of an unknown commit exits 128. Nothing else below was run.

## R1: Language and runtime, with no build step

- **Decision**: TypeScript run directly by Node's type stripping, Node 22.18 or later (`engines` in
  `core/package.json`). Only erasable syntax: no `enum`, `namespace` or parameter properties; relative imports
  name the `.ts` file; types are imported with `import type`. `tsconfig.json` sets `strict`, `noEmit`,
  `erasableSyntaxOnly`, `allowImportingTsExtensions`, `verbatimModuleSyntax`, `module`/`moduleResolution`
  `nodenext`; CI type-checks with `tsc` (devDependency). Hooks run `node <file>.ts`.
- **Rationale**: root ADR-0009 d1. A plugin install copies files and runs no build, so what ships is what runs;
  type stripping needs no compiler at run time and no committed `dist/` beside the source. `erasableSyntaxOnly`
  makes the type check refuse what Node would refuse at run time (both seen).
- **Existing tools**: Node's built-in type stripping (on by default from 22.18); `tsc` 7.0.2.
- **Alternatives considered**: compile to JS and commit the output (two copies of one source that can drift); a
  loader such as `tsx` (a runtime dependency and a slower start for every hook).

## R2: core's layout and dependencies

- **Decision**: `core/` holds `package.json` (private, `"type": "module"`, exact pins, no `bin`),
  `package-lock.json`, `tsconfig.json`, `src/` (the package a plugin's symlink names, FR-001), `schemas/`
  (generated JSON Schemas), `scripts/` (repo-only: `write-schemas.ts`, `check-carriers.ts`), `tests/` and
  `docs/adr/`. Runtime dependencies, each exact: `zod` 4.6.7 (R7, R8), `smol-toml` 1.9.1 (R14), `yaml` 2.9.1 (R9).
  devDependencies, exact: `typescript` 7.0.2, `@types/node` 22.20.5. GitHub calls use Node's `fetch`; JWT signing
  uses `node:crypto`; tests use `node:test`. `.gitignore` gains `node_modules/`.
- **Rationale**: root ADR-0009 d3 keeps the dependencies few; none of the three has a dependency of its own. The
  standard library covers HTTP, signing and tests. Only `src/` ships, so tests, scripts, schemas and records never
  reach a plugin (constitution, Repo shape).
- **Existing tools**: npm 10 (writes lockfile v3, which Claude Code's install reads).
- **Alternatives considered**: `@iarna/toml` (TOML 0.5 only); `jsonwebtoken` (signing `node:crypto` already does);
  `zod-to-json-schema` (zod 4 has `z.toJSONSchema`); vitest or jest (a dependency for what `node:test` does).

## R3: How a plugin carries core (FR-002)

- **Decision**: a carrier has the symlink `<component>/plugin/core` → `../../core/src`, and at its plugin root a
  `package.json` with `"type": "module"` and `dependencies` holding each of core's runtime dependencies at core's
  exact version, plus a `package-lock.json` (v3) from `npm install`. No `overrides`, no non-registry dependency.
  Plugin code imports core as `${CLAUDE_PLUGIN_ROOT}/core/<module>.ts`. No carrier in this spec; US1 proves the
  path on a fixture plugin under `core/tests/fixtures/`.
- **Rationale**: root ADR-0001 d2, ADR-0009 d3. Claude Code's docs: a symlink "elsewhere within the same
  marketplace" is dereferenced into the cache; dependencies install into the copied version folder only when its
  root holds `package.json` and a supported lockfile; the install is skipped when the two list different
  dependencies or the plugin sets `overrides`. Node resolves `zod` from `<plugin>/core/*.ts` up to
  `<plugin>/node_modules`. `"type": "module"` makes Node read the copied `.ts` files as ES modules, the nearest
  `package.json` being the plugin's.
- **Existing tools**: Claude Code's plugin dependency install and symlink handling (docs above).
- **Alternatives considered**: a `package.json` inside `core/src/` (a second manifest of core's dependencies);
  `.mts` files (every import path changes for what one field does).
- **Note**: a marketplace added from a local path loads plugins in place and installs no dependencies (docs); in
  this repo a carrier's link resolves to `core/src`, whose imports resolve to `core/node_modules`.

## R4: A hook refuses when a core dependency is missing (FR-003)

- **Decision**: `core/src/guard.ts` imports only `node:` modules. `requireDependencies()` reads the nearest
  `package.json` above its own file (the carrier's in a plugin, `core/package.json` in the repo) and resolves each
  name in its `dependencies` with `import.meta.resolve`; the first that does not resolve throws
  `MissingDependency(name, root)`. A carrier's hook imports `guard.ts` statically, calls it, and only then imports
  other core modules with `await import(...)`. On `MissingDependency` the hook names the package on stderr and
  exits 2, and every hook that runs core is declared with `"onFailure": "block"`; the Stop hook alone exits 1
  and has no `onFailure`, so the session ends (orchestrator ADR-0001 d5 and its Trade-offs).
- **Rationale**: root ADR-0009 d4 and its Trade-off (a failed install still loads the plugin). A static import of
  a core module is evaluated before any guard runs, and Node's own failure names the package only in prose.
  Reading the carrier's `package.json` uses the list the install itself used; R5 holds it equal to core's.
  Claude Code treats a hook's exit code other than 0 or 2 as a non-blocking error and lets the action go
  ahead, and does the same for a timeout or a hook that cannot start (an old Node), unless the hook sets
  `onFailure: "block"` (Claude Code 2.1.295 or later; hooks docs, read 2026-10-23, not run). Exit 2 blocks;
  `onFailure` covers the failures no code of the hook can catch (root ADR-0004 d2). On Stop, exit 2 keeps the
  session working, so a missing package would loop it; a refused or crashed Stop hook fails open, as ruled.
- **Existing tools**: `import.meta.resolve` (throws `ERR_MODULE_NOT_FOUND` for a missing package, seen).
- **Alternatives considered**: catching the import error and parsing its message (prose); a generated list of
  core's dependencies inside `src/` (a second record of `core/package.json`).

## R5: CI holds the pins and the version bumps (FR-002, FR-004)

- **Decision**: `core/scripts/check-carriers.ts`, run in CI on every pull request against its base. Carriers are
  every `*/plugin/core` symlink. For each: the target is `../../core/src`; `package.json` has `"type": "module"`
  and every core runtime dependency at core's exact version; `package-lock.json` exists with `lockfileVersion` 3
  and `packages["node_modules/<name>"].version` equal to each pin. When the change touches `core/src/**` or the
  `dependencies` of `core/package.json`, every carrier's `plugin.json` `version` must differ from the base's. The
  decision is a pure function of (changed paths, core's pins, each carrier's files at base and head), tested on
  fixtures; a thin reader runs git. It runs again on every push to `main` against `HEAD~1`, so two PRs that
  each passed on a stale base, bumping a carrier to one version, fail `main` naming the carrier.
- **Rationale**: FR-004; root ADR-0001 Trade-offs: a pinned `version` keeps users on the old copy until it changes
  (tested). Only `core/src` and core's dependency pins reach a plugin, so they are what "a change to `core/`" means
  here; a test-only change needs no release. Zero carriers today, so the check passes until the first one.
- **Existing tools**: git (`diff --name-only <base>...HEAD`, `show <base>:<path>`); npm lockfile v3 layout.
- **Alternatives considered**: a release tag for core (rejected by root ADR-0001); a bump on any change under
  `core/` (a plugin release for a test edit).
- **Trade-off**: plugins share one core in a session only while they are updated together. With no
  up-to-date rule (orchestrator ADR-0009 d6), a stale-base collision is caught after merge, not before.

## R6: CI runs core's tests

- **Decision**: in `.github/workflows/tests.yml`, the `suites` job already finds `core/tests`. The `unittest`
  matrix's run step branches: for `core/tests` it runs `npm ci` and `npm test` in `claude-plugins-internal/core`
  (`tsc -p .`, then `node --test 'tests/**/*.test.ts'`); every other suite keeps `python -m unittest -v`. A
  `carriers` job on `pull_request` and on push to `main` checks out with full history, sets up Node 22, runs
  `npm ci` in `core/` and R5's script against `origin/<base>`, or `HEAD~1` on a push. Both land in admin PRs of
  their own: the branch before US1, the `carriers` job after US1 and before any carrier.
- **Rationale**: the platform constraint "CI runs every `<component>/tests/`". Without the branch, `python -m
  unittest` in `core/tests` finds no tests and exits 5 (seen). `setup-node` at `22` is already in the job. A story
  never changes `.github/` (reviewer ADR-0002 d4); an admin's PR that does is attested by the exempt label
  (orchestrator ADR-0004 d4). The branch lands before US1, whose `core/tests` would otherwise exit 5; the
  `carriers` job runs `npm ci` in `core/`, so it lands after US1, and before any carrier it grades.
- **Existing tools**: the current matrix and `actions/setup-node`.
- **Alternatives considered**: a separate workflow for core (a second place deciding what CI runs).

## R7: Value sets and the finding source (FR-012a, SC-009)

- **Decision**: `core/src/values.ts` defines each set root ADR-0010 homes in core: round result, round verdict,
  finding ruling, root cause, check outcome, hold kind, hold state, round stage. Each is a record of value →
  meaning with a `z.enum` over its keys. Code takes a value only through the enum (`RoundResult.enum.CLEAN`);
  every contract builds its fields from these enums, so the JSON Schemas carry the same values. A finding's source
  is no set: `FindingSource` accepts `threads` or `required-checks`, the enum `CoreSource`, or a `ModuleName`,
  which matches `^[a-z][a-z0-9-]*$` and is neither of those two (root ADR-0010 d2); `[shared] validators` entries
  and package folders are checked by the same `ModuleName`. The spec-facts sets, spec kind and root-cause
  observation, are named enums in `contracts/spec-facts.ts`, spelt as planner ADR-0008 d1 fixes them. A test
  scans every file in `core/src` for a quoted string equal to a value of any enum core exports, outside the file
  that defines it, and fails naming file and line.
- **Rationale**: root ADR-0010 d1–d3. A package is added by adding its folder (root ADR-0001 d1), so no enum lists
  modules; one grammar keeps a name fit to be a folder, a `codeworks.toml` entry and part of a check name. A TS
  `enum` is not erasable (R1); `z.enum` gives a type, a runtime check and the JSON Schema from one list. Upper
  snake case but hold kinds, which are hold id prefixes (d2).
- **Existing tools**: zod 4 `z.enum` and its `.enum` accessor (seen).
- **Alternatives considered**: `as const` arrays beside separate Zod enums (two lists); an enum of module names
  (a core change per package, which root ADR-0003 d6 rules out); reviewer's `policy.VERDICTS` (reviewer's copy,
  with `RESHAPE_SPEC`; replaced in reviewer's switch to core).
- **Note**: reviewer's `ledger.py` and `policy.py` spell round stages and hold states in lower case; they take
  core's values in reviewer's switch.

## R8: Contracts as Zod schemas, JSON Schemas generated and drift-checked (FR-012, FR-013)

- **Decision**: `core/src/contracts/` holds `Finding`, `Snapshot` and `SpecFacts` as `z.strictObject` schemas
  (data-model.md), types from `z.infer`. `core/scripts/write-schemas.ts` writes
  `core/schemas/{finding,snapshot,spec-facts}.schema.json` from `z.toJSONSchema`, keys sorted, two-space indent,
  from one exported list of `{schema, file}`. A test regenerates each in memory from the same list and fails
  naming the file and the command when it differs or is missing. No schema is edited by hand.
- **Rationale**: root ADR-0003 d3, ADR-0009 d1; the org rule that the model is the contract and the schema a
  generated artifact. CI runs the test with core's suite (R6).
- **Existing tools**: zod 4's `z.toJSONSchema`.
- **Alternatives considered**: hand-written JSON Schema (a second source); schemas inside `src/` (nothing at run
  time reads them; a Python reader that needs one, root ADR-0010 d1, links `core/schemas/` in its own change).

## R9: Spec facts are YAML front matter, read strictly (FR-010)

- **Decision**: the front matter is the text between a first line `---` and the next `---`, parsed with `yaml`'s
  `parse`; its `codeworks` mapping is validated by `SpecFacts`. A `spec.md` with no front matter, no `codeworks`
  key or one the schema refuses fails derivation, naming the file and the error.
- **Rationale**: planner ADR-0008 d1 fixes the keys and says readers use core's model; failing on a missing block
  is fail-loud (Principle III). No `spec.md` carries the block yet, so `requirement` fails on every existing
  folder; it has no caller in this spec.
- **Existing tools**: `yaml` 2.9.1. planner's `no_spec.is_no_spec` reads the first line instead; it is planner's to
  switch.
- **Alternatives considered**: a hand-written parser for the one block; reading a missing block as `feature`.

## R10: The branch grammar (FR-007)

- **Decision**: `parseBranch(name)` returns `{story: issue, k, slug}`, `{spec: issue}` or `null` (no story).
  Story: `^([1-9][0-9]*)-us([1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$`. Spec: `^([1-9][0-9]*)-spec$`. `k` and slug
  are carried, never checked.
- **Rationale**: the spec's edge cases (`212-us-retry`, `0212-us2-x`, `212-us2-`, `212-spec-x` are no story);
  issue numbers have no leading zero.
- **Existing tools**: `reviewer/plugin/scripts/specbinding.py:62` `_STORY_BRANCH = (\d+)-us\d+-`, a prefix match
  that accepts those edges; replaced in reviewer's switch (spec Clarifications, SC-001).
- **Alternatives considered**: reviewer's looser pattern.

## R11: Reading files at a ref, and running git

- **Decision**: `core/src/git.ts` `runGit(checkout, args, answers)` is core's one way to run git: `execFile` of
  `git -C <checkout> -c credential.helper= -c core.fsmonitor=false -c core.hooksPath=/dev/null <args>` with
  `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_NOSYSTEM=1` in its environment. An exit code in `answers` is
  returned; any other non-zero exit throws `GitFailed(args, code, stderr)`. A `Tree` interface (`listDir`,
  `readText` at one ref) has `gitTree(checkout, ref)` (`ls-tree`/`cat-file` through `runGit`) and
  `gitHubTree(client, repo, ref)` (contents API). The spec folder, `spec.md` and `codeworks.toml` are read through
  a `Tree`.
- **Rationale**: reviewer derives the spec at a HEAD that may hold unpushed commits (reviewer ADR-0014 d1): git.
  The orchestrator reads `codeworks.toml` at PR heads (root ADR-0002 d4): GitHub. Hooks run git with no global or
  system config, no credential helper, and `core.fsmonitor` and `core.hooksPath` off (root ADR-0008 d8;
  `SECURITY.md` §5); one function keeps every git call of core so, the attestation's included (R16).
- **Existing tools**: `reviewer/plugin/scripts/worktree.py` (reviewer-private git reads); GitHub's contents API.
- **Alternatives considered**: git only (a fetch of every PR head); GitHub only (misses an unpushed HEAD).

## R12: GitHub access and the no-answer signal

- **Decision**: `gitHub(token)` over `fetch`: REST with `Link` pagination read to the end, GraphQL with cursor
  pagination read to the end, a request timeout. The token is required; there is no default or ambient credential.
  A network error, timeout, 5xx, 429, or 403 with `x-ratelimit-remaining: 0` or a `retry-after` header throws
  `GitHubUnanswered`; any other 4xx throws `GitHubRefused(status, message)`. A GraphQL answer with a non-empty
  `errors` never returns its `data`: an error of type `RATE_LIMITED` throws `GitHubUnanswered`, any other
  `GitHubRefused`. Every function that reads or writes GitHub takes its client from the
  caller; one that reads and writes takes `reader` and `writer`. Core's answers over a validator module turn any
  throw into COULD_NOT_RUN (R19), and the required-checks reader turns `GitHubUnanswered` into it at its own
  boundary (R22); everywhere else it propagates. `now()` returns GitHub's time, the `Date` header of `GET /rate_limit`, which any token may
  call and which does not count against the limit (GitHub's docs, not run); the state writes stamp holds with it
  (R16).
- **Rationale**: gh falls back to its configured login, which FR-037 forbids, and cannot send a JWT for minting.
  The reviewer App holds issues write alone (`SECURITY.md` §3), so it cannot read PRs, checks, contents or the
  board while the state write must post as it: two clients, reviewer's hook reading with the session App's
  token. COULD_NOT_RUN is a check outcome (root ADR-0010), so modules
  return it; identity and state reads are not checks, so a no-answer there stops the caller, which then attests
  and merges nothing (orchestrator ADR-0001 d5). GitHub answers a GraphQL primary rate limit with `200` and
  `errors`, and a secondary limit with 403 or 429 and `retry-after` (GitHub's rate-limit docs, not run); read
  by status alone, those would return empty data or read as a refusal. A hold's time is compared with GitHub's
  `createdAt` values, so it is taken from GitHub's clock, not the machine's.
- **Existing tools**: Node's `fetch`; reviewer's `github.py` uses gh (no explicit credential, no JWT).
- **Alternatives considered**: gh with `GH_TOKEN` per call (no JWT); `@octokit/rest` (a dependency tree for two
  request shapes).

## R13: Story identity and DONE (FR-008 to FR-011)

- **Decision**: pure rules over fetched data, with thin readers:
  - spec's issue: GraphQL `issue.parent`; none → `#s`; a parent in another repo fails naming it. Only the
    immediate parent is read.
  - spec folder: the one directory in `specs/` at the ref whose name starts with `<p>-`; none or several fail
    naming what was found.
  - story's PR from a branch: PRs with `headRefName` = the branch and `isCrossRepository` false; the highest
    number wins; PR bodies are never read.
  - requirement: `<folder>/spec.md` at the ref unless its facts' kind is `no_spec`, then the issue body (R9).
  - done: a same-repo PR on the story's branch merged, or the issue's timeline holds a `ClosedEvent` by an admin:
    its actor a `User` (every App acts as a `Bot`) with `admin`, `maintain` or `write` permission on the repo,
    from `GET /repos/{o}/{r}/collaborators/{login}/permission` (not run). Read from history, so a reopened done issue stays done. `isDone` has only `s`, and the head
    branch is deleted on merge (orchestrator ADR-0009 d6), so no ref gives the branch's full name: candidate
    PRs come from the issue's timeline (`ClosedEvent.closer`, `CrossReferencedEvent` and `ConnectedEvent`
    sources that are PullRequests), and one counts only when it is merged, same-repo, and its `headRefName`
    parses to `{story: s}`. Run 2026-10-23: issue #111's `ClosedEvent.closer` is merged PR #115 with its
    `headRefName`, its branch deleted.
- **Rationale**: root ADR-0005 d2–d5; P9 (the closer's GitHub type, so an App's close never counts, and its write permission, the writer fact
  orchestrator ADR-0010 d2 reads, so a close by a user who is not an admin never counts). The timeline
  only finds candidates; the branch grammar decides, so no PR body or closing reference makes a PR the story's
  (root ADR-0005 d3).
- **Existing tools**: GraphQL `parent`, `pullRequests(headRefName:)`, `timelineItems`.
- **Alternatives considered**: the search API's `head:` (matches a prefix, run 2026-10-23, but an index that lags
  and is rate-limited apart); linked PRs (from PR bodies, rejected by root
  ADR-0005 d3).

## R14: `codeworks.toml` (FR-006)

- **Decision**: `readSettings(tree)` parses `codeworks.toml` at the tree's ref with `smol-toml`, validates
  `[shared]` with the `Shared` strict schema (contracts/codeworks-toml.md), refusing an unknown or missing key by
  name, and returns each other section as its parsed table, unvalidated, for its component. `[shared]` holds
  `validators`, `trusted_reviewers`, `board` and the four App logins; the App IDs and `review_timeout` are not
  core's to validate. No environment variable is read. A missing file fails naming the ref.
- **Rationale**: root ADR-0002 d2–d4. `board` is `[shared]` because core's release rule reads it (orchestrator
  ADR-0002 d1). FR-006's "raw text of its own section" is read as "handed over unvalidated": a parsed table spares
  each component a second TOML parse of a slice, and the component still owns its validation.
- **Existing tools**: `smol-toml` (TOML 1.0, no dependencies).
- **Alternatives considered**: slicing the section's text out of the file (TOML sub-tables make that a parser).

## R15: Reading the state comment (FR-014 to FR-017)

- **Decision**: one GraphQL read of the story issue: its comments (`databaseId`, `author { __typename login }`,
  `body`, `createdAt`, `lastEditedAt`, `url`); its `COMMENT_DELETED_EVENT` (`createdAt`,
  `deletedCommentAuthor`) and `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT` (`createdAt`, `status`,
  `project { url }`) timeline items; and its `projectItems` (`project { url }`),
  each paginated to the end. When no project item's URL is `[shared] board`, the read throws
  `BoardNotVisible(board)`: a reader that cannot see the board never reads as "no Ready". Then each distinct
  `User` comment author's `role_name`, from `GET /repos/{o}/{r}/collaborators/{login}/permission`, through the one
  role read R13's `isDone` uses, so an admin is decided one way everywhere; `stateFrom` takes the writer logins and
  stays pure. The endpoint needs only `metadata: read`. A non-collaborator answers `read` on a public repo, and
  `none` with an empty `role_name` on a private one; it never answers 404 (all run 2026-10-28). One pure function,
  `stateFrom(comments, deletions, moves, writers, shared)`, `writers` the logins that role read names, then:
  1. keeps comments whose author is the reviewer App (a `Bot` whose login plus `[bot]` equals `[shared]
     reviewer_app_login`), whatever the body; the highest `databaseId` is the state comment;
  2. adds causes: `tampered` when it has `lastEditedAt`; `deleted` when a reviewer App comment deletion's
     `createdAt` is at or after its `createdAt` (GitHub's times are whole seconds, so a same-second deletion
     may be later and is held), or when there is no reviewer App comment and such a deletion exists; `invalid`
     when its body does not open with `<!-- codeworks:reviewer-state -->`, is not contracts/state-comment.md's
     format, or fails `Snapshot`, naming the comment URL and the error;
  3. picks the working snapshot: the state comment's when none of those causes stands, else the newest reviewer
     App comment that is unedited, tagged and valid, else an empty snapshot;
  4. adds an `open_hold` cause per open row of the working snapshot;
  5. applies the release rule (R27) to the working snapshot;
  6. returns `StateReading` (data-model.md). No reviewer App comment and no deletion is no state, not held, PR or
     not.
- **Rationale**: reviewer ADR-0011 d1, d2; spec Clarifications 2026-10-22 (deletions) and 2026-10-23 (no state
  with a PR; the newest comment whatever its body). `lastEditedAt` is GitHub's edit marker; `databaseId` order
  settles two comments in one second. Reading every reviewer App comment, not only tagged ones, makes an edit that
  removes the tag hold the story instead of handing the state to the comment before it. The start is decided and
  the release written over one working snapshot (FR-019a), so a held story is never started over rows no one
  judged (critique E1). The orchestrator opens the draft PR after the first push (builder ADR-0003 d1), so a PR
  without state is not held. The reader needs issues read and the board's read: the session App's or the
  orchestrator App's token (`SECURITY.md` §3).
- **Existing tools**: GraphQL `IssueComment.lastEditedAt`; the collaborator-permission endpoint (R13; run
  2026-10-28 with all three App tokens);
  `CommentDeletedEvent.deletedCommentAuthor`, `ProjectV2ItemStatusChangedEvent` (its `project` seen in the
  2026-10-26 critique's run), `Issue.projectItems` (not run); the `[bot]` login form in
  `pr-gate.js`.
- **Alternatives considered**: REST comments (no deletion events); reading only tagged comments and falling back
  to an older snapshot for the held answer (rejected by reviewer ADR-0011, Option E); holding a story with a PR
  and no snapshot (Option F); deciding over one snapshot and writing over another (critique E1).

## R16: Writing the state comment, holds, release, attestation

- **Decision**: library calls only (FR-021): `writeState`, `placeHold`, `placeRescopeHold`, `releaseOnClaim`.
  Each reads first (R15) and posts at most one comment through `writer`; nothing edits or deletes (FR-018). Each
  is refused while a `tampered`, `deleted` or `invalid` cause stands, naming it and its release (a Ready move and
  an admin comment, both after it), but `releaseOnClaim` when that release holds; and when the body is over
  GitHub's 65,536-character limit.
  - `writeState` posts the caller's snapshot: it may append rounds, whose `at` core sets from `now()`, and add
    pushbacks, and changes no hold row; any other difference is refused (`checkTransition`).
  - `placeHold({id, kind, question})`, for every kind but `rescope`, adds the row OPEN with `since` from
    `now()`, or moves a RELEASED row to OPEN with a new `since`, `released` and `released_by` cleared and the
    new question. On an OPEN row it posts nothing. An escalation needs a question (orchestrator ADR-0010 d1);
    other kinds have none.
  - `placeRescopeHold(specPr)` places `rescope-<issue>` as `placeHold` does, recording `spec_pr`: the spec PR's
    number, or null on a RESCOPE verdict. It posts nothing when the row already records that spec PR, open or
    released; otherwise the row is OPEN, `since` from `now()`, recording it (reviewer ADR-0013 d5).
  - `releaseOnClaim` acts on its own read's answer (R15, R27): it moves every releasable hold of the working
    snapshot to RELEASED, with `released` from `now()` and `released_by` the releasing comment and whether it was
    a reset; it posts when it releases a hold or a tamper cause, and returns the released holds with their comments, whether it
    started from a rebuilt snapshot, and the reset. reviewer calls it on the orchestrator's claim (reviewer
    ADR-0013 d2).
  - `attests(checkout, reading, head, base, specFolder)` → `{attested, reason}`, in `attest.ts`, reads git through
    `runGit` (R11) in a clone the caller has fetched to `head` and to `base`, the default branch's ref. It is not
    attested while the story is held, or when no INTERNAL or AUDIT round with result CLEAN, or DIRTY with verdict
    CONVERGED_PUSHBACK, is at `head` or at a commit in its history (`merge-base --is-ancestor`: exit 0 in it; 1,
    or 128 for a commit the clone lacks, not in it). The newest such round attests unless, since it
    (orchestrator ADR-0004 d1):
    1. `ls-tree -r -t` at `base` and at the round's commit gives a different object, or one at only one of them,
       for `<specFolder>/spec.md`, a tree whose path is `docs/adr` or ends `/docs/adr`, or `.specify/memory`;
    2. a merge commit of `rev-list --merges <round>..<head>` has a tree other than `merge-tree --write-tree` of
       its two parents, or that command exits 1, a conflict;
    3. a hold row has `released_by.reset` false and `released` after the round's `at`.
    `reason` names the lapse, the holding cause or "no passing round". GITHUB rounds never count, for or against.
    The pure parts, `passingRounds(snapshot)`, `governingDiff(atBase, atRound, specFolder)` and
    `releasedByComment(snapshot, round)`, are tested on fixtures; the git calls are thin.
- **Rationale**: FR-016 to FR-021; P2, P6 (reviewer's hook is the one writer, passing the reviewer App's client).
  Hold rows and round times change only in the call that writes them, so `since`, `released` and `at` are core's
  stamps from GitHub's clock and no caller can backdate one. The rescope row keys on its spec PR, so reviewer's
  hook derives it at each run and never places it twice for one PR. The lanes keep one writer at a time (root
  ADR-0006), so no lock. `attests` puts ATTESTED beside HOLD in core, which the orchestrator only reads (reviewer
  ADR-0011 d3). GitHub has no clean-merge API, so the lapse needs git; reading history in the same clone makes a
  round commit amended away before its push "not in history", never a refusal (critique E5). Object ids compare
  whole folders in one listing each (seen: a clean merge's tree equals `merge-tree`'s, an amended one's differs).
- **Existing tools**: REST `POST /repos/{o}/{r}/issues/{n}/comments`; git `merge-base --is-ancestor`, `rev-list
  --merges`, `merge-tree --write-tree` (git 2.38 or later), `ls-tree -r -t`.
  `reviewer/plugin/scripts/ledger.py` becomes a cache in reviewer's follow-up (reviewer ADR-0011 d5).
- **Alternatives considered**: hold rows written in the caller's snapshot (the caller would supply `since` from
  its own clock); a delta call for every change (replaces the settled snapshot write for rounds and pushbacks); a
  lock comment; GitHub's compare for history (a 404 for a commit never pushed, and no merge check); the rescope
  row keyed by `spec.md`'s blob (superseded by reviewer ADR-0013 d5).

## R17: Required checks' GitHub states to check outcomes (FR-024)

- **Decision**: one function, `outcomeOf`, maps a check run or a commit status at the head for the required-checks
  reader: `success`, `neutral`, `skipped` → PASS; `failure` → FAIL; `error`, `cancelled`, `timed_out`,
  `action_required`, `startup_failure`, `stale` → COULD_NOT_RUN; queued, in progress, pending or absent →
  PENDING. Every `status` returns `{outcome, reason}`; every `findings` returns a list of findings or `{outcome:
  COULD_NOT_RUN, reason}`, never an empty list in its place. One table-driven test feeds the required-checks
  reader each input that maps to COULD_NOT_RUN (a check in `error`, `cancelled` or `timed_out`, no answer, a rate
  limit), and core's answers over the fixture package no answer and a throw, and expects COULD_NOT_RUN from both
  `status` and `findings` (SC-004).
- **Rationale**: root ADR-0004 d1, d4; COULD_NOT_RUN is a check-outcome value (root ADR-0010), so it is returned,
  not thrown. `neutral` and `skipped` pass because GitHub's required checks count them as passing. A package maps
  its provider's results itself (root ADR-0003 d6), where a skipped head is no reading (d1).
- **Existing tools**: the poller's passing set (`SUCCESS`, `NEUTRAL`, `SKIPPED`).
- **Alternatives considered**: throwing for could-not-run (an exception the records do not have); one mapping for
  packages too (`skipped` would pass a head the provider never read).

## R18: The validator contract and loading a package (FR-022)

- **Decision**: `core/src/validation/contract.ts` defines what a package in `validators/<name>/` meets. Its
  `index.ts` exports `logins`, its provider's GitHub logins in REST form, and `open(deps)` → `{trigger(repo, pr,
  head), status(repo, pr, head), findings(repo, pr, head)}`. `status` answers `{outcome: PENDING | PASS | FAIL |
  WAIVED, head, reason}`, `head` being the commit its provider read; `findings` a list in the Findings contract.
  `deps` is `{reader, writer, readKey, providerThreads}`: the caller's clients (R12); `readKey(file)`, core's key
  read for the caller's plugin (R23); `providerThreads(repo, pr)`, the unresolved threads its logins started, as
  findings with its name as `source` (R21). `loadValidators(shared, dir, deps)` imports `<dir>/<name>/index.ts`
  with `await import` for each entry of `[shared] validators` and throws `ValidatorLoadError(name, why)` for a
  name outside `ModuleName` (R7), a missing folder or `index.ts`, or an export missing or of the wrong kind. It
  returns `{modules, logins}`, `logins` the union of every package's; each module carries the `deps` and `shared` it
  was loaded with, which core's answers use (R19). The caller passes `dir`:
  `${CLAUDE_PLUGIN_ROOT}/validators` in a carrier, a fixture folder in tests. A package imports core with `import
  type` alone, which Node erases.
- **Rationale**: root ADR-0001 d1, d2; root ADR-0003 d1, d6, d8: each package owns its provider, core holds the
  contract, and a package is added by its folder. Passing `dir` keeps core free of a carrier's layout. Clients,
  the key read and the thread read come in `deps`, so a package resolves no path to core at run time, where the
  paths differ between the repo and a carrier; it holds no credential but what `readKey` gives, and reads threads
  through core's one reader.
- **Existing tools**: Node's `import()`.
- **Alternatives considered**: a list of packages beside `validators` (a second list); packages importing core's
  modules at run time (a path that differs between the repo and a carrier).

## R19: Core's answers over a module (FR-022 to FR-025, FR-028)

- **Decision**: core calls a loaded module only through three functions:
  - `trigger(module, repo, pr, head)` → nothing, or COULD_NOT_RUN when the module throws. A package allows a
    second call for one head (FR-022): one that posts a request looks for its own first (critique E8).
  - `status(module, repo, pr, head, {timeoutSeconds, since})` → `{outcome, reason}`: a throw or an outcome
    outside the four is COULD_NOT_RUN naming the module; PASS or FAIL whose `head` is not the head asked is
    PENDING; PENDING once `now() − since` reaches `timeoutSeconds` is SILENT; WAIVED is returned as is.
  - `findings(module, repo, pr, head)`: a throw, an item `Finding` refuses or an item whose `source` is not the
    module's name is COULD_NOT_RUN naming the module and the error; an item with a thread whose `author` is a
    codeworks App login is dropped.
- **Rationale**: root ADR-0003 d1, d8; FR-023 to FR-025, FR-028. The head check stops a stale verdict passing a
  new head in one place, for every package. `since` is the caller's: when the count starts is the orchestrator's
  spec (FR-023), so core derives no push time (critique E7 falls away). Any throw is COULD_NOT_RUN because a
  package's errors are its own; R12's classes are core's.
- **Existing tools**: `Finding.safeParse`; the client's `now()`.
- **Alternatives considered**: each package checking its own head (the rule copied per package); core deriving a
  head's push time (a provider's choice).

## R20: Testing the contract without a provider

- **Decision**: `core/tests/fixtures/validators/fixture/` is a package meeting the contract that answers from
  data each test sets: logins `fixture-bot`, a status with a head, findings, a throw. US3's scenarios and SC-004
  run against it. No Codex, CodeRabbit or DeepSource package is built here; each is its own spec (spec
  Assumptions).
- **Rationale**: root ADR-0003 d6 moves provider logic out of core; the contract is core's, so a fixture proves
  it.
- **Existing tools**: `node:test`.
- **Alternatives considered**: a real provider's package in this spec (the scope the rulings moved out).

## R21: The threads module and who is trusted (FR-028, FR-029)

- **Decision**: one reader of a PR's unresolved review threads (first comment's author, path, line, URL,
  comments), `reviewThreads(reader, repo, pr)`, serves the threads module and every package's `providerThreads`.
  `threadsModule(shared, reader, validators)` → `{findings(repo, pr, head), untrusted(repo, pr)}`: `findings`
  gives one finding per thread whose first comment's author is in `[shared] trusted_reviewers` and not in
  `validators.logins`, carrying the thread's trusted comments and the id of the latest (reviewer ADR-0016 d2,
  d3); `untrusted` lists every thread whose first author is neither such a reviewer nor a provider login. A thread
  started by any of the four codeworks Apps, by its `[shared]` login, is always in `untrusted`, never a finding.
  A missing `trusted_reviewers` refuses to run. `untrusted` lets `GitHubUnanswered` propagate: it is no check
  (critique E14). Logins are compared in REST form: GraphQL gives a `Bot` author's login without `[bot]`, so a
  `Bot`'s login gains it, as in R15; `Finding.author` carries the REST form.
- **Rationale**: root ADR-0003 d2, ADR-0007 d5; orchestrator ADR-0007 d6, which resolves every `untrusted` thread
  unread; P9 (the starter's identity). Enabling a module trusts its provider, so a provider's thread is that
  module's finding alone and each thread has one source (SC-005); the logins come from the packages, so
  `[shared]` lists none.
- **Existing tools**: the poller's `reviewThreads` query and its `bare` login normalisation
  (`poll-pr-review.sh` lines 131, 211–215).
- **Alternatives considered**: trusting the latest author (rejected by reviewer ADR-0016); refusing a provider's
  login in `trusted_reviewers` (settings would have to load the packages).

## R22: The required-checks reader (FR-027)

- **Decision**: `requiredChecks(shared, reader, validators)` → `{status(repo, pr, head), findings(repo, pr,
  head)}`. It reads the PR's base, then the base branch's effective rules (`GET
  /repos/{o}/{r}/rules/branches/{base}`), takes every `required_status_checks` entry and drops `internal-review`
  and `<name>-review` for each loaded module; when none is left, status and findings are COULD_NOT_RUN. Each
  remaining check is matched at the head among check runs by name (and App id when the rule pins
  `integration_id`) and among commit statuses by context, mapped through R17. `status`: any FAIL → FAIL; else any
  COULD_NOT_RUN → COULD_NOT_RUN; all PASS → PASS; else PENDING. `findings`: COULD_NOT_RUN naming the checks when
  any maps to COULD_NOT_RUN, else one per FAIL check, key `required-check:<name>`. `GitHubUnanswered` is
  COULD_NOT_RUN at its boundary. No `trigger`, never SILENT: the orchestrator applies `review_timeout` to a
  required check missing or pending (orchestrator ADR-0008 d4).
- **Rationale**: orchestrator ADR-0009 d2 (rulesets only), ADR-0007 d2 (no status waits on itself), ADR-0008 d4.
- **Existing tools**: GitHub's pulls, rules-for-a-branch, check-runs and statuses APIs.
- **Alternatives considered**: the classic branch protection API (none is used).

## R23: Key files and the managed-settings gate (FR-036, FR-038)

- **Decision**: `readKey(file, plugin)` is the one reader of `~/.config/codeworks/<file>`; `file` must be a bare
  file name. It refuses a file not owned by the current user or with any group or other permission bit. For
  every read but planner's of `planner-app.pem`, made on the admin machine, it first checks the managed settings
  are in effect: `/etc/claude-code/managed-settings.json` exists, it and its folder are owned by root and writable
  by no one else, it holds each setting of contracts/key-files.md with `<plugin>@codeworks` enabled and no
  `enabledPlugins` entry set true that `SECURITY.md` §5 does not list, and it is the one source: neither
  `/etc/claude-code/managed-settings.d` nor `~/.claude/remote-settings.json` exists (`lstat`: ENOENT is absent,
  any other error throws). The refusal names every missing or different setting and every second source. On a
  platform other than Linux a checked read is refused naming the platform. A package reads its token through the
  same call, as `deps.readKey` (R18).
- **Rationale**: root ADR-0008 d2, d4, d9; `SECURITY.md` §5. With one source, the file read is the policy in
  effect: Claude Code merges the drop-in folder and claude.ai's settings over it (§5), and either could undo what
  it holds (critique E9). A plugin §5 does not list would run its hooks under `allowManagedHooksOnly`. The
  exemption is keyed by the file, `planner-app.pem`, which sits only on the admin machine; every key of the agent
  machine, `session-app.pem` included, is checked. The required settings copy every §5 entry but those standing
  for a per-environment path or the served repo's registries; a test parses §5's JSON block and fails when one of
  its entries is neither in core's table nor a named exception.
- **Existing tools**: `node:fs` `statSync`, `lstatSync`; `reviewer/plugin/scripts/jev.py` reads its key with no
  checks (reviewer's follow-up).
- **Alternatives considered**: comparing the whole file to §5 (paths, hosts and caches differ per environment);
  merging the sources as Claude Code does (rejected by root ADR-0008 Option F).

## R24: Minting an App's token (FR-035 to FR-037)

- **Decision**: `mintToken(app, appId, keyFile, plugin, repo)`, `app` one of session, orchestrator, reviewer,
  planner; `appId` comes from the caller's own section, `[orchestrator]` for the session and orchestrator Apps,
  `[reviewer]` for the reviewer App, `[planner]` for the planner App (root ADR-0002 d1, d2).
  Reads the key through R23; signs an RS256 JWT with `node:crypto` (`iat` now − 60 s, `exp` now + 9 min, `iss`
  the App ID); `GET /repos/{o}/{r}/installation`; `POST /app/installations/{id}/access_tokens` with
  `repositories: [name]` and exactly that App's permissions, named by GitHub's API keys (`organization_projects`,
  not §3's "projects"); refuses an answer whose repositories differ, whose `expires_at` is more than one hour
  away, or whose permissions lack or lower a requested one or add any but `metadata: read`. A 404 names "not installed on <repo>"; a missing key names the
  path. No fallback. Permission sets are data in core, pinned by a test to `SECURITY.md` §3. No command mints or
  prints a token.
- **Rationale**: root ADR-0007 d1, d4, orchestrator ADR-0001 d1, `SECURITY.md` §3; GitHub caps an installation
  token at one hour and an App JWT at ten minutes. `node:crypto` signs RS256 (seen). Every App holds metadata
  read, which GitHub may list in a token's permissions unrequested (not run); the first real mint in US5
  confirms the answer's shape.
- **Existing tools**: `node:crypto` `createSign`.
- **Alternatives considered**: `jsonwebtoken`; `actions/create-github-app-token` (Actions only).

## R25: No commands, and the import boundary (FR-005, FR-021, SC-003)

- **Decision**: `core/package.json` has no `bin`; `core/src` holds no plugin component folder (`commands/`,
  `skills/`, `agents/`, `hooks/`, `bin/`, `.claude-plugin/`) and no module acts on import. A test asserts both. A
  second test reads every import specifier in `core/src` and fails on any that is not `node:*`, a relative path
  inside `core/src`, or a core runtime dependency. The loader's `import()` of a package takes the folder its caller
  passes (R18), so no specifier in core names a package.
- **Rationale**: FR-021, FR-036 (no command reaches a write or a mint); root ADR-0001 d2; FR-005.
- **Existing tools**: `node:test`, `node:fs`.
- **Alternatives considered**: a lint rule (a second tool for one check).

## R26: How the work lands

- **Decision**: one PR per story, US1 → US2 → US3 → US5, and `tests.yml` in two admin PRs (R6):
  - US1: `core/` skeleton (`package.json`, lockfile, `tsconfig.json`), `guard.ts`, the GitHub client, `git.ts`
    and `Tree`, the branch grammar and identity, `SpecFacts` with its schema and the drift test, `values.ts` with
    the value-string test, the import and no-command tests, `check-carriers.ts` with its tests, the fixture
    carrier with a test that its pins and lockfile equal core's (the `*/plugin/core` glob does not reach it),
    `.gitignore`.
  - US2: `settings.ts` with the whole `Shared` schema, `Snapshot` and its schema, the state module with the
    release rule (R27), `attest.ts`, and the client's `now()`.
  - US3: the required checks' outcome mapping, `Finding` and its schema, the validator contract with the fixture
    package, the threads module, the required-checks reader, `keys.ts` (the key read packages are handed) with
    the key-gate tests of US5 AS4 and AS5, written before it, and the §5 drift test.
  - US5: `tokens.ts`.
- **Rationale**: US1 builds the path every later module ships by (spec Clarifications). Each later story adds only
  what it needs (Principle V); `values.ts` and its test land in US1 with the spec-facts enums, the first code
  they grade (Principle VI; plan Complexity Tracking). No carrier exists, so no story bumps a plugin.
- **Existing tools**: the repo's story-per-PR delivery (constitution, Delivery Workflow).
- **Alternatives considered**: one PR for all of core.

## R27: The release rule (FR-019, FR-019a, FR-019b)

- **Decision**: part of R15's pure function, over the working snapshot and the same comments and events, with the
  terms of contracts/state-comment.md (Release). A comment counts only from an admin, a writer and no codeworks App;
  a Ready move only on a board the reader sees, whoever made it (R15):
  - an admin comment: author a `User`, none of the four App logins, whose `role_name` on the repository is admin,
    maintain or write (R15);
  - a Ready move: a status-change event with `status` `Ready`, `project.url` equal to `[shared] board`;
    the newest counts;
  - an escalation hold's question: the oldest comment by the orchestrator App whose first line is
    `questionTag(hold)`, `<!-- codeworks:hold-question <id> <since> -->`;
  - reset: the newest admin comment whose trimmed body is `/codeworks reset`.
  An OPEN hold is releasable when a reset is after its `since`, released by the reset; or when a Ready move and an
  admin comment are both after it, that comment also after the question for an escalation hold, released by the
  newest such comment. A tamper cause is released when a Ready move and an admin comment are both after the newest
  of its edit, deletion or invalid comment. "After" a time is a later second; between two comments it is
  `databaseId` order. `startable` is true when every tamper cause is released and every open hold of the working
  snapshot is releasable. `readState` returns the answer, and `releaseOnClaim` acts on its own read's (R16).
- **Rationale**: reviewer ADR-0013 d2, d3, ADR-0011 d2; orchestrator ADR-0002 d1, d3, ADR-0010 d2. The orchestrator
  needs the answer to stop a start and reviewer to release, so it lives once in core (SC-002), fed one fixture set
  (critique X1). A move counts only on the board, whoever made it (orchestrator ADR-0002 d1; reviewer ADR-0013 d2):
  the orchestrator never checks who moved a card, and the event names its project. A comment counts whether edited or not:
  no credential the agent uses can edit one, and a writer who edits one is trusted anyway. The releasing comment is returned because the new
  internal round is briefed with it (reviewer ADR-0013 d2). `since` is GitHub's time just before the placing
  comment's post, so "after the state comment that placed it" reads as a later second than `since`: a same-second
  comment or move is not after, and the admin acts again. The question's tag is a grammar core defines and the
  orchestrator writes, so the rule reads no wording (P7).
- **Existing tools**: R15's read, with its role read.
- **Alternatives considered**: each caller checking Ready and the comment itself (two copies of one rule, which
  FR-019a forbids); a move to Ready on any project (rejected by orchestrator ADR-0002 d1); the Status field
  value's `updatedAt` (changes on any move, so it cannot say the last move was to Ready); an answer counted from
  the hold's placement, not its question (orchestrator ADR-0010 d2 rules it out); an admin by `authorAssociation`
  OWNER, MEMBER or COLLABORATOR (rejected by orchestrator ADR-0010 d2, amended). GitHub computes it for the reader,
  and an App's token sees a private org member as CONTRIBUTOR, so on playground no admin comment counted (T044).
  MEMBER also covers a member who can only read.

## Open

1. **The end-to-end install test in CI** (US1 AS1–AS2, SC-007). It needs `claude` on the CI runner able to run
   `claude plugin marketplace add`/`install` with no login, and a git-hosted fixture marketplace. Tested on
   2.1.308 with a fresh `CLAUDE_CONFIG_DIR` and no login: a `file://` source is refused ("Invalid marketplace
   source format") and git's dumb HTTP lacks shallow fetch, but a local smart-HTTP server (`git http-backend`
   behind a small HTTP server) serves the marketplace, and `marketplace add`, `install` and `update` all run. Not
   tried on a CI runner; if it cannot run there, it is a recorded manual check (quickstart.md).
2. **Claude Code's dependency install on the agent machine**: it runs in Claude Code's own process, not a
   sandboxed command, so `SECURITY.md` §5's `allowedDomains` should not apply; not checked. It matters from the
   first carrier, not in this spec.

Deferred, not in scope: `.deepsource.toml` has no JavaScript analyzer and its `test_patterns` names
`dev/*/tests/**`, which no longer exists; DeepSource will not analyse `core/`.
