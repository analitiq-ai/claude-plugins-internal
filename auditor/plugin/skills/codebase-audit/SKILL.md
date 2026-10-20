---
name: codebase-audit
description: Whole-codebase sweep for shims, workarounds, spaghetti, hand-rolled reimplementations, silent failures and boundary traps — full-coverage audit of an entire repo or a named subsystem at its current state, not just recent changes. Use when the user asks to audit/sweep an entire repo or subsystem ("audit the infra repo", "sweep the whole codebase"), or on a periodic schedule. For a PR or session diff use the pr-audit skill in this plugin instead.
colour: red
---

# Anti-Pattern Audit — whole codebase

Sweep an entire tree, systematically and with full coverage, for the same patterns
the PR audit hunts — but against everything in it, regardless of who wrote it or
when. The standards being enforced are `[[coding-principles]]` and
`[[schema-contracts]]`.

You are the **orchestrator**. You partition the tree, dispatch detectors per audit
unit, and synthesize. You do not carry a hunt list — each detector's remit lives in
its own body.

**Coverage is the deliverable.** A partial sweep reported as a finished audit is
itself the defect. If units remain unaudited, name them.

## Scope

`$ARGUMENTS` names the repo to audit — see `CLAUDE.md` for repo locations. If it is
empty, ask; never start without one. A directory or subsystem may be given to bound
the sweep. Absent that, the whole repo is in scope, at the current state of its
default branch.

## 1. Partition

Inventory the repo — top-level layout, entry points, build and CI config,
dependency manifests — and split it into **audit units** of roughly comparable
size: a package, a Terraform module, a Lambda, a plugin, a test suite. Every file
in scope belongs to exactly one unit.

Write the partition down as a **coverage ledger before auditing anything**. That
ledger is what turns this from a spot-check into an audit, and it is the artifact
you close the report with.

Exclude and record the reason: vendored code, lockfiles, and generated artifacts —
per `[[schema-contracts]]`, generated Zod, TS and JSON Schema are not hand-audited;
audit the generator instead.

## 2. Build the packets

One `unit`-mode scope packet per audit unit, per
`${CLAUDE_PLUGIN_ROOT}/reference/scope-packet.md`:

- `mode: unit`
- `repo`, and `visibility` — public or private, which decides part of
  `boundary-trust`'s remit
- `unit`: the ledger entry's name
- `files`: that unit's explicit boundary
- `regions: whole-file`
- `read_beyond: no` — the unit is already the whole subject
- `baseline`: the ref the sweep is pinned to
- `suppressions`: empty, unless the invoker named a category

## 3. Dispatch

Per unit, in parallel batches: `mechanism-depth`, `failure-evasion`,
`duplication`, `code-shape`, `boundary-trust`.

**`history-shape` does not run here.** It judges whether a branch was built as a
sweep, which has no meaning against a standing tree. `semantic-parity` does not run per
unit either — see the cross-cutting sweeps below.

Then the **cross-cutting sweeps**, which no unit-scoped dispatch can see because
each half looks original from inside its own boundary. Same detectors, a repo-wide
packet:

- `duplication` with `unit: repo-wide` — parallel implementations and re-declared
  contract shapes spanning units.
- `boundary-trust` with `unit: repo-wide` — environment-varying values and
  visibility leaks scattered across the tree.
- `semantic-parity` with `unit: repo-wide` — sibling code paths that no longer
  agree. It runs **only** repo-wide: its families are derived from interfaces,
  dispatch tables and contract types that span units, so a per-unit dispatch would
  re-derive the same families once per unit and trace them repeatedly.

Hand each detector its packet and nothing else. Do not summarize a unit for a
detector and do not narrow its remit: a detector told what to look for stops
looking.

Track completion in the ledger. **A unit whose detector failed or returned nothing
without a clean-scope statement is not audited** — re-dispatch it.

## 4. Synthesize

Detectors collect, you judge.

- **Verify before passing through.** Never report a claim you have not checked
  against the actual code. A proposal derived from a grep hit alone, or from a
  detector's summary alone, is not a finding.
- **Dedupe across detectors and across units.** One root cause surfacing in five
  units is one finding with five sites, not five findings. This is the single
  largest difference between a useful sweep and an unreadable one.
- **Promote what recurs.** A pattern appearing in several units is an architecture
  problem, not a local one, and its severity reflects that.

## 5. Report

**Say nothing until this step.** Output discipline — silence while the detectors
run, and how little the report says — is
`${CLAUDE_PLUGIN_ROOT}/reference/reporting.md`. It applies per batch too: do not
report a unit as it completes, only the ledger at the end.

Confirmed findings, severity-ordered, in the shape
`${CLAUDE_PLUGIN_ROOT}/reference/finding-format.md` defines, with one addition
this sweep needs on each entry:

```
  Effort & risk: rough size, and what else the fix touches.
```

Then close with all three of:

- **Coverage ledger** — every audit unit, its status (audited / excluded with
  reason / re-dispatch needed), and which came back clean. Absent findings must
  read as a checked claim, not silence.
- **Systemic patterns** — what recurs across units, stated as the invariant being
  broken rather than as a list of sites.
- **Order of attack** — prioritized, noting which fixes unblock others.

## Rules

- **Fix the cause, not the symptom.** Where a correct fix needs a change the
  current layer cannot make — a missing API field, a contract that must change —
  say so and propose the real fix. Never propose a heuristic that papers over it.
- **Never suppress.** Adding an ignore or disable comment is not a fix.
- **No blanket refactors.** Every proposal is scoped to a named defect with a named
  cost.

## Propose, do not apply

Present the report and stop. Fix only what the invoker approves, then follow
`[[coding-principles]]` scope discipline — smallest change that removes the cause,
no gold-plating. When fixing, work in small batches and re-verify after each.
