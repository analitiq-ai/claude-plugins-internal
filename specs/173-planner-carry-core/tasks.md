---

description: "Task list for Planner carries core"
---

# Tasks: Planner carries core

**Input**: Design documents from `specs/173-planner-carry-core/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md), [data-model.md](data-model.md),
[contracts/](contracts/), [quickstart.md](quickstart.md)

**Tests**: Required. Constitution IV (test-first) and research mark behaviours "not run"; every story starts from a
test run red, failing for the reason named in the task, before the code that makes it pass.

**Organization**: One phase per story, one PR per story (research R1), merged in the order US1 → US2 →
(US3, US5 in either order) → US4. Every story's PR bumps `planner/plugin/.claude-plugin/plugin.json`'s `version`
to the next minor version above the one on `main` when the PR opens.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependency on an incomplete task)
- **[Story]**: The user story the task belongs to (US1–US5)
- Paths are from the repository root. `node --test` and `tsc` run as core runs them; Python tests run from their
  suite folder with `python -m unittest -v`.

---

## Phase 1: Setup

**Purpose**: Record the baseline every story's checks are compared against.

- [x] T001 Run `node core/scripts/check-carriers.ts --base origin/main`, `(cd core && npm ci && npm test)` and `(cd planner/tests && python -m unittest -v)` on the branch's base; record in the PR description that the check prints `0 carriers` and both suites pass, so a later failure is known to be the story's

---

## Phase 2: Foundational

**Purpose**: None separate. US1 is the blocking story: every later story runs core code inside planner and needs
US1's carrier, guard and test harness. No user story work starts before US1 is merged.

---

## Phase 3: User Story 1 - Planner ships core, pinned and checked (Priority: P1) 🎯 MVP

**Goal**: Planner is a carrier (`core` link, exact pins, v3 lockfile, pinned version), its hook refuses on a
missing package, and CI runs every carrier's TypeScript tests (FR-001–FR-004; R2, R3, R4).

**Independent Test**: `node core/scripts/check-carriers.ts --base origin/main` prints
`1 carriers checked against origin/main, 0 failures`; the quickstart's installed-shaped copy with
`node_modules/zod` removed makes `token.ts` exit 2 with `core dependency zod is not installed in <root>`.

### Test harness for User Story 1

- [x] T002 [US1] Create `planner/package.json` (private, `"type": "module"`, devDependencies exactly `typescript` `7.0.2` and `@types/node` `22.20.5` as in `core/package.json`, script `"test": "tsc -p . && node --test 'tests/**/*.test.ts'"`) and `planner/tsconfig.json` mirroring `core/tsconfig.json` with `include` covering `plugin` and `tests`; generate `planner/package-lock.json` with `npm install --package-lock-only` in `planner/`; this package is never installed into the plugin (R4)

### Tests for User Story 1 ⚠️

> Write these first, run them, and confirm each fails for the reason stated before T006.

- [x] T003 [P] [US1] Write `planner/tests/guarded.test.ts`: copy `planner/plugin` into a temp folder with links dereferenced (`cp -rL`, as an install copies it), `npm ci` there, delete `node_modules/zod`, run `node <tmp>/planner/hooks/token.ts` with `{}` on stdin, assert exit 2, stderr exactly `core dependency zod is not installed in <tmp>/planner`, and stdout empty; with every package present assert exit 0 and empty stdout. Expected red reason: `planner/plugin/hooks/token.ts` does not exist
- [x] T004 [P] [US1] Write `planner/tests/hooks.test.ts` asserting `planner/plugin/hooks/hooks.json` equals the JSON in `specs/173-planner-carry-core/contracts/hook.md` (one command `node ${CLAUDE_PLUGIN_ROOT}/hooks/token.ts`, `"onFailure": "block"`, on `SessionStart` and on `PreToolUse` with matcher `Bash`). Expected red reason: the file does not exist
- [x] T005 [P] [US1] Write `planner/tests/carrier.test.ts` asserting `planner/plugin/core` is a symlink whose target is exactly `../../core/src`, `planner/plugin/package.json`'s `dependencies` deep-equal `core/package.json`'s `dependencies`, `planner/plugin/package-lock.json` has `lockfileVersion: 3` and each `packages["node_modules/<pin>"].version` equal to core's pin, and `planner/plugin/package.json` has no `devDependencies`. Expected red reason: the link and package files do not exist

### Implementation for User Story 1

- [x] T006 [US1] Create the symlink `planner/plugin/core` → `../../core/src` (relative target, not a copy; `git add` records it as a link) (R2)
- [x] T007 [US1] Create `planner/plugin/package.json` as `{"name": "planner", "private": true, "type": "module", "dependencies": {"smol-toml": "1.9.1", "yaml": "2.9.1", "zod": "4.6.7"}}` (exact pins, copied from `core/package.json`; no devDependencies) and generate `planner/plugin/package-lock.json` with `npm install --package-lock-only` in `planner/plugin`, confirming `lockfileVersion: 3` (R2; model: `core/tests/fixtures/carrier-plugin`)
- [x] T008 [US1] Create `planner/plugin/lib/guarded.ts`: statically import only `../core/guard.ts`, call `requireDependencies()`, and on `MissingDependency` write `core dependency <name> is not installed in <root>` to stderr and `process.exit(2)`; any other error is re-thrown (R3; pattern: `core/tests/fixtures/carrier-plugin/hooks/identity.ts`, lifted into one module)
- [x] T009 [US1] Create `planner/plugin/hooks/token.ts`: its only static import is `../lib/guarded.ts`; after the guard it exits 0 with empty stdout (contract `hook.md` step 1 and the exit of step 6; US2 adds steps 2–5 and the env write) (R3)
- [x] T010 [US1] Create `planner/plugin/hooks/hooks.json` exactly as `specs/173-planner-carry-core/contracts/hook.md` gives it (R5)
- [x] T011 [US1] Bump `planner/plugin/.claude-plugin/plugin.json` `version` from `0.2.0` to `0.3.0` (R2)
- [x] T012 [US1] In `.github/workflows/tests.yml` job `unittest`, replace the two `if:` steps (`Run suite`, `Run core suite`) with one rule keyed on what the component holds, for suite `<c>/tests`: `npm ci` in `core`; `npm ci` in `<c>/plugin` when it holds `package-lock.json`; `npm ci` then `npm test` in `<c>` when it holds `package.json`; `python -m unittest -v` in `<c>/tests` when it holds a `test_*.py`. The `core/tests` special case is removed; core falls out of the same rule. Leave the `carriers` job unchanged (R4; constitution VI)
- [x] T013 [US1] Run `npm ci` in `core`, `planner/plugin` and `planner`; then `(cd planner && npm test)` (T003–T005 now pass, `tsc` clean), `(cd core && npm test)`, `(cd planner/tests && python -m unittest -v)`, and `node core/scripts/check-carriers.ts --base origin/main`, which must print `1 carriers checked against origin/main, 0 failures` (US1 #1, SC-001)
- [x] T014 [US1] On the open PR, push one commit that makes a `planner/tests/*.test.ts` assertion fail, confirm the `unittest (planner/tests)` job fails, then revert it in the next commit (US1 #5, SC-002); carrier-check failures for US1 #2 and #3 are already graded by `core/tests/carriers.test.ts` and need no new test

**Checkpoint**: Planner is a graded carrier; CI runs its TypeScript tests. Merge before any later story.

---

## Phase 4: User Story 2 - Planner acts on GitHub only as its own App (Priority: P1)

**Goal**: The hook mints the planner App's token into planner's own gh config folder and points the session's gh
at it; scripts read it and never mint; the push reads it from gh (FR-005–FR-007; R5–R10).

**Independent Test**: `planner/tests/token.test.ts` against `fakeGitHub`: a session start with key and settings
mints one token for the one repository with exactly the planner App's permissions and writes the folder; removing
the key blocks naming it.

### Probes of behaviour research marks "not run" ⚠️

> Run each before any US2 code; record the observed result in the PR description. A result other than the one
> research expects stops the story: report it, do not work around it.

- [x] T015 [US2] In a scratch Claude Code session with a throwaway plugin whose `SessionStart` hook exits 2 with `"onFailure": "block"`, record whether the session goes on; then with a `SessionStart` hook that appends `unset GH_TOKEN` and `export GH_CONFIG_DIR=/tmp/x` to `$CLAUDE_ENV_FILE`, start the session with `GH_TOKEN` exported and record `echo "${GH_TOKEN-unset} $GH_CONFIG_DIR"` from a Bash call (R5, R9). Run 2026-10-28; results and the session record they led to are in R5 and R9

### Tests for User Story 2 ⚠️

> Write these first, run them, and confirm each fails for the reason stated before T021.

- [x] T016 [P] [US2] In `core/tests/github.test.ts` add cases for `repositoryOfRemote`: `https://github.com/o/n`, `https://github.com/o/n.git`, `git@github.com:o/n.git`, `ssh://git@github.com/o/n.git` → `{owner: "o", name: "n"}`; another host, a path with more or fewer segments, and an empty string → refused with a typed error; `httpsUrl({owner: "o", name: "n"})` → `https://github.com/o/n.git`. Expected red reason: the functions are not exported
- [x] T017 [P] [US2] Create `core/tests/gh-config.test.ts`: `writeGhToken` then `readGhToken` round-trips `{value, repo, expires_at}`; folder mode `0700`, `hosts.yml` and `codeworks-token.json` mode `0600`; `hosts.yml` is `github.com: {oauth_token, user: <login>, git_protocol: https}`; a folder with one of the two files is refused, not repaired; an absent folder reads `null`; `needsMint` is true for `null`, for another `repo`, and for `expires_at − now < 10 min`, false at exactly 10 min left and above; with the real `gh` on PATH, `GH_CONFIG_DIR=<folder> gh auth token` prints the written token (R6 "not run"). Expected red reason: `core/src/gh-config.ts` does not exist
- [x] T018 [P] [US2] In `core/tests/git.test.ts` add: `runGit`'s `env` argument reaches the child (a `-c credential.helper=!f(){ echo password=$X; }; f` helper run through `credential fill` sees `X` set, and sees it unset when `env` maps it to `undefined`); and, with the real `gh` and a folder written by `writeGhToken`, `git credential fill` through `-c credential.helper= -c 'credential.helper=!gh auth git-credential'` with `GH_CONFIG_DIR=<folder>` answers `username=<login>` and `password=<token>` (R10 "not run"). Expected red reason: `runGit` takes no `env` argument
- [x] T019 [P] [US2] Create `planner/tests/settings.test.ts`: `PlannerSettings` accepts `{app_id: 5510825}`, refuses a missing `app_id`, a non-integer, `0`, a negative and an unknown key; `ghFolder({owner: "o", name: "n"})` is `~/.local/state/codeworks/planner/o/n/gh` under the `HOME` the test sets. Expected red reason: `planner/plugin/lib/settings.ts` does not exist
- [x] T020 [US2] Create `planner/tests/token.test.ts` running `planner/plugin/hooks/token.ts` as a child process in a temp git checkout (origin set, `codeworks.toml` committed at `HEAD`), with `HOME` pointed at a temp folder holding `.config/codeworks/planner-app.pem`, against `fakeGitHub` from `core/tests/support/fake-github.ts` (follow `core/tests/tokens.test.ts` for how the mint is faked): `SessionStart` mints once for the one repository with contents, pull requests and issues write and organization projects read only, writes the folder, and appends exactly `export GH_CONFIG_DIR='<folder>'` and `unset GH_TOKEN GITHUB_TOKEN GH_ENTERPRISE_TOKEN GITHUB_ENTERPRISE_TOKEN` to `CLAUDE_ENV_FILE`; a `PreToolUse` with 11 min left mints nothing, with 9 min left mints once; a stored token for another repo mints; a missing key exits 1 with stderr naming the key's path (core lets the read's error through), no mint call and no record; a refused mint, a missing `codeworks.toml`, a `[planner]` with an unknown key, an origin that is not GitHub, and an unset `CLAUDE_ENV_FILE` on `SessionStart` each exit 2 with stderr naming the file, key or remote and no mint call recorded; the token value appears in no stdout or stderr; a `PreToolUse` for a session with no record exits 2 naming the failed start, with no mint call; a `SessionStart` whose mint is refused leaves no record, and the next `PreToolUse` for that session exits 2; a `SessionStart` that succeeds writes the record, and a second `SessionStart` for the same session whose mint is refused removes it; a `session_id` that is not a UUID exits 2 (US2 #1–#4, #7, #8). Expected red reason: `token.ts` exits 0 after the guard

### Implementation for User Story 2

- [x] T021 [P] [US2] Add `repositoryOfRemote(url)` and `httpsUrl(repo)` to `core/src/github.ts`, validating the parsed pair with the existing `ownerAndName` (R8; `contracts/core-api.md` US2)
- [x] T022 [P] [US2] Create `core/src/gh-config.ts` with `REFRESH_MARGIN_MS = 10 * 60 * 1000`, `StoredToken`, `writeGhToken` (each file through a temp file and a rename, folder `0700`, files `0600`), `readGhToken` (null when absent, throws on a half-written folder) and the pure `needsMint` (R6)
- [x] T023 [US2] In `core/src/git.ts` give `runGit` an optional fourth argument `env`, merged after its own, where `undefined` removes a variable; add `pushWithGhCredential(checkout, ghConfigDir, repo, refspec)` running `runGit(checkout, ["-c", "credential.helper=!gh auth git-credential", "push", "--porcelain", "--end-of-options", httpsUrl(repo), refspec], [], env)` with `GH_CONFIG_DIR=ghConfigDir`, `GIT_TERMINAL_PROMPT=0`, and `GH_TOKEN`, `GITHUB_TOKEN`, `GH_ENTERPRISE_TOKEN`, `GITHUB_ENTERPRISE_TOKEN` removed; keep `runGit`'s own `credential.helper=` first (R10). Callers of `runGit` today: grep `core/src` and `core/scripts` for `runGit(` and list them in the PR description before the edit; none passes a fourth argument
- [x] T024 [US2] Create `planner/plugin/lib/settings.ts`: `PlannerSettings = z.strictObject({ app_id: z.number().int().positive() })`, a `readPlannerSettings(checkout)` reading `readSettings(gitTree(checkout, "HEAD"))` and validating `section("planner")` and `[shared]`, refusing with `codeworks.toml [planner]: <why>` (or core's message for `[shared]`), and `ghFolder(repo)` returning `~/.local/state/codeworks/planner/<owner>/<name>/gh`, the one function the hook and every script call (R6, R7)
- [x] T025 [US2] Extend `planner/plugin/hooks/token.ts` with `contracts/hook.md` steps 2–6, everything after the guard loaded with `await import(...)`: validate stdin's `hook_event_name`, `cwd` and `session_id`; on `SessionStart` delete the session's record, on `PreToolUse` exit 2 when it is absent (step 2); read settings (T024); read origin with `runGit(cwd, ["remote", "get-url", "origin"])` and `repositoryOfRemote`; when `needsMint(readGhToken(folder), repo, now)`, `mintToken("planner", app_id, "planner-app.pem", "planner", repo)` then `writeGhToken(folder, token, planner_app_login)`; on `SessionStart` append the two env lines to `$CLAUDE_ENV_FILE`, then write the session's record. `KeyReadRefused`, `MintError`, `GitHubRefused`, `GitHubUnanswered`, `SettingsError` and a refused remote exit 2 with core's message on stderr; any other error is re-thrown. Never print the token (R5–R9)
- [x] T026 [US2] Confirm `https://github.com/orgs/analitiq-ai/projects/5` is this repository's board (`gh project view 5 --owner analitiq-ai`), then add `codeworks.toml` at the repository root exactly as `specs/173-planner-carry-core/contracts/codeworks-toml.md` gives it; run `node -e` through core's `readSettings` on it to confirm `[shared]` parses (FR-007)
- [x] T027 [US2] Bump `planner/plugin/.claude-plugin/plugin.json` `version` to the next minor version (this PR changes `core/src`)
- [x] T028 [US2] Run `(cd core && npm test)` and `(cd planner && npm test)` (T016–T020 pass), `node core/scripts/check-carriers.ts --base origin/main` (0 failures)
- [ ] T029 [US2] Live, per quickstart "US2": in a Claude Code session in the scratch repository with `GH_TOKEN` exported beforehand and the admin signed in to gh, `echo $GH_CONFIG_DIR; gh api /installation/repositories --jq '.repositories[].full_name'` prints planner's folder and the scratch repository alone (US2 #7); record the output in the PR description

**Checkpoint**: Every gh and git call in a planner session acts as the planner App, or the hook blocks.

---

## Phase 5: User Story 3 - The spec states its facts as data (Priority: P2)

**Goal**: Every spec.md planner writes carries the `codeworks` front matter, written through core's writer, and
the premise vocabulary is spelled once in core (FR-008, FR-016; R11, R12).

**Independent Test**: `(cd planner && node --test tests/spec-facts.test.ts)` — a defect spec whose `Observed:`
line names a test reads back through `readSpecFacts` as `kind: defect`, `observed: anchored`.

### Tests for User Story 3 ⚠️

> Write these first, run them, and confirm each fails for the reason stated before T035.

- [ ] T030 [P] [US3] In `core/tests/spec-facts.test.ts` add `writeSpecFacts` cases: on text with no front matter it prepends one block; on text with front matter holding other keys it sets `codeworks` and keeps them; on text already holding `codeworks` it replaces it, leaving exactly one; `readSpecFacts(writeSpecFacts(t, f))` deep-equals `f` for every `kind` × `observed` pair `SpecFacts` admits; facts `SpecFacts` refuses throw before any text is produced. Expected red reason: `writeSpecFacts` is not exported
- [ ] T031 [P] [US3] In `core/tests/schemas.test.ts` extend the drift test to cover `core/src/generated/premise.json` (regenerated in memory by `scripts/write-schemas.ts`'s function, compared byte for byte), and add a `core/tests/premise.test.ts` asserting `premise.ts`'s values equal data-model.md "Premise vocabulary": picks `write the spec`, `no spec needed`, `not worth doing`; `Reports wrong behaviour` with `yes`/`no`; `## Root cause`; `Observed:`; `Not a defect report.`; `Observed: nothing; this trace is a hypothesis from reading the code.` Expected red reason: neither file exists
- [ ] T032 [P] [US3] In `planner/tests/test_premise_report.py` and `planner/tests/test_rootcause.py` add a case asserting each script's vocabulary is the one loaded from `planner/plugin/core/generated/premise.json` (patch the loaded JSON's hypothesis sentence and observe the script follow it). Expected red reason: the scripts hold their own literals
- [ ] T033 [P] [US3] Create `planner/tests/spec-facts.test.ts`: the pure `specFactsOf` over the four rows of data-model.md "Spec facts"; a missing or unknown `Reports wrong behaviour` value, or a missing `Observed:` opening on a defect, is refused; the script `spec_facts.ts write <folder> [<report>]` run on a temp folder per row writes spec.md whose `readSpecFacts` answer matches the row (US3 #1–#3, #5); a second run after the root cause section changes from hypothesis to anchored rewrites the block, leaving one (US3 #4); a spec.md from `planner/plugin/speckit/presets/settled-design/templates/spec-template.md` never written by the script is refused by `readSpecFacts`; exit 1 with a stderr line naming the next step on a refused input. Expected red reason: `planner/plugin/scripts/spec_facts.ts` does not exist
- [ ] T034 [P] [US3] In `planner/tests/test_drive_workflow.py` add a case that a `no spec needed` run leaves spec.md with front matter `kind: no_spec`, `root_cause: {observed: none}`, and that a `rescope` of that folder still starts at `premise` (`spec_folder.starts_at`); in `planner/tests/test_no_spec.py` assert `is_no_spec` is true for a no-spec spec.md behind a leading front matter block and false for a spec behind one. Expected red reason: the workflow has no spec-facts step, and `is_no_spec` reads only the file's first line

### Implementation for User Story 3

- [ ] T035 [P] [US3] Add `writeSpecFacts(text, facts)` to `core/src/contracts/spec-facts.ts`: parse `facts` with `SpecFacts`, set the `codeworks` key in an existing leading front matter through `yaml`'s `parseDocument` (other keys kept), else prepend `---\ncodeworks: …\n---\n` (R11)
- [ ] T036 [P] [US3] Create `core/src/contracts/premise.ts` holding `PremisePick` (a `valueSet`), `REPORTS_WRONG_BEHAVIOUR` and `ROOT_CAUSE` with the values of data-model.md "Premise vocabulary"; extend `core/scripts/write-schemas.ts` to also write `core/src/generated/premise.json`; run it and commit the generated file (R12)
- [ ] T037 [US3] Change `planner/plugin/scripts/premise_report.py` and `planner/plugin/scripts/rootcause.py` to load their labels, picks, `Observed:`, `Not a defect report.` and the hypothesis sentence from `planner/plugin/core/generated/premise.json` (path resolved from the script's own folder) and delete their literals; a missing or unreadable JSON exits 2 naming the path (R12; FR-017: they stay Python)
- [ ] T038 [US3] Open `planner/plugin/speckit/presets/settled-design/templates/spec-template.md` with a `codeworks` front-matter block whose values `SpecFacts` refuses (placeholders), so a spec the writer never filled fails core's reader (R11; planner ADR-0008 d1)
- [ ] T039 [US3] Create `planner/plugin/scripts/spec_facts.ts` per `contracts/scripts.md`: guarded (static import of `../lib/guarded.ts` only, rest via `await import`), a pure exported `specFactsOf(wrong, opening)` importing the vocabulary from `../core/contracts/premise.ts`, and `write <spec folder> [<premise report>]` that reads spec.md and the report, then writes through `writeSpecFacts`; with no report spec.md must be a no-spec one (its first line after any leading front matter is `# No spec needed`, the rule `is_no_spec` applies); exit 1 / 2 per the contract (R11)
- [ ] T040 [US3] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` add step `spec-facts-no-spec` after `write-no-spec` (`node "$PLANNER_ROOT/scripts/spec_facts.ts" write "$SPECIFY_FEATURE_DIRECTORY"`) and step `spec-facts` after `premise-answers-after-grill` (same, plus the run's `premise-report.md`); no step on the rescope branch (`root-cause-of-rescope`); and in `planner/plugin/scripts/no_spec.py` make `is_no_spec` read the first line after a leading front matter block, updating the module docstring's "by its first line" (R11)
- [ ] T041 [US3] Bump `planner/plugin/.claude-plugin/plugin.json` `version` to the next minor version
- [ ] T042 [US3] Run `(cd core && npm test)`, `(cd planner && npm test)`, `(cd planner/tests && python -m unittest -v)` and `node core/scripts/check-carriers.ts --base origin/main`; all pass

**Checkpoint**: Core's reader accepts every spec.md planner writes (SC-003).

---

## Phase 6: User Story 4 - Planner lands the spec through its spec PR and story issues (Priority: P2)

**Goal**: Preflight gates the run on lane and open issue; a completed run's landing creates the story
sub-issues and `blockedBy` chain, labels tasks.md, commits as the planner App, pushes to `<p>-spec` and opens the
draft spec PR, every stop before the first write (FR-009–FR-012, FR-014, FR-016; R13–R17). Depends on US2.

**Independent Test**: `planner/tests/land.test.ts` — a three-story run on `#p` against `fakeGitHub` creates three
sub-issues, US2 and US3 `blockedBy` the one before, tasks.md labelled, one draft PR from `<p>-spec` holding only
the spec folder and records; a re-run creates nothing.

### Tests for User Story 4 ⚠️

> Write these first, run them, and confirm each fails for the reason stated before T048.

- [x] T043 [P] [US4] In `core/tests/values.test.ts` add `Lane` holding exactly `Backlog`, `Ready`, `In progress`, `In review`, `Blocked`, `Done`; create `core/tests/board.test.ts` for `laneOf` against `fakeGitHub`: a card in each lane returns it, no card on `board` returns `null`, a status outside the set is refused, an unanswered GraphQL call raises `GitHubUnanswered`. Expected red reason: `Lane` and `core/src/board.ts` do not exist
- [x] T044 [P] [US4] In `core/tests/identity.test.ts` add: `parseBranch(specBranch(p))` deep-equals `{spec: p}`; `pickSpecPr` picks the newest same-repository PR headed `<p>-spec` and maps it to `open | closed | merged`, ignores forks and other heads, returns `null` for none; `specPr` reads through `fakeGitHub`; `specFolderAnswer` returns `{one}`, `{none: true}` and `{several}`; `pickSpecFolder`'s existing cases still pass. Expected red reason: the functions are not exported
- [x] T045 [P] [US4] Create `core/tests/tasks.test.ts`: `taskBlockLabel(12)` is `Story issue: #12`; `readTaskBlockLabels` maps each phase heading line to the number on the line directly under it, ignores a label not directly under a heading, and refuses a malformed label line. Expected red reason: `core/src/contracts/tasks.ts` does not exist
- [x] T046 [P] [US4] Create `planner/tests/preflight.test.ts` running `planner/plugin/scripts/preflight.ts <issue>` against `fakeGitHub` with a token folder written by `writeGhToken`: Backlog and Blocked exit 0; Ready exits 1 with `move #<issue> from Ready to Backlog or Blocked`; no card exits 1 with `add #<issue> to <board>`; a closed issue exits 1 naming it; GitHub unanswered exits 2; a stale token (`needsMint` true) exits 2 naming planner's hook; no write call recorded in any case (US4 #6, FR-012). Expected red reason: the script does not exist
- [x] T047 [US4] Create `planner/tests/land.test.ts` with a temp checkout whose `origin/<default>` and `origin/<p>-spec` come from a local bare repository, `fakeGitHub` recording every call, and the push injected so the test records repo and refspec (the real `pushWithGhCredential` is checked live in T057): the pure `labelTasks` over a tasks.md with Setup, Foundational, three story phases and Polish (US4 #3), replacing an existing label line; a three-story run creates three sub-issues titled `US<k>: <phase title>` in order, each new one linked with `sub_issues` and US2/US3 with `blocked_by` the previous, labels tasks.md, commits authored `codeworks-planner[bot]` with the id-based noreply email, pushes `refs/heads/<p>-spec` holding only the spec folder and `docs/adr/` paths, opens one draft PR to the default branch, and prints `Spec folder:`, `Branch:`, `Spec PR:` last (US4 #1); a one-story run creates no issue and labels `#p` (US4 #2); an open spec PR is pushed to with no new PR (US4 #4); a re-run creates nothing and keeps numbers (US4 #7); and with zero write calls recorded and exit 1 naming the next step: `kind` `rescope` (names #178, US4 #8), closed PR (names `<p>-spec` to delete, US4 #5), merged PR, several `specs/<p>-*` folders, the folder already on the default branch, a changed path outside the spec folder and `docs/adr/`, `origin/<p>-spec` not an ancestor of `HEAD`, more sub-issues than stories, a sub-issue at position `i` other than tasks.md's `US<i+1>` label (all rows of `contracts/scripts.md`). Expected red reason: the script does not exist

### Implementation for User Story 4

- [x] T048 [P] [US4] Add `Lane` (a `valueSet`: `Backlog`, `Ready`, `In progress`, `In review`, `Blocked`, `Done`) to `core/src/values.ts` and create `core/src/board.ts` with `laneOf(reader, repo, issue, board)` reading the issue's card status on `board` through `GitHubClient.graphql` (R13)
- [x] T049 [P] [US4] In `core/src/identity.ts` add `specBranch`, `SpecPr`, the pure `pickSpecPr`, `specPr`, `SpecFolderAnswer` and `specFolderAnswer`, and rebuild `pickSpecFolder` on `specFolderAnswer` keeping its throwing behaviour (callers: `core/src/identity.ts:110`; grep `core/` and every `*/plugin` for `pickSpecFolder` and list them in the PR description before the edit) (R14)
- [x] T050 [P] [US4] Create `core/src/contracts/tasks.ts` with `taskBlockLabel(issue)` and `readTaskBlockLabels(text)` for the line `Story issue: #<n>` directly under a phase heading (R16)
- [x] T051 [US4] Create `planner/plugin/scripts/preflight.ts <issue>` per `contracts/scripts.md`: guarded; repository from origin (`repositoryOfRemote`), settings via `readPlannerSettings`, token via `readGhToken(ghFolder(repo))` (exit 2 naming planner's hook when `needsMint`), then the issue's state and `laneOf`; stops as the contract lists (R13)
- [x] T052 [US4] Add `preflight` as the first step of `planner/plugin/speckit/workflows/issue-spec/workflow.yml`, before `check-folder`: `node "$PLANNER_ROOT/scripts/preflight.ts" "$ISSUE"`; it is the workflow's one step that calls GitHub (R5, R13)
- [x] T053 [US4] Create `planner/plugin/scripts/land.ts <issue> <spec dir> <kind>` per R17 and `contracts/scripts.md`: guarded; fetch the default branch and `<p>-spec`; every read and stop of the contract's table, in its order, before any write; pure exported helpers for the stop checks, the story plan (R15: stories from `[US<k>]` tags, sub-issue `i` is `US<i+1>`) and `labelTasks` (R16, using core's `taskBlockLabel`); then the writes: missing story issues (`POST /repos/{o}/{r}/issues`, `POST …/issues/<p>/sub_issues` with the new `id`, `POST …/issues/<new>/dependencies/blocked_by` with the previous story issue's `id`), tasks.md labels, a commit with `user.name` = `planner_app_login` and email `<id>+<login>@users.noreply.github.com` from `GET /users/<login>`, `pushWithGhCredential` to `refs/heads/<p>-spec`, and a draft PR to the default branch when none is open; no label applied (FR-014); prints the three lines last. The push is a parameter of the write phase so T047 injects it; `main` passes `pushWithGhCredential`
- [x] T054 [US4] Replace step 8 of `planner/plugin/skills/issue-spec/SKILL.md`: when the report says `completed`, run `node "$PLANNER_ROOT/scripts/land.ts" <ISSUE> <SPEC_DIR> <kind>` from `CHECKOUT` and end with its last three lines and nothing after them; a non-zero exit is shown to the user and stops, with the next step it names; remove the skill's own `git commit`/`git push`; add `preflight` stops to the `## Stops` section (R17; P1)
- [x] T055 [US4] Bump `planner/plugin/.claude-plugin/plugin.json` `version` to the next minor version
- [x] T056 [US4] Run `(cd core && npm test)`, `(cd planner && npm test)`, `(cd planner/tests && python -m unittest -v)` and `node core/scripts/check-carriers.ts --base origin/main`; all pass
- [ ] T057 [US4] Live, per quickstart "US4", on the scratch repository: `/planner:issue-spec #<issue>` on a Backlog issue through to `completed`; confirm the sub-issue and `blocked_by` endpoints answered as R15 expects (research "not run"), the PR is a draft, and the PR, issues and commit are authored by `codeworks-planner[bot]` (SC-004, SC-005); then one `untracked` run, recording whether preflight passed or stopped naming the card to add and passed on a re-run (critique P1); record both in the PR description

**Checkpoint**: The admin creates no story issue, `blockedBy` link or spec PR by hand.

---

## Phase 7: User Story 5 - Planner closes no issue (Priority: P3)

**Goal**: A `not worth doing` pick names the close for the admin and posts nothing (FR-015; R18).

**Independent Test**: `planner/tests/test_drive_workflow.py` with a fake `gh` on `PATH` recording its calls: a
`not worth doing` run completes with no `gh` call and stdout `Close #<issue> as not planned: <reason>`.

### Tests for User Story 5 ⚠️

- [x] T058 [US5] In `planner/tests/test_drive_workflow.py` add a case driving a run to a `not worth doing` pick with a fake `gh` first on `PATH` that appends its argv to a file: the run completes, the file is empty, and the output holds `Close #<issue> as not planned: <reason>` with the premise report's reason; a `no spec needed` run likewise records no `gh` call (US5 #1, #2). Expected red reason: `close-not-worth-doing` calls `gh issue view` and `gh issue close`

### Implementation for User Story 5

- [x] T059 [US5] In `planner/plugin/speckit/workflows/issue-spec/workflow.yml` replace step `close-not-worth-doing` (and its comment) with `name-close`: `set -eu`, read the reason with `premise_report.py reason`, print `Close #$ISSUE as not planned: <reason>`; no `gh`, no `git remote` call (R18)
- [x] T060 [US5] In `planner/plugin/skills/issue-spec/SKILL.md` step 3, replace "the workflow has closed the issue as not planned with the reason" with: the run names the close; tell the user to close the issue as not planned with that reason, and stop; in `planner/plugin/.claude-plugin/plugin.json` change the description's "a not-worth-doing issue is closed as not planned" to say the admin closes it, and bump `version` to the next minor version (R18)
- [x] T061 [US5] Run `(cd planner/tests && python -m unittest -v)` and `(cd planner && npm test)`; all pass

**Checkpoint**: Planner makes no close or comment on any pick (SC-006).

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Checks over the whole feature, after the last story's PR.

- [ ] T062 Before opening each story's PR run the tripwire `git log --name-only origin/main..HEAD | sort | uniq -c | sort -rn`; a file touched more than ~3 times is rewritten once before the push (`.claude/rules/pr-review-loop.md`)
- [x] T063 [P] Grep `planner/plugin` for `gh issue close`, `gh issue comment`, `git push` and `GH_TOKEN`; each remaining hit is either in `land.ts`'s injected push path or removed (SC-005, SC-006)
- [ ] T064 Run every command in `specs/173-planner-carry-core/quickstart.md` on `main` after the last story merges; `node core/scripts/check-carriers.ts --base origin/main` prints `1 carriers checked`, `0 failures` (SC-001)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: none.
- **Foundational (Phase 2)**: empty; US1 plays its role.
- **US1 (Phase 3)**: after Setup. Blocks US2, US3, US4.
- **US2 (Phase 4)**: after US1 merges. Blocks US4.
- **US3 (Phase 5)**: after US1 merges. Independent of US2, US4, US5.
- **US4 (Phase 6)**: after US2 merges (its writes need the token; R1). US3 not required, but merge order puts US3
  first so both PRs do not bump the same version.
- **US5 (Phase 7)**: needs nothing from other stories; its PR may open at any time, merged before or after US3.
- **Polish (Phase 8)**: T062 per PR; T063–T064 after the last merge.

Every story's PR changes `plugin.json`'s version, so two stories' PRs open at once conflict there; rebase and
re-bump on the later one.

### Within Each Story

- Probes (US2 T015) before tests; tests written and run red before implementation.
- Core additions before the planner code that imports them.
- Story verification (full suites, carrier check, live check) last, before the PR is marked ready.

### Parallel Opportunities

- US1: T003, T004, T005 in parallel.
- US2: T016–T019 in parallel; T021 and T022 in parallel.
- US3: T030–T034 in parallel; T035 and T036 in parallel.
- US4: T043–T046 in parallel; T048, T049, T050 in parallel.
- Across stories: US3 and US5 in parallel once US1 merges; US2 alongside them.

---

## Parallel Example: User Story 4

```bash
# Red tests together:
Task: "Lane and laneOf tests in core/tests/values.test.ts and core/tests/board.test.ts"
Task: "specBranch, pickSpecPr, specPr, specFolderAnswer tests in core/tests/identity.test.ts"
Task: "Task-block label tests in core/tests/tasks.test.ts"
Task: "Preflight tests in planner/tests/preflight.test.ts"

# Core additions together:
Task: "Lane in core/src/values.ts and laneOf in core/src/board.ts"
Task: "specBranch, specPr, specFolderAnswer in core/src/identity.ts"
Task: "taskBlockLabel, readTaskBlockLabels in core/src/contracts/tasks.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Phase 1: record the baseline.
2. Phase 3: US1 → carrier check lists planner with 0 failures, CI runs planner's tests.
3. **Stop and validate**: quickstart "US1". Merge.

### Incremental Delivery

1. US1 → merge (carrier, CI).
2. US2 → merge (planner acts only as its App).
3. US3 and US5 → merge, either order (spec facts; no close).
4. US4 → merge (landing). Then Phase 8.

Each PR runs the internal review loop and the Codex loop of `.claude/rules/pr-review-loop.md` before merge.

---

## Notes

- [P] tasks touch different files and depend on no incomplete task.
- A red test must fail for the reason its task names; a test that fails for another reason, or passes, is fixed
  before the code is written.
- Name a function's callers in the PR description before editing it (T023, T049).
- Every stop exits before the first GitHub write; a test asserts zero write calls for each.
