---
schemaVersion: 0.1.0
id: "0006"
title: "Gate commits from the session hook and run each check as a workflow the refusal names"
status: draft
date: 2026-10-06
deciders: []
tags: [claim-check, shim-check, commit-gate, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/hooks/hooks.json"
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,claimgate,shimgate,jev}.py"
  - type: path
    pattern: "plugins/alq-review/workflows/**"
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
    label: "The batch of decisions already made, written as records"
---

# ADR-0006: Gate commits from the session hook and run each check as a workflow the refusal names

Draft for the ratifier. Paths are relative to the repo root. This record writes down a choice that specs 004,
005 and 006 each reasoned out and the code already follows.

## Context

A check of a commit needs agents: readers, one judge for each claim, sweepers. That work is slow. Spec 005 sets
its goal at "a commit adding up to 30 claims decided within 5 minutes"
(`dev/alq-review/specs/005-claim-check-gate/plan.md:33`).

The place that can refuse a commit is fast and narrow. Spec 005 R1 records what the Claude Code hooks guide says
of a command hook: one "that reaches its timeout is cancelled and, on most events, renders no decision, which is
why the slow work must not run inside the hook" (`dev/alq-review/specs/005-claim-check-gate/research.md:22`).

So the slow check and the fast refusal have to be two steps, and something has to carry the author from one to
the other. Three specs worked this out separately: spec 004 R7, spec 005 R1 and spec 006 R1.

What the code does today:

- One PreToolUse entry runs `scripts/gate.py` for Bash and Workflow calls, among others, with a timeout of 60
  seconds (`plugins/alq-review/hooks/hooks.json:5` and `:10`).
- For a commit, `gate.on_bash` asks `claimgate.on_commit` and then `shimgate.on_commit`, and the first refusal
  stands (`plugins/alq-review/scripts/gate.py:287`).
- Each `on_commit` reads git and the ledger and applies a rule. It does not run the check
  (`plugins/alq-review/scripts/claimgate.py:81`, `plugins/alq-review/scripts/shimgate.py:39`).
- The refusal for a tree that has not been checked carries the call to make: "Next step: {call}, then commit
  again" (`plugins/alq-review/scripts/claimcheck.py:266`, `plugins/alq-review/scripts/shimcheck.py:264`). The
  call is a `Workflow(...)` line (`claimcheck.py:24`, `shimcheck.py:16`).
- The launch of that workflow goes through the same hook: `gate.on_workflow` hands it to `claimgate.on_launch`
  or `shimgate.on_launch` (`plugins/alq-review/scripts/gate.py:369`).

## Decision

A check of a commit has three parts, and each later commit-time check takes the same shape.

1. **The session hook refuses.** The plugin's PreToolUse hook sees `git commit` as the Bash tool is about to run
   it. It decides from recorded state: git and the ledger. It does no slow work.
2. **A workflow checks.** The check is a Claude Workflow. The workflow only orders the work. The gate supplies
   its prompts and schemas at launch, and a hook validates each answer before it is recorded (spec 005 R4 and
   R6, `dev/alq-review/specs/005-claim-check-gate/research.md:70` and `:98`).
3. **The refusal names the workflow.** A refused author is told the exact call to make, then commits again. This
   is the reason for one entry point, in spec 005 R1: "one place that parses `git commit`, one refusal format
   that names the next step" (`dev/alq-review/specs/005-claim-check-gate/research.md:16`).

**Recorded exception: Jev runs inside the hook.** The shim check's classifier is called from the launch hook,
and from the hooks that record the last sweep output and the last site ruling. It is not called from the
workflow. Spec 006 R6 gives the reasons: "One Jev call is about a second, so it fits in the launch hook", and
calling from the recording hook "means the verdict exists before the author tries to commit, and the commit hook
stays a ledger read" (`dev/alq-review/specs/006-shim-check-gate/research.md:135`). The exception is bounded in
code. Each of those hooks gives Jev 40 seconds (`plugins/alq-review/scripts/shimgate.py:22`, `:144`, `:404` and
`:431`). `jev.ask` makes no call once that deadline has passed, and before it uses a socket timeout of at most
the time left (`plugins/alq-review/scripts/jev.py:51`). A Jev error at launch ends the check as `failed`
(`plugins/alq-review/scripts/shimgate.py:210`).

**Accepted blind spots.** The specs record these as limits, and this record accepts them:

- "Commits that do not go through `git commit` as the Bash tool runs it are not intercepted: `git merge`,
  `cherry-pick`, `rebase --continue`, `am`, `commit-tree`, `bash -c '...'` and git aliases"
  (`dev/alq-review/specs/005-claim-check-gate/research.md:201`).
- A commit made outside a Claude Code session is not seen. Spec 004 R7 names this as what a git hook would
  cover (`dev/alq-review/specs/004-spec-folder-checks/research.md:147`).
- A checkout that `worktree.locate` does not recognise is let through (`claimgate.py:83`, `shimgate.py:41`).
  Spec 005 says this means repos without a GitHub `origin` (`research.md:203` of that folder).

**Not in this record:** what the commit command may contain (record 0005), and what a gate does when a check
could not run.

## Options considered

### Option A: Refuse in the session hook, check in a workflow, name the workflow in the refusal (chosen)

| Dimension | Assessment |
|---|---|
| Can refuse a commit | Yes, before the Bash tool runs it |
| Can run many agents | Yes, in the workflow |
| Wiring for each repo | None: the plugin's `hooks.json` covers the repos it runs in |
| Existing tools | The plugin's own gate and `shell.classify`: "fits, already hooks `git commit`" (spec 005 R1) |
| Gap | The blind spots above |

### Option B: A git `pre-commit` hook, or the `pre-commit` framework

Three specs looked at it and none took it. Spec 005 R1: "does not fit; it runs outside the session, cannot launch a Claude Workflow,
and `--no-verify` skips it" (`dev/alq-review/specs/005-claim-check-gate/research.md:25`). Spec 006 R1 says the
same (`dev/alq-review/specs/006-shim-check-gate/research.md:20`). Spec 004 R7 grants what it would add: "Exact,
and it covers commits made outside a session, but two repos need their own wiring and `--no-verify` skips it"
(`dev/alq-review/specs/004-spec-folder-checks/research.md:147`). A hook set once at user level does not reach
every repo either: two checkouts "already set their own `core.hooksPath`, which overrides a global one"
(`research.md:139` of that folder).

### Option C: A Claude Code `agent` or `prompt` hook that judges in the hook

Rejected in spec 005 R1: it "is documented with a 60 s default timeout and 50 tool turns, one verdict per hook;
it cannot fan out one judge per claim, validate each verdict, or keep a per-claim record"
(`dev/alq-review/specs/005-claim-check-gate/research.md:26`).

### Option D: Run the whole check inside the command hook

Rejected for the reason in Context: a hook that reaches its timeout renders no decision.

### Option E: An outside tool, `or1can/claims`

Rejected in spec 005 R1: "its judgment-agent check is listed as advisory", so "It cannot block on a judged
claim" (`dev/alq-review/specs/005-claim-check-gate/research.md:29`).

### Option F: Do nothing: no gate on the commit, check at the review round only

Spec 004 R7 proposed the round launch for its own checks
(`dev/alq-review/specs/004-spec-folder-checks/research.md:142`). Specs 005 and 006 require the commit itself to
be refused (FR-001 of each). No reason is recorded in their research for not using the round launch.

## Trade-offs

- A commit costs at least two more tool calls: the refused commit, and the workflow.
- The blind spots are real. A commit made with `bash -c` or outside a session is not checked, and nothing
  reports it.
- The workflow depends on the hook rewriting its input. Spec 005 R4 says: "The docs do not say whether a command
  hook may rewrite `Workflow` input; the plugin already relies on it"
  (`dev/alq-review/specs/005-claim-check-gate/research.md:77`).
- The Jev exception puts a network call on the hook path, held to a time budget below the hook's own.

## Consequences

- Easier: a new commit-time check adds one `on_commit`, one launch handler and one workflow, and the author
  meets the same refuse, run, commit-again steps. `test_a_hunk_with_no_label_names_the_claim_check`
  (`dev/alq-review/tests/test_shim_gate.py:118`) asserts that a refused commit with an unlabelled hunk names
  `alq-review:claim-check`.
- Harder: every such check inherits the blind spots, and none can be closed from inside the session hook.
- **How we would know this was wrong:** commits reach review that no check saw, and they trace to a blind spot
  above more than rarely; or a hook reaches its timeout in normal use; or Claude Code stops letting a hook
  rewrite `Workflow` input.
- Revisit if: Claude Code offers a hook that can run a workflow and block on its result, or a way to gate
  commits made outside the Bash tool.

## Action items

1. [ ] The ratifier accepts this record, or sends it back.
2. [ ] A new commit-time check follows the three parts of the Decision, and any model call it makes inside a hook
   is added here as a named exception with its time budget.
