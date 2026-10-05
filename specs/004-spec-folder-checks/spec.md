# Feature Specification: Spec-folder checks before the first review round

**Feature Branch**: `004-spec-folder-checks` (spec directory; no issue or code branch yet)
**Created**: 2026-09-29
**Status**: Draft
**Issue**: none yet
**Input**: The prose review churn study and the gap matrix agreed with the user in session 3585c161. The user
agreed that the checks live once at user level in the `alq-review` plugin, that three of them refuse a commit,
and that the settled-design check refuses the first internal review round.

## Background

Spec files go through many review rounds. The rules that would prevent this already exist as prose, and they are
not followed. The internal review loop triggered the largest share of the edits, so a defect has to be caught
before a reviewer sees it.

Evidence, not restated here:
- The causes and their frequency: [the study](../../prose-review-churn-report.md), sections 3 and 4.
- The worked example used for replay in this spec: the same report, section 1 (infra PR 1135).

## User Scenarios & Testing *(mandatory)*

The author is an agent or a person who edits files in a spec folder. The user is the person who owns the repo.

### User Story 1: A restated fact is refused at commit (Priority: P1)

Each kind of fact in a spec folder has one owning file. Other files refer to an owned item by its identifier.
When an author commits a change in which a file repeats the wording of an item it does not own, the commit is
refused. The same happens when a reference points at an item that does not exist.

**Why this priority**: restated facts were a cause in about 21 of the 30 cases, and every later check relies on
knowing which file owns what.

**Independent test**: in a stub spec folder, copy a success criterion's wording from `spec.md` into `tasks.md`
and commit. The commit is refused and the refusal names both files and the line.

**Acceptance scenarios**:
1. **Given** `spec.md` owns success criteria and defines `SC-003`, **When** a commit adds `SC-003`'s wording to
   `facts.md`, **Then** the commit is refused. The refusal names `facts.md`, the line, the owner `spec.md`, and
   says to cite `SC-003` instead.
2. **Given** `tasks.md` cites `SC-003`, **When** a commit deletes `SC-003` from `spec.md`, **Then** the commit is
   refused and the refusal names every file that still cites it.
3. **Given** a file cites `R7` and `research.md` has no `R7`, **When** the change is committed, **Then** the
   commit is refused and the missing identifier is named.
4. **Given** a file that cites owned items only by identifier, **When** the change is committed, **Then** the
   check passes and adds no output.
5. **Given** a spec folder with no ownership file of its own, **When** a change is committed, **Then** the
   default map applies.
6. **Given** a spec folder that declares an extra kind of owned item, **When** a file that does not own it
   repeats its wording, **Then** the commit is refused the same way.
7. **Given** a spec folder that tries to give `tasks.md` ownership of success criteria, **When** a change is
   committed, **Then** the commit is refused and the refusal names the default owner.
8. **Given** a task that quotes a data-model rule word for word and marks it as a quote, **When** the change is
   committed, **Then** the check passes.
9. **Given** that task, **When** a commit changes the rule in `data-model.md` and not the quote, **Then** the
   commit is refused and the refusal names the task and the rule.
10. **Given** a spec folder that existed before the checks were turned on and holds an old repeat, **When** a
    commit touches any file in that folder, **Then** the commit is refused and the old repeat is named.
11. **Given** a repo where speckit is not installed, **When** a commit touches `specs/<feature>/`, **Then** the
   check runs the same way.

---

### User Story 2: A tick or a recorded observation needs evidence (Priority: P2)

When an author ticks a task or adds an entry to `facts.md`, the line cites something checkable: a PR, a run ID
or a commit. The cited item must exist. A commit that adds a tick or an entry without one is refused.

**Why this priority**: claims written without checking the source were a cause in about 13 cases. In PR 1135,
ticks and records were written from summaries and later reversed.

**Independent test**: in a stub folder, tick a task with no citation and commit. The commit is refused. Add a
citation to a PR that exists and commit again. The commit passes.

**Acceptance scenarios**:
1. **Given** an unticked task, **When** a commit ticks it with no citation, **Then** the commit is refused and
   the refusal names the task and the three accepted kinds of citation.
2. **Given** a tick that cites PR 9999, **When** no such PR exists in that repo, **Then** the commit is refused
   and the refusal says the PR was not found.
3. **Given** a tick that cites a commit, **When** that commit is not an ancestor of the branch tip, **Then** the
   commit is refused.
4. **Given** GitHub cannot be reached, **When** a commit adds a tick that cites a PR, **Then** the commit is
   refused and the refusal says the citation could not be verified and why.
5. **Given** a `facts.md` entry, **When** it is added without a citation, **Then** the commit is refused.

---

### User Story 3: A change is either design or status, not both (Priority: P3)

A change set either changes the design (the wording of requirements, criteria, decisions, the data model,
contracts, or a task's definition) or updates status (ticks and recorded observations). A commit that would make
the branch hold both is refused.

This covers the PR 1135 case where a task's pass criteria were rewritten in the change that recorded the pass.

**Why this priority**: one PR doing several jobs was a cause in about 13 cases. It ranks below stories 1 and 2
because it needs their definitions of "task definition" and "tick".

**Independent test**: on a branch that already changed a task's definition, tick any task and commit. The commit
is refused and names the earlier commit that changed the definition.

**Acceptance scenarios**:
1. **Given** a branch whose earlier commit changed the wording of `SC-002`, **When** a later commit ticks a task,
   **Then** the later commit is refused. The refusal names the design change, the commit that made it, and says
   to move one of the two to another branch.
2. **Given** a branch with only status updates, **When** a commit changes a task's definition, **Then** it is
   refused the same way.
3. **Given** a branch that creates a new spec folder with no ticks, **When** it is committed, **Then** the check
   passes.
4. **Given** a staged change that is status only, and a branch that is status only, **When** it is committed,
   **Then** the check passes.

---

### User Story 4: An unsettled design does not reach reviewers (Priority: P4)

Before the first internal review round on a branch that changes a spec folder or a design document, the branch
must change a spec folder, every mechanism the plan lists must have a recorded decision, each decision must name
the existing tools looked at or say none fit and where it looked, and no open question may be left in the folder.
Otherwise the round is refused.

**Why this priority**: an unsettled design was the primary cause in about 24 of 30 cases, so its value is the
highest. It ranks last because the check depends on the plan listing its mechanisms, which authors write by hand
until the authoring templates change (see Out of Scope).

**Independent test**: in a stub folder, leave one `NEEDS CLARIFICATION` marker in `plan.md` and launch the first
review round. The round is refused and the refusal names the file and line.

**Acceptance scenarios**:
1. **Given** `plan.md` lists a mechanism that cites decision `R4`, **When** `research.md` has no `R4`, **Then**
   the first review round is refused and the mechanism is named.
2. **Given** decision `R4` names no existing tool and does not say where it looked, **When** the round is
   launched, **Then** it is refused and `R4` is named.
3. **Given** `plan.md` has no list of mechanisms, **When** the round is launched, **Then** it is refused and the
   refusal says what the list must contain.
4. **Given** a half-written plan with open questions, **When** the author commits it, **Then** the commit is not
   refused by this check.
5. **Given** a branch that changes no spec folder and no design document, **When** the first round is launched,
   **Then** this check does not run.
6. **Given** a branch that changes `README.md` and no spec folder, **When** the first round is launched, **Then**
   it is refused, and the refusal names `README.md` and says to add a spec folder.
7. **Given** a branch that changes `README.md` and a settled spec folder, **When** the first round is launched,
   **Then** it is not refused.
8. **Given** the checks are in `log` and a branch changes `README.md` and no spec folder, **When** the first
   round is launched, **Then** it is not refused and the failure is logged.

### Edge Cases

- A file paraphrases an owned item in different words. No check detects this; see Assumptions.
- A tick cites the commit that contains it. That commit does not exist yet, so the citation is refused.
- A spec folder is renamed or moved in the change. Both the old and new paths are checked as one folder.
- A commit touches two spec folders. Each is checked, and the refusal lists the failures per folder.
- A repo git-ignores `specs/`. The checks cannot see its spec folders, so every repo they cover commits
  `specs/` (see Assumptions).
- A branch has no PR yet. The change set is compared against the repo's default branch.
- A check crashes. The commit or round it was deciding is refused, and the refusal names the error and the log.
- The checks are in `log` mode while the rest of the plugin enforces. The checks refuse nothing, and the
  plugin's other refusals are unchanged.

## Requirements *(mandatory)*

### Functional Requirements

**Scope and placement**

- **FR-001**: The checks MUST apply to every directory directly under `specs/` in any repo on the machine,
  with one installed copy and no per-repo setup.
- **FR-002**: The checks MUST NOT depend on speckit being installed in the repo.
- **FR-003**: The owned-facts, evidence and change-kind checks MUST refuse a commit that touches a spec folder.
- **FR-004**: The settled-design check MUST refuse the first internal review round on a branch that changes a
  spec folder or a design document, and MUST NOT refuse a commit. A branch that changes a design document and
  no spec folder is refused. The refusal names the design document at line 1, the rule, and the next step:
  settle the design in a spec folder.
- **FR-005**: An author MUST be able to run each check on demand against a named spec folder, and the
  settled-design check also against a checkout and the branch it merges into. It MUST change nothing and give
  the same result as the gate.
- **FR-006**: The checks MUST have their own `log` and `enforce` setting, separate from the plugin's. In `log`
  nothing is refused and each failure is logged as one that would have refused.

**Owned facts**

- **FR-007**: Each kind of owned item MUST have exactly one owning file. One shared default map declares the
  owners and applies to every spec folder with no setup.
- **FR-008**: A spec folder MAY add kinds of owned item to the map for itself. It MUST NOT change or remove an
  owner the default map declares.
- **FR-009**: A commit MUST be refused when a file contains the wording of an item it does not own. Wording is
  compared after whitespace and letter case are normalised.
- **FR-010**: A commit MUST be refused when a reference to an identifier does not resolve inside the spec
  folder, including when the change deletes the item.
- **FR-011**: Task text MAY quote a constraint when the quote is marked as a quote and matches the owner's
  text exactly. A quote that differs from the owner's text MUST be refused.

**Evidence**

- **FR-012**: Every task tick and every `facts.md` entry in a spec folder MUST cite a PR, a run ID or a commit.
- **FR-013**: The cited item MUST exist: a PR or run in that repo on GitHub, or a commit that is an ancestor of
  the branch tip. Existence is verified when a change adds or alters the citation.
- **FR-014**: When existence cannot be verified, the commit MUST be refused with the reason.

**Change kind**

- **FR-015**: Every changed line in a spec folder MUST be classified as design or status. Status is a tick
  state or a `facts.md` entry. Everything else is design.
- **FR-016**: A commit MUST be refused when the branch's change set, compared against the merge base with the
  branch its PR merges into, would hold both kinds.

**Settled design**

- **FR-017**: `plan.md` MUST list its mechanisms, each citing a decision in `research.md`.
- **FR-018**: Each cited decision MUST record what was chosen, why, and the existing tools looked at, or state
  that none fit and where it looked.
- **FR-019**: No `NEEDS CLARIFICATION` marker may remain in any file of the spec folder.

**Refusals**

- **FR-020**: Every refusal MUST name the file, the line, the rule broken and the next step.
- **FR-021**: A check that fails to run MUST refuse the call it was deciding and log the error.

**Existing spec folders**

- **FR-022**: The checks MUST apply to the whole content of every spec folder, including folders that exist
  before the checks are turned on. No folder is exempt.
- **FR-023**: The checks MUST be switched to `enforce` only after every existing spec folder passes them.

### Key Entities

- **Spec folder**: a directory directly under `specs/`. Holds the spec files for one feature.
- **Owned item**: a statement with an identifier, such as a requirement, a success criterion, a task, a decision
  or a data-model rule. It has one owning file.
- **Ownership map**: states which file owns each kind of owned item. One shared default, plus any kinds a
  spec folder adds for itself.
- **Citation**: a reference from one file to an owned item by its identifier.
- **Evidence reference**: a PR, run ID or commit cited by a tick or a `facts.md` entry.
- **Change set**: everything a branch changes in a spec folder since its merge base, plus what is staged.
- **Refusal**: the result of a failed check. It carries the file, line, rule and next step.
- **Design document**: a file whose change needs a spec folder. By default, at any depth, `README.md`,
  `CLAUDE.md` and `AGENTS.md`, plus everything under `docs/adr/` and `.claude/rules/`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Replaying the commits of infra PR 1135 in order, each of the three defects named in the study's
  section 1 that these checks can see is refused at the commit that introduced it: the removal of a cited
  success criterion, a tick without evidence, and a task's criteria changed in the change set that ticked it.
- **SC-002**: A spec folder whose files cite owned items only by identifier, with evidence on every tick, passes
  all four checks with no refusal.
- **SC-003**: A commit that touches a spec folder is delayed by under 5 seconds when no citation needs checking
  on GitHub, and under 15 seconds when one does.
- **SC-004**: On the day the checks are switched to `enforce`, every existing spec folder passes all four.
- **SC-005**: Over the first 10 PRs that change a spec folder after the checks are enforced, the median number
  of commits touching any one spec file is 3 or fewer. The study's cases started at 4.
- **SC-006**: Over the same 10 PRs, internal review rounds raise no finding of the kinds the checks cover:
  a restated fact, a broken reference, a tick without evidence, or a mixed change.

## Assumptions

- Paraphrase is out of reach. A deterministic check finds repeated wording and broken references. It does not
  find the same fact written in different words, which is part of what drifted in PR 1135. SC-006 will show how
  much is left.
- The settled-design check sees only the mechanisms the plan lists. It cannot tell that a mechanism is missing
  from the list.
- Authors write the plan's list of mechanisms by hand until the authoring templates change.
- The plan's research step evaluates the community speckit extensions `gates` and `arch-governance` as
  off-the-shelf alternatives before anything is built.
- The ownership map's format, and that of a folder's additions, is a new contract. It is settled and merged
  before the check that reads it.
- Cleaning up the existing spec folders is part of this feature's delivery. Known today: `001`, `002` and `003`
  in the engineering repo, and `001` in the infrastructure repo.
- A clean-up removes repeats (design) and adds citations to old ticks (status). The change-kind check would
  refuse that as a mixed change, so the clean-up is done while the checks are in `log` mode.
- The checks run inside a Claude session. Hand edits and commits made outside one are not covered.
- The bot container has its own copy of the plugin and gets the checks only when its image is rebuilt.
- Every repo the checks cover commits `specs/` (user decision, 2026-09-30). Today the plugins and engine repos
  ignore it in `.gitignore` and the infrastructure checkout in a local exclude. Un-ignoring it there is part of
  this feature's delivery and is done before the checks are switched to `enforce`. Spec folders in the public
  repos hold no internal or cloud-specific detail.

## Out of Scope

Each is specified separately:
- Review-loop behaviour inside `alq-review`: the third-edit stop, assessor limits, batching of findings.
- An ADR lint.
- CI backstop jobs.
- Replacement speckit templates and a speckit extension.
- The new rule file and constitution principle, which ship in their own PR.
