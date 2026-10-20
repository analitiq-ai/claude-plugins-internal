---
schemaVersion: 0.2.0
id: "0003"
title: "Keep the loop's durable state in GitHub objects"
status: draft
date: 2026-10-20
deciders: []
tags: [orchestrator, state, github, pull-requests, issues]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0001", "0004"]
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0011-record-rounds-and-holds-in-tagged-issue-comments-through-core-the-newest-by-the.md"
    label: "reviewer ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the bot wins"
---

# ADR-0003: Keep the loop's durable state in GitHub objects

## Context

The orchestrator (ADR-0001) and reviewer act on the same facts; the orchestrator's host is unspecified.

## Decision

1. We will keep every state that outlives a session on GitHub: the claim is the story issue's
   assignee; the attestation is a commit status at the head (ADR-0004); rounds and holds are reviewer's
   tagged state comments on the story issue, the newest by the bot account winning (reviewer ADR-0011);
   findings come from the validator modules, the required checks, unresolved review threads and the
   mergeable field (ADR-0007);
   the escalation question, its answer and every Blocked reason are issue comments.
2. We will link a PR to its story issue by its head branch prefix `<s>-us` (reviewer ADR-0015), never
   by `Closes #s` or `closingIssuesReferences`; a story's PR is the newest PR whose head is its branch.
   Only a same-repo head links; a fork PR is never attested from reviewer's state, though the exempt
   label applies (ADR-0004).
3. We will keep every fact the orchestrator acts on machine-readable: the state comment is a machine
   snapshot; a Blocked reason carries its cause's key and is posted only when no comment with
   that key exists.
4. We will post Blocked reasons and Codex requests with the orchestrator's App, and count only that
   App's comments for HANDLED and REQUESTED.
5. We will let the orchestrator keep on its host only its process lock and launch log, keyed per
   (repo, issue); it re-reads GitHub every tick and stores nothing it could read there. Its config is
   its section of `codeworks.toml` (root ADR-0002).
6. We will let the plugins keep session-scoped files and a cache rebuilt from the state comments; no
   record elsewhere.

## Options considered

### Option A: GitHub objects, reviewer's state in tagged issue comments (chosen)

### Option B: A PR body section

Rejected: there is no PR before the first push, and every whole-body writer can drop a hold.

### Option C: A shared-host ledger the orchestrator reads

Rejected: a deployment assumption; the orchestrator runs no plugin code.

### Option D: A local handled flag in the launch log

Rejected: the comment's key is the record; a restart re-reads the issue.

### Option E: The PR linked by `Closes #s`

Rejected: the body is author-written prose; the branch prefix is the link FENCE already enforces.

## Trade-offs

- A state comment is trusted only from the bot account and only while reviewer refuses tagged comments
  from sessions (reviewer ADR-0012).
- A launch that died leaves no record: at start-up its entry is dropped and it is relaunched.

## Consequences

- Easier: the orchestrator restarts anywhere; a hold survives a re-created PR.
- Harder: a fact to remember needs a GitHub object or is not state.
- **How we would know this was wrong:** a record kept off GitHub beyond decisions 5 and 6, or two hosts
  disagreeing about one issue.
- Revisit if: a second account writes tagged state comments, or orchestrator and plugins share one host.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
