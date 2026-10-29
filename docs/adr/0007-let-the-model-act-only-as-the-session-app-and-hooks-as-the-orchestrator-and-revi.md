---
schemaVersion: 0.2.0
id: "0007"
title: "Let the model act only as the session App, and hooks as the orchestrator and reviewer Apps"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
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
  - type: path
    pattern: "planner/plugin/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:47Z
---

# ADR-0007: Let the model act only as the session App, and hooks as the orchestrator and reviewer Apps

## Context

Only reviewed code may merge: the ruleset requires CI, `internal-review` and each module's
`<module>-review` from the orchestrator App (orchestrator ADR-0009). The model and the hooks share one
session (ADR-0008), and a token reaches the API past any hook. Every trust predicate must tell the
model's write from an admin's and a hook's.

## Decision

1. We will have the model's commands act on GitHub only with a one-hour, one-repo installation token of
   `codeworks-session`, read-only: metadata, contents, pull requests, issues, checks, statuses and
   actions read; organization projects read; no write of any kind.
2. We will have the orchestrator's SessionStart hook mint that token into a gh config folder the model
   can read but not write, outside `~/.claude` and the session's temp folder, and its PreToolUse hook
   mint a new one before it expires (orchestrator ADR-0001 d3).
3. We will have hooks alone act as `codeworks-orchestrator` (every write the orchestrator's records
   give it) and `codeworks-reviewer` (rounds, holds), each App's key read only by its plugin's hooks:
   all hooks run as one OS user, so pinned, write-denied plugin code holds this (ADR-0008).
4. We will have planner act on GitHub only as its own App, `codeworks-planner` (contents, pull requests
   and issues write; organization projects read; it writes no lane, planner ADR-0005), whose key exists
   only where planner runs and whose token planner's own scripts mint there for their own GitHub calls
   alone; and the session's other commands there, like the admin, act only through the admin's personal
   login, under admin supervision.
5. We will put no App on a ruleset bypass list (orchestrator ADR-0009), and count no codeworks App
   (session, orchestrator, reviewer, planner) as an admin, WRITER, TRUSTED or EXEMPT actor in any
   predicate.
6. We will count a review round only by its record: reviewer's hook writes it as the reviewer App from
   verdicts reviewer ADR-0021 counts, and the orchestrator's hook attests `internal-review` only from it
   (reviewer ADR-0011).
7. We will rest the merge boundary on the ruleset and decisions 1, 3, 5 and 6 alone; every other refusal
   (commit gates, the lane fence, reviewer ADR-0012's) is a guardrail they back.

## Options considered

### Option A: The model on a read-only App, hooks on the role Apps (chosen)

The permission set removes every write; the actor names the writer.

### Option B: A machine user with a fine-grained token

Rejected: a long-lived token in the model's reach.

### Option C: The model on the bot user account, guarded by the hook

Rejected: a direct API call passes the hook.

### Option D: Rounds outside the session

Rejected by the user: one session runs every component (ADR-0008).

### Option E: The model's token with contents, pull requests and issues write

Rejected: contents write also authorises GitHub's merge endpoint, so only the ruleset would stop the
model merging. The user agreed the read-only token on 2026-10-24.

### Option F: planner on the session App

Rejected: the session App's key would sit on the admin's machine.

### Option G: planner's hook points the whole session's gh at the planner App's token

Rejected by the user on 2026-10-29: it unset the admin's own tokens for every command in the session,
and refused every Bash call when a mint failed.

## Trade-offs

- Every GitHub write the loop needs is a hook's: a write a hook fails to make stays undone until a hook
  runs again.
- Where planner runs, the planner App's key sits on the admin's machine (ADR-0008).
- Where planner runs, the session's commands other than planner's scripts act with the admin's gh login:
  admin supervision, not a token's permissions, bounds what they write.

## Consequences

- Easier: the model's commands write nothing on GitHub: no push, comment, label, lane, check or merge.
- Harder: each served repo installs four Apps; every author filter names them.
- **How we would know this was wrong:** any write by the session App, or an orchestrator or reviewer App
  write no hook made.
- Revisit if: rounds move out of the session.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
