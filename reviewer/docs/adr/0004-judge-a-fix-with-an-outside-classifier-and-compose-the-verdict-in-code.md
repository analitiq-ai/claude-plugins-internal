---
schemaVersion: 0.1.0
id: "0004"
title: "Judge a fix with an outside classifier and compose the verdict in code"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [shim-check, classifier, verdict]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0009"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/{jev,shimcheck,shimgate}.py"
  - type: path
    pattern: "specs/{011-shim-no-site-left,012-tests-only-tree}/**"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
---

# ADR-0004: Judge a fix with an outside classifier and compose the verdict in code

## Context

The shim check needs three judgements of a checked change (ADR-0002): is it a fix, where does the fix act, and
does it reach the other sites with the same defect. A model has to give them, within two limits:

- Only hooks read the classifier's key (root ADR-0008), so the answers are needed inside a hook, within
  seconds.
- A refusal has to follow from a rule that can be tested. Asked for the overall verdict, the classifier
  answers differently from its own two answers.

ADR-0009 decides that private source may be sent to the classifier.

## Decision

1. We will judge a fix with an outside one-shot classifier, called from the hook.
2. We will ask it narrow choice questions, each with a fixed set of answers, and never the overall verdict.
3. We will compose the verdict in code.
4. We will store an answer as the classifier gave it, so the ledger and the log report what it said.
   Code may leave an answer unread; it does not rewrite one.

## Options considered

### Option A: An outside classifier, choice questions, verdict in code (chosen)

| Dimension | Assessment |
|---|---|
| Fits inside a hook | Yes, a call is about a second |
| Verdict rule | Set in code |
| What leaves the org | The diff of the change, and for a fix the lists of sites (ADR-0009) |

### Option B: Do nothing

The sweep lists sites and nothing says whether the change reaches them.

### Option C: Ask the classifier for the overall verdict

Rejected: its overall answer would differ from its two answers.

### Option D: A judge inside the session

Rejected: an agent cannot answer within the hook's time.

## Trade-offs

- A diff too large for the classifier cannot be judged, and the commit must be split: 6 to 8% of recent
  commits, measured.
- The answer to "is it a fix" is not stable on one ask, so it is asked more than once; on recorded commits
  it called close to half of the non-fix commits a fix.
- A call to an outside service sits on the hook path.

## Consequences

- Easier: a change to the verdict rule is a code change with a unit test. The stored answers are the
  classifier's own.
- Harder: the check depends on one outside model and its provider.
- **How we would know this was wrong:** recorded fixes stop getting their expected verdict, or the share of
  commits refused as too large rises above 6 to 8%.
- Revisit if: the model is changed or withdrawn, or a judge inside the session can answer within the hook's
  time.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
