---
schemaVersion: 0.2.0
id: "0008"
title: "Run the agent session on one agent machine under managed settings, with keys only hooks read"
status: draft
date: 2026-10-21
deciders: []
tags: [security, sandbox, managed-settings, agent-machine, credentials, sessions, trust]
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

# ADR-0008: Run the agent session on one agent machine under managed settings, with keys only hooks read

## Context

The model's commands can read every credential on their machine: App keys (ADR-0007), an admin's
GitHub login. Claude Code's sandbox confines Bash at OS level, not hooks, WebFetch or WebSearch. A
repo's settings can add unsandboxed hooks and environment. Only managed settings cannot be loosened
from a session.

## Decision

1. We will run the orchestrator, builder and reviewer in one session at a time per board, on one
   dedicated agent machine, separate from the machine where the admin and planner work. It runs on its
   own OS, with no VM, container or separate OS user, holds no admin GitHub credential, and runs under
   managed settings. An admin starts each session there and names the one issue it tackles with
   `/codeworks <issue>` (orchestrator ADR-0001); nothing picks an issue on its own. builder runs nowhere
   else.
2. We will run planner where its admin works, outside those settings, under admin supervision, with no
   other codeworks plugin there; its agent acts on GitHub only as the planner App (ADR-0007), never with
   an admin's credentials.
3. We will require the sandbox (fail if unavailable, nothing unsandboxed or excluded) and unix sockets
   blocked.
4. We will keep the session, orchestrator and reviewer App keys, the validator modules' tokens and the
   classifier key in `~/.config/codeworks/` on the agent machine, which only hooks read; the planner
   App's key sits only where planner runs.
5. We will deny the model that folder and any read of other credentials (gh, git, SSH, cloud, Claude
   Code's own), with `allowManagedReadPathsOnly`.
6. We will deny the model any write to plugin code and data, reviewer's state folder, `~/.claude`, the
   repo's `.claude/settings*.json`, `.claude/{workflows,agents,skills,commands,hooks}/`, `.mcp.json` and
   `.git/{config,hooks}`.
7. We will allow sandboxed commands network only to GitHub and the repo's package registries, caches in
   the session's temp folder; keep WebFetch and WebSearch; load only listed MCP servers.
8. We will run only the codeworks plugins' hooks, load no user, project or local settings file, and
   have hooks run git with no global or system config, no credential helper, and `core.fsmonitor` and
   `core.hooksPath` off.
9. We will have every key-reading hook, and reviewer for builder and review work, refuse unless
   managed settings are in effect (`SECURITY.md`); reading the planner App's key where planner runs is
   exempt (d2). The managed settings file is their one source: any other source of managed
   settings makes them refuse.

## Options considered

### Option A: One agent machine under managed settings (chosen)

No admin credential to reach; the OS denies the read.

### Option B: Sessions on the admin's machine

Rejected: one missed deny hands the model the admin's login.

### Option C: An outside script launching a session per story

Rejected: a second key host, and a launch lock. The user also dropped a program that runs between
sessions on 2026-10-25.

### Option D: Hooks refusing key reads, or keys in the OS keychain

Rejected: a command can be disguised; any same-user process reads the keychain.

### Option E: A VM, container or separate OS user on the agent machine

Rejected by the user on 2026-10-24: the agent machine runs on its own OS.

### Option F: Managed settings from several sources merged

Rejected by the user on 2026-10-26: managed settings are recorded in one place.

## Trade-offs

- An injected prompt can make WebFetch send what the model reads, the session token included,
  anywhere; the token is read-only.
- A sandbox flaw is a codeworks hole.
- No session runs until an admin starts one.
- Where Claude Code signs in with a Team or Enterprise claude.ai account, settings an admin adds on
  claude.ai apply mid-session; the next start refuses.

## Consequences

- Easier: the model reads GitHub only as the session App and writes nothing there.
- Harder: setup needs admin rights and, on Linux, bubblewrap and socat.
- **How we would know this was wrong:** a sandboxed command or file tool reads a denied path, or a
  reviewer App state comment no hook posted.
- Revisit if: plugins ship sandbox settings, or a tested protection fails.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
