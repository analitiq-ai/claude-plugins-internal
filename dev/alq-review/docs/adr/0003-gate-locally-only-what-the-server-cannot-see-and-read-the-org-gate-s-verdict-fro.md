---
schemaVersion: 0.1.0
id: "0003"
title: "Gate locally only what the server cannot see and read the org gate's verdict from its check run"
status: draft
date: 2026-10-06
deciders: []
tags: [merge-gate, org-gate, github]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{pre_merge_gate,github}.py"
  - type: path
    pattern: "plugins/alq-review/skills/alq-github-pr-review/**"
  - type: path
    pattern: "dev/alq-review/specs/008-gate-check-runs-prose/**"
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
    label: "The batch of decisions already made, written as records"
---

# ADR-0003: Gate locally only what the server cannot see and read the org gate's verdict from its check run

## Context

Two gates stand before a merge. GitHub enforces a branch's rules on the server, and the org gate, the
`analitiq-pr-gate` App, posts its verdicts there as check runs. The plugin's own hook runs in the
session, before a command that merges a PR or marks it ready.

A local gate can repeat the server's rules. The docstring of
`plugins/alq-review/scripts/pre_merge_gate.py` says what that costs: a local second copy "drifts from
the server's and starts disagreeing with it".

The plugin also has to learn what the org gate decided. Matching a run by name is a risk: another
check may carry the same name. A comment in `plugins/alq-review/scripts/github.py` adds that an
agent's token could post the same text.

The same drift applies to prose. The gate's behaviour was restated in a rule and in a skill, with
no test to hold either copy to the gate's code.

Why now: these reasons sit in a docstring, a code comment and the spec of a prose-only feature. No
record binds the next local gate or skill.

## Decision

1. We will gate locally only what GitHub cannot observe. Today that is the internal review of the
   head commit, and the ways to step around the server's rules.
2. We will keep no local copy of a rule the server enforces.
3. We will read the org gate's verdict from a check run, matched by the run's name and the App that
   posted it, never by the name alone.
4. We will keep prose from restating gate behaviour. A rule or skill names the run and its App, and
   sends the reader to the state and title the poller prints.

## Options considered

### Option A: Local gate for the unobservable only; verdict from the App's check run (chosen)

| Dimension | Assessment |
|---|---|
| Refuses a merge on CI, review threads or approvals | No, the server does |
| A run with the same name from another App | Not trusted |
| Prose copies of gate behaviour | One, in the skill |
| Repos without branch protection | Nothing enforces CI, threads or approvals |

### Option B: Do nothing

No record binds the next gate, so nothing stops it from copying a server rule.

### Option C: Re-check the server's rules in the local hook

Rejected in the hook's docstring: the two copies disagree, and the disagreement "gets resolved in
favour of whichever copy was easier to edit".

### Option D: Gate behaviour written in both the rule and the skill

Rejected: one prose copy means one place to drift instead of two.

### Option E: A list of gate states in the skill

Rejected: it would be a second copy of the org gate's mapping, with no drift test.

## Trade-offs

- The hook's docstring names a gap: a private repo that cannot enable branch protection has nothing
  that enforces CI, threads or approvals.
- Reading the verdict depends on strings that copy another repo's file: the App's name, the run's
  name and a title prefix.
- One prose copy remains in the skill, and no drift test pins it.

## Consequences

- Easier: a change to the server's rules needs no change in the plugin. A new local check has one
  question to pass before it is built: can GitHub observe it?
- Harder: someone who wants the hook to block a merge on red CI is told no and sent to branch
  protection.
- **How we would know this was wrong:** a merge goes through with unmet requirements on a repo
  without branch protection, and it costs a broken main. Or the org gate changes its run name or App
  and the plugin reads no verdict where there is one.
- Revisit if: branch protection becomes available on every repo the plugin serves, or the org gate
  publishes its verdict in a form that needs no name matching.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Decide whether the poller's App filter and the one in `github.py` become one reader.
3. [ ] Decide whether the App name, run name and title prefix get a drift test.
