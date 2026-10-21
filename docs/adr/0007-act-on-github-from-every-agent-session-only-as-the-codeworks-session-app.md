---
schemaVersion: 0.2.0
id: "0007"
title: "Act on GitHub from every agent session only as the codeworks-session App"
status: draft
date: 2026-10-20
deciders: []
tags: [security, identity, github-app, credentials, sessions, trust]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0003"]
affects:
  - type: path
    pattern: "orchestrator/**"
  - type: path
    pattern: "core/**"
  - type: path
    pattern: "reviewer/plugin/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
---

# ADR-0007: Act on GitHub from every agent session only as the codeworks-session App

## Context

Agent sessions push branches, open PRs and post reviewer's state. reviewer's hook runs in the session's
process with its credential, so it cannot stop a direct API call. A session acting as an org-admin user on
the ruleset bypass list can merge past the ruleset, rewrite rulesets and workflows, move lanes and write
statuses. Every trust predicate (EXEMPT, WRITER, TRUSTED, the state comment's author) must also tell a
session's write from a human's and from the orchestrator's.

## Decision

1. We will have every agent session, launched or interactive, act on GitHub only with a one-hour,
   one-repo installation token of a dedicated GitHub App, `codeworks-session`: contents, pull requests
   and issues write; metadata, checks, statuses and actions read; organization projects read. It has no
   administration, workflows, secrets or environments permission, and no statuses, checks or projects
   write.
2. We will have the orchestrator mint that token for each launch and hand it to that session alone;
   an interactive session mints its own through `core/`.
3. We will put the session App on no ruleset bypass list (orchestrator ADR-0009) and count it as no
   human, WRITER, TRUSTED or EXEMPT actor in any component's predicate.
4. We will accept that a session can post a forged reviewer-state comment through the API with its
   token, past reviewer's hook. The orchestrator reads the newest state comment by the session App
   (reviewer ADR-0011), so a forged snapshot can record a CLEAN round. Running rounds outside the
   session would close this; we do not adopt it. Nor do we guard an interactive session from the
   credentials its human's OS account holds.

## Options considered

### Option A: A dedicated App, a least-privilege token per launch (chosen)

The permission set removes the capability; a write's actor names the session.

### Option B: A non-admin machine user with a fine-grained token

Rejected: a long-lived token that concurrent sessions share.

### Option C: Keep sessions on the bot user account, guarded by the hook

Rejected: a direct API call passes the hook.

### Option D: Run rounds and the state write outside the session

Closes the forged comment. Not adopted: it moves the review round out of the session, a redesign of
reviewer ADR-0011 and ADR-0012.

## Trade-offs

- A session running past an hour needs a fresh token.
- `contents` write also authorises GitHub's merge endpoint; only the ruleset, with no session bypass and
  every required check pinned to its App, stops a session merging.

## Consequences

- Easier: no session can change a ruleset, a workflow, a lane, a status or a check.
- Harder: each served repo installs a second App; every author filter names the session App.
- **How we would know this was wrong:** a write by the session App outside its permission set, or a
  CLEAN round recorded that no review round produced.
- Revisit if: rounds move out of the session, or GitHub adds a merge-only permission.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
