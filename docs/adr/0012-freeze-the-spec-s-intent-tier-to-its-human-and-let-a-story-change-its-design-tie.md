---
schemaVersion: 0.2.0
id: "0012"
title: "Freeze the spec's intent tier to its human and let a story change its design tier in the PR it builds"
status: accepted
supersedes: ["0011"]
date: 2026-11-09
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
    pattern: "core/src/{attest,story-stop-facts,protected-paths}.ts"
  - type: path
    pattern: "planner/plugin/scripts/{spec_facts.ts,premise_report.py}"
  - type: path
    pattern: ".claude/skills/speckit-specify/**"
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
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0002-one-spec-per-issue.md"
    label: "org ADR-0002: Keep one spec per spec's issue, landed by a spec PR before any story"
  - type: doc
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0001-let-a-red-test-land-before-its-code-in-every-gate.md"
    label: "org ADR-0001: Let a red test land before its code in every gate"
---

# ADR-0012: Freeze the spec's intent tier to its human and let a story change its design tier in the PR it builds

## Context

ADR-0011 let planner alone write a spec folder and a decision record, so a story that finds its plan wrong or a
requirement unstated stops and waits for a planning run: a RESCOPE verdict, a rescope hold, a spec PR, a merge
of the default branch, a new round. Three stories (#177, #209, #217) have circled that loop for days; 43 of the
repo's 192 PRs closed unmerged. ADR-0011 guarded a real risk: an agent that writes the spec and the code it is
graded against can move the target to fit the code, a little each round, until the merged work is not what was
asked for. It guarded it by freezing the whole folder, as if every line of a spec were the ask. Two things live
in a spec folder: what the human wants, and how the agent proposes to get there. Only the first has to stay
fixed for the review to grade anything; the second is the agent's own work, and is graded like the code. A
decision record is of the first kind: the decision check grades a story by it (reviewer ADR-0022), the
constitution's Source lines name records, and org ADR-0002 d2 lands every record by a spec PR. A document a
story is graded by is not the story's to change in the PR being graded (Principle VI). Org ADR-0002 d4 lets a
story PR change nothing in the spec folder but its ticks; this repo's decision check reads that record as the
org corpus (`REVIEWER_ORG_ADR_DIR` today; `[shared] adr_folders`, which lists `../engineering/docs/adr`, once
reviewer ADR-0022 d1 lands), so the design-tier changes decided here depart from it until it is amended (d3,
action item 6).

This record decides what each tier is, who may change it and how a change is graded. How a gate reads a tier
from the files and the commit is reviewer ADR-0023's, and the stories under both records' action items.

## Decision

1. We will split what a story reads into two tiers. The **intent tier** is the human's: the spec's issue body;
   `adr-rulings.json`; in `spec.md`, the lines before its first `## ` heading (the title and the user's
   description), the `codeworks` front matter (planner ADR-0008 d1) and the sections `## Clarifications`, `##
   User Scenarios & Testing` (user stories, acceptance scenarios, edge cases), `## Success Criteria`, `##
   Non-goals` (action item 7), `## Why this is worth doing` and `## Root cause`, the premise and its
   investigation both: planner's `spec_facts.ts` derives the frozen `root_cause.observed` from its opening line,
   and a frozen fact has a frozen source; and every decision record in every folder `[shared] adr_folders` lists
   (reviewer ADR-0022 d1); a record in a folder outside the repo is read live, as the issue body is, and fenced
   by its own repo. The **design tier** is the story's: the other sections of `spec.md` (`## Requirements` and
   `## Assumptions` among them), every other file of the folder but `tasks.md`, and of `tasks.md` the story's
   own task block. Another spec's folder is in neither tier: a story commit changes nothing there. The `## `
   headings of `spec.md` are fixed, the template's and the `## Clarifications` the clarify and grill commands
   add, their `*(…)*` notes aside: a story commit adds, removes or renames none, and one splitter in `core/`
   (ADR-0003) reads the section a line belongs to from them, for planner's checks and reviewer's gate alike; no
   fact is read from a heading's wording (amends reviewer ADR-0014 d2 and planner ADR-0008 d1; constitution P7
   names the exception in its own PR, action item 5). An acceptance scenario, an edge case and a success
   criterion carry an explicit id in the line, never renumbered and never reused: `**US<k>-S<n>**` on an
   acceptance scenario of `### User Story <k>`, `<n>` its number as written, not its place in the list,
   `**EC-<nnn>**` on an edge case, `**SC-<nnn>**` on a success criterion as the template already writes it. A
   new item takes the next unused number; a removed item's line stays, its id and the word `retired`, so the
   number is never reused and the item frees its tagged tests (reviewer ADR-0023 d3).
2. We will freeze the intent tier to its human. The folder's intent tier lands, and every later change to it
   lands, by a spec PR on `<p>-spec` that planner opens (planner ADR-0010 d3) and a human's exempt label
   approves (org ADR-0002 d2; orchestrator ADR-0005 d4), from the admin's words: the path an entry of
   `adr-rulings.json` takes (planner ADR-0009 d6). A decision record is written by planner alone, in a planning
   run, and lands as org ADR-0002 d2 and planner ADR-0009 d3 have it (ADR-0011 d1's rule, kept here). The squash
   commit of that spec PR on the default branch is the intent's **ratification**; a story branch reads it at its
   merge base. A record outside the repo stands at no merge base: it governs from the round after it changes,
   and lapses nothing. The issue body is the admin's, edited on GitHub and read live where a brief needs it; it
   stands at no merge base, no gate fences it and no component writes it. On a story branch reviewer refuses
   every commit that changes the intent tier, a merge commit judged on its conflict resolution (reviewer
   ADR-0023 d1; reviewer ADR-0002 d3), a record excepted: it stays under the protected set and reviewer's check,
   which fails its change after the commit, as orchestrator ADR-0004 d4 and reviewer ADR-0002 d4 decide. A story
   writes nothing in the intent tier, not an added scenario either: what it finds missing it asks of the admin
   by a RESCOPE verdict (d4), and a record it finds wrong is a departure, ruled FIX by changing the code or
   ESCALATE (reviewer ADR-0017 d2), which the admin answers with a spec PR.
3. We will let the story change the design tier on its own branch, in **`spec:` commits** (reviewer ADR-0023
   d2): a commit of the story branch that changes only its spec folder's design tier, names the intent items
   that motivate it and the items it claims unaffected, and lands only once the claim check has judged that
   claim. In `tasks.md` a story writes only the task block labelled with its issue number (OWN_BLOCK, which
   replaces TICK_ONLY of ADR-0011 d1 and reviewer ADR-0010 d1): a tick (`[ ]` to `[x]`) inside its block lands
   in any commit, as before; an edit inside its block lands in a `spec:` commit; nothing outside it. planner
   ADR-0009 d4 keeps `tasks.md` derived in planning, where the tasks command keeps a merged story's block as the
   default branch holds it (planner ADR-0010 d5 stops a rescope that changes one) and an open story's edits stay
   on its branch, resolved at its next merge of the default branch (d5); on a story branch the story's block is
   the story's. Decisions 3 to 5 and the amendment notes resting on them take effect when action item 6 has
   landed, before action items 2–4: until then every `spec:` commit is a departure from org ADR-0002 d4 that no
   story-side fix clears, since a ruling lands only by a spec PR (d2).
4. We will grade the code and the design tier against the intent tier, never the other way round, and give every
   design change a round. reviewer ADR-0023 d3 ties each acceptance scenario of the story's own user story to a
   test tagged with the spec's issue number and the scenario's id, written red first (constitution Principle IV;
   the gate lets it land before its code, org ADR-0001 d1), and protects every tagged test while its item
   stands; reviewer ADR-0023 d4 briefs the decision-reviewer with the intent at ratification and the design
   delta since it, in every internal round, and defines the two findings over the intent tier: INTENT_DRIFT,
   ruled ESCALATE and never FIX, the one human gate on a story's design; and SPEC_GAP, which standing makes the
   round's verdict RESCOPE and the next step a spec PR (d2), never a story commit. A decision the design tier
   leaves open is no finding of its own: the story settles it in the `spec:` commit of the fix that exposed it,
   and the round grades that commit.
5. We will keep every design change where the human can read it, and give it a round. reviewer's round record
   carries the spec delta since ratification, and the orchestrator posts it as a keyed comment on the PR
   (reviewer ADR-0023 d5; orchestrator ADR-0003 d3–d4), never in the PR body, which becomes the squash message
   (orchestrator ADR-0009 d6). The delta is the record of what the round graded (d4), not a gate. The
   orchestrator attests a story PR that changes `specs/`, whose changes reviewer's gate and check fence (d2, d3;
   reviewer ADR-0002 d4): `specs/` leaves the protected set of orchestrator ADR-0004 d4 for a story PR, and
   stays in it for the bot-author exemption of orchestrator ADR-0005 d1, which no gate of reviewer's backs; the
   rest of that set stands, every `docs/adr/` folder among it. The attestation lapses when the default branch's
   head differs, in the files orchestrator ADR-0004 d1 names (the story's spec's `spec.md` and
   `adr-rulings.json` among them), from the default branch at the merge base of the attested round's commit, so
   the story merges it and a new round grades the story against what landed; and on a `spec:` commit of the
   story after the attested round's commit, so a late design change is graded by a new round. No other commit of
   the story lapses it, and the other lapses of orchestrator ADR-0004 d1 stand. builder's merge need (builder
   ADR-0004 d2) compares the same files, `adr-rulings.json` among them, the same way, at the story head's merge
   base, so no commit of the story's own triggers it. After a merge of the default branch the intent tier equals
   the default branch's and the design tier's resolution is graded by the round (reviewer ADR-0015 d4, as
   reviewer ADR-0023 d5 amends it). reviewer's check fails a commit reviewer ADR-0023 d1–d3 would refuse,
   however the commit was made (reviewer ADR-0002 d4).
6. We will read Principle VI this way: the intent tier, decision records among it, and this repo's gates,
   constitution and config are the governing rules and the fixed target, and ship apart from the code they
   grade; the design tier is the story's account of its solution, graded against the intent as the code is, and
   changes in the PR that changes the code.

## Options considered

### Option A: Intent frozen to its human, records among it; design changed by the story in `spec:` commits, graded against the intent (chosen)

The review has a fixed target and the story has room to design. Every design change is a named, claimed commit
the admin can read on the PR, and a round grades it.

### Option B: Keep ADR-0011: planner alone writes the folder

Rejected: observed cost. Every design gap is a planning run and a merge of the default branch; stories circle
for days.

### Option C: Let the story change any part of the spec, reviewed in its PR

Rejected: the risk ADR-0011 named is real. The review grades the code against a target the same agent moved in
the same PR; a scenario deleted with the code that failed it leaves no trace a round can rule on.

### Option D: Design changes by a story-opened spec PR on `<p>-spec`

Rejected: still a second PR, a merge of the default branch and a new round per design change, and the admin
reviews the design twice, once apart from the code it is for.

### Option E: Tiers by file: `spec.md` whole is intent, add-only on a story branch

Rejected: heading-free, but a wrong functional requirement then stays until a spec PR, the stop seen most; and
an added line under `## Non-goals` narrows the ask with nothing to refuse it.

### Option F: `## Root cause` in the design tier

Rejected: the front matter's `root_cause.observed` is read from its opening line, so a `spec:` commit could
change the premise while the fence kept the fact derived from it; the two would disagree, and the root-cause
reviewer's dispatch (reviewer ADR-0017 d1) runs off the stale one. The premise and the investigation the
template keeps under the same heading are the human's, frozen together; a trace the root-cause reviewer finds
wrong is a SPEC_GAP finding and a RESCOPE round (reviewer ADR-0023 d4). `research.md` stays design.

### Option G: Decision records in the design tier, added or superseded by `spec:` commits

Rejected; an earlier draft of this record chose it. A record is what the decision check grades a story by
(reviewer ADR-0022), the constitution's Source lines name records, and org ADR-0002 d2 lands every record by a
spec PR: a story that supersedes a record in its own PR rewrites a rule it is graded by, and the orchestrator
merges it with no human (orchestrator ADR-0009 d1), against Principle VI. It also needed an approver for a
record no human approved, an intent id to motivate a record change, a rule for two stories minting one record
id, and an exemption in the protected set.

## Trade-offs

- The admin reads design deltas in the story PR, from the spec delta comment, instead of in a spec PR of their
  own; nothing makes them read it before the merge, so drift the round misses is found after it.
- A story that finds its intent incomplete, or a record wrong, stops and asks, as it does for a record today;
  the intent gains nothing from a story branch.
- A tagged test's body can still be weakened in place; the gate refuses what code can decide (fewer tests, skip,
  expected-fail) and the round rules the rest ESCALATE, for the human.
- Explicit ids ask the spec writer to label every scenario and edge case, and a test's name carries the spec's
  issue number.
- A `spec:` commit after the attested round costs a new round; that is the price of grading it.
- The issue body is intent a gate cannot read at a merge base; it is fenced by who may write it, not by a check.
- A `spec:` commit claiming `Unaffected: none` gives the claim check nothing to judge; the round alone grades
  it.
- A record outside the repo governs from the round after it changes, with no lapse and no merge; the story
  learns of it from that round.

## Consequences

- Easier: a story fixes its own plan or requirement in a commit and keeps building.
- Harder: three gates on a story branch read the spec folder's structure; the claim check judges `spec:`
  commits.
- **How we would know this was wrong:** a merged story whose code meets fewer intent items than at ratification;
  a design delta an admin reverts after merge that no round escalated; a story still stopping for a planning run
  on a design-tier gap.
- Revisit if: a section of `spec.md` has to move between tiers, an intent change by a story is wanted, or
  stories stop for planning runs on records more often than on intent.

## Action items

1. [x] This record; ADR-0011 superseded; amendment notes on the partially superseded items (reviewer ADR-0001
   d2, 0002 d4, 0010 d1–d2, 0013 d4–d5, 0014 d2, 0015 d4, 0017 d2; planner ADR-0008 d1, 0009 d4; orchestrator
   ADR-0004 d1, d4, 0005 d1; builder ADR-0004 d2); ADR-0010's finding-kind row (#342).
2. [ ] core, after 6: the `spec.md` splitter (planner's `premise_report.section` and the heading reader of
   `spec_facts.ts` move there) and the tier and id grammar; `spec_delta` on `Round`; `governingDiff`, shared by
   the attestation (`attest.ts`) and builder's merge need (`story-stop-facts.ts`), compares the default branch's
   head with the default branch at a merge base, the attested round's for the lapse and the story head's for the
   merge need, in place of the round's or the story's head, and reads `adr-rulings.json` too; the fixed headings
   and each one's tier are constants of the splitter, pinned to the preset's spec template by a test and never
   read from the template at run time.
3. [ ] reviewer's gates, after 6: intent fence, `spec:` commits, OWN_BLOCK, tagged tests, the intent brief, the
   delta (reviewer ADR-0023 action items). planner: the landing check refuses an unlabelled scenario or edge
   case, and the tasks command keeps a merged story's block as the default branch holds it (d3).
4. [ ] orchestrator, after 6: orchestrator ADR-0004 d4's set without `specs/` for a story PR and with it for
   orchestrator ADR-0005 d1, and its d1's lapse, as d5 states them, a late `spec:` commit among the lapses; the
   spec delta comment. Today `protected-paths.ts` holds no `specs/` and has no caller, TICK_ONLY never landed,
   and the folder's files but `spec.md` are unfenced on a story branch; records are protected by the `docs/adr`
   segment every listed folder ends in, so a listed folder named otherwise needs the matcher to read the list.
5. [ ] The constitution, in its own PR after this one, its version as Governance decides: the Delivery Workflow
   names the two tiers, P6's Source lines add this record and reviewer ADR-0023, and P7 names the spec
   template's fixed headings, read by core's splitter, as its second exception.
6. [ ] `analitiq-ai/engineering`, before 2–4: org ADR-0002 d2 and d4 name the intent tier as what a spec PR
   lands and a story PR leaves unchanged, the folder's design tier changing on the story branch, and say how a
   record lands outside a run, as this one does by a docs PR.
7. [ ] The settled-design preset, in its own PR after this one (Principle VI; this record's `affects`): `##
   Non-goals` and an opening note that fixes the headings and defines the ids in the spec template, the id
   labels and retired lines in the specify command, in the source, installed, composed and skill copies; grill
   and clarify, which use the project's template names and identifiers by their own rule, follow that note.

