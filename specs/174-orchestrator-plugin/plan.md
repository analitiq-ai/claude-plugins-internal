# Implementation Plan: The orchestrator plugin carries core

**Branch**: `174-spec` | **Date**: 2026-10-30 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/174-orchestrator-plugin/spec.md`

## Summary

Create `orchestrator/plugin` as a core carrier (link, exact pins, v3 lock, pinned version, guard-first entry
points), list it in the marketplace, and give it hooks. Story 1: SessionStart, UserPromptSubmit and PreToolUse mint
the read-only session token into `~/.local/state/codeworks/orchestrator/gh/`, and UserPromptSubmit claims or
resumes the issue `/codeworks <s>` names, writing the session's issue record after the lane write. Story 2: the
Stop hook pushes the agent identity's passed commits, or all of them while reviewer is off, from a hook-owned
copy and opens the draft PR; on a stop builder's rule in core finds, it pushes nothing and sends the card to Blocked
with the rule's reason. Story 3:
attest and flip. Story 4: request modules, reply, merge, and wait up to `review_timeout` inside the Stop run. Story
5: bound counts in tagged orchestrator App comments. Each decision is a pure function; entry files only read, call
and write.

## Technical Context

**Language/Version**: TypeScript run directly by Node ≥ 22.18 (type stripping), as core (root ADR-0009)

**Primary Dependencies**: core (`../../core/src` link) and its pins only: `zod` 4.6.7, `yaml` 2.9.1, `smol-toml`
1.9.1; `git` and `gh` on the agent machine

**Storage**: GitHub (lanes, comments, check runs); files under `~/.local/state/codeworks/orchestrator/`, at core's
paths: `gh/` (session token), `sessions/<id>.json` (session's issue), `push/` (Story 2)

**Testing**: `node --test` and `tsc -p .` in `orchestrator/`; core's `fake-github.ts`; hook entry files driven by
recorded stdin; `core/scripts/check-carriers.ts` in CI

**Target Platform**: the agent machine (Linux, Claude Code under managed settings, SECURITY.md §5)

**Project Type**: Claude Code plugin (hooks only, plus one command file)

**Performance Goals**: PreToolUse adds no GitHub call while the stored token has ≥ 10 min left; a mint finishes
inside the hook's 60 s timeout

**Constraints**: Stop's wait ends before its 3900 s hook timeout (`review_timeout` ≤ 3600); the orchestrator App's
token never touches disk; no Python; imports only core

**Scale/Scope**: one session per agent machine, one issue per session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Gate | Answer |
|---|---|
| I. Contract-first | New shapes are core contracts: the session's issue record (C1, contracts/session-record.md) and the counts snapshot (C6, contracts/counts-comment.md). `[orchestrator]` is the orchestrator's own section, validated by it (root ADR-0002 d2). The gh folder reuses core's format. No second validator. **Pass** |
| II. Ownership & trust | Plugin code in `orchestrator/`; shared reads and writes in `core/`, no later than the story PR that first calls them. Hook input, settings, GitHub answers and the model's commits are validated where they enter (R3, R5, R13). Keys only through `readKey`; no secret in code. **Pass** |
| III. Fail loud | Every mint, settings, GitHub or record failure refuses naming its cause; Stop's crash fails open by record (ADR-0001 d5), not by catch. A crash between lane write and record fails closed (R9). **Pass** |
| IV. Test-first | Each task starts from a failing node:test against the fake GitHub or a recorded hook input; decisions are pure (R3). R13 and R20 name the behaviour not yet run and the task that runs it first. **Pass** |
| V. Smallest complete change | Each story adds the keys it reads (FR-007). No validators link (spec: Not here). **Pass** |
| VI. Rule apart from code | The managed-settings change (SECURITY.md §5, `core/src/keys.ts`) lands in its own PR before Story 1. `check-carriers.ts` is not changed. **Pass** |
| P4. Could-not-run | A module that does not answer is COULD_NOT_RUN or SILENT through core's `status`/`findings`; a GitHub no-answer refuses, never reads as empty. **Pass** |
| P6. One writer | Lanes, keyed reasons, counts, check runs, PR state, pushes: the orchestrator App via these hooks. Session record and gh folder: these hooks, write-denied to the model. Releases and rounds: reviewer. **Pass** |
| P7. Facts as data | The prompt by grammar (R20); the identity by `git config --file`; counts and records as JSON under a tag; the story by branch grammar (root ADR-0005); the required checks from GitHub's rules or a settings key, never from a refusal's wording (R22). **Pass** |
| P8. Generic | Repository from the checkout's origin; every value in `codeworks.toml`; nothing repo-specific. **Pass** |
| P9. Named identities | Every trust predicate reads a GitHub login or role; no codeworks App counts (core `appLogins`). **Pass** |
| P1, P3, P5 | Apply to reviewer and planner; P3's split (pure rules, I/O handlers) and P5's mechanism list are followed anyway. **N/A** |

Re-check after Phase 1: unchanged. No violations; Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/174-orchestrator-plugin/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── hooks.md
│   ├── orchestrator-settings.md
│   ├── gh-config-folder.md
│   ├── session-record.md
│   └── counts-comment.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
orchestrator/
├── package.json                  # test script, dev pins (planner's)
├── package-lock.json
├── tsconfig.json
├── plugin/                       # what an install copies
│   ├── .claude-plugin/plugin.json   # version pinned, bumped with core
│   ├── package.json              # core's runtime pins, exact
│   ├── package-lock.json         # lockfileVersion 3
│   ├── core -> ../../core/src
│   ├── commands/codeworks.md     # R20
│   ├── hooks/
│   │   ├── hooks.json
│   │   ├── session-start.ts      # US1
│   │   ├── prompt.ts             # US1: mint, claim/resume, record
│   │   ├── pre-tool-use.ts       # US1: mint
│   │   └── stop.ts               # US2–US5
│   └── lib/
│       ├── guarded.ts            # guard-only static import
│       ├── hook-io.ts            # stdin schema, refuse, context
│       ├── settings.ts           # OrchestratorSettings, R5
│       ├── app-token.ts          # in-memory orchestrator token, R12
│       ├── session-token.ts      # ensureSessionToken, R7
│       ├── start.ts              # decideStart (pure) + facts read, R9
│       ├── keyed.ts              # postKeyed, R11
│       ├── push.ts               # US2: decidePush (pure), copy, R13–R14; US4: stage 2
│       ├── bounds.ts             # US5: decideBounds (pure), counts, R17
│       └── loop.ts               # US3–US4: attest/ready/review/merge decisions and the wait, R15, R18
└── tests/
    ├── carrier.test.ts           # guard exit 2, imports only core (FR-003)
    ├── session-token.test.ts
    ├── start.test.ts
    ├── prompt-hook.test.ts
    └── …                         # US2–US5 suites
core/src/                         # C1–C13, each no later than the story PR that first calls it
.claude-plugin/marketplace.json   # + orchestrator
builder/plugin/skills/issue-tackle/SKILL.md   # US2, R19
```

**Structure Decision**: one component folder per root ADR-0001; `plugin/` is installed, `tests/` is not. CI's
existing `tests.yml` runs `orchestrator/tests/` and the carrier check with no change.

## Delivery order and core needs

Each core need lands no later than the story PR that first calls it (spec Assumptions); C6 and C7 land in it. Rows marked † are needs this plan
found that the spec's list does not name.

| # | PR | Before (or in) | Holds |
|---|---|---|---|
| M | Managed settings | US1 | SECURITY.md §5 and `keys.ts`: `~/.local/state/codeworks/orchestrator` write-denied, `GH_CONFIG_DIR` in `env`, replacing `/tmp/verify-b-ghsess` |
| C1 | Session's issue record | US1 | `contracts/session-record.ts`, `session-record.ts`, `files.ts` (R8) |
| C2 | Issue → story branch and PR | US1 | `<s>`'s `<s>-us<k>-<slug>` branch and `storyPr` from it |
| C3 † | Issue graph | US1 | `blockedBy` and sub-issues of an issue (R9) |
| C4 † | Lane write | US1 | `moveCard` beside `laneOf` in `board.ts`; only the orchestrator App holds projects write |
| C13 † | State-folder paths | in US1 | `orchestrator-paths.ts`: the state folder, `gh/`, `sessions/`, `push/` from a given home; builder's step script reads them (#217) |
| — | **US1** | | plugin, marketplace, three hooks, claim |
| C7 † | Push with an in-memory token | in US2 | R13 |
| #209 | Commit-check pass record | US2 | #209's core PR: `readCommitPasses`, passes by branch, `off` |
| #217 | builder's stop rule | US2 | #217's core PR: `storyStop`, `StopState` and the read of its facts (R21) |
| — | **US2** | | Stop hook: push, draft PR, running workflow; builder skill change |
| C10 | Protected-path matcher | US3 | spec Assumptions |
| — | **US3** | | attest, exempt, ready |
| C8, C9, C11 | Rulings/replies/FIX commits in the snapshot; conflict-with-main finding; validator request time | US4 | spec Assumptions |
| C14 | Required checks from a list | in US4 | `requiredChecks` grades a given list in place of the rules (R22) |
| — | **US4** | | In review, modules, replies, stage-2 push, merge, Stop's wait |
| C6 † | Tagged-snapshot channel | in US5 | `state.ts` read/post parameterised by tag, App and schema (R17) |
| — | **US5** | | bound counts |
| — | reviewer #209 | US2–US5 live | reviewer on core; reads the record; writes releases |

Deferred, not folded in: planner's `land.ts` reads sub-issues in its own script; moving it onto C3 is a
separate issue (it touches planner, not this change).

## Complexity Tracking

None.

## Mechanisms

- Carrier shape (link, pins, lock, version, guard-first entry points): R1
- Test harness and CI wiring: R2
- Hook entry files, I/O, exit codes: R3
- Key file names: R4
- Settings read (bootstrap from HEAD, settle on GitHub): R5
- Session gh config folder: R6
- Token refresh within a long turn: R7
- Session's issue record (write-once file, core contract): R8
- Start/resume decision and its writes: R9
- Claim ordered against reviewer's release: R10
- Keyed Blocked reasons and status-issue comments: R11
- In-memory orchestrator App token: R12
- Push from the hook-owned copy (Stop): R13
- Agent identity read: R14
- Stop's wait: R15
- Running workflow, read from Stop's `background_tasks`: R16
- Bound counts in the shared tagged-snapshot channel: R17
- Attest, exempt, ready, In review, replies, merge: R18
- builder's issue-tackle edit: R19
- `/codeworks <issue>` command and prompt grammar: R20
- builder's stop, read through core's stop rule (Stop): R21
- Required checks from `required_checks` where the plan offers no rulesets: R22
