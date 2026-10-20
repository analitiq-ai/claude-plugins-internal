---
schemaVersion: 0.2.0
id: "0009"
title: "Spec facts as front matter in spec.md; Spec Kit's stock tasks template"
status: draft
date: 2026-10-19
deciders: []
tags: [spec, front-matter, tasks, spec-kit, presets]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0004", "0005"]
affects:
  - type: path
    pattern: "plugins/alq-plan/speckit/presets/**"
  - type: path
    pattern: "plugins/alq-plan/scripts/{rootcause,settled_design}.py"
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    id: "org ADR-0003"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one PR per user story; only the last PR closes the issue"
  - type: doc
    id: "reviewer ADR-0024"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0024-derive-the-spec-from-the-branch-at-launch-and-read-the-folder-as-data.md"
    label: "reviewer ADR-0024: Derive the spec from the branch at launch and read the folder as data"
  - type: doc
    id: "builder ADR-0002"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-build/docs/adr/0002-have-the-build-skills-read-the-spec-from-the-spec-folder-they-are-given-never-fr.md"
    label: "builder ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment"
  - type: doc
    id: "reviewer ADR-0027"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0027-judge-the-root-cause-once-per-level-every-fix-names-its-mechanism.md"
    label: "reviewer ADR-0027: Judge the root cause once per level; every FIX names its mechanism"
---

# ADR-0009: Spec facts as front matter in spec.md; Spec Kit's stock tasks template

## Context

builder and reviewer read the spec folder planner writes. Today builder's root-cause-check reads the
`## Root cause` heading (builder ADR-0002 before its amendment). The brainstorm also gave planner a `[US<k>]` tag on every tasks.md line, though Spec Kit leaves Setup, Foundational and Polish untagged by design.

## Decision

1. We will have the settled-design preset prepend front matter to the spec template,
   `codeworks: {v: 1, kind: no_spec | feature | defect, root_cause: {observed: anchored | hypothesis | none}}`,
   filled by planner's checks at commit; builder, reviewer and the root-cause reviewer read these
   keys, never a heading.
2. We will keep Spec Kit's stock tasks template: story phases are tagged `[US<k>]`; Setup, Foundational
   and Polish are present and untagged. The planning check is that upstream rule, pinned to the
   installed template by a drift test.
3. We will commit `premise.md` in every spec folder except a no-spec one, whose spec.md carries the premise
   question and reason (ADR-0008), read by planner's root-cause check in a new spec and a rescope alike
   (ADR-0005), and customise Spec Kit's templates through presets and overrides only.

## Options considered

### Option A: Front matter as data, the stock template under a preset (chosen)

Readers survive a template edit; presets are the sanctioned path.

### Option B: `[US<k>]` on every task line and at least one task per story, planner's own check

The brainstorm's rule. Lost: untagged phases belong to no story by Spec Kit's design; the org maps
them (org ADR-0003).

### Option C: Readers parse headings such as `## Root cause`

Lost: a template change would change every verdict.

### Option D: A forked tasks template

Lost: not the sanctioned path.

## Trade-offs

- Changing a key is a change to three plugins, not to a template.
- An upstream template change fails the drift test until the pin moves.

## Consequences

- Easier: the no-spec folder (ADR-0008) and the root-cause dispatch (reviewer ADR-0027) each read one key.
- Harder: a spec.md without the block gives builder and reviewer nothing to read.
- **How we would know this was wrong:** the drift test fails on a Spec Kit release that left the phase
  rule intact.
- Revisit if: Spec Kit changes the phase rule, or ships front matter of its own for spec.md.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
