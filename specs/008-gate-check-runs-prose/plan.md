# Implementation Plan: Gate verdicts are check runs (#9)

**Branch**: `docs/9-gate-check-runs-prose` | **Date**: 2026-10-04 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/008-gate-check-runs-prose/spec.md`

## Summary

Two prose files still describe the pr-gate's `codex-review` and `internal-review` as commit statuses
with a description. On main they are check runs from the `analitiq-pr-gate` App, and the reason is in
the run's title. The fix rewrites those sentences.

- `pr-review-loop.md` names the run and its App, and points to the skill.
- `alq-github-pr-review/SKILL.md` names the run and its App and tells agents to act on the state and
  title the poller prints under *Gate check runs*. It lists no gate states (R3).

The change is prose only. Most of it is already on the branch (`2e484ad`, plus an uncommitted rule
edit). What is left: commit the rule edit and the R3 rewrite, and run the quickstart checks.

## Technical Context

**Language/Version**: Markdown (agent-read rule and skill files)

**Primary Dependencies**: none. The prose mirrors `pr-gate.js` (`analitiq-ai/.github`) and
`poll-pr-review.sh` (this repo).

**Storage**: N/A

**Testing**: grep checks and a manual comparison with `pr-gate.js` ([quickstart.md](quickstart.md)).
The SC-001 grep is red on `main` (3 matches, run 2026-10-04).

**Target Platform**: Claude Code agents in the cto workspace

**Project Type**: documentation (rules + skill)

**Performance Goals**: N/A

**Constraints**: no code, hook or script changes (FR-007). no override-merge sentence is added (FR-006).

**Scale/Scope**: 2 files, about 8 sentences

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Result |
|---|---|
| I. Contract-first | Pass (justified, see Complexity Tracking). No new shape. The state list is removed (R3); the prose keeps only the run's name, its App and the 👍 paragraph, pinned by quickstart step 3 at a `.github` commit, not by an automated test. |
| II. Ownership & trust | Pass. The rules and skill live in `analitiq-ai/engineering` (private). No public-repo content changes. |
| III. No workarounds | Pass. The sentences become true. no override-merge sentence is written ahead of the identity split (#17). |
| IV. Test-first | Pass. Quickstart steps 1–2 are run red on `main` before the branch is checked green. Prose has no unit under test. |
| V. Smallest change | Pass. It edits existing sentences only. Every "commit status" about the gate in both files is fixed (the class sweep). |
| VI. Rule apart from code | Pass. This PR is prose only. The code it describes (poller, #8) shipped in its own PR (#55). |

Post-design re-check: still passes. R3 removes the state list; no new gate fact is added.

## Project Structure

### Documentation (this feature)

```text
specs/008-gate-check-runs-prose/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/gate-prose.md
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
.claude/
├── rules/pr-review-loop.md                 # :15 — run + App + pointer to skill
└── skills/github-pr-review/
    ├── SKILL.md                            # :12 run + pointer, :14 👍 para, :18 blockers, :35 settle, :43 exit-4
    └── poll-pr-review.sh                   # read-only reference; not edited
```

**Structure Decision**: Edit the two Markdown files in place. The poller is the reference and is not changed.

## Complexity Tracking

| Deviation | Why it is kept | Pin |
|---|---|---|
| Un-gated prose copy of gate facts in SKILL.md: the run's name and App, and the 👍 paragraph (the gate may count a 👍 tied to the head; a reaction starts no workflow) | Agents need these to read the right object and to know why the poller dispatches a sweep. Markdown cannot import `pr-gate.js` from another repo, so no drift test is possible here. The state list, the larger copy, is removed (R3). | Quickstart step 3, against `pr-gate.js@9bd2b2997c03` |

## Mechanisms

- `codex-review`/`internal-review` named as `analitiq-pr-gate` App check runs in both files: R1
- Rule points to the skill instead of restating gate behaviour: R2
- SKILL.md points to the state and title the poller prints instead of listing gate states: R3
- "gate statuses" → "gate check runs" in SKILL.md: R4
- Poller-describing sentences corrected to match `poll-pr-review.sh`: R5
- No override-merge sentence added: R6
