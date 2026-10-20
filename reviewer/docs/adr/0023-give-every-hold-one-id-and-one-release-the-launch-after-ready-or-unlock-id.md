---
schemaVersion: 0.2.0
id: "0023"
title: "Give every hold one id and one release: the launch after Ready, or `unlock <id>`"
status: draft
date: 2026-10-19
deciders: []
tags: [holds, release, user-authority, unlock, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0004", "0014", "0018", "0020", "0021", "0022"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,ledger,claimgate,shimgate,hookio}.py"
  - type: path
    pattern: "reviewer/plugin/hooks/hooks.json"
  - type: path
    pattern: "reviewer/plugin/README.md"
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md"
    label: "orchestrator ADR-0002: The orchestrator alone writes the working lanes, derived from the PR"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0010-take-an-escalation-s-answer-from-a-writer-s-issue-comment.md"
    label: "orchestrator ADR-0010: Take an escalation's answer from a writer's issue comment"
---

# ADR-0023: Give every hold one id and one release: the launch after Ready, or `unlock <id>`

## Context

ADR-0004 and ADR-0018 accepted no release but a keyword prompt (`unlock <ref>` for a `RESHAPE_SPEC`
lock). The orchestrator's launch from a human's Ready types no prompt, so a held PR stayed held.
This record supersedes ADR-0004 and ADR-0018, reversing their one-route rule and ADR-0004's keyword
per user-only action.

## Decision

1. We will give every hold reviewer places (rescope-<pr>, escalation-<pr>, pushback-<pr>, claim-<id>,
   shim-<id>, audit-<pr>) an id and a row in the PR body section (ADR-0021); the orchestrator keeps
   the card Blocked while one is open. `RESHAPE_SPEC` is RESCOPE, its lock rescope-<pr>;
   `override shim-<id>` folds into `unlock shim-<id>`; `unlock #<pr>` goes, and `rebase <ref>` with it (ADR-0020); a
   refusal names the exact id.
2. We will release holds by one function, two callers: reviewer, at the start of the launch that
   follows a human's Ready, releases every open hold of the PR (escalation once ANSWERED); a prompt
   starting `unlock <id>`, read in the `UserPromptSubmit` hook, releases that one. Nothing else does.
3. We will place pushback-<pr> only when a github round rules no FIX while a merge blocker stays
   failing at the head.

## Options considered

### Option A: One id, one function, two human routes (chosen)

Every hold released by one function; the guarantee sits at Ready's writer.

### Option B: Keyword prompt only (ADR-0004, ADR-0018)

The launch types no prompt.

### Option C: Orchestrator runs the unlock

The orchestrator runs no plugin code; it only reads holds.

### Option D: `override` and `unlock #<pr>`

Brainstorm: one verb, one id per hold.

### Option E: A pushback hold on every pushed-back round

Replies resolve the threads; a hold needs a failing merge blocker.

## Trade-offs

- Ready names no author and releases every open hold of the PR at once; the orchestrator trusts
  the lane whoever moved it.
- The guarantee is one hook refusal (ADR-0022); a lane write past it counts as a human's.

## Consequences

- Easier: a new hold is an id, a row and an aftermath.
- Harder: an escalation also needs ANSWERED, else Ready bounces to Blocked (orchestrator ADR-0010).
- **How we would know this was wrong:** a hold released without a human's Ready or `unlock <id>`, or
  an agent's Ready the hook let through.
- Revisit if: a hold appears whose release cannot be the launch after Ready, or `UserPromptSubmit`
  stops seeing the prompt.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
