---
schemaVersion: 0.1.0
id: "0002"
title: "Have the build skills read the spec from the spec folder they are given, never from an issue comment"
status: draft
date: 2026-10-09
deciders: []
tags: [spec, skills, issue-tackle, root-cause-check]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001"]
affects:
  - type: path
    pattern: "plugins/alq-build/skills/{issue-tackle,root-cause-check}/SKILL.md"
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
---

# ADR-0002: Have the build skills read the spec from the spec folder they are given, never from an issue comment

## Context

ADR-0001 keeps the spec of a change in its spec folder. This record decides how `alq-build`'s skills find
that folder. The decisions are the user's, settled on 2026-10-09 for issue #63 (spec 019, FR-015 to FR-018).

alq-review's ADR-0008, decision 2, has every part of that plugin read the spec from the spec folder, the
skills that tackle an issue among them. Its decision 3 has the issue name its spec folder in one comment,
the location comment, and before PR #75 that was how `alq-review:alq-issue-tackle` and
`alq-review:alq-root-cause-check` found the folder. Spec 019 decides this again for `alq-build` (FR-023) and
changes what it rests on:

- `issue-tackle` and `root-cause-check` moved to `alq-build` (FR-015). No plugin declares another as a
  dependency (FR-001), and no message of `issue-tackle` names a planning command (FR-016).
- The location comment is gone. Planning posts no comment on the issue; its last message gives the spec folder
  and the branch the spec is committed on (FR-019).
- Review is told the spec at each round launch, as a spec folder path from the repo root or `null` for a
  change with no spec (FR-005). `issue-tackle` launches that round.

Why now: PR #75, on main, put these decisions in place inside alq-review. Research R16 gives alq-build a log of its
own and has it land before the move of the two skills into alq-build. This record was written first, on the branch
of PR #72. The move (PR #76) merged into that branch, not into main, so the move and this record reach main
together, in PR #72.

## Decision

1. We will have `issue-tackle` take `spec` in the same form as review, a spec folder path from the repo root
   or `null`, and pass the same value to the review round.
2. We will have `issue-tackle`, given a spec folder, also take `branch`, work on that branch, and stop
   before writing code when `<spec>/spec.md` is missing or empty in that branch's HEAD. With `spec: null` it
   creates its own branch by the branch-naming rules.
3. We will have `root-cause-check` read the `## Root cause` section of `spec.md` in the spec folder it is
   given. A missing section gives CANNOT TELL. With `spec: null`, `issue-tackle` does not run the check.
4. We will have neither skill read any issue comment for the spec.

## Options considered

### Option A: The caller names the spec folder (chosen)

| Dimension | Assessment |
|---|---|
| Where the spec folder comes from | The `spec` argument, the same value review takes |
| Searched for | Nothing |
| Checked | `<spec>/spec.md` is in the branch's HEAD and not empty, before any code |
| A change with no spec | `spec: null`: no root-cause check |
| Needs another plugin installed | No |

### Option B: Return to reading the issue's location comment

The skills would again find the folder through the comment ADR-0008, decision 3, set up. Rejected: spec 019
removes the comment, and planning no longer posts one (FR-019), so there would be nothing to read.

Spec 019 weighed no other way for `alq-build` to learn its spec.

## Trade-offs

- The caller has to know the spec folder and its branch when it starts `issue-tackle`.
- The check proves that `spec.md` is there and not empty. It does not prove that it is this issue's spec.
  The skill trusts the caller for that.
- A caller can pass `spec: null` for a change that has a spec folder. The root-cause check then does not
  run.
- `root-cause-check` depends on the `## Root cause` heading that planning's template writes. If the template
  changes, every verdict is CANNOT TELL, which stops `issue-tackle`.
- Tools that start from an issue number and read the location comment, the bot's issue picker and the
  `alq-claude-bot-assign` skill, stop finding a spec. Spec 019 leaves them out of scope.

## Consequences

- Easier: `alq-build` needs nothing from the issue or from planning to know its spec, and `issue-tackle`
  hands review the same `spec` it was given.
- Harder: every caller of `issue-tackle` passes `spec`, and `branch` with a folder.
- **How we would know this was wrong:** callers that cannot name the spec folder when they start
  `issue-tackle`; or changes tackled with `spec: null` where a spec folder existed.
- Revisit if: a caller of `issue-tackle` cannot know the spec folder when it starts.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
