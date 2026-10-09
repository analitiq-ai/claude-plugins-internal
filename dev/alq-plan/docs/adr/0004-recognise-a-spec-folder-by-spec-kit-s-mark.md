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
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
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
    label: "Move planning (alq-spec) out of alq-review into its own plugin"
  - type: doc
    id: "alq-review ADR-0012"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0012-find-spec-folders-by-spec-kit-s-mark-and-keep-no-list-of-design-documents.md"
    label: "Decision 1, decided here again for alq-plan"
  - type: doc
    id: "alq-review ADR-0016"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md"
    label: "Review verifies a named spec folder by this mark"
---

# ADR-0004: Recognise a spec folder by Spec Kit's mark

## Context

alq-review's ADR-0012, decision 1, recognises a spec folder by Spec Kit's own mark: `specs/<feature>/` directly
beside a committed `.specify/` folder. Spec 019 FR-023 has an existing record that binds a new plugin decided again
in that plugin's log, not copied, and research R16 names that decision as one alq-plan decides again. This is that
record.

Spec Kit marks a project with a `.specify/` folder and creates spec folders only in the `specs/` beside it.
`specify` takes the directory it runs in as its project, and that directory must hold `.specify/`; a parent's does
not count. So a planning run writes its spec folder into the `specs/` of the project it runs in.

alq-plan's rescope takes a spec folder as its argument and does not look one up (FR-021). The folder check it makes
is the workflow's `select-spec` step: `specs/<feature>`, with `spec.md` present (R6).

Review and build are told the folder planning writes. Review verifies a named folder in HEAD by this mark: the parent is
named `specs`, `<parent of specs>/.specify` is a folder in HEAD, and `spec.md` is in HEAD and not empty (FR-007,
alq-review's ADR-0016, decision 3). `/alq-build:issue-tackle` takes `spec` in the same form (FR-015).

Why now: alq-plan gets its own decision log before the code moves into it (R16).

## Decision

We will recognise a spec folder by Spec Kit's own mark: `specs/<feature>/` directly beside a committed `.specify/`
folder. A `specs/` folder with no `.specify/` beside it holds no spec folders.

## Options considered

### Option A: Spec Kit's mark (chosen)

| Dimension | Assessment |
|---|---|
| What makes a folder a spec folder | The committed `.specify/` beside its `specs/` |
| Same shape as review verifies and build takes | Yes |
| Hand-maintained lists | None |
| A project that does not commit `.specify/` | Has no spec folders |

### Option B: Do nothing

alq-plan's log holds no definition, and planning's idea of a spec folder can drift from the one review verifies.

### Option C: Any `specs/<x>/` folder, at any depth

What review did before alq-review's ADR-0012. Rejected there: any folder that happens to be named `specs/<x>/`
counts.

## Trade-offs

- Nothing in planning's steps checks that `.specify/` is committed (read in `select-spec`, not run). A run in a
  project whose `.specify/` is not committed writes a folder that review refuses at its Spec Kit mark step
  (spec 019, contracts/interfaces.md, refusal 4).
- A spec written anywhere but in Spec Kit's `specs/` is not a spec folder.

## Consequences

- Easier: planning, review and build use one shape for a spec folder, so a folder planning writes is one review
  accepts.
- Harder: a project has to commit `.specify/` before its spec folders pass review.
- **How we would know this was wrong:** a planning run completes and review refuses its folder at the Spec Kit mark
  step.
- Revisit if: Spec Kit changes how it marks a project.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
