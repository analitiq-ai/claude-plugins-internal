# Research: core, the shared package every Codeworks component imports

Read for this: `spec.md` (Clarifications through Session 2026-10-23); the constitution 1.2.1; root ADR-0001 to
ADR-0010; orchestrator ADR-0001, 0004, 0007, 0008, 0009; reviewer ADR-0011, 0013, 0016, 0017, 0019; planner
ADR-0008; builder ADR-0003; `SECURITY.md` §3 and §5; all as on `main` at ac5e7c3. Also `.github/workflows/tests.yml`,
`.gitignore`, `.deepsource.toml`, `.claude-plugin/marketplace.json`; `reviewer/plugin/scripts/{specbinding,policy,
ledger}.py` (parts); `reviewer/plugin/skills/github-pr-review/{poll-pr-review.sh,deepsource-pr-gate.sh}`; the org
gate `analitiq-org-github/.github/scripts/pr-gate.js`; Claude Code's plugin docs (manifest reference, plugin
loading, host a marketplace, plugin commands).

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
view` lists no dependencies for zod 4.6.7, smol-toml 1.9.1 or yaml 2.9.1. Nothing else below was run.

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
  other core modules with `await import(...)`. The hook catches `MissingDependency` and exits 2 naming the
  package on stderr, and every hook that runs core is declared with `"onFailure": "block"`.
- **Rationale**: root ADR-0009 d4 and its Trade-off (a failed install still loads the plugin). A static import of
  a core module is evaluated before any guard runs, and Node's own failure names the package only in prose.
  Reading the carrier's `package.json` uses the list the install itself used; R5 holds it equal to core's.
  Claude Code treats a hook's exit code other than 0 or 2 as a non-blocking error and lets the action go
  ahead, and does the same for a timeout or a hook that cannot start (an old Node), unless the hook sets
  `onFailure: "block"` (Claude Code 2.1.295 or later; hooks docs, read 2026-10-23, not run). Exit 2 blocks;
  `onFailure` covers the failures no code of the hook can catch (root ADR-0004 d2).
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
  `npm ci` in `core/` and R5's script against `origin/<base>`, or `HEAD~1` on a push.
- **Rationale**: the platform constraint "CI runs every `<component>/tests/`". Without the branch, `python -m
  unittest` in `core/tests` finds no tests and exits 5 (seen). `setup-node` at `22` is already in the job. A PR
  changing `.github/` is attested only by an exempt label (orchestrator ADR-0004 d4), which US1's PR needs.
- **Existing tools**: the current matrix and `actions/setup-node`.
- **Alternatives considered**: a separate workflow for core (a second place deciding what CI runs).

## R7: Value sets (FR-012a, SC-009)

- **Decision**: `core/src/values.ts` defines each set root ADR-0010 homes in core: round result, round verdict,
  finding ruling, root cause, check outcome, hold kind, hold state, round stage, module name. Each is a record of
  value → meaning with a `z.enum` over its keys. Code takes a value only through the enum
  (`RoundResult.enum.CLEAN`); every contract builds its fields from these enums, so the JSON Schemas carry the
  same values. The spec-facts sets, spec kind and root-cause observation, are named enums in
  `contracts/spec-facts.ts`, spelt as planner ADR-0008 d1 fixes them. A test scans every file in `core/src`
  for a quoted string equal to a value of any enum core exports, outside the file that defines it, and fails
  naming file and line.
- **Rationale**: root ADR-0010 d1–d3. A TS `enum` is not erasable (R1); `z.enum` gives a type, a runtime check and
  the JSON Schema from one list. Upper snake case but hold kinds and module names, which are also written as names
  elsewhere (d2; spec Clarifications 2026-10-23).
- **Existing tools**: zod 4 `z.enum` and its `.enum` accessor (seen).
- **Alternatives considered**: `as const` arrays beside separate Zod enums (two lists); reviewer's
  `policy.VERDICTS` (reviewer's copy, with `RESHAPE_SPEC`; replaced in reviewer's switch to core).
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

## R11: Reading files at a ref

- **Decision**: a `Tree` interface (`listDir`, `readText`, `blobSha` at one ref) with `gitTree(checkout, ref)` (`git
  -c core.fsmonitor=false -c core.hooksPath=/dev/null -C <checkout>` `ls-tree`/`cat-file`, through
  `node:child_process` `execFile`) and `gitHubTree(client, repo, ref)` (contents API). The spec folder, `spec.md`
  and `codeworks.toml` are read through a `Tree`.
- **Rationale**: reviewer derives the spec at a HEAD that may hold unpushed commits (reviewer ADR-0014 d1): git.
  The rescope hold reads `spec.md` on a remote branch (FR-020) and the orchestrator reads `codeworks.toml` at PR
  heads (root ADR-0002 d4): GitHub. Hooks run git with those two settings off (root ADR-0008 d8).
- **Existing tools**: `reviewer/plugin/scripts/worktree.py` (reviewer-private git reads); GitHub's contents API.
- **Alternatives considered**: git only (a fetch of every PR head); GitHub only (misses an unpushed HEAD).

## R12: GitHub access and the no-answer signal

- **Decision**: `gitHub(token)` over `fetch`: REST with `Link` pagination read to the end, GraphQL with cursor
  pagination read to the end, a request timeout. The token is required; there is no default or ambient credential.
  A network error, timeout, 5xx, 429, or 403 with `x-ratelimit-remaining: 0` or a `retry-after` header throws
  `GitHubUnanswered`; any other 4xx throws `GitHubRefused(status, message)`. A GraphQL answer with a non-empty
  `errors` never returns its `data`: an error of type `RATE_LIMITED` throws `GitHubUnanswered`, any other
  `GitHubRefused`. Every function that reads or writes GitHub takes its client from the
  caller; one that reads and writes takes `reader` and `writer`. A validator module or the required-checks reader
  catches `GitHubUnanswered` at its own boundary only and returns COULD_NOT_RUN with the reason (R17); everywhere
  else it propagates.
- **Rationale**: gh falls back to its configured login, which FR-037 forbids, and cannot send a JWT for minting.
  The reviewer App holds issues write alone (`SECURITY.md` §3), so it cannot read PRs, checks or contents while
  the state write must post as it: two clients. COULD_NOT_RUN is a check outcome (root ADR-0010), so modules
  return it; identity and state reads are not checks, so a no-answer there stops the caller, which then attests
  and merges nothing (orchestrator ADR-0001 d3). GitHub answers a GraphQL primary rate limit with `200` and
  `errors`, and a secondary limit with 403 or 429 and `retry-after` (GitHub's rate-limit docs, not run); read
  by status alone, those would return empty data or read as a refusal.
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
  - story's branch from an issue (for the rescope hold): refs under `heads/<s>-us` (`git/matching-refs`) that
    parse to `#s`; none → no branch; several fail naming them.
  - requirement: `<folder>/spec.md` at the ref unless its facts' kind is `no_spec`, then the issue body (R9).
  - done: a same-repo PR on the story's branch merged, or the issue's timeline holds a `ClosedEvent` whose actor
    is a `User`. Read from history, so a reopened done issue stays done. The PR is found by
    `pullRequests(headRefName:)`, which still returns a merged PR after its head branch is deleted on merge
    (orchestrator ADR-0009 d6): run 2026-10-23 on PR #150, branch deleted, returned `MERGED`, same-repo.
- **Rationale**: root ADR-0005 d2–d5; P7 (no `Closes #s`); P9 (the closer's GitHub type, so an App's close never
  counts). The branch name is the one link (root ADR-0005 d3), so no second lookup of the story's PR exists.
- **Existing tools**: GraphQL `parent`, `pullRequests(headRefName:)`, `timelineItems`; REST `git/matching-refs`.
- **Alternatives considered**: the search API (exact branch only); linked PRs (from PR bodies, rejected by root
  ADR-0005 d3).

## R14: `codeworks.toml` (FR-006)

- **Decision**: `readSettings(tree)` parses `codeworks.toml` at the tree's ref with `smol-toml`, validates
  `[shared]` with the `Shared` strict schema (contracts/codeworks-toml.md), refusing an unknown or missing key by
  name, and returns each other section as its parsed table, unvalidated, for its component. No environment
  variable is read. A missing file fails naming the ref.
- **Rationale**: root ADR-0002 d2–d4. FR-006's "raw text of its own section" is read as "handed over
  unvalidated": a parsed table spares each component a second TOML parse of a slice, and the component still owns
  its validation.
- **Existing tools**: `smol-toml` (TOML 1.0, no dependencies).
- **Alternatives considered**: slicing the section's text out of the file (TOML sub-tables make that a parser).

## R15: Reading the state comment (FR-014 to FR-017)

- **Decision**: one GraphQL read of the story issue's comments (`databaseId`, `author { __typename login }`,
  `body`, `createdAt`, `lastEditedAt`, `url`) and its `COMMENT_DELETED_EVENT` timeline items (`createdAt`,
  `deletedCommentAuthor`), paginated to the end. A pure function then:
  1. keeps comments whose author is the reviewer App (a `Bot` whose login plus `[bot]` equals `[shared]
     reviewer_app_login`), whatever the body; the highest `databaseId` is the state comment;
  2. adds causes: `tampered` when it has `lastEditedAt`; `deleted` when a reviewer App comment deletion's
     `createdAt` is later than its `createdAt`, or when there is no reviewer App comment and such a deletion exists; `invalid` when its body does
     not open with `<!-- codeworks:reviewer-state -->`, is not contracts/state-comment.md's format, or fails
     `Snapshot`, naming the comment URL and the error; `open_hold` per open hold row;
  3. returns `StateReading` (data-model.md). No reviewer App comment and no deletion is no state, not held, PR or
     not.
- **Rationale**: reviewer ADR-0011 d1, d2; spec Clarifications 2026-10-22 (deletions) and 2026-10-23 (no state
  with a PR; the newest comment whatever its body). `lastEditedAt` is GitHub's edit marker; `databaseId` order
  settles two comments in one second. Reading every reviewer App comment, not only tagged ones, makes an edit that
  removes the tag hold the story instead of handing the state to the comment before it. Builder opens the draft
  PR before the first round (builder ADR-0003 d1), so a PR without state is not held.
- **Existing tools**: GraphQL `IssueComment.lastEditedAt`, `CommentDeletedEvent.deletedCommentAuthor`; the `[bot]`
  login form in `pr-gate.js`.
- **Alternatives considered**: REST comments (no deletion events); reading only tagged comments and falling back
  to an older snapshot (rejected by reviewer ADR-0011, Option E); holding a story with a PR and no snapshot
  (Option F).

## R16: Writing the state comment, the rescope hold, release, attestation

- **Decision**: library calls only (FR-021): `writeState`, `placeRescopeHold`, `releaseState`. Each reads first
  (R15) and posts one new comment through `writer`; nothing edits or deletes (FR-018).
  - `writeState` is refused while `tampered`, `deleted` or `invalid` stands, naming it and its release (a human's
    Ready); and when the new snapshot drops or rewrites a round, hold row or pushback the current one has, or its
    body is over GitHub's 65,536-character limit.
  - `releaseState` posts again the newest reviewer App comment that is unedited, tagged and valid, or an empty
    snapshot when there is none; refused when none of those three causes stands. Its caller calls it after the
    human's Ready (reviewer ADR-0011 d2); core cannot see the board.
  - `placeRescopeHold` finds the story's branch (R13), else the default branch, reads `spec.md`'s blob SHA
    there, and adds `rescope-<issue>` as OPEN with it, or re-opens that row with the new SHA (FR-020).
  - `attests(reader, repo, reading, head)`: true exactly when nothing holds the story and an INTERNAL or AUDIT
    round with result CLEAN, or DIRTY with verdict CONVERGED_PUSHBACK, is at `head` or at a commit in its
    history (FR-016; orchestrator ADR-0004 d1). GITHUB rounds never count, for or against. A passing round's
    commit is in the head's history when GitHub's compare of it with the head reads `ahead` or `identical`;
    the pure part, `passingHeads(reading)`, lists those commits newest first.
- **Rationale**: FR-016 to FR-021; P2, P6 (reviewer's hook is the one writer, passing the reviewer App's client).
  The lanes keep one writer at a time (root ADR-0006), so no lock. `attests` puts ATTESTED beside HOLD in core,
  which the orchestrator only reads (reviewer ADR-0011 d3).
- **Existing tools**: REST `POST /repos/{o}/{r}/issues/{n}/comments`; the contents API's `sha`; REST
  `GET /repos/{o}/{r}/compare/{base}...{head}` (`status`).
  `reviewer/plugin/scripts/ledger.py` becomes a cache in reviewer's follow-up (reviewer ADR-0011 d5).
- **Alternatives considered**: core checking the human's Ready (needs the board, the orchestrator's input); a lock
  comment.

## R17: Check outcomes from GitHub states (FR-024)

- **Decision**: one function maps a check run or commit status at the head to a check outcome: `success`,
  `neutral`, `skipped` → PASS; `failure` → FAIL; `error`, `cancelled`, `timed_out`, `action_required`,
  `startup_failure`, `stale` → COULD_NOT_RUN; queued, in progress, pending or absent → PENDING. `status` returns
  `{outcome, reason}`; `findings` returns a list of findings or `{outcome: COULD_NOT_RUN, reason}`, never an empty
  list in its place. One table-driven test feeds every module and the required-checks reader each input that
  maps to COULD_NOT_RUN (a check run in `error`, `cancelled` or `timed_out`, no answer, a rate limit) and
  expects COULD_NOT_RUN from both `status` and `findings` (SC-004).
- **Rationale**: root ADR-0004 d1, d4; COULD_NOT_RUN is a check-outcome value (root ADR-0010), so it is returned,
  not thrown. `neutral` and `skipped` pass because GitHub's required checks count them as passing; the other
  non-`failure` conclusions give no verdict.
- **Existing tools**: the poller's passing set (`SUCCESS`, `NEUTRAL`, `SKIPPED`).
- **Alternatives considered**: throwing for could-not-run (an exception the records do not have).

## R18: The Codex module (FR-025)

- **Decision**: a port of `pr-gate.js` `codexStatus` to TypeScript, with the spec's states:
  - verdict from `chatgpt-codex-connector[bot]`'s comments and non-dismissed reviews whose `Reviewed commit:`
    names the head; the newest decides; the clean template (`^Codex Review: Didn.t find any major issues`, without
    `Here are some automated review suggestions`) → PASS, else FAIL with its findings;
  - no verdict and the out-of-credits message posted after the head's push → WAIVED;
  - no verdict, and the newest `@codex review` by the caller-named requester after the head's push older than the
    caller's timeout → SILENT; otherwise PENDING;
  - `trigger` posts `@codex review` with the writer the caller passes; `findings` are Codex's unresolved threads.
- **Rationale**: FR-025 and root ADR-0003 d6 make this the one reader of Codex's text; the rules and their test
  cases exist in the org gate (`tests/pr-gate.test.js`), already JavaScript. Codex is not self-triggering, so the
  timeout runs from the request (orchestrator ADR-0008 d4). The requester is the orchestrator App, whose login its
  spec names (FR-036), so the caller passes it.
- **Existing tools**: `analitiq-org-github/.github/scripts/pr-gate.js` (constants at lines 18–48) and its tests;
  `reviewer/plugin/scripts/codexstate.py` (status card, not a verdict).
- **Alternatives considered**: the status card.

## R19: The CodeRabbit module (FR-026)

- **Decision**: self-triggering, so `trigger` does nothing. `findings`: `coderabbitai[bot]`'s unresolved threads,
  plus each outside-diff item of its reviews, parsed with the poller's pattern (`cr-comment:v1:<id>`), as a
  finding with no thread id, not resolvable, key `coderabbit:<id>`; a review declaring more items than parse is
  COULD_NOT_RUN naming it. `status`: from CodeRabbit's verdict at the head, SILENT past the timeout from the
  head's push.
- **Rationale**: root ADR-0003 d7; US3 AS10 (one key across heads, which CodeRabbit's own id gives).
- **Existing tools**: `poll-pr-review.sh` lines 157–176 (`coderabbitai`, `cr-comment:v1:([0-9a-f]+)`).
- **Alternatives considered**: `@coderabbitai review` as `trigger` (reviews a head twice).
- **Open**: which of CodeRabbit's outputs at a head carries its verdict (a commit status, a check run or a review
  state). The poller reads every status context and names none for CodeRabbit. US3 settles it from recorded
  responses of a repo running CodeRabbit before the module merges.

## R20: The DeepSource module (FR-026a)

- **Decision**: self-triggering; `trigger` does nothing. `[shared] deepsource_source` picks one source, with no
  fallback:
  - `github`: `status` from the `deepsource-io` App's check runs at the head through R17 (any FAIL → FAIL; else
    any COULD_NOT_RUN → COULD_NOT_RUN; all PASS → PASS; SILENT past the timeout from the head's push; else
    PENDING); thread-less findings from their annotations, and COULD_NOT_RUN in place of findings when any of
    those runs maps to COULD_NOT_RUN.
  - `api`: `status` and thread-less findings from DeepSource's API for the head commit, with the token from
    `~/.config/codeworks/deepsource-token` read through R23 for the plugin `enabledModules` was given; a missing, unreadable or refused token, or no
    answer, is COULD_NOT_RUN.
  In both, `deepsource-io[bot]`'s unresolved review threads come from GitHub (FR-028). A thread-less finding's
  key is `deepsource:<path>:<issue code, else annotation title>:<SHA-256 of the message, hex>`.
- **Rationale**: FR-026a's no-fallback rule governs where status and thread-less items come from; FR-028 makes
  every module return its vendor's threads, which exist only on GitHub. The key follows the spec's ruling (spec
  Clarifications 2026-10-23): no line, which moves between heads; the exact message, so two items of one code in
  one file share a key only when their text is identical. Hashing the message bounds the key's length in the
  snapshot. A per-occurrence id exists only in the `api` source, so it cannot key both.
- **Existing tools**: GitHub's check-runs and annotations APIs; `deepsource-pr-gate.sh` (reads a grade comment
  by `deepsource-io[bot]`). DeepSource's API query shapes are pinned from recorded responses in US3.
- **Alternatives considered**: the grade comment (prose); the message text itself in the key (unbounded length).

## R21: The threads module and who is trusted (FR-028, FR-029)

- **Decision**: `findings` reads the PR's unresolved review threads (first comment's author, path, line, URL,
  comments) and returns one finding per thread whose first comment's author is in `[shared] trusted_reviewers`,
  carrying the thread's trusted comments and the id of the latest (reviewer ADR-0016 d2, d3). `untrusted(pr)`
  lists every unresolved thread whose first author is neither trusted nor an enabled module's vendor; a thread
  started by the session App is always there, never a finding. A missing `trusted_reviewers` refuses to run.
  `readSettings` refuses a `trusted_reviewers` entry that is an enabled module's vendor, so each thread has one
  source (SC-005). Every validator module builds its own vendor's thread findings through the same function.
  Logins are compared in REST form: GraphQL gives a `Bot` author's login without `[bot]`, so a `Bot`'s login
  gains it, as in R15; `Finding.author` carries the REST form.
- **Rationale**: root ADR-0003 d2, ADR-0007 d4; orchestrator ADR-0007 d6; P9 (the starter's identity).
- **Existing tools**: the poller's `reviewThreads` query and its `bare` login normalisation
  (`poll-pr-review.sh` lines 131, 211–215).
- **Alternatives considered**: trusting the latest author (rejected by reviewer ADR-0016).

## R22: The required-checks reader (FR-027)

- **Decision**: reads the base branch's effective rules (`GET /repos/{o}/{r}/rules/branches/{base}`), takes every
  `required_status_checks` entry, drops `internal-review` and each enabled module's `<module>-review`; when none is
  left, status and findings are COULD_NOT_RUN. Each remaining check is matched at the head among check runs by
  name (and App id when the rule pins `integration_id`) and among commit statuses by context, mapped through R17.
  `status`: any FAIL → FAIL; else any COULD_NOT_RUN → COULD_NOT_RUN; all PASS → PASS; else PENDING. `findings`:
  COULD_NOT_RUN naming the checks when any maps to COULD_NOT_RUN, else one per FAIL check, key
  `required-check:<name>`. No `trigger`, never SILENT: the orchestrator applies its own
  timeout.
- **Rationale**: orchestrator ADR-0009 d2 (rulesets only), ADR-0007 d2 (no status waits on itself), ADR-0008 d4.
- **Existing tools**: GitHub's rules-for-a-branch, check-runs and statuses APIs.
- **Alternatives considered**: the classic branch protection API (none is used).

## R23: Key files and the managed-settings gate (FR-036, FR-038)

- **Decision**: `readKey(name, plugin)` is the one reader of `~/.config/codeworks/<name>`. It refuses a file not
  owned by the current user or with any group or other permission bit. For every read but reviewer's of
  `session-app.pem` it first checks the managed settings are in effect: `/etc/claude-code/managed-settings.json`
  exists, it and its folder are owned by root and writable by no one else, and it holds each setting of
  contracts/key-files.md with `<plugin>@codeworks` enabled. The refusal names every missing or different setting.
  On a platform other than Linux a checked read is refused naming the platform.
- **Rationale**: root ADR-0008 d4, d9; `SECURITY.md` §5, which names only the Linux path. The required settings
  copy every §5 entry but those standing for a per-environment path or the served repo's registries; a test
  parses §5's JSON block and fails when one of its entries is neither in core's table nor a named exception.
- **Existing tools**: `node:fs` `statSync`; `reviewer/plugin/scripts/jev.py` reads its key with no checks
  (reviewer's follow-up).
- **Alternatives considered**: comparing the whole file to §5 (paths, hosts and caches differ per environment).

## R24: Minting an App's token (FR-035 to FR-037)

- **Decision**: `mintToken(app, appId, keyFile, plugin, repo)`, `app` one of session, orchestrator, reviewer.
  Reads the key through R23; signs an RS256 JWT with `node:crypto` (`iat` now − 60 s, `exp` now + 9 min, `iss`
  the App ID); `GET /repos/{o}/{r}/installation`; `POST /app/installations/{id}/access_tokens` with
  `repositories: [name]` and exactly that App's permissions, named by GitHub's API keys (`organization_projects`,
  not §3's "projects"); refuses an answer whose repositories differ, whose `expires_at` is more than one hour
  away, or whose permissions lack or lower a requested one or add any but `metadata: read`. A 404 names "not installed on <repo>"; a missing key names the
  path. No fallback. Permission sets are data in core, pinned by a test to `SECURITY.md` §3. No command mints or
  prints a token.
- **Rationale**: root ADR-0007 d1, orchestrator ADR-0001 d1, reviewer ADR-0011 d1; GitHub caps an installation
  token at one hour and an App JWT at ten minutes. `node:crypto` signs RS256 (seen). Every App holds metadata
  read, which GitHub may list in a token's permissions unrequested (not run); the first real mint in US5
  confirms the answer's shape.
- **Existing tools**: `node:crypto` `createSign`.
- **Alternatives considered**: `jsonwebtoken`; `actions/create-github-app-token` (Actions only).

## R25: No commands, and the import boundary (FR-005, FR-021, SC-003)

- **Decision**: `core/package.json` has no `bin`; `core/src` holds no plugin component folder (`commands/`,
  `skills/`, `agents/`, `hooks/`, `bin/`, `.claude-plugin/`) and no module acts on import. A test asserts both. A
  second test reads every import specifier in `core/src` and fails on any that is not `node:*`, a relative path
  inside `core/src`, or a core runtime dependency.
- **Rationale**: FR-021, FR-036 (no command reaches a write or a mint); root ADR-0001 d2; FR-005.
- **Existing tools**: `node:test`, `node:fs`.
- **Alternatives considered**: a lint rule (a second tool for one check).

## R26: How the work lands

- **Decision**: one PR per story, US1 → US2 → US3 → US5:
  - US1: `core/` skeleton (`package.json`, lockfile, `tsconfig.json`), `guard.ts`, the GitHub client, `Tree`,
    the branch grammar and identity, `SpecFacts` with its schema and the drift test, `values.ts` with the
    value-string test, the import and no-command tests, `check-carriers.ts` with its tests, the fixture carrier
    with a test that its pins and lockfile equal core's (the `*/plugin/core` glob does not reach it),
    `tests.yml`, `.gitignore`.
  - US2: `settings.ts` with the whole `Shared` schema, `Snapshot` and its schema, the state module.
  - US3: the check-outcome mapping, `Finding` and its schema, the three modules, the threads module, the
    required-checks reader, `keys.ts` (first read by DeepSource's `api` source) with the key-gate tests of US5
    AS4, written before it, and the §5 drift test.
  - US5: `tokens.ts`.
- **Rationale**: US1 builds the path every later module ships by (spec Clarifications). Each later story adds only
  what it needs (Principle V); `values.ts` and its test land in US1, before the modules they grade (Principle
  VI). No carrier exists, so no story bumps a plugin.
- **Existing tools**: the repo's story-per-PR delivery (constitution, Delivery Workflow).
- **Alternatives considered**: one PR for all of core.

## Open

1. **The end-to-end install test in CI** (US1 AS1–AS2, SC-007). It needs `claude` on the CI runner able to run
   `claude plugin marketplace add`/`install` with no login, and a git-hosted fixture marketplace. Tested on
   2.1.308 with a fresh `CLAUDE_CONFIG_DIR` and no login: a `file://` source is refused ("Invalid marketplace
   source format") and git's dumb HTTP lacks shallow fetch, but a local smart-HTTP server (`git http-backend`
   behind a small HTTP server) serves the marketplace, and `marketplace add`, `install` and `update` all run. Not
   tried on a CI runner; if it cannot run there, it is a recorded manual check (quickstart.md).
2. **CodeRabbit's verdict source** (R19).
3. **Claude Code's dependency install in the agent environment**: it runs in Claude Code's own process, not a
   sandboxed command, so `SECURITY.md` §5's `allowedDomains` should not apply; not checked. It matters from the
   first carrier, not in this spec.

Deferred, not in scope: `.deepsource.toml` has no JavaScript analyzer and its `test_patterns` names
`dev/*/tests/**`, which no longer exists; DeepSource will not analyse `core/`.
