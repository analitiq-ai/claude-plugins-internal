---
schemaVersion: 0.1.0
id: "0009"
title: "Send private source to the outside classifier"
status: draft
date: 2026-10-20
deciders: ["@Analitiq-Bot-Wonka"]
tags: [classifier, private-source]
scope: org
reversibility: one-way-door
blastRadius: org
relatesTo: ["0004"]
affects:
  - type: path
    pattern: "reviewer/plugin/scripts/jev.py"
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

# ADR-0009: Send private source to the outside classifier

## Context

A reviewer check can judge a staged change with Jev, a classifier outside the org; the shim check does
(ADR-0004). To judge a change, Jev has to read it, so source code leaves the org, to the provider that
carries the request and to TypeSafe. The shim check sends the staged diff and, for a fix, the sites the sweep
found, each with a short description an agent wrote. It runs on every repo the plugin is installed in.

## Decision

1. We will let a reviewer check that judges a staged change send it to Jev, an outside classifier, from
   every repo the plugin is installed in, private repos included.
2. We will send only the staged change and what the plugin's agents wrote about the code.

## Options considered

### Option A: Any reviewer check may send a staged change to Jev (chosen)

One permission for every check that judges a staged change, on every repo, bounded by point 2.

### Option B: Leave the permission inside ADR-0004

Rejected: a one-way, org-wide permission would sit in a record marked as reaching one component and easy
to undo.

### Option C: The shim check only

Not chosen: a later check that sends the same content to the same receiver adds no new exposure, and would
need a record that repeats this one.

No alternative to sending private source was weighed.

## Trade-offs

- Private source leaves the org, to two companies, and cannot be taken back.
- Which provider carries a request is not decided here, so a switch of provider sends private source to a
  new company with no new record.
- The provider's terms are taken as accepted; nothing in the repo records what they say about keeping or
  using what is sent.
- Nothing asks per repo: installing the plugin in a repo means its code is sent.
- A check that uses Jev needs an OpenRouter key wherever the plugin runs, the bot image included; without
  it, under `enforce`, every code commit is refused.

## Consequences

- Easier: a new check that judges a staged change with Jev needs no new permission.
- Harder: every new check has to be read against points 1 and 2, because nothing in code holds it to them.
- **How we would know this was wrong:** a provider changes its terms for private source; source sent to the
  classifier turns up outside the org; or a check is found sending content outside point 2.
- Revisit if: a judge inside the org can do the same job, the plugin is to be installed in a repo whose
  source may not leave the org, or a check needs a classifier other than Jev.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
