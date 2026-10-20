---
schemaVersion: 0.2.0
id: "0008"
title: "Give an issue that needs no spec a spec folder that says so"
status: draft
date: 2026-10-19
deciders: []
tags: [premise, spec-folder, front-matter, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0006", "0009"]
affects:
  - type: path
    pattern: "plugins/alq-plan/scripts/no_spec.py"
  - type: path
    pattern: "plugins/alq-plan/speckit/presets/**"
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: issue
    id: "79"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
    label: "alq-plan: name spec folders by their issue, land the spec through its own reviewed PR"
  - type: issue
    id: "82"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/82"
    label: "alq-build: issue-tackle builds one user story; the spec=null form goes"
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "ALQ plugins target design: rewrite the decision records of alq-review, alq-plan and alq-build"
  - type: doc
    id: "org ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per issue, in the repo"
  - type: doc
    id: "alq-build ADR-0002"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-build/docs/adr/0002-have-the-build-skills-read-the-spec-from-the-spec-folder-they-are-given-never-fr.md"
    label: "alq-build ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment"
  - type: doc
    id: "alq-review ADR-0024"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0024-derive-the-spec-from-the-branch-at-launch-and-read-the-folder-as-data.md"
    label: "alq-review ADR-0024: Derive the spec from the branch at launch and read the folder as data"
---

# ADR-0008: Give an issue that needs no spec a spec folder that says so

## Context

Planning, build and the gate find an issue's spec by its folder (org ADR-0002). A `no spec needed` pick
leaving no folder is invisible to all three: the issue can be scoped again as if never judged.

The draft landed it through its own PR with `spec: null` at review; the design drops both (Option B), and
ADR-0009 moves the kind into front matter.

## Decision

1. We will have a `no spec needed` pick write `specs/<n>-<slug>/spec.md` saying so, with `alq.kind: no_spec` in its
   front matter, the premise question the pick rests on and the reason; the folder holds nothing else.
2. We will land it like any spec (ADR-0005), on `<n>-us1`. alq-build takes the issue body as the requirement
   (alq-build ADR-0002).

## Options considered

### Option A: A folder saying so in front matter, on the story branch (chosen)

Every reader keyed on the issue number sees it; no special value anywhere.

### Option B: A spec PR and `spec: null` at review

Rejected: no spec PR exists, and no user passes `spec: null`, since the launch derives the folder from the
branch (alq-review ADR-0024).

### Option C: No record, drop `no spec needed`, or a mark on the issue

Rejected: no record is the gap; dropping the pick was rejected by the user, since a change whose request fixes
the outcome has nothing for a spec to decide; a mark on the issue is read by nothing (ADR-0006).

## Trade-offs

- A folder with no requirements sits beside real specs, told apart by one front-matter key.
- `no spec needed` now pushes `<n>-us1` from planning, and the no-spec folder reaches main with the first story
  PR, like any spec (org ADR-0002).

## Consequences

- Easier: every issue planning saw and left open has one folder.
- Harder: a second `issue-spec #n` is a rescope at grill (ADR-0005), with nothing to grill.
- **How we would know this was wrong:** no-spec folders deleted by hand to scope the issue afresh; or a no-spec
  issue built against its folder as a spec.
- Revisit if: build or the gate need more from a no-spec folder than its kind.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
