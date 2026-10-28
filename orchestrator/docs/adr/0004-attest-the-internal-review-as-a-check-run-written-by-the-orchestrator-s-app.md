---
schemaVersion: 0.2.0
id: "0004"
title: "Attest the internal review as a check run written by the orchestrator's App"
status: accepted
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [attestation, check-run, merge-gate, github-app, orchestrator]
scope: component
reversibility: two-way-door
blastRadius: org
relatesTo: ["0003", "0005", "0009"]
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

# ADR-0004: Attest the internal review as a check run written by the orchestrator's App

## Context

The merge contract is GitHub's ruleset (ADR-0009), which needs a check saying the internal review
passed. reviewer's hook records each round, as the reviewer App, on the story issue (reviewer
ADR-0011, ADR-0021). Which credential turns that record into the trusted check is the
ruleset's trust root. A PR can also change the config, workflows and hooks that grade it.

## Decision

1. We will attest the internal review, stage 1, as the check run `internal-review` at the head: success when
   reviewer's state (reviewer ADR-0011) records an INTERNAL or AUDIT round CLEAN or CONVERGED_PUSHBACK at the
   head or a commit in its history, and no hold is open; success marked "exempt" on an exempt PR (ADR-0005);
   else pending. Later commits and github rounds, stage 2, never undo that round, except that it lapses, and a
   new internal round runs at the head, when: the default branch's `spec.md` of the story's spec, its
   `**/docs/adr/` folders or `.specify/memory/` differ from those at the round's commit; a merge of the
   default branch since that round differs from the merge git makes of its parents without conflict; or an
   admin's comment released a hold since that round (reviewer ADR-0013), the new round briefed with it. On a
   lapse for the default branch's files, that round runs after builder merges the default branch (builder
   ADR-0004). A `/codeworks reset` lapses nothing. At every hook run the orchestrator rewrites each open PR's
   `internal-review` and `<module>-review` (ADR-0008) whose value changed.
2. We will write it with the orchestrator's App (ADR-0001), from GitHub state alone; only hooks read
   its key (root ADR-0008).
3. We will rely on the ruleset's pin of `internal-review` to that App (ADR-0009): a check from
   any other App, or a commit status of that name, counts for nothing.
4. We will never attest a PR that changes `codeworks.toml`, `.github/`, `.claude/`, `.specify/memory/`,
   a `docs/adr/` folder, or an `AGENTS.md` or `CLAUDE.md` file, at any depth and in any letter case,
   Bot-authored or not: its card goes to Blocked naming the paths, and only an exempt label (ADR-0005)
   attests it. A validator's own config, `.deepsource.toml` for one, belongs to its package in
   `validators/` (root ADR-0003) and is not on this list.
5. We will never attest a fork PR (head repo ≠ base repo) from reviewer's state; the exempt label still
   applies (ADR-0005).

## Options considered

### Option A: The orchestrator's App writes the check run from reviewer's state comment (chosen)

One writer; only hooks read its key.

### Option B: An attestation comment a second App turns into the check

Rejected: a comment would be the attestation's only evidence.

### Option C: reviewer writes the check itself

Rejected: one App would both record and attest a round.

### Option D: Attest fork PRs from reviewer's state like same-repo PRs

Rejected: a fork author names the branch and opens the PR outside any session.

### Option E: A commit status

Rejected: a commit status names no creator; a check run names the App that wrote it.

### Option F: Run the internal review again at every head

Rejected: each stage 2 fix would return to stage 1; external reviewers grade every head.

## Trade-offs

- Rounds run inside the session they grade; only the gate keeps a forged verdict out of the record.
- A config, workflow or hook change waits on an exempt label; a fork PR on one or a same-repo push.
- Stage 2 commits get the external reviews alone; rewriting history restarts stage 1.

## Consequences

- Easier: the model never reads the attesting key.
- Harder: no session, no attestation; a mid-turn hold reaches the check at the next hook run.
- **How we would know this was wrong:** an attesting round no review round produced, or a
  protected-path or fork PR attested from reviewer's state.
- Revisit if: rounds leave the session (root ADR-0007), or the ruleset stops being the merge
  contract.

## Action items

1. [x] The ratifier ratifies this record, or sends it back.
