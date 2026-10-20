---
schemaVersion: 0.2.0
id: "0016"
title: "Resolve unread every thread whose latest author is not a trusted reviewer"
status: draft
date: 2026-10-20
deciders: []
tags: [threads, trust, findings, validators, prompt-injection, gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0011", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{github,gate,briefs,codexstate}.py"
  - type: path
    pattern: "core/**"
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
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0010-take-an-escalation-s-answer-from-a-writer-s-issue-comment.md"
    label: "orchestrator ADR-0010: Take an escalation's answer from a writer's issue comment"
---

# ADR-0016: Resolve unread every thread whose latest author is not a trusted reviewer

## Context

On a public repo anyone can open a review thread. The ruleset's conversation-resolution rule counts every
unresolved thread, and a thread an agent reads is text it acts on (OWASP LLM01).

## Decision

1. We will keep one list, `trusted_reviewers` in the `[reviewer]` section of `codeworks.toml` (root
   ADR-0002), naming the review bots and the named humans; a finding is trusted when its `author`, for a
   thread its latest comment's author, is on it.
2. We will count every unresolved review thread, whoever wrote it, as a finding: the orchestrator
   launches a round on any open finding, holding no list (root ADR-0003).
3. We will make reviewer the only owner of trust: at a github round's launch (ADR-0019) it reads
   `findings(pr, head)` from every enabled validator module in `core/` (root ADR-0003), never raw threads,
   with failing required checks and a conflict with the default branch; it resolves every untrusted thread
   unread with a fixed reply naming the reason, and opens the round on the rest in one gate decision.
4. We will identify a thread's finding by thread URL and latest comment id: a trusted reply is a fresh
   finding, its brief carrying the prior ruling; a ruled thread with no comment since is carried with its
   prior ruling and the step "resolve, or reply and resolve". A finding with no thread stays open until a
   fix or a pushback recorded in reviewer's state (ADR-0011) closes it.

## Options considered

### Option A: Reviewer owns trust; untrusted threads resolved unread (chosen)

No brief carries untrusted text; resolving satisfies GitHub's rule.

### Option B: Untrusted threads labelled for the assessor

Lost: the text still reaches the assessor.

### Option C: Untrusted threads to Blocked for a human

Lost: the orchestrator would need the trust list.

### Option D: Reviewer reads raw threads and reviewer checks itself

Lost: a second reader of each external reviewer beside the module the orchestrator calls.

### Option E: Count only trusted authors' threads as findings

Lost: an untrusted thread left unresolved blocks the merge with no round to resolve it.

## Trade-offs

- A defect reported from off the list is closed unread until a trusted reviewer re-raises it.
- Two trust rules coexist: this list for findings, WRITER (author_association) for an escalation
  answer (orchestrator ADR-0010).

## Consequences

- Easier: one config key decides trust, and only reviewer reads it.
- Harder: adding a reviewer is a hand edit to `codeworks.toml`, which sessions may not write.
- **How we would know this was wrong:** an untrusted comment's text appears in a brief; the
  orchestrator grows a trust list; a trusted reply to a ruled thread is not a finding.
- Revisit if: GitHub's rule can exclude authors, or every served repo is private.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
