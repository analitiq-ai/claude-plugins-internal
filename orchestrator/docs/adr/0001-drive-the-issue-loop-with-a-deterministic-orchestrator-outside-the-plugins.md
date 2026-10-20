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
relatesTo: ["0002", "0003"]
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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner, builder and orchestrator"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/builder/docs/adr/0003-open-a-draft-pr-after-the-first-push-and-end-the-turn-at-an-attested-draft.md"
    label: "builder ADR-0003: Open a draft PR after the first push and end the turn at an attested draft"
---


# ADR-0001: Drive the issue loop with a deterministic orchestrator outside the plugins

## Context

Between a story's turns, something must watch GitHub and decide the next move; builder cannot wait
for CI.

## Decision

1. We will drive one story issue from Ready to merge with a deterministic script, running as the org's
   existing GitHub App (no new App), host unspecified; it claims the story issue and launches
   `builder:issue-tackle <s>`. Its code lives in this repo under `orchestrator/` and releases and deploys
   on its own.
2. We will give it only these inputs: the board and its issues (assignee, parent, sub-issues,
   `blockedBy`); open PRs; issue comments, reviewer's tagged state comments among them (reviewer
   ADR-0011); the effective rules for each PR's base branch, from the one rules endpoint, rulesets
   being the only source of required checks; its own section and `[shared]` of `codeworks.toml`
   (root ADR-0002); its host state (ADR-0003). It parses no prose and runs an LLM only by launching one.
3. We will have it import no plugin code, only `core/` (root ADR-0001): the state-comment read and the
   validator modules with their Findings contract (root ADR-0003), installed as a package pinned to the
   orchestrator's release, the way each plugin installs it.
4. We will have the plugins poll nothing: builder ends its turn at an attested draft or a pre-PR stop
   (builder ADR-0003); planner at the draft spec PR it opens (planner ADR-0010).
5. We will run one session per story issue, under a process lock per (repo, issue) that dies with its
   process. REPEAT bounds the relaunch: a launch that had work (an unattested head or findings) and
   ended with both unchanged moves the card to Blocked.

## Options considered

### Option A: A deterministic script under the existing App (chosen)

Restartable, idempotent ticks.

### Option B: A cron prompt driving the loop

Rejected: not deterministic, not restartable, parses comments.

### Option C: builder drives its own loop

Rejected: it cannot wait for CI; its lane writes cannot be told from a human's.

### Option D: A repository of its own

Rejected: it shares `core/` and the status names with the plugins, which release from this repo.

### Option E: Import the shared code from a plugin's folder

Rejected: a plugin's internals would become the orchestrator's contract.

## Trade-offs

- A move waits for the next tick.

## Consequences

- Easier: a safe restart; no orchestrator credential in any session.
- Harder: diagnosis spans GitHub and the launch log; a CI check keeps `orchestrator/` importing nothing
  from the plugins.
- **How we would know this was wrong:** a human moving a card for the orchestrator; two sessions on one
  story issue.
- Revisit if: a plugin can wait for CI; the loop needs a second host.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
