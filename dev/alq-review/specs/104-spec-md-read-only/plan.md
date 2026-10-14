# Implementation Plan: spec.md is read-only on a story branch

**Branch**: `104-spec` (#104) | **Date**: 2026-10-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/104-spec-md-read-only/spec.md`

## Summary

On a story branch (`<issue>-us<N>-<slug>`) every write to a spec.md is refused: at `Edit`/`Write`/`NotebookEdit`, at a Bash
command of a form in the spec's writes table, and at `git commit` on what it would record, with one text that sends the agent to
the user and the spec-only PR on `<issue>-spec`. The hold on a changed `spec.md` goes: the binding is the `spec` value alone,
and every round reads `spec.md` at the reviewed commit. A `RESHAPE_SPEC` lock is released by the user's `rebase <ref>` after a
spec change or by `unlock <ref>` when the spec stands. `rebase <ref>` only checks: the PR's base is the default branch and the
bound `spec.md` changed there. It then releases the lock, records the default branch's commit, and tells the session to rebase,
dispatch the shipped conflict-resolver agent on conflicts, and push; the gate changes nothing in git. The next round is refused
until the branch contains that commit, and is then a full round whose facts count only the commits and rounds since the
release. A review-round launch and the attestation refuse a diff that changes a
spec.md and code, by one pure rule. The planning rescope runs on `<issue>-spec`. Decisions are in [research.md](research.md),
shapes in [data-model.md](data-model.md), refusals, replies and the agent in [contracts/interfaces.md](contracts/interfaces.md).

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), as `scripts/`; the agent and the skill are Markdown; `hooks.json` is JSON

**Primary Dependencies**: git and `gh`, as today. Nothing new

**Storage**: `ledger.db`; the PR doc keeps `spec`, loses `spec_blob` and `spec_held` (nothing reads them), and gains
`regraded_from` and `rebased_onto`, set by a release by `rebase <ref>` (R9, R15). No new table

**Testing**: `python -m unittest -v` in `dev/alq-review/tests` and `dev/alq-plan/tests`, which CI discovers. Each refusal,
reply is a failing test before its code (R13)

**Target Platform**: any machine running Claude Code with alq-review (and alq-plan for US5)

**Project Type**: Claude Code plugin hooks, one agent, one skill's prose

**Performance Goals**: an edit costs one `rev-parse` more than today, only for a spec.md on a story branch; a commit one `diff
--cached --name-only`; a launch one `diff --name-status`, and after a release by `rebase` one `merge-base --is-ancestor`; a
ready one `gh api` for the PR's files. `rebase <ref>` does a `gh repo view`, the PR lookup, a fetch and two blob reads inside
the prompt hook, under its default timeout

**Constraints**: the story rule reads the branch and never GitHub, nor the ledger (R6); every refusal names the next step; the
rules are pure in `specbinding.py` and `policy.py`, the handlers read git and reply; no migration of stored ledgers; no
backwards compatibility. The `cto` rule files and `alq-build`'s skills are out of scope (spec Assumptions)

**Scale/Scope**: `gate.py`, `policy.py`, `facts.py`, `specbinding.py`, `shell.py`, `worktree.py`, `github.py`,
`agents/conflict-resolver.md` (new), the README; `plugins/alq-plan/skills/issue-spec/SKILL.md`; the two test suites

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | No contracts-map shape is touched. What a spec.md and a story branch are is defined once in `specbinding.py` (R2) and every site calls it; the diff rule is one function for its two sites (R11). Pass. |
| II. Ownership & trust boundaries | The code and the record are in this repo; the git-workflow rule in the engineering repo (R1). A command's path and GitHub's file list are validated where they enter (R4, R11). The gate reads git and GitHub; the session changes the branch (R9). Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | Each refusal names its step; a gh or git failure in `rebase` stops with its words and keeps the lock (R9); a stored `spec_blob` is ignored, not read (R7). Pass. |
| IV. Test-first | R13 lists each story's tests and the ones deleted with the hold; each is seen to fail first. The rules are pure and tested without git; the handlers through the in-process harness. Pass. |
| V. Smallest complete change | The hold, its text step, its lock, its README text and its tests are deleted, not kept beside the rule that replaces them (R7). The writes table is the spec's, no wider. Pass. |
| VI. Governing rule ships apart | The record (ADR drafted from this plan) and the git-workflow rule are their own PRs before the code (R1). Pass. |
| P1. Code decides | The three sites of the story rule, the commit backstop, the diff check, the keyword and the launch after it are decided in the gate. The rebase, the conflict resolver's dispatch and the push are the session's, named by the reply; code decides that no round opens until the branch contains the recorded commit (R9, R10). A justified deviation, not a Pass: see Complexity Tracking. |
| P2. Only an approved entity releases a hold | The user releases a `RESHAPE_SPEC` lock by `rebase <ref>` after a spec change or `unlock <ref>` when the spec stands; both go through `ledger.unlock`, and nothing else does (R9). Two keywords for one hold: see Complexity Tracking. `rebased_onto` is no hold: it refuses only a round launch, until the branch contains it (R9). Pass with the justification below. |
| P3. Rules are pure | `spec_md_folder`, `story_issue`, `story_write_refusal`, `mixed_diff_refusal` in `specbinding.py`; the lock text and the launch refusal in `policy.py`; the gate reads git and GitHub and replies. Pass. |
| P4. A check that could not run is its own outcome | gh or git failing in `rebase` or at the attestation's file list stops with the error and keeps the lock or refuses the ready (R9, R11). Pass. |

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
│   ├── specbinding.py       # + spec_md_folder, story_issue, story_write_refusal, mixed_diff_refusal; - text_step
│   ├── gate.py              # on_edit: story rule; on_bash: writes, commit backstop; on_workflow: no hold, diff check, the launch after a rebase release; _rebase: the checks and the release
│   ├── policy.py            # - _spec_held and its hold; RESHAPE_SPEC lock text; launch_round: unrebased_onto refused, no delta across regraded_from
│   ├── facts.py             # round_facts reads only the rounds from regraded_from on
│   ├── shell.py             # Action.paths; kind write
│   ├── worktree.py          # rebasing (locate uses it), to_commit, name_status, fetch_target, contains
│   └── github.py            # pr_files, default_branch
├── agents/conflict-resolver.md   # new
└── README.md                # items 2, 5, new 8; Mode; What the user types; State; Layout
plugins/alq-plan/skills/issue-spec/SKILL.md   # rescope on <issue>-spec
dev/alq-review/tests/        # test_specbinding, test_shell, test_policy, test_worktree_facts, test_gate (StoryBranch, Rebase, MixedDiff; hold tests deleted)
dev/alq-plan/tests/test_spec_source.py        # the rescope's checkout
```

**Structure Decision**: the repo's `plugins/<name>/` + `dev/<name>/` layout, unchanged. Callers of what changes, read in the
code: `gate._spec_text` by `_spec_step` and `_assess_spec_step`; `_refuse_spec` and `_admit_spec` by `on_workflow` (two sites
each); `_spec_md_blob` by `_head_spec_md`; `specbinding.text_step` by `_spec_text` and `test_specbinding`; `policy._spec_held`
by `_holds`; `_holds` by `locked` and `_lock_reason`; `locked` by `gate._unlock`; `_lock_reason` by `_obstacle` and
`launch_round`; `_obstacle` by `mutation`, `rerequest`, `mark_ready`; `mutation` by `gate.on_edit`, `on_bash`, `_held`, `hold`;
`shell.classify` by `gate.on_bash` only (`claimgate.on_commit` and `shimgate.on_commit` take its `Action`); `worktree.locate` by
`gate` (`_held`, `on_edit`, `on_bash`, `on_workflow`), `claimgate` (two), `shimgate` (three), `ledger.main`; `review_base` by
`gate._review_base`; `ledger.unlock` by `gate._unlock` and `ledger.main`; `gate._on_release` by `on_prompt`; `worktree.contains`
(new) by `gate.on_workflow`; `hookio.refuse` by every handler; `facts.round_facts` by `gate.on_structured_output`,
`briefs.churned` and `briefs.brief`; `policy.launch_round` by `gate.on_workflow`, and its `delta_from` by
`briefs._review_prompt` (the delta diff, `git diff <delta_from>..HEAD`); the `issue-spec` rescope form by `test_spec_source`.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| The hook's reply asks the session to rebase, dispatch the conflict-resolver agent and push (P1: code decides) | a gate that rewrote the branch had to handle every partial failure between the rewrite and the push, and four review rounds kept finding states it got wrong (R9); the user chose that the gate checks and the session does the git work (Clarifications, 2026-10-14). It fails safe: until the branch contains the recorded commit no round opens, so the old code is never graded against the new spec | the hook rebasing and pushing itself, in place or in a throwaway worktree: rejected (R9); every conflict raised to the user: the user asked for the agent |
| A `RESHAPE_SPEC` lock has two user keywords, `unlock <ref>` and `rebase <ref>` (P2: one action) | the user's ruling is one of two: the spec stands, or it changed and the story must rebase on it; `rebase` checks that the spec changed and records the commit the branch must contain, which `unlock` must not, and both are the user's prompt (ADR-0004) | one `unlock` that always checks: a spec that stands has nothing to rebase on and would be refused for not having changed; `unlock` plus a rebase by hand: nothing would check that the spec changed or keep the old code from a round |

## Open points

Settled by the user in the spec's Clarifications: story branches by name; the rescope on `<issue>-spec`, fresh, never a merged
one; adds or modifies only for the diff check; the record drafted from this plan; `rebase <ref>` as the release after a spec
change, with the gate checking and releasing and the session rebasing, resolving conflicts through the agent and pushing
(2026-10-14). Read here, not asked: the attestation site reads the PR's
files from GitHub because a ready may run from outside any checkout (R11); `rebase` releases every hold the branch has, as
`unlock` does, naming each (R9).

## Mechanisms

- Records first, then one PR per story, US2 on US1 and US3 on US2: R1
- A spec.md and a story branch, three pure functions in `specbinding.py`: R2
- The story rule on Edit, Write and NotebookEdit, before the ledger is read: R3
- Bash writes as `write` actions of the one shell reader, each path judged by its own checkout: R4
- The commit backstop on the paths a commit would record, before the claim and shim gates: R5
- The branch under a rebase reported by `worktree.locate`: R6
- The hold deleted; the binding is `spec`; `spec.md` present at the reviewed commit: R7
- The `RESHAPE_SPEC` lock text and the unlock reply naming the spec branch and both keywords: R8
- `rebase <ref>`: the checks on the default branch, the release through `ledger.unlock`, `rebased_onto`, and the launch refused until the branch contains it: R9
- The conflict-resolver agent, shipped, dispatched by the session, never editing a spec.md: R10
- The mixed-diff rule, one function, read from git at a launch and from GitHub at the attestation: R11
- The rescope on `<issue>-spec`, never a merged one: R12
- The tests of each story, and the hold's deleted: R13
- The README: R14
- After a release by `rebase`, a full round, and facts and the delta read only the rounds from the first after it: R15
