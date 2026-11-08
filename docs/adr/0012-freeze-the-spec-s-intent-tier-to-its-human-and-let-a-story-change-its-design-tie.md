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
    pattern: "core/src/protected-paths.ts"
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
loop for days; 43 of the repo's 192 PRs closed unmerged, and the corpora hold 52 records, many landed to unblock
one story. ADR-0011 guarded a real risk: an agent that writes the spec and the code it is graded against can move
the target to fit the code, a little each round, until the merged work is not what was asked for. It guarded it
by freezing the whole folder, as if every line of a spec were the ask. Two things live in a spec folder: what the
human wants, and how the agent proposes to get there. Only the first has to stay fixed for the review to grade
anything; the second is the agent's own work, and is graded like the code. Principle VI (a governing rule ships
apart from the code it governs) needs a fixed target; the target is the ask, not the agent's design of its
solution.

## Decision

1. We will split a spec folder into two tiers. The **intent tier** is: the spec's issue body; `adr-rulings.json`; and,
   in `spec.md`, the `codeworks` front matter (planner ADR-0008 d1) and the sections `## Clarifications`, `## User
   Scenarios & Testing` (user stories, acceptance scenarios, edge cases), `## Success Criteria`, `## Non-goals` and
   `## Why this is worth doing`. The **design tier** is everything else the folder holds: the other sections of
   `spec.md` (`## Requirements`, `## Assumptions`, `## Root cause` among them), every other file of the folder
   (`plan.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`), the story's own task block of
   `tasks.md`, and the decision records in every folder inside the repo that `[shared] adr_folders` lists (reviewer
   ADR-0022 d1). The section a `spec.md` line belongs to is read by one splitter in `core/` (ADR-0003) over the `## `
   headings the spec template and `/speckit-clarify` fix, a trailing `*(…)*` note ignored; planner's checks and
   reviewer's gate call the same function, and no fact is read from a heading's wording (amends reviewer ADR-0014 d2
   and planner ADR-0008 d1; constitution P7 names the exception in its own PR, action item 5). An item of the intent
   tier carries an explicit id in its line, never renumbered and never reused: `**US<k>-S<n>**` on acceptance scenario
   `<n>` of `### User Story <k>`, `**EC-<nnn>**` on an edge case, `**SC-<nnn>**` on a success criterion as the
   template already writes it. A new item takes the next unused number; a removed item's id retires.
2. We will freeze the intent tier to its human. planner lands its first version, and every later change to it,
   by a spec PR on `<p>-spec` that an admin merges (org ADR-0002 d2; planner ADR-0010), from the admin's words:
   the path an entry of `adr-rulings.json` takes (planner ADR-0009 d6). The squash commit of that spec PR on the
   default branch is the intent's **ratification**; a story branch reads it at its merge base. On a story branch,
   reviewer refuses every commit that changes an intent line, `adr-rulings.json` or the `codeworks` front matter
   (reviewer ADR-0023 d1): a story writes nothing in the intent tier, not an added scenario either; what it finds
   missing it asks of the admin, as a departure from a record is asked today. No component edits the issue body.
3. We will let the story change the design tier on its own branch, in **`spec:` commits** (reviewer ADR-0023 d2): a
   commit that changes only spec-folder paths and decision records, whose body names the intent item that motivates it
   and the items it claims unaffected, and that the claim check judges before it lands. In `tasks.md` a story writes
   only the task block labelled with its issue number (OWN_BLOCK, which replaces TICK_ONLY of ADR-0011 d1 and reviewer
   ADR-0010 d1): a tick (`[ ]` to `[x]`) inside its block lands in any commit, as before; an edit inside its block
   lands in a `spec:` commit; nothing outside it. planner ADR-0009 d4 keeps `tasks.md` derived in planning; on a story
   branch the story's block is the story's. A record a story adds or supersedes keeps the form `adr check` validates
   (planner ADR-0009 d8) and sits in a folder inside the repo; the orchestrator's squash merge of the story PR
   (orchestrator ADR-0009 d1) ratifies it, as the spec PR's merge ratifies planner's. A record outside the repo is
   never changed from a story branch (planner ADR-0009 d8).
4. We will grade the code and the design tier against the intent tier, never the other way round (reviewer ADR-0023
   d3–d4): every acceptance scenario of the story's own user story has a test tagged with its id, written red first
   (constitution Principle IV; the gate lets it land before its code, org ADR-0001 d1), and no story commit may
   delete, untag, skip or mark expected-fail a tagged test while its item stands; the decision-reviewer is briefed
   with the intent at ratification and the design delta since it, and a delta that leaves an intent item unmet, or
   narrows what meets it, is an INTENT_DRIFT finding ruled ESCALATE and never FIX. A RESCOPE verdict (reviewer
   ADR-0017 d2, ADR-0013 d5) is for the intent tier alone: the ask does not settle a decision the code must take. A
   gap in the design tier is a SPEC_GAP finding ruled FIX, whose fix is a `spec:` commit.
5. We will keep every design change where the human can read it: reviewer's round record carries the spec delta
   since ratification (reviewer ADR-0023 d5), and the orchestrator posts it as a keyed comment on the PR with its App
   (orchestrator ADR-0003 d3–d4), never in the PR body, which becomes the squash message (orchestrator ADR-0009
   d6). The delta is the record of what the round graded (d4), not a gate: the one human gate on a story's design
   is the INTENT_DRIFT escalation. The orchestrator attests a story PR that
   changes a `docs/adr/` folder or the design tier of `specs/` (orchestrator ADR-0004 d4 keeps `codeworks.toml`,
   `.github/`, `.claude/`, `.specify/memory/`, `AGENTS.md` and `CLAUDE.md`), and its attestation lapses on what the
   default branch changed since the merge base, not on the story's own `spec:` commits (orchestrator ADR-0004 d1);
   reviewer's check fails a commit that removes or edits an intent line, changes the design tier outside a `spec:`
   commit or deletes, untags, skips or marks expected-fail a tagged test, however the commit was made (reviewer
   ADR-0002 d4).
6. We will read Principle VI this way: the intent tier is the fixed target, and this repo's gates, constitution
   and config are the governing rules; both ship apart from the code they grade. A decision record is the design
   tier's account of a mechanism, graded against the intent as the code is, and may change in the PR that changes
   the code it describes. This is the repo's reading until the organisation's rule names decision records (action
   item 5).

## Options considered

### Option A: Intent frozen to its human; design changed by the story in `spec:` commits, graded against the intent (chosen)

The review has a fixed target and the story has room to design. Every design change is a named, claimed commit
the admin can read on the PR.

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

## Trade-offs

- The admin reads design deltas in the story PR, from the spec delta comment, instead of in a spec PR of their own;
  nothing makes them read it before the merge, so drift the round misses is found after it.
- A story that finds its intent incomplete stops and asks, as it does for a record today; the intent gains nothing
  from a story branch.
- reviewer's gate reads `spec.md` by its fixed headings through core's splitter, and `tasks.md` by its task blocks.
- A tagged test's body can still be weakened in place; the gate refuses what code can decide (delete, untag, skip,
  expected-fail) and the round rules the rest ESCALATE, for the human.
- Explicit ids ask the spec writer to label every scenario and edge case.

## Consequences

- Easier: a story fixes its own plan, requirement or record in a commit and keeps building.
- Harder: three gates on a story branch read the spec folder's structure; the claim check judges `spec:` commits.
- **How we would know this was wrong:** a merged story whose code meets fewer intent items than at ratification;
  a design delta an admin reverts after merge that no round escalated; a story still stopping for a planning run on
  a design-tier gap.
- Revisit if: a section of `spec.md` has to move between tiers, or an intent change by a story is wanted.

## Action items

1. [x] This record; ADR-0011 superseded; amendment notes on the partially superseded items (reviewer ADR-0002 d4,
   0010 d1–d2, 0013 d5, 0014 d2, 0015 d4, 0017 d2, 0022 d4; planner ADR-0008 d1, 0009 d3, d4, d8; orchestrator
   ADR-0004 d1, d4; builder ADR-0004 d2); ADR-0010's finding-kind row; constitution 1.3.0 (Delivery Workflow, P6); the
   settled-design preset's `## Non-goals`, tier note and id labels (#342).
2. [ ] core: the `spec.md` splitter (planner's `premise_report.section` moves there) and the tier and id grammar;
   `spec_delta` on `Round`; the protected-path matcher without `docs/adr/`.
3. [ ] reviewer's gates: intent fence, `spec:` commits, OWN_BLOCK, tagged tests, the intent brief, the delta
   (reviewer ADR-0023 action items). planner: the landing check refuses an unlabelled scenario or edge case.
4. [ ] orchestrator: ADR-0004 d4's set without `docs/adr/`, the listed adr folders and `specs/`; d1's lapse from the
   default branch's own change; the spec delta comment.
5. [ ] Constitution P7, in its own PR after this one (Governance): the spec template's fixed headings, read by
   core's splitter, as its second exception.
6. [ ] `analitiq-ai/engineering`: org ADR-0002 d2 and d4 name the intent tier; the Scope discipline rule names
   decision records as design, not governing rules.
