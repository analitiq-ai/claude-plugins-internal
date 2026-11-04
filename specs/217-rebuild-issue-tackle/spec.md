---
# planner's spec_facts.ts sets this block once the spec passes planner's checks; leave it as it is.
codeworks:
  v: 1
  kind: defect
  root_cause:
    observed: hypothesis
---
# Feature Specification: builder rebuilds issue-tackle to its records

**Feature Branch**: `217-spec`

**Created**: 2026-10-30

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/217 — builder: rebuild
issue-tackle to its records. `builder/plugin/skills/issue-tackle/SKILL.md` predates builder's accepted records
(PR #176); #212 (FR-024 of #174) carries only builder ADR-0003 d1. Build ADR-0002 d1–d4 and d6, ADR-0003 d2–d3 and
ADR-0004 d1–d2. Decide in the spec: how builder reaches `core/` (a TypeScript carrier like the orchestrator's, its
scripts called by the skill), and whether builder's Python tests move to TypeScript with it. Depends on #174 (C2,
#212) and #209."

## Clarifications

### Session 2026-10-30

- Q: Where does the first step's turn end, with no PR yet? → A: Implement, commit, run the internal round to clean in the same turn, then end; the Stop hook pushes, opens the draft and attests it (builder ADR-0003 d2).
- Q: How much does one implement step build? → A: Every unticked task of the story, then the round; an attested head is a complete story, and "attested with unticked tasks" is no implement state.
- Q: When does builder tick a task? → A: As soon as its code is committed, in its own tick-only commit.
- Q: How does builder reach `core/`? → A: As a core carrier with one TypeScript step script, copying the orchestrator's carrier once #174 lands it; builder's carrier work waits for that.
- Q: Do builder's Python tests move to TypeScript? → A: Yes; each assertion that still holds is carried to a TypeScript test, the ones about retired text are dropped, and the `.py` files are deleted.

## User Scenarios & Testing *(mandatory)*

The actor is the orchestrator's Stop or UserPromptSubmit hook, which names `builder:issue-tackle <s>` as the next
step of the one issue the agent-machine session holds (orchestrator ADR-0001; root ADR-0008). The model running the
skill reads GitHub through the read-only session token and writes nothing there (root ADR-0007): it commits, and the
orchestrator's hooks push and open the draft PR (builder ADR-0003 d1, shipped by #212). An admin reads the stop
message through the orchestrator's Blocked reason, which the Stop hook takes from core's stop rule (US1).

Every step is one invocation of the skill. Each begins with builder's step script, which reads GitHub and git through
`core/` and prints what this step is: a stop with its reason, or the work to do. The skill does what the script names
and nothing it does not.

### User Story 1 - core gains the reads and the stop rule builder needs (Priority: P1)

Every read builder's step needs that core lacks lands in core, in US1's one PR, before the first builder story that
calls one (US3): the story branch name, the story's task lines, a closed story PR, a
spec PR's merge commit, the `internal-review` and `<module>-review` check runs at a head, and the step's stop rule with the read of its facts.
The stop rule and that read live in core so the orchestrator's Stop hook reads the same facts, calls the same function and names builder's stop as the
card's Blocked reason (builder ADR-0003 d2). No core addition reads a key or writes to GitHub (root ADR-0008 d4).

**Why this priority**: User Stories 2–5 call these reads; builder imports nothing but core (root ADR-0009 d2), and
reviewer refuses a commit on any branch but the session issue's `<s>-us*` (reviewer ADR-0015 d1), so core's
additions need a story of their own.

**Independent Test**: Run core's tests: each addition has a test against the fake GitHub or a scratch repository; no
addition's signature takes a key reader or a writing client.

**Acceptance Scenarios**:

1. **Given** a story issue titled with `/`, `..`, unicode or 300 characters, **When** core forms its branch name,
   **Then** the slug is `[a-z0-9-]`, length-capped, with no leading, trailing or doubled `-`, `story` when empty,
   and the name parses back through `parseBranch`.
2. **Given** a head with `<module>-review` check runs written by the orchestrator's App, **When** core reads the
   head's findings, **Then** it reads them from those check runs and the threads, and loads no validator package.
3. **Given** the facts of each stop state, **When** the orchestrator's Stop hook and builder's step script read
   them through core and call core's stop rule, **Then** both get the same state and reason.

---

### User Story 2 - builder carries core; the Python tests move to TypeScript (Priority: P1)

builder's plugin becomes a core carrier shaped as the orchestrator's (#174): a `core` link to `core/src`, a module
package pinning core's runtime packages exactly with its lockfile, a pinned plugin version, and its step script's
entry loading core's dependency guard first (root ADR-0001 d2, ADR-0009 d3–d4). The carrier check lists builder.
builder's tests are TypeScript: the step script's tests import core, and the skill-text tests that replaced the
Python ones read the skill. `root-cause-check`'s retirement ships with US4.

**Why this priority**: User Stories 3–5 need it to run; on its own it changes no step.

**Independent Test**: Run the carrier check against the default branch: it lists builder with zero failures. Run
builder's tests: none is Python, and they pass.

**Acceptance Scenarios**:

1. **Given** this story merged, **When** CI runs the carrier check, **Then** it lists builder's plugin and fails
   nothing; a `core/src` change without a builder version bump fails it naming builder's `plugin.json`.
2. **Given** core's dependencies are not installed, **When** the step script runs, **Then** it refuses, naming the
   missing package (root ADR-0009 d4).
4. **Given** builder's tests, **When** CI runs them, **Then** no `.py` file remains in `builder/tests/`.

---

### User Story 3 - A step derives everything from the story issue number (Priority: P1)

`issue-tackle <s>` takes the story issue number alone. builder's step script derives through `core/` the spec's
issue `<p>`, the spec folder `specs/<p>-*`, the requirement, the story branch `<s>-us<k>-<slug>` and its PR (root
ADR-0005). It stops, building nothing, on an issue in Backlog or Blocked, on a closed or done story, on an issue other
than the session's, and on no `specs/`, no `specs/<p>-*` or several of them, naming the state and any open PR. On a
story with no branch yet, it cuts the branch from the default branch in the worktree `../<repo>.worktrees/<branch>`;
otherwise it works in that worktree on the existing branch.

**Why this priority**: every other decision reads the branch, PR and folder this story derives. Without it a
caller-supplied folder can bind the wrong spec, and a story built on `<p>-spec` mixes spec and code commits.

**Independent Test**: Against a fake GitHub and a scratch repository, run the step script for a story issue in each
lane and folder state and read its output: Ready with one folder and no branch names "cut `<s>-us<k>-<slug>` from the
default branch"; Backlog, Blocked, closed, a missing or a doubled folder each name a stop and cut nothing.

**Acceptance Scenarios**:

1. **Given** story issue `#s` In progress, parent `#p`, one `specs/<p>-*` on the default branch and no story branch,
   **When** the hook names `issue-tackle <s>`, **Then** the step cuts `<s>-us<k>-<slug>` from the default branch in
   `../<repo>.worktrees/<s>-us<k>-<slug>` and hands the model the requirement of `specs/<p>-*/spec.md`.
2. **Given** a story issue whose `spec.md` has `codeworks.kind: no_spec`, **When** the step runs, **Then** the
   requirement it hands the model is the story issue's body (root ADR-0005 d4).
3. **Given** the story issue's card in Backlog or Blocked, **When** the step runs, **Then** it stops naming the lane
   and writes, cuts and commits nothing (builder ADR-0002 d4; root ADR-0006 d1).
4. **Given** no `specs/`, no `specs/<p>-*`, or two folders `specs/<p>-*`, **When** the step runs, **Then** it stops
   naming that state and the open story PR if there is one, and runs no planning command (builder ADR-0002 d3).
5. **Given** a story issue that is closed, or whose PR merged, **When** the step runs, **Then** it stops saying the
   story is done or closed (root ADR-0005 d5, ADR-0006 d3).
6. **Given** the session record names issue `#a`, **When** the hook or a user names `issue-tackle <b>` with `b ≠ a`,
   **Then** the step stops naming `#a` (builder ADR-0002 d5; root ADR-0008).
7. **Given** a worktree at `../<repo>.worktrees/<branch>` on another branch, **When** the step runs, **Then** it stops
   naming the branch that worktree is on.
8. **Given** the skill is invoked with anything after `<s>` (`spec=`, `branch=`), **When** it starts, **Then** it
   refuses, naming `issue-tackle <s>` as the one form.

---

### User Story 4 - Each step resumes from GitHub and ends at an attested draft (Priority: P1)

A step never relies on what an earlier turn remembers. It begins from the story PR, its comments and findings, the
head's internal-review attestation and the story issue's task ticks (builder ADR-0003 d3), and does the one thing they
call for: with no PR yet, implement the unticked tasks against the requirement, commit, run the internal round to
clean and end the turn, so the Stop hook pushes, opens the draft and attests it in one pass; with an
unattested head, run the internal review loop at the current head; with findings on the PR, run a github round; with
an attested head and no findings, end the turn with nothing to do. The round is launched with the arguments the gate
supplies, never a `spec` (reviewer ADR-0014 d1). The turn ends at an attested draft, or at a stop whose message names
why (builder ADR-0003 d2). `root-cause-check` no longer runs: the round's root-cause reviewer verifies the cause
(builder ADR-0002 d6; reviewer ADR-0017).

**Why this priority**: the orchestrator's hooks drive every step; a step that cannot re-derive its state from GitHub
repeats or stalls, which the orchestrator counts toward Blocked (builder ADR-0003 trade-offs).

**Independent Test**: Against a fake GitHub, run the step script for one story in each PR state and read the step it
names; then read the skill and find no step that reads a previous turn's state and no invocation of
`root-cause-check`.

**Acceptance Scenarios**:

1. **Given** a story branch with no PR, **When** the step runs, **Then** it names "implement", lists the tasks of the
   story issue not yet ticked, and the skill commits, runs the internal round to clean and ends the turn, pushing
   nothing (Clarifications 2026-10-30, Q1).
2. **Given** a draft PR whose head carries no internal-review attestation, **When** the step runs, **Then** it names
   the internal round at the current head, and the skill launches `reviewer:review-round` with the arguments the step JSON carries
   and no `spec`.
3. **Given** a draft PR whose head is attested and that has open findings, **When** the step runs, **Then** it names a
   github round (reviewer ADR-0016).
4. **Given** an attested draft with no findings, **When** the step runs, **Then** it names "nothing to do" and the
   skill ends the turn.
5. **Given** a story PR closed unmerged, **When** the step runs, **Then** it continues on the same branch; the
   orchestrator's hooks open the new PR (builder ADR-0003 d1).
6. **Given** a round that ends clean, **When** the turn ends, **Then** no `root-cause-check` skill was invoked and
   builder ships none.
7. **Given** an implement step that committed the code of 2 of a story's 3 tasks before the session crashed,
   **When** the next step runs on the local branch, **Then** it lists only the third task as unticked, and each
   built task has a tick-only commit after its code (Clarifications 2026-10-30, Q3).
8. **Given** the repository after this story, **When** anyone searches it for `root-cause-check` outside `specs/`
   and `**/docs/adr/`, **Then** nothing names it (moved from US2: the skill invokes it until this story rewrites
   the skill).
9. **Given** a step that names a round, **When** the skill launches it, **Then** the round's arguments are the ones
   the step JSON carries.

---

### User Story 5 - The story branch takes the default branch by merge only (Priority: P2)

At the start of a step, before the spec-folder check, the step script decides whether the default branch must be
merged into the story branch: after a spec PR of the spec's issue merged since the branch last took the default
branch, or when the default branch's `spec.md` of the story's spec, any `**/docs/adr/` file or `.specify/memory/`
differ from the head's (builder ADR-0004 d2). It also names a merge when the story PR conflicts with its base. The
skill merges the default branch into the story branch and resolves any conflict in that merge commit; it never
rebases, resets a pushed commit, or force-pushes (builder ADR-0004 d1). The folder check then runs on the merged head,
finding the folder the new spec names.

**Why this priority**: a rescope reaches a story in flight only through this merge; a rebase would strand the heads
reviewer's rounds were recorded at.

**Independent Test**: In a scratch repository, change `docs/adr/` on the default branch after the story branch was
cut, run the step script, and read that it names "merge the default branch" before any folder check; then run the
skill's merge path with a conflicting change and read the branch history: every earlier head is still an ancestor of
the new head.

**Acceptance Scenarios**:

1. **Given** a spec PR of `#p` merged after the story branch last took the default branch, **When** the step runs,
   **Then** it names the merge first, and the folder check reads the merged head.
2. **Given** the default branch's `specs/<p>-*/spec.md`, a `**/docs/adr/` file or `.specify/memory/` differ from the
   head's, **When** the step runs, **Then** it names the merge.
3. **Given** the story PR conflicts with its base, **When** the step runs, **Then** it names the merge, and the skill
   resolves the conflict in a merge commit of the default branch, then runs the step again on the merged head and
   ends the turn only at a clean round or a stop (derived from Clarifications 2026-10-30, Q1 and builder ADR-0003 d2).
4. **Given** any step, **When** the skill updates the story branch, **Then** every head pushed before is an ancestor
   of the new head.

---

### Edge Cases

- The session crashed after a commit and before the Stop hook pushed: GitHub has no story branch, the local worktree
  holds one. The step reuses the local branch of this story rather than cutting a second one.
- Two branches `<s>-us*` exist on GitHub: core's lookup names both, and the step stops naming them (root ADR-0005 d1).
- The story issue has a parent in another repository: core refuses the derivation, and the step stops naming it.
- The lane cannot be read (board unreachable, token expired): the step stops saying the lane could not be read, never
  as a lane and never as a pass (root ADR-0004).
- A spec PR of `#p` is open: the orchestrator holds the start (orchestrator ADR-0006); a story already in flight is
  held by its rescope hold, and its card is Blocked, so the lane stop applies.
- The merge of the default branch removes or renames the story's spec folder: the folder check after the merge stops
  naming the new state.
- The story branch is on GitHub but its worktree was removed: the step makes the worktree from `origin/<branch>`
  and goes on (FR-027).
- The local worktree is behind the PR head, or holds uncommitted changes after a crash: the step stops naming the
  heads or the files; a merge left unfinished is named as the merge step (FR-028).
- An attested head with no findings whose story still has an unticked task: the step names "nothing to do"; ticks
  gate nothing (derived from Clarifications 2026-10-30, Q2 and builder ADR-0003 Option D).
- The story's PR closed unmerged: the step treats it as no PR and names implement; with no unticked task left, the
  implement step goes straight to the internal round (derived from builder ADR-0003 d1 and Clarifications
  2026-10-30, Q1–Q2).
- A `no_spec` story has no task block labelled with `#<s>`: the implement step builds the story issue's body as one
  task, and `<k>` is 1 (derived from root ADR-0005 d4 and Clarifications 2026-10-30, Q2).
- `spec.md` sets `codeworks.root_cause.observed: hypothesis`: the implement step confirms the mechanism before
  building on it, as today's Step 3 says; the round's root-cause reviewer grades it.

## Requirements *(mandatory)*

### Functional Requirements

**Arguments and derivation (US3)**

- **FR-001**: `issue-tackle` MUST take the story issue number `<s>` alone and refuse any other form, naming
  `issue-tackle <s>` (builder ADR-0002 d1).
- **FR-002**: builder's step script MUST derive through `core/` alone, never from an issue comment or a caller
  argument: the spec's issue, the spec folder, the requirement, the story branch and the story PR (root ADR-0005
  d1–d4).
- **FR-003**: The story branch name `<s>-us<k>-<slug>` MUST be formed in `core/`, beside its parser (root ADR-0005
  d1).
- **FR-004**: On a story with no branch on GitHub and none in its worktree, the step MUST cut the branch from the
  default branch as it is on GitHub, in `../<repo>.worktrees/<branch>`; every later step MUST build on that branch
  (builder ADR-0002 d2).
- **FR-005**: The step MUST stop on an issue other than the session record's issue, and on a session with no
  session record, naming it (builder ADR-0002 d5; root ADR-0008 d1).

**Stops (US3)**

- **FR-006**: The step MUST stop, building nothing, when the story issue's card is in Backlog or Blocked, at the start
  of every step (builder ADR-0002 d4).
- **FR-007**: The step MUST stop when the story issue is closed or the story is done (root ADR-0005 d5, ADR-0006 d3).
- **FR-008**: The step MUST stop on no `specs/`, no `specs/<p>-*` or more than one `specs/<p>-*`, naming the state
  and any open story PR, and MUST NOT name or run a planning command (builder ADR-0002 d3).
- **FR-009**: A read the step depends on that does not answer MUST stop the step as its own outcome, naming the read,
  never as a lane, a folder state or a pass (root ADR-0004).
- **FR-010**: Every stop MUST end the turn with a message naming why (builder ADR-0003 d2).

**Resuming from GitHub (US4)**

- **FR-011**: The step MUST begin from the story PR, its comments and findings, the head's internal-review
  attestation and the story issue's task ticks, and from no state an earlier turn kept (builder ADR-0003 d3).
- **FR-012**: The step MUST name exactly one of: implement (no PR yet), internal round (unattested head), github
  round (findings), nothing to do (attested head, no findings). An implement step MUST build every unticked task of
  the story before its round, so an attested head is a complete story (Clarifications 2026-10-30, Q2).- **FR-013**: After an implement step the skill MUST commit and run the internal round in the same turn, ending the
  turn only at a clean round or a stop (builder ADR-0003 d2), and MUST NOT push, open a PR, mark it ready, request a review or
  write a lane (builder ADR-0003 d1; orchestrator ADR-0002, ADR-0007, ADR-0008).
- **FR-014**: The skill MUST launch `reviewer:review-round` with the arguments the step JSON carries (FR-029) and no `spec`
  (reviewer ADR-0014 d1), and act on each step the gate names until the loop ends clean.
- **FR-015**: The skill MUST implement against the requirement and at the spec's Root cause, refusing shims and
  workarounds, as today's Step 3 says; it reads the trace's standing from `codeworks.root_cause.observed`, not from a
  heading.

**Merging the default branch (US5)**

- **FR-016**: Before the folder check, the step MUST name a merge of the default branch into the story branch when a
  spec PR of the spec's issue merged that the head does not contain, when the default branch's `spec.md` of the
  story's spec, any `**/docs/adr/` file or `.specify/memory/` differ from the head's, or when the story PR conflicts
  with its base (builder ADR-0004 d2).
- **FR-017**: The skill MUST update the story branch only by merging the default branch into it, resolving conflicts
  in that merge, and MUST NOT rebase, reset a pushed commit or force-push (builder ADR-0004 d1). After the merge it
  MUST run the step again on the merged head in the same turn (derived from Clarifications 2026-10-30, Q1 and
  builder ADR-0003 d2).

**Carrier, retirements, tests (US2)**

- **FR-018**: `builder/plugin` MUST carry core as root ADR-0001 d2 and ADR-0009 d3–d4 define a carrier, and the
  carrier check MUST list it; its manifest declares no plugin dependency (builder ADR-0002 d1). Its carrier files
  (guarded entry, module package, pins) MUST copy the orchestrator's carrier as #174 lands it, and builder's carrier
  work MUST start only after that lands (Clarifications 2026-10-30, Q4).
- **FR-019**: builder's scripts MUST be TypeScript and import `core/` and no other plugin (root ADR-0009 d2).
- **FR-020**: The `root-cause-check` skill MUST be deleted, and every installed file and README that names it MUST stop
  naming it (`auditor/plugin/skills/pr-audit/SKILL.md`, `planner/plugin/scripts/rootcause.py`, builder's manifest
  description) (builder ADR-0002 d6). It ships in US4's PR, which rewrites the skill that invokes it.
- **FR-021**: builder's tests MUST be TypeScript; `builder/tests/*.py` and `paths.py` MUST be removed, each assertion
  that still holds carried to a TypeScript test, and the ones about retired text dropped.
- **FR-022**: builder's plugin version MUST be bumped in every PR that changes `core/src` or core's pins after builder
  becomes a carrier.
- **FR-023**: The skill MUST tick each task in its story's `tasks.md` block as soon as the task's code is committed,
  in a commit that only flips that task's `[ ]` to `[x]` (reviewer ADR-0010 d1; Clarifications 2026-10-30, Q3).

**Core additions and step robustness (US1, critique 2026-10-30)**

- **FR-024**: Every core addition builder needs MUST land in `core/` in US1's one PR (org ADR-0003, root ADR-0005),
  merged before US3, and MUST take no key reader and no writing client (root ADR-0008 d4).
- **FR-025**: The step's stop rule MUST be a pure function in core, called by builder's step script and by the
  orchestrator's Stop hook, so the card's Blocked reason names builder's stop (builder ADR-0003 d2). Its facts MUST be read by one
  read-only core function both call; builder cuts or adds the worktree itself (FR-027), then reads them again.
- **FR-026**: The PR's findings MUST be read from the `<module>-review` check runs the orchestrator's App writes at
  the head and from the PR's threads, never by loading validator packages in builder.
- **FR-027**: A story branch on GitHub with no local branch MUST get its worktree from `origin/<branch>`; a local
  branch with no worktree MUST get its worktree on that branch. `branch_mismatch` MUST stop only when both exist and
  differ.
- **FR-028**: A local head behind or diverged from the PR head MUST stop naming both heads; an unfinished merge MUST
  name the merge step to resolve and commit it; uncommitted changes with no merge in progress MUST stop naming the
  files.
- **FR-029**: The step JSON for a round MUST carry the round's launch arguments (`worktree`, `stage`).

### Key Entities

- **Story issue `<s>`**: the one number the step takes; its lane, open/closed state, parent `<p>` and body.
- **Task ticks**: the `[x]` or `[X]` boxes of the `tasks.md` task blocks labelled `Story issue: #<s>` at the story head; a
  story's own phase, plus Setup and Foundational for the first story and Polish for the last (planner ADR-0008 d2;
  reviewer ADR-0010 d1).
- **Spec folder `specs/<p>-*`**: on the default branch or the story head; its `spec.md` and `codeworks` keys give the
  requirement.
- **Story branch `<s>-us<k>-<slug>`** and its **worktree** `../<repo>.worktrees/<branch>`.
- **Story PR**: the newest same-repo PR whose head is the story branch; its head, attestation and findings.
- **Step**: what the step script prints for one invocation: one stop with its reason, or one of implement, merge,
  internal round, github round, nothing to do, with the facts the skill needs for it.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The carrier check on the default branch lists builder among its carriers with 0 failures.
- **SC-002**: For each of the 16 stop states of data-model.md's `StopState` enum, a step leaves the repository,
  worktree and GitHub unchanged and its message names the state: 16 of 16.
- **SC-003**: For each of the 4 PR states (none, unattested, findings, attested clean), the step names the one action
  FR-012 gives it: 4 of 4, and the same answer when run twice with no change on GitHub.
- **SC-004**: After any sequence of steps, every head pushed to a story branch is an ancestor of its current head: 0
  rewritten heads.
- **SC-005**: Outside `specs/` and `**/docs/adr/`, 0 files name `root-cause-check`; `builder/tests/` holds 0 Python
  files; the skill accepts 0 arguments beyond `<s>`.

## Assumptions

- All cited records are accepted (PR #176 and the root and reviewer records they cite).
- Core already provides on `main`: the issue → story branch and PR read `issueStory` (C2, landed in #240), the spec's
  issue, the spec folder answer and the requirement (`identity.ts`), the lane read `laneOf` (`board.ts`), and the
  session record read (`session-record.ts`). The branch-name builder (FR-003) and any read of task ticks or the head's
  attestation not yet exported are core additions this spec's plan names.
- `<k>` in a new branch name is the `US<k>` of the `tasks.md` phase labelled `Story issue: #<s>` (planner ADR-0008
  d2), or 1 when no phase is labelled with `#<s>`; `<k>` is never checked (root ADR-0005 d1), so this only fixes a
  readable default. `<slug>` is formed from the story issue's title.
- The worktree path is `../<repo>.worktrees/<branch>` as the constitution's Delivery Workflow gives it, replacing
  today's `../<repo>.worktrees/<n>`.
- **How builder reaches core (decided, Clarifications 2026-10-30, Q4)**: a TypeScript carrier copying the
  orchestrator's carrier once #174 lands it (FR-018–FR-019): one step script the skill calls with `<s>`, printing the
  step as data; the skill holds no rule the script decides.
- **Python tests (decided, Clarifications 2026-10-30, Q5)**: they move to TypeScript (FR-021). Among those that
  still hold are `test_names_no_planning_command_and_reads_no_issue_comment_for_the_spec` and
  `test_no_command_the_skills_give_reads_a_value_inside_its_arguments` (`builder/tests/`); the rest assert text this
  change rewrites or retires (`root-cause-check`, `spec=`/`branch=`, the two-skill command set). Every file is
  rewritten either way, so root ADR-0009 Option D's objection, rewriting working code that gains nothing, does not
  apply; one toolchain then covers builder.
- The constitution's Platform Constraints line "builder is two skills, with no scripts and no hooks" changes to
  describe builder as a carrier with one skill and its step script; that amendment ships in its own PR before this
  change (constitution Governance; Principle VI).
- Not in scope: a hook refusing `git rebase` or `git push --force` from the model's tool calls. Writes from the
  model's tool calls are refused by reviewer's hook (constitution P6); whether that hook refuses a rebase is
  reviewer's.

### Dependencies

- #174: the orchestrator's hooks name `issue-tackle <s>`, write the session record, push and open the draft PR; #212
  (FR-024) ships builder ADR-0003 d1 and must merge before US4. #174's carrier code (its guarded entry, module
  package and pins) must merge before US2, and so before US3–US5, which run on builder's carrier (FR-018).
- Reviewer's root-cause reviewer (reviewer ADR-0017) must run in the internal round before `root-cause-check` is
  deleted (US4, FR-020). #209's spec does not ship it; #244 does.
- Reviewer's gate must derive the spec from the branch and accept a launch with no `spec` (reviewer ADR-0014 d1)
  before US4; today it refuses one (`reviewer/plugin/README.md:58`). #209's spec does not ship it; #243 does.
- #174's Stop hook calls core's stop rule (US1) to name builder's stop as the Blocked reason.
- The constitution amendment above.

## Why this is worth doing

### harm
Answer: `issue-tackle` keeps taking `<n> spec=<folder> branch=<branch>` from the caller, works on the spec's branch instead of a story branch cut from the default branch, accepts any non-empty spec.md (no check for missing `specs/`, missing `specs/<p>-*` or an inconsistent folder), starts on issues in Backlog or Blocked, invokes `root-cause-check` (which reviewer ADR-0017 retires), keeps state in the session instead of the PR, and has no conflict procedure. Each is a divergence from builder ADR-0002 d1–d4/d6, ADR-0003 d2–d3 and ADR-0004 d1–d2: a caller-supplied folder/branch can bind the wrong spec, a story built on the spec branch mixes spec and code commits, and a conflict may be resolved by rebase/force-push.
Source: code: builder/plugin/skills/issue-tackle/SKILL.md steps 1–5; code: builder/docs/adr/0002, 0003, 0004 (status accepted)

### reachable
Answer: observed — SKILL.md on main (8266034) takes `spec=`/`branch=` args, works on the spec branch (Step 2), checks only that spec.md is non-empty, has no lane check, invokes `builder:root-cause-check` (Step 5) and says nothing on conflicts.
Source: code: builder/plugin/skills/issue-tackle/SKILL.md at origin/main 8266034

### change-alters
Answer: Yes. With the skill rebuilt to its records: it takes only `<n>`, derives the spec folder, branch and PR through core (no caller-supplied folder to get wrong), cuts the story branch from the default branch, stops on a missing/inconsistent spec folder and on Backlog/Blocked lanes, drops root-cause-check in favour of reviewer's root-cause reviewer, ends each turn at an attested draft and resumes from PR state, and resolves conflicts by merging the default branch only.
Source: code: builder/docs/adr/0002–0004; issue #217 table

### owner
Answer: Partly. #212 (FR-024 of #174) carries only ADR-0003 d1 (builder stops pushing/opening/readying the PR). No guard, test or CI job enforces the other decisions on issue-tackle; builder/tests/test_issue_tackle.py tests the current skill text.
Source: code: builder/tests/test_issue_tackle.py; issue #217 "Why"; issue #212

### inherited
Answer: Yes — from builder ADR-0002, ADR-0003, ADR-0004 (accepted 2026-10-20, PR #176). They are accepted records; the harm/reachable answers above hold against them: the skill on main contradicts each. Depends on #174 (core issue→story branch/PR lookup, plan C2; C1–C4 partly landed in #240), #212, and #209 (root-cause reviewer) — all open.
Source: code: builder/docs/adr/*.md frontmatter; issues #174, #209, #212 (OPEN)

### needs-spec
Answer: Decisions remain. The issue names two open ones: how builder reaches core (a TypeScript carrier like orchestrator's, scripts called by the skill), and whether builder's Python tests move to TypeScript. Sequencing against #174/#209/#212 must also be settled.
Source: code: issue #217 "Decide in the spec"

## Root cause

Observed: nothing; this trace is a hypothesis from reading the code.

The skill's text is the only place builder decides anything, and it was written before builder's records (PR #176):
`builder/plugin/skills/issue-tackle/SKILL.md` takes the spec folder and branch as caller arguments (lines 6–15), checks
out the caller's branch and reads only that `spec.md` is non-empty at its head (lines 19–25), and invokes
`builder:root-cause-check` after the internal loop (lines 71–87). builder ships no script and does not carry `core/`
(`builder/plugin/` holds two `SKILL.md` files and a manifest), so it has no way to read the story's lane, branch, PR,
attestation or folder through core, and every decision ADR-0002–0004 assign to code is left to prose the model reads,
or absent. The wrong decision is made in that file, not in any caller: no caller exists yet that passes the old
arguments, since the orchestrator's hook (#174) names `issue-tackle <s>`.

- **Other callers**: the orchestrator's UserPromptSubmit and Stop hooks, which name `builder:issue-tackle <s>`
  (`specs/174-orchestrator-plugin/contracts/hooks.md:30`) (predicted); `auditor/plugin/skills/pr-audit/SKILL.md:123`,
  which points readers to `builder:root-cause-check` (predicted).
- **Examined and ruled out**: `core/src/identity.ts` — it already derives the spec's issue, the spec folder, the story
  branch and PR from `<s>` (`specIssue`, `specFolder`, `issueStory`), so the cause is not a missing core read for
  those; `builder/tests/` — they assert the old text and do not cause it.
- **Not investigated**: whether reviewer's PreToolUse hook already refuses `git rebase` or `git push --force` from the
  model's tool calls; whether core already exports a read of the story issue's task ticks and of a head's
  internal-review attestation in the form the step script needs.
