---
schemaVersion: 0.2.0
id: "0002"
title: "Have the build skills derive the spec folder from the issue number, never from an issue comment"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, spec-folder, skills, issue-tackle, root-cause-check, story, lanes]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0003", "0004"]
affects:
  - type: path
    pattern: "builder/plugin/skills/issue-tackle/**"
  - type: path
    pattern: "builder/plugin/skills/root-cause-check/**"
  - type: path
    pattern: "builder/plugin/.claude-plugin/plugin.json"
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
    label: "Move planning (issue-spec) out of reviewer into its own plugin"
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "Codeworks target design: rewrite the decision records of reviewer, planner and builder"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one issue, one branch and one PR per user story"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0001-drive-the-issue-loop-with-a-deterministic-orchestrator-outside-the-plugins.md"
    label: "orchestrator ADR-0001: Drive the issue loop with a deterministic orchestrator outside the plugins"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0017-judge-the-root-cause-once-per-level-every-fix-names-its-mechanism.md"
    label: "reviewer ADR-0017: Judge the root cause once per level; every FIX names its mechanism"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/planner/docs/adr/0008-spec-facts-as-front-matter-in-spec-md-spec-kit-s-stock-tasks-template.md"
    label: "planner ADR-0008: Spec facts as front matter in spec.md; Spec Kit's stock tasks template"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/planner/docs/adr/0010-create-one-issue-per-story-chain-them-by-blockedby-and-open-the-spec-pr-as-a-dra.md"
    label: "planner ADR-0010: Create one issue per story, chain them by blockedBy, and open the spec PR as a draft"
---

# ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment

## Context

This record decides how `builder` finds the spec folder (ADR-0001), the story and its branch. The caller is
a deterministic orchestrator (orchestrator ADR-0001), which computes no story order. Each story has its own
issue, branch and PR; a spec with several stories sits on a parent issue with one sub-issue per story
(org ADR-0003, planner ADR-0010).

## Decision

1. We will have `issue-tackle <s>` take the story issue number only, for the orchestrator and humans;
   `builder` declares `reviewer` as a dependency.
2. We will derive everything from `<s>`: the spec's issue `<p>` is `<s>`'s parent when it has one, else
   `<s>`; the spec folder is the one `specs/<p>-*/`; the requirement is its `spec.md`, or the issue body
   when its front matter's `codeworks.kind` is `no_spec` (planner ADR-0008); the story is the one `<s>`
   names (planner ADR-0010).
3. We will build each story on one branch, `<s>-us<k>-<slug>`, cut from the default branch at its first
   launch; the story's PR is the newest PR whose head is that branch.
4. We will stop, never plan, on no `specs/`, no `specs/<p>-*` or an inconsistent folder, with a message
   naming the state and any open PR.
5. We will never work on an issue in Backlog or Blocked: `issue-tackle` stops on one, building nothing and
   naming the lane.
6. We will have neither skill read any issue comment for the spec.
7. We will drop `root-cause-check` as a build step: the round's root-cause reviewer verifies the cause
   (reviewer ADR-0017).

## Options considered

### Option A: Everything from `<s>` (chosen)

See Decisions 1–3.

### Option B: `spec` and `branch` from the caller

Rejected: both follow from the story issue, and the orchestrator would compute what builder derives.

### Option C: The story read from `tasks.md`, the lowest with an unticked task

Rejected: the story is its issue, and order is the issues' `blockedBy` chain (planner ADR-0010).

### Option D: A planning command on a missing folder

Rejected: the skill stops with a message naming the state, never a planning command.

### Option E: `root-cause-check` as a build step

Rejected: the check reads nothing from the round; it becomes the round's root-cause reviewer.

## Trade-offs

- The skill repairs nothing; a missing or inconsistent folder costs a Blocked card and a human.
- `builder` depends on `reviewer`.
- Finding the spec costs one more API read, the issue's parent, and the lane one more.

## Consequences

- Easier: the orchestrator launches with the issue number alone.
- Harder: a story out of order needs a human to change its `blockedBy`.
- **How we would know this was wrong:** a caller that must pass more than `<s>`, or repeated Blocked
  moves for a missing or inconsistent folder.
- Revisit if: a spec needs two spec folders.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
