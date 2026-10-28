---
schemaVersion: 0.2.0
id: "0016"
title: "Read a PR's findings only through core's modules, and brief only trusted reviewers' text"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
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
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:53Z
---

# ADR-0016: Read a PR's findings only through core's modules, and brief only trusted reviewers' text

## Context

On a public repo anyone can open a review thread or reply in one, and a comment an agent reads is text it
acts on (OWASP LLM01). `core/`'s threads module counts a thread as a finding only if a trusted reviewer
started it (root ADR-0003), and the orchestrator's hooks resolve every other thread unread, starting no
work (orchestrator ADR-0007).

## Decision

1. We will read a github round's findings only through `core/`, in reviewer's hook: at the round's
   launch (ADR-0019), the gate reads `findings(pr, head)` from every enabled validator module, the
   threads module among them, never raw threads or a file the session wrote, with the failing required
   checks and a conflict with the default branch, and opens the round on them in one gate decision.
2. We will put into a brief only the comments of trusted reviewers; any other comment in a finding's
   thread is left out unread.
3. We will identify a thread's finding by thread URL and its latest trusted comment id: a trusted reply is
   a fresh finding, its brief carrying the prior ruling; a ruled thread with no trusted comment since is
   carried with its prior ruling and the step "resolve, or reply and resolve". A finding with no thread
   stays open until a fix or a pushback recorded in reviewer's state (ADR-0011) closes it.

## Options considered

### Option A: Findings through core's modules; briefs carry trusted text only (chosen)

### Option B: reviewer resolves untrusted threads at a round's launch

Rejected: an untrusted thread opens no round, so it would block the merge unresolved, or anyone could
start work by opening one.

### Option C: Trust keyed on a thread's latest author

Rejected: one untrusted reply would close a trusted reviewer's thread unread.

### Option D: reviewer reads raw threads and reviewer checks itself

Rejected: a second reader of each external reviewer beside the module the orchestrator calls.

### Option E: Untrusted threads labelled for the assessor

Rejected: the text still reaches the assessor.

## Trade-offs

- A defect reported from off the list is closed unread until a trusted reviewer re-raises it.
- Two trust rules coexist: `trusted_reviewers` for findings, a writer's repository role for an escalation
  answer (orchestrator ADR-0010).

## Consequences

- Easier: reviewer holds no trust rule of its own and closes no thread it did not rule on.
- Harder: adding a reviewer is a hand edit to `codeworks.toml`, which the model may not write (ADR-0012).
- **How we would know this was wrong:** an untrusted comment's text appears in a brief; a trusted reply to
  a ruled thread is not a finding; reviewer reads a thread outside `core/`.
- Revisit if: GitHub's conversation rule can exclude authors, or every served repo is private.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
