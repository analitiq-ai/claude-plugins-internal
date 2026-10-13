# alq-review Constitution

Constitution for building the `alq-review` plugin. Its Spec Kit project is `dev/alq-review/` in
`analitiq-ai/claude-plugins-internal`; the plugin it governs is `plugins/alq-review/`. Paths are
relative to the repo root unless they name another repo. Nothing under `dev/` is installed with
the plugin. Each principle is a plan-time gate: a plan passes only if it answers the
gate question. The files named in each Source line are the source of truth; this document
indexes them and never restates their text.

## Core Principles

### Inherited Organisation Principles (Analitiq constitution v1.1.0)

Copied verbatim, Source lines included; not weakened or edited here. Inherited Source paths
resolve in `analitiq-ai/engineering` at the inherited tag (TODO(ORG_TAG): `constitution-v1.1.0`
is not tagged yet).

### I. Contract-First, One Source of Truth per Domain

Gate: does the plan introduce a data shape, validator, type-name list or hand-written schema? If so,
it MUST name the owning artifact from the contracts map and be an adapter against it. A new contract
or a second validator over an already-gated shape fails the gate.

Source: `.claude/rules/schema-contracts.md`; `.claude/rules/coding-principles.md` (Structure &
consistency: contract-first, define once).

### II. Ownership & Trust Boundaries

Gate: is every change placed in the repo that owns it; is external input validated where it enters;
does no internal, infrastructure or cloud-specific detail reach a public repo; does no public-repo
issue link to a private one; are there no secrets in code?

Source: `CLAUDE.md` (repo roles); `.claude/rules/coding-principles.md` (Security & data; ownership);
`.claude/rules/github-workflow.md` (branch rule 7; other GitHub rules).

### III. Fail Loud, No Workarounds, No Backwards Compatibility

Gate: does the design fix the cause rather than mask the symptom, with no fallbacks, swallowed
errors or compatibility branches unless explicitly instructed? If the current layer cannot meet the
spec, the plan MUST say so and name the real fix instead.

Source: `.claude/rules/coding-principles.md` (Correctness & failure handling; No workarounds; Global
constraints); `.claude/rules/pr-review-loop.md` (Triage hard rules, last bullet).

### IV. Test-First & Verified

Gate: does every task start from a test that fails for the expected reason, is logic testable in
isolation, and is "done" defined as executed and verified against the spec?

Source: `.claude/rules/coding-principles.md` (Testing & verification).

### V. Smallest Complete Change

Gate: is there no speculative generality or dead code; is scope defined by what a working deployment
needs; does a fix for a class of defect cover every instance of it in the files touched?

Source: `.claude/rules/coding-principles.md` (Scope discipline).

### VI. Governing Rule Ships Apart from Governed Code

Gate: if the plan changes a rule file, lint, guard or schema check together with the code it
governs, does it split them into separate PRs?

Source: `.claude/rules/coding-principles.md` (Scope discipline: never move a governing rule and the
code it governs in the same PR).

### Plugin Principles

### P1. Code Decides, Not Prose

Gate: is every rule the plan adds decided by code on the hook path, with no step that relies on
an agent reading and obeying an instruction, and does every refusal name the next legal step?

Source: `plugins/alq-review/README.md` (opening; How an agent uses it).

### P2. Only an Approved Entity Releases a Hold

Gate: for every lock, count or hold the plan adds or changes, does the plan name the one entity
approved to release it (the user or another system) and the one action by which it does?
Nothing else may release the hold, lower it or start it again. A hold with no named approver,
or with any second way out, fails the gate.

Source: `plugins/alq-review/README.md` (What it enforces 2, 4, 5, 6, 7; State: `unlock`; Layout:
`scripts/pre_merge_gate.py`, the org gate's release); how the user's action is recognised:
`dev/alq-review/docs/adr/0004-take-the-user-s-authority-from-a-prompt-that-starts-with-a-keyword.md`.

### P3. Rules Are Pure; Handlers and Workflows Carry None

Gate: does every decision the plan adds live in a pure function of stored state and git's
answers, with hook handlers doing only input/output and workflows doing only orchestration?

Source: `plugins/alq-review/README.md` (Layout).

### P4. A Check That Could Not Run Is Its Own Outcome

Gate: when a reader, judge, model or service the plan depends on does not answer, is that
reported as a failed check or a named `cannot verify` — never as a pass, never as a finding
against the author, and never as a guess?

Source: `plugins/alq-review/README.md` (What it enforces 2, 5, 6; Mode: the shim check).

## Platform Constraints

Facts a plan can get wrong. Each is owned by the file named; consult it rather than this summary.

- Repo shape: `plugins/<name>/` holds what an install copies, listed in
  `.claude-plugin/marketplace.json`; `dev/<name>/` holds what the plugin is built with (this
  project, its `specs/<nnn>-<feature>/` and its `tests/`) and is never installed (`README.md`).
- Tests: CI runs every `tests/` folder under `dev/` that is not inside a `fixtures/` folder (`.github/workflows/tests.yml`).
- The claim, shim and decision checks each have a `log` / `enforce` setting beside the plugin's mode; the
  review-round `spec` check follows the plugin's mode alone (`plugins/alq-review/README.md`: Mode).
- Where the plugin keeps its state: `plugins/alq-review/README.md` (State).
- Reviewer agents come from the `pr-review-toolkit` and `alq-anti-pattern` plugins, except the decision
  reviewer, which is this plugin's own `agents/decision-reviewer.md` (`plugins/alq-review/README.md`, end of Layout).
- Private repo: Principle II's public-repo limits bind what the plugin writes into public repos,
  not this repo's own files.

## Delivery Workflow

Not gates — context so `/speckit-tasks` shapes tasks to fit: issue-numbered branch, worktree at
`.claude/worktrees/<n>`, draft PR, then the review loops and the pre-merge checklist. Owned by the
organisation's `.claude/rules/github-workflow.md` and
`.claude/rules/pr-review-loop.md`. Decision records go in `dev/alq-review/docs/adr/`. The adrkit
`after_plan` hook is optional: it offers to check a plan against them.

## Governance

- This constitution inherits the Analitiq organisation constitution v1.1.0. Principles I–VI are
  copied verbatim and are not weakened or edited here; amendments to them happen upstream first,
  then are re-synced into this file.
- The files named in the plugin principles' Source lines are the source of truth; where one
  disagrees with this document, the file wins and this document is amended.
- Amending a plugin principle: change its source file first, in its own PR (Principle VI),
  then amend this document and bump its version — MAJOR for removing or redefining a principle,
  MINOR for adding a principle or section, PATCH for wording.
- The repo is private, so the constitution is committed here. Every other plugin in the repo has
  its own Spec Kit project and constitution; nothing here binds them.
- Compliance: `/speckit-plan` evaluates every gate in its Constitution Check; a violation MUST be
  justified in the plan's Complexity Tracking table or the plan changes.

**Version**: 2.0.0 | **Ratified**: 2026-10-06 | **Last Amended**: 2026-10-12
