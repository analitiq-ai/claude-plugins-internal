---
schemaVersion: 0.1.0
id: "0002"
title: "Stop a planning run when a check could not run and name the next step"
status: draft
date: 2026-10-09
deciders: []
tags: [failure-handling, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0006"]
affects:
  - type: path
    pattern: "plugins/alq-plan/scripts/*.py"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
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
    label: "Move planning (alq-spec) out of alq-review into its own plugin"
  - type: doc
    id: "alq-review ADR-0009"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0009-refuse-when-a-check-could-not-run-and-name-the-next-step.md"
    label: "Decided here again for alq-plan"
  - type: doc
    id: "alq-review ADR-0017"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0017-leave-the-spec-folder-s-contents-to-planning-review-reads-only-spec-md.md"
    label: "Planning checks its own output; review does not"
---

# ADR-0002: Stop a planning run when a check could not run and name the next step

## Context

alq-review's ADR-0009 decides, for review's gates, to refuse the call a check was deciding whenever that check could
not run. Spec 019 FR-023 has an existing record that binds a new plugin decided again in that plugin's log, not
copied, and research R16 names ADR-0009 as one alq-plan decides again. This is that record.

Planning has no hooks (R16). Its checks are steps of its Spec Kit workflow that run a script: the premise report,
the root cause, the premise answers, the rescope folder, the settled-design check (FR-020), and closing an issue
that is not worth doing (R5). A step that exits non-zero stops the run, and the planning skill shows the message and
stops. Those steps depend on things that can fail to answer: git, `gh` and GitHub, Spec Kit, the step's own script.
When one does not answer, the step has no verdict. The run still has to go on or stop.

alq-plan takes constitution principle P4 (R16): a check that could not run is reported as a failed check or a named
`cannot verify`, never as a pass, never as a finding against the author, and never as a guess. P4 does not say
whether the run goes on.

Review no longer checks the spec folder's contents. Planning checks its own output, and a spec folder that did not
pass planning's checks reaches review unchecked (alq-review's ADR-0017).

Why now: what this records already ships. PR #75 gave planning its present shape and PR #76 moved the code into
alq-plan before its log existed. This record writes the decision down for alq-plan (research R16).

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

alq-plan's log holds no rule, and each new check decides by which error looks cheaper.

### Option C: Let the run go on and report `cannot verify`

P4 allows it. Rejected: the run completes with a spec folder its check did not pass, and nothing after planning
checks the folder's contents (alq-review's ADR-0017).

## Trade-offs

- A dependency that is down stops a run for no fault of the spec.
- On `not worth doing`, a `gh` that fails stops the run, and the issue stays open until the step succeeds (R5).

## Consequences

- Easier: a new check does not choose. A reader of a stop can tell a failed check from a spec that failed it.
- Harder: every check's message has to say which of the two it is.
- **How we would know this was wrong:** runs stall on stops whose next step cannot succeed, or most stops of a
  check are failed checks and not findings.
- Revisit if: a check is proposed whose dependency cannot be made to answer from the session that runs planning.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back, and confirms that a premise pick is an answer.
