---
schemaVersion: 0.1.0
id: "0006"
title: "Close an issue not worth doing and post nothing for one that needs no spec"
status: draft
date: 2026-10-09
deciders: []
tags: [premise, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0005", "0008"]
affects:
  - type: path
    pattern: "plugins/alq-plan/scripts/premise_report.py"
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
    id: "alq-review ADR-0016"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md"
    label: "Review takes spec: null at launch; leaves these two outcomes to planning"
---

# ADR-0006: Close an issue not worth doing and post nothing for one that needs no spec

## Context

Planning first asks whether an issue is worth a spec. In the premise step the user picks one of three outcomes:
`write the spec`, `no spec needed` or `not worth doing`.

Before PR #75, both stop picks posted the location comment on the issue, with the outcome and the reason from the
premise report (the `record` command of `premise_report.py`, removed in #75). The `#<issue> none <reason>` entry
form posted the same comment for an issue the user had already judged to need no spec. Review read that comment as
the answer that a change has no spec (alq-review's ADR-0009, decision 4).

alq-review's ADR-0016 removes the location comment. Review takes `spec: null` at launch for a change with no spec;
whether a change needs a spec is planning's decision, and review only takes the answer. It leaves what planning does
with these two outcomes undecided, and research R16 gives that to alq-plan's log. Spec 019 settles it (Clarifications;
FR-019). This is that record.

Why now: PR #75, on main, gave planning its present shape inside alq-review. Research R16 gives alq-plan a log of
its own and has it land before the move into alq-plan. This record was written first, on the branch of PR #72. The
move (PR #76) merged into that branch, not into main, so the move and this record reach main together, in PR #72.

## Decision

1. We will close an issue the user picks as `not worth doing` as not planned, with the premise report's reason as the
   closing comment: `gh issue close <issue> --reason "not planned" --comment "<reason>"`. An empty reason fails the
   step, and a failed `gh` fails the run (R5).
2. We will post nothing for an issue the user picks as `no spec needed`, and tell the user to pass `spec: null` when
   the work is reviewed.
3. We will have no `#<issue> none <reason>` entry form, which only posted the comment (R6). PR #75 removed it.

## Options considered

### Option A: Close as not planned; tell the user about `spec: null` (chosen)

| Dimension | Assessment |
|---|---|
| Record of `not worth doing` | GitHub's own: the issue closed as not planned, with the reason |
| Record of `no spec needed` | None on the issue; the user is told what to pass at review |
| Comment format to keep | None |
| Writes to GitHub | Only on `not worth doing` |

### Option B: Return to posting the location comment

Both stop picks would post the location comment again, as they did before PR #75. No plugin reads it, since review
takes `spec` at launch (alq-review's ADR-0016).

The spec weighed no other answer for these two outcomes.

## Trade-offs

- `no spec needed` leaves no trace on the issue. Whoever builds learns it from the user.
- Nothing checks that a change reviewed with `spec: null` was picked as `no spec needed` (alq-review's ADR-0016,
  Trade-offs).
- Closing an issue writes to GitHub from a workflow step. When `gh` fails, the run fails and the issue stays open
  (ADR-0002).

## Consequences

- Easier: a `not worth doing` issue leaves the open list with its reason. No comment format is kept for anything to
  parse.
- Harder: a `no spec needed` outcome lives only in the session that picked it.
- **How we would know this was wrong:** changes reviewed with `spec: null` whose issue planning never picked as
  `no spec needed`; or issues closed as not planned that are reopened and scoped.
- Revisit if: something other than the user needs to know that an issue needs no spec.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
