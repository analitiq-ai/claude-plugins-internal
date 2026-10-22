---
schemaVersion: 0.2.0
id: "0008"
title: "Run the agent session in one environment under managed settings, with keys only hooks read"
status: draft
date: 2026-10-21
deciders: []
tags: [security, sandbox, managed-settings, environment, credentials, sessions, trust]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0006", "0007"]
affects:
  - type: path
    pattern: "reviewer/plugin/**"
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "orchestrator/**"
  - type: path
    pattern: "builder/plugin/**"
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

# ADR-0008: Run the agent session in one environment under managed settings, with keys only hooks read

## Context

The model's commands can read every credential on their machine: App keys (ADR-0007) and a human's
GitHub login. Claude Code's sandbox confines Bash at the OS level; hooks run outside it. Only managed
settings cannot be loosened from a session.

## Decision

1. We will run the orchestrator, builder and reviewer in one session per board, in one dedicated agent
   environment (any machine, VM or container) holding no human GitHub credential, under Claude Code's
   managed settings. Something outside codeworks starts the session; builder runs nowhere else, one story
   at a time.
2. We will run planner where its human works, outside those settings, accepting that its agent reads
   what the human can, under the human's oversight.
3. We will require the sandbox (fail if unavailable, nothing unsandboxed or excluded) and unix sockets
   blocked.
4. We will keep the App keys, DeepSource token and classifier key in `~/.config/codeworks/`, which only
   hooks read; the orchestrator and reviewer keys exist nowhere else.
5. We will deny the model that folder and any read of other credentials (gh, git, SSH, cloud, Claude
   Code's own), with `allowManagedReadPathsOnly`.
6. We will deny the model any write to plugin code and data, reviewer's state folder, `~/.claude`, the
   repo's `.claude/settings*.json`, `.claude/{workflows,agents,skills,commands,hooks}/`, `.mcp.json`,
   `.git/config` and `.git/hooks/`.
7. We will allow network only to GitHub and the repo's package registries, caches in the session's temp
   folder; load only listed MCP servers; and run no Docker in a session.
8. We will have hooks run git with `core.fsmonitor` and `core.hooksPath` off.
9. We will have every hook that reads a key, and reviewer for builder and review work, refuse while the
   managed settings are not in effect, naming what is missing. `SECURITY.md` holds the exact settings.

## Options considered

### Option A: One agent environment under managed settings (chosen)

No human credential to reach; the OS denies the read.

### Option B: Sessions on the human's machine

Rejected: one missed deny hands the model the human's login.

### Option C: An outside script launching a session per story

Rejected: a second key host, and a launch lock.

### Option D: Hooks refusing key reads, or keys in the OS keychain

Rejected: a command can be disguised; any same-user process can query the keychain.

## Trade-offs

- Every host a session reaches is listed in the managed file.
- A flaw in Claude Code's sandbox is a codeworks hole.
- Docker-based tests run only in CI: a session's Docker would hand the model the host.

## Consequences

- Easier: the model writes only as the session App.
- Harder: setup needs admin rights and, on Linux, bubblewrap and socat; native Windows has no sandbox.
- **How we would know this was wrong:** a sandboxed command or file tool reads a denied path, or a
  reviewer App state comment no hook posted.
- Revisit if: plugins can ship sandbox settings, or a tested protection stops holding.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
