---
schemaVersion: 0.1.0
id: "0015"
title: "Send private source to the outside classifier"
status: draft
date: 2026-10-07
deciders: []
tags: [classifier, private-source]
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

# ADR-0015: Send private source to the outside classifier

## Context

An alq-review check can judge a staged change with Jev, a classifier outside the org. Today one check does,
the shim check (ADR-0007). To judge a change, Jev has to read it. So source code leaves the org, to
OpenRouter and to TypeSafe.

What is sent today: the diff of the staged change and, for a fix, the lists of sites the sweep found, each
with its file, line, function and a short description an agent wrote.

The check runs on every repo the plugin is installed in, private repos included.

The plan of the shim check allows sending private source, and its spec takes Jev's terms as accepted for
private source. Neither gives a reason, and no alternative was weighed.

This ADR widens that from the shim check to any alq-review check. A check of prose claims may use Jev
later.

Why now: the decision was one point of seven in ADR-0007, which is about how a verdict is made. It reaches
every repo, and it cannot be undone for code already sent.

## Decision

1. We will let an alq-review check that judges a staged change send it to Jev, an outside classifier, from
   every repo the plugin is installed in, private repos included.
2. We will send only the staged change and what the plugin's agents wrote about the code.

## Options considered

### Option A: Any alq-review check may send a staged change to Jev (chosen)

| Dimension | Assessment |
|---|---|
| What leaves the org | The staged change, and what the plugin's agents wrote about the code |
| Who may send | Any alq-review check that judges a staged change |
| Repos covered | Every repo the plugin is installed in |
| Who receives it | The provider that carries the request to Jev. Today OpenRouter and TypeSafe |
| Can be taken back | No, for what was already sent |

### Option B: Do nothing

The permission stays one point of ADR-0007, marked as reaching one component and as easy to undo.

### Option C: The shim check only

This is what the plan allows. Not chosen: a later check that sends the same content to the same receiver
adds no new exposure, and would need an ADR that repeats this one.

No alternative to sending private source was weighed.

## Trade-offs

- Private source leaves the org, to two companies. What was sent cannot be taken back.
- Which provider carries a request is not decided here. A switch of provider sends private source to a new
  company with no new ADR.
- The terms are taken as accepted. Nothing in the repo records what they say about keeping or using what
  is sent.
- Nothing asks per repo. Installing the plugin in a repo means its code is sent.
- A new check can start sending with no new decision, as long as it stays inside points 1 and 2.
- A check that uses Jev needs an OpenRouter key wherever the plugin runs, the bot image included. Today,
  without it, every code commit is refused under `enforce`.

## Consequences

- Easier: a new check that judges a staged change with Jev needs no new permission. A check works the same
  on a private repo as on a public one.
- Harder: every new check has to be read against points 1 and 2, because nothing in code holds it to them.
- **How we would know this was wrong:** a provider changes its terms for private source; source that was
  sent to the classifier turns up outside the org; or a check is found sending content outside point 2.
- Revisit if: a judge inside the org or inside the session can do the same job, the plugin is to be
  installed in a repo whose source may not leave the org, or a check needs a classifier other than Jev.

## Action items

1. [ ] The ratifier ratifies this ADR, or sends it back.
