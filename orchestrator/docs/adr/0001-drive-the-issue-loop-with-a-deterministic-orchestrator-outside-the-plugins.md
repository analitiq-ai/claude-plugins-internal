---
schemaVersion: 0.2.0
id: "0001"
title: "Drive the issue loop with a deterministic orchestrator outside the plugins"
status: draft
date: 2026-10-20
deciders: []
tags: [orchestrator, issue-loop, automation, plugins, github-app]
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


# ADR-0001: Drive the issue loop with a deterministic orchestrator outside the plugins

## Context

Between a story's turns, something must watch GitHub and decide the next move; builder cannot wait
for CI.

## Decision

1. We will drive one story issue from Ready to merge with a deterministic script, acting as its own GitHub
   App, `codeworks-orchestrator` (contents, pull requests, issues and statuses write; checks read;
   organization projects write), whose key only its host holds and no session reads (root ADR-0008); it
   claims the story issue, mints the session's token (root ADR-0007) and launches `builder:issue-tackle
   <s>`. Its code lives under `orchestrator/` and ships on its own.
2. We will give it only these inputs: the board and its issues (assignee, parent, sub-issues,
   `blockedBy`, closer); open PRs, their changed files, review threads, mergeable field, statuses and
   checks at the head; issue comments with author, edit and time, reviewer's state comments (reviewer
   ADR-0011) among them; an exempt label's labeled event, its sender, that user's permission and the
   head's push time (ADR-0005); the effective rules for each PR's base branch (ADR-0009); its own section
   and `[shared]` of `codeworks.toml` (root ADR-0002); its host state and the launch lock (ADR-0003). It
   parses no prose except through `core/`'s modules (root ADR-0003), and runs an LLM only by launching
   one.
3. We will have it import no plugin code, only `core/`, as each plugin does (root ADR-0001).
4. We will have the plugins poll nothing: builder ends its turn at an attested draft or a pre-PR stop
   (builder ADR-0003); planner at the draft spec PR it opens (planner ADR-0010).
5. We will run one session per story issue, under the launch lock (ADR-0003), and bound relaunches
   twice, each moving the card to Blocked naming its bound: REPEAT, a launch that had work (an
   unattested head or findings), ended with both unchanged, and whose exit state still needs work; and
   two launches in a row from a working lane that each end with an unattested head. A human's Ready
   resets the count.

## Options considered

### Option A: A deterministic script under its own App (chosen)

Restartable, idempotent ticks.

### Option B: A cron prompt driving the loop

Rejected: not deterministic or restartable; parses comments.

### Option C: builder drives its own loop

Rejected: it cannot wait for CI.

### Option D: A repository of its own

Rejected: it shares `core/` and the status names with the plugins, which release from this repo.

### Option E: The org's existing App

Rejected: anything else acting as it would pass the orchestrator's trust filters.

## Trade-offs

- A move waits for the next tick.

## Consequences

- Easier: a safe restart; no orchestrator key in any session.
- Harder: diagnosis spans GitHub and the launch log; a CI check keeps `orchestrator/` importing nothing
  from the plugins.
- **How we would know this was wrong:** a human moving a card for the orchestrator; two sessions on one
  story issue.
- Revisit if: a plugin can wait for CI; the loop needs a second host.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
