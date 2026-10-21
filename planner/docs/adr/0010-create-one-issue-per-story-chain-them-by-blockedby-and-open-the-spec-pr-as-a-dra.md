---
schemaVersion: 0.2.0
id: "0010"
title: "Create one issue per story, chain them by blockedBy, and open the spec PR as a draft"
status: draft
date: 2026-10-20
deciders: []
tags: [sub-issue, story, blocked-by, spec-pr, draft-pr, rescope, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0008", "0009"]
affects:
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/scripts/*.py"
  - type: path
    pattern: "specs/**/tasks.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    id: "org ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
  - type: doc
    id: "org ADR-0003"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one issue, one branch and one PR per user story"
  - type: doc
    id: "orchestrator ADR-0006"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0006-launch-no-story-while-its-spec-s-issue-has-an-open-spec-pr-or-before-one-merged.md"
    label: "orchestrator ADR-0006: Launch no story while its spec's issue has an open spec PR, or before one merged"
  - type: doc
    id: "reviewer ADR-0012"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0012-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md"
    label: "reviewer ADR-0012: Refuse from any agent session every GitHub write the orchestrator or a human owns"
  - type: doc
    id: "reviewer ADR-0013"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0013-give-every-hold-one-id-and-a-human-release-a-changed-spec-releases-a-rescope-hol.md"
    label: "reviewer ADR-0013: Give every hold one id and a human release; a changed spec releases a rescope hold"
  - type: doc
    id: "orchestrator ADR-0005"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0005-exempt-a-pr-from-the-internal-review-by-its-bot-author-or-a-label-a-writer-appli.md"
    label: "orchestrator ADR-0005: Exempt a PR from the internal review by its Bot author or a label a writer applied"
  - type: doc
    id: "root ADR-0001"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/docs/adr/0001-keep-each-component-in-one-top-level-folder-with-one-spec-kit-project-at-the-roo.md"
    label: "root ADR-0001: Keep each component in one top-level folder, with one Spec Kit project at the root"
  - type: doc
    id: "root ADR-0005"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/docs/adr/0005-parse-a-story-s-identity-from-its-branch-in-core-alone.md"
    label: "root ADR-0005: Parse a story's identity from its branch in core/ alone"
  - type: doc
    id: "root ADR-0006"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/docs/adr/0006-keep-planning-and-building-in-disjoint-lanes-of-an-issue.md"
    label: "root ADR-0006: Keep planning and building in disjoint lanes of an issue"
  - type: doc
    id: "root ADR-0007"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/docs/adr/0007-act-on-github-from-every-agent-session-only-as-the-codeworks-session-app.md"
    label: "root ADR-0007: Act on GitHub from every agent session only as the codeworks-session App"
---

# ADR-0010: Create one issue per story, chain them by blockedBy, and open the spec PR as a draft

## Context

Each story has its own issue, branch and PR (org ADR-0003). The spec and its records land first, by a spec
PR on `<p>-spec`, `<p>` the spec's issue (org ADR-0002), which gates every launch (orchestrator ADR-0006).

## Decision

1. We will make each story a sub-issue of the spec's issue, `blockedBy` the one before, or, for a one-story
   spec, the spec's issue itself; a rescope adds stories alike. A story issue's number never changes and
   labels its task block (ADR-0008).
2. We will, when a rescope gives a one-story issue `#n` a second story, after the human approves: create
   parent `#p` with `#n`'s title and body, add under it `#n` and the new story blocked by `#n`, make `#p`
   the session's issue (ADR-0005), and rename `specs/<n>-*` to `specs/<p>-*`. `#n` keeps its branch and PR.
3. We will push the spec folder and its records (ADR-0009), and no code, to `<p>-spec`: to its open PR if
   there is one, else to a branch cut from the default branch and opened as a draft PR, the spec PR. A
   `<p>-spec` whose PR closed unmerged stops the run, naming the branch for a human to delete.
4. We will place the rescope hold (reviewer ADR-0013) on the story issues root ADR-0006 names when we open
   a rescope's spec PR, through the one `core/` writer a session may call (root ADR-0001).
5. We will name, in a rescope's spec PR description, each story issue whose task block it drops, for a
   human to close. A rescope that edits or drops a merged story's task block stops before it pushes.
6. We will write into the description of decision 2's spec PR the steps that undo its issue writes if a
   human closes it unmerged; the skill holds the steps.

## Options considered

### Option A: A sub-issue per story, a blockedBy chain, a draft spec PR (chosen)

### Option B: One issue for all stories, ordered by `tasks.md`

Rejected: a script computes order from ticks.

### Option C: planner opens the spec PR ready for review

Rejected: that is the ready flip, which no session makes (reviewer ADR-0012).

### Option D: planner closes dropped stories and undoes a rejected rescope

Rejected: closing an issue and releasing a hold are a human's acts (reviewer ADR-0012, ADR-0013).

## Trade-offs

- planner writes issues, links, holds and a draft PR, as the session App (root ADR-0007).
- Renaming `specs/<n>-*` breaks path links; a rejected spec PR leaves cleanup to a human.

## Consequences

- Easier: done (root ADR-0005) and order are GitHub fields, never read from `tasks.md`.
- Harder: reordering stories is a human edit of `blockedBy`.
- **How we would know this was wrong:** stories launched out of order, or story issues out of step with
  spec.md after a rescope.
- Revisit if: GitHub drops sub-issues or issue dependencies.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
