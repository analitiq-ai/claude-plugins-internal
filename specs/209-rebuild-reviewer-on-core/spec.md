---
# planner's spec_facts.ts sets this block once the spec passes planner's checks; leave it as it is.
codeworks:
  v: 1
  kind: feature
  root_cause:
    observed: none
---
# Feature Specification: reviewer writes the records the orchestrator acts on, through core

**Feature Branch**: `209-spec`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/209 — reviewer: rebuild
the plugin on core. Write rounds and holds through core's state module (reviewer ADR-0011 d1, d3); read the
session's issue record the orchestrator writes and fence commits on it (reviewer ADR-0015 d1-d2); write the
claim's releases with core's `releaseOnClaim` at its first hook run after a claim, never on a resume (reviewer
ADR-0013 d2); record each commit that passed its check (reviewer ADR-0002 d2)."

## Clarifications

### Session 2026-10-30

- Q: Does this spec build the after-commit check that "passed" means? → A: Yes: it builds ADR-0002 d1's after-commit check and the hooks' own repository copy (ADR-0021 d6), and records passes only from that check.
- Q: Where does the passed-commit record live? → A: Locally, session-scoped, beside the hooks' own copy, through a core contract; not on GitHub. → Superseded by the record's baseline and name: the session's first check grades from the story branch's head on GitHub; the record is renamed the commit-check pass record.
- Q: What does a new session grade from, and what is the record called? → A: Locally kept record plus the pushed head as baseline (the branch head on GitHub means every commit up to it passed the commit check); renamed "commit-check pass record", defined as the pre-push gate only, not a review verdict.
- Q: Should reviewer keep a local copy of rounds and holds between hook runs? → A: No: each deciding hook run reads from GitHub through core and reuses the reading only within that run; ADR-0011 d5 is amended in its own PR.
- Q: Where do the lineage and bug counts that place claim and shim holds live? → A: A `gates` section of the reviewer state snapshot on the story issue, open items only, counts derived from times; a count and the hold it places land in one post.
- Q: Do the claim and shim check memos persist? → A: No: a running check's state and its memos live in session-scoped files only; reviewer keeps no database.
- Q: What happens to today's ledger data at cutover? → A: Nothing migrates; the ledger is deleted, and a PR open at cutover gets a fresh internal round before it can be attested.

## User Scenarios & Testing *(mandatory)*

The actors are the orchestrator's hooks, which attest, push and merge a story from GitHub state alone
(orchestrator ADR-0001, ADR-0004), and the admin, who acts on the loop only through the board and the story
issue (reviewer ADR-0013). reviewer's hook is the one writer of the records below (constitution P6); the
model writes none of them.

### User Story 1 - A story's rounds and holds are on its issue, where the orchestrator reads them (Priority: P1)

Each review round reviewer's hook records, and each hold it places, lands as a state snapshot on the story
issue, written through core's state module as the reviewer App. The orchestrator reads that snapshot and
attests `internal-review` from it: success once an INTERNAL or AUDIT round is CLEAN or CONVERGED_PUSHBACK at
the head or in its history and no hold is open, pending otherwise.

**Why this priority**: The orchestrator attests only from this record. Without it no claimed story is ever
attested, so none is marked ready or merged.

**Independent Test**: With GitHub replaced by a recorder, drive one internal round to CLEAN on a story
branch; check that exactly one state comment was posted on the story issue by the reviewer App's client,
that core's reader returns that round as the newest, and that core's attestation answers success for the
head.

**Acceptance Scenarios**:

1. **Given** a session on issue `#42` and branch `42-us1-login`, **When** an internal round at head `H` is
   recorded CLEAN, **Then** the story issue `#42` gets one new state comment whose snapshot appends that
   round (stage INTERNAL, head `H`, result CLEAN), every earlier round and hold row unchanged.
2. **Given** a round ruled ESCALATE, **When** it is recorded, **Then** the snapshot carries the round and an
   OPEN `escalation-42` hold, placed through core's hold call, and the orchestrator's reading of the issue
   is held.
3. **Given** the newest reviewer App state comment on `#42` was edited, **When** reviewer's hook would
   record a round, **Then** core refuses the write, reviewer refuses the step that needed it, and the
   refusal names the release: a Ready move and an admin's comment (ADR-0011 d2).
4. **Given** a hold placed in one session, **When** a new session on another machine reads `#42`, **Then**
   the hold is still open: nothing about it lived only beside the old session.
5. **Given** a lineage with 2 WRONG rulings recorded in an ended session, **When** a new session's check rules
   it WRONG again, **Then** the snapshot's gates section records the third and `claim-<id>` is placed in the same post (FR-015).
6. **Given** a check whose gates write would leave no room to release every open hold and record one more round,
   **When** it records, **Then** the write is refused naming the sizes and nothing is recorded (FR-016).

---

### User Story 2 - Only commits that passed the commit check are pushed (Priority: P1)

Each commit reviewer's commit check passes is written to the commit-check pass record, where the
orchestrator reads it; the orchestrator's push goes up to the newest commit-check pass and no further
(ADR-0002 d2, orchestrator ADR-0001 d4). A check passes every commit in the range from the newest commit-check
pass to the commit it names (ADR-0002 d1). A commit-check pass is the pre-push gate only: it is not the
internal review round's verdict nor any external reviewer's, which run at a head and after the push.

**Why this priority**: The orchestrator pushes nothing without this record, so no story PR is ever opened.

**Independent Test**: Make three commits A, B, C on a story branch; fail the check of B, pass the check of
C; check the record names C as newest pass and A, B, C as passed, and that before C's check it named A.

**Acceptance Scenarios**:

1. **Given** commits A then B, **When** A's check passes and B's fails, **Then** the record's newest pass is
   A, and B is not recorded as passed.
2. **Given** that state, **When** a later commit C's check passes, **Then** the range from A to C passes and
   C is the newest pass.
3. **Given** a commit whose check could not run, **When** the record is read, **Then** that commit is not
   passed (constitution P4).
4. **Given** a commit in the range touches `.github/`, **When** the range is checked, **Then** the check
   fails and nothing in the range is recorded as passed (ADR-0002 d4).
5. **Given** the story branch on GitHub at A, and B, C passed in a session that ended before its push,
   **When** a new session on the same issue makes its first check, **Then** that check grades the range from
   A, and B, C are pushed only once it passes them (FR-014).

---

### User Story 3 - A session commits only on its own story's branch (Priority: P1)

reviewer's hook reads the session's issue from the record the orchestrator writes when it claims or resumes
a story, and lets a commit land only on a branch starting `<issue>-us`. A session with no recorded issue
commits nothing while reviewer is on.

**Why this priority**: The fence is what ties the rounds and holds of User Story 1 to one story; without
it a session can commit on another story's branch, or on the default branch where no ruleset stands.

**Independent Test**: With the orchestrator's record faked, make a commit on `42-us1-login`, one on
`43-us1-other` and one on `main`; check the first passes the fence and the other two are refused, each
refusal naming the session's issue and the branch prefix it allows.

**Acceptance Scenarios**:

1. **Given** the session's recorded issue is `#42`, **When** a commit is made on `42-us2-logout`, **Then**
   the fence passes it to its checks.
2. **Given** the same session, **When** a commit is made on `43-us1-other` or `main`, **Then** it is refused,
   naming `#42` and the prefix `42-us`.
3. **Given** a session with no recorded issue and reviewer on, **When** any commit is made, **Then** it is
   refused, naming both ways forward: `/codeworks <issue>`, or `reviewer off` (ADR-0015 d2).
4. **Given** reviewer is switched off in the session, **When** a commit is made with no recorded issue,
   **Then** the fence does not apply, no check runs, and the commit is pushed unreviewed (FR-019).
5. **Given** the record cannot be read, **When** a commit is made, **Then** it is refused as a check that
   could not run, never passed as unfenced (constitution P4).

---

### User Story 4 - A Ready claim releases the holds an admin answered, once (Priority: P1)

When the orchestrator claims a story from Ready, reviewer's hook, at its first run after that claim, calls
core's `releaseOnClaim` for the story issue: every open hold for which a Ready move and an admin's comment
both follow the state comment that placed it is released, in one new snapshot. A resumed story (card In
progress or In review) releases nothing.

**Why this priority**: An open hold keeps `internal-review` pending. Without the release, a story that was
held is never attested again, whatever the admin does.

**Independent Test**: Seed `#42` with an OPEN `claim-7` hold, then a Ready move and an admin comment after
it; fake the orchestrator's record as a claim, run reviewer's hook twice; check one release snapshot was
posted, on the first run only. Repeat with the record faked as a resume; check none was posted.

**Acceptance Scenarios**:

1. **Given** an open hold answered by a Ready move and an admin's comment, **When** the orchestrator claims
   the story, **Then** reviewer's first hook run after the claim posts one snapshot with that hold RELEASED,
   naming the comment that released it.
2. **Given** the same claim, **When** reviewer's hook runs again in that session, **Then** it calls no
   release.
3. **Given** a story resumed from In progress, **When** reviewer's hook runs, **Then** it releases nothing,
   even where a Ready move and an admin comment would qualify.
4. **Given** a hold with no admin comment after it, **When** the story is claimed, **Then** that hold stays
   OPEN.
5. **Given** an admin's `/codeworks reset` after a hold, **When** the story is claimed, **Then** that hold is
   released and marked as released by a reset (ADR-0013 d3).

---

### Edge Cases

- **Two claims in one session** (a story finishes and an admin names another): each claim gets its own
  first-run release, on its own issue.
- **The orchestrator's record names an issue reviewer cannot see on `[shared] board`**: core raises
  `BoardNotVisible`; every state read or write for it refuses as a check that could not run.
- **A snapshot over GitHub's comment limit**: core refuses the write; reviewer refuses the step and reports
  it, and records nothing locally in its place.
- **reviewer and the orchestrator hooks run in parallel on the claiming prompt**: the release is made at
  reviewer's first run after the claim is recorded, not on the same event, as ADR-0013 d2 decides.
- **The state changes on GitHub between two hook runs** (an edit, an admin comment, a reset): the next hook
  run that decides reads it, since no copy outlives a run (FR-004).
- **GitHub cannot be read**: a hook run that decides refuses as a check that could not run (constitution P4).
- **A session dies mid-check**: its memos die with it; the next session grades the range from the pushed head
  again (FR-014, FR-017).
- **A PR open at cutover with rounds in the old ledger**: its story issue has no state, so `internal-review`
  stays pending until a fresh internal round is recorded (FR-018).
- **A commit made by a route other than `git commit`** (rebase, cherry-pick, a script): it is checked after
  it is made like any other (ADR-0002 d1, ADR-0020 d2) and passed or not on the same record.
- **reviewer in `log` mode**: rounds, holds, releases and commit-check passes are still recorded; only refusals
  are downgraded to `would_deny`.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: reviewer MUST record every round and every hold on the story issue through core's state
  module (`writeState`, `placeHold`, `placeRescopeHold`), posting as the reviewer App, and through no other
  path (ADR-0011 d1, d3).
- **FR-002**: reviewer MUST read a story's state only through core's reader, and act on its answer: a held
  or tampered state refuses what it refuses, naming the release core gives.
- **FR-003**: Rounds and holds MUST use core's value sets (`RoundStage`, `RoundResult`, `RoundVerdict`,
  `HoldKind`, `HoldState`); reviewer repeats no value's string (root ADR-0010).
- **FR-004**: reviewer MUST keep no copy of rounds or holds between hook runs: each hook run that decides on
  them reads the state from GitHub through core and reuses that reading only within the run. This needs
  ADR-0011 d5 amended in its own PR before this spec's code.
- **FR-005**: reviewer MUST read the session's issue from the record the orchestrator writes on a claim or a
  resume, and refuse every commit on a branch not starting `<issue>-us` (ADR-0015 d1).
- **FR-006**: While reviewer is on, a session with no recorded issue MUST have every commit refused,
  naming `/codeworks <issue>` and `reviewer off` (ADR-0015 d2).
- **FR-007**: At its first hook run that finds the session's issue record naming a claim, reviewer MUST call
  core's `releaseOnClaim` for the story issue exactly once for that claim, before it lets a commit or round
  through; for a resume, or with no record, it MUST NOT call it (ADR-0013 d2, orchestrator ADR-0002 d3, VP-002).
- **FR-008**: No reviewer path other than FR-007 MUST release a hold. The `unlock` prompts no longer release
  any hold that lives in the issue's state (ADR-0013, Option E rejected).
- **FR-009**: reviewer MUST record each commit its check passes, every commit of the graded range included,
  where the orchestrator reads it, and MUST NOT record a commit whose check failed or could not run
  (ADR-0002 d1, d2).
- **FR-010**: Every refusal these requirements add MUST name the next legal step (constitution P1).
- **FR-011**: Every reviewer script these requirements make call core MUST be TypeScript; no Python calls
  core (root ADR-0009 d2).
- **FR-012**: This spec MUST build the after-commit check of ADR-0002 d1, run against a repository copy the
  hooks own and fetch the session's commits into (ADR-0021 d6), and record passes only from that check; the
  rest of the Python plugin moves only where it comes to call core (root ADR-0009 d2).
- **FR-013**: reviewer MUST read the session's issue record only through core, as #174 defines and adds it:
  one file per session naming the repository, the issue, claim or resume, and the claim's time (VP-001). This
  spec adds nothing to that record.
- **FR-014**: The commit-check pass record MUST live beside the hooks' own repository copy, scoped to the
  session, read and written only through a core contract this spec adds; nothing of it is written to GitHub. Passes are kept per branch, so a session's second story branch or second claim keeps its own newest pass; a branch's newest pass is the head it most recently passed, even one that had passed before.
  A session's first check MUST grade from the story branch's head on GitHub, which only commit-check passes
  reach; commits a dead session passed but never pushed are graded again.
- **FR-015**: reviewer MUST keep the counts that place `claim-<id>` and `shim-<id>` holds in a `gates` section of
  the state snapshot on the story issue, read and written through core with the state's fail-closed rules
  (ADR-0011 d2); a count and the hold it places MUST land in one post. It holds the story's one branch, the anchor commit
  the stored positions index into and the open items only: per lineage its places and its chain of rulings,
  each with its check, claim, words, ruling and time; per bug its counted and absorbed trees with times, its
  ranges, its deep-sweep lists and its site rulings. Counts and release floors MUST be derived from those
  times against the reset and the hold row's release, never stored; a check counts once; a merged bug carries
  the higher of its bugs' counts, never their sum (ADR-0008 d2). A check MUST look for the anchor in the hooks'
  bare copy, then fetch it by its sha from the model's clone, then from GitHub; when none has it, the check MUST
  stop with an error naming the anchor and `/codeworks reset`. Once a reset is newer than every time in the
  section, a check that cannot find the anchor MUST drop its lineages and bugs and anchor on its own head. The
  thresholds are `[reviewer]` keys: `claim_hold_at`, `shim_deep_at`, `shim_hold_at`, none in code.
- **FR-016**: Core's snapshot contract MUST gain `gates: Gates | null`, changed only by one call that posts the
  gates change and the holds it places together; every other write MUST refuse a `gates` differing from the one it
  read, and the gates call MUST refuse a snapshot that would not fit with every open hold released and one more
  round recorded. This core change and the amendments to reviewer ADR-0001 d2, ADR-0008, ADR-0011 d1 and
  ADR-0013 d4 land in their own PRs before this spec's code.
- **FR-017**: The state of a running commit check and its read and verdict memos MUST live only in
  session-scoped files beside the commit-check pass record; reviewer MUST keep no database, and nothing of
  these persists across sessions. ADR-0004 d4's "ledger" is amended to the check's record in its own PR.
- **FR-018**: At cutover nothing in the SQLite ledger MUST be migrated; the ledger and its code are deleted,
  and a PR open at cutover gets a fresh internal round before it can be attested.
- **FR-019**: While reviewer is off, it MUST run no check and record no commit-check pass; the session's
  commits are committed and pushed unreviewed, and the push takes no pass record into account. The switch is
  written to the commit-check pass record (`off`), so the orchestrator reads it through the same core contract.
  An off session records no internal round, so nothing attests its PR: it merges only under an admin's exempt
  label (ADR-0015 d2), never by the switch alone.
- **FR-020**: Two hook runs of one session MUST NOT write reviewer state from the same reading: each
  write, and the release on claim, is serialised per session from its read to its post.
- **FR-021**: The after-commit check MUST grade only from a base that is an ancestor of the commit checked:
  the branch's newest commit-check pass, else the branch's head on GitHub; when neither is an ancestor, pushed
  history was rewritten and the check refuses, naming the pushed head to restore.

### Key Entities

- **State snapshot**: core's `Snapshot`: the story's rounds, holds and pushbacks, posted whole as a tagged
  reviewer App comment on the story issue; the newest wins.
- **Hold**: a row keyed `<kind>-<id>`, OPEN or RELEASED; once placed, its row stays.
- **Session's issue record**: what the orchestrator writes when it claims or resumes a story: the issue
  the session builds and whether it was a claim from Ready.
- **Commit-check pass record** (#174 calls it the passed-commit record): the commits reviewer's after-commit
  check passed on the story branch, and the newest of them. A pass clears a commit to be pushed; it is not a
  review verdict.
- **Claim release**: core's `releaseOnClaim` answer: the holds released, whether the snapshot was rebuilt,
  and the reset that released any.
- **Gates section**: the state snapshot's `gates`: the open lineages and bugs whose counts place `claim-<id>`
  and `shim-<id>` holds; ended items are dropped.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A story taken from Ready through a CLEAN internal round reaches `internal-review` success with
  no admin act, in an end-to-end test run against a recorder.
- **SC-002**: 100% of rounds and holds reviewer records are readable by core's reader from the story issue;
  zero are kept anywhere else between hook runs (FR-004).
- **SC-003**: Zero commits land outside `<issue>-us*` while reviewer is on, across the fence's tests.
- **SC-004**: Exactly one release per claim and zero per resume, across repeated hook runs.
- **SC-005**: Zero commits whose check failed or could not run are recorded as passed.

## Assumptions

- The orchestrator (#174) writes the session's issue record and reads the commit-check pass record; this spec
  writes neither of the orchestrator's sides.
- Core's state module (`core/src/state.ts`) is the contract for rounds and holds as it stands; a change to
  the snapshot's shape is a core change, not one made here (ADR-0011, Consequences).
- The reviewer App, `codeworks-reviewer`, exists and its key is readable by hooks on the agent machine
  (root ADR-0008).
- RESHAPE_SPEC and the PR-keyed `unlock` lock map to core's RESCOPE verdict and `rescope-<issue>` hold
  (ADR-0013 d5); the PR-keyed ledger is replaced by issue-keyed state.
- Pushes, check runs, lane moves and merges remain the orchestrator's; reviewer writes none of them
  (ADR-0012 d2).

## Verified Premises

- **VP-001**: #174's spec defines the session's issue record: a file per session at
  `~/.local/state/codeworks/orchestrator/sessions/<session id>.json`, written through core after the claim's
  lane write, naming the repository, the issue, claim or resume, and the claim's time; reviewer and builder read
  it, the model cannot write it. It lands in core before #174 Story 1 (`specs/174-orchestrator-plugin/spec.md`
  FR-014 and Assumptions, PR #216).
- **VP-002**: #174's spec has reviewer write the releases at its first hook run that finds the record naming a
  claim, before it lets a commit or round through, never for a resume or with no record (same spec, FR-015).
- **VP-003**: #174's push takes only commits reviewer's commit-check pass record names, from a copy the hooks own;
  that record lands in core before #174 Story 2 (same spec, FR-016 and Assumptions).
- **VP-004**: `releaseOnClaim` already releases holds an admin's `/codeworks reset` answers and reports the reset
  (`core/src/state.ts`, `ClaimRelease`).
- **VP-005**: Today's reviewer gates a commit before it is made (`claimgate.on_commit`, `shimgate.on_commit` on
  PreToolUse in `reviewer/plugin/scripts/gate.py`); no check runs after a commit and no hooks-owned copy of the
  repository exists (ADR-0002 d1 and ADR-0021 d6 are not built).

## Why this is worth doing

### harm
Answer: A story claimed by the orchestrator is never attested, pushed or merged: the orchestrator attests only from rounds and holds in core's state, and pushes only recorded passed commits; reviewer still keeps rounds in a local SQLite ledger and writes neither, so the loop stalls on every claimed story.
Source: code: reviewer/plugin/scripts/ledger.py (SQLite ledger keyed by PR); issue #209 body; orchestrator ADR-0004; issue #174 Story 2 ("after reviewer's state lands")

### reachable
Answer: predicted. orchestrator/ holds only docs/ and README.md on main, so no story is claimed yet; it happens as soon as #174 lands.
Source: code: orchestrator/ tree on main (docs/, README.md only); issue #174 body

### change-alters
Answer: Yes. Reviewer writes rounds and holds via core/src/state.ts, writes releases with releaseOnClaim on the first hook run after a claim, fences commits on the orchestrator's session-issue record, and records passed commits; the orchestrator then reads an attestable state and a push list, and the story proceeds to attest, push, ready, merge.
Source: code: core/src/state.ts (releaseOnClaim at line 569, placeHold, stateFrom); reviewer ADR-0011, ADR-0013 d2, ADR-0015, ADR-0002 d2

### owner
Answer: No. Core provides the state module and releaseOnClaim but no caller in reviewer; core has no session-issue record or passed-commit record yet (listed under #174 "Needs from core first"). No test or CI check asserts reviewer writes through core.
Source: code: git grep releaseOnClaim → only core/src/state.ts and core tests; git grep for session-issue/passed-commit in core/src → none; issue #174

### inherited
Answer: Yes: from accepted reviewer ADR-0011 (state via core), ADR-0013 d2 (release on claim), ADR-0015 d1-d2 (fence on session issue), ADR-0002 d2 (push only passed commits) and orchestrator ADR-0004 (attest from core state). Those decisions are accepted and their harm is the stall above; the premise holds.
Source: code: reviewer/docs/adr/0002, 0011, 0013, 0015; orchestrator/docs/adr/0004

### needs-spec
Answer: It has decisions: how much of the Python plugin moves to core's TS (whole rebuild vs. state path only), where the passed-commit and session-issue records live and who adds them to core (shared with #174), ordering against #174 Story 1, and the fate of the SQLite ledger.
Source: code: reviewer/plugin/scripts/*.py (24 Python modules), reviewer/plugin/hooks/hooks.json; issue #174 "Decide in this spec" and "Needs from core first"

## Root cause

Not a defect report.
