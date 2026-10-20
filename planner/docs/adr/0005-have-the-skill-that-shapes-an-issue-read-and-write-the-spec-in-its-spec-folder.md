---
schemaVersion: 0.2.0
id: "0005"
title: "Have the skill that shapes an issue read and write the spec in its spec folder"
status: draft
date: 2026-10-20
deciders: []
tags: [spec, spec-folder, skills, rescope]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0002", "0007", "0009"]
affects:
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/scripts/spec_folder.py"
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
    id: "org ADR-0002"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per issue, in the repo"
  - type: doc
    id: "org ADR-0003"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one PR per user story; only the last PR closes the issue"
  - type: doc
    id: "orchestrator ADR-0002"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md"
    label: "orchestrator ADR-0002: The orchestrator alone writes the working lanes, derived from the PR"
---

# ADR-0005: Have the skill that shapes an issue read and write the spec in its spec folder

## Context

The target design keeps one spec per issue on `<n>-us<k>` (org ADR-0002) and has an orchestrator that
launches on a Ready card. The branch's state already says whether a spec exists, so the skill needs no
`rescope` keyword, folder argument or in-place rewrite.

## Decision

1. We will have `/planner:issue-spec` write the spec into its spec folder and read no issue comment for it
   (ADR-0001).
2. We will take `#<n>` (or `untracked "<what>"`) as the only entry: a folder with `spec.md` on the issue
   branch means a rescope, from grill; otherwise a new spec, from premise.
3. We will refuse a rescope while the card is Ready, In progress or In review, naming the step "move the card
   to Backlog" (ADR-0002); a rescope may add stories and renumbers no frozen story (org ADR-0003).
4. We will commit and push the spec on the branch org ADR-0002 names; the run opens no PR and writes no
   lane (org ADR-0002, orchestrator ADR-0002); a completed run posts nothing on the issue, and ends with a message
   that gives the spec folder and the branch it is committed on, and names no command of another plugin.
5. We will have the human drive every approval at grill and at critique; the critique's verdict is advisory
   and no script reads it.

## Options considered

### Option A: `#<n>` only; state decides; the human approves every step (chosen)

Decisions 2–5.

### Option B: `rescope <spec folder> #<issue>`

Dropped at the brainstorm: the branch already says whether the folder exists.

### Option C: A rescope on a Ready card

Lost: the orchestrator may launch mid-rescope.

### Option D: Refuse approval on RETHINK unless `override`, its reason appended to the critique file

Proposed at the brainstorm. Lost: no script reads the verdict.

### Option E: planner writes Blocked when it needs the user (brainstorm)

Lost: no plugin writes a lane (orchestrator ADR-0002).

## Trade-offs

- A rescope on a Ready card costs two board moves.
- A RETHINK the human goes past leaves no recorded reason.

## Consequences

- Easier: one entry for new spec and rescope.
- Harder: the skill reads the board lane.
- **How we would know this was wrong:** a launch started under a rescope, or a rescope that rewrote the wrong
  folder.
- Revisit if: the orchestrator launches on a lane other than Ready, or planning is no longer human-driven.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
