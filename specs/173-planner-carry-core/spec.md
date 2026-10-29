# Feature Specification: Planner carries core

**Feature Branch**: `173-spec`

**Created**: 2026-10-28

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/173 — planner: carry core.
Planner becomes the first plugin to carry core: it links `core/src`, pins core's packages, gains a hook that mints
the planner App token, writes spec-facts front matter, creates the story sub-issues and the spec PR on `<p>-spec`,
closes no issue on a not-worth-doing pick, reads its settings from `codeworks.toml`, and CI runs its TypeScript
tests. Done when the carrier check lists planner and CI runs planner's tests."

## Clarifications

### Session 2026-10-28

- Q: Is the decision-log check (planner ADR-0009 d1–d2) in this spec? → A: No; it moves to its own issue, #177.
- Q: Who pushes the spec branch, and how does git carry planner's token? → A: Planner's landing script makes
  every GitHub write of the landing: the push, the spec PR and the story issues. gh on planner's machine holds
  the planner App's token, minted and refreshed by planner's hook, and the push reads it from gh
  (`gh auth git-credential`).
- Q: Who uses the admin's gh account on planner's machine, and for what? → A: Only the admin, for their own
  actions; planner never does. Planner's hook keeps its token in planner's own gh config folder, and the planner
  session's gh and git read only that folder.
- Q: Is rescope landing (root ADR-0006 d2; planner ADR-0010 d2, d5, d6) in this spec? → A: No; it moves to its
  own issue, #178. Until it lands, a rescope run stops before it pushes, naming #178.
- Q: Where do the core capabilities planner needs land? → A: Each inside the planner story that first uses it, in
  that story's one PR (org ADR-0003); one #174 lands first is reused.

### Session 2026-10-29

- Q: Does planner's token replace the admin's gh credentials for the whole session? → A: No. Planner's scripts
  mint the planner App's token when they need it and act with it; every other command in the session keeps the
  admin's gh login. Planner has no session hook. This replaces the 2026-10-28 answers that planner's hook mints
  the token and that the planner session's gh and git read only planner's folder.

## User Scenarios & Testing *(mandatory)*

The actor is the admin who runs `/planner:issue-spec` on their own machine (root ADR-0008 d2). The other
readers are builder, reviewer and the orchestrator, which read what planner leaves behind: the spec's front
matter, the story issues and the spec PR.

### User Story 1 - Planner ships core, pinned and checked (Priority: P1)

Planner carries core the way root ADR-0001 d2 and ADR-0009 d3–d4 say a carrier does, modelled on
`core/tests/fixtures/carrier-plugin`: a `core` link to `../../core/src`, a module package that pins core's
runtime packages exactly with a v3 lockfile, and a pinned plugin version that is bumped on every change to
`core/src` or the pins. Each of its TypeScript scripts starts by checking those packages are installed and
refuses to run when one is missing, naming it. CI's carrier check lists planner, and CI runs planner's TypeScript tests.

**Why this priority**: Every other story runs core code inside planner. Until planner carries core, none of
them can be built, and the carrier check grades nothing.

**Independent Test**: On a branch with only this story, run the carrier check against `main`: it reports one
carrier, planner, with zero failures. Remove one of planner's installed packages and run one of its scripts: it
exits 2 naming the missing package.

**Acceptance Scenarios**:

1. **Given** this story merged, **When** CI runs the carrier check, **Then** it lists `planner/plugin` among
   the carriers it checked and reports no failure for it.
2. **Given** a later PR that changes a file under `core/src` and does not bump planner's plugin version,
   **When** CI runs the carrier check, **Then** it fails naming planner's `plugin.json`.
3. **Given** planner's package pins one of core's packages at a version other than core's, **When** CI runs the
   carrier check, **Then** it fails naming the package and both versions.
4. **Given** one of core's packages is not installed in planner, **When** a planner TypeScript script runs,
   **Then** it exits 2, names the package and the folder it is missing from, and does nothing else.
5. **Given** a PR that changes a planner TypeScript test, **When** CI runs, **Then** planner's TypeScript tests
   run and a failing one fails the build.

---

### User Story 2 - Planner acts on GitHub only as its own App (Priority: P1)

Planner's scripts mint a one-hour token of the `codeworks-planner` App for the checkout's repository, from
`planner-app.pem`, the one key read core allows where no managed settings are in effect (root ADR-0007 d4,
ADR-0008 d9), each before its first GitHub call when the stored token is missing, is another repository's, or
expires within 10 minutes. The token is kept in planner's own gh config folder, apart from the admin's gh login on
the same machine, and every GitHub call planner's scripts make, the landing script's push among them, acts with it
and with no other credential. The session's other commands keep the admin's gh login. Planner's settings, the
App's ID among them, are read from `codeworks.toml` through core's settings reader (root ADR-0002).

**Why this priority**: Story 4's issue and PR writes need a credential planner is allowed to use; today the
skill pushes and calls `gh` with whatever the admin's machine has.

**Independent Test**: Against a fake GitHub, with a planner key and settings: a planner script mints a token
with exactly the planner App's permissions for the one repository and calls GitHub with it. Remove the key: the
script fails naming the key file and makes no GitHub call.

**Acceptance Scenarios**:

1. **Given** `planner-app.pem` and planner's settings are present, **When** a planner script is about to make
   its first GitHub call, **Then** it mints a token of the planner App for the checkout's repository alone, with
   contents, pull requests and issues write and organization projects read, and nothing else.
2. **Given** a token that expires before the next GitHub call, **When** a planner script is about to make that
   call, **Then** it mints a new token first.
3. **Given** the key file is missing or unreadable, or GitHub refuses the mint, **When** a planner script runs,
   **Then** it fails with the reason core gives, and no GitHub call is made with another credential.
4. **Given** `codeworks.toml` is missing at the checkout's ref, or planner's section fails validation, **When**
   a planner script runs, **Then** it exits 2 naming the file and the key at fault.
5. **Given** the run completed, **When** the landing script pushes the branch and opens the spec PR, **Then**
   both act as the planner App: the push carries the planner App's token, and the PR's author is the planner App.
6. **Given** the checkout's `origin` is an SSH remote, **When** the landing script pushes, **Then** it pushes to
   the repository's https URL, so no SSH key carries the push.
7. **Given** the admin is signed in to gh on planner's machine, or `GH_TOKEN` or `GITHUB_TOKEN` is set in the
   admin's environment, **When** planner's scripts call GitHub or push, **Then** they read only
   planner's gh config folder and act as the planner App.
8. **Given** planner is enabled in a session and the admin's `GH_TOKEN` is exported, **When** a command other
   than planner's scripts runs in it, **Then** it sees the session's environment as the admin left it, `GH_TOKEN`
   included, and planner blocks nothing.

---

### User Story 3 - The spec states its facts as data (Priority: P2)

When planner's checks pass on a written spec, planner writes the `codeworks` front matter at the top of
spec.md — `v`, `kind` (`feature`, `defect` or `no_spec`) and `root_cause.observed` (`anchored`, `hypothesis` or
`none`) — through core's spec-facts writer (planner ADR-0008 d1). A no-spec folder gets it too. Core's reader,
which today refuses every spec with "no front matter", reads it back.

**Why this priority**: builder, reviewer and the root-cause reviewer read a spec's kind only from this block;
without it `requirement()` fails for every spec.

**Independent Test**: Run the workflow's grading steps on a defect spec whose root cause opens with an
`Observed:` line naming a test, then read spec.md with core's reader: it returns `kind: defect`,
`observed: anchored`.

**Acceptance Scenarios**:

1. **Given** a spec whose premise report says `Reports wrong behaviour: no`, **When** the grading steps pass,
   **Then** spec.md's front matter reads `kind: feature`, `root_cause: {observed: none}`.
2. **Given** a defect spec whose `Observed:` line names a failing test, log line or reproduction, **When** the
   grading steps pass, **Then** the front matter reads `kind: defect`, `observed: anchored`; with
   `Observed: nothing; this trace is a hypothesis from reading the code.` it reads `observed: hypothesis`.
3. **Given** a `no spec needed` pick, **When** the no-spec folder is written, **Then** its spec.md front matter
   reads `kind: no_spec`, `root_cause: {observed: none}`.
4. **Given** grill later rewrites the root cause section, **When** the root cause is graded again, **Then** the
   front matter is rewritten to match, and only one `codeworks` block exists.
5. **Given** any spec planner wrote, **When** core's spec-facts reader reads it, **Then** it returns the facts
   and does not refuse.

---

### User Story 4 - Planner lands the spec through its spec PR and story issues (Priority: P2)

On a completed run, planner creates one sub-issue per story under the spec's issue `<p>`, each `blockedBy`
the one before (a one-story spec uses `<p>` itself), labels each task block in tasks.md with its story issue's
number, and pushes the spec folder and its decision records, and no code, to `<p>-spec`: to its open PR, or to
a new branch from the default branch opened as a draft PR (planner ADR-0005, ADR-0008 d2, ADR-0009 d3,
ADR-0010). A run starts only when the issue's card is in Backlog or Blocked and the spec's issue is open
(planner ADR-0005 d3).

**Why this priority**: Today an admin creates the story issues, the chain and the spec PR by hand after every
run; it depends on Stories 1 and 2.

**Independent Test**: Against a fake GitHub, complete a run of a three-story spec on issue `#p`: three sub-issues
exist under `#p`, the second and third `blockedBy` the one before, tasks.md's blocks carry their numbers, and
one draft PR from `<p>-spec` holds only the spec folder and records.

**Acceptance Scenarios**:

1. **Given** a completed run of a spec with stories US1–US3 on issue `#p` and no `<p>-spec` branch, **When**
   planner lands it, **Then** three sub-issues of `#p` exist, US2 `blockedBy` US1 and US3 `blockedBy` US2, and a
   draft PR from `<p>-spec` to the default branch holds the spec folder and its records.
2. **Given** a one-story spec, **When** planner lands it, **Then** no sub-issue is created and the story's task
   block is labelled `#p`.
3. **Given** tasks.md with Setup, Foundational, story phases and Polish, **When** the story issues exist,
   **Then** Setup and Foundational carry the first story's number, each story phase its own, and Polish the
   last story's.
4. **Given** `<p>-spec` has an open PR, **When** planner lands the run, **Then** it pushes to that branch and
   opens no second PR.
5. **Given** `<p>-spec` exists and its PR was closed unmerged, **When** the run would push, **Then** it stops
   before writing anything to GitHub, naming the branch for an admin to delete.
6. **Given** the issue's card is outside Backlog and Blocked, or the spec's issue is closed, **When** the run
   starts, **Then** it stops before writing anything, naming the cards to move.
7. **Given** a re-run on the same spec, **When** planner lands it, **Then** no story issue is created twice:
   an existing story issue keeps its number.
8. **Given** a rescope run, **When** it reaches the landing, **Then** it stops before it writes anything to
   GitHub, naming #178.

---

### User Story 5 - Planner closes no issue (Priority: P3)

On a `not worth doing` pick, the run ends by naming the close for the admin to do and the premise report's
reason; planner closes nothing and posts nothing on the issue (planner ADR-0006 d1–d2).

**Why this priority**: A one-step change that removes a write planner's records forbid; it needs nothing from
the other stories.

**Independent Test**: Drive a run to a `not worth doing` pick against a fake `gh`: no close or comment call is
made, and the run's last output names the issue, the close to do and the reason.

**Acceptance Scenarios**:

1. **Given** an open issue and a `not worth doing` pick, **When** the run completes, **Then** the issue is still
   open, has no new comment, and the run's output names the close and the reason.
2. **Given** a `no spec needed` pick, **When** the run completes, **Then** nothing is posted on the issue
   (unchanged).


---

### User Story 6 - Planner keeps out of the session's credentials (Priority: P2)

Planner has no session hook. Its scripts mint the planner App's token themselves (Story 2), so the admin keeps
their own gh login for every other command in the session, and a mint that fails fails only the script that
needed it. The issue an `untracked` run creates is created as the planner App, through planner's gh.

**Why this priority**: The hook swapped the admin's gh credentials out of every planner session and refused every
Bash call when GitHub or the key failed (admin's ruling, 2026-10-29).

**Independent Test**: Start a session with planner installed and `GH_TOKEN` exported: no planner hook runs,
`GH_TOKEN` is unchanged, and preflight and the landing script still act as the planner App.

**Acceptance Scenarios**:

1. **Given** planner is installed, **When** its plugin is loaded, **Then** it declares no hook.
2. **Given** `planner-app.pem` is missing, **When** a Bash command other than planner's scripts runs in the
   session, **Then** it runs as usual; **When** a planner script that calls GitHub runs, **Then** it fails
   naming the key file.
3. **Given** an `untracked` run, **When** it creates the issue, **Then** it calls GitHub with the planner App's
   token read from planner's gh config folder, never the admin's login, and the issue's author is
   `codeworks-planner[bot]`.
4. **Given** `GH_TOKEN` is exported in the session, **When** planner's scripts call GitHub, **Then** they act as
   the planner App.

---

### Edge Cases

- **A carrier's `core` is a copied folder, not a link**: the carrier check fails it, naming the expected link
  (already true of the check; planner must ship the link).
- **Planner run on the agent machine**: out of the supported setup (root ADR-0008 d2); the key read exemption
  covers planner only where managed settings are absent, so core refuses the read there rather than planner
  working around it.
- **The token expires mid-run during a long headless step**: the refresh before each GitHub call (US2 #2)
  covers it; a step that holds a token across an hour is a defect, not a retry case.
- **A spec folder whose spec.md already has a `codeworks` block from an earlier run**: it is replaced, never
  duplicated (US3 #4).
- **The spec folder lookup finds several `specs/<p>-*` folders**: the run stops naming them; it never picks one.
- **A rescope run**: it stops before it pushes, naming #178 (US4 #8); landing a rescope is #178's.
- **A mint fails**: the planner script that needed the token fails with core's reason; nothing else in the
  session is blocked (US6 #2).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Planner MUST carry core as root ADR-0001 d2 and ADR-0009 d3–d4 define a carrier: `planner/plugin/core`
  a link to `../../core/src`; a module package pinning exactly core's runtime packages (today smol-toml 1.9.1,
  yaml 2.9.1, zod 4.6.7) with a v3 lockfile; a pinned `plugin.json` version.
- **FR-002**: Every PR that changes `core/src` or core's pins MUST bump planner's plugin version; the carrier
  check enforces it.
- **FR-003**: Every planner TypeScript entry point MUST load only core's dependency guard before the guard runs,
  and MUST exit 2 naming the missing package on a missing dependency.
- **FR-004**: CI MUST run every carrier's TypeScript tests, not only core's, and a failing test MUST fail the
  build.
- **FR-005**: Planner's scripts MUST mint the `codeworks-planner` App token for the checkout's repository alone,
  from `planner-app.pem`, through core, before a GitHub call when no token is stored for that repository or it
  expires within 10 minutes.
- **FR-006**: Planner's scripts MUST keep the token in planner's own gh config folder on planner's machine, apart
  from the admin's gh login, and MUST read only that folder and act with no other GitHub credential, the admin's
  login and any `GH_TOKEN` or `GITHUB_TOKEN` included. Planner MUST NOT change the session's environment or block
  a command it does not run. Planner's landing script MUST make every GitHub write of the landing (push, spec PR,
  story issues); its push goes through core's git runner to the repository's https URL, with git reading the
  token from gh (`gh auth git-credential`).
- **FR-007**: Planner MUST read its settings, the App's ID among them, from `codeworks.toml` through core's
  settings reader, and MUST block naming the file and key when they are missing or invalid. This repository has
  no `codeworks.toml` today, so US2 MUST add it, or planner stops running here once it reads one.
- **FR-008**: Planner MUST write the `codeworks` front matter (`v: 1`, `kind`, `root_cause.observed`) into every
  spec.md it writes, no-spec folders included, through core's spec-facts writer, so core's reader accepts it.
  The values come from the premise report's `Reports wrong behaviour` and the root cause's `Observed:` line: an
  `Observed:` line that opens with the template's sentence `Observed: nothing; this trace is a hypothesis from
  reading the code.` reads `hypothesis`, any other filled `Observed:` line `anchored`, and `Not a defect report.`
  or a no-spec spec.md, which has no root cause section, `none`.
- **FR-009**: Planner MUST create one sub-issue per story under `<p>`, each `blockedBy` the previous, using `<p>`
  itself for a one-story spec, and MUST NOT create a story issue that already exists.
- **FR-010**: Planner MUST label each task block in tasks.md with its story issue's number: Setup and
  Foundational the first story's, each story phase its own, Polish the last story's.
- **FR-011**: Planner MUST push the spec folder and its decision records, and nothing else, to `<p>-spec`, to
  its open PR if there is one, else to a new branch from the default branch opened as a draft PR; a `<p>-spec`
  whose PR closed unmerged MUST stop the run naming the branch. A rescope run MUST stop before it writes anything
  to GitHub, naming #178.
- **FR-012**: A run MUST stop before writing anything when the issue's card is outside Backlog and Blocked or the
  spec's issue is closed, naming the cards to move; an issue with no card on the board stops it alike, naming
  the card to add (root ADR-0006 d1). Planner writes no lane and adds no card.
- **FR-014**: The spec PR MUST be opened as a draft, and planner MUST NOT create or apply an exempt label: a spec
  PR is approved by a label from `exempt_labels` that a writer other than a codeworks App applies after the
  head's push (orchestrator ADR-0005 d1, d4, d5), so a label from planner's App would not count.
- **FR-015**: On a `not worth doing` pick, planner MUST close no issue and post nothing; the run MUST end naming
  the close for the admin and the premise report's reason.
- **FR-016**: Each core capability planner needs and core lacks today MUST land in core inside the planner story
  that first uses it, in that story's one PR (org ADR-0003): token write and refresh in a gh config folder with
  US2; the spec-facts writer, and generated schemas for the premise value sets the Python scripts read, with US3,
  whose TypeScript step is the first to read the premise report; the spec-PR lookup on `<p>-spec`, the
  branch-name builder, a spec-folder answer that tells none from several, and the board lane read, which the
  orchestrator, reviewer and builder read too, with US4. A capability #174 lands first is reused, not added
  again.
- **FR-017**: A planner script that calls core MUST be TypeScript (root ADR-0009); a script that does not stays
  as it is.

### Key Entities

- **Carrier**: a plugin with a `core` link, a pinned package and lockfile, and a pinned version; graded by the
  carrier check.
- **Planner token**: a one-hour, one-repository installation token of `codeworks-planner`, minted by planner's
  scripts and kept in planner's own gh config folder, which planner's scripts and their push read.
- **Spec facts**: the `codeworks` front matter of spec.md: `v`, `kind`, `root_cause.observed`.
- **Story issue**: a sub-issue of `<p>` per story, chained by `blockedBy`, whose number labels its task block.
- **Spec PR**: the draft PR from `<p>-spec` that carries the spec folder and its records.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The carrier check on `main` lists planner among its carriers and reports 0 failures.
- **SC-002**: CI runs planner's TypeScript tests on every PR; a deliberately failing planner test fails the build.
- **SC-003**: 100% of spec.md files planner writes after this lands are read by core's spec-facts reader without
  refusal.
- **SC-004**: After a completed run, the admin creates zero story issues, `blockedBy` links or spec PRs by hand.
- **SC-005**: Zero GitHub writes by planner are made with any credential other than the planner App's token,
  checked by the author of every issue, comment and PR a test run makes and the credential each of its pushes
  carries.
- **SC-006**: Zero issues closed by planner on a `not worth doing` pick.

## Assumptions

- All cited records (root ADR-0001, 0002, 0007, 0008, 0009; planner ADR-0005, 0006, 0008, 0009, 0010) are
  accepted (PR #176); this spec follows them as written.
- This repository's `codeworks.toml` (FR-007), as verified on 2026-10-28: `[shared]` `board` is project 5, the
  board this repo's issues land on; `validators` is empty, since no module exists under `validators/`; the four
  App logins are `codeworks-session[bot]`, `codeworks-orchestrator[bot]`, `codeworks-reviewer[bot]` and
  `codeworks-planner[bot]`. `[planner]` holds the planner App's ID, 5510825; core finds the installation from
  the repository, so no installation key is needed. Every other repo planner runs in carries its own file.
- The key sits only on the admin's machine where planner runs, with no managed settings there (root ADR-0008 d2).
- Planner changes nothing in a session it is enabled in: a command other than its scripts acts with the admin's
  own gh login, under the admin's approval (root ADR-0007 d4, ADR-0008 d2).
- The planner App is installed on every repository planner runs in, with the permissions core's permission set
  names for it.
- The board adds each new issue as a card in Backlog, as this repo's board (project 5) does, so the issue an
  `untracked` run creates passes the lane check without planner writing to the board. A card not yet there when
  preflight reads it stops the run, naming the card to add (FR-012; root ADR-0004 d2); a re-run then passes.
- Python scripts that do not call core stay Python in this feature; moving them is not in scope.
- The decision-log check (planner ADR-0009 d1–d2), with the org log's declaration and the credential that reads
  it, is not in scope; it is #177. (FR-013 is retired with it.)
- Rescope landing (root ADR-0006 d2; planner ADR-0010 d2, d5, d6) is not in scope; it is #178. This spec lands
  new specs only.
- Story order follows what each story needs: Story 1 first, Story 2 before Story 4; Story 3 needs only Story 1,
  and Story 5 needs nothing. Story 6 needs Stories 2 and 4.

## Why this is worth doing

### harm
Answer: Core's code runs in no plugin, and planner keeps running its own Python steps without it. A spec folder planner writes has no `codeworks` front matter, so core's spec-facts reader refuses every spec with "no front matter". Planner creates no story sub-issues, `blockedBy` chain or spec PR on `<p>-spec`, so an admin does those by hand. On a `not worth doing` pick the workflow closes the issue, which planner ADR-0006 d1 says planner never does.
Source: code: core/scripts/check-carriers.ts --base origin/main prints "0 carriers"; core/src/contracts/spec-facts.ts:26; planner/plugin holds only scripts, skills and speckit (no hook, no package.json); planner/plugin/speckit/workflows/issue-spec/workflow.yml:85-93; planner ADR-0006 d1, ADR-0005, ADR-0008 to ADR-0010

### reachable
Answer: observed: main has no carrier, planner has no hook or core link, and the workflow's close-not-worth-doing step runs `gh issue close` on the issue.
Source: code: `node core/scripts/check-carriers.ts --base origin/main` (0 carriers, 0 failures); planner/plugin/speckit/workflows/issue-spec/workflow.yml:93

### change-alters
Answer: Yes. Planner links `core/src`, pins core's dependencies, and gains a hook that mints the planner App token. Its run then writes the spec-facts front matter core reads, creates the story sub-issues chained by `blockedBy` and opens the spec PR on `<p>-spec`, and its close step closes nothing. The carrier check lists planner, and CI runs planner's TypeScript tests.
Source: code: core/tests/fixtures/carrier-plugin (the model carrier); core/scripts/check-carriers.ts; user: issue #173 Change and Done when

### owner
Answer: No. The carrier check grades only carriers that exist, so with none it passes. CI runs `npm test` only for `core/tests` and Python unittest for every other suite, so a carrier's TypeScript tests would not run. No guard compares the close step with planner ADR-0006 d1.
Source: code: .github/workflows/tests.yml:52-60; core/scripts/check-carriers.ts output "0 carriers checked ... 0 failures"

### inherited
Answer: Yes, from the records, not a spec: root ADR-0001 d2 (each plugin that runs core code carries it), root ADR-0009 d3 and d4 (pins, version bump, hooks refuse on a missing package), root ADR-0007 d4 (planner's own App token, refreshed as decision 2 does) and planner ADR-0005 and ADR-0008 to ADR-0010. Put to them: each names a behaviour planner lacks on main (harm), observed (reachable), and the admin's 2026-10-28 rulings (PR #175) keep each in force.
Source: code: docs/adr/0001, 0007, 0009; planner/docs/adr/0005, 0008, 0009, 0010; user: rulings 1-7 in this session, PR #175

### needs-spec
Answer: It has decisions. The issue lists seven core modules planner needs first, each its own PR, and open points: the token for the org decision log in a second repo, how the push authenticates when runGit accepts caller `-c` args, and which of planner's Python scripts move to TypeScript now (root ADR-0009). The stories and their order also have to be cut.
Source: user: issue #173 "Needs from core first" and "Open"; code: core/src/git.ts:22

## Root cause

Not a defect report.
