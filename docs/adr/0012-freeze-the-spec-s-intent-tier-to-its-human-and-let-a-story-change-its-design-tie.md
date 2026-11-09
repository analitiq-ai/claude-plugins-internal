---
schemaVersion: 0.2.0
id: "0012"
title: "Freeze the spec's intent tier to its human and let a story change its design tier in the PR it builds"
status: accepted
supersedes: ["0011"]
date: 2026-11-07
deciders: ["@Analitiq-Bot-Wonka"]
tags: [spec-folder, decision-log, ownership, intent, planner, reviewer, builder, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0010", "0011"]
affects:
  - type: path
    pattern: "specs/**"
  - type: path
    pattern: "**/docs/adr/**"
  - type: path
    pattern: ".specify/presets/settled-design/**"
  - type: path
    pattern: "planner/plugin/speckit/presets/settled-design/**"
  - type: path
    pattern: "core/src/{protected-paths,attest,story-stop-facts}.ts"
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
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0001-let-a-red-test-land-before-its-code-in-every-gate.md"
    label: "org ADR-0001: Let a red test land before its code in every gate"
---

# ADR-0012: Freeze the spec's intent tier to its human and let a story change its design tier in the PR it builds

## Context

ADR-0011 let planner alone write a spec folder and a decision record, so a story that finds its plan wrong, a
requirement unstated or a record departed from stops and waits for a planning run: a RESCOPE verdict, a rescope
hold, a spec PR, a merge of the default branch, a new round. Three stories (#177, #209, #217) have circled that
loop for days; 43 of the repo's 192 PRs closed unmerged, and this repo's folders hold 52 records, many landed to
unblock one story. ADR-0011 guarded a real risk: an agent that writes the spec and the code it is graded against
can move the target to fit the code, a little each round, until the merged work is not what was asked for. It
guarded it by freezing the whole folder, as if every line of a spec were the ask. Two things live in a spec
folder: what the human wants, and how the agent proposes to get there. Only the first has to stay fixed for the
review to grade anything; the second is the agent's own work, and is graded like the code. Principle VI (a
governing rule ships apart from the code it governs) needs a fixed target; the target is the ask, not the agent's
design of its solution. The organisation's rule says the same as ADR-0011 did: org ADR-0002 d2 lands every record
by a spec PR and d4 lets a story PR change nothing in the spec folder but its ticks. This repo's decision check
reads that record as the org corpus (`REVIEWER_ORG_ADR_DIR` today; `[shared] adr_folders`, which lists
`../engineering/docs/adr`, once reviewer ADR-0022 d1 lands), so the story-side changes decided here depart from it
until it is amended (d3, action item 6).

This record decides what each tier is, who may change it and how a change is graded. How a gate reads a tier from
the files and the commit is reviewer ADR-0023's, and the stories under both records' action items.

## Decision

1. We will split a spec folder into two tiers. The **intent tier** is: the spec's issue body; `adr-rulings.json`;
   and, in `spec.md`, the lines before its first `## ` heading (the title and the user's description), the
   `codeworks` front matter (planner ADR-0008 d1) and the sections `## Clarifications`, `## User Scenarios &
   Testing` (user stories, acceptance scenarios, edge cases), `## Success Criteria`, `## Non-goals`, `## Why this
   is worth doing` and `## Root cause`, the premise and its investigation both: planner's `spec_facts.ts` derives
   the frozen `root_cause.observed` from its opening line, and a frozen fact has a frozen source. The **design
   tier** is everything else the folder holds: the other sections of `spec.md` (`## Requirements` and
   `## Assumptions` among them), every other file of the folder, the story's own task block of `tasks.md`, and the
   decision records in every folder inside the repo that `[shared] adr_folders` lists (reviewer ADR-0022 d1).
   Another spec's folder is in neither tier: a story commit changes nothing there. The `## ` headings of `spec.md`
   are the template's, their `*(…)*` notes aside: a story commit adds, removes or renames none, and one splitter in
   `core/` (ADR-0003) reads the section a line belongs to from them, for planner's checks and reviewer's gate alike;
   no fact is read from a heading's wording (amends reviewer ADR-0014 d2 and planner ADR-0008 d1; constitution P7
   names the exception in its own PR, action item 5). An item of the intent tier carries an explicit id in its
   line, never renumbered and never reused: `**US<k>-S<n>**` on acceptance scenario `<n>` of `### User Story <k>`,
   `**EC-<nnn>**` on an edge case, `**SC-<nnn>**` on a success criterion as the template already writes it. A new
   item takes the next unused number; a removed item's id retires.
2. We will freeze the intent tier to its human. The folder's intent tier lands, and every later change to it lands,
   by a spec PR on `<p>-spec` that planner opens (planner ADR-0010 d3) and a human's exempt label approves (org
   ADR-0002 d2; orchestrator ADR-0005 d4), from the admin's words: the path an entry of `adr-rulings.json` takes
   (planner ADR-0009 d6). The squash commit of that spec PR on the default branch is the intent's
   **ratification**; a story branch reads it at its merge base. The issue body is the admin's, edited on GitHub
   and read live where a brief needs it; it stands at no merge base, no gate fences it and no component writes it.
   On a story branch reviewer refuses every commit that changes the intent tier, a merge commit judged on its
   conflict resolution (reviewer ADR-0023 d1; ADR-0002 d3). A story writes nothing in the intent tier, not an
   added scenario either; what it finds missing it asks of the admin by a RESCOPE verdict (d4).
3. We will let the story change the design tier on its own branch, in **`spec:` commits** (reviewer ADR-0023 d2):
   a commit of the story branch that changes only its spec folder's design tier and the decision records, names
   the intent item that motivates it and the items it claims unaffected, and lands only once the claim check has
   judged that claim. In `tasks.md` a story writes only the task block labelled with its issue number (OWN_BLOCK,
   which replaces TICK_ONLY of ADR-0011 d1 and reviewer ADR-0010 d1): a tick (`[ ]` to `[x]`) inside its block
   lands in any commit, as before; an edit inside its block lands in a `spec:` commit; nothing outside it. planner
   ADR-0009 d4 keeps `tasks.md` derived in planning; on a story branch the story's block is the story's. A story
   adds a record, or supersedes a record present at its merge base by that record's `status` and `supersededBy`
   fields and the note under its title that this repo's superseded records carry (ADR-0011's); it changes a record
   present at the merge base in no other way, and a record it added is its own (reviewer ADR-0023 d2). A record a
   story adds or supersedes sits in a folder inside the repo and keeps the form `adr check` validates and this
   repo's records carry, `status: accepted` and `provenance.ratifiedBy` among it, as planner's do in a spec PR
   (planner ADR-0009 d3, d8); the orchestrator's squash merge of the story PR (orchestrator ADR-0009 d1) is its
   ratification, as the spec PR's merge is planner's. A record outside the repo is never changed from a story
   branch (planner ADR-0009 d8). Decisions 3 to 5, the `spec:` commit as a fix path (d4) and the amendment notes
   they place on other records take effect when action item 6 has landed whole, before action items 2–4: until
   then every `spec:` commit is a departure from org ADR-0002 d4 that no story-side fix clears, since superseding
   it is outside this repo (planner ADR-0009 d8) and a ruling lands only by a spec PR (d2).
4. We will grade the code and the design tier against the intent tier, never the other way round (reviewer
   ADR-0023 d3–d4). Every acceptance scenario of the story's own user story has a test tagged with its id, written
   red first (constitution Principle IV; the gate lets it land before its code, org ADR-0001 d1); no story commit
   removes, untags, skips or marks expected-fail a tagged test while its item stands, and a scenario with no
   tagged test is a finding ruled FIX. The decision-reviewer is briefed with the intent at ratification and the
   design delta since it. A delta that leaves an intent item with no requirement or task meeting it, or narrows
   what meets it, is an INTENT_DRIFT finding ruled ESCALATE and never FIX. A gap the design had at ratification is
   not drift: one the design tier can settle is a DESIGN_GAP finding ruled FIX, its fix a `spec:` commit; one only
   an intent line settles is a SPEC_GAP finding, on which the round's verdict is RESCOPE (reviewer ADR-0017 d2,
   ADR-0013 d5) and the answer a spec PR (d2).
5. We will keep every design change where the human can read it, and give it a round. reviewer's round record
   carries the spec delta since ratification (reviewer ADR-0023 d5), and the orchestrator posts it as a keyed
   comment on the PR with its App, in the manner of orchestrator ADR-0003 d3–d4, never in the PR body, which
   becomes the squash message (orchestrator ADR-0009 d6). The delta is the record of what the round graded (d4),
   not a gate: the one human gate on a story's design is the INTENT_DRIFT escalation. The orchestrator attests a
   story PR that changes the design tier: `specs/`, which reviewer's gate fences (d2), and the folders inside the
   repo that `[shared] adr_folders` lists, which `spec:` commits and `adr check` fence (d3), leave the protected
   set of orchestrator ADR-0004 d4; a `docs/adr/` folder the list omits stays in it, with `codeworks.toml`,
   `.github/`, `.claude/`, `.specify/memory/`, `AGENTS.md` and `CLAUDE.md`, each at any depth and in any letter
   case; a validator's own config (`.deepsource.toml` for one) is not in it. This is the set's one statement:
   orchestrator ADR-0004 d4 points here, and core's matcher will (action item 2). The attestation lapses when the
   default branch's head differs, in the story's spec's `spec.md` or `adr-rulings.json`, in `**/docs/adr/` or in
   `.specify/memory/`, from the default branch at the merge base of the attested round's commit, so the story
   merges it and a new round grades the story against what landed; and on a `spec:` commit of the story after the
   attested round's commit, so a late design change is graded by a new round. No other commit of the story lapses
   it, and the other lapses of orchestrator ADR-0004 d1 stand. After a merge of the default branch the intent tier
   equals the default branch's and the design tier's resolution is graded by the round (reviewer ADR-0015 d4).
   reviewer's check fails a commit reviewer ADR-0023 d1–d3 would refuse, however the commit was made (reviewer
   ADR-0002 d4).
6. We will read Principle VI this way: the intent tier is the fixed target, and this repo's gates, constitution
   and config are the governing rules; both ship apart from the code they grade. A decision record is the design
   tier's account of a mechanism, graded against the intent as the code is, and may change in the PR that changes
   the code it describes. This is the repo's reading until the organisation's rule names decision records (action
   item 6).

## Options considered

### Option A: Intent frozen to its human; design changed by the story in `spec:` commits, graded against the intent (chosen)

The review has a fixed target and the story has room to design. Every design change is a named, claimed commit
the admin can read on the PR, and a round grades it.

### Option B: Keep ADR-0011: planner alone writes the folder and the records

Rejected: observed cost. Every design gap is a planning run and a merge of the default branch; stories circle for
days and records land to unblock one story.

### Option C: Let the story change any part of the spec, reviewed in its PR

Rejected: the risk ADR-0011 named is real. The review grades the code against a target the same agent moved in
the same PR; a scenario deleted with the code that failed it leaves no trace a round can rule on.

### Option D: Design changes by a story-opened spec PR on `<p>-spec`

Rejected: still a second PR, a merge of the default branch and a new round per design change, and the admin reviews
the design twice, once apart from the code it is for.

### Option E: Tiers by file: `spec.md` whole is intent, add-only on a story branch

Rejected: heading-free, but a wrong functional requirement then stays until a spec PR, the stop seen most; and an
added line under `## Non-goals` narrows the ask with nothing to refuse it.

### Option F: `## Root cause` in the design tier

Rejected: the front matter's `root_cause.observed` is read from its opening line, so a `spec:` commit could change
the premise while the fence kept the fact derived from it; the two would disagree, and the root-cause reviewer's
dispatch (reviewer ADR-0017 d1) runs off the stale one. The premise and the investigation the template keeps under
the same heading are the human's, frozen together; a trace the root-cause reviewer finds wrong is a SPEC_GAP
finding and a RESCOPE round (reviewer ADR-0023 d4). `research.md` stays design.

## Trade-offs

- The admin reads design deltas in the story PR, from the spec delta comment, instead of in a spec PR of their own;
  nothing makes them read it before the merge, so drift the round misses is found after it.
- A story that finds its intent incomplete stops and asks, as it does for a record today; the intent gains nothing
  from a story branch.
- A tagged test's body can still be weakened in place; the gate refuses what code can decide (remove, untag, skip,
  expected-fail) and the round rules the rest ESCALATE, for the human.
- Explicit ids ask the spec writer to label every scenario and edge case.
- A `spec:` commit after the attested round costs a new round; that is the price of grading it.
- The issue body is intent a gate cannot read at a merge base; it is fenced by who may write it, not by a check.
- A `spec:` commit claiming `Unaffected: none` gives the claim check nothing to judge; the round alone grades it.

## Consequences

- Easier: a story fixes its own plan, requirement or record in a commit and keeps building.
- Harder: three gates on a story branch read the spec folder's structure; the claim check judges `spec:` commits.
- **How we would know this was wrong:** a merged story whose code meets fewer intent items than at ratification;
  a design delta an admin reverts after merge that no round escalated; a story still stopping for a planning run on
  a design-tier gap.
- Revisit if: a section of `spec.md` has to move between tiers, or an intent change by a story is wanted.

## Action items

1. [x] This record; ADR-0011 superseded; amendment notes on the partially superseded items (reviewer ADR-0001 d2,
   0002 d4, 0010 d1–d2, 0013 d4–d5, 0014 d2, 0015 d4, 0017 d2, 0022 d4; planner ADR-0008 d1, 0009 d3, d4, d8;
   orchestrator ADR-0004 d1, d4; builder ADR-0004 d2); ADR-0010's finding-kind row; the settled-design preset's
   `## Non-goals` and heading note, its specify command's id labels (#342).
2. [ ] core, after 6: the `spec.md` splitter (planner's `premise_report.section` and the heading reader of
   `spec_facts.ts` move there) and the tier and id grammar; `spec_delta` on `Round`; the protected-path matcher
   exempts the `docs/adr` folders `[shared] adr_folders` lists, reading the settings, and gets its first callers,
   the orchestrator's attestation and reviewer's commit check; `governingDiff`, shared by the attestation
   (`attest.ts`) and builder's merge need (`story-stop-facts.ts`), compares the default branch's head with the
   default branch at a merge base, the attested round's for the lapse and the story head's for the merge need, in
   place of the round's or the story's head, and reads `adr-rulings.json` too.
3. [ ] reviewer's gates, after 6: intent fence, `spec:` commits, OWN_BLOCK, tagged tests, the intent brief, the
   delta (reviewer ADR-0023 action items). planner: the landing check refuses an unlabelled scenario or edge case,
   and the settled-design preset's clarify command labels what it adds, as its specify command does.
4. [ ] orchestrator, after 6: ADR-0004 d4's set and d1's lapse as d5 states them, a late `spec:` commit among the
   lapses; the spec delta comment.
5. [ ] Constitution 1.2.5, in its own PR after this one (Governance): the Delivery Workflow names the two tiers,
   P6's Source lines add this record and reviewer ADR-0023, and P7 names the spec template's fixed headings, read
   by core's splitter, as its second exception.
6. [ ] `analitiq-ai/engineering`, before 2–4: org ADR-0002 d2 and d4 name the intent tier; the Scope discipline
   rule names decision records as design, not governing rules.
