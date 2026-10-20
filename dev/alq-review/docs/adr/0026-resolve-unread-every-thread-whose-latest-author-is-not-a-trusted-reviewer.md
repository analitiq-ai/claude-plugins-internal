---
schemaVersion: 0.2.0
id: "0026"
title: "Resolve unread every thread whose latest author is not a trusted reviewer"
status: draft
date: 2026-10-19
deciders: []
tags: [threads, trust, findings, prompt-injection, gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0029"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{github,gate,briefs,codexstate}.py"
  - type: path
    pattern: "plugins/alq-review/config.json"
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

# ADR-0026: Resolve unread every thread whose latest author is not a trusted reviewer

## Context

On a public repo anyone can open a review thread. GitHub's merge rule counts every thread whoever
wrote it, and a thread an agent reads is text it acts on (OWASP LLM01).

## Decision

1. We will keep one list, `trusted_reviewers` in reviewer's config.json, naming the review bots
   and the named humans; a thread is trusted when its latest comment's author is on it.
2. We will make reviewer the only owner of trust: at a github round's launch (ADR-0029) it
   queries GitHub for the PR's unresolved threads, failing required checks and a conflict with
   main, resolves every untrusted thread unread with a fixed reply naming the reason, and opens
   the round on the rest in one gate decision. No agent reads an untrusted thread; the
   orchestrator launches on any unresolved thread, holding no list.
3. We will identify a finding by thread URL and latest comment id: a trusted reply is a fresh
   finding, its brief carrying the prior ruling; a thread already ruled, with no comment since, is
   carried: handed over with its prior ruling and the step "resolve, or reply and resolve".

## Options considered

### Option A: Reviewer owns trust; untrusted threads resolved unread (chosen)

One owner; no brief carries untrusted text; resolving satisfies GitHub's rule.

### Option B: Untrusted threads labelled for the assessor

Lost: the text still reaches the assessor.

### Option C: Untrusted threads to Blocked for a human

Lost: the orchestrator would need the trust list.

### Option D: Any author's thread as a finding (brainstorm)

Lost: a served repo can be public.

### Option E: An inbox drop file read at the next hook event

Lost: the round queries GitHub at the round's launch.

## Trade-offs

- A defect reported from off the list is closed unread until a trusted reviewer re-raises it.
- Two trust rules coexist: this list for threads, WRITER (author_association) for an escalation
  answer (orchestrator ADR-0010).

## Consequences

- Easier: one config file decides trust, and only reviewer reads it.
- Harder: adding a reviewer is a hand edit to config.json that agent sessions are refused.
- **How we would know this was wrong:** an untrusted comment's text appears in a brief; the
  orchestrator grows a trust list or a Blocked move for an untrusted thread; a trusted reply to a
  ruled thread is not a finding.
- Revisit if: the orchestrator may read plugin config; GitHub's rule can exclude authors;
  every served repo is private.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
