---
schemaVersion: 0.2.0
id: "0009"
title: "Check the plan and its tasks against the governing decision logs before landing"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [adr, alignment, planning, decision-log, workflow]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0010"]
affects:
  - type: path
    pattern: "planner/plugin/speckit/workflows/**"
  - type: path
    pattern: "planner/plugin/skills/issue-spec/**"
  - type: path
    pattern: "core/src/adr.ts"
  - type: path
    pattern: "core/src/adr-folders.ts"
  - type: path
    pattern: "core/src/contracts/decision-check.ts"
  - type: path
    pattern: "core/src/contracts/tasks.ts"
  - type: path
    pattern: "planner/plugin/scripts/adr_check.ts"
  - type: path
    pattern: "planner/plugin/lib/adr-check.ts"
  - type: path
    pattern: "planner/plugin/speckit/presets/settled-design/commands/speckit.plan.md"
  - type: path
    pattern: "planner/plugin/scripts/rescope_questions.ts"
  - type: path
    pattern: "planner/plugin/speckit/presets/settled-design/commands/speckit.tasks.md"
  - type: path
    pattern: "planner/plugin/scripts/land.ts"
  - type: path
    pattern: "planner/plugin/lib/story-plan.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:55Z
---

# ADR-0009: Check the plan and its tasks against the governing decision logs before landing

## Context

Decision records bind a plan from more than one folder: this repo's own, and folders outside it, such as
the org's. Unchecked at planning, a contradiction first surfaces at reviewer's decision-reviewer, after the
code is written. `adr check` names the records that govern a path, not whether the plan departs from one.
The tasks, written from the plan after critique, name the paths each story touches. A plan can still change
after critique and after a check stops, and a check that skips what it judges unchanged misses that change.

## Decision

1. We will run one `adr check` after critique, once the tasks are written, before the run completes, over the
   paths the plan names (d7) and the paths `tasks.md`'s task lines name, each departure naming its stories,
   against each folder `codeworks.toml` `[shared] adr_folders` lists (root ADR-0002), each folder its own
   outcome (root ADR-0004); a FAIL or COULD_NOT_RUN in any stops the run. The check is a loop, one round per
   resume after a stop, and each round works out everything again from the files as they then stand: the
   settled-design check, the plan's paths, the tasks when their sources changed (d4), the story checks landing
   makes, and the ADR check itself; nothing is skipped as unchanged. A round that would pass on files changed
   since it read them runs again, so the run completes only on files a round checked. A public repo lists no path
   to private ADRs.
2. We will check the folder on disk at the listed path, with no network call and no credential. Keeping it
   current is the admin's.
3. We will commit a record the plan needs into the spec PR beside the spec it governs (ADR-0010), and a
   record found late into the rescope's spec PR; it governs a story in flight as reviewer ADR-0010 decides.
4. We will treat `tasks.md` as derived from the plan: a round writes it again with the tasks command when it is
   missing or when a file that command reads (`spec.md`, `plan.md`, `research.md`, `data-model.md`,
   `quickstart.md`, `contracts/`, the constitution) changed since it was last written, and never otherwise.
   Nobody edits it by hand: a fault in it is fixed in the plan or the spec, or by deleting it so the next round
   writes it again. The checks landing makes of `tasks.md` (its story plan and, on a new spec, the spec issue's
   sub-issues, read as the planner App, as landing reads them) run in every round, so they stop while the run can
   still resume; a rescope's existing stories are reconciled where a rescope lands (ADR-0010 d5);
   an edit to `tasks.md` after the run is checked only in spec-PR review, as an entry committed by hand to the
   rulings file is (d6).
5. We will have a headless model step judge the plan and the tasks against each record `adr check` names as
   governing, one answer per record, and decide each folder's outcome in code from those answers. This
   record owns the sets below, in core's contracts (root ADR-0010 d3).

   | Set | Value | Meaning |
   |---|---|---|
   | `AdrJudgment` | `WITHIN` | the artifact sits inside the record: it does nothing the record rejected or contradicts |
   | `AdrJudgment` | `DEPARTS` | the artifact does what the record rejected, contradicts what it chose, or breaks a consequence it commits to |
   | `CheckedArtifact` | `plan` | a path the check read from the plan (d7) |
   | `CheckedArtifact` | `tasks` | a path a task line of `tasks.md` names (d4) |

6. We will keep the user's rulings that a named departure is not one only in `<spec folder>/adr-rulings.json`,
   which lands in the spec PR. The check is its only writer, and writes only the ruling a resume carries, once
   it matches a departure that resume's round found; a ruling that matches none is refused. A ruling applies to
   the resume carrying it only. Neither the judge nor the driving session gives one. Every later round and
   check of the spec folder drops a departure an entry names; spec-PR review is the check on an entry committed
   by hand.
7. We will have a headless model step of each round read `plan.md` as it then stands and list the paths it
   creates, changes or deletes; only planner's check reads the list, and `plan.md` carries none. The round
   records the plan and spec it listed them from, and a plan or spec changed after that stops the round, so the
   next round lists them again: the paths follow every change to the plan, and a departure's next step is
   "change `plan.md`".
8. We will name the next steps in every stop. For a departure, in the plan's paths or the tasks': change
   `plan.md`, from which the next round writes the tasks again (d4); supersede the record, into the spec PR
   when its folder is inside this repo (d3), or in the repo that holds the folder when it is outside; or resume
   with a ruling (d6). A departure found at review (d9) names only the last two: its path is checked whatever
   the plan says, so changing the plan does not clear it. A FAIL caused by a record's own `adr check` error names
   the record file and adrkit's rule and message, and its next step is "fix that record". A `tasks.md` the
   story checks refuse: delete it, then resume.
9. We will have a rescope take its open decision from the questions of every open `escalation-<issue>` hold,
   and every open `rescope-<issue>` hold a verdict placed, on every open story issue under the spec's issue, the spec's
   issue itself when it has no sub-issues (reviewer ADR-0013 d4, d5), and from the admin's words when there
   are none. The check adds the file of each ADR departure line in them to the paths it checks and
   stops on it as on a departure the judge named (d8), until a ruling names it (d6) or a superseding record no
   longer departs; one (folder, record, file) from several stories is one stop and one ruling. The ruling
   lands in the rescope's spec PR, and every story under the spec then merges the default branch and runs a
   new round that reads it (orchestrator ADR-0004 d1, reviewer ADR-0022 d3).

## Options considered

### Option A: One check after the tasks, every round working out everything again (chosen)

A plan and its tasks pass only against every folder the repo declares binds them, as they stand when the run
completes, whatever changed at the critique gate or at any stop.

### Option B: The repo's own records alone

Rejected: a folder outside the repo binds the plan too, and its records would go unchecked.

### Option C: Check the folder as it is on disk, current or not (chosen)

Accepted: the folder at the listed path is what is checked, and keeping it current is the admin's. The
check needs no network and no credential, and a stale checkout is the admin's to pull.

### Option D: Only the review-round decision-reviewer

Rejected: the contradiction would surface after the code is written.

### Option E: A record on its own `<p>-adr-<slug>` branch and PR

Rejected: a second branch kind and a second rule blocking a story's start, for a record the spec PR
carries with no code beside it either way.

### Option F: Check against the org log at its remote head

Rejected: every planning machine would need the network and read access to the org's remote, and planning
would stop when it did not answer, for no fault of the plan.

### Option G: A ruling as a note in `plan.md` or on a task line, or as a workflow input

Rejected: two places and two grammars, a round may write `tasks.md` again, and a workflow input persists to
every later round, which the user did not rule on.

### Option H: The plan's paths as a section of `plan.md`

Rejected by the user on 2026-11-03: only planner's check reads the paths, and in `plan.md` they would mislead the
builders and reviewers who read the plan but never use them.

### Option I: The plan step writes the paths

Rejected on 2026-11-03: a resume after a plan fix runs the check again, not the plan step, so the paths would
still be the old plan's.

### Option J: The admin retypes a departure found at review into the rescope

Rejected: the departure is already in the hold's question; retyping it is a second copy that can drift.

### Option K: A check after plan, before critique, and a second after tasks

Rejected on 2026-11-04: the plan changes after the first check, at the critique gate and at the second
check's stops, so the second had to re-check the plan when it judged it changed and skip it otherwise, and one
resume's ruling reached both. Checked against Spec Kit 1.1.3 with a stand-in, that let a plan edited while the
tasks were written again, and a superseded record, pass unchecked, and applied a ruling in a check the user had
not ruled in.

## Trade-offs

- Each round runs one more headless step, to write the paths, and the tasks command again when the plan
  changed.
- Critique reviews a plan the check has not yet seen; a departure found after critique is fixed in `plan.md`
  without a second critique.
- A folder outside the repo that is behind its remote may lack the record that now binds; the plan passes
  against what the admin keeps there.
- A departure the user accepts costs a resume carrying the ruling.
- An entry committed to the rulings file by hand, or a `tasks.md` edited after the run, is checked only in
  spec-PR review.

## Consequences

- Easier: a contradiction is found while the plan and the tasks are the cheapest things to change.
- Harder: every machine that runs planning needs each listed folder outside the repo at its listed path.
- **How we would know this was wrong:** the decision-reviewer keeps finding contradictions with records the
  check had seen, or with records a stale outside folder lacked.
- Revisit if: a listed folder stops being a folder on disk.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
