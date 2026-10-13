---
schemaVersion: 0.1.0
id: "0021"
title: "Run the round with a notice for a matcher adrkit cannot evaluate here"
status: accepted
date: 2026-10-12
deciders: ["@Analitiq-Bot-Wonka"]
tags: [decisions, review-round, adrkit, notices]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0009", "0011"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{decisions,adrkit,gate}.py"
  - type: path
    pattern: "plugins/alq-review/README.md"
  - type: path
    pattern: "dev/alq-review/tests/{test_decisions,test_adrkit,test_gate}.py"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/88"
review:
  tier: async
externalRefs:
  - type: issue
    id: "88"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/88"
    label: "alq-review: check the PR diff against repo and org ADRs"
---

# ADR-0021: Run the round with a notice for a matcher adrkit cannot evaluate here

## Context

The decision in this record is the user's, recorded on 2026-10-12 for issue #88. Spec 020 plans the feature.

At an internal round's launch the gate asks `adr check`, once per corpus, which records govern the files the round
reviews (spec 020, FR-001). `adr check` evaluates one repo at a time and takes no repo identity. Two kinds of
matcher it cannot evaluate there: a `package` or `entity` matcher (`affects-unresolvable`), and a matcher qualified
with a repo (`affects-repo-not-applicable`), which it skips whichever repo the matcher names, the checked repo's own
included (run on 2026-10-12 with adrkit 0.20.0).

Org records apply to every repo in the organisation; a record for one repo lives in that repo's own corpus. A
repo-qualified matcher in any corpus is therefore one the check never evaluates.

ADR-0009 says a check that could not run refuses the launch and names the next step. The open question was whether a
matcher adrkit cannot evaluate is such a check, a finding, or nothing.

## Decision

We will run the round and carry a notice in its result for each such matcher, naming the record, its corpus, the
matcher and adrkit's message. The record reaches the decision reviewer only if adrkit lists it as governing by another
matcher. Nothing is refused for it.

## Options considered

### Option A: A notice (chosen)

| Dimension | Assessment |
|---|---|
| The round | Runs |
| The matcher | Named in the result, with adrkit's message |
| The record | Briefed only when another matcher governs |
| What the author of the record learns | That this matcher is never evaluated in a one-repo check |

### Option B: Refuse the launch

Every round over a change such a record could govern is refused, and no next step works: the matcher cannot be made
evaluable in a one-repo check, and the record is often not the PR author's to edit (the org corpus). Against ADR-0009,
which requires a next step that can succeed.

### Option C: Ignore the matcher

The record silently never governs while its author believes it does. A decision could be overturned in code without a
trace, which is the harm the feature exists to stop.

## Trade-offs

- A notice obliges nobody; a matcher that stays unevaluable is a notice on every round until the record changes.
- A record whose only matchers are of this kind never reaches the reviewer. Its author has to add a path matcher.

## Consequences

- Easier: no round is blocked by a matcher no round can evaluate.
- Harder: round results carry notices that have to be read.
- **How we would know this was wrong:** records whose only matchers are notices accumulate, and the decisions they
  carry are contradicted in code without a finding.
- Revisit if: adrkit's `check` gains a repo identity or resolves `package` and `entity` matchers, so that these
  matchers become evaluable and their failures become findings of the check.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [ ] Build spec 020 against this ADR (branch `88-us1-decision-review`).
