---
schemaVersion: 0.1.0
id: "0007"
title: "Judge a fix with an outside classifier and compose the verdict in code"
status: draft
date: 2026-10-06
deciders: []
tags: [shim-check, classifier, verdict]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{jev,shimcheck,shimgate}.py"
  - type: path
    pattern: "dev/alq-review/specs/{006-shim-check-gate,011-shim-no-site-left,012-tests-only-tree}/**"
provenance:
  authoredBy: agent-drafted
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
    label: "The batch of decision records this one belongs to"
---

# ADR-0007: Judge a fix with an outside classifier and compose the verdict in code

## Context

The shim check needs three judgements of a staged change: is it a fix, where does the fix act, and does it
reach the other sites with the same defect. A model has to give them, and spec 006 sets three limits on how:

- The answers are needed inside a hook. Spec 006 research R6 gives the hook 40 seconds of model time.
- The check's success criterion SC-001 is a replay over recorded commits. The replay measured the questions
  as worded, so a reworded question is an unmeasured one.
- A refusal has to follow from a rule that can be tested. Spec 006 notes that the classifier would answer
  "complete?" differently from its own two answers.

Specs 011 and 012 later met the same limits and each added a rule. The rules are spread over three spec folders.

## Decision

1. We will judge a fix with Jev, an outside one-shot classifier reached through OpenRouter.
2. We will ask it narrow choice questions, each with a fixed set of answers, and never the overall verdict:
   "the verdict is composed from the two answers only" (spec 006 spec, edge cases).
3. We will compose `complete` or `patch` in code, in one function.
4. We will keep the `level` and `coverage` questions as they were replayed. They "are copied verbatim because
   SC-001 rests on them" (spec 006 R6). A change to their wording or to the request's shape needs a new replay.
5. We will store an answer as Jev gave it. Code may leave an answer unread; it does not rewrite one (spec 011 R1).
6. We will put a rule in code ahead of the model wherever code can decide (spec 012 R3).
7. We will send the code of every repo, private ones included, to OpenRouter and TypeSafe. Spec 006's plan
   records this as the user's decision.

## Options considered

### Option A: An outside classifier, choice questions, verdict in code (chosen)

| Dimension | Assessment |
|---|---|
| Time and cost per call | 0.39 to 0.63 s and about $0.0008 to $0.0009 on the largest replay diff (spec 006 R6) |
| Verdict rule | Set in code |
| What leaves the org | The diff of the change, and for a fix the lists of sites |

### Option B: Do nothing

The sweep lists sites and nothing says whether the change reaches them. No source weighed a different judge.

### Option C: Ask Jev for the overall verdict

Rejected in spec 006: its overall answer would differ from its two answers. The replay's third question is not sent.

### Option D: Rewrite `coverage` to `none_other` when no site is left

Rejected in spec 011 R1: "the ledger and log would misreport Jev's answer".

### Option E: Skip the `coverage` question when no site is left

Rejected in spec 011 R1: it is "a second request shape", and SC-001 rests on replaying one shape.

### Option F: Leave a tests-only change to Jev's `kind` answer

Rejected in spec 012 R3: it "keeps red-test-first commits refusable".

## Trade-offs

- Private source leaves the org. The check also needs an OpenRouter key wherever the plugin runs, "the bot
  image included" (spec 006 research, Limits).
- A code diff over about 33k tokens cannot be classified, and the commit must be split. Spec 006 measured 6 to
  8% of 638 recent commits.
- A better-worded question cannot ship on its own. It needs a new replay first, and the replay calls live Jev.
- `kind` is not stable on one ask. In the replay it labelled a real patch `not_fix` in 1 of 5 asks, so it is
  asked up to three times. It also labelled 8 of 18 non-fix commits `fix` (spec 006 R6).

## Consequences

- Easier: a change to the verdict rule is a code change with a unit test. The stored answers are Jev's own.
- Harder: every change to a question, or to what is sent with it, waits on a replay.
- **How we would know this was wrong:** the replay stops giving every evidence fix its expected verdict; the
  share of commits refused as too large rises above the measured 6 to 8%; or the provider changes its terms
  for private source or retires the model.
- Revisit if: the model is changed or withdrawn, or a judge inside the session can answer within the hook's time.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] A new question for Jev is replayed before it ships.
3. [ ] A new rule that code can decide goes ahead of the Jev call, not after it.
