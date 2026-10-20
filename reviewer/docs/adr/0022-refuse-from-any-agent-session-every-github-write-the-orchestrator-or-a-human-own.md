---
schemaVersion: 0.2.0
id: "0022"
title: "Refuse from any agent session every GitHub write the orchestrator or a human owns"
status: draft
date: 2026-10-19
deciders: []
tags: [hooks, mutation-gate, ownership, orchestrator, merge-gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,pre_merge_gate,github,hookio,shell}.py"
  - type: path
    pattern: "reviewer/plugin/hooks/hooks.json"
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
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0004-attest-the-internal-review-as-a-commit-status-written-by-the-orchestrator-s-app.md"
    label: "orchestrator ADR-0004: Attest the internal review as a commit status written by the orchestrator's App"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0005-exempt-a-pr-from-the-internal-review-by-its-bot-author-or-a-label-a-writer-appli.md"
    label: "orchestrator ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0007-mark-a-story-pr-ready-on-the-attestation-alone-in-review-once-green-with-no-find.md"
    label: "orchestrator ADR-0007: Mark a story PR ready on the attestation alone; In review once green with no findings"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0008-request-codex-by-the-orchestrator-s-comment-once-per-head-automatic-review-off.md"
    label: "orchestrator ADR-0008: Request Codex by the orchestrator's comment once per head, automatic review off"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0009-the-orchestrator-squash-merges-on-github-s-gate-and-the-codex-verdict.md"
    label: "orchestrator ADR-0009: The orchestrator squash-merges on GitHub's gate and the Codex verdict"
---

# ADR-0022: Refuse from any agent session every GitHub write the orchestrator or a human owns

## Context

An agent session can make every write Decision 1 lists, though none is the agent's. GitHub
voids a stray status through the ruleset's App pin and refuses a disallowed merge, nothing else.

This supersedes ADR-0003: it reverses d1's merge and ready gate, d2's exempt kinds and switch, and
d3's reading of the org gate's check run; d1's commit guard and its refusal to repeat GitHub's rules
stand.

## Decision

1. We will refuse from any agent session: a lane write, the issue assignee, a label, a commit status,
   a PR body edit after creation, the ready flip, a Codex or CodeRabbit request, a merge, and writes to
   config.json and the state directory. The pre-merge hook still refuses an `--admin` / API bypass in
   an interactive session. Each refusal names the owner and the next step.
2. We will keep no merge or ready gate and repeat none of GitHub's rules: the plugin guards commits
   and rounds; the orchestrator flips, requests and merges; the ruleset decides when.
3. We will read no external verdict and name no exempt PR kinds: exemption is the org's label and
   Bot-author rule (orchestrator ADR-0005), read from `exempt_labels` only to skip a round;
   `codex-review` is the orchestrator's input.

## Options considered

### Option A: Refuse the writes; own nothing of the PR's lifecycle (chosen)

The guarantee sits at the writer; every write the ruleset trusts has one
writer.

### Option B: Gate the merge and the ready flip (ADR-0003 d1)

No agent session merges or flips.

### Option C: Name the exempt PR kinds and a switch for the rest (ADR-0003 d2)

The label and the session fence replace both.

### Option D: Read the org gate's check run (ADR-0003 d3)

The ruleset pins each status to its App.

### Option E: Re-check GitHub's rules in the hook (ADR-0003 option C)

Stays rejected: the copy drifts.

## Trade-offs

- For every refused write but a status or a merge, the hook is the only boundary.
- An exempt label applied from an interactive session, with the human's credential, would skip the
  internal review, so a human applies it in GitHub.

## Consequences

- Easier: the plugin holds no copy of GitHub's rules, exempt kinds or App name.
- Harder: a flip, Codex request or merge waits for the orchestrator's tick or a human; even a
  harmless re-request is refused.
- **How we would know this was wrong:** a refusal names no owner or next step, or a PR needs an
  exemption no writer can label.
- Revisit if: an agent session needs one of these writes, or GitHub can void a stray write as it
  voids a status.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
