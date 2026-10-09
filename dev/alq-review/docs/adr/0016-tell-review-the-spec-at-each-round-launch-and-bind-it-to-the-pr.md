---
schemaVersion: 0.1.0
id: "0016"
title: "Tell review the spec at each round launch and bind it to the PR"
status: draft
date: 2026-10-09
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec, review-round, ledger]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0002", "0008", "0009", "0012", "0019"]
affects:
  - type: path
    pattern: "plugins/alq-review/workflows/{review-round,assess-round}.js"
  - type: path
    pattern: "plugins/alq-review/scripts/{gate,briefs,ledger,speclocation,premise_report}.py"
  - type: path
    pattern: "plugins/alq-review/skills/{alq-spec,alq-issue-tackle,alq-root-cause-check}/SKILL.md"
  - type: path
    pattern: "plugins/alq-review/README.md"
  - type: path
    pattern: "dev/alq-review/tests/{test_gate,test_ledger,test_speclocation,test_spec_source,test_premise_report}.py"
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
    label: "Split the planning plugin out of alq-review"
---

# ADR-0016: Tell review the spec at each round launch and bind it to the PR

## Context

The decisions in this record are the user's, recorded on 2026-10-09 for issue #63. No plan exists yet.

Today review finds the spec of a change for itself:

- ADR-0008, decision 3: the issue names its spec folder in one comment, the location comment. The gate
  refuses when the comment is missing or names a folder that is not there.
- ADR-0012, decision 2: the gate takes the checkout from the session and everything else from git, the
  spec folders among them.
- ADR-0009, decision 4: an issue that says it has no spec is an answer, not a failed check.

ADR-0012 weighed the other way and rejected it, as its Option D: the session names the spec folder when it
launches the gate. The objection was that "the gate would take the word of the session it checks, and would
still have to test the folder against git."

Issue #63 splits planning out of alq-review (ADR-0019). The user decided that review is told the spec and
never finds it, and that the location comment goes.

ADR-0002, decision 3, allows no record outside the one store, the ledger, without an ADR that names it.

## Decision

1. We will have every review-round launch carry two values: `worktree` and `spec`.
2. We will take `spec` as a spec folder path from the repo root, or as `none: <reason>` with a reason that
   is not empty. This replaces the part of ADR-0009, decision 4, about an issue that says it has no spec:
   a change with no spec is now stated at launch as `none: <reason>`. The rest of that decision stands.
3. We will read the repo, the branch, the PR and the base from git and GitHub. They are never passed.
4. We will refuse a launch that has no `spec`, and show the full call in the refusal.
5. We will verify a spec folder against HEAD, in this order:
   1. the path is relative, has no `..`, and its parent is named `specs`;
   2. `<parent of specs>/.specify` is a folder in HEAD;
   3. `<folder>/spec.md` is in HEAD and is not empty.

   Any failure refuses the launch and names the step that failed. Nothing is searched for.
6. We will launch a `none` round with no spec, and show the reason.
7. We will record the `spec` value of a PR's first round in that PR's ledger. That record is the binding.
8. We will refuse a later launch on the same PR whose `spec` differs from the binding.
9. We will let nothing change a binding. There is no rebind command. The caller names the right spec.
10. We will have assess-round take the spec from the binding.
11. We will remove the location comment entirely. Nothing reads or writes it. A premise pick of "not worth
    doing" closes the issue as not planned, with the reason. A pick of "no spec needed" posts nothing.
12. We will keep no backwards compatibility with the location comment.

This replaces ADR-0008, decision 3, and the "spec folders among them" part of ADR-0012, decision 2.
ADR-0008, decision 1, stands: the spec lives in the spec folder. So does the part of ADR-0008, decision 2,
about what the gate hands to the internal reviewers and to the assessor. Its part about the skills that
shape and tackle an issue is left to ADR-0019 and the new plugins' logs.

## Options considered

### Option A: The session names the spec, the gate verifies it and binds it to the PR (chosen)

This is what ADR-0012 rejected as Option D. Its objection had two halves:

- "The gate would take the word of the session it checks." It does, on one point only: which spec folder
  is this change's spec. It takes that word once per PR. The first round binds the value in the ledger, and
  no later round can name a different spec.
- "It would still have to test the folder against git." It does, by design: three ordered steps against
  HEAD. A failure refuses and names the step. Nothing is searched for.

| Dimension | Assessment |
|---|---|
| Where the spec comes from | The launch |
| Searched for | Nothing |
| Tested against | HEAD, in three named steps |
| Can change during the PR | No |
| Record kept | One value in the PR's ledger, the store ADR-0002 allows |
| A change with no spec | `none: <reason>`, shown at launch |

### Option B: Do nothing

The issue keeps its location comment (ADR-0008, decision 3), and the gate keeps finding spec folders among
the branch's changed files (ADR-0012, decision 2). Rejected: the user decided that review is told the spec
and never finds it, and that the location comment goes.

## Trade-offs

- The caller has to know the spec folder at every launch.
- A wrong value on the first round is bound for the life of the PR. No command fixes it.
- The verification proves that the folder is a spec folder. It does not prove that it is this change's
  spec. The gate trusts the session for that.
- `none: <reason>` lets a session skip the spec with any reason that is not empty.

## Consequences

- Easier: review needs nothing from the issue or from the planning plugin to know its spec. Every round of
  a PR, and its assessment, reads the same spec.
- Harder: every caller of review-round passes `spec`. The skills, scripts and tests built on the location
  comment change together.
- **How we would know this was wrong:** PRs bound to the wrong spec with no way out; or rounds launched
  with `none` where a spec folder existed.
- Revisit if: a caller cannot know the spec folder when it launches a round.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Plan issue #63 against this ADR.
