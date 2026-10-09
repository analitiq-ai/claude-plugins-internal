---
schemaVersion: 0.1.0
id: "0019"
title: "Split alq-review into three plugins that need none of the others"
status: draft
date: 2026-10-09
deciders: ["@Analitiq-Bot-Wonka"]
tags: [plugins, layout, skills, spec]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0016", "0017", "0018"]
affects:
  - type: path
    pattern: "plugins/alq-review/.claude-plugin/plugin.json"
  - type: path
    pattern: "plugins/alq-review/skills/{alq-spec,alq-issue-tackle,alq-root-cause-check}/**"
  - type: path
    pattern: "plugins/alq-review/speckit/**"
  - type: path
    pattern: "plugins/alq-review/scripts/{speclocation,premise_report,rootcause,settled_design}.py"
  - type: path
    pattern: "plugins/alq-review/README.md"
  - type: path
    pattern: "dev/alq-review/.specify/**"
  - type: path
    pattern: "dev/alq-review/tests/{test_premise_report,test_rootcause,test_settled_design,test_plan_template,test_critique_report}.py"
  - type: path
    pattern: "dev/alq-review/docs/adr/**"
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
    label: "Split the planning plugin out of alq-review"
---

# ADR-0019: Split alq-review into three plugins that need none of the others

## Context

The decisions in this record are the user's, recorded on 2026-10-09 for issue #63. No plan exists yet.

alq-review holds three kinds of work in one plugin:

- review: the gate, the review and assessment rounds, and the commit and merge checks;
- planning: the `alq-spec` skill, with its Spec Kit workflow and preset;
- building: the `alq-issue-tackle` and `alq-root-cause-check` skills.

One Spec Kit project, `dev/alq-review/`, holds one constitution and one ADR log for all three.

Review finds the spec of a change through the issue's location comment (ADR-0008, decision 3), and checks
the contents of the spec folder with the settled-design check (ADR-0012, decision 4). ADR-0016 removes the
location comment: review is told the spec folder at launch and checks only its shape against HEAD.
ADR-0017 takes the check of the folder's contents out of review. ADR-0018 takes the planning rescope out of
review's lock.

## Decision

1. We will split alq-review into three plugins:
   - alq-review: review;
   - alq-plan: planning, `/alq-plan:issue-spec`;
   - alq-build: `/alq-build:issue-tackle` and `/alq-build:root-cause-check`.
2. We will have no plugin declare or need another.
3. We will give each plugin its own `dev/<plugin>/` Spec Kit project, constitution and ADR log.
4. We will decide again, in a new plugin's own log, an existing alq-review ADR that binds that plugin. It is
   not copied. Which records those are is not decided here.
5. We will keep no backwards compatibility with the old layout.

## Options considered

### Option A: Three plugins, none needing another (chosen)

| Dimension | Assessment |
|---|---|
| Plugins | alq-review, alq-plan, alq-build |
| Declared dependencies | None |
| Spec Kit project, constitution, ADR log | One per plugin |
| Existing ADRs that bind a new plugin | Decided again in its log |

### Option B: Do nothing

One plugin keeps review, planning and building, with one Spec Kit project, one constitution and one ADR
log. Rejected: none of the three can be installed or changed without the others.

## Trade-offs

- Some decisions have to be made a second time, in a new log.
- Three projects, three constitutions and three ADR logs to keep, where there was one.

## Consequences

- Easier: each plugin can be installed alone. A decision binds one plugin and lives in its log.
- Harder: a change that spans planning and review is a change to two plugins.
- **How we would know this was wrong:** a plugin that fails at run time because another is absent; or
  changes that keep having to land in two plugins at once.
- Revisit if: a plugin turns out to need another to install.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Plan issue #63 against this ADR.
3. [ ] Decide which existing alq-review ADRs bind alq-plan or alq-build, and decide each again in that
   plugin's log.
