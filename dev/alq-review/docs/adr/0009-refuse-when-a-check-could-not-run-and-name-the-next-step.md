---
schemaVersion: 0.1.0
id: "0009"
title: "Refuse when a check could not run and name the next step"
status: draft
date: 2026-10-06
deciders: []
tags: [failure-handling, gates]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,pre_merge_gate,sweeper_read,github,claimcheck,shimgate}.py"
  - type: path
    pattern: "dev/alq-review/.specify/memory/constitution.md"
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
---

# ADR-0009: Refuse when a check could not run and name the next step

## Context

A gate's check depends on things that can fail to answer: git, GitHub, a model, an agent, the gate's own
code. When one does not answer, the gate has no verdict. It still has to refuse the call or let it through.

Constitution P4 says how such an outcome is reported: as a failed check or a named `cannot verify`, "never
as a pass, never as a finding against the author, and never as a guess". It does not say whether the call is
blocked.

The gates settled that one by one, and not all the same way:

- The merge gate's docstring argues for refusing: "a false deny costs one command and a false allow
  costs a merge" (`plugins/alq-review/scripts/pre_merge_gate.py`).
- The watch on a held branch reports a checkout it cannot read and lets the command run.
- Spec 004 FR-021: "A check that fails to run MUST refuse the call it was deciding and log the error."
  Spec 014 research calls running a round without its spec "a silent downgrade".

No plan decided this. The user decided it on 2026-10-06, when asked which of these readings is the rule.
Why now: the answers differ from gate to gate, and no record binds the next check.

## Decision

1. We will refuse the call a check was deciding whenever that check could not run.
2. We will say in the refusal that the check failed, not the work.
3. We will name a next step in the refusal, and it will be one that can succeed (constitution P1).
4. We will not treat an answer as a failure. A branch with no issue or no spec is an answer. A judge's
   `UNSURE` is an answer: spec 005 FR-015 says a check whose verdicts all are `UNSURE` "has not failed".
5. We will apply the rule only where a call is being decided. A hook event that only records refuses nothing.

## Options considered

### Option A: One rule, refuse and name the next step (chosen)

| Dimension | Assessment |
|---|---|
| Unchecked change gets through | No, wherever a hook can still answer |
| Cost when a dependency is down | The calls that need it stop until it answers |
| A new check | Inherits the rule and argues nothing |

### Option B: Do nothing

Each gate keeps deciding by which error looks cheaper. The cases in Context stay different.

### Option C: Let the call through and report `cannot verify`

The held-branch watch does this, and P4 allows it. The user rejected it: the call goes through unchecked.

## Trade-offs

- A dependency that is down stops work for no fault of the author.
- The rule cannot reach a hook that the platform cancels or that crashes before it can print.

## Consequences

- Easier: a new check does not choose. A reader of a refusal can tell a failed check from failed work.
- Harder: the gates that let a call through today change behaviour.
- **How we would know this was wrong:** sessions stall on refusals whose next step cannot succeed, or the
  log shows that most refusals of a check are failed checks and not verdicts.
- Revisit if: the platform gives a hook a way to refuse on a timeout or a crash.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back, and confirms that `UNSURE` is an answer.
2. [ ] Bring the gates that let a call through into line, tracked in an issue.
3. [ ] Amend constitution P4 to say that the outcome refuses, in its own PR.
