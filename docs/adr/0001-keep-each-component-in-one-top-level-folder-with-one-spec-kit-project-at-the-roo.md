---
schemaVersion: 0.2.0
id: "0001"
title: "Keep each component in one top-level folder, with one Spec Kit project at the root"
status: draft
date: 2026-10-20
deciders: []
tags: [layout, repository, spec-kit, plugins]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: ".claude-plugin/marketplace.json"
  - type: path
    pattern: ".specify/**"
  - type: path
    pattern: ".github/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design"
---

# ADR-0001: Keep each component in one top-level folder, with one Spec Kit project at the root

## Context

An install copies a plugin's whole folder, so tests, specs and records cannot sit inside it. The repo
answered with two trees: `plugins/<name>/` installed, `dev/<name>/` not, each `dev/` folder its own Spec
Kit project with its own constitution. Each component then lives in two places, Spec Kit is installed
once per plugin, and the constitutions repeat the same principles. The orchestrator is never installed,
so it fits neither tree; the renaming to the Codeworks names moves every path anyway.

## Decision

1. We will give each component one top-level folder: `plugin/` (what an install copies), `tests/`,
   `docs/adr/`. The orchestrator's folder has no `plugin/`.
2. We will keep one Spec Kit project at the root, with one constitution and specs in `specs/<n>-<slug>/`.
3. We will keep records of the repo as a whole in `docs/adr/` at the root.

## Options considered

### Option A: One folder per component, one Spec Kit project (chosen)

Ownership, CI and an import boundary are each one path rule per component.

### Option B: Keep `plugins/` and `dev/`, add `orchestrator/`

Rejected: each plugin stays split across two trees, and the orchestrator is a third shape.

### Option C: A repository per component

Rejected: reviewer and the orchestrator share a contract (the PR body section, hold ids, status names)
that should change in one PR.

### Option D: A shared code folder for the plugins

Rejected: an install copies only the plugin's folder, so shared code needs a build step to vendor it.

## Trade-offs

- One constitution serves every component; a principle names the components it applies to.
- The move breaks links to `main` by path; they are rewritten in the same change.

## Consequences

- Easier: one Spec Kit to upgrade; a component's code, tests and records in one place.
- Harder: an install's source is `<component>/plugin`, one level deeper than the usual `plugins/<name>`.
- **How we would know this was wrong:** a component needing its own Spec Kit project or constitution.
- Revisit if: plugins need code shared at runtime.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
