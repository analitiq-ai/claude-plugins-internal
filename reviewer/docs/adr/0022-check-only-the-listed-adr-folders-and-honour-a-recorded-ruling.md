---
schemaVersion: 0.2.0
id: "0022"
title: "Check only the listed ADR folders and honour a recorded ruling"
status: accepted
date: 2026-11-03
deciders: ["@Analitiq-Bot-Wonka"]
tags: [decision-check, adr-folders, ruling, settings, review-round]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0013", "0017", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{adrkit,decisions}.py"
  - type: path
    pattern: "reviewer/plugin/lib/round/decisions.ts"
  - type: path
    pattern: "reviewer/plugin/lib/rules/rounds.ts"
  - type: path
    pattern: "reviewer/plugin/lib/round/assess.ts"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  ratifiedBy: "@Analitiq-Bot-Wonka"
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/177"
review:
  tier: async
  decidedAt: 2026-11-03T12:34:02Z
---

# ADR-0022: Check only the listed ADR folders and honour a recorded ruling

## Context

reviewer's decision check finds its own folders: every tracked `docs/adr`, plus `REVIEWER_ORG_ADR_DIR`, an
environment variable root ADR-0002 d3 rules out for a setting. Planner's plan check (planner ADR-0009) reads
the folders `codeworks.toml` `[shared] adr_folders` lists, through core's `adrFolders`, so the two checks
can disagree on which records govern a change. Planner ADR-0009 also lets the user overrule a departure,
recorded in the spec folder's `adr-rulings.json`; a check that ignores it reports the same departure again
at review.

## Decision

1. We will take the decision check's folders only from core's `adrFolders` (`[shared] adr_folders`), never
   from tracked `docs/adr` discovery or `REVIEWER_ORG_ADR_DIR` (root ADR-0002 d3). An unreadable listed
   folder is a check that could not run (root ADR-0004).
2. We will label each folder by its entry as written, always: in a departure's line and in matching a
   ruling alike. "Outside the repo" is only wording in a message about such a folder; "org" goes.
3. We will report no departure whose (folder, record, path) an entry of the spec folder's
   `adr-rulings.json` names (planner ADR-0009, the user's ruling).
4. We will have a departure the check reports ruled FIX or ESCALATE alone (ADR-0017 d2); an ESCALATE names
   it in the `escalation-<issue>` hold's question by its departure line (ADR-0013 d4), which planner's rescope
   reads (planner ADR-0009 d9).

## Options considered

### Option A: The listed folders through core, and the rulings file honoured (chosen)

Planner and reviewer check the same folders, and a ruling given at planning holds at review.

### Option B: Keep discovery and `REVIEWER_ORG_ADR_DIR`

Rejected: a second, divergent definition of the folders, and a setting in an environment variable.

### Option C: Check the listed folders, ignore rulings

Rejected: every ruled departure would block the story at review.

## Trade-offs

- A tracked `docs/adr` nobody lists is checked by neither planner nor reviewer.
- A ruling committed by hand into the spec folder is caught only in spec-PR review (planner ADR-0009).

## Consequences

- Easier: one setting names the folders for planner and reviewer.
- Harder: an admin must list every folder a repo's work is checked against.
- **How we would know this was wrong:** a round checking a folder `[shared] adr_folders` does not list, or
  reporting a departure an `adr-rulings.json` entry names.
- Revisit if: planner and reviewer need different folders.

## Action items

1. [ ] US5 of #177 moves the decision check onto `adrFolders` and the rulings file, after #235.
2. [ ] US6 of #177 (#285) carries an escalated departure to planner's rescope, after #235.
