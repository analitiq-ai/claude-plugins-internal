# Feature Specification: core, the shared package every Codeworks component imports

**Feature Branch**: `145-spec`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/145 — core: the shared package every Codeworks component imports. Build `core/`, the package that holds the code more than one component runs (root ADR-0001 d2). Each plugin installs it into its `${CLAUDE_PLUGIN_DATA}`, pinned to the plugin's version; the orchestrator imports it the same way and imports no plugin code. It holds: the state module, the validator modules, the threads module, the contracts, story identity, DONE and the App tokens."

## Clarifications

### Session 2026-10-21

- Q: Where is core installed from, and how is its version set? → A: superseded by Session 2026-10-22 (plan rulings): core ships inside each plugin that runs it; no core tag, no install.
- Q: Who returns a review thread as a finding? → A: each validator module returns its own vendor's threads; the threads module returns only threads started by reviewers that have no enabled module.
- Q: Where is the session App's key? → A: `~/.config/codeworks/session-app.pem`, mode 0600 (root ADR-0008 d4); where it sits and who holds its ID, superseded by Session 2026-10-26.
- Q: How does the work split into stories? → A: the stories as written, each its own sub-issue, branch and PR; US1 lands first because it proves the path every later module ships by.
- Q: Where does the DeepSource module read from? → A: superseded by Session 2026-10-26 (rulings): the DeepSource module is a package in `validators/`, with its own spec.
- Q: Does a module's vendor also have to be listed in `trusted_reviewers`? → A: no; enabling a module trusts its vendor, and `trusted_reviewers` lists only reviewers with no module.

### Session 2026-10-21 (critique)

- Q: Who writes the state comment, the rescope hold included? → A: reviewer's hook alone, as the `codeworks-reviewer` App; core exposes no state write as a command (root ADR-0008; reviewer ADR-0011 d1, d4, ADR-0013 d5; PR #146).
- Q: Where is the reviewer App's key? → A: `~/.config/codeworks/reviewer-app.pem`, mode 0600, read only by hooks; where its ID and login sit, superseded by Session 2026-10-26.
- Q: How does a session's token reach gh? → A: a hook mints it through core into a gh config folder the model can read but not write, and mints a fresh one before the hour: the orchestrator's `SessionStart` hook on the agent machine; no command prints a token (root ADR-0007 d2). Planner's token, superseded by Session 2026-10-26.
- Q: How is a finding with no thread pushed back? → A: every finding carries a stable `key`, and the snapshot records each pushback by that key (root ADR-0003 d7).
- Q: What does the required-checks reader return when the base branch's rules require no check? → A: COULD_NOT_RUN, never PASS; required checks come from rulesets only (orchestrator ADR-0009 d2).

### Session 2026-10-22 (records merged in PR #147)

- Q: Is CI a validator module? → A: no. A module is per external reviewer (root ADR-0003 d1), and the orchestrator writes a `<module>-review` for each (orchestrator ADR-0008 d3); a CI module's `ci-review` would be a required check waiting on itself. The ruleset requires CI's checks directly (orchestrator ADR-0009 d2), so core reads them through a required-checks reader, not a module.
- Q: Is a deleted state comment detected? → A: yes. GitHub records the deletion of another account's comment as a `comment_deleted` timeline event naming that comment's author, and no token removes it; a reviewer App comment deleted after the newest snapshot holds the story (reviewer ADR-0011 d2). This closes critique finding E2.
- Q: Does core check the managed settings before reading a key? → A: yes, once for every caller: every read of a file in `~/.config/codeworks/` goes ahead only while the managed settings are in effect (root ADR-0008 d9); the one exempt read, superseded by Session 2026-10-26.
- Q: Which plugins install core in this spec? → A: superseded by Session 2026-10-22 (plan rulings): no plugin carries core in this spec.

### Session 2026-10-22 (plan rulings)

- Q: In what language is core written, and how does it reach a plugin? → A: TypeScript on Node, its contracts Zod schemas with generated JSON Schemas (root ADR-0009). A plugin that runs core code carries a symlink to `core/`, which a plugin install copies into the plugin, and pins core's npm dependencies in its own lockfile, which Claude Code installs with the plugin (root ADR-0001 d2). No core tag, no install hook, no fetch of this repo. Tested on Claude Code 2.1.308: an installed plugin's cache holds a real copy of the linked `core/`.
- Q: Which plugins carry core in this spec? → A: none. A plugin gains the symlink, and its calling scripts move to TypeScript, in the follow-up that first calls core there (root ADR-0009 d2); no Python code calls core. US1 proves the path on a fixture plugin.
- Q: When does a core change reach a plugin? → A: in the plugin's next version: each plugin pins `version`, and Claude Code updates a plugin only when it changes (tested on 2.1.308: a core change with no bump left the installed plugin on the old core; the bump delivered it). So a change to `core/` bumps every plugin that carries core, checked in CI, and plugins sharing a session run one core.
- Q: Where are verdict and outcome values defined? → A: once each, as enums in core's contracts for every set a component other than reviewer reads: round result, round verdict, finding ruling, root cause, check outcome, hold kind (root ADR-0010). Code and JSON Schemas take values only from them.
- Q: Does a CONVERGED_PUSHBACK round attest? → A: yes. `internal-review` is success on a CLEAN or CONVERGED_PUSHBACK round with no open hold (orchestrator ADR-0004 d1); which rounds and commits count, Session 2026-10-23.
- Q: What does a thread's finding carry? → A: also the thread's trusted comments and the id of its latest trusted comment, which identify it across heads (reviewer ADR-0016 d2, d3).
- Q: Does SC-001 cover reviewer's own branch parser? → A: no. It covers the code this spec builds; reviewer's `specbinding._STORY_BRANCH` goes in reviewer's switch to core.

### Session 2026-10-23

- Q: Is a story that has a PR but no reviewer App comment held? → A: no. It has no state and is not held; nothing attests without a passing internal round. The orchestrator's hooks open the draft PR after the first push, before the first round (builder ADR-0003 d1), so holding it would stop every story (reviewer ADR-0011 d2).
- Q: Which comment is a story's state? → A: the newest comment by the reviewer App, whatever its body. If it does not open with the tag it is invalid state and holds the story; an older tagged comment never stands in for it. Only an edit of that newest comment counts as tampering (reviewer ADR-0011 d1, d2).
- Q: How is a DeepSource finding with no thread keyed? → A: superseded by Session 2026-10-26 (rulings): the DeepSource package's spec settles it.
- Q: Are round stage, hold state and a finding's source value sets in core? → A: yes, enums (root ADR-0010): round stage INTERNAL, AUDIT, GITHUB; hold state OPEN, RELEASED; a finding's source, superseded by Session 2026-10-26 (rulings).
- Q: Which rounds attest `internal-review`, and at which commits? → A: the internal review is stage 1. An INTERNAL or AUDIT round that is CLEAN or CONVERGED_PUSHBACK, at the head or at a commit in the head's history, attests it while no hold is open. Later commits and GITHUB rounds (stage 2) never undo it; a rewritten history that drops that commit restarts stage 1 (orchestrator ADR-0004 d1).

### Session 2026-10-26 (records on branch `145-adr-session-design`, commit 77c42c6)

- Q: Where do sessions run, and where is each key? → A: one session at a time per board runs on one dedicated agent machine, started by an admin naming one issue, `/codeworks <issue>`; nothing picks an issue on its own. The session, orchestrator and reviewer App keys and the validator packages' tokens sit in `~/.config/codeworks/` there. planner runs on the admin machine as its own App, `codeworks-planner`, whose key, `~/.config/codeworks/planner-app.pem`, mode 0600, sits only there (root ADR-0008 d1, d2, d4; root ADR-0007 d4). No session App key sits where planner runs.
- Q: Which hook mints which App's token? → A: the orchestrator's SessionStart hook mints the session App's token, now read-only (root ADR-0007 d1, d2), and the orchestrator's own; reviewer's hook mints its own App's on the agent machine. The planner App's, superseded by Session 2026-10-27 (records of #153).
- Q: Where are the Apps' IDs and logins? → A: every codeworks App's login is a `[shared]` key, because core's reads exclude all four Apps from every trust (root ADR-0007 d5) and the orchestrator and reviewer both read them through core. An App's ID is read only by the hook that mints its token, so it is a key of that hook's component (root ADR-0002 d2): the session and orchestrator Apps' IDs in `[orchestrator]`, the reviewer App's in `[reviewer]`; the planner App's, superseded by Session 2026-10-27 (records of #153). Core's mint takes the ID from its caller.
- Q: How does the DeepSource module pick its source? → A: superseded by Session 2026-10-26 (rulings): the DeepSource package's spec settles it.
- Q: How long does the orchestrator wait before a module is SILENT? → A: `review_timeout`, one `[orchestrator]` key (default 30 minutes) for every module and required check (orchestrator ADR-0001 d8, ADR-0008 d4).
- Q: Whose threads are never findings? → A: any codeworks App's: session, orchestrator, reviewer or planner (root ADR-0007 d5).
- Q: How is a hold released? → A: by one rule, on the orchestrator's claim from Ready: an open hold is releasable when the card's newest move to Ready and an admin's comment on the story issue are both newer than the state comment that placed it; for an escalation hold, that comment must also follow the orchestrator's question. An admin is a writer, a `User` whose role on the repository is admin, maintain or write, other than a codeworks App. An admin's `/codeworks reset` comment makes every hold placed before it releasable and restarts every count. The orchestrator reads the rule to stop a start, reviewer to release, so the rule lives in core's state module (reviewer ADR-0013 d2, d3; orchestrator ADR-0002 d3, ADR-0010 d2). A hold for tampered, deleted or invalid state releases by the same rule, counted from the tampering (reviewer ADR-0011 d2). Which Ready counts, amended by Session 2026-10-27 (records of #153); how an admin is read, amended by Session 2026-10-28 (T044, records of #165).
- Q: Where do the attestation and the module verdicts land? → A: as check runs by the orchestrator App, `internal-review` and each `<module>-review` (orchestrator ADR-0004, ADR-0008 d3). Core's reads feed them; core writes neither.

### Session 2026-10-26 (rulings, records at ab83f33)

- Q: What does core hold of the validators? → A: only the contract between a validator module and its callers, `trigger`, `status` and `findings` with the Findings schema, plus the threads module and the required-checks reader. Each validator module is a package of its own in `validators/<name>/` that owns how it reaches its provider and reads its results, its token included; Codex, CodeRabbit and DeepSource each get their own spec (root ADR-0001 d1, root ADR-0003 d1, d6). A finding's source is `threads`, `required-checks` or a module's folder name, checked by a grammar, not an enum (root ADR-0010 d2).
- Q: When is a module's status PASS or FAIL? → A: only from its provider's reading of that head; until one exists, the head skipped included, PENDING, and SILENT once `review_timeout` passes (root ADR-0003 d1).
- Q: Which Ready counts toward a release? → A: superseded by Session 2026-10-27 (records of #153).
- Q: Does a release change the attestation? → A: a release by an admin's comment lapses it, and a new internal round runs at the head, briefed with that comment; a `/codeworks reset` lapses nothing. It also lapses when the default branch's `spec.md` of the story's spec, a `docs/adr/` folder or `.specify/memory/` differs from those at the round's commit, or a merge of the default branch since the round differs from git's clean merge of its parents (orchestrator ADR-0004 d1; reviewer ADR-0013 d2).
- Q: What does a rescope hold record? → A: the number of the spec PR that placed it; a spec PR its row already records places nothing again, released or not, and a new spec PR places it again (reviewer ADR-0011 d1, ADR-0013 d5).
- Q: Which managed settings does the key gate read? → A: the managed settings file alone, as the one source: it refuses while `/etc/claude-code/managed-settings.d/` or `~/.claude/remote-settings.json` exists (root ADR-0008 d9).
- Q: Does the orchestrator App's permission set change? → A: it adds workflows write (orchestrator ADR-0001 d1).

### Session 2026-10-27 (records of #153)

- Q: Who is the actor this spec called "human"? → A: an admin: a writer, a `User` whose role on the repository is admin, maintain or write, other than a codeworks App (reviewer ADR-0013 d2). The human machine is the admin machine. How an admin is read, amended by Session 2026-10-28 (T044, records of #165).
- Q: Which Ready counts toward a release? → A: any move of the card to Ready on the board `[shared] board` names, whoever made it; a move on another project does not (orchestrator ADR-0002 d1; reviewer ADR-0013 d2).
- Q: Which hook mints the planner App's token, and where is its ID? → A: planner's own hook, on the admin machine, where no other codeworks plugin runs; its read of `planner-app.pem` is the only one exempt from the managed-settings check. The planner App's ID is a `[planner]` key (root ADR-0002 d1, d2; root ADR-0007 d4; root ADR-0008 d2, d9).
- Q: Whose close of a story's issue makes it done? → A: an admin's; otherwise only its PR's merge (root ADR-0005 d5).
- Q: Who opens a story's draft PR? → A: the orchestrator's hooks, after the first push (builder ADR-0003 d1; reviewer ADR-0012).

### Session 2026-10-28 (T044, records of #165)

- Q: How is an admin read? → A: by the author's repository role, the same read that decides an admin's close (FR-011). GitHub computes `author_association` for the reader and hides a private org membership from an App's token. On playground, an org admin's comments read as CONTRIBUTOR to all three Apps, and no release, answer or reset counted (T044, PR #164). MEMBER also covers an org member who can only read (orchestrator ADR-0010 d2, amended).

## Terms

- **Component**: one of the plugins `reviewer`, `planner`, `builder`, `auditor` and `orchestrator`.
- **Validator package**: a validator module in `validators/<name>/`, implementing core's contract for one
  external reviewer (root ADR-0003 d6).
- **Agent machine**: the one dedicated machine, holding no admin GitHub credential and under the managed
  settings, where one Claude Code session at a time runs the orchestrator, builder and reviewer, started by
  an admin naming one issue (root ADR-0008 d1).
- **Admin machine**: where the admin and planner work, outside the managed settings, with no other codeworks
  plugin (root ADR-0008 d2).
- **Story**: one user story, with its own issue `#s`, branch `<s>-us<k>-<slug>` and PR (root ADR-0005).
- **Spec's issue `#p`**: `#s`'s parent issue when it has one, else `#s`. Its spec PR's branch is `<p>-spec`
  and its spec folder the one `specs/<p>-*/`.
- **State comment**: a comment on a story issue tagged `<!-- codeworks:reviewer-state -->` holding the full
  snapshot of the story's rounds and holds (reviewer ADR-0011).
- **Session App**: the `codeworks-session` GitHub App the model's commands act as on GitHub, read-only
  (root ADR-0007 d1).
- **Orchestrator App**: the `codeworks-orchestrator` GitHub App the orchestrator's hooks act as
  (orchestrator ADR-0001 d1).
- **Reviewer App**: the `codeworks-reviewer` GitHub App, issues write alone, that reviewer's hook posts every
  state comment as (reviewer ADR-0011 d1).
- **Planner App**: the `codeworks-planner` GitHub App planner acts as, on the admin machine (root ADR-0007
  d4).
- **Codeworks App**: any of those four. None is ever an admin, writer, trusted or exempt actor (root
  ADR-0007 d5).
- **Admin**: a writer, a `User` whose role on the repository is admin, maintain or write, other than a
  codeworks App (orchestrator ADR-0010 d2; reviewer ADR-0013 d2).
- **Claim**: the orchestrator's move of a story's card from Ready to In progress on the prompt that names
  it; holds are released only then (orchestrator ADR-0002 d2; reviewer ADR-0013 d2).
- **Ready move**: a move of a story's card to Ready on the board `[shared] board` names, whoever made it
  (orchestrator ADR-0002 d1).
- **Could not run**: a check's outcome (COULD_NOT_RUN) when a service it depends on did not answer; never a
  pass and never a finding (root ADR-0004).

## User Scenarios & Testing *(mandatory)*

The "users" of `core/` are the components that import it and the people who operate them. Each story below
is one slice of `core/` a component can call on its own, with its own sub-issue, branch and PR; US1 lands
first because every later story ships through its path.

### User Story 1 - A plugin carries core and reads a story's identity (Priority: P1)

A plugin carries `core/` through a symlink a plugin install copies, then asks it, from a branch name or a
story issue number, for the story's issue, the spec's issue, the spec folder, the story's PR, the requirement
the story is graded against, and whether the story is done. Every component gets the same answer for the
same story because there is one parser.

**Why this priority**: every other module keys on a story's identity, and the orchestrator cannot read any
story without it. It also proves the path every later module ships by.

**Independent Test**: install a fixture plugin carrying `core/` from a fixture marketplace, then call the
identity functions on fixture branch names, issue trees, spec folders and PR lists, and check each answer.

**Acceptance Scenarios**:

1. **Given** a plugin carrying the `core/` symlink in a git-hosted marketplace, **When** it is installed,
   **Then** its installed copy holds `core/` as files and its hook imports core from there.
2. **Given** a commit that changes `core/`, **When** CI runs, **Then** it fails unless every plugin carrying
   core bumped its `version`; **Given** the bump, **When** the plugin updates, **Then** it runs the new core.
3. **Given** one of core's npm dependencies is missing, **When** a hook that runs core code starts, **Then**
   it refuses, naming the package, and runs nothing that needs core.
4. **Given** branch `212-us2-retry-budget`, **When** a component parses it, **Then** it gets story issue
   212 and no other fact from the slug or `2`; **Given** `145-spec`, **Then** it gets spec PR branch of
   spec's issue 145; **Given** `main` or `feature/x`, **Then** it gets "no story" and no story, spec or round.
5. **Given** story issue 212 with parent 200, **When** the spec's issue is derived, **Then** it is 200;
   **Given** story issue 145 with no parent, **Then** it is 145.
6. **Given** spec's issue 200 and exactly one folder `specs/200-*/`, **When** the spec folder is derived,
   **Then** it is that folder; **Given** none or more than one, **Then** derivation fails naming what was
   found.
7. **Given** three PRs over time whose head is `212-us2-retry-budget` in the same repo, and one fork PR
   with that head name, **When** the story's PR is derived, **Then** it is the newest same-repo PR; a PR
   body's `Closes #212` is never read.
8. **Given** a spec folder whose `spec.md` front matter has `codeworks.kind: feature`, **When** the
   requirement is derived, **Then** it is that `spec.md`; **Given** `kind: no_spec`, **Then** it is the
   story issue's body.
9. **Given** a story whose PR merged, **Then** it is done; **Given** an issue an admin closed, **Then** it is
   done; **Given** an issue a codeworks App, or a user who is not an admin, closed with its PR unmerged, **Then** it is not done; **Given** a
   done story whose issue was reopened, **Then** it is still done.

---

### User Story 2 - A component reads and writes a story's reviewer state through one module (Priority: P1)

reviewer's hook records rounds and holds, a rescope hold included, and the orchestrator's hooks read whether a
story is held, what its newest round says and which holds a start releases, all through `core/`'s state
module. The module picks the newest comment written by the reviewer App, holds the story when that state may
have been tampered with, applies the one release rule, and exposes no state write as a command: every write is a library call that posts with the reviewer App token
its caller passes.

**Why this priority**: the orchestrator cannot attest, hold or merge a story without it, and reviewer's
state cannot move off its local ledger onto GitHub without it.

**Independent Test**: against fixture issue comment lists, read the snapshot and its held answer; write a
snapshot and a rescope hold against a recorded GitHub fake and inspect the comment posted.

**Acceptance Scenarios**:

1. **Given** a story issue with three state comments by the reviewer App and newer ones by an admin and by
   the orchestrator App, **When** the state is read, **Then** the newest one by the reviewer App is the snapshot.
2. **Given** the newest comment by the reviewer App was edited after it was posted, **When** the state is
   read, **Then** the story reads as held for tampered state, as by an open hold; **Given** the issue's
   timeline shows a reviewer App comment deleted after the newest reviewer App comment, or after none,
   **Then** the story reads as held for deleted state; **Given** the newest reviewer App comment does not
   open with the tag while an older one does, **Then** the story reads as held for invalid state and the
   older one is not read.
3. **Given** a story with a PR and no reviewer App comment, **When** the state is read, **Then** it has no
   state, is not held, and does not attest.
4. **Given** a snapshot with one open hold and one released, **When** the state is read, **Then** the
   story is held, the open hold's id is named, and the released hold keeps its row.
5. **Given** a story whose state comment does not match the snapshot contract, **When** the state is read,
   **Then** the read fails naming the comment and the contract error, and the story reads as held.
6. **Given** a valid snapshot, **When** reviewer writes a new one, **Then** a new state comment holding the
   full snapshot is posted; no existing comment is ever edited.
7. **Given** a story's state is held for tampered, deleted or invalid state, **When** any writer but the
   release path writes, **Then** the write is refused, naming the hold and its release (an admin's comment and Ready, both
   newer than the tampering).
8. **Given** reviewer's hook places a rescope hold on story issue 212 for spec PR #301, **Then** a new full
   snapshot is posted with an open `rescope-212` row recording 301; **Given** the row records 301, open or
   released, **When** it is placed again for #301, **Then** nothing is posted; **Given** it is released,
   **When** it is placed for a new spec PR #305, **Then** the row is open again, recording 305.
9. **Given** a plugin carrying core, **When** its commands are listed, **Then** core adds none.
10. **Given** a snapshot recording a pushback of finding key K in round 3, **When** the state is read,
    **Then** K is reported as pushed back in that round.
11. **Given** an INTERNAL round CLEAN at commit A and a later GITHUB round DIRTY at head B, no hold open,
    **When** attestation is read at B, **Then** it attests when A is in B's history and does not when a
    rewritten history dropped A. **Given** instead, since A, the default branch's `spec.md` of the story's
    spec, a `docs/adr/` folder or `.specify/memory/` changed from A's, or B holds a merge of the default
    branch that differs from git's clean merge of its parents, or a hold was released by an admin's comment,
    **Then** it does not attest; **Given** the only release since A was by `/codeworks reset`, **Then** it
    attests.
12. **Given** an open hold placed by the state comment of 10:00, an admin's comment at 10:30 and a Ready
    move at 11:00, **When** the holds a start releases are read, **Then** that hold is releasable, and the
    answer names the 10:30 comment as its release; **Given** instead the only newer comment is by a
    codeworks App, or the only newer move to Ready was on another project, or the admin's comment or the Ready move is older
    than 10:00, **Then** it
    is not; **Given** a reader that cannot see the board, **Then** the read fails, naming the board.
13. **Given** an open escalation hold whose question the orchestrator posted at 10:10 and an admin's comment
    at 10:05, **Then** it is not releasable; **Given** an admin's comment at 10:20 and Ready after it,
    **Then** it is.
14. **Given** three open holds and an admin's comment `/codeworks reset` newer than all three, **When** the
    holds a start releases are read, **Then** all three are, and the reset is reported so callers restart
    their counts; **Given** that comment by a codeworks App, **Then** it counts for nothing.
15. **Given** reviewer releases two holds on a claim, **Then** a new full snapshot is posted with both rows
    marked released and every other row unchanged.

---

### User Story 3 - A component reads every external reviewer and required check through one contract (Priority: P2)

The orchestrator's hooks ask each validator module that `[shared] validators` lists to run, ask its status at
a PR's head, and read its findings; reviewer's hook reads the same findings, plus the threads module's and the
failed required checks', for its github round. Each module is a package in `validators/<name>/` that knows
its own provider; core loads it, holds it to one contract and returns every answer in one Findings shape. An
unresolved review thread is a finding only when a trusted reviewer or an enabled module's provider started
it.

**Why this priority**: the orchestrator's external review requests, ready and merge steps, and reviewer's
github round, each need it; it builds on the contracts of US1–US2 but not on the state writes.

**Independent Test**: with a fixture validator package and recorded GitHub responses for one PR head, check
the loaded modules, `trigger`'s call, `status`'s value and `findings`' list against the contract, and the
threads module's and the required-checks reader's answers. No provider's own package is needed.

**Acceptance Scenarios**:

1. **Given** `validators = ["fixture"]` and a package `validators/fixture/` meeting the contract, **When**
   the modules are loaded, **Then** `fixture` is the one module; **Given** a listed name with no folder, a
   name outside the grammar, `threads` or `required-checks`, or a package missing a part of the contract,
   **Then** loading fails naming it.
2. **Given** the module answers PASS or FAIL for the head asked, **Then** its status is that; **Given** its
   answer names another head, or its provider has not read the head, **Then** PENDING; **Given** it answers
   WAIVED, **Then** WAIVED.
3. **Given** a PENDING module and `review_timeout` run since the start its caller passes for that head,
   **When** its status is read, **Then** it is SILENT.
4. **Given** GitHub or the provider does not answer, a check is in `error`, or the module throws, **When** a
   status or findings is read, **Then** the outcome is COULD_NOT_RUN, never PASS, FAIL or an empty findings
   list.
5. **Given** a module's findings that fail the Findings contract or carry a source other than its name,
   **Then** the outcome is COULD_NOT_RUN, naming the module and the error.
6. **Given** a required check concluded `failure` at the head, **When** the required checks' findings are
   read, **Then** it is one finding naming the check; **Given** the check is in `error`, **Then** the outcome
   is COULD_NOT_RUN; **Given** `internal-review` or an enabled module's `<module>-review` is pending,
   **Then** the required checks' status does not wait on it.
7. **Given** the fixture module enabled with provider login `fixture-bot`, `trusted_reviewers = ["alice"]`
   and unresolved threads started by `fixture-bot`, by `bob`, and by `alice` with a reply from `bob`,
   **When** findings are read, **Then** the `fixture-bot` thread is the fixture module's finding only, the
   `alice` thread a threads module finding only, and the `bob` thread no finding; the `bob` thread is listed
   separately as an untrusted thread for the orchestrator to close.
8. **Given** a thread started by any codeworks App, **Then** it is never a finding, whatever
   `trusted_reviewers` holds.
9. **Given** the base branch's rules require no status check but the orchestrator's own, **When** the
   required checks' status or findings is read, **Then** the outcome is COULD_NOT_RUN.

---

### User Story 5 - A hook mints an App's token through core (Priority: P3)

A hook mints through `core/` a one-hour installation token of one Codeworks App for one repo. On the agent
machine the orchestrator's SessionStart hook mints the session App's read-only token, for the gh config the
model's commands use, so they can read GitHub and write nothing, and its own App's token; reviewer's hook
mints its own App's token, for its state writes. On the admin machine planner's own hook mints the planner
App's token; no reviewer runs there.

**Why this priority**: nothing calls it until the orchestrator's, reviewer's and planner's hooks switch to core (spec
Assumptions), and the state module takes its token from its caller, so US2 does not wait for it.

**Independent Test**: with a test App's credentials, mint a token for one repo and check its expiry, its
repository list and its permission set; try a write outside that set and to a second repo.

**Acceptance Scenarios**:

1. **Given** an App's credentials and a session working in repo R, **When** a token is minted, **Then** it
   expires within one hour, is scoped to R only, and carries exactly that App's permission set: root
   ADR-0007 d1 for the session App, orchestrator ADR-0001 d1 for the orchestrator App, `SECURITY.md` §3 for
   the reviewer App, root ADR-0007 d4 for the planner App.
2. **Given** the App is not installed on R, or its credentials are missing, **When** a token is minted,
   **Then** minting fails naming the cause, and no fallback credential is used.
3. **Given** a session that has run past its token's hour, **When** it mints again, **Then** it gets a fresh
   token under the same rules.
4. **Given** no managed settings file, one the user can write, one missing `allowManagedHooksOnly`, or one
   enabling a plugin `SECURITY.md` §5 does not list, **When** a hook reads `session-app.pem`,
   `reviewer-app.pem` or a validator package's token, **Then** the read is refused naming each missing or
   different setting; **Given** the same, **When** planner's hook reads `planner-app.pem`, **Then** the read
   goes ahead (FR-038).
5. **Given** a valid managed settings file and a `/etc/claude-code/managed-settings.d/` folder, or a
   `~/.claude/remote-settings.json` file, **When** a hook reads a key, **Then** the read is refused naming
   the folder or file.

---

### Edge Cases

- A branch name that almost fits the grammar (`212-us-retry`, `0212-us2-x`, `212-us2-`, `212-spec-x`) is
  "no story"; the grammar's edges are decided once, in `core/`, and tested there.
- A story issue whose parent is itself a sub-issue: the spec's issue is the immediate parent; deeper
  nesting is not followed.
- A spec folder renamed by a rescope (`specs/<n>-*` → `specs/<p>-*`, planner ADR-0010): derivation reads
  the folder that exists at the ref asked about.
- The newest reviewer App comment carries the tag only in a quoted reply, or not at all: it is invalid state
  and holds the story; an older tagged comment never stands in for it.
- Two snapshots posted within one second: the newest by GitHub's creation order wins. Only reviewer's hook on
  the agent machine posts state, since the reviewer App's key is nowhere else.
- A hold whose admin comment came before the card's newest Ready but after the hold: releasable; the order
  of the two does not matter, only that both follow the hold.
- A `/codeworks reset` comment older than a hold: that hold is not released by it.
- A `[shared]` section missing `trusted_reviewers`: the threads module refuses to run rather than trusting
  nobody or everybody.
- An unknown key in `[shared]`, or a missing App login or `board`: reading the section fails naming the key
  (root ADR-0002 d2).
- A passing round's commit that is not on GitHub, amended before the push: it is not in the head's history,
  and the next passing round is tried.

## Requirements *(mandatory)*

### Functional Requirements

**Packaging**

- **FR-001**: `core/` MUST be one TypeScript package on Node at the repo root's `core/` folder, holding a
  package in place of `plugin/`, plus `tests/` and `docs/adr/` (root ADR-0001 d1; root ADR-0009 d1).
- **FR-002**: Each plugin that runs core code MUST carry a symlink to `core/`'s package, which a plugin
  install copies into the plugin, and MUST pin each of core's npm dependencies exactly in its own
  `package.json` and lockfile, which Claude Code installs with the plugin (root ADR-0001 d2; root ADR-0009
  d3). No plugin carries core in this spec.
- **FR-003**: A hook that runs core code MUST refuse, naming the package, when one of core's dependencies is
  not installed, and run nothing that needs core (root ADR-0009 d4). On Stop the refusal fails open: the
  session ends (orchestrator ADR-0001 d5 and its Trade-offs).
- **FR-004**: CI MUST fail a change to `core/` unless every plugin carrying core bumps its `version`, so a
  core change reaches each plugin in its next version and plugins sharing a session run one core. No plugin
  imports another plugin's code (root ADR-0001 d2).
- **FR-005**: `core/` MUST import no code from any component folder; it reaches a validator package only
  through the contract (FR-022).

**Shared settings**

- **FR-006**: `core/` MUST read `codeworks.toml` from the branch asked for and validate its `[shared]`
  section, refusing an unknown key, and MUST hand each component the raw text of its own section for that
  component to validate (root ADR-0002 d2, d4). No environment variable sets or overrides a key.

**Story identity and DONE**

- **FR-007**: `core/` MUST be the only parser of `<s>-us<k>-<slug>` and `<p>-spec`; `<k>` and the slug are
  carried for humans and never checked against anything (root ADR-0005 d1).
- **FR-008**: `core/` MUST derive the spec's issue as `#s`'s parent when it has one, else `#s`, and the spec
  folder as the one `specs/<p>-*/`, failing when there is none or more than one (root ADR-0005 d2).
- **FR-009**: `core/` MUST derive a story's PR as the newest PR whose head is the story's branch in the same
  repo, never from a PR body or closing reference; fork PRs are not a story's PR (root ADR-0005 d3).
- **FR-010**: `core/` MUST derive a story's requirement as its spec folder's `spec.md`, or the story issue's
  body when that `spec.md`'s front matter has `codeworks.kind: no_spec`, read through the spec facts model
  (root ADR-0005 d4; planner ADR-0008 d1).
- **FR-011**: `core/` MUST decide a story is done exactly when its PR merged or an admin closed
  its issue; a reopened done issue stays done (root ADR-0005 d5).

**Contracts**

- **FR-012**: `core/` MUST define the Findings contract (source, author, file, line, text, thread id if any,
  resolvable on GitHub, a `key` that names one item stable across heads, and for a thread its trusted
  comments and the id of its latest trusted comment, reviewer ADR-0016 d2, d3), the state snapshot (rounds,
  each with stage, number, head, result, verdict, root cause and when it was recorded, reviewer ADR-0017 d2;
  holds with id, kind, state, when it was placed, when it was released and the comment that released it, an
  escalation hold's question (orchestrator ADR-0010 d1) and, for a rescope hold, the number of the spec PR
  that placed it; pushbacks, each a finding key and the round that pushed it back, root ADR-0003 d7) and the spec facts (`codeworks: {v, kind,
  root_cause: {observed}}`) as Zod schemas, each with a JSON Schema generated from it (root ADR-0003 d1, d3;
  planner ADR-0008 d1).
- **FR-012a**: `core/` MUST define as enums, each value once with its meaning, the round result (CLEAN,
  DIRTY, INCOMPLETE), round verdict (PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK, ESCALATE),
  finding ruling (FIX, PUSH_BACK, DEFER), root cause (AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL,
  NOT_APPLICABLE), check outcome (PENDING, PASS, FAIL, SILENT, COULD_NOT_RUN, WAIVED), hold kind
  (rescope, escalation, pushback, claim, shim, audit), hold state (OPEN, RELEASED) and round stage (INTERNAL,
  AUDIT, GITHUB); every contract and JSON Schema takes these values only from them (root ADR-0010). A
  finding's source is `threads`, `required-checks` or a validator module's name, which matches one grammar,
  lower-case letters, digits and hyphens, starting with a letter, and is neither of the other two (root
  ADR-0010 d2).
- **FR-013**: A generated JSON Schema MUST be checked against its Zod schema in CI, so a JSON Schema that
  drifts from its source fails the build.

**State module**

- **FR-014**: The state module MUST be the only code in any component that reads or writes a state comment
  (root ADR-0003 d4; reviewer ADR-0011 d3).
- **FR-015**: A read MUST take as the state comment the newest comment on the story issue whose author is
  the reviewer App, whatever its body; a body that does not open with `<!-- codeworks:reviewer-state -->` is
  invalid state (reviewer ADR-0011 d1, d2).
- **FR-016**: A read MUST report the story as held when the state comment was edited, when the
  issue's timeline shows a reviewer App comment deleted after the state comment (or after none), when
  the snapshot fails its contract, or when any hold is open; it MUST report no state when the issue has no
  reviewer App comment and no such deletion, PR or not (reviewer ADR-0011 d2). An open hold keeps
  `internal-review` pending; with no hold open, an INTERNAL or AUDIT round CLEAN or CONVERGED_PUSHBACK at the
  head or at a commit in its history attests it, whatever GITHUB rounds came after, unless since that round:
  the default branch's `spec.md` of the story's spec, a `docs/adr/` folder or `.specify/memory/` differs from
  those at the round's commit; a merge of the default branch differs from git's clean merge of its parents;
  or a hold was released by an admin's comment, not a reset (orchestrator ADR-0004 d1).
- **FR-017**: A read MUST expose whether the story is held and why (each open hold id, or the tampered,
  deleted or invalid cause), and its newest round's stage, number, head, result and verdict.
- **FR-018**: A write MUST post a new comment holding the full snapshot and MUST never edit or delete a
  comment.
- **FR-019**: Every write MUST be refused while the story is held for tampered, deleted or invalid state,
  except the release path, which posts a snapshot rebuilt from the newest unedited valid one once an admin's
  comment and the card's Ready are both newer than the tampering (reviewer ADR-0011 d2).
- **FR-019a**: The state module MUST answer which open holds a start releases, by one rule: a hold is
  releasable when a Ready move and an admin's comment on the story issue are both newer than the state comment
  that placed it; for an escalation hold that comment MUST also be newer than the orchestrator's question for
  it. The answer names, per hold, the comment that
  releases it, and is decided and written over one snapshot. A reader that cannot see the board MUST fail
  naming it, never read "no Ready". The orchestrator calls it to stop a start under a hold that is not
  releasable, and reviewer to release on the claim; no component re-implements it (reviewer ADR-0013 d2;
  orchestrator ADR-0002 d1, d3, ADR-0010 d2).
- **FR-019b**: An admin's comment `/codeworks reset` on the story issue MUST make every hold placed
  before it releasable, and the read MUST report the newest such comment, from which reviewer and the
  orchestrator restart their counts (reviewer ADR-0013 d3).
- **FR-020**: "Place a rescope hold" MUST post a snapshot adding an open `rescope-<issue>` row recording the
  number of the spec PR that placed it, none on a RESCOPE verdict, and MUST post nothing when the row already
  records that spec PR, open or released. reviewer's hook calls it on a RESCOPE verdict and when it sees a
  rescope's spec PR open, which planner opens from the admin machine as the planner App (reviewer ADR-0011
  d1, ADR-0013 d5).
- **FR-021**: `core/` MUST expose no state write as a command. Every write is a library call that posts with
  the reviewer App token its caller passes. Only reviewer's hook reads that App's key, a convention that holds
  because plugin code is pinned and the model cannot write it (root ADR-0008; reviewer ADR-0011 d1).

**Validator contract, threads module and required-checks reader**

- **FR-022**: `core/` MUST define the validator contract and load through it each module `[shared]
  validators` lists, from its package `validators/<name>/` (root ADR-0001 d1; root ADR-0003 d1, d6, d8). A
  package exports its provider's GitHub logins, `trigger(repo, pr, head)`, `status(repo, pr, head)` →
  PENDING · PASS · FAIL · WAIVED with the head its provider read, and `findings(repo, pr, head)` → a list in
  the Findings contract. Loading MUST fail, naming it, for a listed name outside the grammar of FR-012a, with
  no folder, or whose package lacks a part of the contract. `trigger` MUST be safe to call more than once
  for one head. A package reads a token only through core's key read (FR-038).
- **FR-023**: Core's `status` MUST return a module's PASS or FAIL only when it names the head asked, else
  PENDING, and SILENT once `review_timeout`, which its caller passes with the start it counts from, has run
  with the module still PENDING (root ADR-0003 d1). Only the orchestrator calls `status` (root ADR-0003 d5),
  passing its `[orchestrator]` key `review_timeout` for every module (orchestrator ADR-0001 d8); when the
  count starts is the orchestrator's spec to settle.
- **FR-024**: When a service does not answer, a GitHub status or check is `error`, or a module throws, core
  MUST return COULD_NOT_RUN, distinct from every status and from an empty findings list (root ADR-0004 d1,
  d4).
- **FR-025**: Core MUST validate each module's findings against the Findings contract, its source equal to
  the module's name, and return COULD_NOT_RUN naming the module and the error otherwise.
- **FR-027**: `core/` MUST provide a required-checks reader, not a validator module: no `trigger`, no
  `<module>-review`, not named in `validators`, always on. It MUST take the required checks from the base
  branch's effective rules (rulesets; orchestrator ADR-0009 d2), leaving out `internal-review` and each
  enabled module's `<module>-review`, which the orchestrator writes from these reads. Its status MUST be
  FAIL when a required check at the head concluded `failure`, and its findings one per such check, naming
  the check and its conclusion. When the rules require no other check, status and findings MUST return
  COULD_NOT_RUN, never PASS. The orchestrator reads its status against `review_timeout`
  (orchestrator ADR-0008 d4); reviewer reads its findings as merge blockers (reviewer ADR-0013 d4).
- **FR-028**: Each validator module MUST return its own provider's unresolved review threads among its
  findings. The threads module MUST return, behind the same `findings` contract, each unresolved review
  thread whose first comment's author is listed in `[shared] trusted_reviewers` and is no enabled module's
  provider login: enabling a module trusts its provider, so every thread has one source. Core MUST drop
  from every module's findings a thread started by a codeworks App, whose logins are `[shared]` keys (root
  ADR-0003 d2; root ADR-0007 d5).
- **FR-029**: The threads module MUST list, apart from its findings, the unresolved threads started by
  neither a trusted reviewer nor an enabled module's provider, so the orchestrator can close them (root
  ADR-0003 d5).

**App tokens**

- **FR-035**: `core/` MUST mint an installation token of a named App for one named repo, valid for at most
  one hour, requesting exactly that App's permission set: the session App's (root ADR-0007 d1), the
  orchestrator App's (orchestrator ADR-0001 d1), the reviewer App's (`SECURITY.md` §3) or the planner App's
  (root ADR-0007 d4).
- **FR-036**: Each caller MUST pass its App's ID and private key file from `~/.config/codeworks/` (root
  ADR-0008 d4): on the agent machine, the orchestrator's SessionStart hook for the session App
  (`session-app.pem`) and the orchestrator's hooks for their own App, reviewer's hook for its own
  (`reviewer-app.pem`); on the admin machine, planner's hook for its own App (`planner-app.pem`). The
  managed settings close that folder to the model on the agent machine; on the admin machine
  `planner-app.pem` sits without that protection, as planner's accepted risk (root ADR-0008 d2; root
  ADR-0007 d4). Each App's ID is a key of the component whose hook mints its token: the session and
  orchestrator Apps' in `[orchestrator]`, the reviewer App's in `[reviewer]`, the planner App's in `[planner]` (root ADR-0002 d1, d2);
  the orchestrator App's key file name is the orchestrator's spec to settle. `core/` MUST refuse a key file readable by
  anyone but its owner, and MUST expose no command that mints or prints a token.
- **FR-037**: A failed mint MUST report its cause and MUST NOT fall back to any other credential.
- **FR-038**: `core/` MUST read a file in `~/.config/codeworks/` only while the
  managed settings are in effect (root ADR-0008 d9), and otherwise refuse, naming each missing or different
  setting. In effect means: the managed settings file is at its platform path, owned by root and writable by
  no one else, and holds every setting `SECURITY.md` §5 fixes, `~/.config/codeworks/` among the sandbox's
  `denyRead` and `denyWrite` paths and the `Read` and `Edit` denies, and the calling plugin among
  `enabledPlugins`, with no plugin enabled that §5 does not list; and it is the one source: no
  `managed-settings.d/` folder beside it and no `~/.claude/remote-settings.json`. Planner's read of `planner-app.pem` alone is exempt: it reads it on the admin machine,
  outside those settings (root ADR-0008 d2, d9).

### Key Entities

- **Story identity**: story issue, spec's issue, spec folder, story branch, story PR and requirement, all
  derived from a branch name or a story issue number.
- **State snapshot**: a story's rounds (stage, number, head, result, verdict, root cause, when recorded),
  holds (id, kind, state, releasing comment, rescope spec PR) and pushbacks (finding key, round), carried
  whole in each state comment.
- **Held answer**: whether a story is held and the cause: open hold ids, tampered, deleted or invalid
  state; which open holds a start releases and by which comment, and the newest `/codeworks reset`.
- **Validator module**: a package in `validators/<name>/`: its provider's logins, `trigger`, `status` and
  `findings`.
- **Finding**: source, key, author, file, line, text, thread id if any, resolvable on GitHub; for a thread,
  its trusted comments and the id of the latest.
- **Value sets**: the enums of FR-012a; a module's status is a check outcome.
- **Spec facts**: the `codeworks` front matter of `spec.md`: version, kind, root-cause observation.
- **App token**: one App (session, orchestrator, reviewer or planner), one repo, at most one hour, that
  App's permission set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every fixture branch name, issue tree and PR list in core's tests, core gives one story,
  spec and PR answer, and the code this spec builds holds zero branch-grammar patterns outside `core/`.
- **SC-002**: Every fixture of tampered, deleted, untagged or contract-invalid state reads as held: zero
  such fixtures read as not held. Every release fixture gives the one answer FR-019a and FR-019b fix, to
  the orchestrator's and to reviewer's call alike, and every lapse fixture of FR-016 reads as not attested.
- **SC-003**: Zero state comments are edited by any component, and core adds zero commands, so none
  reaches a state write or a mint.
- **SC-004**: For every recorded "service did not answer", `error` or throwing-module fixture, core's
  contract over a fixture module and the required-checks reader return COULD_NOT_RUN; zero such fixtures
  yield PASS, FAIL or an empty findings list.
- **SC-005**: Every untrusted-thread fixture yields zero findings, and every trusted-thread fixture, a module
  provider's included, yields exactly one finding across all modules.
- **SC-007**: A fixture plugin carrying core, installed from a git-hosted fixture marketplace, imports the
  core of the commit it was installed from; zero CI runs pass a change to `core/` without the plugins'
  version bumps.
- **SC-008**: Every minted token, of each App, expires within one hour and is refused by GitHub for a second
  repo and for any write outside its permission set.
- **SC-009**: Zero value strings of the FR-012a sets appear in core's code outside their enums.

## Assumptions

- Node is on every machine that runs a plugin carrying core (root ADR-0009 Trade-offs).
- No plugin carries core here (FR-002); each gains it in the follow-up that first calls core there.
- Reading `[shared]` belongs in core because the orchestrator and reviewer both read `trusted_reviewers`;
  each component still validates its own section (root ADR-0002 d2).
- The four Apps' logins and `board` are required `[shared]` keys, beside `trusted_reviewers` and
  `validators`, and each App's ID a key of its minting component, so no repo, board or App name is
  hardcoded (constitution P8).
- The Codex, CodeRabbit and DeepSource packages in `validators/` are their own specs; this spec builds none
  and tests the contract on a fixture package.
- The orchestrator's hook mints the session token (root ADR-0007 d2) and its own App's token through the
  same core function; wiring the orchestrator to call it is the orchestrator's own work, not this spec's.
- reviewer's move from its SQLite ledger to the state comment (reviewer ADR-0011 d5), its hook minting tokens,
  writing state, reading a PR's findings and placing the rescope hold when it sees a rescope's spec PR open,
  and each component's switch from its private code to core (e.g. `reviewer/plugin/scripts/specbinding.py`
  `_STORY_BRANCH`) are follow-up work in those components, not part of building core.
- The rest of the 2026-10-26 session design is other components' work, not core's: the claim, pushes, the
  draft PR, the check runs, thread replies and the squash merge are the orchestrator's (orchestrator
  ADR-0001 to ADR-0009), as are its thresholds `max_turns`, `k_deaths` and `review_timeout`, how a session
  ended, the resume and the status issue; reviewer's commit check after each commit is reviewer's
  (reviewer ADR-0002); `k_topic` and `max_rounds` are reviewer's `[reviewer]` keys
  (reviewer ADR-0013 d4, ADR-0019).
- A Ready move is read from the story issue's timeline, where GitHub records a move of the card as a
  status-change event naming the status, the project, the actor and whether a workflow made it (seen).
- The ADRs cited are drafts; this spec builds to them as written.

## Why this is worth doing

### harm
Answer: The orchestrator cannot be built: it imports no plugin code, only core/, so with no core/ it has no way to read a story's ATTESTED and HOLD state, its findings or its identity, and no story is ever claimed, attested or merged. Each component that needs those reads would write its own copy instead, and copies of one grammar or one predicate give different answers at the edges.
Source: code: no core/ folder on main (ls core fails at 8a690ac); decision records orchestrator ADR-0001 d1 "importing only `core/`", root ADR-0005 Context "three parsers of one grammar give three answers at its edges".

### reachable
Answer: observed for the gap, predicted for the harm. core/ does not exist; reviewer keeps rounds and holds in a local SQLite ledger (reviewer/plugin/scripts/ledger.py) that no other host can read, and the only story-branch parser is a private regex in reviewer (specbinding.py:62). The harm lands as soon as the orchestrator or a second component needs these reads.
Source: code: reviewer/plugin/scripts/ledger.py (sqlite3), reviewer/plugin/scripts/specbinding.py:62 `_STORY_BRANCH`.

### change-alters
Answer: Yes. With core/ the orchestrator reads a story's snapshot from its tagged issue comment through the state module, its findings through the validator contract, the threads module and the required-checks reader, and its branch, spec folder and PR through the identity parser; reviewer, planner and builder call the same functions, so all components give one answer.
Source: code: decision records root ADR-0001 d2, root ADR-0003 d1-d4, root ADR-0005, reviewer ADR-0011 d1.

### owner
Answer: Only the decision records own it, as drafts; no code, test or CI job does.
Source: code: decision records root ADR-0001, 0003, 0005, 0007 (status draft), and no core/ tests on main.

### inherited
Answer: Yes, from the Codeworks target design's records (root ADR-0001 d2 makes core/ the home of shared code). The questions above hold for that decision: the orchestrator's no-plugin-import rule and the one-parser rule make a shared package necessary, not optional.
Source: code: decision records root ADR-0001 d2, orchestrator ADR-0001 d1, root ADR-0005.

### needs-spec
Answer: It has decisions. The records fix what core/ holds but not: how a core change reaches each plugin's version; whether reading codeworks.toml belongs in core/; how required CI checks are read; how a hook gets each App's key to mint its token; and how the work splits into user stories.
Source: code: decision records root ADR-0001 d2, root ADR-0002, root ADR-0003, root ADR-0007 d2.

## Root cause

Not a defect report.
