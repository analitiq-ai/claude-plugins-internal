---
schemaVersion: 0.1.0
id: "0012"
title: "Find spec folders by their position and keep no list of design documents"
status: draft
date: 2026-10-06
deciders: []
tags: [spec-folder, settled-design, review-round]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{settled_design,gate}.py"
  - type: path
    pattern: "plugins/alq-review/{config.json,README.md}"
  - type: path
    pattern: "dev/alq-review/tests/{test_gate,test_settled_design}.py"
  - type: path
    pattern: "dev/alq-review/specs/{004-spec-folder-checks,015-nested-spec-folders}/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/29"
review:
  tier: async
externalRefs:
  - type: issue
    id: "29"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/29"
    label: "The rule to delete, what goes, what stays and the accepted loss"
---

# ADR-0012: Find spec folders by their position and keep no list of design documents

## Context

Before the first internal review round, the gate has to know which of the files a branch changes belong to
a design. The session that launches the round names its checkout. The gate reads the branch's changed files
from git there, and sorts them in two ways.

Spec folders are recognised by position: a changed path with a `specs/<feature>/` part, at any depth. No
directory is searched. Nothing checks that the folder belongs to a Spec Kit project, so any folder named
`specs/<x>/` counts.

Design documents are recognised by a list. `plugins/alq-review/config.json` holds `design_documents`, a
list of path patterns. A branch that changes a matching file and no spec folder is refused its first
internal round.

A list was rejected for spec folders: it would be hand-maintained, and `config.json` is plugin-wide, not
per repo. The same kind of list stayed in use for design documents. Issue #29 records what came of it:

- The rule fires on a file changing, not on a design changing.
- It refused the first round on PR #21, which moved tests to another folder, and on PR #28, which corrected
  two README sentences. Neither decided a design.
- Its pattern `docs/adr/**` does not match this repo's ADRs, which are in
  `dev/alq-review/docs/adr/`.

Spec Kit marks a project with a `.specify/` folder, and creates spec folders only in the `specs/` beside
it. When a repo commits `.specify/`, every checkout of it carries the mark.

Why now: issue #29 deletes the rule. A list of path patterns has to be hand-rolled and maintained.

## Decision

1. We will recognise a spec folder by Spec Kit's own mark: `specs/<feature>/` directly beside a committed
   `.specify/` folder. A `specs/` folder with no `.specify/` beside it holds no spec folders.
2. We will take the checkout from the session that launches the gate, and everything else from git in that
   checkout: the branch, the files it changes and the spec folders among them.
3. We will not require a spec folder for a change to a design document, and we will keep no list of
   design-document paths.
4. We will keep the rule that a spec folder a branch changes must be settled before the first internal round.

Which spec folder is the spec of a change is named by its issue. Issue #25 holds that design. It is not
decided here.

## Options considered

### Option A: Spec Kit's mark, read from git in the session's checkout (chosen)

| Dimension | Assessment |
|---|---|
| What the session supplies | The checkout |
| What makes a folder a spec folder | The committed `.specify/` beside its `specs/` |
| Same answer in every session and on every machine | Yes, it is read from the commit |
| Hand-maintained lists | None |
| A repo that does not commit `.specify/` | Has no spec folders, as far as the gate can tell |
| Stops a design decided in a README alone | No |

### Option B: Do nothing

Spec folders stay recognised by a `specs/<x>/` part anywhere in a path, and the design-document list and
its rule stay. Any folder named `specs/<x>/` counts as a spec folder. The list has to be kept in step with
where each repo puts its documents, and the rule keeps refusing changes that decide nothing.

### Other options, rejected

| Option | Why rejected |
|---|---|
| C. Spec Kit's pointer to the current feature, `.specify/feature.json` in the checkout | It is not committed, and only Spec Kit's `specify` step writes it. Of six checkouts of this repo, four had none and one pointed into another checkout. |
| D. The session names the spec folder when it launches the gate | The gate would take the word of the session it checks, and would still have to test the folder against git. |
| E. The plugin records the folder when its `design-doc` skill creates it | The record is local to one machine. A spec written in one session and built in another, or written without the skill, has none. |
| F. A `spec_folders` glob list in `config.json` | A hand-maintained list, and `config.json` is plugin-wide, not per repo. |
| G. Keep the design-document rule, and recognise in code only the files whose place a tool fixes | Not chosen: the rule is deleted, not narrowed. |

## Trade-offs

- A design decided by editing only a README, an ADR or a rule file will no longer be stopped at
  the first internal round. Issue #29 records this as the accepted loss.
- The rule's reason was an unsettled design as a cause of review churn. Code will no longer guard that
  case outside spec folders.
- A repo that holds spec folders and does not commit `.specify/` gets no settled-design check: its spec
  folders are not recognised.

## Consequences

- Easier: a branch that changes only documents is not refused by the settled-design check. Nothing in
  `config.json` has to follow where a repo puts its documents. A folder that only happens to be named
  `specs/<x>/` is left alone.
- Harder: nothing automatic sends an author to a spec folder when a design changes outside one. A repo has
  to commit `.specify/` before its spec folders are checked.
- **How we would know this was wrong:** review churn on a PR that is traced to a design decided in a README,
  an ADR or a rule file with no spec folder; or a spec folder that reaches review unsettled because its repo
  had no committed `.specify/`.
- Revisit if: a tool appears that marks a design change by its content, not by a file name; or Spec Kit
  changes how it marks a project.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Delete the design-document rule, its list and its tests (issue #29), from a failing test that the
   settled-design check does not refuse a README-only branch.
3. [ ] Change how a spec folder is recognised, from a failing test that a `specs/<x>/` folder with no
   `.specify/` beside it is not graded. No issue is open for this.
