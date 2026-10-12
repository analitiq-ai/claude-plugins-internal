# Feature Specification: One spec per issue, named by it, landed through its own PR

**Feature Branch**: `79-spec` (#79)

**Created**: 2026-10-12

**Status**: Draft

**Input**: Issue #79, "alq-plan: name spec folders by their issue, land the spec on <issue>-spec through its own
reviewed PR, require a spec for every issue", part of #80.

**Settled with the user**: issue #79, "Decided", as edited on 2026-10-12. It follows `analitiq-ai/engineering`
`docs/engineering/git-workflow.md` (engineering ADR-0002 one spec per issue, ADR-0003 one PR per user story).
Decision records: alq-plan ADR-0007, ADR-0008 and ADR-0009.

## Clarifications

### Session 2026-10-12

- Q: What is a spec folder named? → A: `specs/<issue>-<short-name>` under the run's project. `<issue>` is the number of the issue in the repo that holds the folder. It reaches Spec Kit as `SPECIFY_FEATURE_DIRECTORY`, and the run checks after `specify` that `.specify/feature.json` names it.
- Q: How many spec folders can an issue have? → A: One. A new scope of an issue that already has `specs/<issue>-*` is refused and told the rescope form.
- Q: Which premise outcomes are left? → A: `write the spec` and `not worth doing`. `no spec needed` goes: every issue that is built has a spec. `spec: null` at review is only for a PR that is not a user story.
- Q: What about a change with no issue? → A: The skill creates the issue first, in the repo `origin` names, with one of that repo's issue types, then scopes it like any other.
- Q: What does spec.md name its stories? → A: Spec Kit's headings, `### User Story <N> - <title> (Priority: P<n>)`. Branches (`<issue>-us<N>-…`), PR headers (`Implements: … § User Story <N>`) and review (#81) name them. On a rescope, existing stories keep their numbers and a new story takes the next free one.
- Q: Where does the spec land? → A: On branch `<issue>-spec`, created from the repo's default branch in worktree `.claude/worktrees/<issue>-spec`. The skill commits, pushes, opens a draft PR whose body starts `Part of #<issue>`, and runs the review loops with `spec: null`, the internal round first.
- Q: And a rescope? → A: It works in the worktree it is run from, a story's or the spec's, and the spec edit lands in that PR.
- Q: What happens to the folders that exist? → A: Under `dev/alq-review/specs/`, 004, 007, 008, 009, 010, 011, 012, 014, 015, 016 and 017 are deleted with every citation. 019 is renamed `63-split-planning-plugin`. This runs after #68 (retires 018) and #83 (deletes 005 and 006) merge. `README.md` states the rule instead of `specs/<nnn>-<feature>/`.

## Terms

- **Spec folder**: `specs/<feature>/` beside a committed `.specify/` (ADR-0004).
- **Issue folder**: a spec folder whose last part is `<issue>-<short-name>`.
- **Short name**: lowercase kebab-case, one or more words of `[a-z0-9]` joined by single hyphens.
- **Folder input**: the one workflow input that names the run's spec folder, on every run.
- **Spec branch**: `<issue>-spec`, the branch a new scope lands its spec on.
- **Story heading**: a line `### User Story <N> - <title> (Priority: P<n>)` of spec.md.

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
- A completed run is staged, committed and pushed on the checkout's branch, and the skill ends with
  `Spec folder: <path>` and `Branch: <branch>`. No PR is opened and no review is run (read: SKILL.md §2 step 8;
  alq-plan ADR-0005, decision 3).
- Nothing checks the story headings of spec.md, or that a rescope keeps their numbers (read: workflow.yml,
  `plugins/alq-plan/scripts/`).
- `dev/alq-review/specs/` holds 15 folders, `004` to `019` without `013`. By each `spec.md`'s Feature Branch line,
  `016` scopes #35, `017` #36, `018` #17 and `019` #63; 005 names `feat/43-…`, 006 `feat/49-…` and 008 `docs/9-…`;
  004 names no issue, and 007 and 009 to 015 have no Feature Branch line (read). #35 and #36 are closed (run:
  `gh issue view`). `dev/alq-plan/specs/` and `dev/alq-build/specs/` do not exist (read).
- Files outside each folder that cite it, by `specs/<nnn>-` or `spec <nnn>`: 004 6, 008 3, 009 1, 011 1, 012 1,
  014 1, 016 7, 017 3, 019 15; 007, 010 and 015 none (run: `grep -rlE`).
- `README.md:27` says each plugin's feature specs are in `specs/<nnn>-<feature>/` (read).
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
   folder input is `specs/79-<short-name>`, the short name is 2 to 4 words from the title, and it is picked once
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
   grill on that folder, as today.
8. **Given** `specs/7-demo/` exists, **When** the user runs `rescope specs/7-demo #8`, **Then** it is refused, and
   the message says the folder's name does not start with `8-`.
9. **Given** `specs/7-demo/` and `specs/7-other/` both exist, **When** the user runs `rescope specs/7-demo #7`,
   **Then** it is refused, and the message names the other folder.

---

### User Story 2 - Every issue that is built has a spec (Priority: P1)

The premise asks only whether an issue is worth doing. An issue that is worth doing gets a spec. A change that has
no issue gets one first, and is then scoped like any other.

**Why this priority**: the one-folder rule and one PR per story both assume every built change has a spec and an
issue number.

**Independent Test**: drive a run to the premise pause and check the options and the report check; run the new
form with a stand-in `gh` and check the call that creates the issue and the run that follows.

**Acceptance Scenarios**:

1. **Given** a new scope, **When** the run pauses at premise, **Then** the options are `write the spec` and
   `not worth doing`, and nothing else.
2. **Given** a premise report or a resume whose pick is `no spec needed`, **When** it is checked, **Then** it is
   refused, and the message names the two outcomes.
3. **Given** the pick `not worth doing`, **When** the run completes, **Then** the issue is closed as not planned with
   the reason, as today, and no folder is created.
4. **Given** `untracked "<what changes>"`, **When** the skill runs, **Then** it creates one issue in the repo
   `origin` names, with a title and body from the text and one of that repo's issue types, the text passed through
   a file and never on a command line; then it scopes the new issue as `#<new issue>`, premise first.
5. **Given** GitHub refuses to create the issue, **When** the skill runs, **Then** it stops, starts no run, and the
   message names the next step.
6. **Given** the issue was created and a later step fails, **When** the run stops, **Then** the message names the
   issue it created.

---

### User Story 3 - The spec lands through its own reviewed PR (Priority: P1)

A new scope works on branch `<issue>-spec`, in its own worktree from the default branch, and ends with a draft PR
that has been through the internal review round. A rescope edits the spec in the PR it is run from. The story
numbers that branches and PRs name do not move.

**Why this priority**: under the engineering workflow the spec is agreed before code is written, and stories are
named by number from then on.

**Independent Test**: run a new scope and a rescope with stand-ins for the agent, `git` remote and `gh`; check the
branch, its base, the worktree path, the PR body, the review launch, and the story-number check.

**Acceptance Scenarios**:

1. **Given** `#79` in a repo whose default branch is `main`, **When** the skill starts, **Then** it creates branch
   `79-spec` from `origin/main` in worktree `.claude/worktrees/79-spec`, and the run's project is in that worktree.
2. **Given** branch `79-spec` already exists, locally or on `origin`, **When** a new scope of #79 starts, **Then** it
   is refused before anything is written, and the message names the branch and the rescope form.
3. **Given** a new scope that completed, **When** the skill ends, **Then** the spec folder is committed and pushed
   on `79-spec`, a draft PR into the default branch is open whose body starts `Part of #79`, and the internal
   review round has been launched with `spec: null`, before the GitHub review loop.
4. **Given** a spec.md with a story heading that is not `### User Story <N> - <title> (Priority: P<n>)`, or two
   stories with one number, **When** the run checks it, **Then** it fails, naming the heading.
5. **Given** a rescope run from a story's worktree, **When** it completes, **Then** the spec edit is committed and
   pushed on that worktree's branch, and no other branch or PR is created.
6. **Given** a rescope of a spec with stories 1 to 3, **When** the rescoped spec.md drops story 2's heading, keeps
   1 and 3, and adds a story, **Then** the run goes on only if the new story is numbered 4. A new story numbered 2,
   or a renumbered story, fails the run, naming the numbers.
7. **Given** a run that fails or is rejected, **Then** nothing is committed, pushed or opened.

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

### Edge Cases

- `specs/079-x` for #79: refused. The number is the issue's number as GitHub writes it, with no padding.
- `specs/79-x` for #7: refused. The prefix checked is `7-`, with its hyphen.
- A short name with capitals, underscores, spaces, or nothing after the hyphen: refused by the folder check.
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
- **FR-002**: `/alq-plan:issue-spec` MUST pick `<short-name>` once, at the start of a new scope, as 2 to 4 words of
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

**Every built issue has a spec (Story 2)**

- **FR-006**: The premise MUST offer `write the spec` and `not worth doing` only, in the workflow's gate,
  `premise_report.py` and the skill. `no spec needed` MUST be refused wherever a pick is read.
- **FR-007**: `not worth doing` MUST close the issue as today, and create no folder.
- **FR-008**: `/alq-plan:issue-spec` MUST take a third form, `untracked "<what changes>" [<dir>]`, and name all three
  forms when it refuses anything else.
- **FR-009**: On `untracked`, the skill MUST create one issue in the repo `origin` names, with a title and body from
  the text and one of the issue types that repo offers, the text through a file and never on a command line. It
  MUST then scope that issue as `#<issue> [<dir>]` does. A failed create MUST stop with no run started; a failure
  after it MUST name the issue created.

**The spec PR (Story 3)**

- **FR-010**: A new scope MUST create branch `<issue>-spec` from the default branch as `origin` has it (`gh repo view
  --json defaultBranchRef`), in worktree `.claude/worktrees/<issue>-spec` of the repo, with `--no-track`, and run
  there. A branch `<issue>-spec` that exists locally or on `origin` MUST refuse the new scope, naming the branch and
  the rescope form.
- **FR-011**: A completed new scope MUST commit the spec folder, push the branch, open a draft PR into the default
  branch whose body starts `Part of #<issue>`, and launch `alq-review:review-round` with `spec: null` and stage
  `internal`, then the GitHub review loop. With alq-review not installed the skill MUST stop after the PR and say
  so. Its last message MUST give the spec folder, the branch and the PR.
- **FR-012**: A rescope MUST work in the worktree it is run from, and commit and push the spec edit on that
  worktree's branch. It MUST create no branch, worktree or PR.
- **FR-013**: The workflow MUST check spec.md's story headings with one pure function after every step that writes
  spec.md: each is `### User Story <N> - <title> (Priority: P<n>)`, and no number is used twice. On a rescope it
  MUST also check, against spec.md as the run found it, that every number not there before is greater than every
  number that was. Numbers that were there may be dropped, and are not reused.
- **FR-014**: A run that fails or is rejected MUST commit, push and open nothing.

**Existing folders (Story 4)**

- **FR-015**: After #68 and #83 merge, `dev/alq-review/specs/` 004, 007, 008, 009, 010, 011, 012, 014, 015, 016 and
  017 MUST be deleted, with every citation of them in the repo.
- **FR-016**: 019 MUST be renamed `63-split-planning-plugin`, and every citation of the old name, by path or as
  `spec 019`, MUST name the new folder.
- **FR-017**: `README.md` MUST state the rule, `specs/<issue>-<short-name>/`, one per issue, in place of
  `specs/<nnn>-<feature>/`.

**Tests**

- **FR-018**: Tests MUST be written first and seen to fail for the reason expected, in `dev/alq-plan/tests`. Fixtures
  named `specs/001-demo` and `specs/001-new` MUST be named by their issue.

### Key Entities

- **Spec folder**: `specs/<issue>-<short-name>/`, beside a committed `.specify/`. One per issue in a project.
- **Folder input**: the run's one folder, picked by the skill or named by a rescope, checked once, and the only
  source of the folder for every step.
- **Spec branch and PR**: `<issue>-spec`, from the default branch; its draft PR's body starts `Part of #<issue>`.
- **Issue**: in the repo `origin` names. For `untracked`, created by the skill.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every folder a run creates is `specs/<issue>-<short-name>` for the run's issue, in every run of the
  alq-plan suite.
- **SC-002**: A second scope of an issue, by folder or by branch, and a rescope of another issue's folder are refused
  before anything is written: every case in the suite.
- **SC-003**: A run whose `specify` writes any folder but the one given fails: 0 such runs complete.
- **SC-004**: No run completes on `no spec needed`.
- **SC-005**: Every completed new scope ends with a pushed `<issue>-spec` branch, a draft PR starting
  `Part of #<issue>`, and a launched internal review round.
- **SC-006**: After Story 4, 0 folders under `dev/*/specs/` are named by a Spec Kit number, and 0 citations of an old
  name remain outside git history and this spec.
- **SC-007**: CI is green.

## Assumptions

- The one-folder check sees the `specs/` of the run's project. The repo's other Spec Kit projects are not searched.
- The `needs-spec` premise question stays as it is. With `no spec needed` gone, no stop pick rests on it; whether
  to drop it was not asked.
- `untracked` takes an optional `<dir>`, as `#<issue>` does, so the folder can land in a project under the checkout.
- The skill asks the user to confirm the title, body and issue type before it creates the issue: it writes to
  GitHub for the user.
- A rescope runs no review of its own: the spec edit is reviewed in the PR it lands in, whose spec hold (alq-review
  ADR-0016, decision 6) the user releases.
- Whether the headless agent of `specify` honours `SPECIFY_FEATURE_DIRECTORY` from its environment, or needs it in
  its arguments, was not run. FR-005's check holds the folder either way.
- Out of scope: how alq-build finds and uses the folder (#82); review's story contract (#81); rounds before a PR
  exists (#70).

## Why this is worth doing

### harm
Answer: Nothing ties a spec folder to its issue, an issue can get two folders, a scope can end with no spec at all, and the spec lands with no PR or review. Under the engineering workflow, branches and PR headers name a spec folder and story that planning never guarantees.
Source: code: plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml (premise, specify, select-spec), plugins/alq-plan/skills/issue-spec/SKILL.md step 8

### reachable
Answer: observed. A rescope of specs/001-demo for issue 7 runs to grill, no spec needed completes with no folder, and the 15 folders in dev/alq-review/specs/ are numbered by Spec Kit, not by issue.
Source: reproduction: python3 -m unittest in dev/alq-plan/tests at 74251bf on 2026-10-12; ls dev/alq-review/specs

### change-alters
Answer: Yes. The folder is named from the issue and checked before and after specify, a second scope is refused, every built issue gets a spec, and the spec reaches the default branch only through a reviewed PR.
Source: user: issue #79, "Decided"

### owner
Answer: No. select-spec checks only the path's shape and spec.md; nothing checks the folder against the issue, the story headings, or that a spec was reviewed before code.
Source: code: plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml, plugins/alq-plan/skills/issue-spec/SKILL.md

### inherited
Answer: Yes. alq-plan ADR-0001 and ADR-0005 accept folders without the issue number and more than one folder per issue; ADR-0006 keeps no spec needed; ADR-0005 has a run post nothing and open no PR. ADRs 0007 to 0009 end or supersede those.
Source: code: dev/alq-plan/docs/adr/0001-keep-the-spec-in-the-spec-folder-that-planning-writes.md, dev/alq-plan/docs/adr/0005-have-the-skill-that-shapes-an-issue-read-and-write-the-spec-in-its-spec-folder.md, dev/alq-plan/docs/adr/0006-close-an-issue-not-worth-doing-and-post-nothing-for-one-that-needs-no-spec.md

### needs-spec
Answer: It has decisions in it: the folder form, one folder per issue, the two outcomes, the untracked form, the spec PR and the migration. The user settled them in issue #79.
Source: user: issue #79, "Decided"

## Root cause

Observed: a rescope of `specs/001-demo` for issue 7 runs to grill
(`test_a_rescope_start_pauses_at_grill_on_the_given_folder_with_the_issue_as_its_spec`, run 2026-10-12 in
`dev/alq-plan/tests`), and `016` in `dev/alq-review/specs/` scopes #35.

The folder's name is decided by Spec Kit, not by planning. The workflow's `specify` step names no folder, so
`speckit.specify` falls back to `feature_numbering`: the next free 3-digit number and a short name of its own. The
wrong decision is made in `plugins/alq-plan/speckit/workflows/alq-spec/workflow.yml`, at `specify`, which passes no
folder, and at `select-spec`, which takes any `specs/<feature>` for any issue. The skill's step 8 ends the run on a
pushed branch with no PR, so nothing downstream sees the spec reviewed, and the premise's `no spec needed` lets an
issue be built with no spec.

- **Other callers**: `drive_workflow.py start`, which passes no folder on a new scope (verified: the Premise tests
  start a new scope with no folder); `/alq-build:issue-tackle`, which builds against any folder with a `spec.md`
  (predicted, read); alq-review's shape check, which accepts any folder under `specs` (predicted, read).
- **Examined and ruled out**: Spec Kit's `create-new-feature.sh --number`. It pads the number to three digits and
  `speckit.specify` does not call it, so it cannot give `79-`.
- **Not investigated**: whether the headless agent honours `SPECIFY_FEATURE_DIRECTORY` from its environment; a full
  run with the real agent.
