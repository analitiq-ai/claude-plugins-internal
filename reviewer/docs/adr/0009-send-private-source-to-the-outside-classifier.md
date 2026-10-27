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
---

# ADR-0009: Send private source to the outside classifier

## Context

A reviewer check can judge a checked change (ADR-0002) with an outside classifier, a model outside the org
that answers a choice question with one of its fixed answers; the shim check does (ADR-0004). To judge a
change, the classifier has to read it, so source code leaves the org, to the provider that carries the request
and to the company that runs the model. The shim check sends the checked diff and, for a fix, the sites the
sweep found, each with a short description an agent wrote. It runs on every repo the plugin is installed in.

## Decision

1. We will let a reviewer check that judges a checked change send it to an outside classifier, from
   every repo the plugin is installed in, private repos included.
2. We will send only the checked change and what the plugin's agents wrote about the code.

## Options considered

### Option A: Any reviewer check may send a checked change to the outside classifier (chosen)

One permission for every check that judges a checked change, on every repo, bounded by point 2.

### Option B: Leave the permission inside ADR-0004

Rejected: a one-way, org-wide permission would sit in a record marked as reaching one component and easy
to undo.

### Option C: The shim check only

Not chosen: a later check that sends the same content to the same receiver adds no new exposure, and would
need a record that repeats this one.

No alternative to sending private source was weighed.

## Trade-offs

- Private source leaves the org, to two companies, and cannot be taken back.
- Which classifier and which provider carry a request is not decided here, so a switch of either can send
  private source to a new company with no new record.
- The provider's terms are taken as accepted; nothing in the repo records what they say about keeping or
  using what is sent.
- Nothing asks per repo: installing the plugin in a repo means its code is sent.
- A check that uses the classifier needs the provider's key wherever the plugin runs; without it,
  under `enforce`, every code commit is refused.

## Consequences

- Easier: a new check that judges a checked change with the classifier needs no new permission.
- Harder: every new check has to be read against points 1 and 2, because nothing in code holds it to them.
- **How we would know this was wrong:** a provider changes its terms for private source; source sent to the
  classifier turns up outside the org; or a check is found sending content outside point 2.
- Revisit if: a judge inside the org can do the same job, or the plugin is to be installed in a repo whose
  source may not leave the org.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
