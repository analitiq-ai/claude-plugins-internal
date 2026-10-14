# Implementation Plan: A PR labelled cleanup gets no alq-review gating

**Branch**: `114-spec` (#114) | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/021-spec-deletion-ungated/spec.md`

## Summary

A PR carrying the `cleanup` label is decided by one pure function, `github.is_cleanup` (R1). `policy.mark_ready` and
`pre_merge_gate.unmet` allow it without a round or an attestation, after the holds they already check (R2, R3, R10);
`gate.on_bash` skips the claim and shim commit checks for its branch (R4). Only the user adds the label, on GitHub:
`pre_merge_gate` refuses every gh form by which an agent adds it to a PR, in every mode, with no grant (R5, R6). The poller ends a cleanup PR with exit `5` and hands nothing to the gate
(R7). A new ADR naming the cleanup PR beside the version-only release lands first, in its own PR (R9).

Decisions and reasons: [research.md](research.md). Shapes: [data-model.md](data-model.md). Edges:
[contracts/interfaces.md](contracts/interfaces.md). This file owns the code map and the callers of what changes.

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), standard library only; the poller is bash + jq

**Primary Dependencies**: `gh` CLI, as today; nothing new

**Storage**: none new

**Testing**: `python -m unittest -v` in `dev/alq-review/tests/` (R11)

**Target Platform**: any machine running Claude Code with alq-review installed

**Project Type**: Claude Code plugin (hooks, a skill and its poller)

**Performance Goals**: one `gh` call per `git commit` (R4) and one per ready, merge or poller run; each under
`github._answer`'s 20 s, inside the hooks' 60 s / 45 s

**Constraints**: one decider (FR-002); the label check refuses in every mode (R6); the label lifts no hold (R10); the
org pr-gate is untouched (FR-005)

**Scale/Scope**: one label; nothing in `/alq-post-merge` (R12)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No new shape: GitHub's label list, read through `gh`. Pass. |
| II. Ownership & trust boundaries | All in this repo's plugin; the org pr-gate is not touched (FR-005). Labels enter through `gh` and are validated where read (R1, R3). Pass. |
| III. Fail loud, no workarounds | An unread label gates the PR and the refusal says why (R2, R3); a label form the hook cannot read is refused, not guessed (R6). The open limit (non-gh routes) is stated, not papered over (R6). Pass. |
| IV. Test-first | Every scenario a failing test first (R11). Pass. |
| V. Smallest complete change | One decider, one reader, one CLI entry the poller needs; no diff reading, no new module. Pass. |
| VI. Governing rule ships apart | The ADR amending ADR-0003's list is its own PR, merged first (R9). The README and skill describe the code and ship with it. Pass. |
| P1. Code decides | Ready, merge, commit, label-add and the poller's outcome are decided in code; the skill routes by exit code (R7). Every refusal names its next step (R6, R8). Pass. |
| P2. Only an approved entity releases a hold | The review hold on a PR is released by the user, by one action: adding the label on GitHub; every agent command that adds it is refused (R5, R6). Locks and rounds in flight keep their own releases (R10). The label-add check refuses in log mode too, so log mode is not a second way out (R6). Pass. |
| P3. Rules are pure | `is_cleanup` and `policy.mark_ready` are pure; `gate.py`, `pre_merge_gate.py` and the poller only read and answer. Pass. |
| P4. A check that could not run is its own outcome | An unread label is `unread(why)`: gated, never a pass, and named in the refusal and the poller's warning (data-model). Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/021-spec-deletion-ungated/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

The ADR first, its own PR (branch `114-adr-cleanup`, R9):

```text
dev/alq-review/docs/adr/0019-*.md
```

Then the code (branch `114-cleanup-label`):

```text
plugins/alq-review/
├── scripts/
│   ├── github.py              # CLEANUP_LABEL; is_cleanup(); pr_labels(); branch_labels(); main() for the poller (R1, R4)
│   ├── policy.py              # Cleanup; mark_ready(..., cleanup) (R2)
│   ├── gate.py                # _cleanup(); on_bash: ready passes it, commit skips claim/shim on LABELLED (R2, R4)
│   └── pre_merge_gate.py      # fetch reads labels; unmet allows cleanup; label-add recognition and
│                              #      refusal; refusal sentences (R3, R6, R8)
├── skills/alq-github-pr-review/
│   ├── poll-pr-review.sh      # cleanup branch, exit 5, no hand-over (R7)
│   └── SKILL.md               # exit 5; Cleanup PRs (R8)
├── .claude-plugin/plugin.json # MINOR bump
└── README.md                  # contracts/interfaces.md § README
dev/alq-review/tests/
├── test_github.py             # new
├── test_policy.py
├── test_gate.py
├── test_pre_merge_gate.py
├── test_poll_pr_review.py
└── test_poller_contract.py
```

**Structure Decision**: the plugin's existing split: `github.py` the GitHub boundary with its pure decider beside the
reader (as `version_only_release` / `released`), `policy.py` the rules, `gate.py` and `pre_merge_gate.py` the handlers.

**Callers of what changes**, read in the code: `policy.mark_ready` by `gate.on_bash` (line 377) and `test_policy`;
`pre_merge_gate.unmet` by `pre_merge_gate.gated` (line 444); `pre_merge_gate.fetch` by `gated` (line 436);
`pre_merge_gate.gated` by `main` on `PreToolUse`; `claimgate.on_commit` / `shimgate.on_commit` by `gate.on_bash` (lines 361-362);
`github.pr_target` by `gate.pr_of` and `gate._open_pr`, unchanged; `poll-pr-review.sh` by the agent following the
skill, `test_poll_pr_review` and `test_poller_contract`; `pre_merge_gate.PullRequest` / `first_words` by `gate.py`,
unchanged. `hooks.json` is unchanged: both hooks already see every Bash call.

## Complexity Tracking

None.

## Mechanisms

- The cleanup decider and the label reader: R1
- Ready allowed for a cleanup PR, label unread named: R2
- Merge and ready in the pre-merge gate allowed for a cleanup PR: R3
- Commit checks skipped on a cleanup PR's branch: R4
- No grant; only the user adds the label: R5
- The label-add refusal and its forms: R6
- The poller's cleanup outcome (exit 5, no hand-over): R7
- The refusal sentences and the skill's Cleanup PRs section: R8
- The ADR naming the cleanup PR: R9
- Holds kept on a cleanup PR: R10
- Tests: R11

## Open points

None. The issue's open point is out of scope by Clarification 4 (R12).
