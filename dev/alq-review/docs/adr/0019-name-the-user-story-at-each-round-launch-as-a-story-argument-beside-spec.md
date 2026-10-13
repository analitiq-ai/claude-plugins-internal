---
schemaVersion: 0.1.0
id: "0019"
title: "Name the user story at each round launch as a story argument beside spec"
status: draft
date: 2026-10-13
deciders: []
tags: [spec, review-round, user-story, binding]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0016", "0017", "0018"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{specbinding,gate,briefs,policy}.py"
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
    label: "alq-review: the review launch names the user story in two arguments, spec and story"
---

# ADR-0019: Name the user story at each round launch as a story argument beside spec

## Context

The decisions in this record are the user's, recorded in issue #81 on 2026-10-12 and changed there on 2026-10-13.
The spec is `dev/alq-review/specs/81-review-names-the-story/`.

The organisation's git workflow (`analitiq-ai/engineering`, `docs/engineering/git-workflow.md`) has one PR per
user story of a spec.

ADR-0016, decisions 1, 4 and 5, name, bind and compare `spec`, a spec folder path or `null`. Each internal reviewer
is told to read the whole `spec.md` and report every requirement the change does not meet. ADR-0017, decision 2,
names no spec headings in the reviewer prompt. Under one PR per story, every other story's requirements become
findings against the PR, and the folder alone cannot say which story the PR delivers.

## Decision

1. We will have every review-round launch name its story in `story`, a JSON integer of 1 or more, beside `spec`.
   `story` is required when `spec` is a folder and absent when `spec` is `null`. A PR that is not a user story (a
   spec, ADR or retire PR, or a release branch) launches with `spec: null`. The caller gives both; review
   reads neither the branch name nor the PR body. This extends ADR-0016, decision 1. ADR-0016, decision 2 stands.
2. We will keep ADR-0016's checks of the folder, and refuse a launch whose `spec.md` at the checked commit has no
   line starting `### User Story <N>`, the number ending at a word boundary.
3. We will bind the PR at its first round to the folder, the story and the `spec.md` blob, and refuse a later
   launch whose `spec` or `story` differs. This extends ADR-0016, decisions 4 and 5. `story` is recorded only for
   a folder, so a binding to `null` keeps its shape. The gate does not handle a binding made before this change to
   a folder with no story: shipping this change requires that no open PR has one.
4. We will tell internal reviewers to read the whole `spec.md` and grade the change against that story's acceptance
   scenarios and every requirement, edge case and success criterion that applies to it, and to raise nothing that
   only another story delivers. Spec authors need not tag requirements by story. The assessor brief carries the story number
   beside the folder. This supersedes ADR-0017, decision 2.

ADR-0016, decision 6, and ADR-0018 stand: a story PR that edits `spec.md` is held until the user unlocks it.

## Options considered

### Option A: The caller names the story in its own argument (chosen)

| Dimension | Assessment |
|---|---|
| Where the story comes from | The launch's `story` argument |
| Checked against | The story heading in `spec.md` at the checked commit |
| Can change during the PR | No: the bound folder and story never change |
| Reviewers grade against | The story's scenarios and every requirement, edge case and success criterion that applies to it |

### Option B: One `spec` string, `<folder>/spec.md § User Story <N>`, checked against the PR header

The first draft of this record. Rejected by the user on 2026-10-13: the string needs a grammar of its own, and
the check against the PR body's `Implements:` line only proves that two copies the same caller writes agree.

### Option C: Read the story from the PR body

The gate would take the `Implements:` line as the story. Rejected: #70 wants rounds before a PR exists, and then
there is no body. The caller is the source that is there in both cases.

### Option D: Read the story from the branch name

`<issue>-us<N>-…` carries the number but not the folder. Rejected: the branch-name convention is owned by
`analitiq-ai/engineering`, and review would depend on it.

### Option E: Do nothing

Reviewers keep grading a story PR against every story of its spec.

## Trade-offs

- Every caller of review-round passes `story`: `alq-build:issue-tackle` and the engineering repo's
  `pr-review-loop.md`.
- No open PR may be bound to a folder with no story when this ships: before shipping, the ledger is checked for
  one. On 2026-10-13 one is open, #96 (`88-spec`, a spec PR launched with its folder), so the build waits for it
  to merge.
- The heading check is textual: a heading inside a fenced code block counts.
- Which requirements apply to the story is the reviewer's judgement: the spec need not tag them.
- With parallel stories, a spec edit merged from one story holds every other open story PR once it rebases: one
  unlock each. Accepted in #81.
- Nothing checks that the story a launch names is the one the PR's `Implements:` line names.

## Consequences

- Easier: a story PR is reviewed against its story.
- Harder: the caller has to know the story number before the first round.
- **How we would know this was wrong:** story PRs whose findings cite other stories, or PRs launched with a story
  other than the one they deliver.
- Revisit if: callers name the wrong story often enough that a check against the PR is worth its cost.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Build #81 against this ADR.
