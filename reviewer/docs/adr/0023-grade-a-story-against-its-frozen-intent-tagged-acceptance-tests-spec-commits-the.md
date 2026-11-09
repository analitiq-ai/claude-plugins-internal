---
schemaVersion: 0.2.0
id: "0023"
title: "Grade a story against its frozen intent: tagged acceptance tests, spec commits, the intent brief and the spec delta"
status: accepted
date: 2026-11-09
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec, intent, review-round, claim-check, decision-review, ledger, tasks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0001", "0002", "0010", "0011", "0013", "0014", "0015", "0017", "0019", "0022"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,policy,specbinding,claimgate,claimcheck,lineage,ledger,briefs,assessment}.py"
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
  decidedAt: 2026-11-09T08:13:27Z
externalRefs:
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0001-let-a-red-test-land-before-its-code-in-every-gate.md"
    label: "org ADR-0001: Let a red test land before its code in every gate"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
---

# ADR-0023: Grade a story against its frozen intent: tagged acceptance tests, spec commits, the intent brief and the spec delta

## Context

Root ADR-0012 splits what a story reads into an intent tier the human owns, decision records among it, and a
design tier the story may change on its branch. ADR-0010 d1 decided to refuse every spec-folder change but a
tick; it never landed, and the gate today refuses only an edit tool on `spec.md` (README 9). The launch of
README 5 binds a PR to one `spec.md` blob (`specbinding.py`), which ADR-0014 d1 already decides against;
ADR-0010 d1 takes the whole folder as the target, README 5 the whole `spec.md`. Once the story may change its
design, four things must hold or the risk root ADR-0011 named returns: no story commit may add to, remove or
edit what the human asked for; every design change must be a commit the story names and claims, not a drift
inside a code commit; a design change that leaves part of the ask unmet must reach the human, not be ruled a fix
the story makes itself; and the admin who moves the card to Ready must see every change the story made to its
spec. Each is a rule code can decide or a ruling policy can fix, so each is reviewer's (constitution P1). This
record decides the rules; how each gate reads them from the files and the commit is its story's, under the
action items.

## Decision

1. We will fence the intent tier on a story branch (INTENT_FROZEN). A commit is refused when it changes
   `adr-rulings.json` or the `codeworks` front matter of `spec.md`; when the diff of `spec.md` has a `+` or `-`
   line inside an intent section or before the first `## ` heading (root ADR-0012 d1), or adds, removes or
   renames a `## ` line; or when it changes a path in another spec's folder, a story changing only its own. A
   decision record is fenced by the protected set through the check of ADR-0002 d4, as orchestrator ADR-0004 d4
   and ADR-0002 d4 decide; this gate adds nothing for it. A merge commit is judged on its conflict resolution
   (ADR-0002 d3). The refusal names the section and the spec PR as the next step (planner ADR-0010). The section
   a line belongs to comes from core's one `spec.md` splitter over the fixed `## ` headings (root ADR-0012 d1;
   amends ADR-0014 d2), an item from the id label in its line. A review-round or assess-round launch compares
   the intent tier at the reviewed commit with the branch's merge base, the ratification (root ADR-0012 d2): any
   difference refuses the launch with the diff, as a commit made outside the hooks is caught (ADR-0002 d4); this
   replaces README 5's blob binding. The issue body is outside this fence: it is the admin's, read live, and no
   component writes it. OWN_BLOCK replaces TICK_ONLY (ADR-0010 d1): a `tasks.md` change on a story branch stays
   inside the task block labelled with the session's issue number (planner ADR-0008 d2): a tick (`[ ]` to `[x]`)
   in it lands in any commit, an edit in it only in a `spec:` commit (d2); a change outside it is refused, a
   merged story's block as ADR-0015 d4 decides.
2. We will admit every design-tier change but a tick (d1) only in a **`spec:` commit** (SPEC_COMMIT): a commit
   of the story branch that the default branch does not hold, whose subject starts with `spec:`; it changes only
   paths in the story's spec folder, never code, a test or a decision record; its message carries the trailers
   `Motivated-by: <ids>`, one intent id or more, and `Unaffected: <ids>`, ids as root ADR-0012 d1 spells them or
   `none`. The gate reads the subject and the trailers from the commit message before the commit lands and
   refuses a `spec:` commit whose message it cannot read there (the sources it reads, action item 1); the check
   of ADR-0002 d4 reads them from the commit object. A design-tier change in any other commit, and a `spec:`
   commit missing a trailer, naming an id the spec does not hold or touching another path, is refused naming the
   rule; a merge commit is judged on its conflict resolution (ADR-0002 d3), and a design-tier resolution in it
   is admitted and graded by the round (d5). A hold that refuses every code commit of the story (the escalation
   and rescope holds, ADR-0013 d4–d5) refuses its `spec:` commits too. Each id of `Unaffected:` is one claim of
   a judged category, that the commit leaves what meets that item as it was, which the claim check (README 6;
   ADR-0001) judges against the spec folder in the staged tree before the commit lands; its lineage is keyed by
   the spec folder and the id, where a code claim's is keyed by its file (amends ADR-0001 d2); `WRONG` refuses
   the commit and counts on that lineage as any `WRONG` does, and the `claim-<id>` hold it places refuses the
   story's `spec:` commits naming that id in either trailer (amends ADR-0013 d4). This gate opens when root
   ADR-0012's action item 6 has landed (root ADR-0012 d3); before that every `spec:` commit departs from a
   record outside the repo.
3. We will tie acceptance scenarios to tests (TAGGED_TEST). A test whose name carries the tag `p<p>-US<k>-S<n>`
   or `p<p>-EC-<nnn>`, `<p>` the spec's issue number (its folder is `specs/<p>-<slug>/`, org ADR-0002 d1) and
   `-` written `_` where the language forbids it in a name, is tagged with that item of that spec; the tag is
   read whole, `p342-US1-S2` not inside `p342-US1-S20` (its boundaries, action item 1), and the issue number
   keeps one spec's `US1-S1` apart from another's. The commit gate refuses a story-branch commit after which,
   for an item its spec's `spec.md` at the commit holds and has not retired (root ADR-0012 d1), whichever story
   commits, the tagged tests are fewer than at the parent, or one of them is skipped or marked expected-fail; a
   merge commit is compared with its first parent; a merged spec PR that retires the item frees its tests from
   the story's next merge of the default branch. A scenario of the story's own user story (the `[US<k>]` tag of
   its task block, planner ADR-0008 d2) with no tagged test at the reviewed commit is a finding ruled FIX: write
   the test, red first (constitution Principle IV), which the gate lets land before its code (org ADR-0001 d1);
   an edge case's test is protected once tagged and asked of no story. A change to a tagged test's body is
   reviewed by the round; one that leaves the test not checking its item is INTENT_DRIFT (d4). A rename of the
   spec folder (planner ADR-0010 d2) leaves the story's `p<n>-` tags naming no spec at the commit: they protect
   nothing, and the story's next round lists its untagged scenarios as FIX findings, the retag landing as code.
4. We will brief the decision-reviewer with the intent tier at ratification and the design delta from the merge
   base to the reviewed commit, beside the governing records it already reads; it joins every internal round, as
   ADR-0019 d3 decided, where `briefs.waves` today adds it only when a record governs (README 8), since a round
   with no governing record must still see drift. It reports one kind new to the finding-kind set (root ADR-0010
   d2, upper snake case): INTENT_DRIFT, the delta removes or narrows the last functional requirement or task
   that met an intent item at ratification, or a tagged test is changed so it no longer checks its item (d3); it
   admits ESCALATE alone, the ruling ADR-0017 d2 gives a finding the assessor cannot rule, and the
   `escalation-<issue>` hold's question names the item's id and the commit (ADR-0013 d4), for the admin. A
   scenario without its tagged test is d3's FIX, not drift, and a gap the design already had at ratification is
   not drift. SPEC_GAP keeps its kind and is one of three things: two intent items contradict, an intent item
   cannot be met as written, or the root-cause reviewer's verdict is SPEC_WRONG; the spec ADR-0017 d2's RESCOPE
   clause names is the intent tier, so a SPEC_GAP finding admits PUSH_BACK, citing the intent line that settles
   it, and no other ruling; one standing, not pushed back, makes the round's verdict RESCOPE unless a finding is
   ruled ESCALATE (ADR-0017 d2's order; ADR-0013 d5), and its next step the spec PR, never a story commit. A
   decision the design tier leaves open is no finding kind: the finding that exposed it is ruled on its own
   kind, and the story settles the decision in that fix's `spec:` commit (root ADR-0012 d4). SPEC_WRONG
   (ADR-0017 d2) yields a SPEC_GAP finding, `## Root cause` being intent (root ADR-0012 d1), ruled as above, or
   a PUSH_BACK citing a spec line; its spec-gap FIX, a story's change to the spec, goes. A departure from a
   record keeps ADR-0017 d2's rulings: FIX by changing the code, or ESCALATE.
5. We will record on every round (ADR-0011 d1; root ADR-0003's `Round` contract) a `spec_delta` since
   ratification: the merge base's `spec.md` blob; each `spec:` commit on the branch with its oid, subject,
   `Motivated-by` and `Unaffected` ids and their claim verdicts; and each merge commit whose conflict resolution
   changes the design tier, with its oid and paths. The orchestrator posts it as a comment on the PR with its
   App, keyed by the round that recorded it and posted only when no comment with that key exists, in the manner
   of orchestrator ADR-0003 d3–d4, never in the PR body, which is the squash message (orchestrator ADR-0009 d6);
   it is the human's record of what d4 graded, not a gate. After a merge of the default branch the intent tier
   equals the default branch's, and the design tier's resolution is graded by the round (amends ADR-0015 d4).
   The lapse a late `spec:` commit causes, the protected set and builder's merge need are root ADR-0012 d5's;
   the check of ADR-0002 d4 fails a commit d1, d2 or d3 would refuse, however it was made.

## Options considered

### Option A: Fence the intent, name and claim each design change, escalate drift, show the delta (chosen)

The gate decides what code can decide; the round rules what needs judgment, and policy fixes which ruling a
weakened intent admits. Every design change is one commit the admin reads, and one a round grades.

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

### Option F: The spec delta in the PR body

Rejected: the body is the squash message (orchestrator ADR-0009 d6), and the delta carries `spec:` subjects the
model wrote.

### Option G: Leave a late `spec:` commit to the next round that happens

Rejected: the attestation stands from the last clean round (orchestrator ADR-0004 d1), so a design change pushed
after it would merge with no decision-reviewer pass and no INTENT_DRIFT check, and the delta comment, keyed by
round, would not show it.

### Option H: A finding kind of its own for a decision the design tier leaves open

Rejected; an earlier draft had DESIGN_GAP. The gap is not a finding against the code: the finding that exposes
it is, and that fix's `spec:` commit settles the gap. A kind of its own needed a test for "the design tier can
settle it" no assessor can apply, and sat beside SPEC_GAP in ADR-0017 d2's RESCOPE clause.

### Option I: Tags without the spec's issue number

Rejected: every spec has a `US1-S1`. Without the issue number a tag cannot say whose item it checks: one spec's
test would stand for another's missing one, and retiring an item would free the wrong tests.

### Option J: Protect a tagged test by its name

Rejected: a rename that keeps the tag then reads as a lost test; a count per item reads it as nothing, and a
lost tag as one fewer.

## Trade-offs

- Three predicates read structure from the spec folder: fixed headings and id labels in `spec.md` through core's
  splitter, task blocks in `tasks.md`, trailers in a commit message.
- A tagged test's body can be weakened in place; the gate stops what it can and the round escalates the rest.
- Each `spec:` commit runs the claim check on its `Unaffected` ids, and one after the attested round costs a new
  round; a story that amends its design often pays for it there.
- An `Unaffected` lineage has no file, so its hold refuses by id, not by path.
- A test's name carries the spec's issue number; a test that serves two specs carries two tags.
- The `Round` contract grows a field; the ledger's folds and the orchestrator's comment follow it.
- An edge case's test is protected, not demanded: no story owns an edge case.
- The decision-reviewer joins rounds it used to skip; a round with no governing record pays for one more
  reviewer.

## Consequences

- Easier: a story fixes its plan or a requirement in one commit and the next round grades it.
- Harder: the gate's spec-folder rule is three predicates where it was one; the brief carries a delta.
- **How we would know this was wrong:** an intent line added, removed or edited on a merged story branch; a
  design-tier change merged outside a `spec:` commit; a scenario whose tagged test was dropped while it stood; a
  drifted design ruled FIX; a design delta an admin reverts after merge that no round escalated.
- Revisit if: the claim check cannot judge an `Unaffected` claim from the spec folder alone, or INTENT_DRIFT
  findings are mostly ruled wrong by the admin.

## Action items

1. [ ] gate: INTENT_FROZEN, SPEC_COMMIT (reads the subject and trailers from `-m` and `-F`; refuses a `spec:`
   commit whose message comes from an editor, `-c`, `-C`, `-t`, `--fixup`, `--squash` or `--trailer`),
   TAGGED_TEST (the tag's token boundaries; the skip and expected-fail markers of each framework the repo tests
   in) and OWN_BLOCK on the commit path; the launch's intent comparison replaces the `spec.md` blob binding
   (`specbinding.py`; ADR-0014 d1), and the launch lists the scenarios of the story's `[US<k>]` with no tagged
   test at the reviewed commit, each a finding whose ruling is FIX in code.
2. [ ] claim check: `Unaffected` ids as a judged claim category (`briefs.py`, `claimcheck.py`); a lineage keyed
   by spec folder and id, and the hold that refuses by it (`lineage.py`, `claimgate.py`); the check record keyed
   by the staged tree and the trailers, so a check that saw other trailers passes no commit (`claimgate.py`).
3. [ ] policy: INTENT_DRIFT in the finding-kind set (`assessment.KINDS`, in upper snake case per root ADR-0010
   d2, its lower-case values renamed with it), admitting ESCALATE alone, with the ESCALATE finding ruling
   ADR-0017 d2 decided and `FINDING_VERDICTS` lacks today; SPEC_WRONG and RESCOPE's clause per d4;
   `validate_assessment` refuses a `round_verdict` that is not the first match of ADR-0017 d2's order (ESCALATE
   when a finding is ruled ESCALATE, else RESCOPE when a SPEC_GAP finding is not ruled PUSH_BACK), where today
   it checks admissibility and that `RESHAPE_SPEC` has a `spec_gap` finding, not the order; one verdict name
   across `policy.VERDICTS` (`RESHAPE_SPEC`) and core's `RoundVerdict` (`RESCOPE`), as root ADR-0010 decides.
4. [ ] decision-reviewer: joins every internal round (`briefs.waves`); its brief carries the intent at
   ratification, the design delta and, per intent item, the tagged tests at the reviewed commit.
5. [ ] core: `spec_delta` on `Round`, the `spec.md` splitter and the id grammar; orchestrator: the delta
   comment, orchestrator ADR-0004 d4's set without `specs/` and its d1's lapse as root ADR-0012 d5 states them;
   `RoundVerdict.RESCOPE`'s description in core reads as d4 defines SPEC_GAP (root ADR-0010 d3).
6. [ ] README: What it enforces 5, 6, 8 and 9 rewritten from this record once the code lands.

