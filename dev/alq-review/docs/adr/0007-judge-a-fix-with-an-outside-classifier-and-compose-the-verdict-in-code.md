---
schemaVersion: 0.1.0
id: "0007"
title: "Judge a fix with an outside classifier and compose the verdict in code"
status: accepted
date: 2026-10-06
deciders: ["@Analitiq-Bot-Wonka"]
tags: [shim-check, classifier, verdict]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: ["0015"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{jev,shimcheck,shimgate}.py"
  - type: path
    pattern: "dev/alq-review/specs/{006-shim-check-gate,011-shim-no-site-left,012-tests-only-tree}/**"
provenance:
  authoredBy: agent-drafted
  ratifiedBy: "@Analitiq-Bot-Wonka"
  agent:
    name: Claude Code
    model: claude-fable-5-1
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: async
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of ADRs this one belongs to"
---

# ADR-0007: Judge a fix with an outside classifier and compose the verdict in code

## Context

The shim check needs three judgements of a staged change: is it a fix, where does the fix act, and does it
reach the other sites with the same defect. A model has to give them, within three limits:

- The answers are needed inside a hook, so within seconds.
- The check's success criterion is a replay over recorded commits. The replay measured the questions as
  worded, so a reworded question is an unmeasured one.
- A refusal has to follow from a rule that can be tested. Asked for the overall verdict, the classifier
  answers differently from its own two answers.

Two later specs met the same limits and each added a rule. The rules are spread over three spec folders.

ADR-0015 decides that private source may be sent to the classifier.

## Decision

1. We will judge a fix with Jev, an outside one-shot classifier.
2. We will ask it narrow choice questions, each with a fixed set of answers, and never the overall verdict.
3. We will compose the verdict in code.
4. We will keep the replayed questions word for word. A change to their wording or to the request's shape
   needs a new replay.
5. We will store an answer as Jev gave it, so the ledger and the log report what it said. Code may leave an
   answer unread; it does not rewrite one.
6. We will put a rule in code ahead of the model wherever code can decide.

## Options considered

### Option A: An outside classifier, choice questions, verdict in code (chosen)

| Dimension | Assessment |
|---|---|
| Fits inside a hook | Yes, a call is about a second |
| Verdict rule | Set in code |
| What leaves the org | The diff of the change, and for a fix the lists of sites (ADR-0015) |

### Option B: Do nothing

The sweep lists sites and nothing says whether the change reaches them. No source weighed a different judge.

### Option C: Ask Jev for the overall verdict

Rejected: its overall answer would differ from its two answers.

## Trade-offs

- A diff too large for the classifier cannot be judged, and the commit must be split. Measured: 6 to 8% of
  recent commits.
- A better-worded question cannot ship on its own. It needs a new replay first, and the replay calls live Jev.
- The answer to "is it a fix" is not stable on one ask, so it is asked more than once. In the replay it called
  close to half of the non-fix commits a fix.

## Consequences

- Easier: a change to the verdict rule is a code change with a unit test. The stored answers are Jev's own.
- Harder: every change to a question, or to what is sent with it, waits on a replay.
- **How we would know this was wrong:** the replay stops giving every evidence fix its expected verdict; or
  the share of commits refused as too large rises above the measured 6 to 8%.
- Revisit if: the model is changed or withdrawn, or a judge inside the session can answer within the hook's time.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
