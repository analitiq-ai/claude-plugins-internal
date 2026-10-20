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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0001-drive-the-issue-loop-with-a-deterministic-orchestrator-outside-the-plugins.md"
    label: "orchestrator ADR-0001: Drive the issue loop with a deterministic orchestrator outside the plugins"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0005-exempt-a-pr-from-the-internal-review-by-its-bot-author-or-a-label-a-writer-appli.md"
    label: "orchestrator ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0006-ship-every-check-enforcing-from-its-first-release.md"
    label: "reviewer ADR-0006: Ship every check enforcing from its first release"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0012-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md"
    label: "reviewer ADR-0012: Refuse from any agent session every GitHub write the orchestrator or a human owns"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0019-run-every-reviewer-and-the-assessment-inside-one-review-round-workflow.md"
    label: "reviewer ADR-0019: Run every reviewer and the assessment inside one review-round workflow"
---

# ADR-0002: Keep every component's settings in one TOML file, one section per component

## Context

reviewer keeps its settings in a `config.json` inside its plugin, and reads its modes from environment
variables too (`REVIEWER_MODE`, `REVIEWER_CLAIM_CHECKS`, `REVIEWER_SHIM_CHECKS`, `REVIEWER_DECISION_CHECKS`),
which whoever launches a session sets, the session included. The orchestrator has a file of its own. One
setting, `exempt_labels`, sits in reviewer's file while only the orchestrator decides what it governs. The
validator modules (ADR-0003) need settings that both the orchestrator and reviewer read.

## Decision

1. We will keep every component's settings in one TOML file, `codeworks.toml` at the target repo's root: a
   `[shared]` section and one section per component, `[orchestrator]`, `[reviewer]`, `[builder]`, and
   `[planner]` when it has settings.
2. We will put each key in exactly one section; a key two components read goes in `[shared]`. Each
   component reads only its own section and `[shared]`, validates its own section, and refuses an unknown
   key.
3. We will place `exempt_labels` in `[orchestrator]` (orchestrator ADR-0005); the github round cap in
   `[reviewer]`, default 4 (reviewer ADR-0019); reviewer's modes in `[reviewer]`, with no environment
   override (reviewer ADR-0006); the enabled validator modules and their timeouts in `[shared]`, read by
   `core/` (ADR-0003).
4. We will have reviewer refuse every session write to the file (reviewer ADR-0012). Each component reads
   the file in the checkout it runs from.

## Options considered

### Option A: One file, one section per component (chosen)

A human reads what runs in one place; every key has one owner.

### Option B: A file per component

Rejected: a key two components read lives in two files, or one component reads another's file.

### Option C: Environment variables over the file

Rejected: whoever launches a session sets them, so the reviewed file does not say what runs.

### Option D: Read the file from the default branch

Rejected: a second read path guarding a file sessions already cannot write.

## Trade-offs

- A branch's copy of the file is what runs on that branch; a human edit to it takes effect before it
  merges.
- A misspelled key stops the component that owns its section instead of being ignored.

## Consequences

- Easier: the orchestrator reads no plugin config; a mode cannot be changed from inside a session.
- Harder: each component validates a schema for its own section.
- **How we would know this was wrong:** one key wanted in two sections, or a setting changed by a session.
- Revisit if: a component ships to repos without the others.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
