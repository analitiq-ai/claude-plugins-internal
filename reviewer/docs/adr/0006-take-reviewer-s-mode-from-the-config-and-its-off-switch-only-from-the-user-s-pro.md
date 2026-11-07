---
schemaVersion: 0.1.0
id: "0006"
title: "Take reviewer's mode from the config and its off switch only from the user's prompt"
status: accepted
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
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:51Z
---

# ADR-0006: Take reviewer's mode from the config and its off switch only from the user's prompt

## Context

Every check enforces from its first release (root ADR-0004), so the only brakes are a mode that records
instead of refusing and a way to work without reviewer. Whoever sets either decides whether the gates
hold. A session, an agent included, can set environment variables and edit files in its checkout, but it
cannot type the user's prompt.

## Decision

1. We will give reviewer two modes, `enforce` and `log`, set like every key in its section (root
   ADR-0002). Under `log` a refusal by the commit gates or the round-launch gate is recorded as
   `would_deny` and does not block; every refusal of ADR-0012 blocks in every mode.
2. We will switch reviewer off only on a prompt the user types that starts with `reviewer off`, read in the
   `UserPromptSubmit` hook, never from a `claude` command run in Bash (ADR-0012), and on again with
   `reviewer on`. The switch covers that session, its subagents and workflows included, and ends with it.
3. We will lift only the commit gates and the round-launch gate while reviewer is off; every refusal of
   ADR-0012 stays. Off releases nothing: holds, counts and locks stay recorded and apply again when it is on.
4. We will refuse to launch any reviewer workflow while reviewer is off.

## Options considered

### Option A: Mode from the config, off from the user's prompt (chosen)

Only an admin editing `codeworks.toml`, or the user's typed prompt, loosens a gate, for one session.

### Option B: An off switch in the config

Rejected: it would switch reviewer off for every session on the branch.

### Option C: Off releases the holds

Rejected: switching back on would lose every decision the holds were waiting for.

### Option D: Run the workflows while off, recording only

Rejected: a round run with its gates lifted would record a verdict the orchestrator attests from.

### Option E: Off lifts every rule

Rejected: a session switched off could make every write the orchestrator or an admin owns.

### Option F: The orchestrator pushes none of a switched-off session's commits

Rejected by the user on 2026-10-30: a switched-off session on the agent machine could never push, so its work
never reached a PR (#209).

## Trade-offs

- Only the user can switch reviewer off, so an unattended session stuck behind a broken gate waits for an
  admin.
- A session switched off commits with no check, and the orchestrator pushes those commits unchecked, but none
  touching a `.github/` folder (ADR-0002 d2); only the exempt label lets their PR merge (orchestrator ADR-0005).

## Consequences

- Easier: what runs on a branch is what its `codeworks.toml` says.
- Harder: changing a mode for one experiment is a reviewed edit to the config.
- **How we would know this was wrong:** a gate loosened by anything but the config or the user's prompt; a
  hold lost after `reviewer off`; a write ADR-0012 refuses accepted from a session switched off.
- Revisit if: unattended sessions need a way past a broken gate.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
