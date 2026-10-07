---
schemaVersion: 0.1.0
id: "0010"
title: "Run hook scripts on the standard library alone, with each exception named in a record"
status: draft
date: 2026-10-06
deciders: []
tags: [dependencies, hooks, install]
scope: component
reversibility: two-way-door
blastRadius: component
relatesTo: []
affects:
  - type: path
    pattern: "plugins/alq-review/**/*.py"
  - type: path
    pattern: "plugins/alq-review/hooks/hooks.json"
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
  - type: issue
    id: "17"
    url: "https://github.com/analitiq-ai/claude-plugins-internal/issues/17"
    label: "D7: the first named exception, diff-match-patch"
---

# ADR-0010: Run hook scripts on the standard library alone, with each exception named in a record

## Context

The plugin's hooks run Python scripts straight from the installed plugin folder. Installing the plugin
copies files. There is no step that installs a package.

Two plans state the limit as a fact: "Python 3 (stdlib only, as the rest of `scripts/`)". Their research
used it to turn down `unidiff` and the OpenRouter SDKs. None of them gives a reason for the limit.

Constitution P5 pulls the other way. It asks that nothing is hand-rolled before what already exists was
looked at. Nothing written says how the two are weighed.

Why now: record 0001 puts the package `diff-match-patch` on the hook path. Without a decision, that would
end an unwritten rule by accident. No plan decided this. The user decided it on 2026-10-06.

## Decision

1. We will keep the rule: a Python script that a hook runs imports the standard library and the plugin's
   own files, and nothing else.
2. We will allow an exception only when a decision record names the package and says why the standard
   library does not do the job.
3. We will treat `diff-match-patch`, named in record 0001, as the one exception.
4. We will refuse, not fall back, when a check needs a named package and cannot import it. The refusal
   names the package and the command that installs it.

The rule covers Python imports. Programs the scripts run, such as `git` and `gh`, are outside it.

## Options considered

### Option A: Standard library alone, each exception named in a record (chosen)

| Dimension | Assessment |
|---|---|
| Install | Stays a file copy for every check that uses no named package |
| A new package | Needs a record first, so someone decides it |
| Weighed against P5 | In the exception's record, once per package |

### Option B: Do nothing

The rule stays unwritten. Plans keep citing it as a fact, and record 0001 breaks it with no decision.

### Option C: Vendor a needed package into the plugin folder

Issue #17 lists it for `diff-match-patch`. The user chose a pip install over a vendored copy.

No other alternative was weighed. Dropping the rule was not proposed by anyone.

## Trade-offs

- No reason for the rule itself is recorded. It rests on the user's decision and on the install being a
  file copy.
- A named exception makes the install more than a copy. Until the package is on a machine, the checks that
  need it refuse there.
- The rule costs hand-rolled code where a package exists, and that code needs its own tests.

## Consequences

- Easier: a plan cites this record in place of "stdlib only". A reviewer can turn down an unnamed import by
  pointing here.
- Harder: each new package needs a record before the code. The first exception needs an install step that
  does not exist yet.
- **How we would know this was wrong:** a second and a third exception are asked for within a few months,
  or checks refuse for a missing package on machines where nobody ran the install step.
- Revisit if: the plugin gains an install step that can install packages.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Decide how a named package is installed and pinned, with the work of issue #17.
3. [ ] Build the refusal for a missing named package with the first exception, from a failing test.
