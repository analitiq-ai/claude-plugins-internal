---
schemaVersion: 0.2.0
id: "0007"
title: "Let the model act only as the session App, and hooks as the orchestrator and reviewer Apps"
status: draft
date: 2026-10-20
deciders: []
tags: [security, identity, github-app, credentials, sessions, hooks, trust]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0003", "0008"]
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

# ADR-0007: Let the model act only as the session App, and hooks as the orchestrator and reviewer Apps

## Context

Only reviewed code may merge: the ruleset requires CI, `internal-review` and `codex-review` from the
orchestrator App (orchestrator ADR-0009). The model and the hooks share one session (ADR-0008), and a
token reaches the API past any hook. Every trust predicate must tell the model's write from a human's
and a hook's.

## Decision

1. We will have the model's commands act on GitHub only with a one-hour, one-repo installation token of
   `codeworks-session`: contents, pull requests and issues write; metadata, checks, statuses and actions
   read; organization projects read; no administration, workflows, secrets or environments access.
2. We will have a hook mint that token into a gh config folder the model can read but not write, outside
   `~/.claude` and the session's temp folder, refreshed before it expires: the orchestrator's
   SessionStart hook in the agent environment; reviewer's hook, from a session key kept there, where
   planner runs.
3. We will have hooks alone act as `codeworks-orchestrator` (claim, lanes, `internal-review`, the Codex
   request, `codex-review`, the ready flip, merge, Blocked moves) and `codeworks-reviewer` (rounds,
   holds, rescope holds), each App's key read only by its plugin's hooks: all hooks run as one OS
   user, so pinned, write-denied plugin code holds this (ADR-0008).
4. We will put no App on a ruleset bypass list (orchestrator ADR-0009), and count the session App as no
   human, WRITER, TRUSTED or EXEMPT actor in any predicate.
5. We will count a review round only by its record: reviewer's hook writes it as the reviewer App from
   verdicts reviewer ADR-0021 counts, and the orchestrator's hook attests `internal-review` only from it
   (reviewer ADR-0011).
6. We will rest the merge boundary on the ruleset and decisions 3 to 5 alone; every other refusal (commit
   gates, the lane fence, reviewer ADR-0012's) is a guardrail they back.

## Options considered

### Option A: The model on a least-privilege App, hooks on the role Apps (chosen)

The permission set removes the capability; the actor names the writer.

### Option B: A machine user with a fine-grained token

Rejected: a long-lived token in the model's reach.

### Option C: The model on the bot user account, guarded by the hook

Rejected: a direct API call passes the hook.

### Option D: Rounds outside the session

Rejected by the user: one session runs every component (ADR-0008).

## Trade-offs

- `contents` write also authorises GitHub's merge endpoint; only the ruleset stops the model merging.
- Where planner runs, the session key sits on the human's machine (ADR-0008).

## Consequences

- Easier: the model's commands cannot change a ruleset, workflow, lane, status or check.
- Harder: each served repo installs three Apps; every author filter names the session App.
- **How we would know this was wrong:** a session App write outside its permission set, or an
  orchestrator or reviewer App write no hook made.
- Revisit if: rounds move out of the session, or GitHub adds a merge-only permission.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
