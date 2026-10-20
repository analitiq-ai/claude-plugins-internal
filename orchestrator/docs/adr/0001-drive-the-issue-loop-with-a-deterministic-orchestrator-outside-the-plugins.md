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

Between the turns of one issue, something must watch GitHub and decide the next move. Until now that
was the cron prompt and the bot-picker skill, with builder polling for its own loop; the prompt is
neither deterministic nor restartable, and builder cannot wait for CI.

## Decision

1. We will drive one issue from Ready to merge with a deterministic script outside the plugins, its own
   GitHub App, host unspecified; it claims the issue and launches `builder:issue-tackle <n>`. Its code
   lives in this repo under `orchestrator/`, beside the plugins, imports none of their code, and
   releases and deploys on its own.
2. We will give it only the board, open PRs, issue comments and its own state (ADR-0003); it parses no
   prose, runs no plugin code, reads no plugin config, and runs an LLM only by launching one.
3. We will have the plugins poll nothing: builder ends its turn at an attested draft or a pre-PR stop
   (builder ADR-0003), planner at a push.
4. We will run one session per issue, under a process lock per (repo, issue) that dies with its
   process. REPEAT bounds the relaunch: a launch that had work (an unattested head or findings) and
   ended with the head and findings unchanged moves the card to Blocked.

## Options considered

### Option A: A deterministic script, its own App (chosen)

Restartable, idempotent ticks.

### Option B: The cron prompt and the bot-picker skill

An LLM driving the loop. Rejected: not deterministic, not restartable, parses comments.

### Option C: builder drives its own loop

Rejected: it cannot wait for CI; its lane writes cannot be told from a human's.

### Option D: Run plugin code on a shared host

Rejected: it binds the orchestrator to the plugins' code and to a host shared with the sessions.

### Option E: The orchestrator relaunches builder to run the merge

Rejected: the orchestrator merges itself.

### Option F: A repository of its own

Rejected: the PR body block, the hold ids and the status names are a contract with reviewer; in one
repo both sides change in one PR.

## Trade-offs

- A script to host; every repo it serves installs its App.
- A move waits for the next tick: the orchestrator polls.

## Consequences

- Easier: a safe restart; one session per issue; no orchestrator credential in any session.
- Harder: diagnosis spans GitHub and the host's launch log; a CI check must keep `orchestrator/` from
  importing plugin code.
- **How we would know this was wrong:** a human moving a card for the orchestrator; two sessions on one
  issue.
- Revisit if: a plugin can wait for CI, or the loop needs more than one host.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
