# Implementation Plan: Claim check before commit

**Branch**: `feat/43-claim-check-gate` | **Date**: 2026-10-01 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-claim-check-gate/spec.md`

## Summary

An agent's `git commit` is refused until the staged change has been checked. The check finds the claims the
added prose makes about the repo's own code and judges each one against the staged tree, one
agent per claim. A claim ruled `WRONG` refuses the commit and is handed back with its failing case; `UNSURE`
comes back as a note. It is built inside the alq-review plugin as a second rule on the gate's existing
`git commit` interception, one new workflow, three read-only agents, and four ledger tables. Every mechanism is
decided in [research.md](research.md); shapes are in [data-model.md](data-model.md) and
[contracts/claim-check.md](contracts/claim-check.md).

## Technical Context

**Language/Version**: Python 3 (stdlib only, as the rest of `scripts/`), JavaScript for the workflow script

**Primary Dependencies**: none new. Uses `git`, the Claude Code `Workflow` tool and hook protocol, SQLite

**Storage**: `ledger.db` under the plugin state root, four new tables (`claim_checks`, `claim_reads`,
`claim_verdicts`, `claim_holds`); no copy of the tree: agents read the worktree, which must match the index

**Testing**: `python3 -m unittest discover -s tests`; gate tests drive `scripts/gate.py` with hook payloads and
recorded agent outputs, so no test calls a model

**Target Platform**: any machine running Claude Code with the plugin enabled and a GitHub `origin`

**Project Type**: Claude Code plugin (hooks, workflows, agents)

**Performance Goals**: spec SC-004: a commit adding up to 30 claims decided within 5 minutes. The commit-time
hook only reads the ledger

**Constraints**: the hook must stay fast (a command hook that times out renders no decision); judges cannot
modify files; verdicts are unmeasured and the user accepts that

**Scale/Scope**: tens of claims per commit; one reader batch per 16 hunks; one judge per K1 claim

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No shape from the contracts map is added or re-declared. The records, outputs and verdict values are internal to alq-review and defined once in `scripts/claimcheck.py`; the claim categories K1-K8 are the study's, used as labels only. Pass. |
| II. Ownership & trust boundaries | Everything lives in alq-review in this repo, which owns the plugin. Agent output is untrusted input: R6 validates it before it is recorded, and evidence outside the staged tree is rejected; the contest judge's fetches are limited to the cited sites (R9). No public repo is touched; no secret. Pass. |
| III. Fail loud, no workarounds | A crashed gate refuses the commit (R1); a failed check refuses and says so (R10); no fallback and no compatibility branch. The one thing the plan cannot do exactly, treat "a claim" as the same claim after rewording, is stated as a reading to confirm (R8), not worked around. Pass. |
| IV. Test-first | `tasks.md` starts every mechanism from a failing test, run before the code. Pass. |
| V. Smallest complete change | No second checker, no cap, no record-only phase, no built-in accuracy threshold (spec). Fingerprints are git's own (`write-tree`, `patch-id`), not hand-rolled. Pass. |
| VI. Governing rule ships apart | No rule file, lint or schema check changes. The plugin README documents the plugin and changes with it. Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/005-claim-check-gate/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/claim-check.md
└── tasks.md             # /speckit-tasks, not this command
```

### Source Code (repository root)

```text
.claude/plugins/alq-review/
├── .claude-plugin/plugin.json     # version 0.7.0
├── config.json                    # + claim_checks, claim_warn_over
├── hooks/hooks.json               # PreToolUse matcher + WebFetch
├── README.md                      # + the claim check, and the new unlock form
├── agents/
│   ├── claim-reader.md            # new: tools Read
│   ├── claim-judge.md             # new: tools Read, Glob, Grep
│   └── claim-contest-judge.md     # new: the same plus WebFetch
├── workflows/claim-check.js       # new
├── scripts/
│   ├── claimcheck.py              # new: ids, validators, commit decision, record transitions (pure)
│   ├── gate.py                    # on_bash (commit), on_workflow, WebFetch, StructuredOutput hooks, on_prompt
│   ├── shell.py                   # commit action carries staging flags and whether it stands alone
│   ├── worktree.py                # tree_hunks; added_lines split over a diff parser
│   ├── ledger.py                  # four tables and their accessors
│   └── briefs.py                  # reader and judge prompts, claim-check args
└── tests/
    ├── test_claimcheck.py         # new: pure functions
    └── test_gate.py               # claim-check gate cases added
```

**Structure Decision**: one new pure module holds the claim-check rules, as `policy.py` holds the review rules,
so `gate.py` only routes. The workflow, agents and prompts follow the review-round layout.

Callers of what changes: `gate.on_bash` (PreToolUse `Bash`) is called by `gate.handle` for every Bash call;
`shell.classify` by `gate.on_bash`; `worktree.added_lines` by `facts.round_facts` only; `ledger.SCHEMA` by every
ledger call through `_connect`; `gate.on_workflow` by `gate.handle` for `Workflow` calls; `on_structured_output`
and `after_structured_output` by `gate.handle` for every `StructuredOutput` call; `gate.on_prompt` for every
user prompt.

## Mechanisms

- Commit interception in the existing gate: R1
- Staged-tree identity and a commit command that stands alone: R2
- Staged hunks, removals included, from the shared diff parser: R3
- The claim-check workflow: R4
- Read-only agents over a worktree that matches the staged tree: R5
- Validation of agent output against the staged tree: R6
- Check, read, verdict and hold records in the ledger database: R7
- Refusal bound per git hunk and the user's unlock: R8
- Contest with evidence, a fresh judge and host-limited fetches: R9
- Cost, large-commit warning, failed-check result and the log: R10
- A commit hook's changes are not checked again: R11

## Complexity Tracking

No constitution violations to justify.

## Limits

- Repos without a GitHub `origin` are outside the plugin's reach today, so they are outside this check.
- A new file is one hunk, so one refusal count; text moved to other lines, or a commit that lands on `HEAD`,
  starts a new count (R8).
- Commits that do not go through `git commit` as the Bash tool runs it are not intercepted (list in research.md).
