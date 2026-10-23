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
  replaying recorded responses (plan, Testing); no test calls github.com.

---

## Phase 1: Setup (in US1's PR)

**Purpose**: the `core/` package skeleton and CI running its suite

- [ ] T001 Create `core/package.json`: `"private": true`, `"type": "module"`, `"engines": {"node": ">=22.18"}`,
  `dependencies` exactly `zod` 4.6.7, `smol-toml` 1.9.1, `yaml` 2.9.1, `devDependencies` exactly `typescript`
  7.0.2 and `@types/node` 22.20.5, `scripts.test` = `tsc -p . && node --test 'tests/**/*.test.ts'`, no `bin`
  (R2, R25)
- [ ] T002 Run `npm install` in `core/` to write `core/package-lock.json` (lockfile v3) (R2)
- [ ] T003 [P] Create `core/tsconfig.json`: `strict`, `noEmit`, `erasableSyntaxOnly`,
  `allowImportingTsExtensions`, `verbatimModuleSyntax`, `module` and `moduleResolution` `nodenext`, covering
  `src`, `scripts` and `tests` (R1)
- [ ] T004 [P] Add `node_modules/` to `.gitignore` (R2)
- [ ] T005 Branch the `unittest` matrix run step in `.github/workflows/tests.yml`: for `core/tests` run `npm ci`
  and `npm test` in `claude-plugins-internal/core`; every other suite keeps `python -m unittest -v` (R6). The PR
  changes `.github/`, so it needs the exempt label (orchestrator ADR-0004 d4)

---

## Phase 2: Foundational (in US1's PR)

**Purpose**: what every story's modules rest on: the value sets, the GitHub client, `Tree`, and the tests that
grade all of `core/src`

**⚠️ CRITICAL**: no story module can be written before this phase is done

- [ ] T006 [P] Write `core/tests/values.test.ts`: each set holds exactly these values, each with a meaning — round
  result CLEAN, DIRTY, INCOMPLETE; round verdict PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK,
  ESCALATE; finding ruling FIX, PUSH_BACK, DEFER; root cause AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL,
  NOT_APPLICABLE; check outcome PENDING, PASS, FAIL, SILENT, COULD_NOT_RUN, WAIVED; hold kind rescope,
  escalation, pushback, claim, shim, audit; hold state OPEN, RELEASED; round stage INTERNAL, AUDIT, GITHUB;
  module name codex, coderabbit, deepsource, threads, required-checks (FR-012a). Plus the value-string scan: every
  file in `core/src`, a quoted string equal to a value of any enum core exports, outside the file that defines
  it, fails naming file and line; the scan is seen red on an in-memory file holding `'CLEAN'` (R7, SC-009)
- [ ] T007 Create `core/src/values.ts`: each set of T006 as `{schema: z.enum([...]), meaning: Record<value,
  string>}`, no TS `enum` (R1, R7)
- [ ] T008 [P] Write `core/tests/boundary.test.ts`: every import specifier in `core/src` is `node:*`, a relative
  path inside `core/src`, or `zod`, `smol-toml` or `yaml` (FR-005); `core/package.json` has no `bin` and
  `core/src` holds no `commands/`, `skills/`, `agents/`, `hooks/`, `bin/` or `.claude-plugin/` (FR-021, SC-003,
  US2 AS9). Each check seen red on a fixture under `core/tests/fixtures/boundary/` (an import of
  `../../reviewer/x.ts`, a `commands/` folder) (R25)
- [ ] T009 [P] Write `core/tests/github.test.ts` against a local `node:http` server: REST `Link` pagination read
  to the end; GraphQL cursor pagination read to the end; a request timeout; a network error, timeout, 5xx, 429,
  403 with `x-ratelimit-remaining: 0`, and 403 or 429 with `retry-after` throw `GitHubUnanswered`; any other 4xx
  throws `GitHubRefused(status, message)`; a GraphQL `200` with non-empty `errors` never returns `data`: type
  `RATE_LIMITED` throws `GitHubUnanswered`, any other `GitHubRefused`; no token, no client (R12; FR-037)
- [ ] T010 Create `core/src/github.ts`: `gitHub(token, api = "https://api.github.com")` →
  `{rest, restPages, graphql, graphqlPages}` over Node's `fetch`, with `GitHubUnanswered` and `GitHubRefused`
  (contracts/core-api.md) (R12)
- [ ] T011 [P] Write `core/tests/tree.test.ts`: `gitTree` on a git repo the test creates in a temp folder
  (`listDir`, `readText`, `blobSha` at a ref, git run with `-c core.fsmonitor=false -c core.hooksPath=/dev/null`);
  `gitHubTree` through the fake client over the contents API (R11)
- [ ] T012 Create `core/src/tree.ts`: `Tree`, `gitTree(checkout, ref)` through `node:child_process` `execFile`,
  `gitHubTree(client, repo, ref)` (R11)

**Checkpoint**: `npm test` in `core/` passes; the value-string, boundary, client and tree tests grade every later
module unchanged

---

## Phase 3: User Story 1 - A plugin carries core and reads a story's identity (Priority: P1) 🎯 MVP

**Goal**: core ships to a plugin through the symlink, refuses when a dependency is missing, and answers a
story's identity, requirement and DONE from one parser

**Independent Test**: install the fixture plugin from a git-hosted fixture marketplace, then call the identity
functions on fixture branch names, issue trees, spec folders and PR lists (quickstart.md, US1)

### Tests for User Story 1 ⚠️ (write first, see each fail)

- [ ] T013 [P] [US1] Write `core/tests/guard.test.ts`: `requireDependencies()` reads the nearest `package.json`
  above its own file and throws `MissingDependency(name, root)` for the first dependency `import.meta.resolve`
  cannot find; run on copies of `core/src/guard.ts` in temp folders, one with all three dependencies resolvable
  and one without `zod` (FR-003, AS3; R4)
- [ ] T014 [P] [US1] Write `core/tests/branch.test.ts`: `parseBranch('212-us2-retry-budget')` →
  `{story: 212, k: 2, slug: 'retry-budget'}`; `'145-spec'` → `{spec: 145}`; `'main'`, `'feature/x'`,
  `'212-us-retry'`, `'0212-us2-x'`, `'212-us2-'`, `'212-spec-x'` → `null` (FR-007, AS4, Edge Cases; R10)
- [ ] T015 [P] [US1] Write `core/tests/spec-facts.test.ts`: `readSpecFacts` accepts `codeworks: {v: 1, kind,
  root_cause: {observed}}` with `kind` one of `feature`, `defect`, `no_spec` and `observed` one of `anchored`,
  `hypothesis`, `none`; no front matter, no `codeworks` key, an unknown key or a value outside `SpecKind` or
  `RootCauseObserved` fails naming the file and the error (FR-010; R9)
- [ ] T016 [P] [US1] Write `core/tests/identity.test.ts` on fixture data and the fake client:
  - `specIssue`: parent 200 → 200; no parent → 145; a parent in another repo fails naming it; only the immediate
    parent is read (FR-008, AS5, Edge Cases)
  - `pickSpecFolder` and `specFolder`: exactly one `specs/200-*/` → it; none or several fail naming what was
    found; a folder renamed by a rescope is read at the ref asked about (FR-008, AS6)
  - `pickStoryPr` and `storyPr`: three same-repo PRs on `212-us2-retry-budget` and one fork PR of that head name
    → the newest same-repo PR; a body holding `Closes #212` is never read (FR-009, AS7)
  - `storyBranch`: refs under `heads/212-us` parsing to 212 → it; none → null; several fail naming them (R13)
  - `requirement`: `kind: feature` → the folder's `spec.md`; `kind: no_spec` → the issue body (FR-010, AS8)
  - `doneFrom` and `isDone`: a merged PR → done; a `ClosedEvent` by a `User` → done; closed by the session App
    with the PR unmerged → not done; a reopened done issue → done; a merged PR found only from the timeline
    (`ClosedEvent.closer`, `CrossReferencedEvent`, `ConnectedEvent`) with its head branch deleted and a `Bot`
    closer → done; a timeline PR that is unmerged, cross-repo, or whose `headRefName` does not parse to
    `{story: 212}` never counts (FR-011, AS9; R13)
- [ ] T017 [P] [US1] Write `core/tests/carriers.test.ts` on the pure decision of `check-carriers.ts` over fixture
  carriers: symlink not `../../core/src`; `package.json` without `"type": "module"`; a core pin missing or at
  another version; lockfile missing, not v3, or pinning another version; a change to `core/src/**` or to
  `core/package.json` `dependencies` with a carrier's `plugin.json` `version` equal to the base's; a test-only
  change needs no bump; each failure names the carrier, the file and the expected value. Plus the thin git reader
  on a temp repo, against a base ref and against `HEAD~1` (FR-004, AS2; R5; contracts/carrying-core.md)
- [ ] T018 [P] [US1] Write `core/tests/fixture-carrier.test.ts`: the fixture plugin's `package.json`
  dependencies and `package-lock.json` versions equal `core/package.json`'s runtime pins, and its `core` link is
  `../../../src` (the `*/plugin/core` glob does not reach it; R26)
- [ ] T019 [P] [US1] Write `core/tests/schemas.test.ts`: regenerates in memory every `{schema, file}` of the list
  `core/scripts/write-schemas.ts` exports and fails naming the file and `node scripts/write-schemas.ts` when a
  file differs or is missing; seen red with the SpecFacts entry and no file (FR-013; R8)

### Implementation for User Story 1

- [ ] T020 [US1] Create `core/src/guard.ts`, importing only `node:` modules: `requireDependencies()` and
  `MissingDependency(name, root)` (R4)
- [ ] T021 [US1] Create `core/src/contracts/spec-facts.ts`: `SpecKind`, `RootCauseObserved` as named `z.enum`s
  spelt as planner ADR-0008 d1 fixes them, `SpecFacts` as a `z.strictObject`, `readSpecFacts(text)` reading the
  front matter between the first `---` line and the next with `yaml`'s `parse` (R7, R9)
- [ ] T022 [US1] Create `core/src/identity.ts`: `parseBranch` with story `^([1-9][0-9]*)-us([1-9][0-9]*)-([a-z0-9]+(?:-[a-z0-9]+)*)$`
  and spec `^([1-9][0-9]*)-spec$`; pure `pickStoryPr`, `pickSpecFolder`, `doneFrom`; readers `specIssue`,
  `specFolder`, `storyPr`, `storyBranch`, `requirement`, `isDone` with `DerivationError(what, found)`
  (data-model.md, Story identity; R10, R13)
- [ ] T023 [US1] Create `core/scripts/write-schemas.ts`: one exported list of `{schema, file}`, holding
  SpecFacts; writes `z.toJSONSchema` output, keys sorted, two-space indent; run it to write
  `core/schemas/spec-facts.schema.json` (R8)
- [ ] T024 [US1] Create `core/scripts/check-carriers.ts`: the pure decision of T017 and a git reader (`diff
  --name-only <base>...HEAD`, `show <base>:<path>`), `--base <ref>` (R5)
- [ ] T025 [US1] Create the fixture carrier `core/tests/fixtures/carrier-plugin/`: `core` → `../../../src`,
  `package.json` (`"type": "module"`, core's three pins), `package-lock.json` from `npm install`,
  `.claude-plugin/plugin.json` with a pinned `version`, `hooks/hooks.json` declaring a `UserPromptSubmit` hook
  with `"onFailure": "block"` that runs `node ${CLAUDE_PLUGIN_ROOT}/hooks/identity.ts`, and that file as
  contracts/carrying-core.md shows: `guard.ts` imported statically, `MissingDependency` caught and exit 2 naming
  the package on stderr, then `await import('../core/identity.ts')` and print
  `parseBranch('212-us2-retry-budget').story` (FR-002, FR-003; R3, R4)
- [ ] T026 [US1] Add the `carriers` job to `.github/workflows/tests.yml`: on `pull_request` and push to `main`,
  checkout with `fetch-depth: 0`, Node 22, `npm ci` in `core/`, then `node scripts/check-carriers.ts --base
  origin/<base>`, or `--base HEAD~1` on a push (R5, R6)
- [ ] T027 [US1] Run quickstart.md US1 steps 1–5 (end-to-end install, update without and with a bump, missing
  `zod`, a throwaway carrier failing `check-carriers.ts`); try steps 1–4 on a CI runner (research Open 1); record
  what ran and its result in the PR (AS1–AS3, SC-007)

**Checkpoint**: US1's PR passes `npm test` and the `carriers` job; the fixture carrier installs and imports core

---

## Phase 4: User Story 2 - A component reads and writes a story's reviewer state through one module (Priority: P1)

**Goal**: one module reads the reviewer App's newest comment as the story's state, holds the story on tampered,
deleted or invalid state, writes new snapshots only, and attests stage 1

**Independent Test**: read fixture comment lists for the snapshot and held answer; write a snapshot and a rescope
hold through the recorded fake and inspect the comment posted (quickstart.md, US2)

### Tests for User Story 2 ⚠️ (write first, see each fail)

- [ ] T028 [P] [US2] Write `core/tests/settings.test.ts` through a fixture `Tree`: contracts/codeworks-toml.md's
  example is valid; an unknown `[shared]` key is refused naming it; a missing `validators`, `session_app_id`,
  `session_app_login`, `reviewer_app_id` or `reviewer_app_login` is refused naming it; `deepsource_source`
  (`api` · `github`) required exactly when `validators` holds `deepsource`; duplicate `validators` refused; a
  `trusted_reviewers` entry naming `chatgpt-codex-connector[bot]`, `coderabbitai[bot]` or `deepsource-io[bot]`
  while its module is enabled is refused; a missing file fails naming the ref; another section comes back parsed
  and unvalidated, `{}` when absent; an environment variable named like a key changes nothing (FR-006; R14, R21)
- [ ] T029 [P] [US2] Write `core/tests/snapshot.test.ts`: `(stage, n)` unique; hold `id` unique and starting
  `<kind>-`; `verdict` non-null exactly when `result` is DIRTY; `spec_md_blob` 40-hex and non-null exactly when
  `kind` is rescope; `head` 40-hex; `n` ≥ 1; each pushback's round exists; `v` is 1 (FR-012; data-model.md,
  Snapshot)
- [ ] T030 [P] [US2] Write `core/tests/state-read.test.ts` on `parseState(comments, deletions, reviewerLogin)`:
  AS1 (the newest by the reviewer App among newer human and session App comments); AS2 (`tampered` on
  `lastEditedAt`; `deleted` when a reviewer App deletion's `createdAt` is at or after the state comment's (same second
  included), or with
  no reviewer App comment; `invalid` for an untagged newest beside an older tagged one, the older never read);
  AS3 (no reviewer App comment and no deletion → no state, not held); AS4; AS5 (contract error named with the
  comment URL); AS10; a `Bot` login matched with `[bot]` appended; the tag only in a quoted reply → `invalid`;
  two comments in one second settled by `databaseId`; causes combine (FR-015 to FR-017, SC-002; R15)
- [ ] T031 [P] [US2] Write `core/tests/state-write.test.ts` against the fake client, which fails any PATCH or
  DELETE: `writeState` posts one comment, the tag line then the snapshot in a `json` fence, sorted keys,
  two-space indent (AS6); refused while `tampered`, `deleted` or `invalid` stands, naming it and its release
  (AS7); `checkTransition` refuses dropping or rewriting a round, hold row or pushback and allows appending
  rounds, adding rows, OPEN ↔ RELEASED, a rescope row's new `spec_md_blob` only with RELEASED → OPEN, and adding
  pushbacks; a body over 65,536 characters is refused naming
  the size; `placeRescopeHold` on 212 adds an open `rescope-212` with `spec.md`'s blob SHA on the story's branch,
  else the default branch, moves a RELEASED row to OPEN with the new SHA, and posts nothing on an OPEN row
  (AS8); `releaseState` reposts the
  newest unedited, tagged, valid comment, or `{"holds": [], "pushbacks": [], "rounds": [], "v": 1}`, and is
  refused when none of the three causes stands (FR-018 to FR-020; R16; contracts/state-comment.md)
- [ ] T032 [P] [US2] Write `core/tests/attests.test.ts`: `passingHeads` lists INTERNAL and AUDIT rounds CLEAN, or
  DIRTY with CONVERGED_PUSHBACK, newest first; `attests` with the fake compare API: INTERNAL CLEAN at A, GITHUB
  DIRTY at B, compare `ahead` → true, `diverged` (history rewritten without A) → false (AS11); `identical` →
  true; an AUDIT pass counts; a GITHUB CLEAN alone → false; held → false; no state → false; a compare that gets
  no answer throws `GitHubUnanswered` (FR-016; R16)

### Implementation for User Story 2

- [ ] T033 [US2] Create `core/src/settings.ts`: `readSettings(tree)` with `smol-toml`, the `Shared` strict schema
  of contracts/codeworks-toml.md built from `values.ts`, `SettingsError(where, why)` (R14)
- [ ] T034 [US2] Create `core/src/contracts/snapshot.ts` with its refinements; add it to `write-schemas.ts`'s
  list, see `core/tests/schemas.test.ts` fail naming the missing file, then run the script to write
  `core/schemas/snapshot.schema.json` (R8)
- [ ] T035 [US2] Create the read half of `core/src/state.ts`: `parseState` and `readState(reader, repo, issue,
  reviewerLogin)`, one paginated GraphQL read of comments (`databaseId`, `author { __typename login }`, `body`,
  `createdAt`, `lastEditedAt`, `url`) and `COMMENT_DELETED_EVENT` items (`createdAt`, `deletedCommentAuthor`),
  returning `StateReading` (data-model.md; R15)
- [ ] T036 [US2] Add the writes to `core/src/state.ts`: `renderState`, `checkTransition`, `writeState`,
  `placeRescopeHold` (story branch through `storyBranch`, blob SHA through `gitHubTree`), `releaseState`, with
  `StateWriteRefused(cause, release)`; REST `POST /repos/{o}/{r}/issues/{n}/comments` only (R16)
- [ ] T037 [US2] Add `passingHeads(reading)` and `attests(reader, repo, reading, head)` to `core/src/state.ts`,
  using REST `GET /repos/{o}/{r}/compare/{base}...{head}` `status` `ahead` or `identical` (R16; orchestrator
  ADR-0004 d1)
- [ ] T038 [US2] Run quickstart.md US2 against a test repo with the reviewer App installed; record what ran and
  its result in the PR

**Checkpoint**: US2's PR passes `npm test`; every tampered, deleted, untagged or invalid fixture reads as held

---

## Phase 5: User Story 3 - A component reads every external reviewer and required check through one contract (Priority: P2)

**Goal**: Codex, CodeRabbit and DeepSource modules, the threads module and the required-checks reader, each
answering in the Findings contract, COULD_NOT_RUN never read as PASS, FAIL or an empty list

**Independent Test**: feed recorded GitHub responses for one PR head to each module and the reader, and check
`trigger`, `status` and `findings` against the contract (quickstart.md, US3)

### Recorded inputs

- [ ] T039 [US3] Record CodeRabbit's answers at a head from a repo running CodeRabbit (check runs, statuses,
  reviews, review threads) into `core/tests/fixtures/coderabbit/`, and settle which output carries its verdict
  (research Open 2; R19)
- [ ] T040 [P] [US3] Record DeepSource's API answers for a head commit (status and occurrences) into
  `core/tests/fixtures/deepsource-api/`, pinning the query shapes; needs a DeepSource token on the recording
  machine (R20)

### Tests for User Story 3 ⚠️ (write first, see each fail)

- [ ] T041 [P] [US3] Write `core/tests/outcomes.test.ts`: `outcomeOf` maps `success`, `neutral`, `skipped` →
  PASS; `failure` → FAIL; `error`, `cancelled`, `timed_out`, `action_required`, `startup_failure`, `stale` →
  COULD_NOT_RUN; queued, in progress, pending or absent → PENDING (R17)
- [ ] T042 [P] [US3] Write `core/tests/finding.test.ts`: `key` non-empty; `line` ≥ 1 or null; `resolvable` true
  exactly when `thread_id` is set; `latest_trusted_comment_id` set exactly when `thread_id` is set;
  `trusted_comments` empty without a thread; `source` a module name (FR-012)
- [ ] T043 [P] [US3] Write `core/tests/could-not-run.test.ts`, one table over every module (Codex, CodeRabbit,
  DeepSource `github` and `api`) and the required-checks reader: a check run in `error`, `cancelled` or
  `timed_out`, a `GitHubUnanswered`, a GraphQL `RATE_LIMITED` → COULD_NOT_RUN from both `status` and `findings`,
  never PASS, FAIL or `[]` (FR-024, AS3, SC-004; R17)
- [ ] T044 [P] [US3] Write `core/tests/threads.test.ts`: AS6 (Codex enabled, `trusted_reviewers = ["alice"]`:
  the `codex` thread a Codex finding only, the `alice` thread a threads finding only, the `bob` thread no finding
  and listed by `untrusted`); AS7 (a session App thread never a finding); a GraphQL `Bot` author's bare login
  matched with `[bot]` appended and carried so in `author`; `trusted_comments` and `latest_trusted_comment_id`
  from trusted authors only; key `thread:<thread_id>`; a missing `trusted_reviewers` throws `SettingsError`
  (FR-028, FR-029, SC-005; R21)
- [ ] T045 [P] [US3] Write `core/tests/codex.test.ts`, porting the cases of the org gate's `tests/pr-gate.test.js`:
  the newest non-dismissed review naming the head with the clean template → PASS; the findings preamble → FAIL
  with findings; no review at the head → PENDING; out of credits after the head's push with no verdict → WAIVED
  (AS1); no verdict and `requestedBy`'s newest `@codex review` after the push older than the timeout → SILENT
  (AS2); `trigger` posts `@codex review` through the `writer` passed (FR-023, FR-025; R18)
- [ ] T046 [P] [US3] Write `core/tests/coderabbit.test.ts` on T039's fixtures: outside-diff items as findings with
  no thread, not resolvable, key `coderabbit:<cr-comment id>` (AS4); the same item at two heads keeps its key
  (AS10); a review declaring more items than parse → COULD_NOT_RUN naming it; `trigger` does nothing (AS8);
  `status` from the verdict source T039 settled, SILENT past the timeout from the head's push (FR-026; R19)
- [ ] T047 [P] [US3] Write `core/tests/deepsource.test.ts`: `github` source status FAIL, else COULD_NOT_RUN, all
  PASS → PASS, SILENT past the timeout, else PENDING; thread-less findings from annotations, COULD_NOT_RUN in
  their place when a run maps to COULD_NOT_RUN; `api` source on T040's fixtures; a missing, unreadable or refused
  token → COULD_NOT_RUN, never the `github` source; `deepsource-io[bot]` threads from GitHub in both; key
  `deepsource:<path>:<code, else title>:<SHA-256 hex of message>`: two items of one code in one file with
  different messages differ, one item at another line on a later head keeps its key (FR-026a, AS11; R20)
- [ ] T048 [P] [US3] Write `core/tests/required-checks.test.ts`: checks from `rules/branches/{base}`
  `required_status_checks`, dropping `internal-review` and each enabled module's `<module>-review` (AS5); none
  left → COULD_NOT_RUN for status and findings (AS9); matched among check runs by name, and App id when the rule
  pins `integration_id`, and among statuses by context; a `failure` → one finding `required-check:<name>` naming
  the check and its conclusion (AS5); an `error` → COULD_NOT_RUN naming it; never SILENT (FR-027; R22)
- [ ] T049 [P] [US3] Write `core/tests/keys.test.ts` on pure checks with injected stats and file text: a key not
  owned by the current user, or with any group or other bit, is refused naming the mode; managed settings not in
  effect (file missing, not root-owned, folder or file writable by others, not JSON, any setting of
  contracts/key-files.md missing or different, `<plugin>@codeworks` not enabled) → `KeyReadRefused` naming every
  reason; reviewer's read of `session-app.pem` skips the settings check, the orchestrator's does not; a platform
  other than Linux is refused naming it (US5 AS4, FR-036, FR-038; R23)
- [ ] T050 [P] [US3] Write `core/tests/security-settings.test.ts`: parse `SECURITY.md` §5's JSON block and fail
  when an entry is in neither the required-settings table of `keys.ts` nor its named exceptions (`<V>/ghcreds`,
  the plugin and gh config folders, `<C>`, `allowedDomains`) (R23)

### Implementation for User Story 3

- [ ] T051 [US3] Create `core/src/outcomes.ts`: `outcomeOf`, `StatusAnswer`, `CouldNotRun` (R17)
- [ ] T052 [US3] Create `core/src/contracts/finding.ts`; add it to `write-schemas.ts`'s list, see
  `core/tests/schemas.test.ts` fail naming the missing file, then run the script to write
  `core/schemas/finding.schema.json` (R8)
- [ ] T053 [US3] Create `core/src/validators/threads.ts`: the paginated `reviewThreads` read, login
  normalisation, the shared vendor-thread finding builder every module uses, `findings` and `untrusted` (R21)
- [ ] T054 [US3] Create `core/src/validators/codex.ts`, a port of `pr-gate.js` `codexStatus` (R18)
- [ ] T055 [US3] Create `core/src/validators/coderabbit.ts` (R19)
- [ ] T056 [US3] Create `core/src/keys.ts`: `readKey(name, plugin)`, the pure file and settings checks, the
  required-settings table and its exceptions (R23; contracts/key-files.md)
- [ ] T057 [US3] Create `core/src/validators/deepsource.ts`, both sources, the `api` token read through `readKey`
  for the plugin it was given (R20)
- [ ] T058 [US3] Create `core/src/validators/required-checks.ts` (R22)
- [ ] T059 [US3] Create `core/src/validators/index.ts`: `enabledModules(settings, reader, plugin)`,
  `threadsModule(settings, reader)`, `requiredChecks(settings, reader)`; each module catches `GitHubUnanswered`
  at its own boundary only (contracts/core-api.md; R12)
- [ ] T060 [US3] Run quickstart.md US3 against a test repo; record what ran and its result in the PR

**Checkpoint**: US3's PR passes `npm test`; every could-not-run fixture yields COULD_NOT_RUN from every module

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
- [ ] T062 [P] [US5] Write `core/tests/security-permissions.test.ts`: each App's permission set in `tokens.ts`
  equals `SECURITY.md` §3, mapping §3's names to API keys ("projects" → `organization_projects`)
  (contracts/key-files.md)

### Implementation for User Story 5

- [ ] T063 [US5] Create `core/src/tokens.ts`: `mintToken(app, appId, keyFile, plugin, repo)` with the session,
  orchestrator and reviewer permission sets of contracts/key-files.md, the key read through `readKey`, signing
  with `node:crypto`, and `MintError(cause)` (R24)
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

- **Setup (Phase 1)** → **Foundational (Phase 2)** → US1, all in US1's PR
- **US2** after US1 merges: uses `github.ts`, `tree.ts`, `values.ts`, `identity.ts` (`storyBranch`) and
  `write-schemas.ts`
- **US3** after US2 merges: uses `settings.ts` (`Shared`, `validators`, `trusted_reviewers`)
- **US5** after US3 merges: uses `keys.ts`
- **Polish** after US5

### Within Each Story

- Recorded inputs (US3) before the tests that read them
- Each test task before the task that makes it pass, seen red for the expected reason
- Contracts and pure rules before their readers; `validators/index.ts` last in US3

### Parallel Opportunities

- T003, T004 in Setup; T006, T008, T009, T011 in Foundational
- Every test task marked [P] within a story
- T039 and T040 in US3

---

## Parallel Example: User Story 3

```bash
Task: "Write core/tests/outcomes.test.ts"
Task: "Write core/tests/finding.test.ts"
Task: "Write core/tests/could-not-run.test.ts"
Task: "Write core/tests/threads.test.ts"
Task: "Write core/tests/codex.test.ts"
Task: "Write core/tests/required-checks.test.ts"
Task: "Write core/tests/keys.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phases 1 and 2, then US1, in one PR with the exempt label
2. Validate with quickstart.md US1 and the `carriers` job

### Incremental Delivery

US1 → US2 → US3 → US5, one PR each (R26). No carrier exists, so no story bumps a plugin.

---

## Notes

- No task edits a component: their switch to core is follow-up work (spec Assumptions)
- No task adds a command, `bin` or module that acts on import (T008 grades it)
- T040 and T064 need credentials only the user holds (a DeepSource token, the test Apps' keys)
