---
schemaVersion: 0.2.0
id: "0001"
title: "Drive the issue loop from the orchestrator plugin's hooks inside the agent session"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [orchestrator, issue-loop, automation, plugins, github-app, hooks]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0002", "0003", "0009"]
affects:
  - type: path
    pattern: "orchestrator/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/133"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:48Z
---

# ADR-0001: Drive the issue loop from the orchestrator plugin's hooks inside the agent session

## Context

Between a story's turns, code, not the model, must make the next move from GitHub's state. The model's
token writes nothing (root ADR-0007), so every GitHub write a turn needs is a hook's.

## Decision

1. We will make the orchestrator a plugin, importing only `core/` (root ADR-0001), whose hooks act as
   its own GitHub App, `codeworks-orchestrator` (contents, pull requests, issues, checks and workflows
   write; organization projects write), its key read only by hooks (root ADR-0008). Workflows write lets
   it push a merge of the default branch that carries a workflow change; reviewer passes no other change
   to `.github/` (reviewer ADR-0002 d4). "The orchestrator" in these
   records means these hooks.
2. We will give it only these inputs: the prompt that names the session's issue; the board and its
   issues (lane and when it was set, parent, sub-issues, `blockedBy`, closer); open PRs, their changed files,
   review threads, mergeable field, statuses and checks at the head; issue comments with author, edit
   and time; reviewer's state record on the `ledger` branch (reviewer ADR-0011); an exempt label's labeled event,
   its sender, that sender's permission and the head's push time (ADR-0005); the effective rules for
   each PR's base branch (ADR-0009); the session's commits; reviewer's commit-check pass record for the
   session, its passes by branch and whether reviewer is off (reviewer ADR-0006); its own section and `[shared]` of
   `codeworks.toml` (root ADR-0002); its hook's event. It parses no prose except through `core/`'s
   modules (root ADR-0003) and runs no LLM.
3. We will drive the loop from four hooks. SessionStart mints the session's token (root ADR-0007), and
   PreToolUse mints a new one before it expires, so a turn longer than the token's hour keeps one.
   The prompt `/codeworks <issue>` claims or resumes that issue when ADR-0002 lets it, refusing any other
   with the reason, and names `builder:issue-tackle <s>`; nothing picks an issue on its own. Stop refuses
   the stop with the next step until none is left. It ignores a Stop while a workflow runs and takes no
   task notification as a prompt. How it waits on CI and the external reviewers, up to `review_timeout`
   (ADR-0008), is its spec's to settle.
4. We will have the orchestrator's hooks push the session's commits and open the story PR as a draft
   after the first push (builder ADR-0003). Every commit a push adds, but those a merge of the default
   branch brings in from it, must have passed reviewer's commit check (reviewer ADR-0002), or, while reviewer
   is off for the session (reviewer ADR-0006), touch no `.github/` folder. At stage 2
   (ADR-0004) a push adds only commits that a FIX ruling names or a merge of the default branch. Which
   hook pushes, and when in a turn, is this plugin's spec to settle.
5. We will have a hook that crashes or times out attest, flip, push and merge nothing.
6. We will have builder and planner poll nothing on their own: each ends its turn at its draft PR or a
   stop before one (builder ADR-0003, planner ADR-0010); the wait is the Stop hook's step.
7. We will move a story's card to Blocked, naming the bound, on REPEAT (a turn that had work, an unattested
   head or findings, ended with both unchanged and still needing work), on two turns in a row from a working
   lane each ending with an unattested head, or when a count below reaches its threshold. A Ready move resets
   every count.
8. We will count a story's turns toward `max_turns`, and the sessions on it that ended without their
   Stop hook toward `k_deaths`, which the next session on the issue infers from a start its hooks
   recorded with no end; nothing outside the session watches how one ends. These and `review_timeout`
   are `[orchestrator]` keys.

## Options considered

### Option A: The orchestrator plugin's hooks (chosen)

### Option B: A cron prompt

Rejected: not deterministic.

### Option C: builder's model drives the loop

Rejected: the model would make the moves its review grades.

### Option D: A script on its own host, or a program that runs between sessions

Rejected: a second host and a launch lock. The user dropped the between-session program on 2026-10-25.

### Option E: The org's existing App

Rejected: its other users would pass the trust filters.

### Option F: SessionStart claims the next Ready story

Rejected by the user on 2026-10-26: an admin names the issue each session tackles.

### Option G: A launcher that watches how each session ends, and a session time limit

Rejected by the user on 2026-10-26: the next session infers an end without the Stop hook, with no
component added.

## Trade-offs

- A move waits for the session's next hook run.
- A crashed Stop hook fails open: the session ends with nothing attested.
- A session waiting on an external reviewer stays open for up to `review_timeout`.

## Consequences

- Easier: no launcher, host or lock; the model holds no privileged key.
- Harder: diagnosis spans GitHub and the session transcript; a CI check keeps `orchestrator/` importing
  no other plugin.
- **How we would know this was wrong:** an admin moving a card for the orchestrator, or a push of a
  commit the agent identity did not make.
- Revisit if: the hook loop fails its tests, or a board needs a second session.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
