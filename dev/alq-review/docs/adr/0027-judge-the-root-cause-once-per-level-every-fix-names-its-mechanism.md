---
schemaVersion: 0.2.0
id: "0027"
title: "Judge the root cause once per level; every FIX names its mechanism"
status: draft
date: 2026-10-19
deciders: []
tags: [root-cause, assessment, policy, shim-check, reviewer-set]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0007", "0014", "0029"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{policy,briefs,assessment,shimcheck,jev}.py"
  - type: path
    pattern: "plugins/alq-review/agents/*.md"
  - type: path
    pattern: "plugins/alq-review/workflows/{review-round,shim-check}.js"
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
    label: "ALQ plugins target design: rewrite the decision records of alq-review, alq-plan and alq-build"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-plan/docs/adr/0009-spec-facts-as-front-matter-in-spec-md-spec-kit-s-stock-tasks-template.md"
    label: "alq-plan ADR-0009: Spec facts as front matter in spec.md; Spec Kit's stock tasks template"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-build/docs/adr/0002-have-the-build-skills-read-the-spec-from-the-spec-folder-they-are-given-never-fr.md"
    label: "alq-build ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment"
---

# ADR-0027: Judge the root cause once per level; every FIX names its mechanism

## Context

Today cause versus symptom is judged twice and binds no ruling: alq-build's root-cause-check reads
nothing from the round; the shim check guesses it beside the site coverage it measures
(ADR-0007). And a FIX may say "fix it" and leave the mechanism to the agent. alq-plan
ADR-0009's observed-cause fact now tells a round when a root-cause verdict is due.

## Decision

1. We will have the root-cause reviewer, alq-review's own agent, verify the spec's Root cause in
   every internal round whose spec says the cause was observed; otherwise the round records root_cause: not_applicable.
2. We will type its verdict (AT_CAUSE, AT_SYMPTOM, SPEC_WRONG, CANNOT_TELL), record it on the
   round, and rule in policy which rulings each verdict admits: SPEC_WRONG admits a spec-gap
   FIX or a PUSH_BACK citing a spec line; CANNOT_TELL admits ESCALATE or a PUSH_BACK naming where
   the mechanism was located; AT_SYMPTOM, when ruled FIX, admits PATCH, CLASS_FIX or
   REDESIGN with the mechanism named.
3. At the finding level, we will have every FIX ruling name the mechanism the fix must change, per
   finding or CLASS_FIX class; "fix it" alone is inadmissible. The agent's next step is derived
   from the ruling; the assessor's free-text next-step field is removed. A DEFER names an issue.
4. At the commit level, we will have the shim check rule complete or patch on site coverage alone.
5. We will retire alq-build's root-cause-check skill (alq-build ADR-0002).

## Options considered

### Option A: One cause per level, verified in the round (chosen)

Each level's cause is checked where it can be checked.

### Option B: The shim check compares the commit to the ruling

Rejected: it needs a commit-to-finding mapping.

### Option C: root-cause-check as an alq-build step before review (today)

Rejected: it reads nothing from the round.

### Option D: Map each verdict to one finding kind

Rejected: a verdict fixes a set of admissible rulings in policy, not one kind.

## Trade-offs

- Every internal round with an observed cause carries one more reviewer.
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
