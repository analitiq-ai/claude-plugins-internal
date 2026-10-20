---
schemaVersion: 0.1.0
id: "0004"
title: "Take the user's authority from a prompt that starts with a keyword"
status: superseded
supersededBy: "0023"
date: 2026-10-06
deciders: ["@Analitiq-Bot-Wonka"]
tags: [release, holds, user-authority]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,claimgate,shimgate,pre_merge_gate,shell,ledger}.py"
  - type: path
    pattern: "plugins/alq-review/hooks/hooks.json"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
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
  - type: issue
    id: "26"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/26"
    label: "The on/off switch for the claim check and the shim check, which follows this ADR"
---

# ADR-0004: Take the user's authority from a prompt that starts with a keyword

## Context

Some holds may be released by the user and by nothing else. Constitution P2 asks every hold to name the one
entity approved to release it and the one action by which it does, and fails a hold "with any second way out".

So the gate has to tell the user's act from an agent's. GitHub cannot. The module docstring of
`plugins/alq-review/scripts/pre_merge_gate.py` gives the reason: "Analitiq-Bot is an org admin, and the user
and every agent session act as it".

A second force is automation. The same docstring says the cron bot's prompts quote issue and PR text that
anyone can write. A release word found anywhere in a prompt could come from a stranger.

The keywords today are `unlock <ref>`, `/alq-review:design-doc rescope <ref>`, `unlock claim-<id>`,
`override shim-<id>`, `override-merge #N`, `alq-review off` and `alq-review on`.

Why now: the same answer was reached three times, for the merge override, the claim hold and the shim
override. It is written as a rule nowhere. Issue #26 plans a further user-only action, an on/off switch
for the two commit checks.

## Decision

1. We will take a release that belongs to the user from a prompt the user submits. The plugin reads it in its
   `UserPromptSubmit` hook.
2. We will require the prompt to start with the release's keyword. A keyword later in the prompt releases
   nothing.
3. We will not accept a command, a file edit, a setting or an agent's message as a release.
4. We will give each new user-only action a keyword of its own.

## Options considered

### Option A: A keyword at the start of the user's prompt (chosen)

| Dimension | Assessment |
|---|---|
| Tells the user from an agent | By the hook event |
| Quoted text in a prompt | Not matched, because the keyword has to start the prompt |
| What the user does | Types one line that the refusal names |
| Depends on | Claude Code raising `UserPromptSubmit` for the user's prompts only |

### Option B: Tell the user from an agent on GitHub

Rejected in the merge gate's docstring. The user and the agent sessions act as one GitHub account.

### Option C: The keyword anywhere in the prompt

Rejected in the same docstring. An automated prompt can quote text that anyone wrote.

### Option D: Do nothing, and let any session release a hold

Rejected by constitution P2. A hold that an agent can release has a second way out.

## Trade-offs

- The authority belongs to whoever writes the start of a prompt. In an automated session that is whoever
  writes the automation's prompt, not a person at a keyboard.
- The rule rests on a platform fact this ADR did not test: an agent's tool calls do not raise
  `UserPromptSubmit`.
- A release is local to the machine where the prompt was typed.

## Consequences

- Easier: a new hold gets its release by adding one keyword. A refusal can name the exact line to type.
- Harder: any release route that is not a prompt has to be found and closed one by one.
- **How we would know this was wrong:** a release appears in the ledger or in `gate.log` that the user did not
  type, or Claude Code changes when it raises `UserPromptSubmit`.
- Revisit if: the user gets a GitHub identity that agent sessions do not share, or the platform offers a way
  to confirm that a person approved a step.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [ ] Build the switch of issue #26 as a keyword prompt.
3. [ ] Decide whether the `ledger.py unlock` command stays. It is a release route that is not a prompt.
4. [x] Point constitution P2 at this ADR for how the user's action is recognised, in its own PR. Done in #77.
