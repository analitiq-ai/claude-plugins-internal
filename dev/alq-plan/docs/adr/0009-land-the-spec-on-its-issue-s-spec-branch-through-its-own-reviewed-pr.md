---
schemaVersion: 0.1.0
id: "0009"
title: "Land the spec on its issue's spec branch through its own reviewed PR"
status: draft
date: 2026-10-12
deciders: []
tags: [spec, branch, pull-request, review-round, rescope, user-story]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0005", "0007", "0008"]
affects:
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "plugins/alq-plan/speckit/workflows/**"
  - type: path
    pattern: "plugins/alq-plan/scripts/*.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
review:
  tier: async
externalRefs:
  - type: issue
    id: "79"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/79"
    label: "alq-plan: name spec folders by their issue, land the spec through its own reviewed PR"
  - type: doc
    id: "engineering ADR-0003"
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0003-one-pr-per-user-story.md"
    label: "One PR per user story; the spec lands first on <issue>-spec"
---

# ADR-0009: Land the spec on its issue's spec branch through its own reviewed PR

## Context

A completed run of `/alq-plan:issue-spec` stages the spec folder, commits it and pushes the checkout's branch. It
ends with the folder and the branch, posts nothing and names no other plugin's command (ADR-0005, decision 3). The
checkout is "the issue's worktree", created "per the repo's branch rules if there is none": the skill names no
branch, base or path. No PR is opened and no review is run, so a spec reaches code with no one having agreed it.

The organisation's git workflow (`analitiq-ai/engineering`, `docs/engineering/git-workflow.md`, ADR-0003) lands the
spec first, on branch `<issue>-spec` from the default branch, in worktree `.claude/worktrees/<issue>-spec`, through
its own PR whose body starts `Part of #<issue>`. Each user story of `spec.md` then becomes one branch
(`<issue>-us<N>-…`) and one PR (`Implements: <folder>/spec.md § User Story <N>`). Story numbers are frozen once a
story's branch exists, and a story added later takes the next free number. A spec that changes for a story changes
in that story's PR.

ADR-0005's rescope runs in "the issue's worktree on the branch of the PR bound to that spec folder". With one PR per
story, several PRs are bound to one folder.

Why now: issue #79, part of #80. The spec is `dev/alq-plan/specs/79-one-spec-per-issue/`.

## Decision

1. We will have a new scope create branch `<issue>-spec` from the default branch as `origin` has it, in worktree
   `.claude/worktrees/<issue>-spec`, and run there. A branch `<issue>-spec` that exists locally or on `origin`
   refuses the new scope, naming the rescope form.
2. We will have a completed new scope commit the spec folder, push the branch, open a draft PR into the default branch
   whose body starts `Part of #<issue>`, and run the review loops with `spec: null`: the skill launches
   `alq-review:review-round` first, then the GitHub review loop. This supersedes ADR-0005, decision 3, in what a
   completed run does. It still posts nothing on the issue.
3. We will have a rescope work in the worktree it is run from, the spec's or a story's, and commit and push the spec
   edit on that branch, so it lands in that PR. It creates no branch, worktree or PR, and runs no review of its own.
   This replaces ADR-0005's "the branch of the PR bound to that spec folder".
4. We will keep Spec Kit's story headings, `### User Story <N> - <title> (Priority: P<n>)`, and check them with one
   pure function whenever a run writes spec.md: each heading has that form and no number is used twice. On a
   rescope, every number not in spec.md before the run is greater than every number that was.

ADR-0005, decisions 1 and 2, stand: the skill reads and writes the spec in its spec folder, and a rescope takes the
folder and the issue. ADR-0001 stands: the spec is in the repo once it is committed on a pushed branch; it now also
has a PR.

## Options considered

### Option A: The skill opens the spec PR and launches its review (chosen)

| Dimension | Assessment |
|---|---|
| Branch, base, worktree | `<issue>-spec`, the default branch, `.claude/worktrees/<issue>-spec` |
| Second spec branch for an issue | Refused |
| End of a new scope | A draft PR, `Part of #<issue>`, reviewed with `spec: null` |
| Rescope | In the worktree it is run from; the edit lands in that PR |
| Story numbers | Checked on every write of spec.md; frozen on a rescope |

### Option B: Do nothing

The run ends on a pushed branch. Whoever builds opens the PR, or builds on the spec's branch, and the spec is never
reviewed as a spec.

### Option C: The skill opens the PR, and the user launches review

The skill would stop at the PR. Rejected: the issue has the skill run the review loops, and a spec PR left unreviewed
is the gap this record closes.

### Option D: A rescope opens a spec PR of its own

The edit would land on `<issue>-spec` again, apart from the story that needed it. Rejected: the organisation's rule
changes the spec in the PR of the story that needs the change, so the spec matches what was built.

## Trade-offs

- The skill needs alq-review installed to finish a new scope. Without it, the skill stops after the PR and says so.
- A rescope in a story's PR changes `spec.md`, which holds that PR in review until the user unlocks it (alq-review
  ADR-0016, decision 6). With several open stories, each one that rebases on the change is held once.
- The branch check sees the local repo and `origin`. A spec branch in a fork is not seen.
- Story numbers are checked against spec.md as the run found it. A rescope run from a branch whose spec.md is behind
  the default branch's can reuse a number another branch already took.

## Consequences

- Easier: a spec reaches code only through a PR that review has seen; branches and PR headers can name a story that
  keeps its number.
- Harder: a new scope ends with a PR and a review round, so it takes longer and writes to GitHub.
- **How we would know this was wrong:** spec PRs merged with no review round; two spec branches for one issue; or a
  story whose number changed after its branch existed.
- Revisit if: review rounds can run before a PR exists (#70), or the organisation lands specs another way.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
