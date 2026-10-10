# Feature Specification: Split alq-review into review, plan and build plugins

**Feature Branch**: `refactor/63-split-planning-plugin` (#63)

**Created**: 2026-10-09

**Status**: Draft

**Input**: User description: "Issue 63" (issue #63, "Move planning (alq-spec) out of alq-review into its own plugin")

**Settled with the user (2026-10-09)**: three plugins, none of which requires another; review is told the spec
folder when a round is launched instead of reading it from the issue; the issue location comment is dropped. See
Clarifications.

## Clarifications

### Session 2026-10-09

- Q: Which plugin requires which? → A: None requires another. Any dependency left is flagged here (FR-020).
- Q: How does review learn the spec of a change? → A: The caller passes `spec` at every review-round launch: a spec folder path from the repo root, or `null` for a change with no spec; no reason is taken. A launch with no `spec` key is refused. Repo, branch, PR and base are read from git and GitHub, never passed. Review verifies the folder in HEAD and records, at the PR's first round, the value and, for a folder, the git blob id of its `spec.md` in HEAD (FR-005 to FR-008; ADR-0016).
- Q: Does review validate the spec folder? → A: No. It reads only `spec.md` and refuses when it is missing or empty. The settled-design check leaves review; planning checks its own output (FR-010, FR-011).
- Q: What does the reviewer prompt assume about `spec.md`? → A: No headings. It asks for every requirement the spec states that the change does not meet (FR-012).
- Q: How is a RESHAPE_SPEC lock answered? → A: Only by `unlock <ref>`. Review prints the ruling and the bound spec folder; the user then runs planning's rescope with the folder (FR-013).
- Q: What happens to `spec_checks`, `design_documents` and the design-document rule? → A: Deleted (FR-014). Past `gate.log` lines are kept. That a log line does not name the check that decided it is issue #67.
- Q: Where do `alq-issue-tackle` and `alq-root-cause-check` go? → A: Into a third plugin, `alq-build`. `alq-issue-tackle` takes `spec` like review and calls the root-cause check; it does not name planning's command (FR-015 to FR-017).
- Q: Names? → A: `alq-plan` with `/alq-plan:issue-spec`, and `alq-build` with `/alq-build:issue-tackle` and `/alq-build:root-cause-check`. Hyphens, not underscores.
- Q: Tests? → A: Each plugin's suite in its own `dev/<plugin>/tests/`; the two-line `git` helper is copied per suite; tests of the location comment are deleted (FR-022).
- Q: Specs, ADRs, constitution? → A: Each plugin gets its own `dev/<plugin>/` with its own constitution and ADR log. An existing ADR that binds a new plugin gets a new ADR there, decided for it, not copied. Which ones is a plan step (FR-023).
- Q: Old installs and runs in progress? → A: No compatibility. A run started under the old layout fails loudly and is started again (FR-024).
- Q: When is `spec` passed, and in what order do the changes ship? → A: On every review-round launch. The rule file that tells agents how to launch a round gains `spec` and merges before the code (FR-006, FR-025).
- Q: `alq-build` without `alq-review`? → A: `alq-issue-tackle` stops before the PR and says the review step needs `alq-review` (FR-018).
- Q: Root-cause verdicts `alq-issue-tackle` does not handle today? → A: AT CAUSE goes on to mark the PR ready; CANNOT TELL stops, says which case and what would resolve it, and leaves the PR a draft; with `spec: null` the check does not run (FR-017).
- Q: Is the issue location comment still needed? → A: No. Nothing reads it once `spec` is passed. A "not worth doing" premise pick closes the issue as not planned, with the reason (FR-019).
- Q: The bot's issue picker and the `alq-claude-bot-assign` skill, outside this repo, start work from an issue number and find the spec through the location comment. How do they get the spec once it is gone? → A: Out of scope for this feature.
- Q: Which branch does `issue-tackle` work on when given a spec folder? → A: The caller passes `branch` with `spec`. `issue-tackle` works on that branch and stops if `spec.md` is not in its HEAD. Planning's last message gives the folder and branch (FR-015, FR-019).
- Q: How is a PR's recorded spec changed? → A: The recorded value is not. The caller names the right spec; there is no command to change it (FR-008).
- Q: What if `spec.md` changes after the first round? → A: The PR is held as a RESHAPE_SPEC ruling holds it, and the refusal shows the diff from the bound text to HEAD's. Only the user's `unlock <ref>` releases it, whether or not a ruling asked for the change; the next launch binds `spec.md` as HEAD then has it (FR-009; ADR-0016).
- Q: What does a rescope start from? → A: The spec folder and the issue: `rescope <spec folder> #<issue>`, both required. The folder may hold the wrong scope, so the issue is re-read for the problem as first stated; the folder is the one the PR is bound to and is rewritten in place (FR-021).
- Q: A PR bound to `spec: null` is ruled RESHAPE_SPEC. What then? → A: The PR is closed and the work restarts on a new PR bound to a new spec; the `unlock` reply says so (FR-013).

## Terms

- **Review plugin**: `alq-review`: review rounds, commit checks and merge gates.
- **Plan plugin**: `alq-plan`: scopes an issue into a spec folder (`/alq-plan:issue-spec`).
- **Build plugin**: `alq-build`: implements an issue against its spec (`/alq-build:issue-tackle`, `/alq-build:root-cause-check`).
- **Spec folder**: `specs/<feature>/`, a folder whose parent is named `specs` (ADR-0016).
- **Spec binding**: what is recorded for a PR at its first review round: the `spec` value, a spec folder or `null`, and for a folder the git blob id of its `spec.md` in HEAD.
- **Settled-design check**: the check that `plan.md` lists its mechanisms, each citing a `research.md` decision with Decision, Rationale and Existing tools filled in.
- **Location comment**: today's comment on an issue that names its spec folder (ADR-0008). This feature removes it.

## Today

Run on 2026-10-09 against main at `7179e9e`. "Read" means read in the code and not run.

- All of planning and building ships inside `plugins/alq-review/`: the `alq-spec` skill and its driver, the Spec Kit preset and workflow, `alq-issue-tackle`, `alq-root-cause-check`, and the scripts `speclocation.py`, `settled_design.py`, `premise_report.py` and `rootcause.py`.
- Review learns the spec from the issue. It takes the issue number from the branch name (`^[a-z]+/(\d+)-`), reads the issue's location comment, and quotes that folder's `spec.md` from HEAD into each reviewer's and the assessor's prompt. A branch whose name has no issue number gets no spec and no message (read).
- At the first internal round the gate runs the settled-design check on every spec folder the branch changes, which need not be the folder the comment names (read).
- Planning runs the same scripts through `$ALQ_REVIEW_ROOT/scripts/`, which its driver sets to review's folder. The dependency runs both ways.
- Run: a scratch copy of the plugin with `speclocation.py` and `settled_design.py` removed stops `gate.py` at import (`ModuleNotFoundError`, through `briefs.py`), exit 1. Claude Code's hook documentation says only exit 2 blocks, so such a gate enforces nothing (read in the documentation, not run in Claude Code).
- Run: `gate.py` given a payload it cannot handle prints `alq-review gate failed open … KeyError` and exits 0. An error the gate does not turn into a refusal lets the action through.
- The reviewer prompt asks for each unmet "Acceptance criterion" and bounds requests by the spec's "Out of scope" (`briefs.py:65-66`). The spec template has neither heading.
- A RESHAPE_SPEC lock is released by `unlock <ref>` or by `/alq-review:alq-spec rescope <ref>`. The second hands the ruling to the planning skill, which parses it by its labels (read).
- `spec_checks` and `design_documents` in `config.json` are read only by the settled-design check's call in the gate (`gate.py:428`, `:505`).
- `alq-issue-tackle` runs the internal review round, then the root-cause check. It says what to do on AT SYMPTOM and SPEC WRONG, and nothing on AT CAUSE or CANNOT TELL. Nothing in code makes it run the check or reads the verdict.
- All tests are one suite in `dev/alq-review/tests/`. Planning's tests import review's test helpers (`test_gate`, `test_worktree_facts`).
- Claude Code's plugin documentation (read 2026-10-09) lets a plugin declare `dependencies` that install with it. It does not say how a plugin reaches another plugin's files.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Review is told the spec and reads only what it needs (Priority: P1)

An agent launching a review round says which spec the change implements. Review checks the folder is there, gives
its path to the reviewers and the assessor, who read its `spec.md`, and keeps the same spec for every later round of that PR.

**Why this priority**: it removes review's reliance on anything planning writes, which is what lets the plugins
split. It also ends the silent pass of a branch with no issue number.

**Independent Test**: launch review rounds through the gate's hook handlers with each kind of `spec` value and check what is refused, what is said, and what the prompts contain.

**Acceptance Scenarios**:

1. **Given** a launch with no `spec` key, **When** the gate handles it, **Then** it is refused, and the message gives the full call with `spec`.
2. **Given** `spec` names a folder whose parent is not `specs`, or that has `..`, or whose `spec.md` is missing or empty in HEAD, **When** the gate handles it, **Then** it is refused and the message names the failed step.
3. **Given** a valid folder, **When** the round launches, **Then** each reviewer's prompt and the assessor's brief give that folder's path, and quote nothing of its `spec.md`.
4. **Given** `spec: null`, **When** the round launches, **Then** it runs with no spec.
5. **Given** a PR whose first round recorded a spec, **When** a later launch passes a different value, **Then** it is refused. The bound value never changes.
6. **Given** two PRs on one issue, **When** each launches with its own spec folder, **Then** each is reviewed against its own.
7. **Given** a PR bound to a folder whose `spec.md` in HEAD differs from the bound text, **When** a round is launched, **Then** it is refused with the diff from the bound text to HEAD's, and the PR is held as a RESHAPE_SPEC ruling holds it. **When** the user types `unlock <ref>` and a round is launched again, **Then** it opens and `spec.md` as HEAD has it becomes the bound text.

---

### User Story 2 - Planning runs from its own plugin (Priority: P1)

A maintainer scopes an issue with `/alq-plan:issue-spec #<issue>` and gets the same steps, pauses and spec folder as today, with nothing installed but `alq-plan`.

**Why this priority**: it is the request: planning out of review.

**Independent Test**: install only `alq-plan`, run `#<issue>` to `completed` on a throwaway issue, and compare the spec folder with a run on main.

**Acceptance Scenarios**:

1. **Given** only `alq-plan` installed, **When** the user starts `#<issue>`, **Then** the workflow runs premise, specify, grill, plan, critique and tasks in that order and pauses where it pauses today.
2. **Given** a completed run, **When** it ends, **Then** the spec folder is committed and pushed, it has passed the settled-design check, nothing is posted on the issue, and the last message gives the spec folder and its branch.
3. **Given** the premise pick `not worth doing`, **When** the run completes, **Then** the issue is closed as not planned with the reason.
4. **Given** the premise pick `no spec needed`, **When** the run completes, **Then** nothing is posted and the user is told to pass `spec: null` when the work is reviewed.
5. **Given** a spec folder that needs re-scoping, **When** the user runs `/alq-plan:issue-spec rescope <spec folder> #<issue>`, **Then** the run starts at grill on that folder, with the issue's title and description re-read from GitHub and the open decision taken from the conversation.

---

### User Story 3 - Build runs from its own plugin (Priority: P2)

A maintainer implements an issue with `/alq-build:issue-tackle <n>`, passing the spec and the branch it is on, and the root-cause check runs before the PR is marked ready.

**Why this priority**: it moves the last two skills out of review and removes their reading of the location comment.

**Independent Test**: run `issue-tackle` with each plugin set and each root-cause verdict, and check where it stops.

**Acceptance Scenarios**:

1. **Given** a spec folder and a branch, **When** `issue-tackle` starts, **Then** it works in `.claude/worktrees/<n>` on that branch, and stops before writing code when `<spec>/spec.md` is not in that branch's HEAD.
2. **Given** `alq-build` and `alq-review` installed, **When** `issue-tackle` reaches its review step, **Then** it launches the internal round with the same `spec` it was given.
3. **Given** `alq-review` is not installed, **When** `issue-tackle` reaches its review step, **Then** it stops, says the step needs `alq-review`, and opens no PR.
4. **Given** a verdict of AT CAUSE, **Then** it goes on to mark the PR ready. AT SYMPTOM: back to implementing. SPEC WRONG: no more code, and the user is told what the trace got wrong. CANNOT TELL: it stops, says which case and what would resolve it, and leaves the PR a draft. No verdict, because the Root cause section reads `Not a defect report.`: it goes on to mark the PR ready.
5. **Given** `spec: null`, **When** it reaches the root-cause step, **Then** the check does not run.

---

### User Story 4 - A RESHAPE_SPEC lock has one way out (Priority: P2)

When a round is ruled RESHAPE_SPEC, the user releases the branch with `unlock <ref>` and re-scopes with planning, as two steps.

**Why this priority**: the old shortcut tied review to planning's command, and released the lock even when nothing could re-scope.

**Independent Test**: lock a branch with a RESHAPE_SPEC ruling and type each command.

**Acceptance Scenarios**:

1. **Given** a RESHAPE_SPEC lock, **When** the user types `unlock <ref>`, **Then** the branch is released and the reply gives the open decision, why, the spec gaps and the bound spec folder.
2. **Given** a RESHAPE_SPEC lock, **When** the user types `/alq-review:alq-spec rescope <ref>` or any planning command, **Then** the lock is not released.
3. **Given** a RESHAPE_SPEC lock on a PR bound to `spec: null`, **When** the user types `unlock <ref>`, **Then** the reply gives the open decision and says the PR is to be closed and the work restarted on a new PR bound to a new spec.

---

### User Story 5 - Nothing that worked breaks silently (Priority: P2)

Tests, CI and existing projects keep working, or fail loudly with a next step.

**Why this priority**: a split that leaves a plugin half-loaded or a check silently skipped is worse than no split.

**Independent Test**: run CI; import every script of each plugin from a copy holding only that plugin; resume a run started under the old layout.

**Acceptance Scenarios**:

1. **Given** the change, **When** CI runs, **Then** every suite under `dev/` passes, each in the folder of the plugin it tests.
2. **Given** a copy holding one plugin, **When** each of its scripts loads, **Then** none fails for a missing file of another plugin.
3. **Given** a Spec Kit run started under the old layout, **When** it is resumed, **Then** it fails with an error, not a silent pass.

---

### Edge Cases

- `spec` names a folder that exists in the working tree but is not committed: refused, because HEAD is what is reviewed.
- `spec` names a spec folder of another Spec Kit project in the same repo: accepted, since only the folder's shape and its `spec.md` are checked.
- The spec folder is deleted on the branch after the first round (for example retired): later rounds read the recorded binding and refuse when `spec.md` is gone from HEAD.
- `spec` is the old-style issue reference or a bare feature name: refused by the shape step.
- A RESHAPE_SPEC ruling is unlocked and the user rescopes the spec: the next launch finds `spec.md` changed and holds the PR again; that change needs its own `unlock`.
- `spec.md` gets only a typo fix after the first round: the PR is held all the same until the user unlocks it.
- A reading error that is not "missing or empty" (git fails, permissions): refused with the error, never passed to the gate's top-level handler, which lets actions through.
- An agent follows the old rule text and launches without `spec` after the code ships: refused, and the message gives the call to make.
- `alq-plan` alone and an issue that was already scoped: it scopes again, and nothing stops it. More than one spec folder per issue is allowed.
- The root-cause check finds no `## Root cause` section because planning's template changed: CANNOT TELL, which stops `issue-tackle`.

## Requirements *(mandatory)*

### Functional Requirements

**Plugins**

- **FR-001**: The marketplace MUST list three plugins: `alq-review`, `alq-plan` and `alq-build`. None MAY declare another as a dependency.
- **FR-002**: `alq-review` MUST ship no planning or building file: no planning skill, driver, preset, workflow, `speclocation.py`, `settled_design.py`, `premise_report.py`, `rootcause.py`, `alq-issue-tackle` or `alq-root-cause-check`.
- **FR-003**: No script, skill or workflow MAY reach another plugin's files by path. Each plugin's scripts MUST load from a copy holding only that plugin.
- **FR-004**: No message in any plugin MAY name a command that plugin does not ship, with two exceptions: `issue-tackle`'s launch of `alq-review`'s review round (FR-015), and FR-018's message naming `alq-review` as missing.

**Review: the spec binding**

- **FR-005**: A review-round launch MUST carry `worktree` and `spec`. `spec` is a folder path from the repo root, or `null` for a change with no spec, which launches with no spec. No reason is taken. Repo, branch, PR and base are read from git and GitHub in `worktree`.
- **FR-006**: A launch with no `spec` key MUST be refused with a message that gives the full call.
- **FR-007**: A folder MUST be verified against HEAD, in order: the path is relative, has no `..` and its parent is named `specs`; `<folder>/spec.md` is in HEAD and not empty. Any failure MUST refuse and name the step.
- **FR-008**: The first round of a PR MUST record its `spec` value in the PR's ledger and, for a folder, the git blob id of its `spec.md` in HEAD. A later launch with a different value MUST be refused. Nothing changes the recorded value. Every round and assess-round MUST take the spec from the record. Reviewers and the assessor are given the folder's path and read its `spec.md` themselves; nothing of it is quoted to them.
- **FR-009**: When `spec.md` in HEAD at a launch differs from the bound text, the launch MUST be refused with the diff from the bound text to HEAD's, and the PR MUST be held as a RESHAPE_SPEC ruling holds it. Only the user's `unlock <ref>` MAY release it, whether or not a ruling asked for the change. The first launch after that unlock MUST bind `spec.md` as HEAD then has it. In `log` mode the launch is logged as a would-deny, the binding stays as it was, nothing is held, and the round opens.
- **FR-010**: Review MUST read only `spec.md` from the folder. Every read failure MUST become a refusal that names the file; none MAY reach the gate's top-level error handler.
- **FR-011**: Review MUST NOT run the settled-design check or any other check of the spec folder's contents.
- **FR-012**: The reviewer prompt MUST name no spec headings. It asks for every requirement the spec states that the change does not meet, and bounds requests by what the spec excludes.
- **FR-013**: A RESHAPE_SPEC lock MUST be released only by the user's `unlock <ref>`. Its reply MUST give the open decision, the rationale, the spec gaps and the bound spec folder. When the PR is bound to `spec: null`, the reply MUST instead say the PR is to be closed and the work restarted on a new PR bound to a new spec. The rescope prompt MUST NOT release a lock.
- **FR-014**: `spec_checks`, `design_documents`, the refusal they govern and the design-document rule MUST be deleted. The spec refusals of FR-006, FR-007, FR-009 and FR-010 fall under the plugin's `mode`.

**Build**

- **FR-015**: `alq-build` MUST hold `issue-tackle` and `root-cause-check`. `issue-tackle` MUST take `spec` in the same form as review and pass the same value to the review round. With a spec folder it MUST also take `branch`, work in `.claude/worktrees/<n>` on that branch, and stop before writing code when `<spec>/spec.md` is missing or empty in that branch's HEAD. With `spec: null` it creates its own branch by the branch-naming rules.
- **FR-016**: `issue-tackle` MUST NOT read any issue comment for the spec and MUST NOT name a planning command.
- **FR-017**: After the review round `issue-tackle` MUST run `root-cause-check` unless `spec` is `null`, and act on its verdict: AT CAUSE, on to marking the PR ready; AT SYMPTOM, back to implementing; SPEC WRONG, no more code and the user told what the trace got wrong; CANNOT TELL, stop, say which case and what would resolve it, and leave the PR a draft; no verdict because the Root cause section reads `Not a defect report.`, on to marking the PR ready.
- **FR-018**: With `alq-review` not installed, `issue-tackle` MUST stop before the PR and say the review step needs `alq-review`.

**Plan**

- **FR-019**: `alq-plan` MUST post no comment on the issue. A completed run's last message MUST give the spec folder and the branch it is committed on, and name no command of another plugin. A `not worth doing` pick MUST close the issue as not planned with the reason; `no spec needed` posts nothing and tells the user to pass `spec: null` at review.
- **FR-020**: `alq-plan` MUST own the settled-design check and run it on its own output before a run completes.
- **FR-021**: `alq-plan` rescope MUST take the spec folder and the issue number, both required. It MUST re-read the issue's title and description and rewrite that same folder. It MUST NOT read review's output or look the folder up.

**Repo**

- **FR-022**: Each plugin's tests MUST be in `dev/<plugin>/tests/` and import nothing from another suite. Tests of the location comment and the pin in `test_spec_source.py` that ties `alq-root-cause-check` to `rootcause.py` MUST be deleted.
- **FR-023**: Each plugin MUST have `dev/<plugin>/` with its own Spec Kit project, constitution and ADR log. The inherited organisation principles go into each constitution verbatim. An existing ADR that binds a new plugin MUST be decided again in that plugin's log, not copied. Existing specs and ADRs stay in `dev/alq-review/`.
- **FR-024**: No compatibility with the old layout. A run started under it fails with an error when resumed.
- **FR-025**: The changes MUST ship in this order: (1) the rule file that tells agents how to launch a review round gains `spec`; (2) the alq-review decision records that replace ADR-0008 decision 3 and ADR-0012 decisions 2 and 4; (3) the new plugins' Spec Kit projects, constitutions and decision records; (4) the code, with the README it describes; (5) the alq-review constitution amendment, after the code changes its principles' sources, as its governance requires.

### Key Entities

- **Spec binding**: per PR, recorded at the first round; a folder with the blob id of its `spec.md`, or `null`. The value never changes; the blob id changes only at the first launch after an `unlock` of a changed `spec.md`.
- **Spec folder**: `specs/<feature>/`, its parent named `specs`; may hold `spec.md`, `plan.md`, `research.md` and more. Review reads `spec.md` only.
- **Plugin**: one of `alq-review`, `alq-plan`, `alq-build`; each with its own files, `dev/` folder, constitution, ADRs and tests.
- **Interdependences that remain** (none is an install requirement): `issue-tackle` launches review's round (FR-018 covers its absence); `root-cause-check` reads the `## Root cause` section that planning's template writes (a missing section gives CANNOT TELL); review's reviewers and assessor read `spec.md` that planning writes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `alq-review` ships 0 of the files FR-002 lists.
- **SC-002**: Each plugin's scripts load from a copy holding only that plugin: 0 failures.
- **SC-003**: Every launch with no `spec` key, with a `spec` that fails a step of FR-007, or whose `spec.md` differs from the bound text is refused with the step or the diff named: 100% of the cases in the review suite.
- **SC-004**: A branch with no issue number in its name is reviewed against the spec passed, or refused; never reviewed without a word.
- **SC-005**: A planning run with only `alq-plan` installed completes on a throwaway issue and leaves a spec folder that passes the settled-design check, with 0 comments on the issue.
- **SC-006**: Each root-cause verdict leads `issue-tackle` to the step FR-017 names, in every case tested.
- **SC-007**: 0 messages in any plugin name a command that plugin does not ship, except FR-004's two exceptions.
- **SC-008**: CI is green, with one suite per plugin and 0 imports between suites.

## Assumptions

- Spec folder names need not carry the issue number. A person finds an issue's spec by searching `spec.md` files or from the PR that binds it; nothing guarantees the issue number appears in the spec.
- The old gate rebuilds a round's arguments from `worktree` and `stage` alone, so an extra `spec` is dropped, not refused (read in the code, not run). The rule file can ship first (FR-025).
- That a resumed Spec Kit run uses its own copy of the workflow is the issue's statement and was not checked here.
- Which existing ADRs bind `alq-plan` or `alq-build` is sorted in the plan by reading each. From titles alone the candidates are 0008 and 0012 for `alq-plan`, and 0009 for any.
- Out of scope: what any check decides beyond what is listed here; a field naming the deciding check in `gate.log` (#67); the bot's issue picker and the `alq-claude-bot-assign` skill, which start from an issue number and read the location comment, so they stop finding a spec once this ships.

## Why this is worth doing

### harm
Answer: Nothing fails on main today. The planning skill, its driver and the Spec Kit preset and workflow (638 lines) ship inside the review plugin, so a review install carries them and a change to planning is a release of the review plugin.
Source: code: plugins/alq-review/skills/alq-spec/, plugins/alq-review/speckit/, and the description in plugins/alq-review/.claude-plugin/plugin.json, which names review only

### reachable
Answer: predicted. The planning files are in the review plugin on main; no failure that comes from that has been seen.
Source: code: ls plugins/alq-review/skills plugins/alq-review/speckit on main at e45686f

### change-alters
Answer: A bare move breaks the gate: without speclocation.py and settled_design.py, gate.py stops at import with exit 1, and Claude Code's hook docs say only exit 2 blocks, so the hook would fail open (read in the docs, not run in Claude Code). The plugin manifest can declare a dependency that installs another plugin, but the docs give no way for one plugin to find another's files, and install paths carry the version. So the move removes the coupling only once the question of where the shared modules live is decided.
Source: reproduction: gate.py run from a scratch copy of plugins/alq-review at HEAD with speclocation.py and settled_design.py removed gives ModuleNotFoundError at briefs.py:20 and exit 1; the same copy with both present imports them

### owner
Answer: No. The rule that a hook's script imports only the standard library and the plugin's own files is README prose; no test or CI job checks imports, and test_shipped_tree.py only checks that tests do not ship.
Source: code: plugins/alq-review/README.md:229, dev/alq-review/tests/test_shipped_tree.py

### inherited
Answer: Partly. Accepted ADR-0008 and ADR-0012 decide that the gate reads the spec through the issue's location comment and refuses an unsettled spec folder at the first internal round; they do not say which plugin holds that code. This work follows them and does not reopen them.
Source: code: dev/alq-review/docs/adr/0008-keep-the-spec-in-the-spec-folder-not-in-an-issue-comment.md, dev/alq-review/docs/adr/0012-find-spec-folders-by-spec-kit-s-mark-and-keep-no-list-of-design-documents.md

### needs-spec
Answer: It has decisions in it. The issue lists nine decisions needed before it can be built and calls the first the blocker, so the request does not fix the outcome.
Source: user: issue #63, "Decisions needed before this can be built"

## Root cause

Not a defect report.
