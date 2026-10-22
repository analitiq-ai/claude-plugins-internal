---
schemaVersion: 0.2.0
id: "0002"
title: "Keep every component's settings in one TOML file, one section per component"
status: draft
date: 2026-10-20
deciders: []
tags: [config, toml, settings, repository]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0003"]
affects:
  - type: path
    pattern: "reviewer/plugin/config.json"
  - type: path
    pattern: "reviewer/plugin/scripts/{config,hookio,gate}.py"
  - type: path
    pattern: "orchestrator/**"
  - type: path
    pattern: "builder/plugin/**"
  - type: path
    pattern: "planner/plugin/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0002: Keep every component's settings in one TOML file, one section per component

## Context

reviewer keeps its settings in a `config.json` inside its plugin and reads its modes from environment
variables too, which whoever starts a session sets, the session included. The orchestrator has a file of
its own. A setting can sit in one component's file while another component decides what it governs. The
validator modules (ADR-0003) need settings that both the orchestrator and reviewer read. The orchestrator
works across branches and PRs of a repo, some from forks.

## Decision

1. We will keep every component's settings in one TOML file, `codeworks.toml` at the target repo's root: a
   `[shared]` section and one section per component, `[orchestrator]`, `[reviewer]`, `[builder]`, and
   `[planner]` when it has settings. No session writes it (reviewer ADR-0012), and no PR changing it is
   attested but by a human's label (orchestrator ADR-0004).
2. We will put each key in exactly one section; a key two components read goes in `[shared]`. Each
   component reads only its own section and `[shared]`, validates its own section, and refuses an unknown
   key.
3. We will let no environment variable set or override any key.
4. We will have each component read the file from the branch it works on. The orchestrator reads it from a
   PR's head for that PR's work, from the default branch for work with no PR, and from the base branch for
   a fork PR, whose head nobody trusted wrote (orchestrator ADR-0004).

## Options considered

### Option A: One file, one section per component, read from the branch worked on (chosen)

A human reads what runs in one place; every key has one owner.

### Option B: A file per component

Rejected: a key two components read lives in two files, or one component reads another's file.

### Option C: Environment variables over the file

Rejected: whoever starts a session sets them, so the reviewed file does not say what runs.

### Option D: Always read the file from the default branch

Rejected: a second read path guarding a file sessions already cannot write.

## Trade-offs

- A branch's copy of the file is what runs on that branch; a human edit to it takes effect there before
  it merges.
- A misspelled key stops the component that owns its section instead of being ignored.

## Consequences

- Easier: no component reads a config file inside a plugin; a setting cannot be changed from inside a
  session.
- Harder: each component validates a schema for its own section.
- **How we would know this was wrong:** one key wanted in two sections, or a setting changed by a session.
- Revisit if: a component ships to repos without the others.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
