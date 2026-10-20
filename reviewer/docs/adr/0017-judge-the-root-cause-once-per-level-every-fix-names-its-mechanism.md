---
schemaVersion: 0.2.0
id: "0017"
title: "Judge the root cause once per level; every FIX names its mechanism"
status: draft
date: 2026-10-20
deciders: []
tags: [root-cause, assessment, policy, shim-check, reviewer-set]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0004", "0008", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{policy,briefs,assessment,shimcheck,jev}.py"
  - type: path
    pattern: "reviewer/plugin/agents/*.md"
  - type: path
    pattern: "reviewer/plugin/workflows/{review-round,shim-check}.js"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/planner/docs/adr/0008-spec-facts-as-front-matter-in-spec-md-spec-kit-s-stock-tasks-template.md"
    label: "planner ADR-0008: Spec facts as front matter in spec.md; Spec Kit's stock tasks template"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/builder/docs/adr/0002-have-the-build-skills-derive-the-spec-folder-from-the-issue-number-never-from-an.md"
    label: "builder ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment"
---

# ADR-0017: Judge the root cause once per level; every FIX names its mechanism

## Context

Today cause versus symptom is judged twice and binds no ruling: builder's root-cause-check reads
nothing from the round; the shim check guesses it beside the site coverage it measures
(ADR-0004). And a FIX may say "fix it" and leave the mechanism to the agent. planner
ADR-0008's `codeworks.root_cause.observed` fact (`anchored`, `hypothesis` or `none`) tells a round when
a root-cause verdict is due.

## Decision

1. We will have the root-cause reviewer, reviewer's own agent, verify the spec's Root cause in
   every internal round whose spec's `codeworks.root_cause.observed` is `anchored` or `hypothesis`; with
   `none`, the round records root_cause: not_applicable.
2. We will type its verdict (AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL), record it on the
   round, and rule in policy which rulings each verdict admits: SPEC_WRONG admits a spec-gap
   FIX or a PUSH_BACK citing a spec line; CANNOT_TELL admits ESCALATE or a PUSH_BACK naming where
   the mechanism was located; AT_SYMPTOM, when ruled FIX, admits PATCH, CLASS_FIX or
   REDESIGN with the mechanism named.
3. At the finding level, we will have every FIX ruling name the mechanism the fix must change, per
   finding or CLASS_FIX class; "fix it" alone is inadmissible. The agent's next step is derived
   from the ruling; the assessor's free-text next-step field is removed. A DEFER names an issue.
4. At the commit level, we will have the shim check rule complete or patch on site coverage alone.
5. We will retire builder's root-cause-check skill (builder ADR-0002).

## Options considered

### Option A: One cause per level, verified in the round (chosen)

Each level's cause is checked where it can be checked.

### Option B: The shim check compares the commit to the ruling

Rejected: it needs a commit-to-finding mapping.

### Option C: root-cause-check as a builder step before review (today)

Rejected: it reads nothing from the round.

### Option D: Map each verdict to one finding kind

Rejected: a verdict fixes a set of admissible rulings in policy, not one kind.

### Option E: The root-cause reviewer only on an `anchored` cause

Rejected: a hypothesised cause is the one most in need of a check against the diff.

## Trade-offs

- Every internal round with an anchored or hypothesised cause carries one more reviewer.
- An assessor that cannot name a mechanism cannot rule FIX.
- A symptom patch with full site coverage passes the shim gate.

## Consequences

- Easier: one judge of cause versus symptom, where its verdict binds the rulings.
- Harder: policy carries an admissibility table; the round depends on the spec facts.
- **How we would know this was wrong:** shims still slip between a commit and the next round, the
  gap option B would close.
- Revisit if: that gap shows up.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
