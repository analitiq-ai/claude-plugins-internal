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

Draft for the ratifier. Paths are relative to the repo root. The first half of this record is in the code
today. The second half, deleting the design-document rule, is not (main @ 50c4330).

## Context

Before the first internal review round, the gate has to know which changed files belong to a design. It
answers that in two different ways.

**Spec folders are found by position.** `_spec_folder` (`plugins/alq-review/scripts/settled_design.py:129`)
looks only at the parts of a changed path. It returns the path up to the part after the first `specs` part,
when the path has more parts after that one. It returns `None` for a path with no `specs` part and for a file
directly under `specs/`. `test_a_folder_under_a_subdirectory_counts`
(`dev/alq-review/tests/test_settled_design.py:128`) passes `plugins/x/specs/004-demo/plan.md` to
`spec_folders` and asserts that the result is the folder `plugins/x/specs/004-demo`. Spec 015 chose this in
`dev/alq-review/specs/015-nested-spec-folders/research.md` R1: "it is Spec Kit's own layout", "so it needs
nothing kept in step with it".

**Design documents are found by a configured list.** `plugins/alq-review/config.json` holds
`design_documents`, five path patterns: `**/README.md`, `**/CLAUDE.md`, `**/AGENTS.md`, `docs/adr/**` and
`.claude/rules/**`. When the changed files lie in no spec folder that the checkout still has,
`branch_problems` returns one problem for each changed file that matches a pattern
(`plugins/alq-review/scripts/settled_design.py:149`). The gate passes the list in at
`plugins/alq-review/scripts/gate.py:359`, and the `--branch` mode of the script does at
`plugins/alq-review/scripts/settled_design.py:164`. Spec 004 chose the rule in
`dev/alq-review/specs/004-spec-folder-checks/research.md` R10 and states it as FR-004
(`dev/alq-review/specs/004-spec-folder-checks/spec.md:170`).

Spec 015 R1 rejected a list for spec folders and said why: it "would be a hand-maintained list, and
`config.json` is plugin-wide, not per repo" (`dev/alq-review/specs/015-nested-spec-folders/research.md:8`).
Lines 13 and 14 of that file call `design_documents` "a configured list, rejected for the reason above". The
list stayed in use for design documents.

What was observed of the rule:

- `design_documents` matches the paths of changed files, not their content
  (`plugins/alq-review/scripts/settled_design.py:126`). A branch whose changed files match no pattern and
  lie in no spec folder gets no problem from `branch_problems`.
- The rule refused the first internal round on PR #21, which moved tests to another folder, and on PR #28, which
  corrected two README sentences. Neither decided a design.
- Run on 2026-10-06 with Python 3.13.5 and the patterns of `config.json`, `design_documents` matched
  `docs/adr/0001-x.md` and did not match `dev/alq-review/docs/adr/0001-x.md`. The constitution puts this
  repo's decision records in `dev/alq-review/docs/adr/`
  (`dev/alq-review/.specify/memory/constitution.md:131`).

## Decision

1. **Position, not a list.** A spec folder is `<dir>/specs/<feature>/` at any depth, read from the path.
   `spec_folders` answers it for `branch_problems` and for the `--spec-folders` mode
   (`plugins/alq-review/scripts/settled_design.py:148`, `:159`), which the `design-doc` skill calls
   (`plugins/alq-review/skills/design-doc/SKILL.md:29`). This is spec 015 R1 and R2, and it stands as built.
2. **No design-document rule.** The user decided on 2026-10-06 to delete the rule "a design-document change
   needs a spec folder" and the `design_documents` list it reads, with no replacement. The user said: "I do
   not want to hand-roll and maintain a list of path patterns."
3. **What stays.** A spec folder that a branch changes must be settled before the first internal round.

This record replaces spec 004 FR-004, for its design-document half, and spec 004 research R10. The specs are
history and are not rewritten.

Accepted loss: a design decided by editing only a README, a decision record or a rule file will no longer be
stopped at the first internal round. Reviewers grading the change against the spec are what guards against
it.

## Options considered

### Option A: Spec folders by position, and no design-document rule (decided by the user)

| Dimension | Assessment |
|---|---|
| Hand-maintained lists | None |
| Stops a design decided in a README alone | No. This is the accepted loss |
| Refuses a branch that changes only documents | No |

### Option B: Do nothing: the configured list and its rule (today)

Rejected by the user. The reasons on record are the three observations in Context and the reason spec 015 R1
gave against a list.

### Other options, rejected

| Option | Why rejected |
|---|---|
| C. Keep the rule, and recognise in code only files whose place a tool fixes (decision records, the constitution) | Offered to the user on 2026-10-06 and not chosen. A decision record would then need a spec folder beside it. |
| D. A `spec_folders` glob list in `config.json` | Spec 015 R1: "a hand-maintained list, and `config.json` is plugin-wide, not per repo". |
| E. The `.specify/` folder as the mark of a Spec Kit project | Spec 015 R1: "no Analitiq repo commits it" (`dev/alq-review/specs/015-nested-spec-folders/research.md:12`). |
| F. Widen the patterns to any depth | It keeps a list of path patterns, which the user's decision rules out. |

## Trade-offs

- The reason spec 004 gave for the rule is no longer guarded by code: "an unsettled design was the main cause
  in the churn study" (`dev/alq-review/specs/004-spec-folder-checks/research.md:179`).
- A folder named `specs/<x>/` that is not a spec folder is treated as one. Spec 015 R1 accepted this: it
  "fails loud (its missing `plan.md` is named), not silently"
  (`dev/alq-review/specs/015-nested-spec-folders/research.md:11`).

## Consequences

- Easier: the settled-design check will not refuse a branch that changes only documents. Nothing in
  `config.json` has to be kept in step with where a repo puts its documents.
- Harder: nothing automatic sends an author to a spec folder when a design changes outside one.
- What goes with the rule is listed in issue #29. It includes the tests of the class `DesignDocuments`
  (`dev/alq-review/tests/test_gate.py:1240`) and the sentence at `plugins/alq-review/README.md:61`.
- **How we would know this was wrong:** review churn on a PR that is traced to a design decided in a README,
  a decision record or a rule file with no spec folder; or a repo whose `specs/<x>/` folders are not spec
  folders and get refused.
- Revisit if: a tool appears that marks a design change by its content, not by a file name.

## Action items

1. [ ] The ratifier accepts this record, or sends it back.
2. [ ] Delete the rule, its list and its tests (issue #29), with a test first that the settled-design check
   does not refuse a README-only branch.
3. [ ] Note in the change that it replaces spec 004 FR-004 (design-document half) and R10.
