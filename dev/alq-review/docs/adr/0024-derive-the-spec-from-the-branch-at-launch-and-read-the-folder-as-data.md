---
schemaVersion: 0.2.0
id: "0024"
title: "Derive the spec from the branch at each round's launch and read the folder as data"
status: draft
date: 2026-10-19
deciders: []
tags: [spec, spec-folder, review-round, branch-grammar, front-matter]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0008", "0009", "0012", "0016", "0017", "0020"]
affects:
  - type: path
    pattern: "plugins/alq-review/workflows/review-round.js"
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,briefs,specbinding,github,worktree}.py"
  - type: path
    pattern: "plugins/alq-review/README.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
review:
  tier: async
externalRefs:
  - type: issue
    id: "133"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
    label: "ALQ plugins target design: rewrite the decision records of alq-review, alq-plan and alq-build"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per issue, in the repo"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "org ADR-0003: Open one PR per user story; only the last PR closes the issue"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-plan/docs/adr/0009-spec-facts-as-front-matter-in-spec-md-spec-kit-s-stock-tasks-template.md"
    label: "alq-plan ADR-0009: Spec facts as front matter in spec.md; Spec Kit's stock tasks template"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0008-exempt-a-pr-from-the-internal-review-by-its-bot-author-or-a-label-a-writer-appli.md"
    label: "org ADR-0008: Exempt a PR from the internal review by its Bot author or a label a writer applied"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-plan/docs/adr/0005-have-the-skill-that-shapes-an-issue-read-and-write-the-spec-in-its-spec-folder.md"
    label: "alq-plan ADR-0005: Have the skill that shapes an issue read and write the spec in its spec folder"
  - type: doc
    url: "https://github.com/analitiq-ai/claude-plugins-internal/blob/main/dev/alq-build/docs/adr/0002-have-the-build-skills-read-the-spec-from-the-spec-folder-they-are-given-never-fr.md"
    label: "alq-build ADR-0002: Have the build skills derive the spec folder from the issue number, never from an issue comment"
---

# ADR-0024: Derive the spec from the branch at each round's launch and read the folder as data

## Context

Which spec governs a PR, and what review reads from it, was decided four times.

This supersedes ADR-0008 (decision 3: the issue names its spec folder in a comment), ADR-0012
(decisions 1 and 4: a spec folder is found by Spec Kit's mark and settled before round 1),
ADR-0016 (every launch names its `spec`, bound in the PR's ledger) and ADR-0017 (decision 1:
review reads only `spec.md`).

## Decision

1. We will take `review-round {worktree, stage}`, no `spec`: the review-round launch gate reads `<n>` from
   the branch name; on `<n>-us<k>` the spec is the one `specs/<n>-*/` folder at HEAD; on
   `<n>-adr-<slug>` none, and the decision-reviewer grades the record; any other branch is
   refused a round. alq-review stays the only parser of branch names; no issue comment, no list
   of spec or design-document paths. Every round derives the spec afresh and grades `spec.md` at
   the reviewed commit (ADR-0020); no value or blob id is recorded, no rebind exists.
2. We will read the folder as data and validate none of it (planning checks its own output):
   `spec.md` whole for reviewers and assessor, its `alq` keys for dispatch (alq-plan ADR-0009),
   and `tasks.md` ticks through next_story for LAST_STORY at attestation; never headings.

## Options considered

### Option A: Derived from `<n>` in the branch name; read by keys (chosen)

Keys survive a template change where headings do not.

### Option B: `spec` passed at the round's launch, bound in the ledger (ADR-0016)

Rejected: the branch already names the spec (redraw fix); `null` for a PR with no issue has no
case left.

### Option C: The issue names its folder in a comment (ADR-0008)

Rejected: nothing is parsed out of prose.

### Option D: Found by Spec Kit's mark, settled before round 1 (ADR-0012)

Rejected: the folder is named by the issue number, not found; review validates nothing of the
folder, and ADR-0017 had already reversed decision 4.

### Option E: Review reads only `spec.md` (ADR-0017)

Rejected: LAST_STORY is read from `tasks.md` at attestation.

## Trade-offs

- A PR from a branch outside the grammar never gets internal-review; a revert or release bump
  reaches main only as an exempt PR (org ADR-0008).
- A folder written outside planning reaches review unchecked, as ADR-0017 accepted.

## Consequences

- Easier: a review-round launch needs only the checkout and the stage.
- Harder: a third branch kind needs a grammar change.
- **How we would know this was wrong:** a review-round launch cannot find a story branch's spec; a round
  grades another issue's folder; a template change breaks a reader.
- Revisit if: an issue needs two spec folders (org ADR-0002).

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
