---

description: "Task list for core, the shared package every Codeworks component imports"
---

# Tasks: core, the shared package every Codeworks component imports

**Input**: Design documents from `/specs/145-core-shared-package/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: required. Constitution IV: every task starts from a test that fails for the expected reason; each
test task below is run and seen red before the task that makes it pass.

**Organization**: one PR per story, US1 → US2 → US3 → US5 (R26). Phases 1 and 2 land in US1's PR.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an unfinished task)
- **[Story]**: the user story whose PR holds the task
- Paths are from the repo root. GitHub is reached in tests through a fake client or a local `node:http` server
  replaying recorded responses; git through repositories the test creates in a temp folder. No test calls
  github.com, and none reads or writes `/etc`, `~/.claude` or `~/.config`: file and settings checks take
  injected stats and text. Test data is dummy data.

---

## Phase 1: Setup (in US1's PR)

**Purpose**: the `core/` package skeleton and CI running its suite

- [x] T001 Create `core/package.json`: `"private": true`, `"type": "module"`, `"engines": {"node": ">=22.18"}`,
  `dependencies` exactly `zod` 4.6.7, `smol-toml` 1.9.1, `yaml` 2.9.1, `devDependencies` exactly `typescript`
  7.0.2 and `@types/node` 22.20.5, `scripts.test` = `tsc -p . && node --test 'tests/**/*.test.ts'`, no `bin`
  (R2, R25)
- [x] T002 Run `npm install` in `core/` to write `core/package-lock.json` (lockfile v3) (R2)
- [x] T003 [P] Create `core/tsconfig.json`: `strict`, `noEmit`, `erasableSyntaxOnly`,
  `allowImportingTsExtensions`, `verbatimModuleSyntax`, `module` and `moduleResolution` `nodenext`, covering
  `src`, `scripts` and `tests` (R1)
- [x] T004 [P] Add `node_modules/` to `.gitignore` (R2)
- [ ] T005 In an admin's PR of its own, under the exempt label (orchestrator ADR-0004 d4), merged before US1's PR
  (a story never changes `.github/`, reviewer ADR-0002 d4): branch the `unittest` matrix run step in
  `.github/workflows/tests.yml`: for `core/tests` run `npm ci` and `npm test` in `claude-plugins-internal/core`;
  every other suite keeps `python -m unittest -v` (R6)

---

## Phase 2: Foundational (in US1's PR)

**Purpose**: what every story's modules rest on: the value sets, the GitHub client, git, `Tree`, and the tests
that grade all of `core/src`

**⚠️ CRITICAL**: no story module can be written before this phase is done

- [x] T006 [P] Write `core/tests/values.test.ts`: each set holds exactly these values, each with a meaning — round
  result CLEAN, DIRTY, INCOMPLETE; round verdict PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK,
  ESCALATE; finding ruling FIX, PUSH_BACK, DEFER; root cause AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL,
  NOT_APPLICABLE; check outcome PENDING, PASS, FAIL, SILENT, COULD_NOT_RUN, WAIVED; hold kind rescope,
  escalation, pushback, claim, shim, audit; hold state OPEN, RELEASED; round stage INTERNAL, AUDIT, GITHUB
  (FR-012a). `CoreSource` is exactly `threads`, `required-checks`; `ModuleName` (`^[a-z][a-z0-9-]*$` and not a
  `CoreSource` value) accepts `fixture` and `a-1` and refuses `Fixture`, `bad_name`, `1x`, `-x`, `""`, `threads`
  and `required-checks`; `FindingSource` accepts `threads`, `required-checks` and `fixture`. Plus the value-string
  scan: every file in `core/src`, a quoted string equal to a value of any enum core exports, outside the file that
  defines it, fails naming file and line; the scan is seen red on an in-memory file holding `'CLEAN'` (R7, SC-009)
- [x] T007 Create `core/src/values.ts`: each set of T006 as `{schema: z.enum([...]), meaning: Record<value,
  string>}`, plus `CoreSource`, `ModuleName` and `FindingSource`; no TS `enum`, no list of module names (R1, R7)
- [x] T008 [P] Write `core/tests/boundary.test.ts`: every import specifier in `core/src` is `node:*`, a relative
  path inside `core/src`, or `zod`, `smol-toml` or `yaml` (FR-005); `core/package.json` has no `bin` and
  `core/src` holds no `commands/`, `skills/`, `agents/`, `hooks/`, `bin/` or `.claude-plugin/` (FR-021, SC-003,
  US2 AS9). Each check seen red on a fixture under `core/tests/fixtures/boundary/` (an import of
  `../../reviewer/x.ts`, a `commands/` folder) (R25)
- [x] T009 [P] Write `core/tests/github.test.ts` against a local `node:http` server: REST `Link` pagination read
  to the end; GraphQL cursor pagination read to the end; a request timeout; a network error, timeout, 5xx, 429,
  403 with `x-ratelimit-remaining: 0`, and 403 or 429 with `retry-after` throw `GitHubUnanswered`; any other 4xx
  throws `GitHubRefused(status, message)`; a GraphQL `200` with non-empty `errors` never returns `data`: type
  `RATE_LIMITED` throws `GitHubUnanswered`, any other `GitHubRefused`; no token, no client (R12; FR-037)
- [x] T010 Create `core/src/github.ts`: `gitHub(token, api = "https://api.github.com")` →
  `{rest, restPages, graphql, graphqlPages}` over Node's `fetch`, with `GitHubUnanswered` and `GitHubRefused`
  (contracts/core-api.md) (R12)
- [x] T011 [P] Write `core/tests/git.test.ts` on a temp repo: `runGit(checkout, args, answers)` returns `{code,
  stdout}` for exit 0 and for a code in `answers`, and throws `GitFailed(args, code, stderr)` for any other;
  with `HOME` pointed at a temp folder whose `.gitconfig` sets `user.name` and `core.hooksPath`, `runGit(...,
  ['config', 'user.name'], [1])` answers code 1, and a commit runs no hook from that path; the child sees
  `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_CONFIG_NOSYSTEM=1`, `-c credential.helper=`, `-c core.fsmonitor=false` and
  `-c core.hooksPath=/dev/null` (R11)
- [x] T012 Create `core/src/git.ts`: `runGit` through `node:child_process` `execFile` with the flags and
  environment of T011, and `GitFailed` (R11)
- [x] T013 [P] Write `core/tests/tree.test.ts`: `gitTree` on a temp repo (`listDir`, `readText` at a ref, run
  through `runGit`); `gitHubTree` through the fake client over the contents API (R11)
- [x] T014 Create `core/src/tree.ts`: `Tree`, `gitTree(checkout, ref)`, `gitHubTree(client, repo, ref)` (R11)

**Checkpoint**: `npm test` in `core/` passes; the value-string, boundary, client, git and tree tests grade every
later module unchanged

---

## Phase 3: User Story 1 - A plugin carries core and reads a story's identity (Priority: P1) 🎯 MVP

**Goal**: core ships to a plugin through the symlink, refuses when a dependency is missing, and answers a
story's identity, requirement and DONE from one parser

**Independent Test**: install the fixture plugin from a git-hosted fixture marketplace, then call the identity
functions on fixture branch names, issue trees, spec folders and PR lists (quickstart.md, US1)

### Tests for User Story 1 ⚠️ (write first, see each fail)

- [x] T015 [P] [US1] Write `core/tests/guard.test.ts`: `requireDependencies()` reads the nearest `package.json`
  above its own file and throws `MissingDependency(name, root)` for the first dependency `import.meta.resolve`
  cannot find; run on copies of `core/src/guard.ts` in temp folders, one with all three dependencies resolvable
  and one without `zod` (FR-003, AS3; R4)
- [x] T016 [P] [US1] Write `core/tests/branch.test.ts`: `parseBranch('212-us2-retry-budget')` →
  `{story: 212, k: 2, slug: 'retry-budget'}`; `'145-spec'` → `{spec: 145}`; `'main'`, `'feature/x'`,
  `'212-us-retry'`, `'0212-us2-x'`, `'212-us2-'`, `'212-spec-x'` → `null` (FR-007, AS4, Edge Cases; R10)
- [x] T017 [P] [US1] Write `core/tests/spec-facts.test.ts`: `readSpecFacts` accepts `codeworks: {v: 1, kind,
  root_cause: {observed}}` with `kind` one of `feature`, `defect`, `no_spec` and `observed` one of `anchored`,
  `hypothesis`, `none`; no front matter, no `codeworks` key, an unknown key or a value outside `SpecKind` or
  `RootCauseObserved` fails naming the file and the error (FR-010; R9)
- [x] T018 [P] [US1] Write `core/tests/identity.test.ts` on fixture data and the fake client:
  - `specIssue`: parent 200 → 200; no parent → 145; a parent in another repo fails naming it; only the immediate
    parent is read (FR-008, AS5, Edge Cases)
  - `pickSpecFolder` and `specFolder`: exactly one `specs/200-*/` → it; none or several fail naming what was
    found; a folder renamed by a rescope is read at the ref asked about (FR-008, AS6)
  - `pickStoryPr` and `storyPr`: three same-repo PRs on `212-us2-retry-budget` and one fork PR of that head name
    → the newest same-repo PR; a body holding `Closes #212` is never read (FR-009, AS7)
  - `requirement`: `kind: feature` → the folder's `spec.md`; `kind: no_spec` → the issue body (FR-010, AS8)
  - `doneFrom` and `isDone`: a merged PR → done; a `ClosedEvent` by a `User` with `admin`, `maintain` or `write`
    permission → done; by a `User` with any other permission or none → not done; closed by a codeworks App
    with the PR unmerged → not done; a reopened done issue → done; a merged PR found only from the timeline
    (`ClosedEvent.closer`, `CrossReferencedEvent`, `ConnectedEvent`) with its head branch deleted and a `Bot`
    closer → done; a timeline PR that is unmerged, cross-repo, or whose `headRefName` does not parse to
    `{story: 212}` never counts (FR-011, AS9; R13)
- [x] T019 [P] [US1] Write `core/tests/carriers.test.ts` on the pure decision of `check-carriers.ts` over fixture
  carriers: symlink not `../../core/src`; `package.json` without `"type": "module"`; a core pin missing or at
  another version; lockfile missing, not v3, or pinning another version; a change to `core/src/**` or to
  `core/package.json` `dependencies` with a carrier's `plugin.json` `version` equal to the base's; a test-only
  change needs no bump; each failure names the carrier, the file and the expected value. Plus the thin git reader
  on a temp repo, against a base ref and against `HEAD~1` (FR-004, AS2; R5; contracts/carrying-core.md)
- [x] T020 [P] [US1] Write `core/tests/fixture-carrier.test.ts`: the fixture plugin's `package.json`
  dependencies and `package-lock.json` versions equal `core/package.json`'s runtime pins, and its `core` link is
  `../../../src` (the `*/plugin/core` glob does not reach it; R26)
- [x] T021 [P] [US1] Write `core/tests/schemas.test.ts`: regenerates in memory every `{schema, file}` of the list
  `core/scripts/write-schemas.ts` exports and fails naming the file and `node scripts/write-schemas.ts` when a
  file differs or is missing; seen red with the SpecFacts entry and no file (FR-013; R8)

### Implementation for User Story 1

- [x] T022 [US1] Create `core/src/guard.ts`, importing only `node:` modules: `requireDependencies()` and
  `MissingDependency(name, root)` (R4)
- [x] T023 [US1] Create `core/src/contracts/spec-facts.ts`: `SpecKind`, `RootCauseObserved` as named `z.enum`s
  spelt as planner ADR-0008 d1 fixes them, `SpecFacts` as a `z.strictObject`, `readSpecFacts(text)` reading the
  front matter between the first `---` line and the next with `yaml`'s `parse` (R7, R9)
- [x] T024 [US1] Create `core/src/identity.ts`: `parseBranch` with story
  `^([1-9][0-9]*)-us([1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$` and spec `^([1-9][0-9]*)-spec$`; pure
  `pickStoryPr`, `pickSpecFolder`, `doneFrom`; readers `specIssue`, `specFolder`, `storyPr`, `requirement`,
  `isDone` with `DerivationError(what, found)` (data-model.md, Story identity; R10, R13)
- [x] T025 [US1] Create `core/scripts/write-schemas.ts`: one exported list of `{schema, file}`, holding
  SpecFacts; writes `z.toJSONSchema` output, keys sorted, two-space indent; run it to write
  `core/schemas/spec-facts.schema.json` (R8)
- [x] T026 [US1] Create `core/scripts/check-carriers.ts`: the pure decision of T019 and a git reader (`diff
  --name-only <base>...HEAD`, `show <base>:<path>`) through `runGit`, `--base <ref>` (R5)
- [x] T027 [US1] Create the fixture carrier `core/tests/fixtures/carrier-plugin/`: `core` → `../../../src`,
  `package.json` (`"type": "module"`, core's three pins), `package-lock.json` from `npm install`,
  `.claude-plugin/plugin.json` with a pinned `version`, `hooks/hooks.json` declaring a `UserPromptSubmit` hook
  with `"onFailure": "block"` that runs `node ${CLAUDE_PLUGIN_ROOT}/hooks/identity.ts`, and that file as
  contracts/carrying-core.md shows: `guard.ts` imported statically, `MissingDependency` caught and exit 2 naming
  the package on stderr, then `await import('../core/identity.ts')` and print
  `parseBranch('212-us2-retry-budget').story` (FR-002, FR-003; R3, R4)
- [x] T028 [US1] In an admin's PR of its own, under the exempt label, after US1 merges and before any carrier
  (reviewer ADR-0002 d4; R6), add the `carriers` job to `.github/workflows/tests.yml`: on `pull_request` and push to `main`,
  checkout with `fetch-depth: 0`, Node 22, `npm ci` in `core/`, then `node scripts/check-carriers.ts --base
  origin/<base>`, or `--base HEAD~1` on a push (R5, R6)
- [x] T029 [US1] Run quickstart.md US1 steps 1–5 (end-to-end install, update without and with a bump, missing
  `zod`, a throwaway carrier failing `check-carriers.ts`); try steps 1–4 on a CI runner (research Open 1); record
  what ran and its result in the PR (AS1–AS3, SC-007)

**Checkpoint**: US1's PR passes `npm test` and `check-carriers.ts` run by hand; the fixture carrier installs and
imports core

---

## Phase 4: User Story 2 - A component reads and writes a story's reviewer state through one module (Priority: P1)

**Goal**: one module reads the reviewer App's newest comment as the story's state, holds the story on tampered,
deleted or invalid state or an open hold, answers the one release rule over one working snapshot, writes new
snapshots only, and attests stage 1 with its lapses

**Independent Test**: read fixture comment, deletion and Ready-move lists for the snapshot, held and release
answers; write a snapshot, a hold, a rescope hold and a release through the recorded fake and inspect the comment
posted; attest in scratch git repos (quickstart.md, US2)

### Tests for User Story 2 ⚠️ (write first, see each fail)

- [x] T030 [P] [US2] Add to `core/tests/github.test.ts`: `now()` returns the `Date` header of `GET /rate_limit` as
  `YYYY-MM-DDTHH:MM:SSZ`, UTC, whole seconds (R12)
- [x] T031 [P] [US2] Write `core/tests/settings.test.ts` through a fixture `Tree`: contracts/codeworks-toml.md's
  example is valid; an unknown `[shared]` key is refused naming it; a missing `validators`, `board`,
  `session_app_login`, `orchestrator_app_login`, `reviewer_app_login` or `planner_app_login` is refused naming
  it; `trusted_reviewers` may be absent; a `validators` entry outside `ModuleName` or a duplicate is refused;
  `board` not `https://github.com/orgs/<login>/projects/<n>` or `https://github.com/users/<login>/projects/<n>`
  is refused; a missing file fails naming the ref; another section comes back parsed and unvalidated, `{}` when
  absent; an environment variable named like a key changes nothing (FR-006, Edge Cases; R14)
- [x] T032 [P] [US2] Write `core/tests/snapshot.test.ts`: `(stage, n)` unique; hold `id` unique and starting
  `<kind>-`; `verdict` non-null exactly when `result` is DIRTY; `released` non-null exactly when `state` is
  RELEASED; `released_by` `{comment: int, reset: bool}` non-null exactly when RELEASED; `question` non-null,
  non-empty exactly when `kind` is escalation; `spec_pr` an int ≥ 1 or null, null for every kind but rescope;
  `at`, `since`, `released` `YYYY-MM-DDTHH:MM:SSZ`; `head` 40-hex; `n` ≥ 1; each pushback's round exists; `v` is
  1 (FR-012; data-model.md, Snapshot)
- [x] T033 [P] [US2] Write `core/tests/state-read.test.ts` on `stateFrom(comments, deletions, moves, shared)`:
  AS1 (the newest by the reviewer App among newer admin and orchestrator App comments); AS2 (`tampered` on
  `lastEditedAt`; `deleted` when a reviewer App deletion's `createdAt` is at or after the state comment's, same
  second included, or with no reviewer App comment; `invalid` for an untagged newest beside an older tagged one,
  the older never read); AS3 (no reviewer App comment and no deletion → no state, not held); AS4; AS5 (contract
  error named with the comment URL); AS10; a `Bot` login matched with `[bot]` appended; the tag only in a quoted
  reply → `invalid`; two comments in one second settled by `databaseId`; causes combine; the working snapshot is
  the state comment's with no tamper cause, else the newest unedited, tagged, valid reviewer App comment's with
  `rebuilt` true, else empty (FR-015 to FR-017, SC-002; R15; contracts/state-comment.md, Read outcomes)
- [x] T034 [P] [US2] Write `core/tests/release.test.ts`, one fixture set, each fixture run through `stateFrom` and
  through `releaseOnClaim` on the fake client so both give one answer (SC-002, critique X1):
  - AS12: hold `since` 10:00, admin comment 10:30, Ready move 11:00 → releasable, released by the 10:30 comment
    (`{id, url, at}`, `reset` false), edited or not; not releasable when the only later comment is by any of the
    four App logins or its `authorAssociation` is not OWNER, MEMBER or COLLABORATOR; nor when the
    only later Ready move has `project.url` other than `[shared] board` or a `status` other than `Ready`; nor when
    the comment or the move is in the same second as `since` or before it; a Ready move on the board counts
    whoever made it, a board workflow's or an App's included; the order of comment and move does
    not matter (Edge Cases)
  - AS13: an escalation hold whose question, the oldest orchestrator App comment whose first line is
    `questionTag(hold)`, is at 10:10: an admin comment at 10:05 → not releasable; at 10:20 with Ready after →
    releasable; with no question posted → releasable only by a reset
  - AS14: three open holds and an admin's `/codeworks reset`, trimmed, after all three → all releasable,
    `reset: true`, `reset` reported; a reset older than a hold leaves it; a reset by an App counts for nothing
  - a tamper cause is released when a Ready move and an admin comment both follow the newest of its edit,
    deletion or invalid comment; `tamper_released` and `startable` (every tamper cause released, every open hold
    releasable)
  - `readState` throws `BoardNotVisible(board)` when no `projectItems` entry's `project.url` is `[shared] board`
    (FR-019, FR-019a, FR-019b; R27; contracts/state-comment.md, Release)
- [x] T035 [P] [US2] Write `core/tests/state-write.test.ts` against the fake client, which fails any PATCH or
  DELETE and serves `now()`:
  - `writeState` posts one comment, the tag line then the snapshot in a `json` fence, sorted keys, two-space
    indent (AS6); each appended round's `at` is `now()`, whatever the caller gave; refused while `tampered`,
    `deleted` or `invalid` stands, naming it and its release (AS7); `checkTransition` refuses dropping or
    rewriting a round or pushback and any hold row change; a body over 65,536 characters is refused naming the
    size
  - `placeHold`: adds a row OPEN, `since` from `now()`; moves a RELEASED row to OPEN with a new `since` and
    question, `released` and `released_by` cleared; posts nothing on an OPEN row; refused for kind `rescope` and
    for an escalation without a question
  - `placeRescopeHold` (AS8): spec PR #301 on 212 → one snapshot with `rescope-212` OPEN recording 301; #301
    again, open or released → nothing posted; released, then #305 → OPEN recording 305; placed by a RESCOPE
    verdict (null), then #301 while OPEN → OPEN recording 301, `since` from `now()`
  - `releaseOnClaim` (AS15): posts one snapshot with every releasable hold RELEASED, `released` from `now()`,
    `released_by` the releasing comment's `databaseId` and whether it was a reset, every other row unchanged;
    with a released tamper cause and no open hold, posts the rebuilt working snapshot; posts nothing when it
    releases no hold and no tamper cause; refused while a tamper cause stands unreleased; decides and writes over
    one read (FR-018 to FR-020; R16; contracts/state-comment.md, Write rules)
- [x] T036 [P] [US2] Write `core/tests/attest.test.ts`. Pure, on fixtures: `passingRounds` lists INTERNAL and AUDIT
  rounds CLEAN, or DIRTY with CONVERGED_PUSHBACK, newest first, never GITHUB; `governingDiff(atBase, atRound,
  specFolder)` over `ls-tree -r -t` listings names a different or one-sided object at `<specFolder>/spec.md`, a
  tree `docs/adr` or ending `/docs/adr`, or `.specify/memory`, and nothing for any other path;
  `releasedByComment` names a hold with `released_by.reset` false and `released` after the round's `at`, none for
  a reset. In scratch repos with `attests(checkout, reading, head, base, specFolder)` (AS11): INTERNAL CLEAN at A,
  B on top → attested; history rewritten without A → not; a round commit the clone lacks → not in history, the
  next passing round tried; on `base` since A a change to the spec's `spec.md`, `docs/adr/x.md`,
  `plugin/docs/adr/x.md` or `.specify/memory/x.md` → not, `reason` naming the path, and to any other file →
  attested; a merge of `base` into the branch as git made it → attested, amended → not, resolved from a conflict
  → not, `reason` naming the merge; a hold released by a comment after A's round → not, by a reset → attested;
  held → not; no state → not; a missing head throws (FR-016, SC-002; R16; contracts/state-comment.md,
  Attestation)

### Implementation for User Story 2

- [x] T037 [US2] Add `now()` to `core/src/github.ts` (R12)
- [x] T038 [US2] Create `core/src/settings.ts`: `readSettings(tree)` with `smol-toml`, the `Shared` strict schema
  of contracts/codeworks-toml.md, `validators` entries by `ModuleName`, `SettingsError(where, why)` (R14)
- [x] T039 [US2] Create `core/src/contracts/snapshot.ts` with its refinements; add it to `write-schemas.ts`'s
  list, see `core/tests/schemas.test.ts` fail naming the missing file, then run the script to write
  `core/schemas/snapshot.schema.json` (R8)
- [x] T040 [US2] Create the read half of `core/src/state.ts`: `stateFrom` up to the working snapshot and
  `readState(reader, repo, issue, shared)`, one paginated GraphQL read of comments (`databaseId`, `author {
  __typename login }`, `authorAssociation`, `body`, `createdAt`, `lastEditedAt`, `url`), `COMMENT_DELETED_EVENT`
  (`createdAt`, `deletedCommentAuthor`) and `PROJECT_V2_ITEM_STATUS_CHANGED_EVENT` (`createdAt`, `status`,
  `project { url }`) items and `projectItems { project { url } }`,
  throwing `BoardNotVisible`, returning `StateReading` (data-model.md; R15)
- [x] T041 [US2] Add the release rule to `core/src/state.ts`: `questionTag(hold)`, the admin comment, Ready move,
  question and reset terms, `releasable`, `tamper_released`, `startable` and `reset` in `stateFrom` (R27)
- [x] T042 [US2] Add the writes to `core/src/state.ts`: `renderState`, `checkTransition`, `writeState`,
  `placeHold`, `placeRescopeHold`, `releaseOnClaim`, with `StateWriteRefused(cause, release)`; REST `POST
  /repos/{o}/{r}/issues/{n}/comments` only (R16)
- [x] T043 [US2] Create `core/src/attest.ts`: `passingRounds`, `governingDiff`, `releasedByComment` and `attests`,
  git through `runGit` (`merge-base --is-ancestor` with answers 1 and 128, `ls-tree -r -t`, `rev-list --merges`,
  `merge-tree --write-tree` with answer 1, `rev-parse <commit>^{tree}`) (R16)
- [ ] T044 [US2] Run quickstart.md US2 against a test repo with the reviewer App installed and its issues on a
  test board; record what ran and its result in the PR

**Checkpoint**: US2's PR passes `npm test`; every tampered, deleted, untagged or invalid fixture reads as held,
every release fixture gives one answer to both calls, every lapse fixture reads as not attested

---

## Phase 5: User Story 3 - A component reads every external reviewer and required check through one contract (Priority: P2)

**Goal**: the validator contract and its loader, core's answers over a module, the threads module and the
required-checks reader, each answering in the Findings contract, COULD_NOT_RUN never read as PASS, FAIL or an
empty list; the key read packages are handed

**Independent Test**: with the fixture validator package and recorded GitHub responses for one PR head, check the
loaded modules, `trigger`, `status` and `findings` against the contract, and the threads module's and the
required-checks reader's answers (quickstart.md, US3)

### Tests for User Story 3 ⚠️ (write first, see each fail)

- [ ] T045 [P] [US3] Write `core/tests/outcomes.test.ts`: `outcomeOf` maps `success`, `neutral`, `skipped` →
  PASS; `failure` → FAIL; `error`, `cancelled`, `timed_out`, `action_required`, `startup_failure`, `stale` →
  COULD_NOT_RUN; queued, in progress, pending or absent → PENDING (R17)
- [ ] T046 [P] [US3] Write `core/tests/finding.test.ts`: `source` a `FindingSource`; `key` non-empty; `line` ≥ 1
  or null; `resolvable` true exactly when `thread_id` is set; `latest_trusted_comment_id` set exactly when
  `thread_id` is set; `trusted_comments` empty without a thread (FR-012; data-model.md, Finding)
- [ ] T047 [P] [US3] Write `core/tests/keys.test.ts` on pure checks with injected stats, `lstat` answers and file
  text: a `file` that is not a bare file name is refused; a key not owned by the current user, or with any group
  or other bit, is refused naming the mode; managed settings not in effect (file missing, not root-owned, folder
  or file writable by others, not JSON, any setting of contracts/key-files.md missing or different,
  `<plugin>@codeworks` not enabled, an `enabledPlugins` entry true that §5 does not list) → `KeyReadRefused`
  naming every reason (US5 AS4); a `managed-settings.d` folder or `~/.claude/remote-settings.json` present →
  refused naming it, an `lstat` error other than ENOENT throws (US5 AS5); planner's read of `planner-app.pem`
  skips the settings check, every read of `session-app.pem`, `reviewer-app.pem` or a package's token does not; a
  platform other than Linux is refused naming it (FR-036, FR-038; R23)
- [ ] T048 [P] [US3] Write `core/tests/security-settings.test.ts`: parse `SECURITY.md` §5's JSON block and fail
  when an entry is in neither the required-settings table of `keys.ts` nor its named exceptions (`<V>/ghcreds`,
  `<V>/plugin/gaterev`, the session's gh config folder, `<C>` and its `env` entries, `allowedDomains`), or when
  §5's `enabledPlugins` list differs from the list `keys.ts` allows (R23)
- [ ] T049 [P] [US3] Create the fixture packages under `core/tests/fixtures/validators/`: `fixture/index.ts`
  exporting `logins = ["fixture-bot[bot]"]` and `open(deps)` whose `trigger`, `status` and `findings` answer what
  the test sets (an answer, a throw, a call count) and whose `findings` includes `deps.providerThreads(repo, pr)`;
  `no-status/index.ts` lacking `status`; `bad-logins/index.ts` exporting `logins` as a string; each imports core
  with `import type` only (R20)
- [ ] T050 [P] [US3] Write `core/tests/contract.test.ts` over the fixture packages and the fake client:
  - AS1: `validators = ["fixture"]` loads one module and `logins` holds `fixture-bot[bot]`; `["nope"]` (no
    folder), `["Bad_Name"]`, `["threads"]`, `["required-checks"]`, `["no-status"]`, `["bad-logins"]` throw
    `ValidatorLoadError` naming the name and why; the package's `open` gets `reader`, `writer`, a `readKey` bound
    to the caller's plugin and `providerThreads`
  - AS2: PASS or FAIL naming the head asked → that; naming another head or `null` → PENDING; WAIVED → WAIVED
  - AS3: PENDING with `now() − since` ≥ `timeoutSeconds` → SILENT, below it → PENDING, `now()` from the module's
    client
  - AS4, AS5: a throw from `trigger`, `status` or `findings`, an outcome outside the four, a finding `Finding`
    refuses or whose `source` is not `fixture` → COULD_NOT_RUN naming the module and the error
  - AS8: a finding whose thread's `author` is one of `[shared]`'s four App logins is dropped
  (FR-022 to FR-025, FR-028; R18, R19)
- [ ] T051 [P] [US3] Write `core/tests/threads.test.ts`: AS7 (fixture enabled, `trusted_reviewers = ["alice"]`:
  the `fixture-bot` thread a fixture finding only, through `providerThreads`, with `source` `fixture`; the
  `alice` thread a threads finding only; the `bob` thread no finding and listed by `untrusted`); AS8 (a thread
  started by any of the four Apps is never a finding and is in `untrusted`); a GraphQL `Bot` author's bare login
  matched with `[bot]` appended and carried so in `author`; `trusted_comments` and `latest_trusted_comment_id`
  from trusted authors only; key `thread:<thread_id>`; a missing `trusted_reviewers` throws `SettingsError`;
  `untrusted` lets `GitHubUnanswered` propagate (FR-028, FR-029, SC-005; R21)
- [ ] T052 [P] [US3] Write `core/tests/required-checks.test.ts`: the base read from the PR, then checks from
  `rules/branches/{base}` `required_status_checks`, dropping `internal-review` and `fixture-review` with the
  fixture loaded (AS6); none left → COULD_NOT_RUN for status and findings (AS9); matched among check runs by
  name, and App id when the rule pins `integration_id`, and among statuses by context; a `failure` → one finding
  `required-check:<name>` naming the check and its conclusion (AS6); status any FAIL → FAIL, else any
  COULD_NOT_RUN → COULD_NOT_RUN, all PASS → PASS, else PENDING; never SILENT; no `trigger` (FR-027; R22)
- [ ] T053 [P] [US3] Write `core/tests/could-not-run.test.ts`, one table: the required-checks reader with a check
  run in `error`, `cancelled` or `timed_out`, a `GitHubUnanswered`, a GraphQL `RATE_LIMITED`; core's answers over
  the fixture package throwing `GitHubUnanswered` or an `Error` → COULD_NOT_RUN from both `status` and
  `findings`, never PASS, FAIL or `[]` (FR-024, AS4, SC-004; R17)

### Implementation for User Story 3

- [ ] T054 [US3] Create `core/src/outcomes.ts`: `outcomeOf`, `StatusAnswer`, `CouldNotRun` (R17)
- [ ] T055 [US3] Create `core/src/contracts/finding.ts`; add it to `write-schemas.ts`'s list, see
  `core/tests/schemas.test.ts` fail naming the missing file, then run the script to write
  `core/schemas/finding.schema.json` (R8)
- [ ] T056 [US3] Create `core/src/keys.ts`: `readKey(file, plugin)`, the pure file and settings checks, the
  one-source check, the required-settings table, the allowed `enabledPlugins` list and the exceptions, and
  `KeyReadRefused(path, reasons)` (R23; contracts/key-files.md)
- [ ] T057 [US3] Create `core/src/validation/threads.ts`: the paginated `reviewThreads(reader, repo, pr)` read,
  login normalisation, the provider-thread finding builder `providerThreads` uses, `threadsModule(shared, reader,
  validators)` with `findings` and `untrusted` (R21)
- [ ] T058 [US3] Create `core/src/validation/contract.ts`: `loadValidators(shared, dir, {reader, writer, plugin})`
  importing `<dir>/<name>/index.ts` per `validators` entry, handing each `open({reader, writer, readKey: file =>
  readKey(file, plugin), providerThreads})`, each module carrying those `deps` and `shared`;
  `ValidatorLoadError(name, why)`; core's `trigger`, `status` and `findings` over a module (R18, R19;
  contracts/core-api.md)
- [ ] T059 [US3] Create `core/src/validation/required-checks.ts`: `requiredChecks(shared, reader, validators)`,
  `GitHubUnanswered` turned into COULD_NOT_RUN at its boundary (R22)
- [ ] T060 [US3] Run quickstart.md US3 against a test repo; record what ran and its result in the PR

**Checkpoint**: US3's PR passes `npm test`; every could-not-run fixture yields COULD_NOT_RUN from core's answers
over the fixture package and from the required-checks reader

---

## Phase 6: User Story 5 - A hook mints an App's token through core (Priority: P3)

**Goal**: a one-hour installation token of one App for one repo, that App's permissions only, with no fallback

**Independent Test**: with a test App's credentials, mint a token for one repo and check its expiry, repository
list and permissions; try a write outside the set and to a second repo (quickstart.md, US5)

### Tests for User Story 5 ⚠️ (write first, see each fail)

- [ ] T061 [P] [US5] Write `core/tests/tokens.test.ts` against a local `node:http` server and a key the test
  generates: the JWT is RS256 with `iat` now − 60 s, `exp` now + 9 min, `iss` the App ID; the request names
  `repositories: [name]` and exactly the App's permissions under GitHub's API keys; an answer naming another
  repository, with `expires_at` over one hour away, lacking or lowering a requested permission, or adding any but
  `metadata: read` is refused; a 404 names "not installed on <repo>"; a missing key names its path; no other
  credential is tried; the token value is in no error message (FR-035 to FR-037, AS2, AS3; R24)
- [ ] T062 [P] [US5] Write `core/tests/security-permissions.test.ts`: each of the four Apps' permission sets in
  `tokens.ts` equals `SECURITY.md` §3, mapping §3's names to API keys ("projects" → `organization_projects`); the
  orchestrator's holds `workflows: write` (contracts/key-files.md)

### Implementation for User Story 5

- [ ] T063 [US5] Create `core/src/tokens.ts`: `mintToken(app, appId, keyFile, plugin, repo)` with the session,
  orchestrator, reviewer and planner permission sets of contracts/key-files.md, the key read through `readKey`,
  signing with `node:crypto`, and `MintError(cause)` (R24)
- [ ] T064 [US5] Mint a real token of each App for a test repo (quickstart.md, US5): expiry within one hour,
  scoped to that repo, the answer's permissions as T061 expects (confirming whether GitHub adds `metadata:
  read`); a comment on another repo and a write outside the set refused; record the results in the PR (AS1,
  SC-008)

**Checkpoint**: US5's PR passes `npm test`; each App's real token is scoped to one repo and one hour

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T065 On US5's branch, run `npm test` and `node scripts/check-carriers.ts --base origin/main` in `core/`,
  and check every acceptance scenario of US1, US2, US3 and US5 has a passing test or a recorded run

---

## Dependencies & Execution Order

### Phase Dependencies

- T005, an admin's PR, merges first; then **Setup (Phase 1)** but T005 → **Foundational (Phase 2)** → US1, all in
  US1's PR
- T028, an admin's PR, after US1 merges and before any carrier
- **US2** after US1 merges: uses `github.ts`, `git.ts`, `tree.ts`, `values.ts` and `write-schemas.ts`
- **US3** after US2 merges: uses `settings.ts` (`Shared`: `validators`, `trusted_reviewers`, the App logins)
- **US5** after US3 merges: uses `keys.ts`
- **Polish** after US5

### Within Each Story

- Each test task before the task that makes it pass, seen red for the expected reason
- Contracts and pure rules before their readers; in US2 `state.ts` read half → release rule → writes; in US3
  `keys.ts` and `threads.ts` before `contract.ts`, `required-checks.ts` last

### Parallel Opportunities

- T003, T004 in Setup; T006, T008, T009, T011, T013 in Foundational
- Every test task marked [P] within a story

---

## Parallel Example: User Story 2

```bash
Task: "Write core/tests/settings.test.ts"
Task: "Write core/tests/snapshot.test.ts"
Task: "Write core/tests/state-read.test.ts"
Task: "Write core/tests/release.test.ts"
Task: "Write core/tests/state-write.test.ts"
Task: "Write core/tests/attest.test.ts"
```

## Parallel Example: User Story 3

```bash
Task: "Write core/tests/outcomes.test.ts"
Task: "Write core/tests/finding.test.ts"
Task: "Write core/tests/keys.test.ts"
Task: "Write core/tests/contract.test.ts"
Task: "Write core/tests/threads.test.ts"
Task: "Write core/tests/required-checks.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. T005 in an admin's PR under the exempt label
2. Phases 1 and 2 but T005, then US1, in one PR
3. Validate with quickstart.md US1; then T028 in an admin's PR under the exempt label

### Incremental Delivery

US1 → US2 → US3 → US5, one PR each (R26). No carrier exists, so no story bumps a plugin.

---

## Notes

- No task edits a component, and no task builds a provider package: both are follow-up work (spec Assumptions)
- No task adds a command, `bin` or module that acts on import (T008 grades it)
- T044, T060 and T064 need test Apps, a test board and their keys, which only the user holds
- T029 runs `claude` and records its result in the PR, both refused to the model (reviewer ADR-0012): the user
  runs it
- T005 and T028 change `.github/`, so they are an admin's PRs, never a story's (reviewer ADR-0002 d4)
