---
schemaVersion: 0.2.0
id: "0007"
title: "Give an issue that needs no spec a spec folder that says so"
status: draft
date: 2026-10-20
deciders: []
tags: [premise, spec-folder, front-matter, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0006", "0008"]
affects:
  - type: path
    pattern: "planner/plugin/scripts/no_spec.py"
  - type: path
    pattern: "planner/plugin/speckit/presets/**"
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: doc
    id: "org ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
---

# ADR-0007: Give an issue that needs no spec a spec folder that says so

## Context

Planning, build and reviewer find an issue's spec by its folder (org ADR-0002, root ADR-0005). A `no spec
needed` pick leaving no folder is invisible to all three: the issue can be scoped again as if never judged.
builder and reviewer take such a story's issue body as its requirement (root ADR-0005).

ADR-0008 puts the kind into front matter.

## Decision

1. We will have a `no spec needed` pick write `specs/<p>-<slug>/spec.md` saying so, with
   `codeworks.kind: no_spec` in its front matter, the premise question the pick rests on and the reason;
   the folder holds nothing else.

## Options considered

### Option A: A folder saying so in front matter (chosen)

Every reader keyed on the issue number sees it; no special value anywhere.

### Option B: No folder, and `spec: null` passed at review

Rejected: no user passes `spec: null`, since every launch derives the folder from the spec's issue (root
ADR-0005).

### Option C: No record, drop `no spec needed`, or a mark on the issue

Rejected: no record is the gap; dropping the pick was rejected by the user, since a change whose request fixes
the outcome has nothing for a spec to decide; a mark on the issue is read by nothing (ADR-0006).

## Trade-offs

- A folder with no requirements sits beside real specs, told apart by one front-matter key.
- A `no spec needed` pick still costs a spec PR a human merges before the story launches (org ADR-0002).

## Consequences

- Easier: every issue planning saw and left open has one folder.
- Harder: a second `issue-spec #p` is a rescope at grill (ADR-0005), with nothing to grill.
- **How we would know this was wrong:** no-spec folders deleted by hand to scope the issue afresh; or a no-spec
  issue built against its folder as a spec.
- Revisit if: build or reviewer need more from a no-spec folder than its kind.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
