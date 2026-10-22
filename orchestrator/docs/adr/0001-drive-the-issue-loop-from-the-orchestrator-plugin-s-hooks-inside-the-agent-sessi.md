---
schemaVersion: 0.2.0
id: "0001"
title: "Drive the issue loop from the orchestrator plugin's hooks inside the agent session"
status: draft
date: 2026-10-20
deciders: []
tags: [orchestrator, issue-loop, automation, plugins, github-app, hooks]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0002", "0003", "0009"]
affects:
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---


# ADR-0001: Drive the issue loop from the orchestrator plugin's hooks inside the agent session

## Context

Between a story's turns, code, not the model, must make the next move from GitHub's state.

## Decision

1. We will make the orchestrator a plugin, importing only `core/` (root ADR-0001), whose hooks act as
   its own GitHub App, `codeworks-orchestrator` (contents, pull requests, issues and statuses write;
   checks read; organization projects write), its key read only by hooks (root ADR-0008). "The
   orchestrator" in these records means these hooks.
2. We will give it only these inputs: the board and its issues (assignee, parent, sub-issues,
   `blockedBy`, closer); open PRs, their changed files, review threads, mergeable field, statuses and
   checks at the head; issue comments with author, edit and time, reviewer's state comments (reviewer
   ADR-0011) among them; an exempt label's labeled event, its sender, that sender's permission and the
   head's push time (ADR-0005); the effective rules for each PR's base branch (ADR-0009); its own section
   and `[shared]` of `codeworks.toml` (root ADR-0002); its hook's event. It parses no prose except
   through `core/`'s modules (root ADR-0003) and runs no LLM.
3. We will drive the loop from two hooks: SessionStart mints the session's token (root ADR-0007),
   claims the next Ready story, one at a time (root ADR-0008), and names `builder:issue-tackle <s>`;
   Stop refuses the stop with the next step until none is left. It ignores a Stop while a workflow runs
   and takes no task notification as a prompt. A hook that crashes or times out attests, flips and
   merges nothing. How it waits on CI and the external reviewers is its spec's to settle.
4. We will have builder and planner poll nothing: each ends its turn at its draft PR or a stop before
   one (builder ADR-0003, planner ADR-0010).
5. We will move a story's card to Blocked, naming the bound, on REPEAT (a turn that had work, an
   unattested head or findings, ended with both unchanged and still needing work) or on two turns in a
   row from a working lane each ending with an unattested head. A human's Ready resets the count.

## Options considered

### Option A: The orchestrator plugin's hooks (chosen)

### Option B: A cron prompt

Rejected: not deterministic.

### Option C: builder's model drives the loop

Rejected: the model would make the moves its review grades.

### Option D: A script on its own host

Rejected: a second host and a launch lock.

### Option E: The org's existing App

Rejected: its other users would pass the trust filters.

## Trade-offs

- A move waits for the session's next hook run.

## Consequences

- Easier: no launcher, host or lock; the model holds no privileged key.
- Harder: diagnosis spans GitHub and the session transcript; a CI check keeps `orchestrator/` importing
  no other plugin.
- **How we would know this was wrong:** a human moving a card for the orchestrator.
- Revisit if: the hook loop fails its tests, or a board needs a second session.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
