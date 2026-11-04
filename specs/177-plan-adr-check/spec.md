---
codeworks:
  v: 1
  kind: defect
  root_cause:
    observed: anchored
---
# Feature Specification: planner checks the plan against the ADR folders it is given

**Feature Branch**: `177-spec`

**Created**: 2026-11-02

**Status**: Draft

**Input**: User description: "https://github.com/analitiq-ai/claude-plugins-internal/issues/177 — planner: check the
plan against the ADR folders it is given (planner ADR-0009). Planner takes a list of paths to ADR folders, held once
in `codeworks.toml` `[shared]`, and checks the plan, and again the tasks, against each one. A relative path resolves
from the main checkout. ADR-0009 is amended first, in its own PR: the check is against the listed paths, not 'the
repo's log and the org log'; d2 (remote head) is dropped; the check runs again after tasks; a public repo lists no
path to private ADRs. Reading and resolving the list is one function in core. Reviewer reads the list in place of
`REVIEWER_ORG_ADR_DIR`; that story waits for #209's US1 (#235)."

## Clarifications

### Session 2026-11-02

- Q: Who decides that the plan contradicts a record, given `adr check` only lists governing records and fails only on a changed record's error? → A: A script runs `adr check` per listed folder, a headless model step judges the artifact against the governing records and writes its verdict as data, and a TypeScript script stops the run on any departure.
- Q: After US5, which folders does reviewer check? → A: Only the listed folders, as planner; reviewer no longer finds tracked `docs/adr` folders itself, so a folder nobody lists is checked by neither.
- Q: Must every repo's `codeworks.toml` carry the ADR-folder key? → A: Yes, required, and it may be an empty list; a missing key is refused by every component, and an empty list checks nothing and passes, saying so.
- Q: When the judge names a departure, can the user overrule it? → A: Yes; a resume can carry the user's ruling that a named departure is not one, recorded in the spec folder, and the step accepts it; ADR-0009's amendment names this.
- Q: What entry names the Org ADRs in this repo's `codeworks.toml`? → A: `../engineering/docs/adr`, with analitiq-ai/engineering checked out beside this repo on every machine that runs planner or reviewer.
- Q: Which later checks honor a recorded overrule? → A: Every later planner check of the spec folder and reviewer's decision check; the ruling is a note in the artifact it overrules, in `plan.md` or on the task's line in `tasks.md`. → Superseded by critique review (2026-11-02): rulings are kept in one rulings file in the spec folder that holds only user rulings, written only by the check script from the user's resume, given to the judge and applied by script at every later planner check and by reviewer.
- Implementor feedback review (2026-11-03): ADRs and specs are written in planning only, so US1 is gone: planner
  ADR-0009, reviewer ADR-0013, orchestrator ADR-0002 and root ADR-0010 are amended, and reviewer ADR-0022 and root
  ADR-0011 (planner alone creates and edits spec folders and decision records; everyone else reads them) added, in
  the planning PR before any code (FR-001). A departure's next steps are change the artifact, supersede the record
  (draft a superseding record into the spec PR when its folder is in this repo, else change it in the repo that
  holds the folder), or rule; a record with its own `adr check` error is a FAIL naming the file, rule and message,
  next step "fix that record" (FR-008). An empty `adr_folders` passes before any path is read
  (FR-008). The plan's paths move out of `plan.md` into `<run folder>/touches.json`, read only by planner's check
  (FR-012; its writer settled below). The root `README.md`'s ADR Kit passage is rewritten in US3.
- Implementor feedback on #278 (2026-11-03): a story's own ticks in `tasks.md` (TICK_ONLY, reviewer ADR-0010 d1)
  are not a spec change; one core function tells a tick from any other change (FR-020, root ADR-0011).
- Gap sweep after implementor feedback on #275 (2026-11-03), every contract checked against the code it extends,
  the Python it ports and adrkit 0.20.0's real answer. Four changes: (1) no reviewer hold of its own: a story PR
  that changes a decision record, or a spec folder beyond TICK_ONLY, is a protected path (orchestrator ADR-0004
  d4), through core's one `protectedPaths` (FR-020, R12); (2) core's `adr` reader is a port held to parity by
  porting reviewer's Python tests case for case, which settles `readAdrAnswer(raw)`, governing records leaving out
  broken ones, a capped scan, notices and a required deadline (FR-013, R3); (3) a path is one literal path, no
  brace group (FR-012, R5); (4) every run-folder file is one Zod schema in core, and every stop one row of one table
  in planner (FR-018, R8). A listed folder inside the repo is a protected path, as root ADR-0011 d1 names it
  (FR-020, R12).
- User decisions (2026-11-03): (D1) `touches.json` is written by the check's own touches step, `adr-plan-touches`,
  from `plan.md` as it then stands, after a shell step deletes the last one; every resume after a stop runs the
  whole check again, so a resume after a plan fix rebuilds it; the plan step writes nothing for the check (FR-012, R4, planner ADR-0009 d7). (D2) A ruling reaches a resume
  from a scratch file the session writes, `adr_ruling=@<file>`, never a command line (FR-016, R9). (Q1–Q3) At
  review, a departure is ruled FIX or ESCALATE; an escalation or verdict rescope hold's question says why and what must be decided,
  a departure one line of it that core renders and reads; planner's rescope takes its open decision from those
  questions, and the plan check stops once per departure (FR-021–FR-024, US6, R13; reviewer ADR-0013 d4–d5,
  ADR-0017 d2, planner ADR-0009 d9). (D6) Both callers pass `protectedPaths` `{tickOnly, adrFolders}`;
  specs 174 and 209 say so. (D10) Root ADR-0011 and reviewer ADR-0022 are accepted.
- User decision (2026-11-04), after adversarial passes and stand-in runs on Spec Kit 1.1.3: one check, after
  critique, over the plan's and the tasks' paths, in place of a check before critique and a second after tasks
  (Option K). Each round of its loop works everything out again: settled-design, the plan's paths (recorded with
  the `plan.md` and `spec.md` they were listed from, so a change after that stops the round), `tasks.md` written
  again when a file the tasks command reads changed, landing's story checks, then the ADR check. `tasks.md` is
  derived, never edited by hand; a departure's next step is "change `plan.md`" whichever artifact named its path. A
  resume's ruling must match a departure its round found, or it is refused. US4 is merged into US3 (#277 into
  #276); folds in #303 (planner ADR-0009 d1, d4–d8; FR-006, FR-009, FR-012, FR-015–FR-019, FR-025; R6, R9, R15).

## User Scenarios & Testing *(mandatory)*

The actor is the admin who runs planner's `issue-spec` workflow where they work (constitution, Platform Constraints:
planner runs outside the agent machine). The ADR folders a repo's plans are checked against are named by that repo's
admin, once, in `codeworks.toml` `[shared]` (root ADR-0002 d2). A folder may be in the repo (`docs/adr`,
`planner/docs/adr`, …) or in another checkout beside it, such as the Org ADRs in analitiq-ai/engineering's
`docs/adr`, which this repo lists as `../engineering/docs/adr`. Keeping that other checkout current is the admin's job; the check reads what is on disk and makes no
network call.

US1 (ADR-0009's amendment) was moved into the planning PR on 2026-11-03; ADRs and specs are written in planning only.

---

### User Story 2 - core reads the list of ADR folders and resolves each path (Priority: P1)

`codeworks.toml` `[shared]` gains one key listing ADR folders, and this repo's file lists its own. core gains one
function that reads the list and resolves each entry: an absolute path is used as written; a relative path resolves
from the main checkout (the parent of `git rev-parse --git-common-dir`), so `../engineering/docs/adr` names the same
folder from every `../<repo>.worktrees/<branch>`; a relative path that resolves inside the repo is read in the
checkout the caller runs in, so the folder checked is the branch's own and a record the spec PR adds (ADR-0009 d3)
is seen. Each resolved entry says whether the folder can be read. Planner and, later, reviewer call it; neither
resolves a path of its own.

**Why this priority**: the planner stories call it, and the reviewer story will (root ADR-0009 d2: a script that calls
core is TypeScript).

**Independent Test**: Run core's tests: a scratch repository with a worktree, a `codeworks.toml` listing a relative,
an absolute, a missing and an unreadable folder; the function returns the same absolute folders outside the repo from
the main checkout and from the worktree, each checkout's own copy of an in-repo folder, and marks the missing and
unreadable ones as not readable.

**Acceptance Scenarios**:

1. **Given** `[shared]` lists `../engineering/docs/adr` and the caller runs in a worktree of the repo, **When** core
   resolves the list, **Then** the folder is `<parent of main checkout>/engineering/docs/adr`, the same as from the
   main checkout.
2. **Given** `[shared]` lists `docs/adr` and the caller runs in a worktree on the spec branch, **When** core resolves
   the list, **Then** the folder is the worktree's `docs/adr`, holding the records the spec branch adds.
3. **Given** `[shared]` lists a folder that does not exist, **When** core resolves the list, **Then** that entry is
   returned as one that cannot be read, naming the entry as written and the path it resolved to, and the other entries
   are returned as usual.
4. **Given** `[shared]` lacks the key, or gives it a value that is not a list of non-empty paths, or lists one folder
   twice, **When** core reads settings, **Then** it refuses `[shared]` with a `SettingsError` naming the key.
5. **Given** `[shared]` gives the key an empty list, **When** core reads settings and resolves the list, **Then**
   settings are accepted and no folder is returned (Clarifications: required, may be empty).

---

### User Story 3 - planner checks the plan and its tasks before the run completes (Priority: P1)

After the critique gate, one check loop runs on every run that writes a spec. Each round, one per resume after a
stop, works everything out again from the files as they then stand: the settled-design check; the plan's paths,
which a headless step lists from `plan.md` into `<run folder>/touches.json` (FR-012); `tasks.md`, written by the
tasks command when it is missing or a file it reads changed since it was written (FR-025); the checks landing makes
of `tasks.md`; then `adr check` against every listed folder over the plan's and the tasks' paths. `adr check` only
names the records that govern those paths, and fails only on a changed record's own error, so a headless model step
then judges the plan and the tasks against every governing record and writes its verdict as data, and a TypeScript
script decides each folder's outcome from it: passed, a contradiction (naming the record, the path and, for a task
path, its stories), or a check that could not run (root ADR-0004). Any contradiction or could-not-run stops the run
before it completes, naming the folder, what was found and the next legal step (constitution P1).

**Why this priority**: this is the harm the issue names: a plan that contradicts an accepted record passes planning
unchecked and is first caught at review, after the code is written.

**Independent Test**: Drive the steps against a scratch spec folder whose plan touches a path a record in a listed
folder governs, and whose `tasks.md` names a path a record governs that the plan's paths do not reach; the round
stops naming each record, and the task's story. Point one entry at a missing folder; the round stops with the
could-not-run status, never as a pass.

**Acceptance Scenarios**:

1. **Given** every listed folder answers with no error finding, **When** a round runs, **Then** it passes and
   prints, per folder, the records that govern the plan's and the tasks' paths, and the run completes.
2. **Given** a listed folder holds a record the plan or the tasks contradict, **When** a round runs, **Then** the
   run stops, naming the folder, the record id, the path and, for a task path, every story whose task names it, and
   the next steps: change `plan.md`, from which the next round writes `tasks.md` again; supersede the record, by
   drafting a superseding record into the spec PR (ADR-0009 d3) when the folder is inside this repo, or by changing
   record `<id>` in the repo that holds the folder when it is outside; or resume with a ruling.
3. **Given** a listed folder cannot be read, or `adr` is missing or at another version, or its answer cannot be read,
   **When** a round runs, **Then** that folder's outcome is a check that could not run, the run stops with the
   could-not-run exit status, and the other folders' outcomes are still printed.
4. **Given** the plan was changed at the critique gate, or after a stop, **When** the next round runs, **Then** it
   lists the plan's paths from `plan.md` as it now stands, writes `tasks.md` again from it, and checks both.
5. **Given** the run stopped on a named departure, **When** the user resumes it with a ruling that overrules that
   departure and gives a reason, **Then** the round passes that departure, the ruling is added to the spec folder's
   rulings file, and any departure the ruling does not name still stops the run (Clarifications: overrule allowed).
6. **Given** the rulings file holds a ruling on record R and path P, **When** a later round or a rescope judges a
   departure from R on P, in the plan's paths or the tasks', **Then** it passes it without stopping; a resume's
   ruling reaches only the round that resume runs, and one naming no departure that round found is refused, nothing
   appended (Clarifications: rulings honored by later checks; FR-016).
7. **Given** the rulings file holds an entry the check script did not write and `HEAD` does not hold, **When** a
   round runs, **Then** the check could not run, naming the entry (FR-016).
8. **Given** a listed folder holds a record with its own `adr check` error, **When** a round runs, **Then** the
   run stops with that folder FAIL, naming the record file and adrkit's rule and message, and the next step: fix
   that record (planner fixes it in the spec PR, or in the repo that holds the folder) (FR-008).
9. **Given** no file the tasks command reads changed since `tasks.md` was written, **When** a round runs, **Then**
   `tasks.md` is not written again (FR-025).
10. **Given** `plan.md` or `spec.md` changes after a round listed the plan's paths, **When** that round reaches the
   ADR check, **Then** it stops as could not run, and the next round lists the paths again (FR-012).
11. **Given** `tasks.md` breaks the story plan, or the spec issue's sub-issues are extra, in another repository or
   out of story order, **When** a round runs, **Then** the run stops with the landing check's line, whose next step
   never edits `tasks.md` (FR-025).

---

US4 (the tasks checked again after tasks) was merged into US3 on 2026-11-04: one check now reads both.

---

### User Story 5 - reviewer's decision check reads the same list (Priority: P3)

Reviewer's decision check, once ported to TypeScript by #209 (`reviewer/plugin/lib/round/decisions.ts`), takes its
folders from core's function (US2) in place of finding tracked `docs/adr` folders and reading
`REVIEWER_ORG_ADR_DIR`. The environment variable is deleted, with its mention in reviewer's README and tests (root
ADR-0002 d3: a setting is not an environment variable).

Planner alone creates and edits spec folders and decision records; everyone else reads them (root ADR-0011). A
story PR that changes a decision record, or a spec folder beyond its own ticks, is never attested and its card goes
to Blocked (orchestrator ADR-0004 d4); core's one `protectedPaths` tells a tick from any other change, for that and
for reviewer ADR-0010 d1's commit refusal (R12). This story builds that rule in core; its callers are #174's and
#209's. The decision check honours the spec folder's rulings and reports a record with its own `adr check` error,
always one the change touches, as a FAIL whose next step is to revert that change.

**Why this priority**: it removes the second, divergent definition of "the folders a change is checked against". Its
reviewer half waits for #209's US1 (#235); its core half does not.

**Independent Test**: Reviewer's tests: a checkout whose `[shared]` lists two folders, one outside the repo; the
decision check runs one `adr check` per listed folder and none for an unlisted tracked `docs/adr`; setting
`REVIEWER_ORG_ADR_DIR` changes nothing.

**Acceptance Scenarios**:

1. **Given** `[shared]` lists a folder that cannot be read, **When** reviewer launches a round, **Then** that folder
   is a check that could not run, as today for an unreadable `REVIEWER_ORG_ADR_DIR`.
2. **Given** the merged story, **When** the repo is searched for `REVIEWER_ORG_ADR_DIR`, **Then** nothing is found
   outside `specs/`.
3. **Given** a tracked `docs/adr` that `[shared]` does not list, **When** reviewer launches a round on a change it
   governs, **Then** no `adr check` runs against it, as planner runs none (Clarifications: reviewer checks only the
   listed folders).
4. **Given** the spec folder's rulings file holds a ruling on record R and path P, **When** reviewer's decision check finds a
   departure from R on P, **Then** the round reports none for it (Clarifications: rulings honored by reviewer).
5. **Given** the decision check finds a record with its own `adr check` error, **When** reviewer runs it, **Then**
   that folder is FAIL naming the record file, adrkit's rule and message, and the next step: revert the change to
   that record; planner fixes records (FR-020).
6. **Given** changed files and the base and head `tasks.md` of a story PR, **When** core's `protectedPaths` runs,
   **Then** it names `specs/<name>` for any change in a root spec folder except a `tasks.md` that only ticks the
   story's own tasks (TICK_ONLY), names every in-repo folder `[shared] adr_folders` lists and every `docs/adr`
   folder changed, and names nothing for a folder called `specs` below the root (FR-020).

---

### User Story 6 - a departure found at review reaches planner (Priority: P3)

Reviewer runs unsupervised, so it cannot ask the user to overrule a record. A departure its decision check reports
is ruled FIX (builder makes the code comply) or ESCALATE: the round escalates, its hold's question naming the
departure in one line, the orchestrator posts it, and the card goes to Blocked. The admin answers; when the code is
right and the record or plan wrong, they run planner's rescope, which takes its open decision from the open
questions under the spec's issue, and its check stops on each departure as on a judged one, so the user rules or
supersedes the record: its path is checked whatever the plan says, so changing the plan does not clear it. The
ruling reaches every story under the spec through the spec PR.

**Why this priority**: without it a departure the code is right about has no path to a ruling once building
starts. Its reviewer half waits for #235.

**Independent Test**: core's tests: a departure renders to its line and reads back equal; a question with no line
reads as none; a change to the spec folder's `adr-rulings.json` lapses a round. Reviewer's tests: a departure ruled
PUSH_BACK or DEFER is refused; one ruled ESCALATE lands in the hold's question as its line. Planner's tests: a
rescope with a carried departure stops at the check naming it once, however many stories carry it, and passes
once ruled; a rescope with no question takes the admin's words.

**Acceptance Scenarios**:

1. **Given** the decision check reports a departure, **When** the assessment rules it PUSH_BACK or DEFER, **Then**
   the ruling is refused as inadmissible (FR-021).
2. **Given** the assessment rules a departure ESCALATE, **When** reviewer records the round, **Then** its verdict
   is ESCALATE and `escalation-<issue>`'s question holds the line naming the folder, record, file and what departs
   (FR-022).
3. **Given** such holds are open on one or more story issues under the spec's issue, **When** the admin runs
   `/planner:issue-spec rescope <spec folder> #<issue>`, **Then** grill opens on those questions, and the check
   checks each departure's file and stops once per (folder, record, file) with the departure's next steps (FR-023).
4. **Given** no escalation hold, nor rescope hold without a spec PR, is open under the spec's issue, **When** the admin runs that rescope,
   **Then** it takes the admin's words as the open decision (FR-023).
5. **Given** the user rules on it in session, **When** the run resumes with `adr_ruling=@<file>`, **Then** the
   ruling is appended to `adr-rulings.json` and lands in the rescope's spec PR; once merged, every story's round
   under the spec lapses, the story merges the default branch, and reviewer no longer reports it (FR-017, FR-024).

---

### Edge Cases

- The list is empty: the steps check nothing, say that no ADR folder is listed, and pass; an empty list is the
  admin's choice, not a check that could not run. It passes first: settings are read before the artifact, so no
  path is read and a missing or empty `touches.json` does not stop the run.
- Two entries resolve to the same folder (e.g. `docs/adr` and an absolute path to it): core refuses the list as it
  refuses a repeated entry, naming both.
- A listed path exists but is a file, or a folder with no records: a file is a folder that cannot be read; an
  empty folder is checked and governs nothing.
- The touches step wrote no `touches.json`, or it lists no path, or `tasks.md` names no path (with a non-empty list):
  the round stops, naming `touches.json` or `tasks.md`, as a check that could not run; a check with no paths would
  pass vacuously.
- A task names files with a glob or a brace group (`a/{b,c}.ts`): refused, naming `tasks.md:<line>`; a path is one
  literal path.
- A listed folder in another checkout is behind its remote: it is checked as it is on disk (ADR-0009 d2 dropped); the
  step makes no network call.
- The workflow runs in the main checkout, not a worktree: the parent of `--git-common-dir` is the checkout itself;
  resolution is the same.
- A rescope run (starts at grill): the plan step and the check loop run; its first round writes `tasks.md` again,
  since the run has no record of the sources it was written from.
- `adr` answers slowly: past 1500 s the folder is could not run, naming the deadline and each step's seconds,
  before the step's 1800 s timeout ends it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Planner ADR-0009, orchestrator ADR-0004 d1 and d4 and ADR-0010 d1, reviewer ADR-0002 d4, ADR-0013
  d4–d5 and ADR-0017 d2, and root ADR-0010 (as R11 gives them) MUST be amended, and reviewer ADR-0022 (the decision check reads only `[shared] adr_folders` and honours a
  recorded ruling, FR-014, FR-017) and root ADR-0011 (planner alone creates and edits spec folders and decision
  records; a story PR that changes one is never attested) added, accepted, in the planning PRs that precede any code
  of US2–US6; no implementation story edits an ADR or a spec (derived from Round 3, Q1 and constitution
  Principle VI).
- **FR-002**: `codeworks.toml` `[shared]` MUST carry one required key whose value is a list of ADR folder paths,
  possibly empty; core's `Shared` schema MUST refuse a missing key, a non-list, an empty path and a repeated entry, and
  MUST accept an empty list.
- **FR-003**: This repo's `codeworks.toml` MUST list every ADR folder its plans are checked against: its tracked
  `docs/adr` folders and the Org ADRs' folder as `../engineering/docs/adr`, analitiq-ai/engineering checked out beside
  this repo on every machine that runs planner or reviewer.
- **FR-004**: core MUST expose one function that reads the list and resolves each entry: absolute as written,
  relative from the parent of the absolute `git rev-parse --git-common-dir`; a relative entry that resolves inside
  that main checkout is read at the same repo path in the caller's checkout (`git rev-parse --show-toplevel`). Each
  result MUST carry the entry as written, the resolved path, whether it lies inside the calling checkout, and
  whether it is a readable folder.
- **FR-005**: The function MUST NOT read an environment variable or make a network call.
- **FR-006**: The planner workflow MUST run one ADR check loop after the critique gate, on every run where the spec
  is written, rescope included, in place of the `tasks` step. Each round, one per resume after a stop, MUST run in
  order: the settled-design check, the touches step (FR-012), `tasks.md` written again when due (FR-025), landing's
  story checks (FR-025), and the ADR check over the plan's and the tasks' paths; no part is skipped as unchanged.
- **FR-007**: Each check step MUST call core's function (FR-004) for the folders and MUST run `adr check` once per
  readable folder, with the paths the checked artifact names.
- **FR-008**: Each folder MUST get its own outcome from the core enum: passed, failed (a departure the judge names,
  naming the record id, the path, and for tasks the story; or a record's own `adr check` error, naming the record
  file and adrkit's rule and message, next step "fix that record"), or could not run (unreadable folder, `adr`
  missing or at another version, an answer or verdict that cannot be read). Could not run MUST never read as passed.
  An empty `[shared] adr_folders` MUST pass first, before the artifact's paths are read; with a non-empty list, an
  artifact naming no path MUST be could not run naming the artifact (`touches.json` or `tasks.md`), reported by the
  ask step.
- **FR-009**: A failed or could-not-run outcome in any folder MUST stop the run, with distinct exit statuses for the
  two, after printing every folder's outcome; the message MUST name the next legal step.
  A check stop is a failed or could-not-run outcome a round recorded and showed, a touches or judge step that did
  not answer among them. Every resume after a check stop MUST run a new round on the artifacts as they then stand;
  a loop that stops 100 times in one run MUST stop the run as could not run, never passing it. A step that fails
  without an answer is no check stop: the run fails at that step, and a resume runs that step, then the rest of
  its round. No next step MUST send the user to edit `tasks.md`: a `tasks.md` refused is deleted, and the next
  round writes it again.
- **FR-010**: The ADR check steps (ask, judge, decide) MUST make no network call and use no GitHub credential;
  landing's story checks read the spec issue's sub-issues as the planner App, as landing does (FR-025).
- **FR-011**: The check steps MUST be TypeScript scripts calling core (root ADR-0009 d2), with the decision of each
  outcome in a pure function (constitution P3).
- **FR-012**: The paths a check passes MUST be read as data with a grammar (constitution P7), not parsed from prose:
  for the plan, `<run folder>/touches.json`, written by the check's own touches step from `plan.md` as it then stands,
  rebuilt in every round, and read only by planner's check, never a section of `plan.md`; the round MUST record the
  hashes of the `plan.md` and `spec.md` the touches step read, and a difference when the ADR check runs MUST make
  the round could not run; for `tasks.md`, the task line's paths. One path grammar, a literal
  path with no glob or brace group, MUST serve both, and a name with no `/` MUST count as a path when git tracks it at the checkout root or `touches.json` lists
  it (so a root file a task creates is checked before it exists).
- **FR-013**: The `adr` version the planner step requires MUST be defined once, in core, with one reader of `adr`'s
  answer, ported from reviewer's Python and proved by its tests; reviewer reads both from core in US5, and until then its Python `VERSION` (`reviewer/plugin/scripts/adrkit.py:21`) is a second copy that #235
  deletes.
- **FR-014**: After #235 merges, reviewer's decision check MUST take its folders from core's function only, no longer
  finding tracked `docs/adr` folders itself, so planner and reviewer check the same folders; `REVIEWER_ORG_ADR_DIR`
  MUST be deleted from reviewer's code, README and tests.
- **FR-015**: After each `adr check`, a headless model step MUST judge `plan.md` and `tasks.md` against every
  record `adr check` named as governing, and write one verdict per record as data with a
  grammar (constitution P7); the TypeScript script MUST decide each folder's outcome from that verdict, never from
  the model's prose. A folder whose paths no record governs needs no judgment and passes.
- **FR-016**: Rulings MUST be kept in one rulings file in the spec folder that holds only the user's rulings, each
  `{folder, record id, path, reason}` in a form with a grammar (constitution P7), so it lands in the spec PR. A resume
  MAY carry the user's ruling, read from a file the session writes so it never reaches a command line; the check
  script MUST accept it only when the folder is listed, the path is one the round asked, `adr check` on that folder
  with that one path names the record as governing, and its key names a departure that round found (the judge's or
  one found at review), and is then the only writer that adds it to the file, to its own run record first. A ruling
  applies to the round of the resume that carries it only; it is not kept as a run input. An entry the check script did not write and that is not in the file at `HEAD`
  MUST make the check could not run. Only the user gives a ruling; neither the judge nor the driving session gives one.
- **FR-017**: The rulings file MUST be given to the judge, and the check script MUST then drop every departure whose
  folder, record id and path match an entry, at every planner check of the spec folder (every later round, a
  rescope) and, after #235, at reviewer's decision check, which MUST not report such a departure.
- **FR-018**: Every check step (stories, ask, judge, decide, rounds) MUST report its stop through one
  shared function that maps the stop to its outcome and next step; no step formats its own stop. A judge or touches
  step that fails or does not answer MUST be recorded as could not run, a check stop, and the resume runs the check
  again.
- **FR-019**: The decide step MUST compare the paths (`touches.json` and `tasks.md`) and the asked record with what the ask step saw, and any difference MUST make the check could not run, naming what
  changed (the same single-writer guard as FR-016).
- **FR-020**: Core's `protectedPaths` (orchestrator ADR-0004 d4) MUST name each root spec folder a story PR changes
  beyond TICK_ONLY (reviewer ADR-0010 d1; root ADR-0011), told by one pure core function, `isTickOnly`, and each
  in-repo folder `[shared] adr_folders` lists that it changes (root ADR-0011 d1); a folder named `specs` below the
  root MUST not match. After #235, reviewer's decision check MUST report a record with its
  own `adr check` error as FAIL naming the file, rule and message, next step: revert the change to that record.
- **FR-021**: After #235, reviewer's assessment MUST rule a decision-check departure only FIX (the code changes to
  comply, the record untouched) or ESCALATE; PUSH_BACK and DEFER MUST be refused for it (reviewer ADR-0017 d2).
- **FR-022**: Each departure ruled ESCALATE MUST be one line of the `escalation-<issue>` hold's question, written by
  core's `renderAdrDeparture` (folder label, record id, file, what departs) and read back equal by
  `readAdrDepartures`; `Hold.question` stays text.
- **FR-023**: Planner's `rescope <spec folder> #<issue>` MUST take its open decision from the questions of every
  open escalation hold, and every open rescope hold with no spec PR, of every open story issue under the spec's
  issue, and from the admin's words when there are none; the
  check MUST add each departure line's file to the paths it checks, check each (folder, record, file) with one
  `adr` call of that file, and stop on each departure whose record that call names as governing, as on a departure the judge named, once per (folder, record, file), until a ruling names it (planner
  ADR-0009 d9).
- **FR-024**: A change to the spec folder's `adr-rulings.json` on the default branch MUST lapse every story's
  internal round under that spec (orchestrator ADR-0004 d1), through core's `governingDiff`.
- **FR-025**: `tasks.md` MUST be written only by the tasks command in a round, when it is missing or a file the
  command reads changed since it was last written, by hashes taken before the command runs (planner ADR-0009 d4).
  The checks landing makes of `tasks.md` (its story plan and task-block labels; the spec issue's sub-issues: extra,
  in another repository, or out of story order) MUST run in every round, through the same pure functions
  `land.ts` calls, and `land.ts`'s own stops MUST name no edit to `tasks.md`; an edit after the run is seen in
  spec-PR review.

### Key Entities

- **ADR folder list**: the `[shared]` key; ordered list of paths as written by the admin.
- **Resolved ADR folder**: an entry as written, its absolute path, inside the checkout or not, readable or not.
- **Folder outcome**: one per listed folder per check: passed, failed (with findings), could not run (with reason).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every planner run that writes a spec checks its plan and its tasks, as they stand when it completes,
  against 100% of the listed ADR folders.
- **SC-002**: A plan or tasks contradicting a record in any listed folder never lands: 0 such runs complete in the
  tests.
- **SC-003**: An unreadable listed folder is reported as could not run in 100% of cases, never as passed.
- **SC-004**: The same `codeworks.toml` resolves every folder outside the repo to the same path from the main checkout
  and from every worktree, and every folder inside the repo to the calling checkout's own copy.
- **SC-005**: After US5, one setting, and no environment variable, names the ADR folders for planner and reviewer.

## Assumptions

- The adrkit `adr` CLI at the version reviewer pins (0.20.0) is installed where planner runs; its `check --dir
  <folder> --json -- <paths>` answer is read as reviewer's `adrkit.py` reads it today.
- The key name and the form in which the paths the plan touches are named are the plan's to settle
  (settled: `adr_folders`, R1; `<run folder>/touches.json`, R4).
- The public-repo rule (a public repo lists no path to private ADRs) is a rule in ADR-0009 the admin keeps when
  writing `codeworks.toml`; this spec adds no code that reads a repo's visibility.
- The optional adrkit `after_plan` hook stays as it is; the workflow step does not depend on it.
- PR order: the planning PRs (FR-001), then US2 (core), then US3 (planner), then US5 (core's protected
  paths; reviewer after #235), then US6 (#285, after #278: core's departure line and lapse; reviewer after #235; planner's rescope).

### Dependencies

- #235 (#209's US1): ports reviewer's `adrkit.py` and `decisions.py` to `reviewer/plugin/lib/round/decisions.ts`
  (#209 T044, T053 deletes the Python). US5's reviewer half changes the TypeScript module only and waits for it;
  nothing else does.
- #174 (orchestrator's attestation) and #209 US2 (reviewer's after-commit check) call `protectedPaths`; each passes
  `{tickOnly, adrFolders}` once US5 changes its signature, as their specs now say. Their wiring is theirs.
- #209's assessment and round record (`reviewer/plugin/lib/round/{assess,record}.ts`, #209 T047) build the verdict by
  ADR-0017 d2's first-match rule and place the holds with their questions; US6 renders each departure line into the
  question once #235 has merged. #209 T010a–T010c set `Hold.question` for `escalation`, `claim` and a verdict's
  `rescope`, give `placeRescopeHold` a question, and add FindingRuling `ESCALATE`.
- #174 posts a verdict's rescope hold's question as it posts an escalation's (orchestrator ADR-0010 d1).
- #285 (US6) is blocked by #278 (US5): the departures it carries are the ones US5's decision check reports.

## Why this is worth doing

### harm
Answer: A plan that contradicts an accepted ADR, in this repo's folders or in the Org ADRs (analitiq-ai/engineering `docs/adr`), passes planning unchecked. The contradiction first surfaces at reviewer's decision check, after the code is written, when it is the most expensive thing to change.
Source: code: planner/docs/adr/0009-check-the-plan-and-its-tasks-against-the-governing-decision-logs-before-landing.md, Context; planner/plugin/speckit/workflows/issue-spec/workflow.yml has no `adr check` step.

### reachable
Answer: observed: on main, `workflow.yml` runs no `adr check` (the only `adr` match is an ADR-0006 comment at line 88), though the adrkit extension is installed in `.specify/extensions/adrkit`. Every planner run today goes plan → critique → tasks with no decision check, and no setting lists ADR folders (`codeworks.toml` `[shared]` has none).
Source: code: planner/plugin/speckit/workflows/issue-spec/workflow.yml; .specify/extensions/adrkit; codeworks.toml.

### change-alters
Answer: Yes. A plan contradicting a record in any listed folder: the new check after critique reads each folder in the `[shared]` list (relative paths resolved from the main checkout), runs `adr check` over the plan's and the tasks' paths, and the contradiction stops the run before it completes, catching too a story whose task paths a record governs. A folder that can't be read is a check that could not run, not a pass (root ADR-0004).
Source: user: issue #177 Decision (2026-11-02) and Done when; code: docs/adr/0004-treat-a-check-that-could-not-run-as-its-own-outcome-and-enforce-every-check-from.md.

### owner
Answer: Only after the code is written. Reviewer's decision check (reviewer/plugin/scripts/adrkit.py) finds every tracked `docs/adr` plus `REVIEWER_ORG_ADR_DIR`, but it runs at review. The `speckit-adrkit-check` skill exists but only runs when someone calls it by hand. Nothing checks at plan time.
Source: code: reviewer/plugin/scripts/adrkit.py; reviewer/plugin/README.md; planner/plugin/speckit/workflows/issue-spec/workflow.yml.

### inherited
Answer: Yes. It comes from planner ADR-0009 d1–d2 (accepted 2026-10-28) by way of #173's grill. ADR-0009's harm and its reachability still hold (above). d2's remote-head rule is the part the issue drops: reading from disk means no credential and no network call, and keeping the folder current is the admin's job. That is why the ADR is amended first, in the planning PR (2026-11-03; was "in its own PR").
Source: code: planner/docs/adr/0009-check-the-plan-and-its-tasks-against-the-governing-decision-logs-before-landing.md; user: issue #177 Decision.

### needs-spec
Answer: Decisions remain. The issue fixes the outcome and the ordering, but these are still open: the `[shared]` key name and the shape of each entry; the signature of core's read-and-resolve function and its could-not-run result; what a failing or could-not-run check does to the paused run (stop, or show the user a ruling); how the after-tasks check maps a story's task paths to records; and the split into PRs (ADR-0009 amendment, then the planner half, then the reviewer story after #235).
Source: user: issue #177 Decision and Order; code: docs/adr/0002-keep-every-component-s-settings-in-one-toml-file-one-section-per-component.md, docs/adr/0009-build-core-in-typescript-and-move-a-plugin-s-scripts-to-typescript-when-they-fi.md.

## Root cause

Observed: on main, `planner/plugin/speckit/workflows/issue-spec/workflow.yml` goes `plan` (line 222) →
`settled-design` (233) → `mark-critiques` (243) → `critique` (251) → `tasks` (281) with no step that runs `adr`, and
`codeworks.toml` `[shared]` (lines 1–7) lists no ADR folder.

ADR-0009 d1–d2 were accepted (2026-10-28) but never built: the workflow, the one place planner decides what runs
after `plan`, gained no step for them. The only plan-time check is adrkit's `after_plan` hook in
`.specify/extensions.yml`, registered `optional: true`; an optional hook only offers a command, which a workflow
command step does not run. Nothing could have named the folders even if a step existed: core's `Shared` schema
(`core/src/settings.ts:35–50`) is strict and has no such key, and d2 as written needs a network fetch and a credential
for the Org ADRs that planner's run does not hold for that repo.

- **Other callers**: reviewer's `corpora()` (`reviewer/plugin/scripts/adrkit.py:39–57`) decides the folders its own
  way: every tracked `docs/adr` (`worktree.decision_folders`) plus `REVIEWER_ORG_ADR_DIR` (line 22), an environment
  variable root ADR-0002 d3 rules out for a setting.
- **Examined and ruled out**: `.specify/extensions/adrkit/commands/check.md` — it checks against one `ADRKIT_DIR`
  (default `docs/adr`) and only when called; it is not the cause of the missing step. `core/src/settings.ts` — it
  refuses unknown `[shared]` keys, so no key is being silently ignored.
- **Not investigated**: whether Spec Kit's workflow engine dispatches `after_plan` hooks for a `command` step at all.
