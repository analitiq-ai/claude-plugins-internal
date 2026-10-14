# Implementation Plan: spec.md is read-only on a story branch

**Branch**: `104-spec` (#104) | **Date**: 2026-10-14 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/104-spec-md-read-only/spec.md`

## Summary

A review-round launch refuses a PR whose diff changes a spec.md and a file outside its folder, whatever wrote the change:
reply `mixed` for spec and code, reply `folders` for two spec folders or a folder's move. On a story branch
(`<issue>-us<N>-<slug>`) `Edit`, `Write` and `NotebookEdit` of a spec.md are refused sooner, by path, sending the agent to the
user and the spec-only PR on `<issue>-spec`. The hold on a changed `spec.md` goes: the binding is the `spec` value alone, and
every round reads `spec.md` at the reviewed commit. A `RESHAPE_SPEC` lock is released by the user's `rebase <ref>` after a
spec change or by `unlock <ref>` when the spec stands. The planning rescope runs on `<issue>-spec`. Decisions are in
[research.md](research.md), shapes in [data-model.md](data-model.md), refusals, replies and the agent in
[contracts/interfaces.md](contracts/interfaces.md).

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), as `scripts/`; the agent and the skill are Markdown

**Primary Dependencies**: git and `gh`, as today. Nothing new

**Storage**: `ledger.db`; the PR doc keeps `spec`, loses `spec_blob` and `spec_held` (nothing reads them), and gains
`regraded_from` and `rebased_onto` (data-model's ledger table). No new table

**Testing**: `python -m unittest -v` in `dev/alq-review/tests` and `dev/alq-plan/tests`, which CI discovers. Each refusal and
reply is a failing test before its code (R10)

**Target Platform**: any machine running Claude Code with alq-review (and alq-plan for US5)

**Project Type**: Claude Code plugin hooks, one agent, one skill's prose

**Performance Goals**: an edit of a spec.md costs no git call beyond today's `locate`; a review-round launch one diff of the
changed paths, and after a release by `rebase` one ancestry check. `rebase <ref>` runs its gh calls, one fetch and two reads
inside the prompt hook, under its default timeout

**Constraints**: the edit rule reads the branch and never GitHub, nor the ledger (R3); every refusal names the next step; the
rules are pure in `specbinding.py` and `policy.py`, the handlers read git and reply; no migration of stored ledgers; no
backwards compatibility. The `cto` rule files and `alq-build`'s skills are out of scope (spec Assumptions)

**Scale/Scope**: `gate.py`, `policy.py`, `facts.py`, `ledger.py`, `specbinding.py`, `worktree.py`, `github.py`,
`agents/conflict-resolver.md` (new), the README; `plugins/alq-plan/skills/issue-spec/SKILL.md`; the two test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No contracts-map shape is touched. What a spec folder, a spec.md and a story branch are is defined once in `specbinding.py` (R2) and every site calls it; the diff rule is one function (R8). Pass. |
| II. Ownership & trust boundaries | The code and the record are in this repo; the git-workflow rule in the engineering repo (R1). An edit's path is resolved against its own checkout (R3). The gate reads git and GitHub, and writes git only as FR-009 allows; the session changes the branch (R6). Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | Each refusal names its step; a gh or git failure in `rebase` stops with its words and keeps the lock (R6); a git failure in the diff check is refused as the launch's base read is (R8); a stored `spec_blob` is ignored, not read (R4). Pass. |
| IV. Test-first | R10 lists each story's tests and the ones deleted with the hold; each is seen to fail first. The rules are pure and tested without git; the handlers through the in-process harness. Pass. |
| V. Smallest complete change | One gate over the diff (R8), and one cheap early refusal at the edit tools (R3); the Bash, commit and rebase readers are dropped (R3 Rejected). The hold, its text step, its README text and its tests are deleted, not kept beside the rule that replaces them (R4). Pass. |
| VI. Governing rule ships apart | The record (ADR drafted from this plan) and the git-workflow rule are their own PRs before the code (R1). Pass. |
| P1. Code decides | The edit rule, the diff check, the keyword and the launch after it are decided in the gate. The rebase, the conflict resolver's dispatch and the push are the session's, named by the reply; code decides the launch check `contains` (R6, R7). A justified deviation, not a Pass: see Complexity Tracking. |
| P2. Only an approved entity releases a hold | The user releases a `RESHAPE_SPEC` lock by `rebase <ref>` after a spec change or `unlock <ref>` when the spec stands; both go through `ledger.unlock`, and nothing else does (R6). Two keywords for one hold: see Complexity Tracking. `rebased_onto` is no hold: it refuses only a round launch. Pass with the justification below. |
| P3. Rules are pure | `spec_folder`, `spec_md_folder`, `story_issue`, `story_edit_refusal`, `mixed_diff_refusal` in `specbinding.py`; the lock text and the launch refusal in `policy.py`; the gate reads git and GitHub and replies. Pass. |
| P4. A check that could not run is its own outcome | gh or git failing in `rebase` (FR-009) or in the diff check stops with its words. Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/104-spec-md-read-only/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

```text
plugins/alq-review/
├── scripts/
│   ├── specbinding.py       # + spec_folder, spec_md_folder, story_issue, story_edit_refusal, mixed_diff_refusal; - text_step
│   ├── gate.py              # on_edit: edit rule; on_workflow: no hold, diff check, launch check `contains`; _rebase
│   ├── policy.py            # - _spec_held and its hold; RESHAPE_SPEC lock text; launch_round: unrebased_onto, done via counted(regraded_only=True)
│   ├── ledger.py            # + regraded_rounds; counted(..., regraded_only=False) (R12)
│   ├── facts.py             # round_facts: earlier, seen, first_reviewed, base from the regraded rounds (R12)
│   ├── worktree.py          # + name_status, fetch_target, contains
│   └── github.py            # + default_branch
├── agents/conflict-resolver.md   # new
└── README.md                # items 2, 5, new 8; Mode; What the user types; State; Layout
plugins/alq-plan/skills/issue-spec/SKILL.md   # rescope on <issue>-spec
dev/alq-review/tests/        # test_specbinding, test_policy, test_worktree_facts, test_agents, test_gate (hold tests deleted)
dev/alq-plan/tests/test_spec_source.py        # the rescope's checkout
```

**Structure Decision**: the repo's `plugins/<name>/` + `dev/<name>/` layout, unchanged. Callers of what changes, read in the
code: `gate.on_edit` by `gate.PRE` for `Edit`, `Write` and `NotebookEdit`; `gate._spec_text` by `_spec_step` and `_assess_spec_step`; `_spec_md_blob`
by `_head_spec_md` and, new, `_rebase`; `_refuse_spec` and `_admit_spec` by `on_workflow` (two sites each);
`specbinding.text_step` by `_spec_text` and `test_specbinding`; `policy._spec_held` by `_holds`; `_holds` by `locked` and
`_lock_reason`; `locked` by `gate._unlock`; `_lock_reason` by `_obstacle` and `launch_round`; `_obstacle` by `mutation`,
`rerequest`, `mark_ready`; `worktree.review_base` by `gate._review_base`; `ledger.unlock` by `gate._unlock` and `ledger.main`;
`gate._on_release` by `on_prompt`; `hookio.refuse` by every handler; `facts.round_facts` by `gate.on_structured_output`,
`briefs.churned` and `briefs.brief`; `ledger.counted` by `policy._capped`, `policy.launch_round`, `facts.round_facts` and
`ledger._append_round`; `policy.launch_round` by `gate.on_workflow`, and its `delta_from` by `briefs._review_prompt`; the
`issue-spec` rescope form by `test_spec_source`. New functions (`name_status`, `fetch_target`, `contains`, `default_branch`,
the `specbinding` rules) have only the callers this plan gives them.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The hook's reply asks the session to rebase, dispatch the conflict-resolver agent and push (P1: code decides) | a gate that rewrote the branch had to handle every partial failure between the rewrite and the push, and four review rounds kept finding states it got wrong (R6); the user chose that the gate checks and the session does the git work (Clarifications, 2026-10-14). It fails safe: the launch check `contains` keeps the old code from being graded against the new spec | the hook rebasing and pushing itself, in place or in a throwaway worktree: rejected (R6); every conflict raised to the user: the user asked for the agent |
| A `RESHAPE_SPEC` lock has two user keywords, `unlock <ref>` and `rebase <ref>` (P2: one action) | the user's ruling is one of two: the spec stands, or it changed and the story must rebase on it; `rebase` checks that the spec changed and records the commit the branch must contain, which `unlock` must not, and both are the user's prompt (ADR-0004) | one `unlock` that always checks: a spec that stands has nothing to rebase on and would be refused for not having changed; `unlock` plus a rebase by hand: nothing would check that the spec changed or keep the old code from a round |

## Open points

Settled by the user in the spec's Clarifications: story branches by name; the rescope on `<issue>-spec`, fresh, never a merged
one; adds or modifies only for the diff check; the record drafted from this plan; `rebase <ref>` as the release after a spec
change, with the gate checking and releasing and the session rebasing (2026-10-14); the scope narrowed to the diff check as the
gate and the edit tools as the early refusal, with its own reply for a folder's move (2026-10-14). Read here, not asked:
`rebase` releases every hold the branch has, as `unlock` does, naming each.

## Mechanisms

- Records first, then one PR per story, US2 on US1 and US3 on US2: R1
- A spec folder, a spec.md and a story branch, pure functions in `specbinding.py`: R2
- The edit rule on Edit, Write and NotebookEdit, before the ledger is read; no Bash, commit or rebase reader: R3
- The hold deleted; the binding is `spec`; `spec.md` present at the reviewed commit: R4
- The `RESHAPE_SPEC` lock text and the unlock reply naming the spec branch and both keywords: R5
- `rebase <ref>`, data-model "`rebase <ref>`": R6
- The conflict-resolver agent, shipped, dispatched by the session, never editing a spec.md: R7
- The diff check, one function with replies `mixed` and `folders`, read from git at a review-round launch: R8
- The rescope on `<issue>-spec`, never a merged one: R9
- The tests of each story, and the hold's deleted: R10
- The README: R11
- FR-010's measurement after a release by `rebase`, one `ledger.py` slice: R12
- FR-011's full round after any rebase: `gate.on_workflow` asks `worktree.contains(root, <last counted head>)` (data-model
  "New interfaces") and passes the answer to `policy.launch_round`, which gives
  `scope="full"` and no `delta_from` on False; the round facts are untouched: R12
