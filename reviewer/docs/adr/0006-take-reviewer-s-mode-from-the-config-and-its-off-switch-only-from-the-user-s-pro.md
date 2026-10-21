---
schemaVersion: 0.1.0
id: "0006"
title: "Take reviewer's mode from the config and its off switch only from the user's prompt"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [mode, switch, config, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0015"]
affects:
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "reviewer/plugin/scripts/{hookio,gate}.py"
  - type: path
    pattern: "specs/016-on-off-switch/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of ADRs this one belongs to"
---

# ADR-0006: Take reviewer's mode from the config and its off switch only from the user's prompt

## Context

Every check enforces from its first release (root ADR-0004), so the only brakes are a mode that records
instead of refusing and a way to work without reviewer. Whoever sets either decides whether the gates
hold. A session, an agent included, can set environment variables and edit files in its checkout, but it
cannot type the user's prompt.

## Decision

1. We will read the mode, `enforce` or `log`, and each check's own setting only from the `[reviewer]`
   section of `codeworks.toml` (root ADR-0002). Under `log` a refusal is recorded as `would_deny` and does
   not block.
2. We will switch reviewer off only on a prompt the user types that starts with `reviewer off`, read in the
   `UserPromptSubmit` hook, never from a `claude` command run in Bash (ADR-0012), and on again with
   `reviewer on`. The switch covers that session, its subagents and workflows included, and ends with it.
3. We will lift only the commit gates and the round-launch gate while reviewer is off; every refusal of
   ADR-0012 stays. Off releases nothing: holds, counts and locks stay recorded and apply again when it is on.
4. We will refuse to launch `review-round`, `claim-check` or `shim-check` while reviewer is off.

## Options considered

### Option A: Mode from the config, off from the user's prompt (chosen)

Only a human editing `codeworks.toml`, or the user's typed prompt, loosens a gate, for one session.

### Option B: Environment variables over the config

Rejected: whoever launches a session, an agent included, could switch a check to `log` with no edit the
hook can refuse.

### Option C: An off switch in the config

Rejected: it would switch reviewer off for every session on the branch.

### Option D: Off releases the holds

Rejected: switching back on would lose every decision the holds were waiting for.

### Option E: Run the workflows while off, recording only

Rejected: a round run with its gates lifted would record a verdict the orchestrator attests from.

### Option F: Off lifts every rule

Rejected: a session switched off could make every write the orchestrator or a human owns.

## Trade-offs

- Only the user can switch reviewer off, so an unattended session stuck behind a broken gate waits for a
  human.
- A session switched off commits with no check; only the exempt label lets its PR merge (orchestrator
  ADR-0005).

## Consequences

- Easier: what runs on a branch is what its `codeworks.toml` says.
- Harder: changing a mode for one experiment is a reviewed edit to the config.
- **How we would know this was wrong:** a gate loosened by anything but the config or the user's prompt; a
  hold lost after `reviewer off`; a write ADR-0012 refuses accepted from a session switched off.
- Revisit if: unattended sessions need a way past a broken gate.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
