# Feature Specification: One folder per component, one Spec Kit project, Codeworks names

**Feature Branch**: `139-spec`

**Created**: 2026-10-20

**Status**: Draft

**Input**: https://github.com/analitiq-ai/claude-plugins-internal/issues/139

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The repo is laid out and named as Codeworks (Priority: P1)

A maintainer opens the repo and finds each component (reviewer, planner, builder, auditor, orchestrator)
in one top-level folder holding everything about it: the installed plugin, its tests and its decision
records. Spec work runs from the repo root against one Spec Kit project and one constitution; feature
specs sit in `specs/<n>-<slug>/`. A user installs the plugins as `reviewer@codeworks`,
`planner@codeworks`, `builder@codeworks` and `auditor@codeworks`.

**Why this priority**: it is the only story; every later Codeworks PR lands in this layout.

**Independent Test**: CI runs every component's tests from its new folder and they pass; a fresh
`claude plugin install` of each plugin from the marketplace copies only `<component>/plugin/`.

**Acceptance Scenarios**:

1. **Given** the restructured repo, **When** CI runs, **Then** it finds and runs `reviewer/tests`,
   `planner/tests` and `builder/tests`, and every suite passes.
2. **Given** the marketplace, **When** a user installs `reviewer@codeworks`, **Then** the install holds
   the plugin's agents, hooks, scripts, skills and workflows and no tests, specs or records.
3. **Given** any decision record, **When** a reader follows a link to a file in this repo, **Then** the
   link resolves on `main`, and every `affects` pattern names a path that exists.
4. **Given** a reviewer agent dispatching an audit agent, **When** it names the agent, **Then** the name is
   `auditor:<agent>` and the auditor plugin is installed from this marketplace.

### Edge Cases

- History is not rewritten: the body of an accepted or superseded record, a past spec folder and a
  replayed-commit test fixture keep the names they were written with; only their links and `affects`
  patterns follow the move.
- The attestation marker `<!-- analitiq-internal-review -->` carries no plugin name and the org pr-gate
  reads it; it is unchanged.
- The `alq-session-id` commit trailer is a rule of the org git workflow (analitiq-ai/engineering#95); it is
  unchanged here.

## Requirements *(mandatory)*

- **FR-001**: Each of reviewer, planner, builder and auditor MUST live in one top-level folder:
  `plugin/` (what an install copies), `tests/` where it has tests, `docs/adr/` where it has records.
- **FR-002**: The orchestrator's records MUST live in `orchestrator/docs/adr/`.
- **FR-003**: The repo MUST hold one Spec Kit project at its root and one constitution, stating the
  inherited principles I–VI and each repo principle once, with the components each applies to.
- **FR-004**: Feature specs MUST live in `specs/<n>-<slug>/` at the root.
- **FR-005**: The marketplace MUST be named `codeworks` and list reviewer, planner, builder and auditor.
- **FR-006**: Every name that carries the old product name MUST take the component's name: plugin names
  and command namespaces, the `alq-github-pr-review` skill (`github-pr-review`), the planner's Spec Kit
  workflow (`issue-spec`), environment variables (`ALQ_REVIEW_*` → `REVIEWER_*`, `ALQ_ORG_ADR_DIR` →
  `REVIEWER_ORG_ADR_DIR`, `ALQ_PLAN_ROOT` → `PLANNER_ROOT`), reviewer's local state folder
  (`~/.local/state/codeworks/reviewer`), its on/off phrase (`reviewer on` / `reviewer off`) and its
  message prefix (`[reviewer]`).
- **FR-007**: auditor MUST be the `alq-anti-pattern` plugin from analitiq-ai/engineering, unchanged but for
  its name; engineering drops its copy and renames the references it holds in a paired PR.
- **FR-008**: Every `docs/adr/` folder MUST be owned by the ratifier in CODEOWNERS.
- **FR-009**: CI MUST run every `<component>/tests` folder.

## Success Criteria *(mandatory)*

- **SC-001**: No file outside history (see Edge Cases) names `alq-review`, `alq-plan`, `alq-build`,
  `alq-anti-pattern`, `alq-internal` or an `ALQ_` variable.
- **SC-002**: One `.specify/` in the repo.
- **SC-003**: All test suites pass in CI.
