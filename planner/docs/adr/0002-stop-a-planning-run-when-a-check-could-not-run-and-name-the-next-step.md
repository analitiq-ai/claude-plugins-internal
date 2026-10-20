---
schemaVersion: 0.1.0
id: "0002"
title: "Stop a planning run when a check could not run and name the next step"
status: draft
date: 2026-10-20
deciders: []
tags: [failure-handling, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0006"]
affects:
  - type: path
    pattern: "planner/plugin/scripts/*.py"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
review:
  tier: async
externalRefs:
  - type: issue
    id: "63"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/63"
    label: "Move planning (issue-spec) out of reviewer into its own plugin"
  - type: doc
    id: "reviewer ADR-0005"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0005-refuse-when-a-check-could-not-run-and-name-the-next-step.md"
    label: "reviewer ADR-0005: Refuse when a check could not run and name the next step"
  - type: doc
    id: "reviewer ADR-0014"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0014-derive-the-spec-from-the-branch-at-each-round-s-launch-and-read-the-folder-as-da.md"
    label: "reviewer ADR-0014: Derive the spec from the branch at launch and read the folder as data"
---

# ADR-0002: Stop a planning run when a check could not run and name the next step

## Context

reviewer's ADR-0005 decides, for review's gates, to refuse the call a check was deciding whenever that check could
not run. This record decides the same question for planning.

Planning has no hooks (R16). Its checks are Spec Kit workflow steps that run a script: the premise report, the
root cause, the premise answers, the rescope folder, and the settled-design check (FR-020). A step that exits non-zero stops the run, and the planning skill shows the message. A step
depends on git, `gh` and GitHub, Spec Kit and its own script; when one does not answer, the step has no verdict,
and the run must go on or stop.

planner takes constitution principle P4 (R16): a check that could not run is reported as a failed check or a named
`cannot verify`, never as a pass, never as a finding against the author, and never as a guess. P4 does not say
whether the run goes on.

Review validates none of the spec folder. Planning checks its own output, and a spec folder that did not pass
planning's checks reaches review unchecked (reviewer ADR-0014).

## Decision

1. We will stop a planning run at the step whose check could not run. The run does not complete.
2. We will say in the message that the check failed, not the spec.
3. We will name a next step in the message, and it will be one that can succeed.
4. We will not treat an answer as a failure. A premise pick of `no spec needed` or `not worth doing` is an answer,
   and the run completes on it (ADR-0006).

## Options considered

### Option A: One rule, stop the run and name the next step (chosen)

| Dimension | Assessment |
|---|---|
| Unchecked spec folder completes a run | No |
| Cost when a dependency is down | Runs stop at the step that needs it until it answers |
| A new check | Inherits the rule and argues nothing |

### Option B: Do nothing

planner's log holds no rule, and each new check decides by which error looks cheaper.

### Option C: Let the run go on and report `cannot verify`

P4 allows it. Rejected: the run completes with a spec folder its check did not pass, and nothing after planning
checks the folder's contents (reviewer ADR-0014).

## Trade-offs

- A dependency that is down stops a run for no fault of the spec.

## Consequences

- Easier: a new check does not choose. A reader of a stop can tell a failed check from a spec that failed it.
- Harder: every check's message has to say which of the two it is.
- **How we would know this was wrong:** runs stall on stops whose next step cannot succeed, or most stops of a
  check are failed checks and not findings.
- Revisit if: a check is proposed whose dependency cannot be made to answer from the session that runs planning.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back, and confirms that a premise pick is an answer.
