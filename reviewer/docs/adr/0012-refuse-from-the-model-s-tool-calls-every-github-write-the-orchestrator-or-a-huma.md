---
schemaVersion: 0.2.0
id: "0012"
title: "Refuse from the model's tool calls every GitHub write the orchestrator or a human owns"
status: draft
date: 2026-10-20
deciders: []
tags: [hooks, mutation-gate, ownership, orchestrator, merge-gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0011", "0021"]
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
---

# ADR-0012: Refuse from the model's tool calls every GitHub write the orchestrator or a human owns

## Context

The model in an agent session acts on GitHub only as the codeworks-session App (root ADR-0007), which
writes no status; only hooks read the App keys (root ADR-0008). Only reviewed code
merges, held by the ruleset (orchestrator ADR-0009), the orchestrator key and the `internal-review`
attestation from reviewer's record (ADR-0011, ADR-0021). Every other write Decision 1 lists is open to
the session's token, though none is the model's. A `claude` command run from Bash types the user's prompt.

## Decision

1. We will refuse from the model's tool calls (Bash, MCP and file tools): a lane write, the issue
   assignee, a label, a commit status, a PR body edit after creation, an issue body edit, the ready flip,
   an external review request, a merge, and writes to `codeworks.toml` (root ADR-0002) and the state
   directory, and a Bash command that starts `claude`. The model may open a draft PR; a non-draft
   `gh pr create` counts as the ready flip and is refused. Each refusal names the owner and the next step.
2. We will keep each refusal a guardrail; the merge boundary in Context catches a bypass of one.
   reviewer keeps no merge or ready gate and repeats none of GitHub's rules: it guards commits and
   rounds; orchestrator hooks flip, request and merge; the ruleset decides when.
3. We will read no merge verdict and name no exempt PR kinds: exemption is the orchestrator's
   (orchestrator ADR-0005). The one status reviewer reads is `internal-review` "exempt" at the head, on
   which it runs no round; it never reads `exempt_labels`. reviewer reads an external reviewer's findings
   only through `core/`'s validator modules (ADR-0016).

## Options considered

### Option A: Refuse the writes; own nothing of the PR's lifecycle (chosen)

The guarantee sits at the writer; each write the ruleset trusts has one.

### Option B: Gate the merge and the ready flip

The model never merges or flips.

### Option C: Name the exempt PR kinds and a switch for the rest

The label and the session fence replace both.

### Option D: Read a `<module>-review` as a verdict

Rejected: the orchestrator writes it with its App, and the ruleset requires it, so GitHub enforces it.

### Option E: Re-check GitHub's rules in the hook

Rejected: the copy drifts.

## Trade-offs

- A refused write the session App and the ruleset leave open rests on the hook alone, but merges no
  unreviewed code.
- A label the session App applies exempts nothing (orchestrator ADR-0005), so a writer applies it in GitHub.

## Consequences

- Easier: the plugin holds no copy of GitHub's rules or exempt labels, and reads one status.
- Harder: a flip, external review request or merge waits for orchestrator hooks or a human.
- **How we would know this was wrong:** a refusal names no owner or next step, or a PR needs an
  exemption no writer can label.
- Revisit if: the model needs one of these writes.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
