---
schemaVersion: 0.2.0
id: "0009"
title: "Build core in TypeScript, and move a plugin's scripts to TypeScript when they first call core"
status: accepted
date: 2026-10-22
deciders: ["@Analitiq-Bot-Wonka"]
tags: [core, language, typescript, packaging, contracts, dependencies]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0003"]
affects:
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/scripts/**"
  - type: path
    pattern: "planner/plugin/scripts/**"
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/145"
  ratifiedBy: "@Analitiq-Bot-Wonka"
externalRefs:
  - type: doc
    url: "https://code.claude.com/docs/en/plugins/loading"
    label: "Claude Code: plugin loading and dependency install"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:47Z
---

# ADR-0009: Build core in TypeScript, and move a plugin's scripts to TypeScript when they first call core

## Context

`core/` (ADR-0001) is mostly GitHub calls, App tokens and the contracts several plugins share. Claude
Code installs a plugin's npm dependencies from its lockfile at install, and no Python dependency; its
mods and Workflow scripts are JavaScript. The plugins' scripts are Python today. Measured on one machine,
a hook process starts in about 47 ms on Node, 60 ms on Python, and 145 ms on Python importing pydantic,
PyYAML and PyJWT; a PreToolUse hook runs on every tool call.

## Decision

1. We will write `core/` in TypeScript on Node, its contracts as Zod schemas (ADR-0003).
2. We will have no Python code call core: a plugin's script moves to TypeScript in the change that first
   makes it call core, and not before.
3. We will keep core's dependencies few, each pinned exactly in the lockfile of every plugin that
   carries core (ADR-0001).
4. We will have a hook that runs core code refuse, naming the missing package, when core's
   dependencies are not installed.

## Options considered

### Option A: TypeScript core, scripts moved as they first call core (chosen)

Dependencies arrive with the plugin; no working script is rewritten before it gains anything.

### Option B: Python core, dependencies installed by a SessionStart hook

Rejected: an install step in every new environment, a slower hook start, and none of Claude Code's
JavaScript extension points.

### Option C: Python core on the standard library alone

Rejected: the standard library cannot sign an App's JWT.

### Option D: TypeScript core, every plugin rewritten at once

Rejected: it rewrites working code that gains nothing until it calls core.

## Trade-offs

- A plugin runs two languages until its last script that needs core has moved.
- Node must be on every machine that runs a plugin carrying core.
- A failed dependency install still loads the plugin; d4 makes that loud.

## Consequences

- Easier: contracts are checked when the code compiles; a new environment needs no first-run install.
- Harder: CI runs a Python and a TypeScript toolchain.
- **How we would know this was wrong:** Python code reaching core through a subprocess or a copy, or a
  hook running core with a dependency missing.
- Revisit if: Claude Code installs a plugin's Python dependencies.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
