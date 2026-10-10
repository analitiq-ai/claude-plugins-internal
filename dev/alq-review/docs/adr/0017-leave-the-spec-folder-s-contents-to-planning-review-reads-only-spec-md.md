---
schemaVersion: 0.1.0
id: "0017"
title: "Leave the spec folder's contents to planning; review reads only spec.md"
status: accepted
date: 2026-10-09
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec, spec-folder, settled-design, review-round, mode]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0011", "0012", "0016"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,hookio,briefs,settled_design}.py"
  - type: path
    pattern: "plugins/alq-review/workflows/review-round.js"
  - type: path
    pattern: "plugins/alq-review/{config.json,README.md}"
  - type: path
    pattern: "dev/alq-review/tests/{test_gate,test_settled_design}.py"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
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
---

# ADR-0017: Leave the spec folder's contents to planning; review reads only spec.md

## Context

The decisions in this record are the user's, recorded on 2026-10-09 for issue #63. No plan exists yet.

Today review checks the spec folder, not only the spec:

- ADR-0012, decision 4: a spec folder a branch changes must be settled before the first internal round.
  The settled-design check does this inside review.
- ADR-0012, decision 1: a spec folder is recognised by Spec Kit's `.specify/` mark.
- ADR-0012, decision 3: no list of design-document paths is kept. `plugins/alq-review/config.json` still
  holds that list, `design_documents`.
- The spec checks have their own setting, `spec_checks`, and their own refusal, `refuse_spec`. ADR-0011,
  Option A, names the brake for a new check: the user reads the log and sets that check to `log`.

Issue #63 moves planning out of alq-review. ADR-0016 tells review the spec folder at launch and
verifies it against HEAD. The user decided that the folder's contents are planning's to check, not review's.

## Decision

1. We will not have review validate the spec folder. Planning checks its own output; review reads only
   `spec.md`.
2. We will name no spec headings in the reviewer prompt.
3. We will give spec refusals no switch of their own. The plugin's `mode` governs them.

This reverses ADR-0012, decision 4. Review does not use ADR-0012, decision 1. ADR-0012, decision 3, is
carried out by deleting `design_documents`.

## Options considered

### Option A: Review reads only spec.md; planning checks the folder (chosen)

| Dimension | Assessment |
|---|---|
| What review reads | `spec.md`, whole |
| Who checks that the design is settled | Planning, on its own output |
| Headings review depends on | None |
| Settings for spec refusals | The plugin's `mode` only |
| A spec folder written without planning | Reaches review unchecked |

### Option B: Do nothing

Review keeps the settled-design check, its own `spec_checks` setting, and the design-document rule with
its `design_documents` list, which ADR-0012, decision 3, already says should not exist.

## Trade-offs

- A spec folder written without planning reaches review unchecked. The user accepted this loss.
- Spec refusals can no longer be set to `log` on their own. Only the plugin's `mode` switches them.

## Consequences

- Easier: review does not depend on the shape of planning's templates. The config has two fewer settings.
- Harder: a spec that is not settled is caught only if planning ran.
- **How we would know this was wrong:** review churn traced to a spec folder that did not go through
  planning; or the user needs to log spec refusals without switching the whole plugin.
- Revisit if: spec folders reach review often from outside planning.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [ ] Plan issue #63 against this ADR.
