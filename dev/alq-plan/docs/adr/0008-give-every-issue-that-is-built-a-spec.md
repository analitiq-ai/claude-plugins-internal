---
schemaVersion: 0.1.0
id: "0008"
title: "Give every issue that is built a spec"
status: draft
date: 2026-10-12
deciders: []
tags: [premise, spec, issue, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0005", "0006", "0007"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/scripts/premise_report.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: issue
    id: "79"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
    label: "alq-plan: name spec folders by their issue, land the spec through its own reviewed PR"
  - type: doc
    id: "engineering ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "Every issue gets one spec; no code is written for an issue without one"
---

# ADR-0008: Give every issue that is built a spec

## Context

In the premise step the user picks one of three outcomes: `write the spec`, `no spec needed` or `not worth doing`.
ADR-0006, decision 1, closes a `not worth doing` issue as not planned, with the reason. Decision 2 posts nothing on a
`no spec needed` issue and tells the user to pass `spec: null` when the work is reviewed. That run completes with no
folder, so the issue is built with no spec and nothing records that it was judged.

The organisation's git workflow (`analitiq-ai/engineering`, ADR-0002) says every issue gets one spec, and no code is
written for an issue until it has one. Its PRs name the spec and the user story they deliver
(`Implements: <folder>/spec.md § User Story <N>`). A PR that is not a user story, the spec's own PR among them,
names none. So `spec: null` at review now means a PR that is not a user story, not a change that needs no spec
(#80).

A change with no issue cannot be scoped at all: `/alq-plan:issue-spec` takes `#<issue> [<dir>]` or
`rescope <spec folder> #<issue>`, and refuses anything else. ADR-0007 names every folder by an issue number, and the
organisation's branch rule puts the issue number in every branch name. A change with no issue has neither.

Why now: issue #79, part of #80. The spec is `dev/alq-plan/specs/79-one-spec-per-issue/`.

## Decision

1. We will have the premise offer two outcomes, `write the spec` and `not worth doing`. `no spec needed` is
   removed from the workflow's gate, from `premise_report.py` and from the skill, and is refused wherever a pick is
   read. This supersedes ADR-0006, decision 2.
2. We will leave `not worth doing` as ADR-0006, decision 1, has it: the issue is closed as not planned with the
   reason, and no folder is created.
3. We will add the form `untracked "<what changes>" [<dir>]` to `/alq-plan:issue-spec`. It first creates one issue
   for the change in the repo the checkout's `origin` names, with a title and body from the text and one of that
   repo's issue types, the text through a file. It then scopes that issue as `#<issue> [<dir>]` does, premise first.
   When GitHub refuses the issue, the skill stops and starts no run.

ADR-0006, decisions 1 and 3, stand. Its consequence that a `no spec needed` outcome lives only in the session that
picked it no longer arises. ADR-0002, decision 4, names `no spec needed` among the picks that are answers, not
failures; with this record, only `not worth doing` is.

## Options considered

### Option A: Two outcomes, and an issue first for a change with none (chosen)

| Dimension | Assessment |
|---|---|
| Outcomes | `write the spec`, `not worth doing` |
| An issue worth doing | Gets a spec |
| A change with no issue | Gets an issue, then is scoped like any other |
| Writes to GitHub | `not worth doing` closes the issue; `untracked` creates one |

### Option B: Do nothing

`no spec needed` lets an issue be built with no spec, against the organisation's rule. A change with no issue
cannot go through planning, and has no number for its folder or its branch.

### Option C: Keep `no spec needed`, and leave a folder that says so

A `spec.md` that says no spec is required would let the one-folder check of ADR-0007 see a judged issue. Rejected:
the organisation's rule has every issue that is built get a spec, and a folder with no spec in it could still be
passed to review as a spec.

## Trade-offs

- A small change pays for a spec: premise, specify, grill, plan, critique and tasks, and a PR of its own (ADR-0009).
- `untracked` creates an issue from text the user typed. When a later step fails, the issue stays, and the message
  names it.
- The issue type is picked from the types the repo offers, by the skill with the user.
- The premise's `needs-spec` question no longer supports a stop pick. This record does not decide whether it stays.

## Consequences

- Easier: every built change has an issue and a spec, so a branch, a PR header and a review launch can name both.
- Harder: there is no short path for a change the user judges too small for a spec, other than not building it.
- **How we would know this was wrong:** specs written only to get past the premise, with nothing decided in them; or
  `untracked` issues left open with no work on them.
- Revisit if: the organisation's rule allows an issue to be built without a spec.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
