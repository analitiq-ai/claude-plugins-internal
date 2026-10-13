---
schemaVersion: 0.1.0
id: "0005"
title: "Have the skill that shapes an issue read and write the spec in its spec folder"
status: draft
date: 2026-10-09
deciders: []
tags: [spec, spec-folder, skills, rescope]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0004", "0006", "0008", "0009"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
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
    label: "Move planning (alq-spec) out of alq-review into its own plugin"
  - type: doc
    id: "alq-review ADR-0008"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0008-keep-the-spec-in-the-spec-folder-not-in-an-issue-comment.md"
    label: "Decision 2, its part about the skill that shapes an issue, decided here again for alq-plan"
  - type: doc
    id: "alq-review ADR-0016"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md"
    label: "Leaves this part of ADR-0008, decision 2, undecided"
---

# ADR-0005: Have the skill that shapes an issue read and write the spec in its spec folder

## Context

alq-review's ADR-0008, decision 2, has every part of that plugin that reads the spec read it from the spec folder:
the skills that shape and tackle an issue, and what the gate hands to the reviewers and the assessor. alq-review's
ADR-0016 keeps the part about the gate and leaves the part about the skills undecided. Research R16 gives the part
about the skill that shapes an issue to alq-plan's log. This is that record.

The skill moved into alq-plan as `/alq-plan:issue-spec` (R2). Before PR #75, as `alq-spec`, it did more than write
the spec (read in its `SKILL.md` before #75):

- It posted a location comment on the issue that named the spec folder, and on `#<issue>` it first looked that
  comment up and stopped when the issue was already located.
- Its rescope took a PR or a branch, parsed review's reply to the release prompt for the ruling, and found the
  spec folder among the files the PR changed, asking the user when it found none or more than one.

alq-review's ADR-0016 removes the location comment: review is told the spec at launch. `/alq-build:issue-tackle` reads
no issue comment for the spec (FR-016). A RESHAPE_SPEC lock is released only by `unlock <ref>`, and the rescope
prompt no longer releases one (FR-013).

Why now: PR #75, on main, gave planning its present shape inside alq-review. Research R16 gives alq-plan a log of
its own and has it land before the move into alq-plan. This record was written first, on the branch of PR #72. The
move (PR #76) merged into that branch, not into main, so the move and this record reach main together, in PR #72.

## Decision

1. We will have `/alq-plan:issue-spec` write the spec into its spec folder and read no issue comment for it
   (ADR-0001).
2. We will have its rescope take the spec folder and the issue, both required:
   `rescope <spec folder> #<issue>`. It re-reads the issue's title and description, takes the open decision from the
   conversation, and rewrites that same folder in place. It does not read review's output or look the folder up
   (FR-021, R6).
3. We will have a completed run post nothing on the issue, and end with a message that gives the spec folder and the
   branch it is committed on, and names no command of another plugin (FR-019).

## Options considered

### Option A: The folder in, the folder out (chosen)

| Dimension | Assessment |
|---|---|
| Where the skill reads the spec | The spec folder |
| Where it writes the spec | The spec folder |
| What a rescope starts from | The folder named, and the issue as first stated |
| Reads review's output | No |
| How the builder learns the folder | The run's last message |

### Option B: Return to posting and reading the location comment

The skill would post and read the location comment again. Nothing else reads it, since review is told the spec
(alq-review's ADR-0016) and `issue-tackle` reads no issue comment (FR-016).

### Option C: Rescope finds the folder from the PR and the ruling from review's reply

The rescope before PR #75. Rejected: it ties planning to review's output and to the shape of its reply, and a lookup can find
no folder or more than one. The folder the PR is bound to is the one to rewrite, and the caller can name it.

## Trade-offs

- The user has to name the spec folder and the issue to rescope, and give the open decision in the conversation.
- Nothing on the issue says it was scoped. An issue can be scoped again, and more than one spec folder per issue is
  allowed (spec 019, Edge cases).

## Consequences

- Easier: the skill runs with nothing but alq-plan installed, and looks nothing up.
- Harder: whoever builds learns the folder and the branch from the run's last message, not from the issue.
- **How we would know this was wrong:** an issue scoped twice by mistake because nothing showed it had been; or a
  rescope that rewrote a folder other than the one the PR is bound to.
- Revisit if: a caller has to find an issue's spec from the issue alone.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
