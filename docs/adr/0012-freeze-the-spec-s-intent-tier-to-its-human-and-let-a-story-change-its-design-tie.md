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
relatesTo: ["0002", "0006", "0010", "0011"]
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
    url: "https://github.com/analitiq-ai/engineering/blob/main/docs/adr/0001-red-test-first.md"
    label: "org ADR-0001: Write the red test first"
---

# ADR-0012: Freeze the spec's intent tier to its human and let a story change its design tier in the PR it builds

## Context

ADR-0011 let planner alone write a spec folder and a decision record, so a story that finds its plan wrong, a
requirement unstated or a record departed from stops and waits for a planning run: a RESCOPE verdict, a rescope
hold, a spec PR, a merge of the default branch, a new round. Three stories (#177, #209, #217) have circled that
loop for days; 27 of the repo's 123 PRs closed unmerged, and the corpora hold 52 records, many landed to unblock
one story. ADR-0011 guarded a real risk: an agent that writes the spec and the code it is graded against can move
the target to fit the code, a little each round, until the merged work is not what was asked for. It guarded it
by freezing the whole folder, as if every line of a spec were the ask. Two things live in a spec folder: what the
human wants, and how the agent proposes to get there. Only the first has to stay fixed for the review to grade
anything; the second is the agent's own work, and is graded like the code. Principle VI (a governing rule ships
apart from the code it governs) needs a fixed target; the target is the ask, not the agent's design of its
solution.

## Decision

1. We will split a spec folder into two tiers. The **intent tier** is the spec's issue body and, in `spec.md`, the
   sections `## User Scenarios & Testing` (user stories, acceptance scenarios, edge cases), `## Success Criteria`,
   `## Non-goals` and `## Why this is worth doing`. The **design tier** is everything else the folder holds:
   `## Requirements` (functional requirements, key entities), `## Assumptions` and `## Root cause` in `spec.md`;
   `plan.md`, `research.md`, `premise.md`; `tasks.md`; and the decision records a story's change governs, in every
   folder `[shared] adr_folders` lists (reviewer ADR-0022 d1). `adr-rulings.json` is the user's ruling and keeps
   planner ADR-0009 d6's one writer. An item of the intent tier is named by an id: `US<k>-S<n>` for acceptance
   scenario `<n>` of `### User Story <k>`, `EC<n>` for edge case `<n>`, `SC-<n>` for success criterion `<n>`, each
   `<n>` the item's ordinal in its list. A section is read by its heading, an item by its ordinal: a grammar, not
   prose (constitution P7).
2. We will freeze the intent tier to its human. planner lands its first version, and every later change to it,
   by a spec PR on `<p>-spec` that an admin merges (org ADR-0002 d2; planner ADR-0010), from the admin's words:
   the path an entry of `adr-rulings.json` takes. The merge commit of that spec PR on the default branch is the
   intent's **ratification**; a story branch reads it at its merge base. On a story branch, reviewer refuses every
   commit that removes or edits a line of an intent section (reviewer ADR-0023 d1); a story may **add** a scenario,
   an edge case or a success criterion, in a `spec:` commit (d3), and may not add to `## Non-goals` or `## Why this
   is worth doing`, which only narrow or re-argue the ask. No component writes the issue body.
3. We will let the story change the design tier on its own branch, in **`spec:` commits** (reviewer ADR-0023 d2): a
   commit that changes only spec-folder paths and decision records, whose body names the intent item that motivates
   it and the items it claims unaffected, and that the claim check judges before it lands. In `tasks.md` a story
   writes only the task block labelled with its issue number (OWN_BLOCK, which replaces TICK_ONLY of ADR-0011 d1 and
   reviewer ADR-0010 d1): a tick (`[ ]` to `[x]`) inside its block lands in any commit, as before; an edit inside its
   block lands in a `spec:` commit; nothing outside it. planner ADR-0009 d4 keeps `tasks.md`
   derived in planning; on a story branch the story's block is the story's. A record a story adds or supersedes
   keeps ADR-0002's form, and an admin's merge of the story PR ratifies it as the spec PR's merge ratifies
   planner's.
4. We will grade the code and the design tier against the intent tier, never the other way round (reviewer
   ADR-0023 d3–d4): every acceptance scenario has a test tagged with its id, written red first (org ADR-0001), that
   no story commit may delete, untag, skip or mark expected-fail while the scenario stands; the decision-reviewer is
   briefed with the intent at ratification and the design delta since it, and a delta that leaves an intent item
   unmet, or narrows what meets it, is ruled ESCALATE and never FIX. A RESCOPE verdict (reviewer ADR-0017 d2,
   ADR-0013 d5) is for the intent tier alone: the ask does not settle a decision the code must take. A gap in the
   design tier is a `spec_gap` finding ruled FIX, whose fix is a `spec:` commit.
5. We will show the human every design change before the story merges: reviewer's round record carries the spec
   delta since ratification (reviewer ADR-0023 d5), and the orchestrator writes it into the PR body it owns, so the
   admin who moves the card to Ready reads it there. The orchestrator attests a story PR that changes a `docs/adr/`
   folder or the design tier of `specs/` (orchestrator ADR-0004 d4 keeps `codeworks.toml`, `.github/`, `.claude/`,
   `.specify/memory/`, `AGENTS.md` and `CLAUDE.md`); reviewer's check fails a commit that removes or edits an intent
   line or weakens a tagged test, however the commit was made (reviewer ADR-0002 d4).
6. We will read Principle VI this way: the intent tier is the fixed target, and this repo's gates, constitution
   and config are the governing rules; both ship apart from the code they grade. A decision record is the design
   tier's account of a mechanism, graded against the intent as the code is, and may change in the PR that changes
   the code it describes.

## Options considered

### Option A: Intent frozen to its human; design changed by the story in `spec:` commits, graded against the intent (chosen)

The review has a fixed target and the story has room to design. Every design change is a named, claimed commit
the admin reads before Ready.

### Option B: Keep ADR-0011: planner alone writes the folder and the records

Rejected: observed cost. Every design gap is a planning run and a merge of the default branch; stories circle for
days and records land to unblock one story.

### Option C: Let the story change any part of the spec, reviewed in its PR

Rejected: the risk ADR-0011 named is real. The review grades the code against a target the same agent moved in
the same PR; a scenario deleted with the code that failed it leaves no trace a round can rule on.

### Option D: Design changes by a story-opened spec PR on `<p>-spec`

Rejected: still a second PR, a merge of the default branch and a new round per design change, and the admin reviews
the design twice, once apart from the code it is for.

### Option E: Freeze the intent and the design, free only the records

Rejected: half a fix. An unstated requirement or a wrong plan path stops a story more often than a record does.

## Trade-offs

- The admin reads design deltas in the story PR, from the spec delta, instead of in a spec PR of their own.
- A story may widen its intent by adding scenarios; every addition is in the delta and needs a tagged test.
- reviewer's gate reads `spec.md` by its section headings and list ordinals, and `tasks.md` by its task blocks.
- A tagged test's body can still be weakened in place; the gate refuses what code can decide (delete, untag, skip,
  expected-fail) and the round rules the rest ESCALATE, for the human.

## Consequences

- Easier: a story fixes its own plan, requirement or record in a commit and keeps building.
- Harder: three gates on a story branch read the spec folder's structure; the claim check judges `spec:` commits.
- **How we would know this was wrong:** a merged story whose code meets fewer intent items than at ratification;
  a design delta an admin reverts after merge that no round escalated; a story still stopping for a planning run on
  a design-tier gap.
- Revisit if: a section of `spec.md` has to move between tiers, or an intent change by a story is wanted.

## Action items

1. [x] This record; ADR-0011 superseded; amendment notes on the partially superseded items (reviewer ADR-0002 d4,
   0010 d1–d2, 0013 d5, 0015 d4, 0017 d2, 0022 d4; planner ADR-0009 d3, d4, d8; orchestrator ADR-0004 d4);
   constitution 1.3.0; the settled-design preset's `## Non-goals` and tier note (#342).
2. [ ] reviewer's gates: intent fence, `spec:` commits, OWN_BLOCK, tagged tests, the intent brief, `specDelta` on
   the round record (reviewer ADR-0023 action items).
3. [ ] orchestrator: the protected set of ADR-0004 d4 without `docs/adr/` and `specs/`; the spec delta in the PR
   body; core's protected-path matcher to match.
4. [ ] org ADR-0002 d2 and d4 amended in `analitiq-ai/engineering` to name the intent tier.
