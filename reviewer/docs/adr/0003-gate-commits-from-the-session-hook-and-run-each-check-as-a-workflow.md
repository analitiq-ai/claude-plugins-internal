---
schemaVersion: 0.1.0
id: "0003"
title: "Gate commits from the session hook and run each check as a workflow"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [claim-check, shim-check, commit-gate, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0021"]
affects:
  - type: path
    pattern: "reviewer/plugin/hooks/hooks.json"
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,claimgate,shimgate,jev}.py"
  - type: path
    pattern: "reviewer/plugin/workflows/**"
  - type: path
    pattern: "reviewer/plugin/lib/check/after-commit.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:50Z
---

# ADR-0003: Gate commits from the session hook and run each check as a workflow

## Context

A check of a commit needs agents, which take minutes. A Claude Code command hook is what sees a new commit,
and a hook that reaches its timeout is cancelled and, on most events, renders no decision. So the slow check
cannot run in the hook, and every commit-time check needs the same way from the hook to the check and back.

## Decision

1. We will gate commits from the plugin's session hook, which sees each new commit after the Bash command
   that made it (ADR-0020), however it was made, and names the checks it needs; only commits that passed
   are pushed (ADR-0002). The hook decides from recorded state, git (run as root ADR-0008 decision 8
   says), the check's session-scoped files beside the commit-check pass record, holding the running check
   and its reads and verdicts, and GitHub reads (the state record, the board lane), and does no slow work.
   None of those files outlives the session, and reviewer keeps no database.
2. We will run each check as a Claude Workflow. The workflow only orders the work; the gate supplies its
   prompts and schemas at launch, and a hook validates each answer before it is recorded. Which launches
   and answers count is ADR-0021's gate rule.
3. We will make a model call inside a hook only where a decision record names it; ADR-0004 names the shim
   check's classifier, whose key only hooks read (root ADR-0008).

## Options considered

### Option A: Gate in the session hook, check in a workflow (chosen)

The hook sees every commit after the command that made it; the workflow runs many agents; no repo needs
wiring.

### Option B: A git `pre-commit` hook, or the `pre-commit` framework

Rejected: it runs outside the session, cannot launch a workflow, `--no-verify` skips it, and each repo
would need its own wiring.

### Option C: A Claude Code `agent` or `prompt` hook that judges inside the hook

Rejected: one verdict per hook, so no judge for each claim and no record for each claim.

### Option D: An outside tool, `or1can/claims`

Rejected: it judges names declared in Swift and Rust files only, which no Analitiq repo tracks, and
blocking on its verdict needs Option A anyway.

## Trade-offs

- A checked commit costs a workflow per check it needs.
- The workflow depends on a hook rewriting `Workflow` input, which the docs do not promise.
- A model call inside a hook gets less time than the hook itself has.

## Consequences

- Easier: a new commit-time check adds a commit rule, a launch handler and a workflow.
- Harder: every such check inherits the blind spots above.
- **How we would know this was wrong:** a commit no check passed reaches review, or a hook reaches its
  timeout in normal use.
- Revisit if: Claude Code offers a hook that can run a workflow and block on its result.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
