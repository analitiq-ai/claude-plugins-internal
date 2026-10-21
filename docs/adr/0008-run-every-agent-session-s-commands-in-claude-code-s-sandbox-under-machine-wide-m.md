---
schemaVersion: 0.2.0
id: "0008"
title: "Run every agent session's commands in Claude Code's sandbox under machine-wide managed settings"
status: draft
date: 2026-10-21
deciders: []
tags: [security, sandbox, credentials, sessions, trust]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0007"]
affects:
  - type: path
    pattern: "reviewer/plugin/**"
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/145"
externalRefs:
  - type: doc
    url: "https://code.claude.com/docs/en/sandboxing"
    label: "Claude Code: sandboxing"
review:
  tier: async
---

# ADR-0008: Run every agent session's commands in Claude Code's sandbox under machine-wide managed settings

## Context

A session's commands run as its human's OS user, so they can read every key on the machine: the session
App's (ADR-0007), the reviewer App's (reviewer ADR-0011), the orchestrator's App's (orchestrator
ADR-0001), and the human's GitHub credentials. With the
orchestrator's key a session can write `internal-review` and `codex-review` and merge; with the human's
it acts as a bypass actor. The orchestrator runs on its human's own machine, so a separate OS user for it
is no answer. Claude Code's sandbox confines Bash and every process it starts at the OS level; hooks run
outside it. Only managed settings cannot be loosened from a session, and a plugin cannot ship sandbox
settings.

## Decision

1. We will run every agent session's commands in Claude Code's sandbox, set by a managed settings file
   installed once per machine: the sandbox required, no unsandboxed retry and no excluded command.
2. We will deny sandboxed commands and Claude's file tools any read or write of the codeworks keys, any
   read of the human's GitHub credentials (gh's config, git's credential store, SSH keys), and any write
   to the installed plugins, their data and reviewer's state directory.
3. We will have only hooks read a key: reviewer's hook mints the session's token (ADR-0007) and posts
   reviewer's state as the reviewer App (reviewer ADR-0011).
4. We will have reviewer refuse every tool call of a session whose machine lacks that file or any setting
   above, naming what is missing.

## Options considered

### Option A: Claude Code's sandbox under managed settings (chosen)

The OS denies the read, whatever command asks.

### Option B: The orchestrator as its own OS user

Rejected: an OS user per machine, and the session and human keys stay readable.

### Option C: Hooks refusing commands that read a key

Rejected: a hook matches command text, which a session can disguise.

### Option D: Keys in the OS keychain

Rejected: any process of the same user can query it.

## Trade-offs

- Every network host a session reaches is allowed in the managed file.
- A flaw in Claude Code's sandbox is a codeworks hole.

## Consequences

- Easier: no session holds a key, so none writes as the reviewer App, the orchestrator's App or its human.
- Harder: setup needs admin rights once per machine and, on Linux, bubblewrap and socat; native Windows
  has no sandbox, so sessions there are refused.
- **How we would know this was wrong:** a sandboxed command reads a denied path, or a state comment by the
  reviewer App that no hook posted.
- Revisit if: plugins can ship sandbox settings, or review rounds move out of the session.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
