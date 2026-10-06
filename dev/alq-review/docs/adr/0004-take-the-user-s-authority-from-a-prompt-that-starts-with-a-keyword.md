---
schemaVersion: 0.1.0
id: "0004"
title: "Take the user's authority from a prompt that starts with a keyword"
status: draft
date: 2026-10-06
deciders: []
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
    label: "The batch of decision records this one belongs to"
  - type: issue
    id: "26"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/26"
    label: "The on/off switch for the claim check and the shim check, which follows this record"
---

# ADR-0004: Take the user's authority from a prompt that starts with a keyword

Draft for the ratifier. Paths are relative to the repo root. This record writes down a choice the code
already makes; it was read in the code at main @ 50c4330.

## Context

Some holds may be released by the user and by nothing else. Constitution P2 asks each hold to name "the one
entity approved to release it" and "the one action by which it does"
(`dev/alq-review/.specify/memory/constitution.md:78-79`).

The gate therefore has to tell the user's act from an agent's. GitHub cannot do it. The reason is recorded in
one place, the docstring of `plugins/alq-review/scripts/pre_merge_gate.py:34-39`:

> Analitiq-Bot is an org admin, and the user and every agent session act as it, so GitHub cannot tell the
> user's override from an agent's: the permission is taken from the user's own words instead. [...] It must
> start the prompt because the cron bot's prompts quote issue and PR text that anyone can write.

The same choice is made five times, in four modules, and is stated as a rule nowhere. A sixth is planned
(issue #26).

## Decision

A release that belongs to the user is taken from a prompt the user submits, and the prompt has to start
with the release's keyword. The gate reads the prompt in its `UserPromptSubmit` hook
(`plugins/alq-review/hooks/hooks.json:66`). A command, a file edit, a setting or an agent's message is not a
release.

This is what the code does today:

| Prompt starts with | Pattern | What the handler does |
|---|---|---|
| `unlock <ref>` | `plugins/alq-review/scripts/gate.py:39` | When the reference names one locked PR, it calls `ledger.unlock` for that PR (`gate.py:148-151`). |
| `/alq-review:design-doc rescope <ref>` | `gate.py:41` | The same, but when the named lock has no `RESHAPE_SPEC` ruling it unlocks nothing and names `unlock` (`gate.py:145-147`). |
| `unlock claim-<id>` | `plugins/alq-review/scripts/claimgate.py:19` | It calls `claimcheck.release` on each hold whose claims include that id (`claimgate.py:327-338`). |
| `override shim-<id>` | `plugins/alq-review/scripts/shimgate.py:23` | It saves a chain with the state `overridden`: the chain the id names (`shimgate.py:438-446`), or the chains of the staged tree the id names (`shimgate.py:449-465`). |
| `override-merge #N` | `plugins/alq-review/scripts/pre_merge_gate.py:84` | `grant` adds N to the session's granted PR numbers (`pre_merge_gate.py:220-233`). `spend_override` removes it when a merge of that PR is let through (`pre_merge_gate.py:236-242`, `pre_merge_gate.py:324-325`). |

`gate.on_prompt` strips leading whitespace from the prompt and tests each pattern with `match`
(`plugins/alq-review/scripts/gate.py:128-136`). `pre_merge_gate.grant` does the same
(`plugins/alq-review/scripts/pre_merge_gate.py:221`). The comment at `gate.py:37` gives the reason for the
anchor: "the cron bot's prompts quote issue and PR text anyone can write".

The user decided on 2026-10-06 that the planned on/off switch for the claim check and the shim check
(issue #26) is per machine and typed by the user. That follows this record.

Not in this record: which hold each keyword releases and for how long, how an id is printed and parsed, and
where a grant is stored. Those belong to each gate's spec and to record 0002.

## Options considered

### Option A: A keyword at the start of the user's prompt (today)

| Dimension | Assessment |
|---|---|
| Tells the user from an agent | By the hook event: the gate acts on a prompt, not on a tool call |
| Quoted text in a prompt | Not matched, because the keyword has to start the prompt |
| What the user does | Types one line that the refusal names |
| Depends on | Claude Code running the `UserPromptSubmit` hook |

### Option B: Tell the user from an agent on GitHub

Rejected in the docstring quoted above: the user and the agent sessions act as one GitHub account.

### Option C: A command the user runs, or a file or setting the user changes

One instance exists. `python3 scripts/ledger.py unlock` releases a round lock
(`plugins/alq-review/scripts/ledger.py:481-484`), and the README marks it "user only; refused to agents"
(`plugins/alq-review/README.md:149`). An agent session can also run commands, so the gate has to recognise
the command and refuse it: `shell.classify` marks a command with a word ending in `ledger.py` and the word
`unlock` (`plugins/alq-review/scripts/shell.py:180-181`), and `gate.on_bash` refuses that action
(`plugins/alq-review/scripts/gate.py:284-285`). Each route of this kind needs its own guard of this kind. No
reason is recorded for keeping this command beside the prompt.

### Option D: The keyword anywhere in the prompt

Rejected in the docstring and the comment quoted above: an automated prompt can quote text that anyone wrote.

### Option E: Do nothing, and let any session release a hold

Rejected by constitution P2: a hold "with any second way out" fails its gate
(`dev/alq-review/.specify/memory/constitution.md:80-81`).

## Trade-offs

- The authority belongs to whoever writes the start of a prompt. For a session a person types into, that is
  the user. For an automated session, it is whoever writes the automation's prompt.
- The rule rests on one platform fact that this record did not test: an agent's tool calls do not raise
  `UserPromptSubmit`.
- A release is local. It is taken by the hook on the machine where the prompt was typed.
- The user has to type the exact line. A prompt that names nothing held releases nothing and says so
  (`plugins/alq-review/scripts/gate.py:158`, `plugins/alq-review/scripts/claimgate.py:343`).
- There are five keywords with five patterns, matched in four modules. Nothing shared parses them.

## Consequences

- Easier: a new hold gets its release by adding one pattern to the prompt handler. A refusal can name the
  exact line for the user to type.
- Harder: a release cannot be scripted, by design. A release route that is not a prompt has to be found and
  guarded one by one.
- The round lock has three ways out today: the `unlock` prompt, the rescope prompt for a `RESHAPE_SPEC`
  lock, and the `ledger.py unlock` command. P2 asks for one action.
- **How we would know this was wrong:** a release appears in the ledger or in `gate.log` that the user did
  not type; or Claude Code changes when it raises `UserPromptSubmit`.
- Revisit if: the user gets an identity on GitHub that agent sessions do not share, or the platform offers
  a way to confirm that a person approved a step.

## Action items

1. [ ] The ratifier accepts this record, or sends it back.
2. [ ] Decide whether the `ledger.py unlock` command stays. It is a way out of the round lock that is not a
   prompt, and no reason for it is recorded.
3. [ ] Build the on/off switch of issue #26 as a keyword prompt, per this record.
4. [ ] Add a line to constitution P2 that points here for how the user's action is recognised, in its own PR.
