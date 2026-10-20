---
schemaVersion: 0.1.0
id: "0004"
title: "Recognise a spec folder by Spec Kit's mark"
status: draft
date: 2026-10-09
deciders: []
tags: [spec-folder, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0005"]
affects:
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
review:
  tier: async
externalRefs:
  - type: issue
    id: "63"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
    label: "Move planning (issue-spec) out of reviewer into its own plugin"
  - type: doc
    id: "reviewer ADR-0012"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0012-find-spec-folders-by-spec-kit-s-mark-and-keep-no-list-of-design-documents.md"
    label: "Decision 1, decided here again for planner"
  - type: doc
    id: "reviewer ADR-0016"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md"
    label: "Review verifies a named folder by its parent `specs` and its spec.md"
---

# ADR-0004: Recognise a spec folder by Spec Kit's mark

## Context

reviewer's ADR-0012, decision 1, recognises a spec folder by Spec Kit's own mark: `specs/<feature>/` directly
beside a committed `.specify/` folder. Spec 019 FR-023 has an existing record that binds a new plugin decided again
in that plugin's log, not copied, and research R16 names that decision as one planner decides again. This is that
record.

Spec Kit marks a project with a `.specify/` folder and creates spec folders only in the `specs/` beside it.
`specify` takes the directory it runs in as its project, and that directory must hold `.specify/`; a parent's does
not count. So a planning run writes its spec folder into the `specs/` of the project it runs in.

planner's rescope takes a spec folder as its argument and does not look one up (FR-021). The folder check it makes
is the workflow's `select-spec` step: `specs/<feature>`, with `spec.md` present (R6).

Review and build are told the folder planning writes. Review checks less than this mark: the path is relative with
no `..`, its parent is named `specs`, and `spec.md` is in HEAD and not empty (FR-007, reviewer's ADR-0016,
decision 3). Review does not use ADR-0012, decision 1 (reviewer's ADR-0017). `/builder:issue-tackle` takes
`spec` in the same form (FR-015).

Why now: PR #75, on main, gave planning its present shape inside reviewer. Research R16 gives planner a log of
its own and has it land before the move into planner. This record was written first, on the branch of PR #72. The
move (PR #76) merged into that branch, not into main, so the move and this record reach main together, in PR #72.

## Decision

We will recognise a spec folder by Spec Kit's own mark: `specs/<feature>/` directly beside a committed `.specify/`
folder. A `specs/` folder with no `.specify/` beside it holds no spec folders.

## Options considered

### Option A: Spec Kit's mark (chosen)

| Dimension | Assessment |
|---|---|
| What makes a folder a spec folder | The committed `.specify/` beside its `specs/` |
| Passes review's shape check | Yes, every folder planning writes: review's check is looser than the mark |
| Hand-maintained lists | None |
| A project that does not commit `.specify/` | Has no spec folders |

### Option B: Do nothing

planner's log holds no definition, and each change to planning decides again where it writes a spec folder.

### Option C: Any `specs/<x>/` folder, at any depth

What review checked before reviewer's ADR-0012, and checks again since its ADR-0016. ADR-0012 rejected it as the
definition: any folder that happens to be named `specs/<x>/` counts.

## Trade-offs

- Nothing checks that `.specify/` is committed. Planning's `select-spec` matches only `specs/<feature>` with a
  `spec.md`, `speckit.specify` needs only that `.specify/` exists, review checks only a parent named `specs` and a
  `spec.md` in HEAD that is not empty, and build only the `spec.md`. A run in a project whose `.specify/` is untracked
  writes and commits a folder this decision does not count, and review accepts it.
- A spec written anywhere but in Spec Kit's `specs/` is not a spec folder.

## Consequences

- Easier: every folder planning writes passes review's shape check.
- Harder: no step enforces the mark. Planning writes beside `.specify/`, but nothing checks that it is committed, so
  a folder planning writes, like one made by hand, is held only to review's check.
- **How we would know this was wrong:** a spec folder is found committed in a project with no committed `.specify/`;
  or Spec Kit writes spec folders outside the `specs/` beside `.specify/`.
- Revisit if: Spec Kit changes how it marks a project.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
