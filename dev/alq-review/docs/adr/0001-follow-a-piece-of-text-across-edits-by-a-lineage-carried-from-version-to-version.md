---
schemaVersion: 0.1.0
id: "0001"
title: "Follow a piece of text across edits by a lineage carried from version to version"
status: draft
date: 2026-10-06
deciders: []
tags: [claim-check, shim-check, holds]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{claimcheck,claimgate,shimcheck,shimgate,ledger}.py"
  - type: path
    pattern: "dev/alq-review/specs/{005-claim-check-gate,006-shim-check-gate}/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
review:
  tier: async
externalRefs:
  - type: issue
    id: "17"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
    label: "The full design (D1 to D9), the evidence and the rejected options"
---

# ADR-0001: Follow a piece of text across edits by a lineage carried from version to version

Draft for the user to ratify. Paths are relative to the repo root.

## Context

Two gates count failed rulings on a piece of text and stop for the user at a bound. The claim check counts
refusals of a hunk (`plugins/alq-review/scripts/claimcheck.py:333`). The shim check counts the patch checks of
one bug in a chain of code ranges (`plugins/alq-review/scripts/shimcheck.py:187`).

The bound is there to bring the user in when there is too much churn on one claim. Agents are meant to keep
reworking through review rounds until the PR's reviewers raise no more legitimate issues. So the count has to follow one claim
through its rewordings. Other work on the branch must not touch it. It must not lower except by the approved
entity's release, or when that churn ends: the claim is ruled `CORRECT` or is deleted.

The code today does not do this:

- The claim check keeps holds under the tree of `HEAD` (`plugins/alq-review/scripts/ledger.py:60`,
  `plugins/alq-review/scripts/claimgate.py:86`). After a commit that changes that tree, the same words staged
  again have no hold, and the next `WRONG` counts 1, with no `unlock` typed (issue #15). Spec 005 chose this in
  `dev/alq-review/specs/005-claim-check-gate/research.md` R8.
- The shim check looks chains up by branch and `HEAD` commit (`plugins/alq-review/scripts/shimgate.py:53`).
  `test_head_moving_leaves_the_chain_behind` (`dev/alq-review/tests/test_shim_gate.py:751`) commits an
  unrelated file between two patches of one bug and asserts that the chain at the new `HEAD` has count 1.
  Spec 006 chose this in `dev/alq-review/specs/006-shim-check-gate/research.md` R9.
- A hold is one count shared by the claims of a hunk, and a new file is one hunk. In
  `test_a_completed_wrong_check_counts_once_per_hunk` (`dev/alq-review/tests/test_claimcheck.py:310`), one
  check that rules two claims of one hunk `WRONG` gives one hold with one refusal. Three different claims in a new file, each ruled `WRONG`
  once in three checks, reach the bound of 3 (`plugins/alq-review/scripts/claimcheck.py:23`). The critique of
  spec 005 raised this as E1 (`dev/alq-review/specs/005-claim-check-gate/critiques/critique-20261002-060138.md`).

In the first two, a commit of other work starts a count again. Constitution P2 says of a hold: "Nothing else
may release the hold, lower it or start it again." In the third, the user is asked about a file when no one
claim reached the bound.

## Decision

Proposed. The same rule is to bind both gates (prose claims, and the shim check's code chains) and any later
gate that counts rulings on a piece of text.

1. **Identity is a lineage.** It will be minted at the first failed ruling of a piece of text and carried
   from version to version. It will not be recomputed from later words.
2. **A diff decides what descends from what.** Each check will diff the file as the previous check saw it
   against the file as staged now, blob against blob. Commits play no part: no count or lineage will be keyed
   on `HEAD` or a commit sha.
   - Text outside the changed ranges will keep its lineage, with its line shifted.
   - Inside a rewritten range, a character-offset mapping (`diff-match-patch`) will carry each sentence to its
     place in the new version, and the text found there will inherit the lineage. This covers one sentence
     split in two and two merged into one.
   - A claim whose words are unchanged but moved will be found by its existing claim id, which is a hash of
     the file and the words (`plugins/alq-review/scripts/claimcheck.py:42`).
3. **The count belongs to the lineage.** It will count the failed rulings in that lineage's chain of
   versions. Other changes on the branch will not change it. It will not lower except by the approved
   entity's release (P2) or the end of that churn.
4. **No model and no threshold.** A model will not decide whether two texts are the same claim. No
   text-similarity threshold will be used.

Known gap: text that is moved and reworded in one step will not be followed.

Threat model: the rule is to stop an agent stuck in a loop on one claim. It is not a defence against an agent
that deletes text and adds it back elsewhere on purpose.

Not in this record: the bound, the count after a merge, what a release covers, how the dependency is
installed, the shim check's touched mark, the module layout and the tests. They are to be set in the
amendments of specs 005 and 006; issue #17 lists them.

## Options considered

### Option A: A lineage minted at the first failed ruling, carried by a diff of blobs (proposed)

| Dimension | Assessment |
|---|---|
| Follows one claim through rewording | In place, with split and merge |
| Changed by other work on the branch | No |
| Existing tools | `git diff` of two blobs; `diff-match-patch` (Apache-2.0, pure Python) |
| Hand-rolled | Shifting a line past earlier hunks; locating a sentence's character span |
| Gap | Moved and reworded in one step |

Existing tools were surveyed on 2026-10-06 (summary in issue #17). No tool was found that follows a sentence
across versions with split, merge and move. The review tools that port comments (Gerrit, GitLab, Phabricator,
Sourcegraph) shift positions by hunks, and none of them maps a sentence inside an edited range. `git blame -M`
follows unchanged lines, and `git log -L` works on commits. The tools that pair reworded text (`prosediff`,
`mdiff`, `xmldiff`, LHDiff, BDiff) use a similarity threshold. Requirements tools (Doorstop, StrictDoc,
Sphinx-Needs) take identity from the author at edit time.

### Option B: Do nothing: hunk holds keyed on `HEAD` (today)

Rejected: a commit of other work starts the count again without the user, and one count is shared by the
claims of a hunk (see Context).

### Other options, rejected

| Option | Why rejected |
|---|---|
| C. Hunk holds carried across `HEAD` moves (the earlier draft of issue #17) | It still shares one count across the claims in a hunk. |
| D. One count per file | It trips on progress: several claims fixed in turn reach the bound though no one claim did. |
| E. One count per branch | The same as D, across the whole branch. |
| F. One count per line edited | It measures edits, not failed rulings, and gives the user nothing to decide on. Lines shift, so it needs the same mapping anyway. |
| G. Key by the claim's words | Different words give a different id (`plugins/alq-review/scripts/claimcheck.py:42`), so each rewording would start a new count. R8 of spec 005 rejected it for the same reason. |
| H. A model decides whether it is the same claim | Unreliable, and each answer can be argued. |
| I. Similarity matching for text that is moved and reworded | It needs a threshold nobody can justify. |
| J. Chains of commit shas | The rework is done on staged trees between commits: when the claim check enforces, the gate refuses the commit while a claim has a `WRONG` ruling the user has not released (`plugins/alq-review/scripts/claimcheck.py:270`). Amend, rebase and squash also rewrite commit shas. |

## Trade-offs

- One new dependency on the hook path, `diff-match-patch`.
- A small hand-rolled core (see Option A's table) that needs its own tests.
- The gap: an agent that moves and rewords a claim in one step gets a new count. This is outside the threat
  model above.
- Holds and chains already stored will not be migrated (issue #17).

## Consequences

- Easier: a commit of other work, an amend or a rebase will not change a count. The user will be asked about
  one claim. A later gate will reuse this rule instead of choosing its own key.
- Harder: specs 005 (FR-011, FR-017, R8, data-model Hold) and 006 (R9) record the reversed choices and are to
  be amended first, in their own PR (constitution VI). `test_head_moving_leaves_the_chain_behind` asserts the
  opposite and is to be rewritten.
- **How we would know this was wrong:** a hold that asks the user about a claim whose chain has fewer failed
  rulings than the bound; a count that changes after a commit of unrelated work; or users reporting claims
  that got past the bound by being moved and reworded in one step.
- Revisit if: `diff-match-patch` can no longer be used, or a tool appears that follows a sentence across
  versions without a threshold (constitution P5).

## Action items

1. [ ] The user ratifies this record, or sends it back.
2. [ ] Amend specs 005 and 006 to this rule, in their own PR, before the code.
3. [ ] Build it in the order of work of issue #17.
