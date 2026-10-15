# Implementation Plan: A PR labelled cleanup gets no alq-review gating

**Branch**: `114-spec` (#114) | **Date**: 2026-10-15 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/021-spec-deletion-ungated/spec.md`

## Summary

`github.is_cleanup` is the one name test and `github.cleanup` the one reader (R1). The ready gate treats a
labelled PR as it treats a version-only release; an attestation comment gets its own kind so the label does not
stand in for it (R2). The merge gate allows a labelled PR beside an attestation or a release (R3). A commit on a
labelled branch skips claim-check and shim-check (R4). The poller runs today's loop with its Codex, thread and
hand-over terms switched off, and keeps its exit codes (R7). A failed read gates the PR as unlabelled and says so.
The user adds the label on GitHub; this feature refuses no command that adds it (R5, R6). ADR-0021 lands first,
in its own PR (R9).

Reasons: [research.md](research.md). What each consumer does: [data-model.md](data-model.md). Edges:
[contracts/interfaces.md](contracts/interfaces.md). This file owns the code map and the callers of what changes.

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), standard library only; the poller is bash + jq

**Primary Dependencies**: `gh` CLI, as today; nothing new

**Storage**: none new

**Testing**: `python3 -m unittest -v` in `dev/alq-review/tests/` (R11)

**Target Platform**: any machine running Claude Code with alq-review installed

**Project Type**: Claude Code plugin (hooks, a skill and its poller)

**Performance Goals**: one `gh` call per `git commit` in a located checkout, per ready and per poller run; each
under `github._answer`'s 20 s, inside the hooks' 60 s / 45 s. Merge adds a field to a call it already makes.

**Constraints**: one name test and one reader (FR-002); the label lifts only the review holds (FR-013); the org
pr-gate is untouched (FR-005)

**Scale/Scope**: one label; nothing in `/alq-post-merge` (R12)

## Constitution Check

| Principle | Answer |
|---|---|
| I. Contract-first | No new shape: GitHub's label list, read through `gh`. Pass. |
| II. Ownership & trust boundaries | All in this repo's plugin; the org pr-gate is not touched (FR-005). Pass. |
| III. Fail loud, no workarounds | A failed read gates the PR; the ready refusal and the poller say the label could not be read (FR-007). Pass. |
| IV. Test-first | Every scenario a failing test first (R11). Pass. |
| V. Smallest complete change | A name test, a reader, a CLI entry for the poller, one more term where a release already counts. No new type, loop or exit code. Pass. |
| VI. Governing rule ships apart | ADR-0021 is its own PR, merged first (R9). Pass. |
| P1. Code decides | Ready, merge, commit and the poller's outcome are decided in code; the skill routes by exit code. Pass. |
| P2. Only an approved entity releases a hold | ADR-0021 names the label as the release of the review holds only (R10). Nothing refuses an agent's label add until the user's rule exists (R6): Complexity Tracking. |
| P3. Rules are pure | `is_cleanup` and `policy.mark_ready` are pure; the hooks and the poller read and answer. Pass. |
| P4. A check that could not run is its own outcome | A failed read is never a pass, and is named (FR-007). Pass. |

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
└── tasks.md
```

### Source Code (repository root)

The ADR first, its own PR (branch `114-adr`, R9): `dev/alq-review/docs/adr/0021-*.md`.

Then the code (branch `114-spec`):

```text
plugins/alq-review/
├── scripts/
│   ├── github.py              # CLEANUP_LABEL, is_cleanup(), cleanup(), main() (R1, R7)
│   ├── shell.py               # an attestation comment is kind `attest` (R2)
│   ├── gate.py                # on_bash: ready counts the label as a release; attest does not; commit skips
│   │                          #      claim/shim on a labelled branch (R2, R4)
│   └── pre_merge_gate.py      # fetch reads labels; unmet allows a labelled PR (R3)
├── skills/alq-github-pr-review/
│   ├── poll-pr-review.sh      # cleanup switch, ERR trap (R7)
│   └── SKILL.md               # Cleanup PRs (R8)
├── .claude-plugin/plugin.json # MINOR bump
└── README.md                  # contracts/interfaces.md § README
dev/alq-review/tests/
├── test_github.py             # new
├── test_shell.py
├── test_gate.py
├── test_pre_merge_gate.py
├── test_poll_pr_review.py
└── test_poller_contract.py
```

**Callers of what changes**, read in the code: `shell.classify` by `gate.on_bash` and `test_shell`;
`gate.on_bash` by `gate.main` on `PreToolUse`; `policy.mark_ready` by `gate.on_bash` and `test_policy`, its
signature unchanged; `pre_merge_gate.fetch` and `unmet` by `gated` (lines 436, 444) ← `main` on `PreToolUse`;
`claimgate.on_commit` / `shimgate.on_commit` by `gate.on_bash` (lines 361-362); `poll-pr-review.sh` by the agent
following the skill, `test_poll_pr_review` and `test_poller_contract`. `github.pr_target` is unchanged.
`hooks.json` is unchanged: both hooks already see every Bash call.

## Complexity Tracking

| Violation | Why needed | Simpler alternative rejected because |
|---|---|---|
| P2: until the user's rule forbidding it exists, an agent can add the label and release its own PR's review hold | The user decided this feature refuses no label command (FR-010) | Refusing the `gh` forms here was rejected by the user, who adds that rule apart from this plugin. Closed by ADR-0021 action item 3 |

## Open points

None. The issue's open point is out of scope by Clarification 4 (R12).
