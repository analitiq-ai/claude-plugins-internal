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

Before the first internal review round, the gate has to know which changed files belong to a design. It
answers that in two ways.

Spec folders are found by position. Spec 015 research R1 chose `<dir>/specs/<feature>/` at any depth, read
from the path, because "it is Spec Kit's own layout", "so it needs nothing kept in step with it".

Design documents are found by a list. `plugins/alq-review/config.json` holds `design_documents`, a list of
path patterns. A branch that changes a matching file and no spec folder is refused its first internal round.
Spec 004 chose that rule (FR-004, research R10).

Spec 015 R1 rejected a list for spec folders: it "would be a hand-maintained list, and `config.json` is
plugin-wide, not per repo". The same kind of list stayed in use for design documents. Issue #29 records what
came of it:

- The rule fires on a file changing, not on a design changing.
- It refused the first round on PR #21, which moved tests to another folder, and on PR #28, which corrected
  two README sentences. Neither decided a design.
- Its pattern `docs/adr/**` does not match this repo's decision records, which are in
  `dev/alq-review/docs/adr/`.

Why now: on 2026-10-06 the user decided to delete the rule. The user said: "I do not want to hand-roll and
maintain a list of path patterns."

## Decision

1. We will find a spec folder by its position, `<dir>/specs/<feature>/` at any depth, with no configured
   list. This is spec 015 R1 and R2, and it stands as built.
2. We will delete the rule "a design-document change needs a spec folder" and the `design_documents` list it
   reads, with no replacement.
3. We will keep the rule that a spec folder a branch changes must be settled before the first internal round.

This replaces spec 004 FR-004, for its design-document half, and spec 004 research R10. Those specs are
history and are not rewritten.

## Options considered

### Option A: Spec folders by position, and no design-document rule (chosen)

| Dimension | Assessment |
|---|---|
| Hand-maintained lists | None |
| Stops a design decided in a README alone | No |
| Refuses a branch that changes only documents | No |

### Option B: Do nothing

The list and its rule stay. The list has to be kept in step with where each repo puts its documents, and
the rule keeps refusing changes that decide nothing.

### Other options, rejected

| Option | Why rejected |
|---|---|
| C. Keep the rule, and recognise in code only the files whose place a tool fixes | Put to the user on 2026-10-06 and not chosen. The user chose to delete the rule. |
| D. A `spec_folders` glob list in `config.json` | Spec 015 R1: "a hand-maintained list, and `config.json` is plugin-wide, not per repo". |
| E. The `.specify/` folder as the mark of a Spec Kit project | Spec 015 R1: "no Analitiq repo commits it". |

## Trade-offs

- A design decided by editing only a README, a decision record or a rule file will no longer be stopped at
  the first internal round once the rule is deleted. Issue #29 records this as the accepted loss.
- Spec 004 R10 gave the rule its reason, an unsettled design as a cause of review churn. Code will no
  longer guard that case outside spec folders.
- A folder named `specs/<x>/` that is not a spec folder is treated as one. Spec 015 R1 accepted this: it
  "fails loud (its missing `plan.md` is named), not silently".

## Consequences

- Easier: a branch that changes only documents is not refused by the settled-design check. Nothing in
  `config.json` has to follow where a repo puts its documents.
- Harder: nothing automatic sends an author to a spec folder when a design changes outside one.
- **How we would know this was wrong:** review churn on a PR that is traced to a design decided in a README,
  a decision record or a rule file with no spec folder; or a repo whose `specs/<x>/` folders are not spec
  folders and get refused.
- Revisit if: a tool appears that marks a design change by its content, not by a file name.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Delete the rule, its list and its tests (issue #29), from a failing test that the settled-design
   check does not refuse a README-only branch.
3. [ ] Note in that change that it replaces spec 004 FR-004 (design-document half) and R10.
