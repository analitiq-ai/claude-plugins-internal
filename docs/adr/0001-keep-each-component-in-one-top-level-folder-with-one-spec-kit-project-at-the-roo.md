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
relatesTo: ["0002", "0003", "0005"]
affects:
  - type: path
    pattern: ".claude-plugin/marketplace.json"
  - type: path
    pattern: "core/**"
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
---

# ADR-0001: Keep each component in one top-level folder, with one Spec Kit project at the root

## Context

An install copies a plugin's whole folder, so tests, specs and records cannot sit inside it, and a plugin
may reference only paths inside its own root. The repo answered with two trees: `plugins/<name>/`
installed, `dev/<name>/` not, each `dev/` folder its own Spec Kit project. Each component lives in two
places, and the constitutions repeat the same principles. reviewer, planner and the orchestrator all use
the state comment and the validator modules.

## Decision

1. We will give each component one top-level folder, `planner/`, `builder/`, `reviewer/`, `auditor/`,
   `orchestrator/` and `core/`, holding `plugin/` (what an install copies), `tests/` and `docs/adr/`;
   `core/` holds a package in place of `plugin/`.
2. We will make `core/` the one home of code more than one component runs: the state-comment read and
   write, the validator modules with their Findings contract (ADR-0003), the spec facts' model (ADR-0003)
   and the parser of a story's identity (ADR-0005). Each plugin that runs core code, the orchestrator
   included, carries a symlink to `core/`, which an install copies into the plugin, and lists core's
   dependencies in its own lockfile, which the install also fetches; no plugin imports another's code.
   Every state-comment write runs in reviewer's hook process, outside the sandbox (ADR-0008).
3. We will keep one Spec Kit project at the root, with one constitution and specs in `specs/<p>-<slug>/`.
4. We will keep records of the repo as a whole in `docs/adr/` at the root.

## Options considered

### Option A: One folder per component, shared code in `core/`, copied into each plugin (chosen)

Ownership, CI and an import boundary are each one path rule per component.

### Option B: Keep `plugins/` and `dev/`

Rejected: each plugin stays split across two trees.

### Option C: A repository per component

Rejected: the components share contracts (the state comment, hold ids, status names, the validator
modules) that should change in one PR.

### Option D: Shared code inside one plugin, a hand-kept copy in each, or installed at session start

Rejected: a plugin cannot reference a path outside its root, a hand-kept copy drifts, and a session-start
install needs a release tag and a fetch of this repo from every environment.

## Trade-offs

- One constitution serves every component; a principle names the components it applies to.
- A change to `core/` reaches a plugin only in that plugin's next version.

## Consequences

- Easier: one Spec Kit to upgrade; a component's code, tests and records in one place; one implementation
  of the state comment and of each validator.
- Harder: an install's source is `<component>/plugin`, one level deeper than the usual `plugins/<name>`;
  each plugin that runs core code lists core's dependencies in its own lockfile.
- **How we would know this was wrong:** a component needing its own Spec Kit project or constitution, or
  code two components run that lives outside `core/`.
- Revisit if: Claude Code plugins gain a native way to share code between plugins.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
