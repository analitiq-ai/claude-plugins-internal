---
schemaVersion: 0.1.0
id: "0003"
title: "Gate commits from the session hook and run each check as a workflow the refusal names"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [claim-check, shim-check, commit-gate, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
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
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of decisions already made, written as ADRs"
---

# ADR-0003: Gate commits from the session hook and run each check as a workflow the refusal names

## Context

A check of a commit needs agents: readers, a judge for each claim, sweepers. That takes minutes. The place
that can refuse a commit is a Claude Code command hook, and the hooks guide says that a hook that reaches
its timeout is cancelled and, on most events, renders no decision.

So the slow check cannot run where the refusal is made. Something has to carry the author from the refusal to
the check and back. Three specs each worked this out on their own. A fourth commit-time check would have
to work it out again.

## Decision

1. We will refuse a commit from the plugin's session hook, the one that already sees `git commit` before the
   Bash tool runs it. The hook decides from recorded state, git and the ledger, and does no slow work.
2. We will run each check as a Claude Workflow. The workflow only orders the work. The gate supplies its
   prompts and schemas at launch, and a hook validates each answer before it is recorded.
3. We will name the workflow call in the refusal, so the author runs it and commits again.
4. We will name in this ADR every model call made inside a hook. Today there is one: the shim check's
   classifier, Jev. It is called from hooks, not from the workflow, so that the verdict exists before the
   author tries to commit. A call made inside a hook gets less time than the hook itself has.

## Options considered

### Option A: Refuse in the session hook, check in a workflow, name the workflow in the refusal (chosen)

| Dimension | Assessment |
|---|---|
| Can refuse a commit | Yes, before the Bash tool runs it |
| Can run many agents | Yes, in the workflow |
| Wiring for each repo | No git hook to install in each repo |
| Existing tools | The plugin's gate already hooks `git commit` |

### Option B: Do nothing

Each new commit-time check argues the split again in its own spec, as three specs already did.

### Option C: A git `pre-commit` hook, or the `pre-commit` framework

Rejected: it runs outside the session, cannot launch a workflow, `--no-verify` skips it, and each repo
would need its own wiring.

### Option D: A Claude Code `agent` or `prompt` hook that judges inside the hook

Rejected: one verdict per hook, so it cannot run a judge for each claim, validate each verdict
or keep a record for each claim.

### Option E: An outside tool, `or1can/claims`

Its judging check is advisory. Blocking on it from a hook of ours, or through a second agent, was weighed.
Rejected:

- It picks what to judge from names declared in Swift and Rust files only. None of the seven Analitiq
  repos tracks a file of either, so it would judge nothing.
- Blocking on a verdict needs a hook that refuses the commit, a check of each verdict and a record of it
  for the staged change. That is Option A. Only the judge's brief would be reused.
- A second agent that decides whether a finding blocks puts the refusal in a model's answer, not in a rule
  that can be tested.

## Trade-offs

- A checked commit costs extra tool calls: a workflow for each check it needs, and the refused commit
  when the commit is tried first.
- Commits that do not go through `git commit` as the Bash tool runs it are not seen: `git merge`,
  `cherry-pick`, `rebase --continue`, `am`, `commit-tree`, `bash -c` and git aliases. Nor is a commit made
  outside a Claude Code session, or one in a repo with no GitHub `origin`.
- The workflow depends on a hook rewriting `Workflow` input. The docs do not say a command hook may do
  this.
- The call to Jev is a network call on the hook path.

## Consequences

- Easier: a new commit-time check adds a commit rule, a launch handler and a workflow. The author meets the
  same steps each time: refused, run the named workflow, commit again.
- Harder: every such check inherits the blind spots above, and none can be closed from inside the session hook.
- **How we would know this was wrong:** commits that no check saw reach review more than rarely; or a hook
  reaches its timeout in normal use; or Claude Code stops letting a hook rewrite `Workflow` input.
- Revisit if: Claude Code offers a hook that can run a workflow and block on its result, or a way to gate
  commits made outside the Bash tool.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
