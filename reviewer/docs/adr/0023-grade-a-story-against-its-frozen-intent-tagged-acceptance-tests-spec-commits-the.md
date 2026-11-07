---
schemaVersion: 0.2.0
id: "0023"
title: "Grade a story against its frozen intent: tagged acceptance tests, spec commits, the intent brief and the spec delta"
status: accepted
date: 2026-11-07
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec, intent, review-round, claim-check, decision-review, ledger, tasks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0002", "0010", "0011", "0013", "0015", "0017", "0019", "0022"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,specbinding,claimcheck,briefs,assessment}.py"
  - type: path
    pattern: "reviewer/plugin/README.md"
  - type: path
    pattern: "core/src/contracts/snapshot.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  ratifiedBy: "@Analitiq-Bot-Wonka"
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/342"
review:
  tier: async
  decidedAt: 2026-11-07T18:00:00Z
externalRefs:
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0001-red-test-first.md"
    label: "org ADR-0001: Write the red test first"
---

# ADR-0023: Grade a story against its frozen intent: tagged acceptance tests, spec commits, the intent brief and the spec delta

## Context

Root ADR-0012 splits a spec folder into an intent tier the human owns and a design tier the story may change on
its branch. ADR-0010 d1 refused every spec-folder change but a tick, and ADR-0011 bound each round to the one
`spec.md` the story started from; both read the whole folder as the target. Once the story may change its design,
four things must hold or the risk root ADR-0011 named returns: no story commit may remove or edit what the human
asked for; every design change must be a commit the story names and claims, not a drift inside a code commit; a
design change that leaves part of the ask unmet must reach the human, not be ruled a fix the story makes itself;
and the admin who moves the card to Ready must see every change the story made to its spec. Each is a rule code
can decide or a ruling policy can fix, so each is reviewer's (constitution P1).

## Decision

1. We will fence the intent tier on a story branch (INTENT_FROZEN). A commit is refused when the diff of
   `spec.md` has a `-` line inside an intent section (root ADR-0012 d1), or any line change inside `## Non-goals`
   or `## Why this is worth doing`; the refusal names the section and the next legal step: ask the admin, who has
   planner change the intent by a spec PR (planner ADR-0010). Sections are read by `spec.md`'s `## ` headings, items
   by their ordinal in the section's list. A review-round or assess-round launch compares the intent sections at the
   reviewed commit with those at the branch's merge base, the ratification (root ADR-0012 d2): a removed or edited
   line refuses the launch with the diff, as a commit made outside the hooks is caught (ADR-0002 d4). OWN_BLOCK
   replaces TICK_ONLY (ADR-0010 d1): a `tasks.md` change on a story branch stays inside the task block labelled with
   the session's issue number (planner ADR-0008): a tick (`[ ]` to `[x]`) in it lands in any commit, an edit in it
   only in a `spec:` commit (d2); a change outside it is refused, a merged story's block as ADR-0015 d4 already
   refuses.
2. We will admit every design-tier change but a tick (d1), and every addition to an intent section, only in a **`spec:` commit**
   (SPEC_COMMIT): its subject starts with `spec:`; it changes only paths in the spec folder and in a folder
   `[shared] adr_folders` lists (ADR-0022 d1), never code or tests; its body carries the trailers `Motivated-by:
   <id>` and `Unaffected: <ids>` (`none` allowed), read by git's trailer parser (constitution P7). A design-tier
   change in any other commit, and a `spec:` commit missing a trailer or touching another path, is refused naming the
   rule. The claim check (README 6; ADR-0001) reads each id of `Unaffected:` as one claim of a judged category: the
   commit leaves what meets that item as it was, judged against the spec folder in the staged tree; `WRONG` refuses
   the commit and counts on the claim's lineage as any `WRONG` does. A record a `spec:` commit adds or supersedes is
   one `adr check` must pass (README 8); the merge of the story PR ratifies it (root ADR-0012 d3).
3. We will tie acceptance scenarios to tests (TAGGED_TEST). A test whose name carries an intent id (`US<k>-S<n>`,
   `EC<n>`) is tagged with that item. The commit gate refuses a story-branch commit that deletes a tagged test,
   removes the id from its name, or marks it skipped or expected-fail, while `spec.md` at the commit still has the
   item; a merged spec PR that removes the item frees its tests from the story's next merge of the default branch.
   A scenario or edge case with no tagged test at the reviewed commit is a finding, ruled FIX: write the test, red
   first (org ADR-0001). A change to a tagged test's body is reviewed by the round; a finding that the test no longer
   checks its item admits ESCALATE alone (d4).
4. We will brief the decision-reviewer, which joins every internal round (ADR-0019 d3), with the intent tier at
   ratification, the design delta from the merge base to the reviewed commit, and the records the branch added or
   superseded, beside the governing records it already reads. A finding that the delta leaves an intent item with no
   functional requirement, task or tagged test meeting it, or narrows what meets it, is of kind `intent_drift`
   (`assessment.KINDS`) and admits ESCALATE alone: the `escalation-<issue>` hold's question names the item's id and
   the commit (ADR-0013 d4), for the admin. A departure from a record admits FIX by changing the code, FIX by a
   `spec:` commit superseding the record (adrkit `supersedes`), or ESCALATE; never PUSH_BACK or DEFER (amends
   ADR-0017 d2, ADR-0022 d4). RESCOPE (ADR-0017 d2, ADR-0013 d5) is ruled when a finding shows the intent tier does
   not settle a decision the code must take: two items contradict, or a case no item covers; a `spec_gap` in the
   design tier is ruled FIX and its next step is a `spec:` commit.
5. We will record on every round (ADR-0011 d1; root ADR-0003's `Round` contract) a `spec_delta` since ratification:
   the merge base's `spec.md` blob; each `spec:` commit on the branch with its oid, subject, `Motivated-by`,
   `Unaffected` ids and their claim verdicts; each intent item added, by id; each record added or superseded, by
   corpus and id. The orchestrator writes it into the PR body its hooks own (orchestrator ADR-0009), at each hook
   run whose value changed, as a display of ledger state and not state of its own (orchestrator ADR-0003 d5), so the
   admin reads it before Ready. The orchestrator attests a PR that changes a `docs/adr/` folder or the design tier
   (orchestrator ADR-0004 d4); the check of ADR-0002 d4 fails a commit d1 or d3 would refuse, however it was made.

## Options considered

### Option A: Fence the intent, name and claim each design change, escalate drift, show the delta (chosen)

The gate decides what code can decide; the round rules what needs judgment, and policy fixes which ruling a
weakened intent admits. Every design change is one commit the admin reads.

### Option B: Refuse every spec-folder change but a tick (ADR-0010 d1, root ADR-0011)

Rejected by root ADR-0012: a story stops for a planning run on every design gap.

### Option C: Spec-only commits admitted by their paths alone (ADR-0010 Option B)

Rejected then because the graded agent could change the spec it is graded against; that still holds for the
intent tier, which d1 fences. For the design tier the paths are not enough either: d2 adds the claim, d4 the
brief, d5 the delta.

### Option D: Let the round alone judge every spec change, no gate

Rejected: a deleted scenario, a dropped test tag or a `spec.md` edit inside a code commit is decidable by code
(P1), and a judge asked after the fact grades a target already moved.

### Option E: Rule a weakened tagged test or a drifted design FIX

Rejected: the story would judge and repair its own weakening. The human owns the intent; a finding against it
reaches the human (P2).

## Trade-offs

- Three predicates read structure from the spec folder: headings and ordinals in `spec.md`, task blocks in
  `tasks.md`, trailers in a commit body.
- A tagged test's body can be weakened in place; the gate stops what it can and the round escalates the rest.
- Each `spec:` commit runs the claim check on its `Unaffected` ids; a story that amends its design often pays for it
  there.
- The `Round` contract grows a field; the ledger's folds and the orchestrator's PR body follow it.

## Consequences

- Easier: a story fixes its plan, a requirement or a record in one commit and the next round grades it.
- Harder: the gate's spec-folder rule is three predicates where it was one; the brief carries a delta.
- **How we would know this was wrong:** an intent line removed or edited on a merged story branch; a design-tier
  change merged outside a `spec:` commit; a scenario whose tagged test was dropped while it stood; a drifted
  design ruled FIX; an admin learning of a design change only after merge.
- Revisit if: the claim check cannot judge an `Unaffected` claim from the spec folder alone, or `intent_drift`
  findings are mostly ruled wrong by the admin.

## Action items

1. [ ] gate: INTENT_FROZEN, SPEC_COMMIT, TAGGED_TEST and OWN_BLOCK on the commit path; the launch's intent
   comparison replaces the `spec.md` blob binding (`specbinding.py`).
2. [ ] claim check: `Unaffected` ids as a judged claim category (`briefs.py`, `claimcheck.py`).
3. [ ] policy: `intent_drift` in `assessment.KINDS`, admitting ESCALATE alone; departure rulings per d4; RESCOPE per d4.
4. [ ] decision-reviewer brief: intent at ratification, design delta, records delta.
5. [ ] core: `spec_delta` on `Round`; orchestrator: the PR body section (orchestrator ADR-0004 d4's set shrunk).
6. [ ] README: What it enforces 5, 8 and 9 rewritten from this record once the code lands.
