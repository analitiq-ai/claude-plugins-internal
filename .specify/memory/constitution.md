<!--
Sync Impact Report
- Version: 1.2.4 -> 1.3.0 (MINOR: the Delivery Workflow gains the spec's two tiers, #342)
- Changed: Delivery Workflow names the intent tier, frozen to its human and changed only by a spec PR, and
  the design tier, which a story changes on its branch in `spec:` commits graded against the intent
  (root ADR-0012, reviewer ADR-0023); P6's Source lines add both records.
- Removed: none.
- Templates: .specify/presets/settled-design/templates/spec-template.md gains `## Non-goals` and the tier note.
- Follow-up: reviewer's gates and the orchestrator's protected set follow the records (ADR-0023 action items).
-->
# Codeworks Constitution

Constitution for building the components of `analitiq-ai/claude-plugins-internal`: the `reviewer`,
`planner`, `builder`, `auditor` and `orchestrator` plugins, the shared `core/` package, and the
validator packages in `validators/`. Each component is a top-level folder; a plugin's `plugin/` is what
an install copies, `core/` and `validators/` included through a symlink in each plugin that runs them;
nothing else in the repo is installed. Paths are relative to the
repo root unless they name another repo. Each principle is a plan-time gate: a plan passes only if it
answers the gate question for the components it applies to. The files named in each
Source line are the source of truth; this document indexes them and never restates their text.

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

### Repo Principles

A principle carries one number across the repo and names the components it applies to. Where its gate
differs by component, each component's gate is given. P6's refusals are reviewer's hook's for every
component (`reviewer/docs/adr/0012-refuse-from-the-model-s-tool-calls-every-github-write-the-orchestrator-or-an-adm.md`,
decision 1).

### P1. Code Decides, Not Prose

Applies to: reviewer, planner.

Gate (reviewer): is every rule the plan adds decided by code on the hook path, with no step that relies
on an agent reading and obeying an instruction, and does every refusal name the next legal step?

Gate (planner): is every planning rule the plan adds decided by a workflow step that runs a script,
with no step that relies on the agent reading and obeying text, and does every step that stops a run
name the next legal step?

Source: reviewer: `reviewer/plugin/README.md` (opening; How an agent uses it). planner:
`planner/plugin/speckit/` (the workflow and its steps);
`planner/plugin/skills/issue-spec/scripts/drive_workflow.py`.

### P2. Only an Approved Entity Releases a Hold

Applies to: reviewer, planner.

Gate: for every lock, count or hold the plan adds or changes, does the plan name the one entity
approved to release it (the user or another system), and is every action that releases it named
by a decision record? Nothing else may release the hold, lower it or start it again. A hold with
no named approver, or with a way out no decision record names, fails the gate. State that may have been
tampered with reads as held: a commit under a story's directory on the `ledger` branch that is neither a
GitHub-signed, add-only commit of the reviewer App nor a repository admin's GitHub-signed, delete-only
commit of files an invalid commit added or changed; the hold stands until no file the invalid commit added
or changed remains on the branch and it is released as every hold is.

Source: `reviewer/plugin/README.md` (What it enforces 2, 4, 5, 6, 7); how the user's action is recognised:
`reviewer/docs/adr/0013-give-every-hold-one-id-and-release-it-only-on-a-ready-move-and-an-admin-s-commen.md`;
which actions release a hold: the decision record in `reviewer/docs/adr/` that decides that hold.
Tampered state reads as held: `reviewer/docs/adr/0011-record-rounds-and-holds-as-the-reviewer-app-s-github-signed-commits-on-a-ledger.md`
(decision 2). Only reviewer's hook writes state, the rescope hold included:
`reviewer/docs/adr/0013-give-every-hold-one-id-and-release-it-only-on-a-ready-move-and-an-admin-s-commen.md`
(decision 5).

### P3. Rules Are Pure; Handlers and Workflows Carry None

Applies to: reviewer, planner.

Gate (reviewer): does every decision the plan adds live in a pure function of stored state and git's
answers, with hook handlers doing only input/output and workflows doing only orchestration?

Gate (planner): does every decision the plan adds live in a pure function of stored state and git's
answers, with each script's command line doing only input/output and the workflow, its driver
and the skill doing only orchestration?

Source: reviewer: `reviewer/plugin/README.md` (Layout). planner: `planner/plugin/scripts/`;
`planner/plugin/speckit/`.

### P4. A Check That Could Not Run Is Its Own Outcome

Applies to: reviewer, planner, orchestrator.

Gate: when a reader, judge, model or service the plan depends on does not answer, is that
reported as its own outcome — a named `cannot verify`, or `error` on GitHub, never `failure` — and
never as a pass, never as a finding against the author, and never as a guess? The one named
exception: an external reviewer out of credits passes, marked WAIVED.

Source: `docs/adr/0004-treat-a-check-that-could-not-run-as-its-own-outcome-and-enforce-every-check-from.md`
(decisions 1–4); the exception: `docs/adr/0003-keep-the-validator-modules-and-the-state-record-behind-one-contract-each-in-core.md`
(decision 6). reviewer: `reviewer/plugin/README.md` (What it enforces 2, 5, 6). planner:
`planner/plugin/scripts/premise_report.py`, `rootcause.py`, `settled_design.py` (each exit status).

### P5. Settled Design, Existing Tools First

Applies to: planner.

Gate: does every mechanism in `plan.md` cite a `research.md` decision carrying Decision,
Rationale and Existing tools (or `None fit. Looked at: <where>`), so nothing is hand-rolled
before what already exists was looked at?

Source: `planner/plugin/scripts/settled_design.py`; `planner/plugin/speckit/` (the
settled-design step).

### P6. One Writer per State

Applies to: reviewer, planner, builder, orchestrator.

Gate: for every state the plan reads or writes (a lane, a label, a check run, a state
record, a hold, a commit), does the plan name its one writer, and does the component write only the
state it owns and refuse, from the model's tool calls, every write it does not own?

Source: reviewer: `reviewer/docs/adr/0011-record-rounds-and-holds-as-the-reviewer-app-s-github-signed-commits-on-a-ledger.md`
(decision 1); `reviewer/docs/adr/0012-refuse-from-the-model-s-tool-calls-every-github-write-the-orchestrator-or-an-adm.md`
(decision 1); `reviewer/docs/adr/0023-grade-a-story-against-its-frozen-intent-tagged-acceptance-tests-spec-commits-the.md`
(decisions 1–2). planner: `docs/adr/0012-freeze-the-spec-s-intent-tier-to-its-human-and-let-a-story-change-its-design-tie.md`
(decisions 1–3); `planner/docs/adr/0010-create-one-issue-per-story-chain-them-by-blockedby-and-open-the-spec-pr-as-a-dra.md`
(decision 3); `planner/docs/adr/0006-close-an-issue-not-worth-doing-and-post-nothing-for-one-that-needs-no-spec.md`
(decisions 1–2). builder: `builder/docs/adr/0003-open-a-draft-pr-after-the-first-push-and-end-the-turn-at-an-attested-draft.md`
(decisions 1, 2). orchestrator: `orchestrator/docs/adr/0002-the-orchestrator-alone-writes-the-working-lanes-derived-from-the-pr.md`
(decision 1).

### P7. Facts Are Read as Data, Never Parsed from Prose

Applies to: reviewer, planner, orchestrator.

Gate: does every fact the plan reads come from a key, a field, a status or a name with a grammar,
never from a heading, a comment's wording or free text; and does every fact the plan writes for
another reader land in such a form? The one exception is a verdict a provider publishes only in its
review text, which that provider's validator module reads there, in that module alone.

Source: reviewer: `reviewer/docs/adr/0014-derive-the-spec-from-the-branch-at-each-round-s-launch-and-read-the-folder-as-da.md`
(decisions 1, 2); `reviewer/docs/adr/0011-record-rounds-and-holds-as-the-reviewer-app-s-github-signed-commits-on-a-ledger.md`
(decision 1). planner: `planner/docs/adr/0008-spec-facts-as-front-matter-in-spec-md-spec-kit-s-stock-tasks-template.md`
(decision 1); `planner/docs/adr/0007-give-an-issue-that-needs-no-spec-a-spec-folder-that-says-so.md`
(decision 1); `orchestrator/docs/adr/0003-keep-the-loop-s-durable-state-in-github-objects.md`
(decision 3). All: `docs/adr/0005-parse-a-story-s-identity-from-its-branch-in-core-alone.md`; the
exception: `docs/adr/0003-keep-the-validator-modules-and-the-state-record-behind-one-contract-each-in-core.md`
(decision 6).

### P8. Generic over Repositories

Applies to: reviewer, planner, builder, orchestrator.

Gate: does the plan assume of a repository only the branch grammar, the spec folder and GitHub's
own objects, with every per-repository value in `codeworks.toml` and no repository name, path or
setting special-cased?

Source: reviewer: `reviewer/docs/adr/0014-derive-the-spec-from-the-branch-at-each-round-s-launch-and-read-the-folder-as-da.md`
(decision 1); `reviewer/docs/adr/0012-refuse-from-the-model-s-tool-calls-every-github-write-the-orchestrator-or-an-adm.md`
(decision 3). planner: `planner/docs/adr/0009-check-the-plan-and-its-tasks-against-the-governing-decision-logs-before-landing.md`
(decision 1). orchestrator: `orchestrator/docs/adr/0001-drive-the-issue-loop-from-the-orchestrator-plugin-s-hooks-inside-the-agent-sessi.md`
(decision 2). All: `docs/adr/0005-parse-a-story-s-identity-from-its-branch-in-core-alone.md`;
`docs/adr/0002-keep-every-component-s-settings-in-one-toml-file-one-section-per-component.md`;
`docs/adr/0003-keep-the-validator-modules-and-the-state-record-behind-one-contract-each-in-core.md`
(decision 2).

### P9. Trust Only Named Identities

Applies to: reviewer, planner, builder, orchestrator.

Gate: does every predicate the plan adds that trusts an actor (an admin, a WRITER, TRUSTED or EXEMPT
actor, a trusted reviewer) read that actor's GitHub identity; count no command the model runs, which
acts on GitHub only as the `codeworks-session` App, as any of them; and count a review thread as a
finding only when a trusted reviewer started it?

Source: All: `docs/adr/0007-let-the-model-act-only-as-the-session-app-and-hooks-as-the-orchestrator-and-revi.md`
(decisions 1, 3, 4 and 5);
`docs/adr/0003-keep-the-validator-modules-and-the-state-record-behind-one-contract-each-in-core.md`
(decision 2).

## Platform Constraints

Facts a plan can get wrong. Each is owned by the file named; consult it rather than this summary.

- Repo shape: one top-level folder per component; a plugin's `plugin/` is what an install copies,
  listed in `.claude-plugin/marketplace.json`; `core/` and `validators/` reach each plugin that runs
  their code through a symlink an install copies; `tests/` and `docs/adr/` are never installed
  (`README.md`; `docs/adr/0001-keep-each-component-in-one-top-level-folder-with-one-spec-kit-project-at-the-roo.md`).
- Tests: CI runs every `<component>/tests/` folder (`.github/workflows/tests.yml`).
- Language: `core/` is TypeScript on Node, its contracts Zod schemas; no Python code calls core, and a
  plugin's script moves to TypeScript in the change that first makes it call core
  (`docs/adr/0009-build-core-in-typescript-and-move-a-plugin-s-scripts-to-typescript-when-they-fi.md`).
- Value sets: every verdict, ruling, outcome and hold kind is an enum defined once; code never repeats
  a value's string (`docs/adr/0010-name-every-verdict-ruling-and-outcome-once-as-an-enum-in-core-s-contracts.md`).
- Agent machine: the orchestrator, builder and reviewer run in one session on a dedicated machine with no
  admin GitHub credential, under Claude Code's managed settings; an admin starts each session naming one
  issue; only hooks read a key; planner runs outside it, where its admin works, as its own App
  (`docs/adr/0008-run-the-agent-session-on-one-agent-machine-under-managed-settings-with-keys-only.md`). The
  model's GitHub token is read-only; hooks make every write
  (`docs/adr/0007-let-the-model-act-only-as-the-session-app-and-hooks-as-the-orchestrator-and-revi.md`).
- reviewer: each check's `log` / `enforce` setting sits beside the plugin's mode
  (`reviewer/plugin/README.md`: Mode). Where it keeps its state: GitHub-signed commits on the served
  repo's `ledger` branch (`reviewer/docs/adr/0011-record-rounds-and-holds-as-the-reviewer-app-s-github-signed-commits-on-a-ledger.md`).
  Its reviewer agents come only from `pr-review-toolkit`, `auditor` and its own `agents/`
  (`reviewer/docs/adr/0019-run-every-reviewer-and-the-assessment-inside-one-review-round-workflow.md`, decisions 3, 4).
- planner runs as the Spec Kit workflow its skill starts (`planner/plugin/skills/issue-spec/`,
  `planner/plugin/speckit/`), its own scripts minting its App token (root ADR-0007 d4); it runs outside
  the agent machine, with no other codeworks plugin beside it, and writes no reviewer state.
- builder runs only on the agent machine, with no GitHub App or key of its own (root ADR-0007,
  ADR-0008 d1, d4); its review step is reviewer's internal round, which no install requires: its manifest
  declares no plugin dependency (`builder/plugin/skills/issue-tackle/SKILL.md`;
  `builder/docs/adr/0002-have-the-build-skills-derive-the-spec-folder-from-the-issue-number-never-from-an.md`,
  decisions 1, 5).
- Private repo: Principle II's public-repo limits bind what a component writes into public repos,
  not this repo's own files.

## Delivery Workflow

Not gates — context so `/speckit-tasks` shapes tasks to fit: one issue per user story (sub-issues
under the spec's issue when a spec has several), a story branch `<s>-us<k>-<slug>` with its worktree at
`../<repo>.worktrees/<branch>`, a draft PR closing its story issue, then the review loops and the
pre-merge checklist. Owned by the organisation's `.claude/rules/github-workflow.md` and
`.claude/rules/pr-review-loop.md`. A story is done when its PR merged or an admin closed its issue
(`docs/adr/0005-parse-a-story-s-identity-from-its-branch-in-core-alone.md`, decision 5). The spec lands
first by a spec PR on `<p>-spec`, in `specs/<p>-<slug>/`, `<p>` being the spec's issue. Its intent tier
— the issue body and, in `spec.md`, `## User Scenarios & Testing`, `## Success Criteria`, `## Non-goals`
and `## Why this is worth doing` — is the human's and changes only by a later spec PR; its design tier —
the other sections, `plan.md`, `research.md`, the story's own block of `tasks.md`, and the decision
records — a story changes on its branch in `spec:` commits, graded against the intent
(`docs/adr/0012-freeze-the-spec-s-intent-tier-to-its-human-and-let-a-story-change-its-design-tie.md`,
decisions 1–5; `reviewer/docs/adr/0023-grade-a-story-against-its-frozen-intent-tagged-acceptance-tests-spec-commits-the.md`).
Decision records go in the component's `docs/adr/`, or in `docs/adr/` at the root for the repo as a
whole. The adrkit `after_plan` hook is optional: it offers to check a plan against them.

## Governance

- This constitution inherits the Analitiq organisation constitution v1.1.0. Principles I–VI are
  copied verbatim and are not weakened or edited here; amendments to them happen upstream first,
  then are re-synced into this file.
- The files named in the repo principles' Source lines are the source of truth; where one
  disagrees with this document, the file wins and this document is amended.
- Amending a repo principle: change its source file first, in its own PR (Principle VI),
  then amend this document and bump its version — MAJOR for removing or redefining a principle,
  MINOR for adding a principle or section, PATCH for wording.
- The repo is private, so the constitution is committed here. It is the repo's one constitution and
  replaces the three per-plugin constitutions (reviewer 3.1.0, planner 1.1.0, builder 2.1.0).
- Compliance: `/speckit-plan` evaluates every gate in its Constitution Check; a violation MUST be
  justified in the plan's Complexity Tracking table or the plan changes.

**Version**: 1.3.0 | **Ratified**: 2026-10-20 | **Last Amended**: 2026-11-07
