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
---

# ADR-0010: Create one issue per story, chain them by blockedBy, and open the spec PR as a draft

## Context

Each user story is built on its own branch and PR, which closes its own story issue (org ADR-0003). The spec
and its records land first, by a spec PR on `<p>-spec`, `<p>` the spec's issue (org ADR-0002); no story
launches while that PR is open, nor before one merged (orchestrator ADR-0006).

## Decision

1. We will create, for a spec with several stories, one sub-issue per story `US<k>` under the spec's issue;
   a one-story spec's issue is its story issue. Each story issue is `blockedBy` the one before; a rescope
   adds stories the same way. A story issue's number never changes.
2. We will, when a rescope gives a one-story issue `#n` a second story, at the end of the run after the
   human approves: create parent `#p` with `#n`'s title and body, add `#n` under it, add the new story under
   `#p` blocked by `#n`, and open the rescope's spec PR on `<p>-spec`, renaming `specs/<n>-*` to
   `specs/<p>-*`. `#n` keeps its branch, PR and state.
3. We will label each story's task block in tasks.md with its story issue's number (ADR-0008).
4. We will push the spec folder and its decision records (ADR-0009), and no code, on `<p>-spec`, and open it
   as a draft PR: the spec PR.
5. We will place, on opening a rescope's spec PR, `rescope-<issue>` on each story issue under the spec that
   has a branch, through `core/` (root ADR-0003, reviewer ADR-0013). A story with no branch needs none.
6. We will leave the rest to a human: review, the exempt label as approval, ready, merge. Codex is
   requested once ready (orchestrator ADR-0008). No launch and no internal review round runs on a spec PR.

## Options considered

### Option A: A sub-issue per story, a blockedBy chain, a draft spec PR (chosen)

### Option B: One issue for all stories, order read from `tasks.md`

Rejected: a script computes order and the last story from ticks.

### Option C: A sub-issue even for a one-story spec

Rejected: a second issue tracking nothing the first does not.

### Option D: A second story added as a sub-issue of `#n`

Rejected: `#n` would become a parent, which is never launched, and strand its own branch and PR.

### Option E: planner opens the spec PR ready for review

Rejected: a non-draft create is the ready flip, which no session makes (reviewer ADR-0012).

## Trade-offs

- planner writes to GitHub: issues, their `blockedBy` links, holds and a draft PR.
- Moving `specs/<n>-*` breaks links to it by path.

## Consequences

- Easier: done is a closed issue and order a GitHub field; nothing computes either from `tasks.md`.
- Harder: reordering stories is a human edit of `blockedBy`.
- **How we would know this was wrong:** stories launched out of order, or story issues out of step with
  spec.md after a rescope.
- Revisit if: GitHub drops sub-issues or issue dependencies.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
