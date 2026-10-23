# Feature Specification: core, the shared package every Codeworks component imports

**Feature Branch**: `145-spec`

**Created**: 2026-10-21

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/145 — core: the shared package every Codeworks component imports. Build `core/`, the package that holds the code more than one component runs (root ADR-0001 d2). Each plugin installs it into its `${CLAUDE_PLUGIN_DATA}`, pinned to the plugin's version; the orchestrator imports it the same way and imports no plugin code. It holds: the state module, the validator modules, the threads module, the contracts, story identity, DONE and the App tokens."

## Clarifications

### Session 2026-10-21

- Q: Where is core installed from, and how is its version set? → A: superseded by Session 2026-10-22 (plan rulings): core ships inside each plugin that runs it; no core tag, no install.
- Q: Who returns a review thread as a finding? → A: each validator module returns its own vendor's threads; the threads module returns only threads started by reviewers that have no enabled module.
- Q: Where is the session App's key? → A: `~/.config/codeworks/session-app.pem`, mode 0600 (root ADR-0008 d4); the managed settings close that folder to the model only in the agent environment, and where planner runs the key sits on the human's machine as planner's accepted risk (root ADR-0008 d2). The App ID is a `[shared]` key.
- Q: How does the work split into stories? → A: the stories as written, each its own sub-issue, branch and PR; US1 lands first because it proves the path every later module ships by.
- Q: Where does the DeepSource module read from? → A: a `[shared]` key picks `api` or `github`; `github` reads its check runs, annotations and threads; `api` reads DeepSource's API with a token only hooks read and returns COULD_NOT_RUN when the token is missing, never falling back.
- Q: Does a module's vendor also have to be listed in `trusted_reviewers`? → A: no; enabling a module trusts its vendor, and `trusted_reviewers` lists only reviewers with no module.

### Session 2026-10-21 (critique)

- Q: Who writes the state comment, the rescope hold included? → A: reviewer's hook alone, as the `codeworks-reviewer` App; core exposes no state write as a command (root ADR-0008; reviewer ADR-0011 d1, ADR-0013 d4; PR #146).
- Q: Where is the reviewer App's key? → A: `~/.config/codeworks/reviewer-app.pem`, mode 0600, read only by hooks; its ID and login are `[shared]` keys, as the session App's are.
- Q: How does a session's token reach gh? → A: a hook mints it through core into a gh config folder the model can read but not write, and mints a fresh one before the hour: the orchestrator's `SessionStart` hook in the agent environment, reviewer's hook where planner runs; no command prints a token (root ADR-0007 d2).
- Q: How is a finding with no thread pushed back? → A: every finding carries a stable `key`, and the snapshot records each pushback by that key (root ADR-0003 d7).
- Q: What does the required-checks reader return when the base branch's rules require no check? → A: COULD_NOT_RUN, never PASS; required checks come from rulesets only (orchestrator ADR-0009 d2).

### Session 2026-10-22 (records merged in PR #147)

- Q: Is CI a validator module? → A: no. A module is per external reviewer (root ADR-0003 d1), and the orchestrator writes a `<module>-review` for each (orchestrator ADR-0008 d3); a CI module's `ci-review` would be a required check waiting on itself. The ruleset requires CI's checks directly (orchestrator ADR-0009 d2), so core reads them through a required-checks reader, not a module.
- Q: Is a deleted state comment detected? → A: yes. GitHub records the deletion of another account's comment as a `comment_deleted` timeline event naming that comment's author, and no token removes it; a reviewer App comment deleted after the newest snapshot holds the story (reviewer ADR-0011 d2). This closes critique finding E2.
- Q: Does core check the managed settings before reading a key? → A: yes, once for every caller: every read of a file in `~/.config/codeworks/` goes ahead only while the managed settings are in effect (root ADR-0008 d9), but reviewer's read of `session-app.pem`, which it makes where planner runs, outside those settings (root ADR-0008 d2). The orchestrator's read of the same key is checked.
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

- Q: Is a story that has a PR but no reviewer App comment held? → A: no. It has no state and is not held; nothing attests without a passing internal round. Builder opens the draft PR before the first round (builder ADR-0003 d1), so holding it would stop every story (reviewer ADR-0011 d2).
- Q: Which comment is a story's state? → A: the newest comment by the reviewer App, whatever its body. If it does not open with the tag it is invalid state and holds the story; an older tagged comment never stands in for it. Only an edit of that newest comment counts as tampering (reviewer ADR-0011 d1, d2).
- Q: How is a DeepSource finding with no thread keyed? → A: by its file, its issue code (else its annotation title) and its exact message text; never its line, which moves between heads. Two items of one code in one file share a key only when their text is identical.
- Q: Are round stage, hold state and a finding's source value sets in core? → A: yes, enums (root ADR-0010): round stage INTERNAL, AUDIT, GITHUB; hold state OPEN, RELEASED; a finding's source is the module name, codex, coderabbit, deepsource, threads, required-checks, kept lower case because it is also a `codeworks.toml` entry and part of a check name (root ADR-0010 d2).
- Q: Which rounds attest `internal-review`, and at which commits? → A: the internal review is stage 1. An INTERNAL or AUDIT round that is CLEAN or CONVERGED_PUSHBACK, at the head or at a commit in the head's history, attests it while no hold is open. Later commits and GITHUB rounds (stage 2) never undo it; a rewritten history that drops that commit restarts stage 1 (orchestrator ADR-0004 d1).

## Terms

- **Component**: one of the plugins `reviewer`, `planner`, `builder`, `auditor` and `orchestrator`.
- **Agent environment**: the one environment, holding no human GitHub credential and under the managed
  settings (root ADR-0008), where one Claude Code session runs the orchestrator, builder and reviewer.
  planner runs where the human works, outside it.
- **Story**: one user story, with its own issue `#s`, branch `<s>-us<k>-<slug>` and PR (root ADR-0005).
- **Spec's issue `#p`**: `#s`'s parent issue when it has one, else `#s`. Its spec PR's branch is `<p>-spec`
  and its spec folder the one `specs/<p>-*/`.
- **State comment**: a comment on a story issue tagged `<!-- codeworks:reviewer-state -->` holding the full
  snapshot of the story's rounds and holds (reviewer ADR-0011).
- **Session App**: the `codeworks-session` GitHub App the model's commands act as on GitHub (root ADR-0007).
- **Orchestrator App**: the `codeworks-orchestrator` GitHub App the orchestrator's hooks act as
  (orchestrator ADR-0001 d1).
- **Reviewer App**: the `codeworks-reviewer` GitHub App, issues write alone, that reviewer's hook posts every
  state comment as (reviewer ADR-0011 d1).
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
9. **Given** a story whose PR merged, **Then** it is done; **Given** an issue a human closed, **Then** it is
   done; **Given** an issue the session App closed with its PR unmerged, **Then** it is not done; **Given** a
   done story whose issue was reopened, **Then** it is still done.

---

### User Story 2 - A component reads and writes a story's reviewer state through one module (Priority: P1)

reviewer's hook records rounds and holds, a rescope hold included, and the orchestrator's hooks read whether a
story is held and what its newest round says, all through `core/`'s state module. The module picks the newest
comment written by the reviewer App, holds the story when that state may have been tampered with, and
exposes no state write as a command: every write is a library call that posts with the reviewer App token
its caller passes.

**Why this priority**: the orchestrator cannot attest, hold or merge a story without it, and reviewer's
state cannot move off its local ledger onto GitHub without it.

**Independent Test**: against fixture issue comment lists, read the snapshot and its held answer; write a
snapshot and a rescope hold against a recorded GitHub fake and inspect the comment posted.

**Acceptance Scenarios**:

1. **Given** a story issue with three state comments by the reviewer App and newer ones by a human and by
   the session App, **When** the state is read, **Then** the newest one by the reviewer App is the snapshot.
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
   release path writes, **Then** the write is refused, naming the hold and its release (a human's Ready).
8. **Given** reviewer's hook places a rescope hold on story issue 212, **Then** a new full snapshot is posted
   with an open `rescope-212` row recording the blob SHA of `spec.md` on the story's branch, or on the default
   branch when the story has no branch.
9. **Given** a plugin carrying core, **When** its commands are listed, **Then** core adds none.
10. **Given** a snapshot recording a pushback of finding key K in round 3, **When** the state is read,
    **Then** K is reported as pushed back in that round.
11. **Given** an INTERNAL round CLEAN at commit A and a later GITHUB round DIRTY at head B, no hold open,
    **When** attestation is read at B, **Then** it attests when A is in B's history and does not when a
    rewritten history dropped A.

---

### User Story 3 - A component reads every external reviewer and required check through one contract (Priority: P2)

The orchestrator's hooks ask each external reviewer (for example Codex, CodeRabbit, DeepSource) to run, ask
its status at a PR's head, and read its findings; reviewer's hook reads the same findings, plus the threads
module's and the failed required checks', for its github round. Each answer comes in one Findings shape,
and an unresolved review thread is a finding only when a trusted reviewer started it.

**Why this priority**: the orchestrator's external review requests, ready and merge steps, and reviewer's
github round, each need it; it builds on the contracts of US1–US2 but not on the state writes.

**Independent Test**: for each module and the required-checks reader, feed recorded GitHub responses for one
PR head and check `trigger`'s call, `status`'s value and `findings`' list against the contract.

**Acceptance Scenarios**:

1. **Given** Codex's newest non-dismissed review naming the head is the clean template, **Then** Codex's
   status is PASS; **Given** it opens with the findings preamble, **Then** FAIL, with its findings;
   **Given** no review names the head, **Then** PENDING; **Given** Codex is out of credits with no verdict,
   **Then** WAIVED.
2. **Given** a module's timeout has passed with no verdict at the head, **When** its status is read,
   **Then** it is SILENT.
3. **Given** GitHub does not answer, or a check is in `error`, **When** a status or findings is read,
   **Then** the outcome is COULD_NOT_RUN, never PASS, FAIL or an empty findings list.
4. **Given** CodeRabbit lists outside-diff items, **When** its findings are read, **Then** each is a finding
   with no thread id and marked not resolvable on GitHub.
5. **Given** a required check concluded `failure` at the head, **When** the required checks' findings are
   read, **Then** it is one finding naming the check; **Given** the check is in `error`, **Then** the outcome
   is COULD_NOT_RUN; **Given** `internal-review` or an enabled module's `<module>-review` is pending,
   **Then** the required checks' status does not wait on it.
6. **Given** the Codex module enabled, `trusted_reviewers = ["alice"]` and unresolved threads
   started by `codex`, by `bob`, and by `alice` with a reply from `bob`, **When** findings are read,
   **Then** the `codex` thread is a Codex module finding only, the `alice` thread a threads module finding
   only, and the `bob` thread no finding; the `bob` thread is listed separately as an untrusted thread for
   the orchestrator to close.
7. **Given** a thread started by the session App, **Then** it is never a finding, whatever
   `trusted_reviewers` holds.
8. **Given** a self-triggering reviewer, **When** `trigger` is called, **Then** it does nothing.
9. **Given** the base branch's rules require no status check but the orchestrator's own, **When** the
   required checks' status or findings is read, **Then** the outcome is COULD_NOT_RUN.
10. **Given** one CodeRabbit outside-diff item read at two heads, **When** its findings are read, **Then**
    the item's `key` is the same at both.
11. **Given** two DeepSource items with no thread, of one issue code in one file, with different messages,
    **When** its findings are read, **Then** their keys differ; **Given** one such item at another line on a
    later head, **Then** its key is unchanged.

---

### User Story 5 - A hook mints an App's token through core (Priority: P3)

A hook mints through `core/` a one-hour installation token of one Codeworks App for one repo. The
orchestrator's hook mints the session App's token, for the gh config the model's commands use, so their
writes carry none of the human's permissions, and its own App's token. reviewer's hook mints its own App's
token, for its state writes, and, where planner runs, the session App's token.

**Why this priority**: nothing calls it until the orchestrator's and reviewer's hooks switch to core (spec
Assumptions), and the state module takes its token from its caller, so US2 does not wait for it.

**Independent Test**: with a test App's credentials, mint a token for one repo and check its expiry, its
repository list and its permission set; try a write outside that set and to a second repo.

**Acceptance Scenarios**:

1. **Given** an App's credentials and a session working in repo R, **When** a token is minted, **Then** it
   expires within one hour, is scoped to R only, and carries exactly that App's permission set: root
   ADR-0007 d1 for the session App, orchestrator ADR-0001 d1 for the orchestrator App, reviewer ADR-0011 d1
   for the reviewer App.
2. **Given** the App is not installed on R, or its credentials are missing, **When** a token is minted,
   **Then** minting fails naming the cause, and no fallback credential is used.
3. **Given** a session that has run past its token's hour, **When** it mints again, **Then** it gets a fresh
   token under the same rules.
4. **Given** no managed settings file, one the user can write, or one missing `allowManagedHooksOnly`,
   **When** a hook reads `reviewer-app.pem` or the DeepSource token, **Then** the read is refused naming each
   missing or different setting; **Given** the same, **When** reviewer's hook reads `session-app.pem`,
   **Then** the read goes ahead; **When** the orchestrator's hook reads it, **Then** it is refused (FR-038).

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
- Two snapshots posted within one second: the newest by GitHub's creation order wins. Only reviewer's hook in
  the agent environment posts state, since the reviewer App's key is nowhere else.
- A `[shared]` section missing `trusted_reviewers`: the threads module refuses to run rather than trusting
  nobody or everybody.
- An unknown key in `[shared]`, or a missing App ID or login: reading the section fails naming the key
  (root ADR-0002 d2).

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
  not installed, and run nothing that needs core (root ADR-0009 d4).
- **FR-004**: CI MUST fail a change to `core/` unless every plugin carrying core bumps its `version`, so a
  core change reaches each plugin in its next version and plugins sharing a session run one core. No plugin
  imports another plugin's code (root ADR-0001 d2).
- **FR-005**: `core/` MUST import no code from any component folder.

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
- **FR-011**: `core/` MUST decide a story is done exactly when its PR merged or a human (a User, never
  an App) closed its issue; a reopened done issue stays done (root ADR-0005 d5).

**Contracts**

- **FR-012**: `core/` MUST define the Findings contract (source, author, file, line, text, thread id if any,
  resolvable on GitHub, a `key` that names one item stable across heads, and for a thread its trusted
  comments and the id of its latest trusted comment, reviewer ADR-0016 d2, d3), the state snapshot (rounds,
  each with stage, number, head, result, verdict and root cause, reviewer ADR-0017 d2; holds with id, kind,
  state and, for a rescope hold, the `spec.md` blob SHA; pushbacks, each a finding key and the
  round that pushed it back, root ADR-0003 d7) and the spec facts (`codeworks: {v, kind,
  root_cause: {observed}}`) as Zod schemas, each with a JSON Schema generated from it (root ADR-0003 d1, d3;
  planner ADR-0008 d1).
- **FR-012a**: `core/` MUST define as enums, each value once with its meaning, the round result (CLEAN,
  DIRTY, INCOMPLETE), round verdict (PATCH, CLASS_FIX, REDESIGN, RESCOPE, CONVERGED_PUSHBACK, ESCALATE),
  finding ruling (FIX, PUSH_BACK, DEFER), root cause (AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL,
  NOT_APPLICABLE), check outcome (PENDING, PASS, FAIL, SILENT, COULD_NOT_RUN, WAIVED), hold kind
  (rescope, escalation, pushback, claim, shim, audit), hold state (OPEN, RELEASED), round stage (INTERNAL,
  AUDIT, GITHUB) and module name, a finding's source (codex, coderabbit, deepsource, threads,
  required-checks); every contract and JSON Schema takes these values only from them (root ADR-0010).
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
  head or at a commit in its history attests it, whatever GITHUB rounds came after (orchestrator ADR-0004 d1).
- **FR-017**: A read MUST expose whether the story is held and why (each open hold id, or the tampered,
  deleted or invalid cause), and its newest round's stage, number, head, result and verdict.
- **FR-018**: A write MUST post a new comment holding the full snapshot and MUST never edit or delete a
  comment.
- **FR-019**: Every write MUST be refused while the story is held for tampered, deleted or invalid state,
  except the release path, which posts a snapshot rebuilt from the newest unedited valid one after a human's
  Ready (reviewer ADR-0011 d2).
- **FR-020**: "Place a rescope hold" MUST post a snapshot adding an open `rescope-<issue>` row recording the
  blob SHA of `spec.md` on the story's branch, else on the default branch. reviewer's hook calls it on a
  RESCOPE verdict and when it sees a rescope's spec PR open, which planner opens from outside the agent
  environment (reviewer ADR-0013 d4).
- **FR-021**: `core/` MUST expose no state write as a command. Every write is a library call that posts with
  the reviewer App token its caller passes. Only reviewer's hook reads that App's key, a convention that holds
  because plugin code is pinned and the model cannot write it (root ADR-0008; reviewer ADR-0011 d1).

**Validator, threads and required-checks modules**

- **FR-022**: `core/` MUST provide one validator module per external reviewer, for Codex, CodeRabbit and
  DeepSource, enabled per repo by a `[shared]` key, since the orchestrator and reviewer both read every enabled module (root
  ADR-0002 d2; orchestrator ADR-0007 d2; reviewer ADR-0016 d1). Each module has
  `trigger(pr, head)` (a no-op for a self-triggering reviewer), `status(pr, head)` → PENDING · PASS ·
  FAIL · SILENT, and `findings(pr, head)` → a list in the Findings contract (root ADR-0003 d1).
- **FR-023**: `status` MUST return SILENT once the timeout its caller passes has run with no verdict at the
  head, Codex's timed from the request comment (orchestrator ADR-0008 d4). Only the orchestrator calls
  `status` (root ADR-0003 d5), so the timeouts are keys of `[orchestrator]`, not `[shared]` (root ADR-0002
  d2).
- **FR-024**: When a service does not answer, or a GitHub status or check is `error`, a module MUST return
  COULD_NOT_RUN, distinct from every status and from an empty findings list (root ADR-0004 d1, d4).
- **FR-025**: The Codex module MUST take its verdict from Codex's newest non-dismissed review naming the
  head: the clean template is PASS, a findings preamble FAIL, no review at the head PENDING; out of
  credits with no verdict is WAIVED. It is the only code that reads a verdict from review text
  (root ADR-0003 d6; constitution P7).
- **FR-026**: The CodeRabbit module MUST return its outside-diff items as findings with no thread id and not
  resolvable on GitHub (root ADR-0003 d7).
- **FR-026a**: The DeepSource module MUST read the source a `[shared]` key names: `github` takes `status` from
  DeepSource's check runs at the head and `findings` from its threads and check-run annotations; `api` takes
  both from DeepSource's API with a token read from `~/.config/codeworks/deepsource-token` (mode 0600, as the
  session App key, read only by hooks), and returns COULD_NOT_RUN when the token is missing or refused. It
  never falls back from one source to the other. A finding with no thread MUST be keyed by its file, its
  issue code (else its annotation title) and its exact message text, never its line.
- **FR-027**: `core/` MUST provide a required-checks reader, not a validator module: no `trigger`, no
  `<module>-review`, not named in `validators`, always on. It MUST take the required checks from the base
  branch's effective rules (rulesets; orchestrator ADR-0009 d2), leaving out `internal-review` and each
  enabled module's `<module>-review`, which the orchestrator writes from these reads. Its status MUST be
  FAIL when a required check at the head concluded `failure`, and its findings one per such check, naming
  the check and its conclusion. When the rules require no other check, status and findings MUST return
  COULD_NOT_RUN, never PASS. The orchestrator reads its status for the required-check timeout
  (orchestrator ADR-0008 d4); reviewer reads its findings as merge blockers (reviewer ADR-0013 d3).
- **FR-028**: Each validator module MUST return its own vendor's unresolved review threads among its
  findings. The threads module MUST return, behind the same `findings` contract, each unresolved review
  thread whose first comment's author is listed in `[shared] trusted_reviewers`, which names only reviewers
  with no module: enabling a module trusts its vendor, so every thread has one source. No module MUST ever
  count a thread started by the session App (root ADR-0003 d2; root ADR-0007 d4).
- **FR-029**: The threads module MUST list, apart from its findings, the unresolved threads started by
  neither a trusted reviewer nor an enabled module's vendor, so the orchestrator can close them (root
  ADR-0003 d5).

**App tokens**

- **FR-035**: `core/` MUST mint an installation token of a named App for one named repo, valid for at most
  one hour, requesting exactly that App's permission set: the session App's (root ADR-0007 d1), the
  orchestrator App's (orchestrator ADR-0001 d1) or the reviewer App's (reviewer ADR-0011 d1).
- **FR-036**: Each caller MUST pass its App's ID and private key file from `~/.config/codeworks/` (root
  ADR-0008 d4): the orchestrator's hook for the session App and its own, reviewer's hook for its own and,
  where planner runs, the session App. The managed settings close that folder to the model only in the
  agent environment; where planner runs, `session-app.pem` sits on the human's machine without that
  protection, as planner's accepted risk (root ADR-0008 d2; root ADR-0007 Trade-offs). The session and
  reviewer Apps' IDs are `[shared]` keys and their keys `session-app.pem` and `reviewer-app.pem`; the
  orchestrator App's ID key and key file name are the orchestrator's spec to settle. `core/` MUST refuse a key file readable by
  anyone but its owner, and MUST expose no command that mints or prints a token.
- **FR-037**: A failed mint MUST report its cause and MUST NOT fall back to any other credential.
- **FR-038**: `core/` MUST read a file in `~/.config/codeworks/` only while the
  managed settings are in effect (root ADR-0008 d9), and otherwise refuse, naming each missing or different
  setting. In effect means: the managed settings file is at its platform path, owned by root and writable by
  no one else, and holds every setting `SECURITY.md` §5 fixes, `~/.config/codeworks/` among the sandbox's
  `denyRead` and `denyWrite` paths and the `Read` and `Edit` denies, and the calling plugin among
  `enabledPlugins`. Reviewer's read of `session-app.pem` alone is exempt: it reads it where planner runs,
  outside those settings (root ADR-0008 d2, d9); the orchestrator's read of that key is checked.

### Key Entities

- **Story identity**: story issue, spec's issue, spec folder, story branch, story PR and requirement, all
  derived from a branch name or a story issue number.
- **State snapshot**: a story's rounds (stage, number, head, result, verdict, root cause), holds (id, kind, state,
  rescope blob SHA) and pushbacks (finding key, round), carried whole in each state comment.
- **Held answer**: whether a story is held and the cause: open hold ids, tampered, deleted or invalid
  state.
- **Finding**: source, key, author, file, line, text, thread id if any, resolvable on GitHub; for a thread,
  its trusted comments and the id of the latest.
- **Value sets**: the enums of FR-012a; a module's status is a check outcome, Codex's out-of-credits
  outcome WAIVED.
- **Spec facts**: the `codeworks` front matter of `spec.md`: version, kind, root-cause observation.
- **App token**: one App (session, orchestrator or reviewer), one repo, at most one hour, that App's
  permission set.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For every fixture branch name, issue tree and PR list in core's tests, core gives one story,
  spec and PR answer, and the code this spec builds holds zero branch-grammar patterns outside `core/`.
- **SC-002**: Every fixture of tampered, deleted, untagged or contract-invalid state reads as held: zero
  such fixtures read as not held.
- **SC-003**: Zero state comments are edited by any component, and core adds zero commands, so none
  reaches a state write or a mint.
- **SC-004**: For every recorded "service did not answer" or `error` fixture, every validator module and the
  required-checks reader returns
  COULD_NOT_RUN; zero such fixtures yield PASS, FAIL or an empty findings list.
- **SC-005**: Every untrusted-thread fixture yields zero findings, and every trusted-thread fixture, a module
  vendor's included, yields exactly one finding across all modules.
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
- The session and reviewer Apps' IDs and logins are required `[shared]` keys, so no repo or App name is
  hardcoded (constitution P8).
- The orchestrator's hook mints the session token (root ADR-0007 d2) and its own App's token through the
  same core function; wiring the orchestrator to call it is the orchestrator's own work, not this spec's.
- reviewer's move from its SQLite ledger to the state comment (reviewer ADR-0011 d5), its hook minting tokens,
  writing state, reading a PR's findings and placing the rescope hold when it sees a rescope's spec PR open,
  and each component's switch from its private code to core (e.g. `reviewer/plugin/scripts/specbinding.py`
  `_STORY_BRANCH`) are follow-up work in those components, not part of building core.
- The ADRs cited are drafts; this spec builds to them as written.

## Why this is worth doing

### harm
Answer: The orchestrator cannot be built: it imports no plugin code, only core/, so with no core/ it has no way to read a story's ATTESTED and HOLD state, its findings or its identity, and no story is ever claimed, attested or merged. Each component that needs those reads would write its own copy instead, and copies of one grammar or one predicate give different answers at the edges.
Source: code: no core/ folder on main (ls core fails at 8a690ac); decision records orchestrator ADR-0001 d1 "importing only `core/`", root ADR-0005 Context "three parsers of one grammar give three answers at its edges".

### reachable
Answer: observed for the gap, predicted for the harm. core/ does not exist; reviewer keeps rounds and holds in a local SQLite ledger (reviewer/plugin/scripts/ledger.py) that no other host can read, and the only story-branch parser is a private regex in reviewer (specbinding.py:62). The harm lands as soon as the orchestrator or a second component needs these reads.
Source: code: reviewer/plugin/scripts/ledger.py (sqlite3), reviewer/plugin/scripts/specbinding.py:62 `_STORY_BRANCH`.

### change-alters
Answer: Yes. With core/ the orchestrator reads a story's snapshot from its tagged issue comment through the state module, its findings through the validator, threads and required-checks modules, and its branch, spec folder and PR through the identity parser; reviewer, planner and builder call the same functions, so all components give one answer.
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
