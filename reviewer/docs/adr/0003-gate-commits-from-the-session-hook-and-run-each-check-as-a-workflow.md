---
schemaVersion: 0.1.0
id: "0003"
title: "Gate commits from the session hook and run each check as a workflow"
status: draft
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
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
---

# ADR-0003: Gate commits from the session hook and run each check as a workflow

## Context

A check of a commit needs agents, which take minutes. The place that can refuse a commit is a Claude Code
command hook, and a hook that reaches its timeout is cancelled and, on most events, renders no decision. So the slow check cannot run where the refusal is made, and every
commit-time check needs the same way from the refusal to the check and back.

## Decision

1. We will refuse a commit from the plugin's session hook, which sees `git commit` before the Bash tool runs
   it. The hook decides from recorded state, git (run with `core.fsmonitor` and `core.hooksPath`
   disabled), the ledger and GitHub reads (the state comments, the board lane), and does no slow work.
2. We will run each check as a Claude Workflow. The workflow only orders the work; the gate supplies its
   prompts and schemas at launch, and a hook validates each answer before it is recorded. Which launches
   and answers count is ADR-0021's gate rule.
3. We will make a model call inside a hook only where a decision record names it; ADR-0004 names the shim
   check's classifier, whose verdict has to exist before the author commits.

## Options considered

### Option A: Refuse in the session hook, check in a workflow (chosen)

The hook refuses before the Bash tool runs; the workflow runs many agents; no repo needs wiring.

### Option B: A git `pre-commit` hook, or the `pre-commit` framework

Rejected: it runs outside the session, cannot launch a workflow, `--no-verify` skips it, and each repo
would need its own wiring.

### Option C: A Claude Code `agent` or `prompt` hook that judges inside the hook

Rejected: one verdict per hook, so no judge for each claim and no record for each claim.

### Option D: An outside tool, `or1can/claims`

Rejected: it judges names declared in Swift and Rust files only, which no Analitiq repo tracks, and
blocking on its verdict needs Option A anyway.

## Trade-offs

- A checked commit costs a workflow per check it needs, and a refused first try.
- A commit made other than by `git commit` in the Bash tool (`git merge`, `rebase`, `am`, `commit-tree`,
  aliases) is seen only after the command, by ADR-0020's tip check, and put back; one made outside a
  Claude Code session is not seen.
- The workflow depends on a hook rewriting `Workflow` input, which the docs do not promise.
- A model call inside a hook gets less time than the hook itself has.

## Consequences

- Easier: a new commit-time check adds a commit rule, a launch handler and a workflow.
- Harder: every such check inherits the blind spots above.
- **How we would know this was wrong:** commits no check saw reach review more than rarely, or a hook
  reaches its timeout in normal use.
- Revisit if: Claude Code offers a hook that can run a workflow and block on its result.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
