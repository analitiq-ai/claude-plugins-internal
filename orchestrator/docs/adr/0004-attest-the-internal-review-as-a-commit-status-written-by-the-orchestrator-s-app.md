---
schemaVersion: 0.2.0
id: "0004"
title: "Attest the internal review as a commit status written by the orchestrator's App"
status: draft
date: 2026-10-20
deciders: []
tags: [attestation, commit-status, merge-gate, github-app, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0005", "0009"]
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

# ADR-0004: Attest the internal review as a commit status written by the orchestrator's App

## Context

The merge contract is GitHub's ruleset (ADR-0009), which needs a status saying the internal review
passed at the head. reviewer records each round's verdict in its state comment on the story issue
(reviewer ADR-0011), from inside the agent session. Which credential turns that record into the status
the ruleset trusts is the ruleset's trust root. A PR can also change the config, workflows and hooks that
grade it.

## Decision

1. We will attest the internal review as the commit status `internal-review` at the head: success when
   reviewer's state on the PR's story issue, read as reviewer ADR-0011 decides, records a CLEAN round at
   the head; success marked "exempt" on an exempt PR (ADR-0005); else pending. Every tick the
   orchestrator writes `internal-review` and `codex-review` (ADR-0008) on every open PR of the repo,
   story PR or not, when the status at the head differs from its value, so a write never repeats and a
   removed exempt label is undone.
2. We will write it with the orchestrator's App, the org's existing App (ADR-0001), from GitHub state
   alone; no session can read that App's key (ADR-0009).
3. We will rely on the ruleset's pin of `internal-review` to that App (ADR-0009): a status written
   with any other token counts for nothing.
4. We will never attest a PR that changes `codeworks.toml`, `.github/` or `.claude/`, Bot-authored or
   not: its card goes to Blocked naming the paths, and only a human's exempt label (ADR-0005) attests it.
5. We will never attest a fork PR (head repo ≠ base repo) from reviewer's state. The exempt label still
   applies to a fork PR (ADR-0005).

## Options considered

### Option A: The orchestrator's App writes the status from reviewer's state comment (chosen)

One writer, its key only on the orchestrator's host.

### Option B: An attestation comment a second App turns into the status

Rejected: a comment any session can post would be the attestation's only evidence.

### Option C: reviewer writes the status from the session with its token

Rejected: the graded session would attest its own review.

### Option D: Attest fork PRs from reviewer's state like same-repo PRs

Rejected: a fork author names the branch and opens the PR outside any session.

## Trade-offs

- A session can forge a CLEAN round through the API, an accepted risk (root ADR-0007).
- Every change to the config, workflows or hooks waits on a human's label.
- A fork contribution waits on a writer's exempt label or same-repo push.

## Consequences

- Easier: the credential that attests never enters an agent session.
- Harder: while the orchestrator is down no PR is attested.
- **How we would know this was wrong:** a CLEAN round no review round produced, or a
  protected-path or fork PR attested from reviewer's state.
- Revisit if: rounds move out of the session (root ADR-0007), or the ruleset stops being the merge
  contract.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
