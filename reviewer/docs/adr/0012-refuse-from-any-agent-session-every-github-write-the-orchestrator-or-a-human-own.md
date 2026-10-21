---
schemaVersion: 0.2.0
id: "0012"
title: "Refuse from any agent session every GitHub write the orchestrator or a human owns"
status: draft
date: 2026-10-20
deciders: []
tags: [hooks, mutation-gate, ownership, orchestrator, merge-gate]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0011"]
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

# ADR-0012: Refuse from any agent session every GitHub write the orchestrator or a human owns

## Context

An agent session acts as the codeworks-session App (root ADR-0007), which writes no status, and the
ruleset refuses a disallowed merge (orchestrator ADR-0009). Every other write Decision 1 lists is open to
the session's token, though none is the agent's. A `claude` command run from Bash types a prompt that is
the user's to type.

## Decision

1. We will refuse from any agent session: a lane write, the issue assignee, a label, a commit status,
   a PR body edit after creation, an issue body edit, a tagged state comment not written through `core/`
   and any edit or delete of one (ADR-0011), the ready flip, a Codex or CodeRabbit request, a merge, and
   writes to `codeworks.toml` (root ADR-0002) and the state directory, and a Bash command that starts
   `claude`. A session may open a draft PR; a non-draft `gh pr create` counts as the ready flip and is
   refused. Each refusal names the owner and the next step.
2. We will keep no merge or ready gate and repeat none of GitHub's rules: the plugin guards commits
   and rounds; the orchestrator flips, requests and merges; the ruleset decides when.
3. We will read no merge verdict and name no exempt PR kinds: exemption is the orchestrator's
   (orchestrator ADR-0005). The one status reviewer reads is `internal-review` "exempt" at the head, on
   which it runs no round; it never reads `exempt_labels`. reviewer reads an external reviewer's findings
   only through `core/`'s validator modules (ADR-0016).

## Options considered

### Option A: Refuse the writes; own nothing of the PR's lifecycle (chosen)

The guarantee sits at the writer; every write the ruleset trusts has one writer.

### Option B: Gate the merge and the ready flip

No agent session merges or flips.

### Option C: Name the exempt PR kinds and a switch for the rest

The label and the session fence replace both.

### Option D: Read `codex-review` as a verdict

Rejected: the orchestrator writes it with its App, and the ruleset requires it, so GitHub enforces it.

### Option E: Re-check GitHub's rules in the hook

Rejected: the copy drifts.

## Trade-offs

- For every refused write the session App's permissions and the ruleset leave open, the hook is the only
  boundary.
- A label the session App applies exempts nothing (orchestrator ADR-0005), so a human applies it in GitHub.

## Consequences

- Easier: the plugin holds no copy of GitHub's rules or exempt labels, and reads one status.
- Harder: a flip, Codex request or merge waits for the orchestrator's tick or a human.
- **How we would know this was wrong:** a refusal names no owner or next step, or a PR needs an
  exemption no writer can label.
- Revisit if: an agent session needs one of these writes.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
