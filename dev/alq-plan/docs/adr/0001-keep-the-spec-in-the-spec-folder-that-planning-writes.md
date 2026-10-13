---
schemaVersion: 0.1.0
id: "0001"
title: "Keep the spec in the spec folder that planning writes"
status: draft
date: 2026-10-09
deciders: []
tags: [spec, spec-folder, skills]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0004", "0005"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/**"
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
    label: "Decision 1, decided here again for alq-plan"
  - type: doc
    id: "alq-review ADR-0016"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-review/docs/adr/0016-tell-review-the-spec-at-each-round-launch-and-bind-it-to-the-pr.md"
    label: "Review is told the spec; the location comment goes"
---

# ADR-0001: Keep the spec in the spec folder that planning writes

## Context

Issue #63 moved planning out of alq-review into this plugin, alq-plan, which scopes an issue into a spec folder
(spec 019, Terms). alq-review's ADR-0008, decision 1, keeps the spec of a change in its spec folder. Spec 019
FR-023 has an existing record that binds a new plugin decided again in that plugin's log, not copied. This is that
record for alq-plan.

alq-plan writes the spec; the other two plugins read it. Review names the `spec.md` of the folder its caller gives at
launch, and its reviewers read it (alq-review's ADR-0016). `/alq-build:issue-tackle` takes the same folder, and `/alq-build:root-cause-check`
reads that `spec.md`'s `## Root cause` (spec 019, Key entities).

A change's spec had a second home: a marked comment on the issue. alq-review's ADR-0016 removed the location
comment, and since PR #75 nothing reads an issue comment for the spec: review is told the spec, and
`issue-tackle` reads no issue comment (FR-016).

Why now: PR #75, on main, gave planning its present shape inside alq-review. Research R16 gives alq-plan a log of
its own and has it land before the move into alq-plan. This record was written first, on the branch of PR #72. The
move (PR #76) merged into that branch, not into main, so the move and this record reach main together, in PR #72.

## Decision

We will keep the spec of a change in its spec folder. Planning writes it there and puts no copy of it on the issue.

## Options considered

### Option A: The spec folder is the one home (chosen)

| Dimension | Assessment |
|---|---|
| Where the spec is | In the repo, beside the plan and research of the same change |
| Places to read for one change | One |
| Needs a checkout to write the spec | Yes |
| Seen in a PR diff | Yes, a change to the spec is a reviewed change |
| Matches what review and build read | Yes, both read `spec.md` from the folder |

### Option B: Do nothing

alq-plan's log holds no record of where its spec lives, and each change to the planning skill decides it again.

### Option C: The spec in an issue comment

The home before alq-review's ADR-0008. Rejected there: two places to read for one change, with nothing keeping them
in step. Since alq-review's ADR-0016, no plugin reads it.

### Option D: Both, with one a copy of the other

Rejected in alq-review's ADR-0008: the copy drifts from the one it copies.

## Trade-offs

- A spec folder lives in a checkout. A spec cannot be written from anywhere with only `gh`.
- A scoped issue needs a pushed branch that holds its spec folder before anyone else can pick it up.
- Nothing on the issue says where its spec is. A spec folder's name need not carry the issue number (spec 019,
  Assumptions).
- The bot's issue picker and the `alq-claude-bot-assign` skill found the spec through the location comment, and no
  longer find one. Spec 019 leaves them out of scope.

## Consequences

- Easier: one place to read and to change the spec, and the change shows in a diff. Review and build need nothing
  from the issue to read it.
- Harder: whoever builds has to be told the folder and its branch. Planning's last message gives both (ADR-0005).
- **How we would know this was wrong:** a scoped issue that nobody can pick up because its spec is on a branch that
  was never pushed, or because nobody can find which folder holds it.
- Revisit if: specs have to be written for repos where no checkout exists at scoping time.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
