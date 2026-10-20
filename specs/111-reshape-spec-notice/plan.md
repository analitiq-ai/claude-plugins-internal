# Implementation Plan: A RESHAPE_SPEC ruling names its spec and tells the spec's issue

**Branch**: `111-spec` | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/111-reshape-spec-notice/spec.md`

## Summary

When a round is ruled `RESHAPE_SPEC`, the `assess-round` result returns the PR's bound spec folder (the gate injects
it on both launch paths). The gate, in the same PostToolUse that records the ruling, claims a one-time notice on the
round. It then posts the reshape summary as a comment on issue `<n>` (taken from the folder name
`specs/<n>-<slug>`), and adds the `reshape_spec` label and the `escalate_to` assignee. Each call's outcome is stored
on the round. A failure is shown in the lock refusal and the `unlock` reply. The summary has one renderer, shared by
the comment and the unlock reply.

## Technical Context

**Language/Version**: Python 3 (stdlib only) for hooks; JavaScript for Workflow scripts

**Primary Dependencies**: `gh` CLI (existing); no new package

**Storage**: the existing `ledger.db` round document, plus a new `notice` key ([data-model.md](data-model.md))

**Testing**: `unittest` in `reviewer/tests/`, with a stub `gh` logging to `$GH_LOG`, and `workflow_harness.mjs`
for workflow results

**Target Platform**: Claude Code hooks on Linux/macOS

**Project Type**: Claude Code plugin (hook scripts + workflows)

**Performance Goals**: the hook runs `ingest_inbox`, the ruling's ledger save, two `gh` calls (each capped at
20 s by `github._answer`) and the outcome's ledger save, inside the 60 s hook timeout. A ledger save can wait up
to 60 s for a busy ledger, so the hook can be killed after GitHub answered but before the outcome is saved. That
window is accepted: the outcome stays `null` and reads "GitHub's answer was not recorded" (P4). No deadline
check is added.
**Duplicate delivery**: `record_notice` raises `LedgerError` only if two outputs for one round both pass
`_awaits` before either is saved; `_awaits` refuses any output once the round is `assessed`, and one assessor
submits one output at a time. If it happens, the PostToolUse hook fails open with a `systemMessage` (`gate.main`).

**Constraints**: the ledger transaction is not held across `gh` calls; no retry; exactly one claim per ruling

**Scale/Scope**: about 6 files in `reviewer/plugin/` + tests; one new module

## Constitution Check

*Pre-design and post-design: same result.*

| Gate | Result | Notes |
|---|---|---|
| I. Contract-first | PASS | No new contract. The assessment schema is unchanged; `spec_folder` is a workflow arg and result key that the gate owns, as `decisions` is. |
| II. Ownership & trust boundaries | PASS | Code lives in `reviewer/plugin/`. The gate adds only the folder, PR number and round (FR-013), and no secrets. The assessor's text is posted as written in every repo: it describes the repo's own code (FR-013). |
| III. Fail loud, no workarounds | PASS | Each gh error is stored in gh's words and shown wherever the branch's lock is shown. A config error is stored the same way. Nothing is retried or defaulted. |
| IV. Test-first | PASS | [quickstart.md](quickstart.md) lists 16 scenarios, each to be written red first. |
| V. Smallest complete change | PASS | No outbox, no retry, no label creation, no unlock-side cleanup. |
| VI. Rule apart from code | PASS | No rule file, lint, guard or schema check changes. README is documentation of the behaviour and changes with it. |
| P1. Code decides | PASS | The comment, label and assignee come from gate code, not from an agent. |
| P2. Approved releaser | PASS | No hold added or changed. The `RESHAPE_SPEC` lock is still released only by the user's `unlock` (ADR-0018). The notice reads no hold, and no hold reads the notice. |
| P3. Rules pure | PASS | `reshape.py` is pure. `gate.py` does the I/O. The workflows only forward and return. |
| P4. Could-not-run is its own outcome | PASS | Each outcome is done, an error, or `null` ("GitHub's answer was not recorded"). None of these is read as success. |

ADRs touched, none reversed: 0018 (unlock only), 0008 (spec not in an issue comment: the comment points to the
folder), 0002 (state in the local store: the outcome lives in the ledger), 0016 (the binding is read, never
changed).

## Project Structure

### Documentation (this feature)

```text
specs/111-reshape-spec-notice/
├── spec.md
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── assess-round-result.md
│   └── github-notice.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
reviewer/plugin/
├── config.json              # + escalate_to
├── README.md                # enforces-2 text, Mode/config key, Layout row for reshape.py
├── scripts/
│   ├── reshape.py           # NEW: issue_of, summary, comment, notice_failures (pure)
│   ├── briefs.py            # spec_folder(); injected into assess_args and review_args; brief() reuses it
│   ├── ledger.py            # claim_notice, record_notice
│   ├── github.py            # comment_issue, escalate_issue (via _answer)
│   ├── hookio.py            # escalate_to()
│   ├── policy.py            # _holds appends reshape.notice_failures to the verdict-lock hold
│   └── gate.py              # _reshape_brief uses reshape.summary; after_structured_output posts; _unlock shows failures
└── workflows/
    ├── assess-round.js      # returns spec_folder
    └── review-round.js      # forwards spec_folder to nested assess-round

reviewer/tests/
├── test_reshape.py          # NEW: pure functions
├── test_gate.py             # notice calls, once-only, failures in refusal/unlock, null spec, log mode
├── test_ledger.py           # claim/record notice
├── test_policy.py           # failure text in the lock reason; lock unchanged
└── (workflow harness tests) # spec_folder in both result paths
```

**Structure Decision**: existing plugin layout. The one new module, `reshape.py`, holds the pure rules (R8).

**Callers of what changes**: `_reshape_brief` ← `_unlock` ← `_on_release` ← `on_prompt`.
`after_structured_output` ← `handle` (PostToolUse StructuredOutput). `briefs.assess_args` / `review_args` ←
`on_workflow`. `briefs.brief` ← `briefs.main` (the assessor's brief command). `policy._holds` ← `locked`,
`_lock_reason` ← `_obstacle` / `launch_round` ← `mutation`, `rerequest`, `mark_ready`, and gate's `_held` / `hold` /
`_unlock`.

## Complexity Tracking

No violations.

## Mechanisms

- `spec_folder` injected on both assess-round launch paths and returned in its result (`briefs.spec_folder`, `assess_args`, `review_args`, `review-round.js`, `assess-round.js`): R1
- One reshape-summary renderer shared by the comment and the unlock reply (`reshape.summary`, `gate._reshape_brief`): R2
- Spec issue number from the folder's name (`reshape.issue_of`): R3
- Notice claimed with the ruling, calls outside the transaction, outcome stored after (`ledger.claim_notice`, `ledger.record_notice`, `gate.after_structured_output`): R4
- GitHub comment and label+assignee calls that raise in gh's words (`github.comment_issue`, `github.escalate_issue`): R5
- `escalate_to` config key, no default (`config.json`, `hookio.escalate_to`): R6
- Failure text in the lock refusal and the unlock reply (`reshape.notice_failures`, `policy._holds`, `gate._unlock`): R7
- New pure module for the reshape rules (`scripts/reshape.py`): R8
