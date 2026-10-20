---
schemaVersion: 0.1.0
id: "0003"
title: "Guard commits, leave the rules of a PR to GitHub and read the org gate's verdict from its check run"
status: superseded
supersededBy: "0022"
date: 2026-10-06
deciders: ["@Analitiq-Bot-Wonka"]
tags: [merge-gate, org-gate, github]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/scripts/{pre_merge_gate,github}.py"
  - type: path
    pattern: "dev/alq-review/specs/008-gate-check-runs-prose/**"
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
    label: "The batch of decisions already made, written as ADRs"
---

# ADR-0003: Guard commits, leave the rules of a PR to GitHub and read the org gate's verdict from its check run

## Context

The plugin checks a commit in the session that makes it: its claims, and whether it is a shim. Before a
command that merges a PR or marks it ready, its hook checks that the head commit had its internal review.
A session can run on a developer's machine or anywhere else.

GitHub has rules of its own for a PR. It enforces a branch's rules, and the org gate, the
`analitiq-pr-gate` App, posts its verdicts there as check runs.

The plugin's hook could repeat GitHub's rules. The docstring of
`plugins/alq-review/scripts/pre_merge_gate.py` says what that costs: a local second copy "drifts from
the server's and starts disagreeing with it".

One kind of PR is merged with no internal review: a version-only release, which only moves its package's
own version up. The org gate rules which PRs are one, and says so in the title of its `internal-review`
check run. The hook reads that title.

Matching a run by name is a risk: another check may carry the same name. A comment in
`plugins/alq-review/scripts/github.py` adds that an agent's token could post the same text.

Why now: these reasons sit in a docstring and a code comment. No ADR binds the next gate.

## Decision

1. We will have the plugin guard commits and leave the rules of a PR to GitHub.
   - While the plugin is on, it checks what a commit changes, for claims and for shims. That does not
     depend on which reviews are run, or in what order.
   - Before a PR is merged or marked ready, it checks that the head commit had its internal review.
   - It repeats none of GitHub's rules: CI, review threads and approvals. It only refuses a command that
     steps around them.
   - Where a session runs makes no difference to any of this.
2. We will name in this ADR every kind of PR that needs no internal review. Today there is one: a
   version-only release. For any other PR that should go without the plugin, the user switches it off.
3. We will take a check run as the org gate's verdict only when its App posted it. A run with the right
   name from anyone else counts for nothing. The exception of point 2 rests on such a verdict.

## Options considered

### Option A: The plugin guards commits, GitHub keeps its rules, the verdict comes from the App's check run (chosen)

| Dimension | Assessment |
|---|---|
| Refuses a merge on CI, review threads or approvals | No, GitHub does |
| Depends on where the session runs | No |
| PRs that need no internal review | Named in this ADR, one today |
| A run with the same name from another App | Not trusted |
| Repos without branch protection | Nothing enforces CI, threads or approvals |

### Option B: Do nothing

No ADR binds the next gate, so nothing stops it from copying one of GitHub's rules.

### Option C: Re-check GitHub's rules in the plugin's hook

Rejected in the hook's docstring: the two copies disagree, and the disagreement "gets resolved in
favour of whichever copy was easier to edit".

### Option D: No exception, and the switch for a version-only release

Not chosen: the exception works today, and the org gate already rules which PRs are version-only.

## Trade-offs

- The hook's docstring names a gap: a private repo that cannot enable branch protection has nothing
  that enforces CI, threads or approvals.
- Reading the verdict depends on strings that copy another repo's file: the App's name, the run's
  name and a title prefix.
- A new kind of PR that needs no internal review needs a change to this ADR. Until then the user has the
  switch, which is all or nothing for a session: off lifts the commit checks too.

## Consequences

- Easier: a change to GitHub's rules needs no change in the plugin. A new check has one question to pass
  before it is built: is it about a commit, or is it a rule GitHub already enforces?
- Harder: someone who wants the hook to block a merge on red CI is told no and sent to branch
  protection.
- **How we would know this was wrong:** a merge goes through with unmet requirements on a repo
  without branch protection, and it costs a broken main. Or the org gate changes its run name or App
  and the plugin reads no verdict where there is one. Or the list of point 2 grows past a few kinds.
- Revisit if: branch protection becomes available on every repo the plugin serves, or the org gate
  publishes its verdict in a form that needs no name matching.

## Action items

1. [x] The ratifier ratifies this ADR, or sends it back.
2. [ ] Decide whether the poller's App filter and the one in `github.py` become one reader.
3. [ ] Decide whether the App name, run name and title prefix get a drift test.
