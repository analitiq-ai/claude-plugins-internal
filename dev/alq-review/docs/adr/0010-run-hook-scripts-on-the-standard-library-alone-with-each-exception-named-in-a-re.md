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

Draft for the ratifier. Paths are relative to the repo root.

## Context

The plugin's hooks run Python scripts straight from the installed plugin folder, for example
`python3 ${CLAUDE_PLUGIN_ROOT}/scripts/gate.py` (`plugins/alq-review/hooks/hooks.json:9`). An install copies
`plugins/<name>/` (`dev/alq-review/.specify/memory/constitution.md:114`). On 2026-10-06 a search of `plugins/`
found no requirements file and no mention of pip.

The same day, a walk over the imports of the 22 Python files under `plugins/alq-review/` found no module
outside the standard library and the plugin's own files.

Three specs lean on this as a rule, and none of them gives a reason for it:

- Spec 005's plan: "Python 3 (stdlib only, as the rest of `scripts/`)"
  (`dev/alq-review/specs/005-claim-check-gate/plan.md:19`). Spec 006's plan says the same
  (`dev/alq-review/specs/006-shim-check-gate/plan.md:20`).
- Spec 005 rejected `unidiff`: "the plugin is stdlib-only and a hunk header is one regex"
  (`dev/alq-review/specs/005-claim-check-gate/research.md:65`).
- Spec 006 rejected the OpenRouter SDKs: "the plugin is stdlib-only and the call is one POST"
  (`dev/alq-review/specs/006-shim-check-gate/research.md:141`).
- Spec 004 rejected duplicate finders in part because "each is a third-party runtime"
  (`dev/alq-review/specs/004-spec-folder-checks/research.md:66`).

Constitution P5 pulls the other way. It asks that "nothing is hand-rolled before what already exists was
looked at" (`dev/alq-review/.specify/memory/constitution.md:104`). Nothing written says how the two are
weighed.

Why now: draft record 0001 (PR #22) adds the package `diff-match-patch` on the hook path. Without this
record, that would end an unwritten rule without anyone deciding to.

## Decision

The user decided on 2026-10-06:

1. **The rule stays.** A Python script that a hook runs imports the standard library and the plugin's own
   files, and nothing else.
2. **An exception is named in a decision record.** The record names the package and says why the standard
   library does not do the job.
3. **`diff-match-patch` is the one named exception.** Draft record 0001 names it. It takes effect when that
   record is ratified.
4. **A missing named package is a refusal, not a fallback.** A check that needs a named package and cannot
   import it refuses, and the message names the package and the install command. Issue #17 (D7) says the same
   for the first exception: hooks "fail with a clear message naming the install command when it is missing".

Scope: Python that a hook runs. Programs the scripts run, such as `git` and `gh`, and services they call
(record 0007) are not imports and are outside this rule. So is the Spec Kit CLI that the design-doc skill
drives as a program (`plugins/alq-review/skills/design-doc/scripts/drive_workflow.py:7`); CI installs it with
pip for the tests (`.github/workflows/tests.yml:43`).

Not decided here: how a named package gets installed on each machine, the bot included, and how its version
is pinned. Draft record 0001 leaves "how the dependency is installed" to the amendments of specs 005 and 006.

## Options considered

### Option A: Standard library alone, exceptions named one by one in a record (chosen)

| Dimension | Assessment |
|---|---|
| Install | Stays a file copy for every check that uses no named package |
| A new package | Needs a record first, so someone decides it |
| Weighed against P5 | The record for an exception is where the two are weighed, per package |

### Option B: Do nothing: the rule stays unwritten

Specs keep citing it as a fact. Record 0001 then breaks it with no decision recorded.

### Other options, rejected

| Option | Why rejected |
|---|---|
| C. Drop the rule and add a requirements file | The user decided to keep the rule. An install is a file copy today (Context), so each machine would need a new install step. |
| D. Vendor a needed package into `plugins/alq-review/` | For `diff-match-patch` the user chose pip install over a vendored copy (issue #17, rejected options). No reason is recorded. |
| E. Hand-roll what a package does, with no exception | It goes against P5. The specs that hand-rolled did so for small jobs: "a hunk header is one regex", "the call is one POST". |

## Trade-offs

- No reason for the rule itself is recorded. This record keeps the rule on the user's decision and on what
  the repo shows: an install is a copy.
- A named exception makes the install more than a copy for the checks that use it. Until the package is
  installed on a machine, those checks refuse there.
- The rule costs hand-rolled code where a package exists. The hand-rolled part needs its own tests.

## Consequences

- Easier: a plan can cite this record in place of "stdlib only, as the rest of `scripts/`". A reviewer can
  refuse an import of an unnamed package by pointing here.
- Harder: each new package needs a record before the code. The first exception needs an install step that
  does not exist yet.
- **How we would know this was wrong:** a second and a third exception are asked for within a few months; or
  `gate.log` shows checks refusing for a missing package on machines where nobody ran the install step.
- Revisit if: the plugin gains an install step that can install packages, or a named package can no longer
  be used.

## Action items

1. [ ] The ratifier ratifies this record, or sends it back.
2. [ ] Decide how a named package is installed and pinned, with the amendments of specs 005 and 006 (issue #17).
3. [ ] Build the refusal for a missing named package with the first exception, from a failing test.
4. [ ] Point the constitution's Platform Constraints at this record, in its own PR.
