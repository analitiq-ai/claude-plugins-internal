---
schemaVersion: 0.1.0
id: "0008"
title: "Give an issue that needs no spec a spec folder that says so"
status: draft
date: 2026-10-12
deciders: []
tags: [premise, spec-folder, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0006", "0007", "0009"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/scripts/*.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: issue
    id: "79"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
    label: "alq-plan: name spec folders by their issue, land the spec through its own reviewed PR"
  - type: issue
    id: "82"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/82"
    label: "alq-build: issue-tackle builds one user story; the spec=null form goes"
  - type: doc
    id: "engineering ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "Every issue has exactly one spec; an issue without one has not been specified yet"
---

# ADR-0008: Give an issue that needs no spec a spec folder that says so

## Context

The premise step ends in one of three picks: `write the spec`, `no spec needed` or `not worth doing`. ADR-0006
closes a `not worth doing` issue and posts nothing for a `no spec needed` one, so that outcome lives only in the
session that picked it. ADR-0006 says to revisit this when something other than the user needs to know it.

Something now does. The organisation gives every issue one spec folder and treats an issue without one as not yet
specified (engineering ADR-0002, decision 1), and #79 has alq-plan refuse a second scope of an issue that has a
folder. A `no spec needed` issue with no folder is invisible to that refusal: it can be scoped again as if it had
never been judged. The user chose on 2026-10-12 to keep the outcome rather than drop it.

Why now: issue #79, part of #80.

## Decision

We will have a `no spec needed` pick write `specs/<issue>-<slug>/spec.md`, in the folder the run was given, saying
that no spec is needed and carrying the premise question the pick rests on and the reason. The folder holds nothing
else, and lands like a spec, through its own PR (ADR-0009).

ADR-0006, decision 2, stands for the issue: nothing is posted on it, and the user is still told to pass `spec: null`
when the work is reviewed. What changes is where the outcome lives: in the repo, not the session. ADR-0006,
decisions 1 and 3, stand.

## Options considered

### Option A: A folder whose `spec.md` says no spec is needed (chosen)

| Dimension | Assessment |
|---|---|
| Record of the pick | In the repo, named by its issue, beside the specs |
| Seen by the one-folder refusal | Yes |
| Writes to GitHub | A PR, like a spec |

### Option B: Keep ADR-0006 as it is

No record. A `no spec needed` issue can be scoped again, and under engineering ADR-0002 it counts as not yet
specified. Rejected: this is the gap.

### Option C: Drop `no spec needed`

Every issue that is built gets a full spec. Rejected by the user: a change whose request fixes the outcome has
nothing for a spec to decide.

### Option D: Record the pick on the issue

A label or a comment. Rejected: the refusal reads folders, not issues, and ADR-0006 already rejected a comment that
no plugin reads.

## Trade-offs

- A folder with no requirements sits beside real specs, and nothing refuses passing it to review or build as a spec.
- `no spec needed` now writes to the repo and opens a PR, where it wrote nothing before.
- Build and review are moving to user-story values: #82 drops build's `spec=null` form, and alq-review's launch
  value has its own sub-issue. A no-spec folder has no story, so what they take for such an issue's work is not
  decided here.

## Consequences

- Easier: every issue planning has seen, and not closed, has one folder, so a second scope is refused.
- Harder: a rescope of a no-spec folder starts at the premise, not at grill, since there is nothing to grill.
- **How we would know this was wrong:** no-spec folders passed to review or build as a spec; or no-spec folders
  deleted by hand so the issue can be scoped.
- Revisit if: build or review take only a user story, and so have no form for a no-spec issue's work.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
