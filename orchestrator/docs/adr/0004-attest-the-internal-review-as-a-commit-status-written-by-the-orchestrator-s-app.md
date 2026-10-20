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
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner, builder and orchestrator"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0011-record-rounds-and-holds-in-tagged-issue-comments-through-core-the-newest-by-the.md"
    label: "reviewer ADR-0011: Record rounds and holds in tagged issue comments through core/; the newest by the bot wins"
---

# ADR-0004: Attest the internal review as a commit status written by the orchestrator's App

## Context

The merge contract is GitHub's ruleset (ADR-0009), which needs a status saying the internal review
passed at the head. reviewer records each round's verdict in its state comment on the story issue
(reviewer ADR-0011), from inside the agent session. Which credential turns that record into the status
the ruleset trusts is the ruleset's trust root.

## Decision

1. We will attest the internal review as the commit status `internal-review` at the head: success when
   the newest tagged state comment by the bot account on the PR's story issue (ADR-0003) records a CLEAN
   round at the head; success marked "exempt" on an exempt PR (ADR-0005); else pending. No state
   comment means no attestation. It is written whenever the status at the head differs from that value,
   so a write never repeats and a removed exempt label is undone.
2. We will write it with the orchestrator's App, the org's existing App (ADR-0001), from GitHub state
   alone; no session can read that App's key.
3. We will have the ruleset (ADR-0009) require `internal-review` from that App alone, so a status
   written with any session token counts for nothing.
4. We will accept reviewer's refusal of tagged state comments from sessions (reviewer ADR-0012) and the
   bot-account author filter as the only boundary on the record the orchestrator reads.
5. We will never attest a fork PR (head repo ≠ base repo) from reviewer's state; same-repo authors are
   trusted. The exempt label still applies to a fork PR (ADR-0005), so it reaches main only through a
   human with write permission: the exempt label applied after their review, or pushing it to a
   same-repo branch.

## Options considered

### Option A: The orchestrator's App writes the status from reviewer's state comment (chosen)

One writer, whose key lives only on the orchestrator's host; no comment hop.

### Option B: An attestation comment a second App turns into the status

Rejected: a comment any session can post would be the attestation's only evidence.

### Option C: reviewer writes the status from the session with its token

Rejected: the graded session would attest its own review.

### Option D: Attest fork PRs from reviewer's state like same-repo PRs

Rejected: a fork author names the branch and opens the PR outside any session.

## Trade-offs

- The App's evidence is only as trustworthy as the hook: a session that got a tagged comment past it
  could record a CLEAN round the App would attest.
- A fork contribution waits on a writer.

## Consequences

- Easier: the credential that attests never enters an agent session.
- Harder: while the orchestrator is down no PR is attested.
- **How we would know this was wrong:** a CLEAN round no review round produced, or a fork PR attested
  from reviewer's state.
- Revisit if: reviewer's state leaves issue comments (reviewer ADR-0011), or the ruleset stops being the
  merge contract (ADR-0009).

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
