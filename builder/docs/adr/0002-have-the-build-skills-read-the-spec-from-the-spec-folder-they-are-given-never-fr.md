---
schemaVersion: 0.2.0
id: "0002"
title: "Have the build skills derive the spec folder from the issue number, never from an issue comment"
status: draft
date: 2026-10-19
deciders: []
tags: [spec, spec-folder, skills, issue-tackle, root-cause-check, story]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0003"]
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
    label: "org ADR-0003: Open one PR per user story; only the last PR closes the issue"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0001-drive-the-issue-loop-with-a-deterministic-orchestrator-outside-the-plugins.md"
    label: "orchestrator ADR-0001: Drive the issue loop with a deterministic orchestrator outside the plugins"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/reviewer/docs/adr/0027-judge-the-root-cause-once-per-level-every-fix-names-its-mechanism.md"
    label: "reviewer ADR-0027: Judge the root cause once per level; every FIX names its mechanism"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/planner/docs/adr/0009-spec-facts-as-front-matter-in-spec-md-spec-kit-s-stock-tasks-template.md"
    label: "planner ADR-0009: Spec facts as front matter in spec.md; Spec Kit's stock tasks template"
---

# ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment

## Context

This record decides how `builder` finds the spec folder (ADR-0001) and the story. The draft
(issue #63) had the caller pass `spec` and `branch` and had `issue-tackle` run `root-cause-check`; the
design (issue #133) drops both and makes `builder` depend on `reviewer`. The caller is now a
deterministic orchestrator (orchestrator ADR-0001), which computes no story order.

## Decision

1. We will have `issue-tackle <n>` take the issue number only, for the orchestrator and humans;
   `builder` declares `reviewer` as a dependency.
2. We will derive everything from `<n>`: the spec folder is the one `specs/<n>-*/` on the issue branch;
   the requirement is its `spec.md`, or the issue body when its front matter's `codeworks.kind` is `no_spec`
   (planner ADR-0009); the story is the open story PR's (never an `<n>-adr-*` PR), else the one `next_story` returns (org ADR-0003).
3. We will stop, never plan, on no `specs/`, no `specs/<n>-*` or an inconsistent folder, with a message naming the state and any open PR.
4. We will have neither skill read any issue comment for the spec.
5. We will drop `root-cause-check` as a build step: the round's root-cause reviewer verifies the cause
   (reviewer ADR-0027).

## Options considered

### Option A: Everything from `<n>` (chosen)

See Decisions 1–2.

### Option B: `spec` and `branch` from the caller (as drafted)

Rejected: the orchestrator computes no story order.

### Option C: A `us<N>` human override

Rejected: a priority change lives in the spec; a rescope renumbers.

### Option D: A planning command on a missing folder

Rejected (brainstorm): the skill stops with a message naming the state, never a planning command.

### Option E: `root-cause-check` as a build step (as drafted)

Rejected (Root cause, option D′): the check reads nothing from the round; it becomes the round's
root-cause reviewer.

## Trade-offs

- The skill repairs nothing; a missing or inconsistent folder costs a Blocked card and a human.
- `builder` now depends on `reviewer`.

## Consequences

- Easier: the orchestrator launches with the issue number alone.
- Harder: a story out of order needs a rescope first.
- **How we would know this was wrong:** a caller that must pass more than `<n>`, or repeated Blocked
  moves for a missing or inconsistent folder.
- Revisit if: an issue needs two spec folders, or a caller must launch a story other than the next.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
