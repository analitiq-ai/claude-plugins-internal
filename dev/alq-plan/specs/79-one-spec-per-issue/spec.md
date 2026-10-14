# Feature Specification: One spec per issue, named by it, landed through its own PR

**Feature Branch**: `79-spec` (#79)

**Created**: 2026-10-12

**Status**: Draft

**Input**: Issue #79, "alq-plan: name spec folders by their issue, land the spec on <issue>-spec through its own
reviewed PR, require a spec for every issue", part of #80.

**Settled with the user**: issue #79, "Decided", as edited on 2026-10-13. It follows `analitiq-ai/engineering`
`docs/engineering/git-workflow.md`: one spec per issue, at `specs/<issue>-<slug>/` (engineering ADR-0002,
decisions 1 and 2), landed through its own PR (decision 3), and one PR per user story (ADR-0003).
alq-plan ADR-0008 records the no-spec folder. ADR-0005, decision 3, stands.

## Clarifications

### Session 2026-10-12

- Q: What is a spec folder named? → A: `specs/<issue>-<short-name>` under the run's project. `<issue>` is the number of the issue in the repo that holds the folder. It reaches Spec Kit as `SPECIFY_FEATURE_DIRECTORY`, and the run checks after `specify` that `.specify/feature.json` names it.
- Q: How many spec folders can an issue have? → A: One. A new scope of an issue that already has `specs/<issue>-*` is refused and told the rescope form.
- Q: Which premise outcomes are there? → A: Three, as today: `write the spec`; `not worth doing`, which closes the issue as not planned with the reason and writes no folder; and `no spec needed`, which writes a folder that says no spec is needed.
- Q: What does `no spec needed` leave? → A: `specs/<issue>-<short-name>/spec.md`, from the run's folder input, saying no spec is needed and carrying the premise question the pick rests on and the reason, as the premise report records them. One writer script writes every such spec.md and nothing else into the folder. Nothing is posted on the issue, and the user is told to pass `spec: null` when the work is reviewed. A later new scope of that issue is refused, as the issue has a folder.
- Q: What does a rescope of a no-spec folder do? → A: It runs the new-scope workflow from the premise (premise → specify → grill → plan → critique → tasks) into that same folder, since a no-spec spec.md has nothing to grill. `specify` writes over the no-spec spec.md; if the premise picks `no spec needed` again, the writer writes it again. One pure function, in the writer's module, tells a no-spec spec.md apart.
- Q: What about a change with no issue? → A: The skill creates the issue first, in the repo `origin` names, with one of that repo's issue types, then scopes it like any other.
- Q: What does spec.md name its stories? → A: Spec Kit's headings, `### User Story <N> - <title> (Priority: P<n>)`. Branches (`<issue>-us<N>-…`), PR headers (`Implements: … § User Story <N>`) and review (#81) name them. On a rescope, existing stories keep their numbers and a new story takes the next free one.
- Q: And a rescope? → A: It works in the worktree it is run from, a story's or the spec's, and the spec edit lands in that PR.
- Q: What happens to the folders that exist? → A: Under `dev/alq-review/specs/`, 004, 007, 008, 009, 010, 011, 012, 014, 015, 016 and 017 are deleted with every citation. 019 is renamed `63-split-planning-plugin`. This runs after #68 (retires 018) and #83 (deletes 005 and 006) merge. `README.md` states the rule instead of `specs/<nnn>-<feature>/`.

### Session 2026-10-13

- Q: Where does the spec land? → A: On branch `<issue>-spec`, created from the repo's default branch in worktree `.claude/worktrees/<issue>-spec`. The skill commits, pushes and opens a draft PR whose body starts `Part of #<issue>`. It launches no review: alq-review is optional and, for now, started by hand with `spec: null` (issue #79, "Decided", as edited on 2026-10-13).

## Terms

- **Spec folder**: `specs/<feature>/` beside a committed `.specify/` (ADR-0004).
- **Issue folder**: a spec folder whose last part is `<issue>-<short-name>`.
- **Short name**: lowercase kebab-case, one or more words of `[a-z0-9]` joined by single hyphens. A new scope picks
  1 to 4 of them from the issue title (FR-002).
- **Folder input**: the one workflow input that names the run's spec folder, on every run.
- **Spec branch**: `<issue>-spec`, the branch a new scope lands its spec on.
- **Story heading**: a line `### User Story <N> - <title> (Priority: P<n>)` of spec.md.
- **No-spec spec.md**: the spec.md of a `no spec needed` pick. It says no spec is needed, and carries the question the
  pick rests on and the reason.
- **No-spec writer**: the one script in `plugins/alq-plan/scripts/` that writes a no-spec spec.md, and tells one
  apart.

## Today

Read or run in a worktree at `74251bf` (origin/main) on 2026-10-12. "Run" means it was run; "read" means read in the
code and not run.

- `/alq-plan:issue-spec` takes `#<issue> [<dir>]` or `rescope <spec folder> #<issue>`. Anything else stops and names
  the two forms (read: `plugins/alq-plan/skills/issue-spec/SKILL.md` §1).
- On `#<issue>` the checkout is "the issue's worktree (create it per the repo's branch rules if there is none)". No
  branch name, base or worktree path is given (read: SKILL.md §1).
- On `#<issue>` the skill passes no folder: `drive_workflow.py start <spec file> <issue>` starts the run with no
  `spec_dir` (read).
- The workflow's `specify` step gives `speckit.specify` the issue text and the premise report's path, and no folder
  (read: `plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml`).
- `speckit.specify` uses `SPECIFY_FEATURE_DIRECTORY` as it is when the user provides one. Otherwise it reads
  `feature_numbering` from `.specify/init-options.json` (`sequential` in `dev/alq-plan/`) and names the folder
  `specs/<NNN>-<short-name>`. It writes the folder to `.specify/feature.json`, which the workflow's later shell steps
  read (read: `dev/alq-plan/.claude/skills/speckit-specify/SKILL.md`, step 3; the workflow's `root-cause` step).
- A rescope's `select-spec` step takes any `specs/<feature>` of `[A-Za-z0-9._-]` that holds a `spec.md`, whatever
  issue it is given, and writes it to `.specify/feature.json` (read). Run: a rescope of `specs/001-demo` for issue 7
  pauses at grill (`test_a_rescope_start_pauses_at_grill_on_the_given_folder_with_the_issue_as_its_spec`).
- The folder reaches shell steps as `$SPEC_DIR`, set by `drive_workflow.py` only on a rescope. The workflow never
  splices it into shell source (read: the `spec_dir` input's comment).
- On a rescope, `CHECKOUT` is "the issue's worktree on the branch of the PR bound to that spec folder"; with none, the
  skill stops and asks (read: SKILL.md §1).
- The premise gate offers `write the spec`, `no spec needed` and `not worth doing` (read: workflow.yml `premise`;
  `premise_report.py` `OUTCOMES`). Run: `no spec needed` completes, calls GitHub for nothing and writes no `specs/`
  folder (`test_no_spec_needed_calls_github_for_nothing_and_writes_no_spec`); `not worth doing` closes the issue as
  not planned with the reason (`test_not_worth_doing_closes_the_issue_as_not_planned_with_the_reason_and_writes_no_spec`).
- After `no spec needed` the skill tells the user to pass `spec: null` when the work is reviewed, and stops (read:
  SKILL.md §2 step 3). `premise_report.py` refuses a report that says `Reports wrong behaviour: yes` and recommends
  `no spec needed` (read).
- A change with no issue has no form (read).
- A completed run is staged, committed and pushed on the checkout's branch, and no PR is opened: the spec lands
  with no PR of its own (read: SKILL.md §2 step 8). The skill ends with `Spec folder: <path>` and
  `Branch: <branch>`, as alq-plan ADR-0005, decision 3, has it (read).
- Nothing checks the story headings of spec.md, or that a rescope keeps their numbers (read: workflow.yml,
  `plugins/alq-plan/scripts/`).
- `dev/alq-review/specs/` holds 15 folders, `004` to `019` without `013`. By each `spec.md`'s Feature Branch line,
  `016` scopes #35, `017` #36, `018` #17 and `019` #63; 005 names `feat/43-…`, 006 `feat/49-…` and 008 `docs/9-…`;
  004 names no issue, and 007 and 009 to 015 have no Feature Branch line (read). #35 and #36 are closed (run:
  `gh issue view`). `dev/alq-plan/specs/` and `dev/alq-build/specs/` do not exist (read).
- Files outside each folder that cite it, by `specs/<nnn>-` or `spec <nnn>`: 004 6, 008 1, 009 1, 011 1, 012 1,
  014 1, 016 5, 017 1, 019 10; 007, 010 and 015 none (run: `git grep -lE` at `74251bf`, each folder's own files
  left out).
- `README.md:27` says each plugin's feature specs are in `specs/<nnn>-<feature>/`. The constitutions of alq-plan,
  alq-review and alq-build copy it in their Platform Constraints, naming `README.md` as its owner, and their
  Delivery Workflow names worktrees `.claude/worktrees/<n>`. No other file has `specs/<nnn>-<feature>` (run:
  `git grep`).
- The repo's default branch is `main`; its issue types are Task, Bug and Feature (run: `gh repo view`, `gh api
  graphql` `issueTypes`).
- Run: `python3 -m unittest` passes in `dev/alq-plan/tests` (117 tests) and `dev/alq-build/tests` (18 tests).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A new scope gets its issue's one folder (Priority: P1)

A maintainer scopes issue #79 with `/alq-plan:issue-spec #79`. The spec is written to `specs/79-<short-name>/`,
picked once at the start, and the run checks that Spec Kit wrote there. An issue that already has a folder is not
scoped a second time, and a rescope can only name the issue's own folder.

**Why this priority**: it is the request. Every other story rests on the folder carrying its issue.

**Independent Test**: in a throwaway project with stand-ins for the agent and `gh`, start runs and check the folder
the run is given, the one `specify` is told, what the run does when `specify` writes another, and the refusals
below.

**Acceptance Scenarios**:

1. **Given** `#79` and an issue titled "Name spec folders by their issue", **When** the run starts, **Then** the
   folder input is `specs/79-<short-name>`, the short name is 1 to 4 words from the title, and it is picked once
   for the run.
2. **Given** that folder, **When** the workflow reaches `specify`, **Then** `specify` is given it as
   `SPECIFY_FEATURE_DIRECTORY`.
3. **Given** `specify` wrote `.specify/feature.json` naming the given folder, **When** the check after `specify`
   runs, **Then** the run goes on.
4. **Given** `specify` wrote `.specify/feature.json` naming another folder, or none, **When** the check after
   `specify` runs, **Then** the run fails, and the message names both and the next step.
5. **Given** a folder input not of the form `specs/<issue>-<short-name>`, or whose number is not the run's issue,
   **When** the run starts, **Then** it fails before anything is written, and the message names the form.
6. **Given** `specs/7-demo/` exists, **When** a new scope of #7 starts, **Then** it is refused before anything is
   written, and the message names `rescope specs/7-demo #7`.
7. **Given** `specs/7-demo/` exists, **When** the user runs `rescope specs/7-demo #7`, **Then** the run starts at
   grill on that folder, as today. A no-spec folder starts at premise instead (Story 2, scenario 9).
8. **Given** `specs/7-demo/` exists, **When** the user runs `rescope specs/7-demo #8`, **Then** it is refused, and
   the message says the folder's name does not start with `8-`.
9. **Given** `specs/7-demo/` and `specs/7-other/` both exist, **When** the user runs `rescope specs/7-demo #7`,
   **Then** it is refused, and the message names the other folder.

---

### User Story 2 - Every issue planning sees leaves one folder or is closed (Priority: P1)

The premise keeps its three outcomes. `write the spec` writes a spec, `no spec needed` writes a folder that says no
spec is needed, and `not worth doing` closes the issue. A change that has no issue gets one first, and is then
scoped like any other.

**Why this priority**: the one-folder rule of Story 1 can only refuse a second scope of an issue it can see, and
one PR per story needs an issue number for every change.

**Independent Test**: drive a run to the premise pause and through each pick, with stand-ins for the agent and `gh`,
and check the folder, its spec.md and the calls to GitHub; run the new form with a stand-in `gh` and check the call
that creates the issue and the run that follows.

**Acceptance Scenarios**:

1. **Given** a new scope, **When** the run pauses at premise, **Then** the options are `write the spec`,
   `no spec needed` and `not worth doing`.
2. **Given** the pick `no spec needed`, **When** the run completes, **Then** `specs/<issue>-<short-name>/spec.md`
   exists, from the folder input and written by the no-spec writer. It says no spec is needed, and carries the
   question the pick rests on (`Rests on:`) and the reason (`Reason:`), as the premise report records them. The
   folder holds nothing else.
3. **Given** that run, **When** it completes, **Then** nothing is posted on the issue, and the user is told to pass
   `spec: null` when the work is reviewed.
4. **Given** a no-spec folder for #7, **When** a new scope of #7 starts, **Then** it is refused as in Story 1,
   scenario 6.
5. **Given** the pick `not worth doing`, **When** the run completes, **Then** the issue is closed as not planned with
   the reason, as today, and no folder is created.
6. **Given** `untracked "<what changes>"`, **When** the skill runs, **Then** it creates one issue in the repo
   `origin` names, with a title and body from the text and one of that repo's issue types, the text passed through
   a file and never on a command line; then it scopes the new issue as `#<new issue>`, premise first, and the run
   can end in any of the three outcomes.
7. **Given** GitHub refuses to create the issue, **When** the skill runs, **Then** it stops, starts no run, and the
   message names the next step.
8. **Given** the issue was created and a later step fails, **When** the run stops, **Then** the message names the
   issue it created.
9. **Given** a no-spec folder for #7, **When** the user runs `rescope <that folder> #7`, **Then** the run starts at
   premise, not grill, and runs premise → specify → grill → plan → critique → tasks into that same folder:
   `specify` writes over the no-spec spec.md. If the premise picks `no spec needed` again, the no-spec writer
   writes it again.

---

### User Story 3 - The spec lands through its own PR (Priority: P1)

A new scope works on branch `<issue>-spec`, in its own worktree from the default branch, and the spec lands through
its own PR. A rescope edits the spec in the PR it is run from. The story numbers that branches and PRs name do not
move.

**Why this priority**: under the engineering workflow the spec lands through its own PR first (engineering
ADR-0002, decision 3), and stories are named by number from then on.

**Independent Test**: run a new scope and a rescope with stand-ins for the agent, `git` remote and `gh`; check the
branch, its base, the worktree path, the PR body, that no review is launched, the last message, and the
story-number check.

**Acceptance Scenarios**:

1. **Given** `#79` in a repo whose default branch is `main`, **When** the skill starts, **Then** it creates branch
   `79-spec` from `origin/main` in worktree `.claude/worktrees/79-spec`, and the run's project is in that worktree.
2. **Given** branch `79-spec` already exists, locally or on `origin`, **When** a new scope of #79 starts, **Then** it
   is refused before anything is written, and the message names the branch and the rescope form.
3. **Given** a new scope that completed, **When** the skill ends, **Then** the spec folder is committed and pushed
   on `79-spec`, a draft PR into the default branch is open whose body starts `Part of #79`, no review has been
   launched, and the last message names the folder, the branch, the PR and `spec: null`.
4. **Given** a spec.md with a story heading that is not `### User Story <N> - <title> (Priority: P<n>)`, or two
   stories with one number, **When** the run checks it, **Then** it fails, naming the heading.
5. **Given** a rescope run from a story's worktree, **When** it completes, **Then** the spec edit is committed and
   pushed on that worktree's branch, and no other branch or PR is created.
6. **Given** a rescope of a spec with stories 1 to 3, **When** the rescoped spec.md drops story 2's heading, keeps
   1 and 3, and adds a story, **Then** the run goes on only if the new story is numbered 4. A new story numbered 2,
   or a renumbered story, fails the run, naming the numbers.
7. **Given** a run that fails or is rejected, **Then** nothing is committed, pushed or opened.
8. **Given** a new scope that ended on `no spec needed`, **When** the skill ends, **Then** the no-spec folder lands as
   in scenario 3: committed and pushed on `<issue>-spec`, a draft PR whose body starts `Part of #<issue>`, no
   review launched, and the last message naming the folder, the branch, the PR and `spec: null`.

---

### User Story 4 - The folders that exist follow the rule (Priority: P2)

Every spec folder in the repo is named by its issue, or is gone, and nothing cites a name that no longer exists.

**Why this priority**: an old folder can be neither rescoped nor reviewed by its story once Story 1 ships.

**Independent Test**: list `dev/*/specs/`, and search the repo for each old folder name and for `spec 0NN`.

**Acceptance Scenarios**:

1. **Given** #68 and #83 merged and this story merged, **When** `dev/alq-review/specs/` is listed, **Then** it holds
   `63-split-planning-plugin` and nothing else.
2. **Given** the same, **When** the repo is searched for `specs/004-` to `specs/019-` and for `spec 004` to
   `spec 019`, **Then** nothing is found outside git history and this spec.
3. **Given** the same, **When** `README.md` is read, **Then** it states that a plugin's feature specs are in
   `specs/<issue>-<short-name>/`, one per issue.

---

### User Story 5 - The constitutions state the rule (Priority: P3)

The constitutions of alq-plan, alq-review and alq-build state the folder rule and the worktree path that README.md
and the engineering git workflow state.

**Why this priority**: each constitution names README.md as the owner of its folder line, so it is amended after
Story 4 changes README.md.

**Independent Test**: search the repo for `specs/<nnn>-`, and read each constitution's Platform Constraints and
Delivery Workflow.

**Acceptance Scenarios**:

1. **Given** Story 4 and this story merged, **When** each of the three constitutions is read, **Then** its Platform
   Constraints name `specs/<issue>-<short-name>/` and its Delivery Workflow names worktrees
   `.claude/worktrees/<branch>`.
2. **Given** the same, **When** the repo is searched for `specs/<nnn>-`, **Then** nothing is found outside git
   history and this spec.

---

### Edge Cases

- `specs/079-x` for #79: refused. The number is the issue's number as GitHub writes it, with no padding.
- `specs/79-x` for #7: refused. The prefix checked is `7-`, with its hyphen.
- A short name with capitals, underscores, spaces, or nothing after the hyphen: refused by the folder check.
- An issue title with one usable word, such as "Cleanup": the short name is that word, `specs/<issue>-cleanup`.
- A project folder before `specs` (`dev/alq-plan/specs/79-x`): the workflow, which runs in the project, is given
  `specs/79-x`.
- A second Spec Kit project in the same repo holds `specs/<issue>-*`: the workflow sees only its own project's
  `specs/`, so it is not refused. Branch `<issue>-spec` existing does refuse it (Story 3, scenario 2).
- An open spec PR whose folder is not on the default branch yet: the new worktree starts from the default branch and
  cannot see the folder; branch `<issue>-spec` refuses the second scope.
- `untracked ""` or only spaces: refused before any issue is created.
- A run started before this change is resumed: it fails with a message naming the next step, as it has no folder
  input. No compatibility (constitution III).
- A spec scoped before this change, with no story headings, rescoped: the heading check finds no stories before and
  grades only the form of those after.

## Requirements *(mandatory)*

### Functional Requirements

**The folder (Story 1)**

- **FR-001**: Every spec folder alq-plan creates MUST be `specs/<issue>-<short-name>` under the run's project.
- **FR-002**: `/alq-plan:issue-spec` MUST pick `<short-name>` once, at the start of a new scope, as 1 to 4 words of
  the issue title, and pass the whole folder to the workflow. On a rescope the folder is the one the user names.
- **FR-003**: The workflow MUST take the folder as one input on every run, new scope and rescope. Which kind of run
  it is MUST NOT be read from whether a folder was given. The folder MUST reach shell steps through the environment,
  never spliced into shell source.
- **FR-004**: The workflow MUST check the folder with one pure function in `plugins/alq-plan/scripts/` before
  anything is written: the path is `specs/<issue>-<short-name>`; its number is the run's issue; on a new scope no
  `specs/<issue>-*` exists; on a rescope the folder holds a `spec.md` and no other `specs/<issue>-*` exists. Every
  refusal MUST name the next step, and a refused new scope MUST name the rescope form with the existing folder. This
  replaces `select-spec`'s shell pattern.
- **FR-005**: The workflow MUST pass the folder to `specify` as `SPECIFY_FEATURE_DIRECTORY`, and after `specify`
  MUST check that `.specify/feature.json` names it. Any other folder, or none, MUST fail the run, naming both.

**One folder or a closed issue (Story 2)**

- **FR-006**: The premise MUST keep its three outcomes: `write the spec`, `no spec needed` and `not worth doing`.
- **FR-007**: `not worth doing` MUST close the issue as today, and create no folder.
- **FR-008**: On `no spec needed`, the run MUST create the folder input with a spec.md that says no spec is needed,
  and carries the question the pick rests on (`Rests on:`) and the reason (`Reason:`) as the premise report records
  them. It MUST post nothing on the issue, and MUST tell the user to pass `spec: null` when the work is reviewed.
- **FR-009**: One script, the no-spec writer in `plugins/alq-plan/scripts/`, MUST write every no-spec spec.md. It
  MUST write nothing else into the folder.
- **FR-010**: A rescope of a folder whose spec.md is a no-spec spec.md MUST run the new-scope workflow from the
  premise (premise → specify → grill → plan → critique → tasks) into that folder, the folder input fixing where
  `specify` writes. The workflow MUST tell a no-spec spec.md apart by one pure function in the no-spec writer's
  module.
- **FR-011**: `/alq-plan:issue-spec` MUST take a third form, `untracked "<what changes>" [<dir>]`, and name all three
  forms when it refuses anything else.
- **FR-012**: On `untracked`, the skill MUST create one issue in the repo `origin` names, with a title and body from
  the text and one of the issue types that repo offers, the text through a file and never on a command line. It
  MUST then scope that issue as `#<issue> [<dir>]` does. A failed create MUST stop with no run started; a failure
  after it MUST name the issue created.

**The spec PR (Story 3)**

- **FR-013**: A new scope MUST create branch `<issue>-spec` from the default branch as `origin` has it (`gh repo view
  --json defaultBranchRef`), in worktree `.claude/worktrees/<issue>-spec` of the repo, with `--no-track`, and run
  there. A branch `<issue>-spec` that exists locally or on `origin` MUST refuse the new scope, naming the branch and
  the rescope form.
- **FR-014**: A completed new scope MUST commit the spec folder, a no-spec folder included, push the branch, and
  open a draft PR into the default branch whose body starts `Part of #<issue>`. It MUST launch no review. Its last
  message MUST give the spec folder, the branch, the PR and `spec: null`, for a review the user starts by hand. As
  ADR-0005, decision 3, has it, the message MUST name no command of another plugin.
- **FR-015**: A rescope MUST work in the worktree it is run from, and commit and push the spec edit on that
  worktree's branch. It MUST create no branch, worktree or PR.
- **FR-016**: The workflow MUST check spec.md's story headings with one pure function after every step that writes
  spec.md: each is `### User Story <N> - <title> (Priority: P<n>)`, and no number is used twice. On a rescope it
  MUST also check, against spec.md as the run found it, that every number not there before is greater than every
  number that was. Numbers that were there may be dropped, and are not reused.
- **FR-017**: A run that fails or is rejected MUST commit, push and open nothing.

**Existing folders (Story 4)**

- **FR-018**: After #68 and #83 merge, `dev/alq-review/specs/` 004, 007, 008, 009, 010, 011, 012, 014, 015, 016 and
  017 MUST be deleted, with every citation of them in the repo.
- **FR-019**: 019 MUST be renamed `63-split-planning-plugin`, and every citation of the old name, by path or as
  `spec 019`, MUST name the new folder.
- **FR-020**: `README.md` MUST state the rule, `specs/<issue>-<short-name>/`, one per issue, in place of
  `specs/<nnn>-<feature>/`.

**The constitutions (Story 5)**

- **FR-022**: The constitutions of alq-plan, alq-review and alq-build MUST name `specs/<issue>-<short-name>/` in
  their Platform Constraints and `.claude/worktrees/<branch>` in their Delivery Workflow, with a PATCH version bump
  each. Each constitution's Platform Constraints name README.md as the owner of the folder line, so Story 5 lands
  after Story 4 changes README.md.

**Tests**

- **FR-021**: Tests MUST be written first and seen to fail for the reason expected, in `dev/alq-plan/tests`. Fixtures
  named `specs/001-demo` and `specs/001-new` MUST be named by their issue.

### Key Entities

- **Spec folder**: `specs/<issue>-<short-name>/`, beside a committed `.specify/`. One per issue in a project.
- **Folder input**: the run's one folder, picked by the skill or named by a rescope, checked once, and the only
  source of the folder for every step.
- **Spec branch and PR**: `<issue>-spec`, from the default branch; its draft PR's body starts `Part of #<issue>`.
- **No-spec spec.md**: says no spec is needed, with the question the pick rests on and the reason. Written by the
  no-spec writer alone.
- **Issue**: in the repo `origin` names. For `untracked`, created by the skill.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every folder a run creates is `specs/<issue>-<short-name>` for the run's issue, in every run of the
  alq-plan suite.
- **SC-002**: A second scope of an issue, by folder or by branch, and a rescope of another issue's folder are refused
  before anything is written: every case in the suite.
- **SC-003**: A run whose `specify` writes any folder but the one given fails: 0 such runs complete.
- **SC-004**: `no spec needed` leaves exactly one folder whose spec.md is written by the no-spec writer;
  `not worth doing` leaves none.
- **SC-005**: Every completed new scope lands its spec through its own PR: a pushed `<issue>-spec` branch and a
  draft PR whose body starts `Part of #<issue>`, in every run of the alq-plan suite.
- **SC-006**: After Story 4, 0 folders under `dev/*/specs/` are named by a Spec Kit number, and 0 citations of an old
  name remain outside git history and this spec. After Story 5, 0 statements of the `specs/<nnn>-` form remain
  outside git history and this spec.
- **SC-007**: CI is green.

## Assumptions

- The one-folder check sees the `specs/` of the run's project. The repo's other Spec Kit projects are not searched.
- `untracked` takes an optional `<dir>`, as `#<issue>` does, so the folder can land in a project under the checkout.
- The skill asks the user to confirm the title, body and issue type before it creates the issue: it writes to
  GitHub for the user.
- A rescope, like a new scope, launches no review. It opens no PR: the spec edit lands in the PR it is run from.
- Whether the headless agent of `specify` honours `SPECIFY_FEATURE_DIRECTORY` from its environment, or needs it in
  its arguments, was not run. FR-005's check holds the folder either way.
- Out of scope: how alq-build finds and uses the folder (#82); review's story contract (#81); rounds before a PR
  exists (#70).

## Why this is worth doing

### harm
Answer: Nothing ties a spec folder to its issue, an issue can get two folders, a `no spec needed` scope leaves no folder that a later scope could see, and the spec lands with no PR of its own. Under the engineering workflow, branches and PR headers name a spec folder and story that planning never guarantees.
Source: code: plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml (premise, specify, select-spec), plugins/alq-plan/skills/issue-spec/SKILL.md §2 step 8, analitiq-ai/engineering docs/adr/0003-one-pr-per-user-story.md decisions 1 and 3

### reachable
Answer: observed. A rescope of specs/001-demo for issue 7 runs to grill, no spec needed completes with no folder, and the 15 folders in dev/alq-review/specs/ are numbered by Spec Kit, not by issue.
Source: reproduction: python3 -m unittest in dev/alq-plan/tests at 74251bf on 2026-10-12; ls dev/alq-review/specs

### change-alters
Answer: Yes. The folder is named from the issue and checked after specify, a second scope is refused, `no spec needed` leaves a folder that says so, and the spec lands through its own PR.
Source: user: issue #79, "Decided", as edited on 2026-10-13

### owner
Answer: No. select-spec checks only the path's shape and spec.md; nothing checks the folder against the issue or the story headings; and the skill's §2 step 8 opens no PR, so the spec lands with no PR of its own.
Source: code: plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml, plugins/alq-plan/skills/issue-spec/SKILL.md §2 step 8

### inherited
Answer: Yes. (1) alq-plan ADR-0001 accepts a spec folder name without the issue number; this spec ends that (FR-001). (2) alq-plan ADR-0005 accepts more than one spec folder per issue; this spec ends that (FR-004). (3) alq-plan ADR-0005, decision 3, has a completed run post nothing on the issue and end with a message that gives the spec folder and branch and names no other plugin's command; this spec keeps ADR-0005, decision 3. (4) alq-plan ADR-0006 leaves a `no spec needed` outcome living only in the session that picked it; alq-plan ADR-0008 (PR #95) moves that outcome into the repo, in a spec folder that says no spec is needed, and this spec follows ADR-0008 (FR-008). (5) Engineering ADR-0002, decisions 1 and 2, set the folder rule, one `specs/<issue>-<slug>/` per issue, and engineering ADR-0002, decision 3, sets the spec PR on `<issue>-spec`; alq-plan follows engineering ADR-0002.
Source: code: dev/alq-plan/docs/adr/0001-keep-the-spec-in-the-spec-folder-that-planning-writes.md, dev/alq-plan/docs/adr/0005-have-the-skill-that-shapes-an-issue-read-and-write-the-spec-in-its-spec-folder.md, dev/alq-plan/docs/adr/0006-close-an-issue-not-worth-doing-and-post-nothing-for-one-that-needs-no-spec.md, dev/alq-plan/docs/adr/0008-give-an-issue-that-needs-no-spec-a-spec-folder-that-says-so.md, analitiq-ai/engineering docs/adr/0002-one-spec-per-issue.md

### needs-spec
Answer: It has decisions in it: the folder form, one folder per issue, the no-spec folder, an issue first for a change with none, the spec PR and the migration. The user settled them in issue #79.
Source: user: issue #79, "Decided", as edited on 2026-10-13

## Root cause

Observed: a rescope of `specs/001-demo` for issue 7 runs to grill
(`test_a_rescope_start_pauses_at_grill_on_the_given_folder_with_the_issue_as_its_spec`, run 2026-10-12 in
`dev/alq-plan/tests`), and `016` in `dev/alq-review/specs/` scopes #35.

The folder's name is decided by Spec Kit, not by planning. The workflow's `specify` step names no folder, so
`speckit.specify` falls back to `feature_numbering`: the next free 3-digit number and a short name of its own. The
wrong decision is made in `plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml`, at `specify`, which passes no
folder, and at `select-spec`, which takes any `specs/<feature>` for any issue. The skill's §2 step 8 ends the run
on a pushed branch and opens no PR, so the spec lands with no PR of its own, and the premise's `no spec needed`
leaves no folder, so a later scope of that issue cannot see it was judged.

- **Other callers**: `drive_workflow.py start`, which passes no folder on a new scope (verified: the Premise tests
  start a new scope with no folder); `/alq-build:issue-tackle`, which builds against any folder with a `spec.md`
  (predicted, read); alq-review's shape check, which accepts any folder under `specs` (predicted, read).
- **Examined and ruled out**: Spec Kit's `create-new-feature.sh --number`. It pads the number to three digits and
  `speckit.specify` does not call it, so it cannot give `79-`.
- **Not investigated**: whether the headless agent honours `SPECIFY_FEATURE_DIRECTORY` from its environment; a full
  run with the real agent.
