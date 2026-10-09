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
relatesTo: ["0002", "0008", "0009", "0012", "0018"]
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
    label: "Move planning (alq-spec) out of alq-review into its own plugin"
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

Issue #63 moves planning out of alq-review. The user decided that review is told the spec and
never finds it, and that the location comment goes.

ADR-0002, decision 3, allows no record outside the one store, the ledger, without an ADR that names it.

## Decision

1. We will have every review-round launch name its spec in `spec`, beside the `worktree` that ADR-0012,
   decision 2, already takes.
2. We will take `spec` as a spec folder path from the repo root, or as `null` for a change with no spec.
   A launch with no `spec` key is refused. No reason is taken: whether a change needs a spec is planning's
   decision, and review only takes the answer. This replaces the part of ADR-0009, decision 4, about an
   issue that says it has no spec: the answer is now given at launch. The rest of that decision stands.
3. We will verify a named spec folder against HEAD and search for nothing: it is a spec folder by
   ADR-0012, decision 1, and its `spec.md` is in HEAD and not empty.
4. We will record, in a PR's ledger at its first round, the `spec` value and, for a spec folder, the git
   blob id of its `spec.md` in HEAD. That record is the binding, and it is what every round and assessment
   of the PR reads.
5. We will refuse a later launch on the same PR whose `spec` differs from the binding. The bound `spec`
   value never changes. There is no rebind command.
6. We will hold a PR whose `spec.md` in HEAD has a blob id other than the bound one, as a `RESHAPE_SPEC`
   ruling holds it. The refusal shows the diff from the bound text to HEAD's. The user's `unlock <ref>` is
   the one release, whether or not a ruling asked for the change; the next launch binds the blob id HEAD
   then has.

This replaces ADR-0008, decision 3, and the "spec folders among them" part of ADR-0012, decision 2. The
rest of ADR-0012, decision 2, stands: the repo, the branch, the PR and the base are read from git and
GitHub, never passed. ADR-0008, decision 1, stands: the spec lives in the spec folder. So does the part of
ADR-0008, decision 2, about what the gate hands to the internal reviewers and to the assessor. Its part
about the skills that shape and tackle an issue, and what planning does with an issue that needs no spec or
is not worth doing, are not decided here.

## Options considered

### Option A: The session names the spec, the gate verifies it and binds it to the PR (chosen)

This is what ADR-0012 rejected as Option D. Its objection had two halves:

- "The gate would take the word of the session it checks." It does, on one point only: which spec folder
  is this change's spec. It takes that word once per PR. The first round binds the value in the ledger, and
  no later round can name a different spec.
- "It would still have to test the folder against git." It does, by design: the folder's shape and its
  `spec.md` are checked in HEAD. A failure refuses and names what failed. Nothing is searched for.

| Dimension | Assessment |
|---|---|
| Where the spec comes from | The launch |
| Searched for | Nothing |
| Tested against | HEAD: a spec folder by ADR-0012's mark, with a `spec.md` that is not empty |
| Can change during the PR | The folder: no. Its `spec.md`: only by the user's `unlock`, shown the diff |
| Record kept | The `spec` value and the blob id of its `spec.md`, in the PR's ledger, the store ADR-0002 allows |
| A change with no spec | `spec: null` at launch |

### Option B: Do nothing

The issue keeps its location comment (ADR-0008, decision 3), and the gate keeps finding spec folders among
the branch's changed files (ADR-0012, decision 2). Rejected: the user decided that review is told the spec
and never finds it, and that the location comment goes.

## Trade-offs

- The caller has to know the spec folder at every launch.
- A wrong value on the first round is bound for the life of the PR. No command fixes it.
- Any edit to `spec.md` after the first round, a typo fix included, holds the PR until the user unlocks it.
- A session can edit `spec.md` and ask for the unlock. The user reading the diff is the only check on that.
- The verification proves that the folder is a spec folder. It does not prove that it is this change's
  spec. The gate trusts the session for that.
- A session can pass `spec: null` for a change that had a spec folder. Nothing in review checks that.

## Consequences

- Easier: review needs nothing from the issue to know its spec. Every round of a PR, and its assessment, reads the same spec text, so a session cannot move the target between rounds.
- Harder: every caller of review-round passes `spec`. The skills, scripts and tests built on the location
  comment change together.
- **How we would know this was wrong:** PRs bound to the wrong spec with no way out; rounds launched
  with `spec: null` where a spec folder existed; or `spec.md` holds unlocked without the diff being read.
- Revisit if: a caller cannot know the spec folder when it launches a round.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
2. [ ] Plan issue #63 against this ADR.
