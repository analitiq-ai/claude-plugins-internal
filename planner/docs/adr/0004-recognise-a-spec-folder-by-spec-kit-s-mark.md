---
schemaVersion: 0.1.0
id: "0004"
title: "Recognise a spec folder by Spec Kit's mark"
status: draft
date: 2026-10-20
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
    id: "reviewer ADR-0014"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0014-derive-the-spec-from-the-branch-at-each-round-s-launch-and-read-the-folder-as-da.md"
    label: "reviewer ADR-0014: Derive the spec from the branch at each round's launch and read the folder as data"
  - type: doc
    id: "builder ADR-0002"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/builder/docs/adr/0002-have-the-build-skills-derive-the-spec-folder-from-the-issue-number-never-from-an.md"
    label: "builder ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment"
---

# ADR-0004: Recognise a spec folder by Spec Kit's mark

## Context

Spec Kit marks a project with a `.specify/` folder and creates spec folders only in the `specs/` beside it.
`specify` takes the directory it runs in as its project, and that directory must hold `.specify/`; a parent's does
not count. So a planning run writes its spec folder into the `specs/` of the project it runs in.

planner's rescope takes a spec folder as its argument and does not look one up (FR-021). The folder check it makes
is the workflow's `select-spec` step: `specs/<feature>`, with `spec.md` present (R6).

Review and build do not use the mark: each finds the folder by the issue number, `specs/<n>-*/`, and review
validates none of it (reviewer ADR-0014, builder ADR-0002).

## Decision

We will recognise a spec folder by Spec Kit's own mark: `specs/<feature>/` directly beside a committed `.specify/`
folder. A `specs/` folder with no `.specify/` beside it holds no spec folders.

## Options considered

### Option A: Spec Kit's mark (chosen)

| Dimension | Assessment |
|---|---|
| What makes a folder a spec folder | The committed `.specify/` beside its `specs/` |
| Hand-maintained lists | None |
| A project that does not commit `.specify/` | Has no spec folders |

### Option B: Do nothing

planner's log holds no definition, and each change to planning decides again where it writes a spec folder.

### Option C: Any `specs/<x>/` folder, at any depth

Rejected as the definition: any folder that happens to be named `specs/<x>/` counts.

## Trade-offs

- Nothing checks that `.specify/` is committed. Planning's `select-spec` matches only `specs/<feature>` with a
  `spec.md`, and `speckit.specify` needs only that `.specify/` exists; review and build check nothing of the folder.
  A run in a project whose `.specify/` is untracked writes and commits a folder this decision does not count, and
  review and build still read it.
- A spec written anywhere but in Spec Kit's `specs/` is not a spec folder.

## Consequences

- Easier: one definition of a spec folder, Spec Kit's own, with no list to maintain.
- Harder: no step enforces the mark. Planning writes beside `.specify/`, but nothing checks that it is committed,
  and review and build read a folder made by hand the same way.
- **How we would know this was wrong:** a spec folder is found committed in a project with no committed `.specify/`;
  or Spec Kit writes spec folders outside the `specs/` beside `.specify/`.
- Revisit if: Spec Kit changes how it marks a project.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
