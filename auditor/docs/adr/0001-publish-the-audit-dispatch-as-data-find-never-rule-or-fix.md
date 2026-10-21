---
schemaVersion: 0.2.0
id: "0001"
title: "Publish the audit dispatch as data; find, never rule or fix"
status: draft
date: 2026-10-20
deciders: []
tags: [audit, dispatch, findings, reviewer]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "auditor/plugin/agents/**"
  - type: path
    pattern: "auditor/plugin/skills/{pr-audit,codebase-audit}/SKILL.md"
  - type: path
    pattern: "auditor/plugin/reference/dispatch.json"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0001: Publish the audit dispatch as data; find, never rule or fix

## Context

auditor's seven agents (`history-shape`, `mechanism-depth`, `failure-evasion`, `duplication`,
`code-shape`, `boundary-trust`, `semantic-parity`) run from its `pr-audit` and `codebase-audit` skills,
whose Dispatch steps name, in prose, which agents run and in what order. reviewer's audit stage runs the
same agents inside its rounds and needs that list too.

## Decision

1. We will have auditor's agents find anti-patterns and report findings only. They never rule on a
   finding and never change code: reviewer rules, and the session fixes.
2. We will publish the dispatch, which agents run in which order for a PR audit and for a codebase audit,
   as data in `auditor/plugin/reference/dispatch.json`. Both skills dispatch from it, and reviewer reads it
   at a round's launch (reviewer ADR-0019 d4).

## Options considered

### Option A: Agents that only find; the dispatch as data (chosen)

### Option B: Agents that also rule on or fix their findings

Rejected: the finder would grade its own finding, and change code no ruling asked for.

### Option C: The dispatch in the skills' prose, copied by reviewer

Rejected: the copy drifts from the skills.

## Trade-offs

- A change to the dispatch is a change to auditor's published interface, and reaches reviewer only at the
  version reviewer pins.

## Consequences

- Easier: one list of which agents run, read by both skills and by reviewer.
- Harder: the skills' Dispatch steps read a file in place of prose.
- **How we would know this was wrong:** an agent list for an audit held anywhere but the dispatch file, or
  an auditor agent that rules on or edits what it found.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
