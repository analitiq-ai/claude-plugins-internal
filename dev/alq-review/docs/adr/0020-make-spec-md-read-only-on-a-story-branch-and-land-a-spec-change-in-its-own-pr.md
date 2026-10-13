---
schemaVersion: 0.1.0
id: "0020"
title: "Make spec.md read-only on a story branch and land a spec change in its own PR"
status: draft
date: 2026-10-13
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec, review-round, holds, user-authority]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0005", "0016", "0018"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,briefs,ledger,policy,specbinding}.py"
  - type: path
    pattern: "plugins/alq-review/hooks/**"
  - type: path
    pattern: "plugins/alq-review/README.md"
  - type: path
    pattern: "plugins/alq-plan/skills/issue-spec/**"
  - type: path
    pattern: "dev/alq-review/tests/{test_gate,test_ledger,test_policy,test_specbinding}.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/104"
review:
  tier: async
externalRefs:
  - type: issue
    id: "104"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/104"
    label: "alq-review: spec.md is read-only on a story branch; a spec change lands in its own spec-only PR"
  - type: doc
    id: "spec-edits-during-a-story"
    url: "https://claude.ai/artifact/318JN3nQhSgcXqCuP18CdD"
    label: "Spec edits during a story: decision flow and evidence"
---

# ADR-0020: Make spec.md read-only on a story branch and land a spec change in its own PR

## Context

The decision in this record is the user's, recorded on 2026-10-13 for issue #104. No plan exists yet.

ADR-0016, decision 4, records the blob id of a PR's `spec.md` at its first round, and decision 6 holds the
PR when HEAD's `spec.md` has any other blob id, until the user's `unlock`. Its stated reason: every round
reads the same spec text, so a caller cannot move the target between rounds. Its cost, in its own
Trade-offs: any edit, a typo included, holds the PR.

The hold detects a moved target after the fact. The gate has to store and compare versions of `spec.md`,
and testing that no stale version is ever read did not converge (PR #102, five rounds). git-workflow.md
asks the story PR to update the spec, which the hold fights.

Evidence gathered for issue #104: coding agents edit the tests and graders that judge them, and telling
them not to barely helps. The mitigation that worked was a read-only grader plus a way to stop and ask a
human. No source recommends holding a change on every spec edit.

## Decision

1. We will make every `spec.md` in a `specs` folder read-only on a story branch, `<issue>-us<N>-<slug>`.
   The hook refuses an Edit or a Write of it and a Bash command that writes it. The commit gate (ADR-0005)
   refuses a commit whose staged tree changes it, which catches a write the hook missed.
2. We will have a session that finds the spec wrong stop and raise it to the user, as a `RESHAPE_SPEC`
   ruling does. ADR-0018 stands: `unlock <ref>` is the one release of that lock.
3. We will take a spec change only from its own PR, which changes the spec folder and nothing else and
   which the user approves. Both the first landing and a rescope run on the issue's spec branch,
   `<issue>-spec`, off main; the story branch rebases on main once it merges. Retiring a spec folder on
   `<issue>-retire-spec` is not a story branch and is unchanged.
4. We will refuse a review-round launch and the internal-review attestation on a PR whose diff against its
   base changes a `spec.md` and any file outside that spec folder.
5. We will grade every round, and its assessment, against `spec.md` at the commit the round reviews. The
   ledger keeps no blob id or text of it.

This replaces ADR-0016, decision 6, and the blob-id part of decision 4. ADR-0016's other decisions stand,
the binding of the `spec` value (decision 5) among them.

## Options considered

### Option A: read-only spec, spec-only PR (chosen)

| Dimension | Assessment |
|---|---|
| Who can change the spec during a story | The user, through a spec-only PR |
| What the gate stores | The `spec` value only |
| What a round grades against | `spec.md` at the reviewed commit |
| A typo fix | A spec-only PR |

### Option B: Do nothing

The gate keeps the bound blob id and holds every later edit until `unlock`. Rejected: it catches a
moved target only after the edit, every typo costs an unlock, and its tests chase every way git can read
an old version.

### Option C: Allow spec edits in the story PR and show the diff to the user before merge

What human-run teams do (Spec Kit, Google's code review guide). Rejected: the agent could still change
what grades it between rounds, which is the failure the evidence warns of.

## Trade-offs

- A typo fix in a spec needs its own PR.
- A story waits on the spec PR's merge and a rebase.
- The hook reads a Bash command to tell whether it writes `spec.md`, and cannot read every form; the commit
  gate catches what it misses, at commit time instead of at the write.
- Decision 1 turns on the branch name. A spec edit on a story branch named otherwise passes it; decision 4
  still refuses the PR when it also changes code.

## Consequences

- Easier: the agent cannot move its own target; the gate keeps no spec versions; a round grades what is
  in the commit it reviews.
- Harder: alq-plan's `issue-spec` rescope moves from the story branch to `<issue>-spec`. The engineering
  git-workflow's "update the spec in that same PR" becomes "spec PR first, then the story PR". The
  post-merge retirement of a spec folder needs no change.
- **How we would know this was wrong:** stories blocked for long on spec PRs, or spec PRs that only fix
  typos making up most spec PRs.
- Revisit if: either occurs.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Plan issue #104 against this ADR.
