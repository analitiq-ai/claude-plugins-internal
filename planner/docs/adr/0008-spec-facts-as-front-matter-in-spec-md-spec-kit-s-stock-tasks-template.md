---
schemaVersion: 0.2.0
id: "0008"
title: "Spec facts as front matter in spec.md; Spec Kit's stock tasks template"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, front-matter, tasks, spec-kit, presets]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0007", "0010"]
affects:
  - type: path
    pattern: "planner/plugin/speckit/presets/**"
  - type: path
    pattern: "planner/plugin/scripts/{rootcause,settled_design}.py"
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0008: Spec facts as front matter in spec.md; Spec Kit's stock tasks template

## Context

builder and reviewer read the spec folder planner writes. A reader that parses a heading such as
`## Root cause` changes its verdict when a template changes. Spec Kit tags story phases in tasks.md `[US<k>]`
and leaves Setup, Foundational and Polish untagged by design, yet every task belongs to one story issue
(ADR-0010), and a story branch may tick only its own story's tasks (reviewer ADR-0010).

## Decision

1. We will have the settled-design preset prepend front matter to the spec template,
   `codeworks: {v: 1, kind: no_spec | feature | defect, root_cause: {observed: anchored | hypothesis | none}}`,
   filled by planner's checks at commit; builder, reviewer and the root-cause reviewer read these
   keys through core's model (root ADR-0003), never a heading.
2. We will keep Spec Kit's stock tasks template, customised only through presets and overrides: story
   phases are tagged `[US<k>]`; Setup, Foundational and Polish are present and untagged. When planner
   creates the story issues (ADR-0010), it labels each task block in tasks.md with its story issue's
   number: a story's phase with its own, Setup and Foundational with the first story's, Polish with the
   last's.

## Options considered

### Option A: Front matter as data, the stock template under a preset (chosen)

Readers survive a template edit; presets are the sanctioned path.

### Option B: `[US<k>]` on every task line and at least one task per story, planner's own check

Rejected: untagged phases belong to no story by Spec Kit's design; planner assigns them to a story issue
when it plans (Decision 2).

### Option C: Readers parse headings such as `## Root cause`

Rejected: a template change would change every verdict.

### Option D: A forked tasks template

Rejected: not the sanctioned path.

### Option E: Map the untagged phases to a story at runtime

Rejected: a script would derive at every launch what planner knows when it plans.

## Trade-offs

- Changing a key is a change to three plugins, not to a template.
- An upstream change to Spec Kit's phase rule is a change to how planner labels task blocks.

## Consequences

- Easier: the no-spec folder (ADR-0007) and the root-cause dispatch (reviewer ADR-0017) each read one key;
  reviewer finds a session's ticks by its issue number on the block.
- Harder: a spec.md without the block gives builder and reviewer nothing to read.
- **How we would know this was wrong:** a task block labelled with the wrong story's issue, or a reader
  that still parses a heading.
- Revisit if: Spec Kit changes the phase rule, or ships front matter of its own for spec.md.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
