---
schemaVersion: 0.1.0
id: "0019"
title: "Name the user story at each round launch and check it against the PR header"
status: draft
date: 2026-10-12
deciders: []
tags: [spec, review-round, user-story, binding]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0016", "0017", "0018"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{specbinding,gate,github,briefs,policy}.py"
  - type: path
    pattern: "plugins/alq-review/agents/assessor.md"
  - type: path
    pattern: "plugins/alq-review/workflows/review-round.js"
  - type: path
    pattern: "plugins/alq-review/README.md"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/81"
review:
  tier: async
externalRefs:
  - type: issue
    id: "81"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/81"
    label: "alq-review: the launch names the user story and the gate checks it against the PR header"
---

# ADR-0019: Name the user story at each round launch and check it against the PR header

## Context

The decisions in this record are the user's, recorded on 2026-10-12 in issue #81. The spec is
`dev/alq-review/specs/81-review-names-the-story/`.

The organisation's git workflow (`analitiq-ai/engineering`, `docs/engineering/git-workflow.md`) has one PR per
user story of a spec, and each story PR's body starts `Implements: <folder>/spec.md § User Story <N>`.

ADR-0016, decision 2, takes `spec` as a spec folder path or `null`. Each internal reviewer is told to read the
whole `spec.md` and report every requirement the change does not meet. ADR-0017, decision 2, names no spec
headings in the reviewer prompt. Under one PR per story, every other story's requirements become findings against
the PR, and the folder alone cannot say which story the PR delivers.

## Decision

1. We will take `spec` as `<folder>/spec.md § User Story <N>`, the notation of the PR header's `Implements:` line,
   or as `null` for a PR that is not a user story. The caller gives it; review reads neither the branch name nor
   the PR body for it. This supersedes ADR-0016, decision 2.
2. We will keep ADR-0016's checks of the folder, and refuse a launch whose `spec.md` at the checked commit has no
   line starting `### User Story <N>`, the number ending at a word boundary.
3. We will bind the PR at its first round to the whole value, and refuse a later launch with another, as ADR-0016,
   decisions 4 and 5, do for the folder. Every reader of the binding parses it with the function that parses
   `spec`. The gate does not handle a binding made before this change, to a bare folder: shipping this change
   requires that no open PR has one.
4. We will refuse a review-round launch whose PR body's first `Implements:` line names another folder or story
   than the value, is missing on a non-null value, or is present on `null`. A body `gh` cannot read is a check
   that could not run: refused in `enforce` mode, recorded as `would_deny` in `log` mode like every `spec` refusal,
   never recorded as a pass.
5. We will tell internal reviewers to grade the change against that story's section and the spec's exclusions,
   and to raise nothing about another story. The assessor brief carries the story number beside the folder. This
   supersedes ADR-0017, decision 2.

ADR-0016, decision 6, and ADR-0018 stand: a story PR that edits `spec.md` is held until the user unlocks it.

## Options considered

### Option A: The caller names the story, the gate checks it against the spec and the PR header (chosen)

| Dimension | Assessment |
|---|---|
| Where the story comes from | The launch |
| Checked against | `spec.md` at the checked commit (the heading) and the PR body (the `Implements:` line) |
| Can change during the PR | No: the bound value never changes |
| Reviewers read | One story's section and the spec's exclusions |

### Option B: Read the story from the PR body

The gate would take the `Implements:` line as the value. Rejected: #70 wants rounds before a PR exists, and then
there is no body. The caller is the source that is there in both cases.

### Option C: Read the story from the branch name

`<issue>-us<N>-…` carries the number but not the folder. Rejected: the branch-name convention is owned by
`analitiq-ai/engineering`, and review would depend on it.

### Option D: Do nothing

Reviewers keep grading a story PR against every story of its spec.

## Trade-offs

- Every caller of review-round changes its `spec` value: `alq-build:issue-tackle` and the engineering repo's
  `pr-review-loop.md`.
- No open PR may be bound to a bare folder when this ships; on 2026-10-12 the only such PRs, #77, #78 and #83,
  are merged.
- The heading check is textual: a heading inside a fenced code block counts.
- With parallel stories, a spec edit merged from one story holds every other open story PR once it rebases: one
  unlock each. Accepted in #81.
- The gate reads the PR body at every launch: one more `gh` call that can fail.

## Consequences

- Easier: a story PR is reviewed against its story, and a launch that names another story than the PR header is
  refused.
- Harder: the caller has to know the story number, and the PR header has to carry it before the first round.
- **How we would know this was wrong:** story PRs whose findings cite other stories; PRs refused because their
  header and the caller disagree with no way to settle it; or callers editing the PR body only to get past the
  check.
- Revisit if: rounds run before a PR exists (#70), where there is no header to check.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Build #81 against this ADR.
