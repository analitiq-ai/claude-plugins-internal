# Implementation Plan: Shim check before commit

**Branch**: `feat/49-shim-check-gate` (#49) | **Date**: 2026-10-02 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/006-shim-check-gate/spec.md`

## Summary

An agent's `git commit` with code or mixed hunks is refused until a shim check has judged the staged tree. A
Jev first says whether the change fixes a defect; a non-fix passes. For a fix, a read-only Sonnet sweeper lists
every site in `HEAD` that does the same operation; Jev answers `level` and `coverage`; code composes `complete`
or `patch`. A `patch` refuses with the sites. Refusals are counted per bug on
one branch, across commits (ADR-0001); the third triggers a deep sweep, the fourth asks the user. It is built inside alq-review as
a second rule on the claim check's `git commit` interception, reusing its hunk labels, its gate-injected workflow
shape and its ledger. Every mechanism is decided in [research.md](research.md); shapes are in
[data-model.md](data-model.md) and [contracts/shim-check.md](contracts/shim-check.md).

## Technical Context

**Language/Version**: Python 3 (the standard library plus `diff-match-patch`, spec 005 R12); JavaScript for the workflow script

**Primary Dependencies**: `diff-match-patch`, through the lineage module of spec 005 R12. Jev (`typesafe/jev-1.13` via OpenRouter, one HTTPS POST); `git`, `gh`, the Claude Code `Workflow` tool
and hook protocol, SQLite

**Storage**: `ledger.db` under the plugin state root, three new tables (`shim_checks`, `shim_chains`,
`shim_rulings`); a `HEAD` snapshot per running check under `<main checkout>/.claude/worktrees/shim-<12 hex>/`, deleted when the check
ends or is replaced (R3)

**Testing**: `python3 -m unittest discover -s tests`; gate tests drive `scripts/gate.py` with hook payloads,
recorded agent outputs and a stub Jev endpoint, so no test calls a model. The SC-001 replay calls Jev live

**Target Platform**: any machine running Claude Code with the plugin enabled, a GitHub `origin` and the OpenRouter
key file

**Project Type**: Claude Code plugin (hooks, workflows, agents)

**Performance Goals**: SC-003: a checked commit adds at most 4 minutes typically (sweep 2–4 min, Jev ~1 s); a
retry of a checked tree adds nothing; a chain with a deep list re-judges with one Jev call

**Constraints**: the commit hook only reads the ledger and git; the Jev call runs in the PostToolUse hook with its own
timeout; sweepers and judges cannot modify files; Jev's ~33k-token request limit (R13, Limits)

**Scale/Scope**: one Jev `kind` call per code commit; one sweeper per fix commit, three in a deep sweep, one judge
per contested site

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No shape from the contracts map is added or re-declared. Records, outputs and verdict values are internal to alq-review and defined once in `scripts/shimcheck.py`. Hunk labels are the claim check's, not re-derived (R2). Pass. |
| II. Ownership & trust boundaries | Everything lives in alq-review in this repo. Agent output is untrusted: validated against `HEAD` or the staged tree before it is recorded (R5, R8). The sweeper has only Read, Glob and Grep on a `HEAD` snapshot, so it cannot write or run anything (R3). Code goes to OpenRouter/TypeSafe for every repo, private ones included, by the user's decision. The key is read from a file, never committed. No public repo is touched. Pass. |
| III. Fail loud, no workarounds | A failed sweeper, Jev error, missing key or missing agent type leaves the commit refused and says the check failed (R13); a crashed gate refuses under enforce, unchanged. A diff too large for Jev is refused with the split, not truncated (Limits). Pass. |
| IV. Test-first | `tasks.md` starts every mechanism from a failing test, run before the code. Pass. |
| V. Smallest complete change | One new pure module, one hook module, one client, one workflow, two agents. Labels, preconditions, range overlap, the user-prompt release path and the ledger are reused, not copied. Pass. |
| VI. Governing rule ships apart | No rule file, lint or schema check changes. The plugin README documents the plugin and changes with it. Pass. |
| P2. Only an approved entity releases a hold | A chain held at count 4 is released by the user alone, by a prompt `override shim-<id>` (R11). The release lasts until a commit lands on the branch and does not lower the count; nothing else releases the hold or starts the count again. A held chain is released by that prompt alone (data-model `shim_chains`): no check is launched for a tree that matches it, an override of another bug does not let such a tree through, and a bug joined to it is held with it (decision record 0014). Pass. |
| P5. Settled design, existing tools first | Every mechanism cites a decision below. R9 reuses the lineage module of spec 005 R12, which cites the survey of 2026-10-06 in issue #17. Pass. |

Re-check after Phase 1: unchanged. One deviation from the spec's wording is recorded rather than hidden: the
contested-site judge is a fresh agent of the assessor's standing, not the round assessor (R7); the spec's user
section defines "assessor" that way.

## Project Structure

### Documentation (this feature)

```text
specs/006-shim-check-gate/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/shim-check.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks, not this command
```

### Source Code (repository root)

```text
.claude/plugins/alq-review/
├── .claude-plugin/plugin.json     # version 0.8.0
├── config.json                    # + shim_checks: enforce
├── hooks/hooks.json               # Read|Glob|Grep entry for sweeper_read.py; 60 s timeouts (R3, R6)
├── README.md                      # + the shim check, contests, `override shim-<id>`
├── agents/
│   ├── shim-sweeper.md            # new: tools Read, Glob, Grep; standard and callers-first briefs
│   └── shim-site-judge.md         # new: tools Read, Glob, Grep
├── workflows/shim-check.js        # new: modes not_fix / sweep / deep / rejudge
├── scripts/
│   ├── shimcheck.py               # new, pure: site ids, validators, verdict, chain matching, commit decision
│   ├── shimgate.py                # new: hook handlers (commit, launch + snapshot, sweeper read allow, outputs, override)
│   ├── jev.py                     # new: the Jev request
│   ├── snapshot.py                # new: export and guarded removal of the HEAD snapshot
│   ├── sweeper_read.py            # new: lean hook allowing the sweeper's reads inside the snapshot only
│   ├── claimcheck.py              # commit_preconditions split out of commit_decision
│   ├── gate.py                    # routes to shimgate: on_bash, on_workflow, StructuredOutput, on_prompt
│   ├── hookio.py                  # shim_checks_mode, refuse_shim
│   ├── ledger.py                  # three tables, Shims accessor
│   └── briefs.py                  # sweep, deep and judge prompts; shim-check args
└── tests/
    ├── test_shimcheck.py          # new: pure functions
    ├── test_gate.py               # shim gate cases
    ├── replay_shim.py             # new: SC-001 live replay
    └── fixtures/shim-replay/      # recorded diffs and sweeps of the evidence table
```

**Structure Decision**: the claim check's layout, mirrored: a pure rules module (`shimcheck.py`, as
`claimcheck.py`) and a hook-handler module (`shimgate.py`, as `claimgate.py`), so `gate.py` only routes.

Callers of what changes: `gate.on_bash` is called by `gate.handle` for every PreToolUse `Bash`; `claimcheck.commit_decision` by `claimgate.on_commit` only; `gate.on_workflow`,
`on_structured_output` and `after_structured_output` by `gate.handle` for every `Workflow` and `StructuredOutput`
call; `gate.on_prompt` for every user prompt; `ledger.SCHEMA` by every ledger call through `_connect`;
`hookio._setting` by every mode read.

## Mechanisms

- Commit interception after the claim check, own setting, shared preconditions: R1
- Hunk labels from the claim check's read of the same tree: R2
- Sweeper reading a `HEAD` snapshot with Read, Glob, Grep only: R3
- The shim-check workflow and its gate-chosen modes: R4
- Schema-pinned sweep output validated against `HEAD`; site ids: R5
- Jev client; `kind` at launch, `level`/`coverage` from the recording hook: R6
- Verdict composed in code; the contested-site judge: R7
- Contest acceptance, rulings, deferred issues, re-judge without a sweep: R8
- Bug chains per branch, their ranges carried from one checked tree to the next: R9
- Deep sweep (three alq-review sweepers) at the third refusal, reused target afterwards: R10
- Hold at the fourth refusal; the user's `override shim-<id>` per bug until a commit lands: R11
- Sweep-miss logging inside a chain: R12
- Cost, failed and stopped checks, restart, and the log: R13
- Check, chain and ruling records in the ledger database: R14

## Complexity Tracking

No constitution violations to justify.

## Limits

- A code diff over Jev's ~33k-token limit cannot even be classified `fix` / `not_fix`, so it is refused as too
  large and must be split. Measured: 41–50 of 638 recent plugins commits (6–8%) have code diffs over 60–100 kB.
- The OpenRouter key file must be present wherever alq-review runs, the bot image included; without it every
  code commit is refused under `enforce`. Release order: one Jev call succeeds on the bot before the bump
  (quickstart §9).
- A chain range whose lines are moved elsewhere in the file is dropped (R9). An override ends when a commit lands
  on the branch (R11).
- Commits that do not go through `git commit` as the Bash tool runs it are not intercepted (spec 005).
