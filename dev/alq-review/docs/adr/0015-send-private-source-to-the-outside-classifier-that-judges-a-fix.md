---
schemaVersion: 0.1.0
id: "0015"
title: "Send private source to the outside classifier that judges a fix"
status: draft
date: 2026-10-07
deciders: []
tags: [shim-check, classifier, private-source]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0007"]
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/jev.py"
provenance:
  authoredBy: agent-drafted
  agent:
    name: Claude Code
    model: claude-opus-5-5
  sourceArtifact: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
review:
  tier: arb
externalRefs:
  - type: issue
    id: "30"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/30"
    label: "The batch of ADRs this one belongs to"
---

# ADR-0015: Send private source to the outside classifier that judges a fix

## Context

The shim check judges a fix with Jev, a classifier outside the org (ADR-0007). To judge a change, Jev has
to read it. So source code leaves the org, to OpenRouter and to TypeSafe.

What is sent: the diff of the staged change and, for a fix, the lists of sites the sweep found, each with its
file, line, function and a short description.

The check runs on every repo the plugin is installed in, private repos included.

The plan of the shim check records this as the user's decision, and its spec takes Jev's terms as accepted
for private source. Neither gives a date or a reason, and no alternative was weighed.

Why now: the decision was one point of seven in ADR-0007, which is about how a verdict is made. It reaches
every repo, and it cannot be undone for code already sent.

## Decision

We will send the code of every repo the plugin is installed in, private repos included, to OpenRouter and
TypeSafe, so that the shim check can judge a fix. This is the user's decision.

## Options considered

### Option A: Send the code of every repo, private ones included (chosen)

| Dimension | Assessment |
|---|---|
| What leaves the org | The diff of the change, and for a fix the lists of sites |
| Repos covered | Every repo the plugin is installed in |
| Who receives it | OpenRouter and TypeSafe |
| Can be taken back | No, for what was already sent |

### Option B: Do nothing

The permission stays one point of ADR-0007, marked as reaching one component and as easy to undo.

The plan weighed no alternative to sending private source.

## Trade-offs

- Private source leaves the org, to two companies. What was sent cannot be taken back.
- The terms are taken as accepted. Nothing in the repo records what they say about keeping or using what
  is sent.
- Nothing asks per repo. Installing the plugin in a repo means its code is sent.
- The check needs an OpenRouter key wherever the plugin runs, the bot image included. Without it, every code
  commit is refused under `enforce`.

## Consequences

- Easier: the shim check works the same on a private repo as on a public one.
- Harder: another feature that sends source out of the org cannot lean on this ADR. It needs its own.
- **How we would know this was wrong:** a provider changes its terms for private source; or source that was
  sent to the classifier turns up outside the org.
- Revisit if: a judge inside the org or inside the session can answer within the hook's time, or the plugin
  is to be installed in a repo whose source may not leave the org.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
