---
schemaVersion: 0.2.0
id: "0021"
title: "Count a review verdict only from live answers of reviewer's own workflow, launched by the gate"
status: accepted
date: 2026-10-22
deciders: ["@Analitiq-Bot-Wonka"]
tags: [review-round, claim-check, shim-check, launch-gate, verdict, hooks]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0003", "0011", "0012", "0019"]
affects:
  - type: path
    pattern: "reviewer/plugin/hooks/hooks.json"
  - type: path
    pattern: "reviewer/plugin/scripts/{gate,claimgate,shimgate,ledger}.py"
  - type: path
    pattern: "reviewer/plugin/workflows/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/145"
  ratifiedBy: "@Analitiq-Bot-Wonka"
review:
  tier: async
  decidedAt: 2026-10-28T14:35:54Z
---

# ADR-0021: Count a review verdict only from live answers of reviewer's own workflow, launched by the gate

## Context

One Claude Code session runs the orchestrator, builder and reviewer. reviewer records each round as the
reviewer App, and the orchestrator attests `internal-review` only from that record (ADR-0011), so a
verdict reviewer counts lets code merge. The model in that session can launch any workflow, pass a script
or a `scriptPath`, resume a run, and write the files a run's journal, results and notifications are
read from. A verdict read from any of those can be forged.

## Decision

1. We will have reviewer's `PreToolUse` hook rewrite every `Workflow` launch that names a reviewer
   workflow to that name and the args the gate supplies,
   dropping `script`, `scriptPath` and `resumeFromRunId`, and record the launch.
2. We will have its `PostToolUse` hook record the run ID only for a recorded launch. The run is invalid
   when its run ID was seen before, or when the executed script copy (`tool_response.scriptPath`)
   differs from the plugin's file. A run the gate did not record never counts.
3. We will count a verdict only from a live `StructuredOutput` event of an agent bound to that run by its
   `agent_transcript_path`; never from task notifications, task output files, the journal or transcripts.
4. We will rule a round INCOMPLETE when an expected agent is silent, else DIRTY when one found
   something, else CLEAN.
5. We will let every other workflow run untouched, counting none of its results.
6. We will have reviewer agents read only an export of the committed head, made by the hook from a bare
   copy the hooks own, never the model's working tree. Hooks take the session's commits into that copy
   only by a fetch from the model's clone, and run no other git command in the clone (`SECURITY.md`).

## Options considered

### Option A: The gate launches the run and counts only live, bound answers (chosen)

### Option B: A classifier judging the round's result

Rejected: it cannot tell a faked result from a real one.

### Option C: Trust the workflow's final result or its notification

Rejected: tested forgeable by replaying the journal.

### Option D: A hook-side check of the workflow's name only

Rejected: tested bypassed by a launch naming the workflow and a `scriptPath`.

### Option E: Run review in CI

Rejected by the user in favour of one session running every component.

### Option F: Reviewer agents read the model's working tree

Rejected: the model can change the files a running round reads, and a repository the model wrote can run
its own code inside git.

## Trade-offs

- The rule rests on hook fields Claude Code does not promise to keep (`tool_response.scriptPath`,
  `agent_transcript_path`, the `StructuredOutput` event); if one changes, no verdict counts and every
  story stalls.
- Every reviewer agent must answer through `StructuredOutput`; an answer given any other way is lost.
- Each round costs an export of the head; an uncommitted change is never reviewed.

## Consequences

- Easier: every counted verdict traces to a run the gate launched and agents it bound.
- Harder: a new reviewer workflow must be added to the gate's list, or its results never count.
- **How we would know this was wrong:** a verdict recorded from a replayed or resumed run, from a script
  copy that differs from the plugin's file, or from an agent not bound to the run; a CLEAN round with an
  expected agent missing.
- Revisit if: Claude Code signs a workflow's result, or review moves out of the session.

## Action items

1. [ ] Reviewer's gate tests cover every decision here, Decisions 5 and 6 included.
2. [x] The ratifier ratifies this record, or sends it back.
