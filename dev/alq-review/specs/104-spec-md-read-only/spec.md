# Feature Specification: spec.md is read-only on a story branch

**Feature Branch**: `104-spec` (#104)

**Created**: 2026-10-13

**Status**: Draft

**Input**: Issue #104, "alq-review: spec.md is read-only on a story branch; a spec change lands in its own spec-only
PR"

**Settled with the user**: in issue #104, "Decision" 1-5 (2026-10-13), with the decision flow and evidence at
https://claude.ai/artifact/318JN3nQhSgcXqCuP18CdD, and in Clarifications below. Decision record: an ADR drafted from
this spec's plan with `speckit-adrkit-draft`, in its own PR, which replaces ADR-0016 decision 6 and the blob-id part of
decision 4, replaces the `spec.md`-blob part of ADR-0019 decision 3 (open PR #93) and that record's closing line
"ADR-0016, decision 6, and ADR-0018 stand", and changes ADR-0018 for a `RESHAPE_SPEC` lock. The engineering
`git-workflow.md` change, spec PR first and then the story PR, is its own PR in the engineering repo. This spec states
the behaviour wanted, at the level of its scenarios; the wording of each refusal and next step is the plan's and the
tests'.

## What we want

The coding agent never changes the spec it is graded against. A review launch is refused on a PR that changes a
`spec.md` and code together, whatever wrote the change; on a story branch an edit tool's write to a `spec.md` is
refused sooner, at the tool. A spec that turns out wrong is raised to the user and
changed in a PR of its own that changes only the spec folder; the story branch rebases on it. The gate keeps no copy
of the spec's text: every round grades against `spec.md` as it is in the commit under review, so there is nothing to
hold and nothing to `unlock` for a spec edit. A `RESHAPE_SPEC` lock stays while the spec is rescoped; the user's
`rebase <ref>` releases it once the bound `spec.md` has changed on the default branch, and the session rebases the story
branch on it before the next round.

## Clarifications

### Session 2026-10-13

- Q: Which branches is spec.md read-only on? → A: Story branches by name, `<issue>-us<N>-<slug>`; the mixed-diff check (User Story 4) covers a branch named otherwise.
- Q: Which branch does a rescope use? → A: `<issue>-spec` again, fresh off the default branch; if a merged `<issue>-spec` still exists, the skill stops and names it for the user to delete.
- Q: Does deleting a spec.md count for the mixed-diff check? → A: No, adds or modifies only: a deleted spec.md grades nothing, and a round bound to that folder is already refused when its spec.md is missing at the reviewed commit.
- Q: How is the decision recorded? → A: An ADR drafted from this spec's plan with `speckit-adrkit-draft`, in its own PR; PR #105 (hand-written ADR-0020) is closed.
- Q: When does the user release a `RESHAPE_SPEC` lock? → A: The story stays locked while the rescope runs on the spec branch; once the spec PR merges, the user types a new keyword, `rebase <ref>`, which rebases the story branch on the default branch, checks only that the bound spec.md changed, releases the lock, and later rounds grade against the new spec.md.
- Q: What does `rebase <ref>` do, and what if the rebase conflicts? → A: The hook checks the bound spec.md changed on the default branch before rebasing, then rebases; a conflict is resolved by a conflict-resolver agent without the user, and the keyword is safe to repeat.
- Q: Can `unlock` still release a `RESHAPE_SPEC` lock? → A: Yes, when the user rules the spec stands; `rebase <ref>` releases it after a spec change.
- Q: Is `rebase` its own user story? → A: Yes: User Story 2 deletes the hold; User Story 3 is the `rebase` keyword and the conflict-resolver agent; the diff check and the rescope are User Stories 4 and 5.
- Q: Who pushes the rebased story branch? → A: The hook, with `git push --force-with-lease`, as part of `rebase <ref>`; a refused push keeps the lock.

### Session 2026-10-14

- Q: Who runs the rebase after `rebase <ref>`? → A: The session, not the gate. The gate checks that the bound spec.md changed on the default branch, releases the lock and records the default branch's commit; the session rebases, dispatches the conflict-resolver agent on conflicts and pushes; the next round is refused until the branch contains that commit. This replaces the hook-run rebase in answers 5 and 6 and the hook push in answer 9.
- Q: Where is a spec.md write refused? → A: In two places: the review-round launch refuses a PR whose diff changes a spec.md and code (User Story 4), the gate that keeps the graded spec from changing beside code; and on a story branch `Edit`, `Write` and `NotebookEdit` of a spec.md are refused by path (User Story 1). Bash writes, the commit and a rebase in progress are not judged by User Story 1; the launch catches what they carry. A spec folder's move gets its own diff-check reply, naming both folders and the two-PR route. This narrows issue #104 Decision 1, which named Bash.
- Q: How is the first round after a rebase that skipped `rebase <ref>` reviewed? → A: In full: a review-round launch whose last counted round's head is not an ancestor of HEAD reviews the PR's whole diff, whatever rebased the branch. Only a release by `rebase <ref>` restarts the round facts (FR-010), so the agent cannot reset its own measurement by rebasing.

## Terms

- **A spec.md**: a file named `spec.md` whose folder sits in a folder named `specs`, the shape
  `specbinding.shape_problem` accepts. `docs/spec.md` is not one.
- **Story branch**: a branch whose name starts `<digits>-us<digits>-`, the engineering git workflow's
  `<issue>-us<N>-<slug>`. `<issue>-spec`, `<issue>-adr-<slug>`, `<issue>-retire-spec` and every other name are not.
- **Spec branch**: `<issue>-spec`, where a spec first lands and where a rescope runs.
- **Spec-only PR**: a PR whose diff against its base changes files of one spec folder and nothing else. It goes
  through the full review loop, like any PR: internal rounds with `spec: null`, then Codex and DeepSource.
- **The reviewed commit**: the commit a round reviews, the checkout's HEAD at launch (the round's `head_sha`).
- **The PR's diff**: the change under review, from the base the gate measures a round from (where HEAD left the
  branch the PR merges into, as the remote has it) to the reviewed commit.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A story branch's edit tools cannot change a spec.md (Priority: P1)

An agent on a story branch tries to write a `spec.md` by an edit tool. It is refused and told the one route a spec
change takes: stop, raise it to the user, and land it as a spec-only PR on the spec branch.

**Why this priority**: it is the agent's usual route to the file, refused before any work builds on the change.
User Story 4 is the gate; this rule only catches the common case sooner.

**Independent Test**: drive the gate hook in `dev/alq-review/tests/test_gate.py`'s harness on a checkout whose
branch is a story branch, send each write, and read the refusal; send the same writes on a spec branch and see them
pass this rule.

**Acceptance Scenarios**:

1. **Given** a checkout on `123-us2-reset` with `dev/x/specs/123-login/spec.md`, **When** `Edit`, `Write` or
   `NotebookEdit` names that file, **Then** it is refused, naming the file, saying a story branch never changes a
   spec.md, and giving the next step: stop and raise the spec problem to the user, who lands the change in a
   spec-only PR on `123-spec`, after which this branch rebases on it.
2. **Given** a checkout on `123-spec`, `123-retire-spec`, `123-adr-hold` or the default branch, **When** an edit
   tool names that file, **Then** this rule refuses none of them.
3. **Given** a story branch, **When** a write names `plan.md`, `tasks.md`, `research.md` or any other file of the
   spec folder, **Then** this rule refuses none of them: a story PR ticks its tasks.
4. **Given** a story branch and no PR, no ledger and no round, **When** an edit tool names a spec.md, **Then** it
   is refused all the same: the rule reads the branch, not the ledger.
5. **Given** a story branch, **When** a Bash command writes a spec.md or a commit changes one, **Then** this rule
   refuses neither; User Story 4 refuses the launch of a PR that carries the change beside code.
6. **Given** `log` mode, **When** a write is refused by this rule, **Then** it is recorded as `would_deny` and not
   blocked, as Mode says of the spec refusals.

---

### User Story 2 - Every round grades against spec.md at the reviewed commit, and the gate keeps no copy (Priority: P2)

A round opens against whatever `spec.md` the reviewed commit holds. The ledger records the bound `spec` value and
nothing of the file: no blob id, no text, no hold. A changed `spec.md` holds nothing and asks for no `unlock`.

**Why this priority**: it deletes the hold whose tests did not converge (PR #102) and the ledger state behind it.
It comes after User Story 1 because with the hold gone and no read-only rule, the agent could move its target
freely.

**Independent Test**: in the same harness, bind a PR to a folder, commit a change to its `spec.md`, launch the next
review round and the assessment, and read the ledger and the refusals.

**Acceptance Scenarios**:

1. **Given** a PR bound to a folder whose `spec.md` at the reviewed commit differs from the one its first round
   saw, **When** a review round or an assessment launches, **Then** it opens; no diff is shown, no hold is
   recorded and no `unlock` is asked for.
2. **Given** a PR whose round has opened, **When** its ledger is read, **Then** it holds `spec` and neither
   `spec_blob` nor `spec_held`.
3. **Given** a bound folder, **When** the internal reviewers and the assessor are briefed, **Then** they are told
   to read `<folder>/spec.md` in the checkout, as today, and are quoted none of its text.
4. **Given** a launch whose `spec.md` is missing or empty at the reviewed commit, **When** it launches, **Then** it
   is refused naming the path, as today (ADR-0016 decision 3).
5. **Given** a locked branch, **When** the lock reason is given, **Then** it names the `RESHAPE_SPEC`, `ESCALATE`
   or spent-audit hold and never a changed `spec.md`.
6. **Given** a ledger written before this change with `spec_blob` or `spec_held`, **When** it is read, **Then**
   nothing reads those keys: a PR that only a changed `spec.md` held is held no longer.

---

### User Story 3 - `rebase` releases a `RESHAPE_SPEC` lock after a spec change (Priority: P3)

A `RESHAPE_SPEC` lock stays on the story while its spec is rescoped on the spec branch. Once the spec PR merges, the
user types `rebase <ref>`: the gate checks that the bound `spec.md` changed on the default branch, releases the lock,
records the default branch's commit and tells the session to rebase the story branch on it, with a conflict-resolver
agent for any conflict, and push. The next round waits until the branch contains that commit. The session, not the
gate, rebases and pushes (FR-009). `unlock <ref>` releases the lock instead when the user rules the spec stands.

**Why this priority**: it closes the loop User Story 1 opens: a story told to stop for a wrong spec needs a way back
to work on the changed spec. It needs User Story 2, whose rounds grade against the new `spec.md` with no hold.

**Independent Test**: in the same harness, lock a story with a `RESHAPE_SPEC` ruling, merge a change to its bound
`spec.md` into the default branch (or not), send `rebase <ref>` and `unlock <ref>` as the user's prompt, and launch
the next round before and after the story branch is rebased.

**Acceptance Scenarios**:

1. **Given** a `RESHAPE_SPEC` lock, **When** a mutation is refused, **Then** the refusal carries the ruling and
   names the next step: rescope on the issue's spec branch, land it as a spec-only PR, and once it merges type
   `rebase <ref>`, or `unlock <ref>` if the user rules the spec stands. The lock stays while the rescope runs; the
   spec branch is another PR and is not locked by it.
2. **Given** a `RESHAPE_SPEC` lock and a default branch whose bound `spec.md` differs from the one at the locked
   round's reviewed commit, **When** the user types `rebase <ref>`, **Then** the lock is released, the default
   branch's commit is recorded, and the reply gives the session its next step: rebase the story branch on the
   default branch, dispatch the conflict-resolver agent on conflicts, push with `git push --force-with-lease`, and
   run the next round. Only whether the file differs is checked, not how, and git changes only as FR-009 allows.
3. **Given** a `RESHAPE_SPEC` lock and a default branch whose bound `spec.md` is the same as at the locked round's
   reviewed commit, **When** the user types `rebase <ref>`, **Then** the lock stays and the reply says the spec PR
   has not reached the default branch: land it first, or type `unlock <ref>` if the spec stands.
4. **Given** a `RESHAPE_SPEC` lock on a story PR whose base is not the default branch (a stacked story PR), **When**
   the user types `rebase <ref>`, **Then** the lock stays, and the reply names the next step: land the parent PR
   first.
5. **Given** a `RESHAPE_SPEC` lock and a default branch where the bound `spec.md` is missing or empty (a rescope
   moved or deleted its folder), **When** the user types `rebase <ref>`, **Then** the lock stays, and the reply says the
   binding never changes: close this PR and restart the story on the new folder.
6. **Given** a `RESHAPE_SPEC` lock, **When** the user types `unlock <ref>`, **Then** the lock is released with no
   spec check and nothing recorded, and the reply carries the ruling: the user has ruled the spec stands.
7. **Given** a lock released by `rebase <ref>` and a story branch that does not yet contain the recorded commit,
   **When** a review round launches, **Then** it is refused, saying to rebase onto the default branch first.
8. **Given** a lock released by `rebase <ref>` and a story branch that contains the recorded commit, **When** the
   next review round launches, **Then** it is a full round over the PR's diff, not a delta from the last round
   before the release, and its facts are measured as FR-010 says: a file edited in three rounds before the rebase is
   not at a third edit, and the round is compared with no round before the release. After a release by `unlock <ref>`
   the rounds are measured as before.
9. **Given** the session's rebase stopped on conflicts, **When** it dispatches the conflict-resolver agent, **Then**
   the agent resolves them in that checkout and continues the rebase; it never edits a spec.md. A conflict in a
   spec.md, or a conflict the agent cannot resolve, makes it abort the rebase and report it, and the session raises
   it to the user. A spec.md change the rebase leaves on the branch is refused at the next launch (User Story 4).

---

### User Story 4 - A PR changes the spec or the code, never both (Priority: P4)

A review-round launch, an audit included, is refused on a PR whose diff adds or modifies a spec.md and changes any
file outside that spec folder.

**Why this priority**: it is the gate. It refuses a spec change beside code whatever route wrote it (a Bash write,
a commit, a rebase), and it is what makes "spec PR first, then the story PR" a rule code decides.

**Independent Test**: in the same harness, build branches whose diffs mix and separate spec and code, and launch
rounds on each.

**Acceptance Scenarios**:

1. **Given** a PR whose diff adds or modifies `dev/x/specs/123-login/spec.md` and changes `b.py`, **When** a review
   round launches with any `spec` and any stage, **Then** it is refused, naming the spec.md and a file outside its
   folder, with the next step: land the spec change as a spec-only PR on `123-spec`, rebase this branch on it, and
   launch again.
2. **Given** a spec-only PR, **When** a round launches with `spec: null`, **Then** this check passes, and the
   reviewers are told the change needs no spec.
3. **Given** a PR whose diff changes `b.py` and `dev/x/specs/123-login/tasks.md`, **When** a round launches,
   **Then** this check passes.
4. **Given** a PR whose diff deletes a spec.md and changes code outside its folder, the retirement of a spec folder
   with its citations, **When** a round launches with `spec: null`, **Then** this check passes: it concerns a
   spec.md present at the reviewed commit; a round bound to the deleted folder is refused as User Story 2
   scenario 4 says.
5. **Given** a PR on a branch named otherwise than a story branch, **When** its diff mixes a spec.md and code,
   **Then** the launch is refused all the same: the diff check reads the diff, not the name.
6. **Given** `log` mode, **When** the check refuses, **Then** it is recorded as `would_deny` and the launch opens.
7. **Given** a story branch rebased on the default branch after its last round, without `rebase <ref>` (the next step
   of scenario 1), **When** the next review round launches, **Then** it is a full round over the PR's diff, not a
   delta from the last round's head, and its facts are measured as before (FR-011).

---

### User Story 5 - A rescope runs on the spec branch (Priority: P5)

`/alq-plan:issue-spec rescope <folder> #<issue>` works in the issue's spec branch worktree, never the story PR's,
so the rescoped `spec.md` lands as a spec-only PR.

**Why this priority**: with User Story 1 built, the rescope as written today (the story PR's worktree) is refused
at its first write of `spec.md`; the loop does not close without this. It is one skill's prose, in `alq-plan`.

**Independent Test**: run the skill's entry-point resolution on a rescope and read the checkout it names and the
two closing lines.

**Acceptance Scenarios**:

1. **Given** `rescope dev/x/specs/123-login #123`, **When** the skill resolves `CHECKOUT`, **Then** it is the
   worktree of `123-spec`, created off the default branch per the repo's branch rules when there is none.
2. **Given** `rescope dev/x/specs/123-login #123` and a branch `123-spec`, local or on the remote, that is already
   merged into the default branch, **When** the skill resolves `CHECKOUT`, **Then** it stops before any write,
   naming that branch and asking the user to delete it; it never reuses a merged branch.
3. **Given** the run completes, **When** the skill commits and pushes, **Then** they land on `123-spec`, and the
   skill's closing lines name that folder and that branch; the spec-only PR, its approval, the story branch's rebase
   and the relaunched review are the user's next steps, named once.

---

### Edge Cases

- A story branch created off `<issue>-spec` before the spec PR merged carries the spec in its diff: User Story 4
  refuses its launch until the spec PR merges and the branch rebases on the default branch.
- A spec-only PR that changes two spec folders, a move of a spec folder included, is refused by User Story 4: a
  move is a deletion at the source and an addition at the destination, and the old folder is outside the new one.
  The refusal names both folders and the two-PR route, not the spec-or-code reply: one PR adds the new folder; a
  later one deletes the old folder and updates its citations, which passes, since a deleted spec.md is not read as a
  change to it. Or it is the user's call with the switch (`alq-review off`).
- A write to a spec.md of another checkout by its absolute path is judged by that checkout's branch, not the
  command's directory.
- During a rebase in a story checkout HEAD is detached, so the story-branch rule of User Story 1 refuses nothing;
  a spec.md change the rebase leaves is refused at the next launch (User Story 4).
- Audit reviewers are still not given the spec; the diff check applies to an audit launch as to any other.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: On a story branch, every `Edit`, `Write` and `NotebookEdit` of a spec.md MUST be refused with the next
  step User Story 1 names. The rule MUST read the checkout's branch and nothing from the ledger; a detached HEAD is no
  story branch. Bash writes and commits are not judged by it. The writes of every other file, and the same writes on
  any other branch, MUST pass it.
- **FR-002**: Every review-round and assess-round launch MUST read `spec.md` at the reviewed commit and nothing of
  any earlier version. The ledger MUST record the `spec` value only: no blob id, no text, no hold.
- **FR-003**: A changed `spec.md` MUST hold nothing and ask for no `unlock`.
- **FR-004**: A review-round launch of any stage MUST be refused on a PR whose diff adds or modifies a spec.md and
  changes a file outside that spec folder. When that file is in no spec folder, the refusal names both and the next
  step User Story 4 names; when every changed file is under a spec folder (two folders, or a folder's move), it names
  the two folders and the two-PR route of Edge Cases.
- **FR-005**: The refusals of FR-001 and FR-004 MUST follow the plugin's mode alone (ADR-0017 decision 3): in `log`
  mode they are recorded and nothing is blocked.
- **FR-006**: The `issue-spec` rescope MUST run in the spec branch's worktree, `<issue>-spec` created fresh off the
  default branch, and land its commit there. It MUST stop, naming the branch, when a merged `<issue>-spec` still exists.
- **FR-007**: The README MUST describe the rule, the diff check, the `rebase` keyword and the ledger as they then
  are, and name no spec hold, `spec_blob` or `spec_held`.
- **FR-008**: Tests MUST be written first and seen to fail for the reason expected, covering the scenarios and edge
  cases above; the tests of the hold and its release MUST go with it.
- **FR-009**: A `RESHAPE_SPEC` lock MUST stay while the rescope runs, and its refusal MUST name the rescope on the spec
  branch and then `rebase <ref>`, or `unlock <ref>` if the spec stands. `rebase <ref>` MUST check against the repo's
  default branch, never the PR's base, and keep the lock, with a reply naming the next step, when: the PR's base is not
  the default branch (a stacked story PR: land the parent PR first; a branch with no open PR has no base to be stacked
  on and passes); the bound `spec.md` is missing or empty on the default branch (the binding never changes: close this
  PR and restart the story on the new folder); it is the same as at the locked round's reviewed commit (land the spec PR
  first, or `unlock <ref>` if the spec stands); or git or gh cannot answer a check (their words). The gate's one git
  write MUST be the fetch's update of `origin/<default>`: it changes no local branch, checkout, worktree or remote
  branch. When every check passes it MUST release the lock as `unlock <ref>` does, record the default branch's commit it
  read, replacing one an earlier release recorded, and reply the session's next step: rebase the story branch on the
  default branch, dispatch the conflict-resolver agent on conflicts, push with `git push --force-with-lease`, and run
  the next round. A review-round launch MUST be refused until the story branch contains that commit, and with git's
  words when git cannot say whether it does. The conflict-resolver agent MUST never edit a spec.md, and MUST abort the
  rebase and report when a spec.md is in conflict or it cannot resolve a conflict; the session raises that to the user.
  `unlock <ref>` MUST release a `RESHAPE_SPEC` lock when the user rules the spec stands, and stays the release of an
  `ESCALATE` or spent-audit lock (ADR-0018).
- **FR-010**: A release by `rebase <ref>` MUST start the PR's measurement again: the next review round MUST be a full
  round over the PR's diff, and a round's facts (the edits per file, the lines fixes wrote, the additions) MUST count
  only the commits since the first round after the release, and compare the round only with the rounds since then. A
  release by `unlock <ref>` MUST change neither.
- **FR-011**: A review-round launch whose last counted round's head is not an ancestor of HEAD, or is a commit the
  checkout does not know, MUST be a full round over the PR's diff, whatever rewrote the branch. It MUST NOT restart
  the round facts; only FR-010's release does.

### Key Entities

- **Story branch**: a branch named `<issue>-us<N>-<slug>`; the one place a spec.md is read-only.
- **Spec-only PR**: the one route a spec change takes to the default branch; approved by the user.
- **Binding**: what a PR is held to: not yet bound, bound to `null`, or bound to a spec folder. The text of its
  `spec.md` is no longer part of it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every scenario and edge case above has a test in `dev/alq-review/tests` (User Story 5's in
  `dev/alq-plan/tests`) that failed before the code and passes after.
- **SC-002**: No PR a round opens on changes a spec.md and code together (User Story 4), and no edit tool writes a
  spec.md on a story branch (User Story 1): both refusals, and both diff-check replies, are driven in the tests.
- **SC-003**: `spec_blob`, `spec_held` and `text_step` appear nowhere in `plugins/alq-review` or its README. The tests
  of User Story 2 name `spec_blob` and `spec_held`, to prove nothing reads them.
- **SC-004**: A `spec.md` change between two rounds of one PR costs no `unlock`: the second round opens in the
  tests with no hold recorded.
- **SC-005**: CI is green.

## Assumptions

- The decision record is drafted from this spec's plan with `speckit-adrkit-draft` and lands in its own PR, with
  the README pointer; the hand-written ADR-0020 and its PR #105 are closed. The engineering `git-workflow.md`
  change ("The spec changes through its own PR") is its own PR too. This spec is not graded for either.
- Reading the branch name for this rule is the user's answer in Clarifications. ADR-0019 decision 1, "review reads neither the
  branch name nor the PR body", is about the `spec` and `story` arguments and stands.
- No migration of stored ledgers: the keys of the hold are no longer read. The one PR held by a changed `spec.md`
  on 2026-10-13, #102, is superseded by this issue and closed.
- Out of scope: refusing a Bash write or a commit of a spec.md (User Story 4 stands behind the edit rule); the
  engineering repo's `pr-review-loop.md` and `alq-build`'s skills, the callers that adapt; the story argument of #81. No `alq-build` skill writes a spec.md (a grep of `plugins/alq-build` finds none).
- Unchanged: ADR-0016 decisions 1-3 and 5 (the `spec` argument, its shape, `spec.md` present at the reviewed commit, the
  bound value never changes); ADR-0017 (review reads only `spec.md`); the spent-audit and `ESCALATE` locks and their
  `unlock`. ADR-0018's "`unlock` is the one release" changes for a `RESHAPE_SPEC` lock only: `unlock <ref>` releases it
  when the spec stands, `rebase <ref>` after a spec change; the decision record says so. ADR-0019 (open PR #93) stands
  but for the `spec.md`-blob part of its decision 3 and its closing line "ADR-0016, decision 6, and ADR-0018 stand",
  which the decision record replaces.

## Why this is worth doing

### harm
Answer: A story PR whose spec.md changes after its first round, a typo fix included, is held until the user types `unlock`; the gate must store the bound blob id and compare every later read against it, and tests that no stale version is read did not converge (PR #102, five rounds). Meanwhile the coding agent can still edit spec.md on its story branch, so it can move the target it is graded against; the hold only catches that after the fact.
Source: code: plugins/alq-review/scripts/gate.py:454-470 (`_spec_text` holds on a blob id other than the bound one); user: issue #104 Problem section.

### reachable
Answer: observed. On main, `on_edit` (gate.py:326) refuses no write by path to spec.md, and the hold of ADR-0016 decision 6 is live; PR #102 went five internal rounds on the read-path tests of that hold.
Source: code: plugins/alq-review/scripts/gate.py:326-342, gate.py:505-531; user: PR #102 history.

### change-alters
Answer: Yes. The agent on a story branch tries to write spec.md: the hook refuses it, so the target cannot move. If the spec is wrong the agent stops and raises it; the change lands as a spec-only PR, merged to main, and the story rebases. Every round reads spec.md at the reviewed commit, so the gate stores no blob id, has no hold to test, and a typo costs a spec PR, not an unlock. A PR that changes spec.md and code together is refused at launch.
Source: user: issue #104 Decision 1-5.

### owner
Answer: Partly: ADR-0016 decision 6's hold owns it after the fact, and that hold is what this replaces. Nothing refuses the write itself.
Source: code: plugins/alq-review/scripts/gate.py:454-470, policy.py:55-97; code: dev/alq-review/docs/adr/0016 decision 6.

### inherited
Answer: It reverses ADR-0016 decision 6 (and the blob-id part of decision 4). The user put the questions to that decision on 2026-10-13 with research on graders and spec edits, and decided to replace it.
Source: user: issue #104 Decision; https://claude.ai/artifact/318JN3nQhSgcXqCuP18CdD.

### needs-spec
Answer: It has decisions: which branches count as story branches, which writes the hook refuses, where the rescope runs, what "changes code" means for the diff check, and how the ledger's stored spec state is removed.
Source: code: plugins/alq-plan/skills/issue-spec/SKILL.md (rescope on the story branch); user: issue #104 Work 3.

## Root cause

Observed: nothing; this trace is a hypothesis from reading the code. The five rounds of PR #102 are the user's
report in issue #104, and the tests that pin the hold (`test_gate.py:599-669`) were not run in this session.

The ledger owns a copy of the spec's identity. `gate._spec_text` (`gate.py:454-471`) compares the blob id of
`spec.md` at the reviewed commit with the bound `spec_blob`, and `specbinding.text_step` rules it `same`, `hold` or
`bind`; a `hold` is recorded as `spec_held` by `_refuse_spec` (`gate.py:518-523`), and `policy._holds`
(`policy.py:84-103`) turns that record into a lock on every mutation until `ledger.released` sees a later
`unlocked_at`. So every site that reads `spec.md` has to read the right version, which is what #98 and PR #102
chased. The write itself is never judged: `on_edit` (`gate.py:326-342`) decides a write by `policy.mutation` on the
ledger alone, with no rule on the path or the branch, so a session on a story branch writes `spec.md` freely until
the next launch notices.

- **Other callers**: `_spec_step`, the review-round launch (`gate.py:474-502`) (predicted); `_assess_spec_step`, the
  assess-round launch (`gate.py:505-515`) (predicted); `_admit_spec`, which spends the hold (`gate.py:526-531`)
  (predicted); `policy.locked` and `_lock_reason`, through `_holds`, reached by `mutation`, `launch_round`,
  `rerequest` and `mark_ready` (predicted); `_unlock` through `ledger.unlock` and `released` (predicted);
  `briefs.bound_spec`, which reads `spec` only and is untouched (predicted).
- **Examined and ruled out**: the Bash snapshot path, `hold` and `after_bash` (`gate.py:273-317`), watches
  checkouts of branches already held and so cannot refuse a `spec.md` write on an unheld branch;
  `claimgate.on_commit` and `shimgate.on_commit` judge claims and fixes in the staged tree, never a path.
- **Not investigated**: `pre_merge_gate.py`'s attestation path; the commits `alq-build`'s skills make on a story
  branch; whether a `gh api` content write can reach `spec.md` without a checkout.
