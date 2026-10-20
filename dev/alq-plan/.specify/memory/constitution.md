# planner Constitution

Constitution for building the `planner` plugin. Its Spec Kit project is `dev/alq-plan/` in
`analitiq-ai/claude-plugins-internal`; the plugin it governs is `plugins/alq-plan/`. Paths are
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

Numbered so a principle carries one number in every plugin of this repo: P1, P3 and P4 as in the
`reviewer` constitution (`dev/alq-review/.specify/memory/constitution.md`); P6 to P8 as in
every plugin of this repo; P5 is planning's own. There is no P2: planning holds nothing, so
there is no hold to release. planner has no hooks: P6's refusals are reviewer's
(`dev/alq-review/docs/adr/0022-refuse-from-any-agent-session-every-github-write-the-orchestrator-or-a-human-own.md`,
decision 1).

### P1. Code Decides, Not Prose

Gate: is every planning rule the plan adds decided by a workflow step that runs a script, with
no step that relies on the agent reading and obeying text, and does every step that stops a run
name the next legal step?

Source: `plugins/alq-plan/speckit/` (the workflow and its steps);
`plugins/alq-plan/skills/issue-spec/scripts/drive_workflow.py`.

### P3. Rules Are Pure; Workflows Carry None

Gate: does every decision the plan adds live in a pure function of stored state and git's
answers, with each script's command line doing only input/output and the workflow, its driver
and the skill doing only orchestration?

Source: `plugins/alq-plan/scripts/`; `plugins/alq-plan/speckit/`.

### P4. A Check That Could Not Run Is Its Own Outcome

Gate: when a reader, judge, model or service the plan depends on does not answer, is that
reported as a failed check or a named `cannot verify` — never as a pass, never as a finding
against the author, and never as a guess?

Source: `plugins/alq-plan/scripts/premise_report.py`, `rootcause.py`, `settled_design.py`
(each exit status).

### P5. Settled Design, Existing Tools First

Gate: does every mechanism in `plan.md` cite a `research.md` decision carrying Decision,
Rationale and Existing tools (or `None fit. Looked at: <where>`), so nothing is hand-rolled
before what already exists was looked at?

Source: `plugins/alq-plan/scripts/settled_design.py`; `plugins/alq-plan/speckit/` (the
settled-design step).

### P6. One Writer per State

Gate: for every state the plan reads or writes (a lane, a label, a status, the assignee, the PR
body, a hold, a commit), does the plan name its one writer, and does the plugin write only the
state it owns and refuse, from any agent session, every write it does not own?

Source: `dev/alq-plan/docs/adr/0005-have-the-skill-that-shapes-an-issue-read-and-write-the-spec-in-its-spec-folder.md`
(decision 4); `dev/alq-plan/docs/adr/0006-close-an-issue-not-worth-doing-and-post-nothing-for-one-that-needs-no-spec.md`
(decisions 1–2); orchestrator ADR-0002,
https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md
(decision 1).

### P7. Facts Are Read as Data, Never Parsed from Prose

Gate: does every fact the plan reads come from a key, a field, a status or a name with a grammar,
never from a heading, a comment's wording or free text; and does every fact the plan writes for
another reader land in such a form?

Source: `dev/alq-plan/docs/adr/0009-spec-facts-as-front-matter-in-spec-md-spec-kit-s-stock-tasks-template.md`
(decision 1); `dev/alq-plan/docs/adr/0008-give-an-issue-that-needs-no-spec-a-spec-folder-that-says-so.md`
(decision 1); orchestrator ADR-0003,
https://github.com/analitiq-ai/claude-plugins-internal/blob/main/orchestrator/docs/adr/0003-keep-the-loop-s-durable-state-in-github-objects.md
(decision 2).

### P8. Generic over Repositories

Gate: does the plan assume of a repository only the branch grammar, the spec folder and GitHub's
own objects, with every per-repository value in config and no repository name, path or setting
special-cased?

Source: `dev/alq-plan/docs/adr/0010-check-the-plan-against-the-governing-decision-logs-before-critique.md`
(decisions 1–2); `dev/alq-plan/docs/adr/0005-have-the-skill-that-shapes-an-issue-read-and-write-the-spec-in-its-spec-folder.md`
(decision 2); `dev/alq-plan/docs/adr/0004-recognise-a-spec-folder-by-spec-kit-s-mark.md`.

## Platform Constraints

Facts a plan can get wrong. Each is owned by the file named; consult it rather than this summary.

- Repo shape: `plugins/<name>/` holds what an install copies, listed in
  `.claude-plugin/marketplace.json`; `dev/<name>/` holds what the plugin is built with (this
  project, its `specs/<nnn>-<feature>/` and its `tests/`) and is never installed (`README.md`).
- Tests: CI runs every `tests/` folder under `dev/` that is not inside a `fixtures/` folder (`.github/workflows/tests.yml`).
- Planning has no hooks: it runs as the Spec Kit workflow its skill starts
  (`plugins/alq-plan/skills/issue-spec/`, `plugins/alq-plan/speckit/`).
- The plugin requires no other plugin: its manifest has no `dependencies` field
  (`plugins/alq-plan/.claude-plugin/plugin.json`).
- Private repo: Principle II's public-repo limits bind what the plugin writes into public repos,
  not this repo's own files.

## Delivery Workflow

Not gates — context so `/speckit-tasks` shapes tasks to fit: issue-numbered branch, worktree at
`.claude/worktrees/<n>`, draft PR, then the review loops and the pre-merge checklist. Owned by the
organisation's `.claude/rules/github-workflow.md` and
`.claude/rules/pr-review-loop.md`. Decision records go in `dev/alq-plan/docs/adr/`. The adrkit
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
- The repo is private, so the constitution is committed here. Each other plugin in the repo has
  its own Spec Kit project and constitution; nothing here binds them.
- Compliance: `/speckit-plan` evaluates every gate in its Constitution Check; a violation MUST be
  justified in the plan's Complexity Tracking table or the plan changes.

**Version**: 1.1.0 | **Ratified**: 2026-10-09 | **Last Amended**: 2026-10-20
