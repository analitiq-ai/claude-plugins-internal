# Implementation Plan: The spec lives in the spec folder

**Branch**: `feat/25-spec-in-spec-folder` | **Date**: 2026-10-08 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/018-spec-in-spec-folder/spec.md`

## Summary

Move the home of an issue's spec from a `<!-- analitiq-spec -->` comment to a spec folder, and make that comment a
two-line location comment. One module, `scripts/speclocation.py`, owns the location comment's form: it writes it (the `design-doc` skill, after its run completes and it has committed the spec folder and pushed the
branch, or `design-doc #<n> none <reason>`), reads it for the skills (`show`), and resolves it for the gate
(`resolve`: branch to issue to comment to folder to `spec.md` text, refusing with a next step at each way it can
fail). The gate hands reviewers and the assessor that text and the folder's path; the three skills say "the spec
folder, found by the location comment"; the old pin test is replaced by tests of the new rule.

## Technical Context

**Language/Version**: Python 3 (stdlib only, as `plugins/alq-review/scripts/`); Markdown skills; Node-free

**Primary Dependencies**: `gh` CLI (already the gate's only GitHub path), `git`, `specify` CLI (already driven by `design-doc`)

**Storage**: the issue's one comment; files in the checkout. The plugin's ledger is untouched

**Testing**: `unittest`, in `dev/alq-review/tests/`, run by CI (`.github/workflows/tests.yml`); the fake `gh` and `Gate` base class of `tests/test_gate.py`

**Target Platform**: Linux/macOS developer machines running Claude Code with the plugin

**Project Type**: Claude Code plugin (scripts + skills + workflows)

**Performance Goals**: N/A: one extra `gh api` list call and one `git show` per round launch (the list call already happens today)

**Constraints**: no backwards compatibility (an old-style comment is refused, FR-010); a refusal names one next step (P1); `gh` not answering is a refusal in gh's words, never "no spec" (P4); the repo is private so no public-repo limits bind the files written here

**Scale/Scope**: 1 new module, edits in `github.py`, `briefs.py`, `gate.py`, 3 skills' text, README line 52, 4 test files

## Constitution Check

*GATE: passes before Phase 0; re-checked after Phase 1 (below).*

| Gate | Result |
|---|---|
| I. Contract-first | The location comment's form is a new shape. It is internal to this plugin (no other repo consumes it), is defined once in `speclocation.py` (R1), and generates its own docs by being the only code that spells it. It is not in the contracts map and does not need to be: no published schema, type list or second validator is added. **Pass.** |
| II. Ownership / trust | Everything lands in this repo, which owns the plugin. Issue and reason text reach `gh` through a body file on stdin, never a command line (R4); `spec` paths from the comment are checked to stay inside the repo before any file is read (FR-010). No secrets. **Pass.** |
| III. Fail loud, no compat | Old-style comments are refused, not read (FR-010); nothing falls back to the comment text. **Pass.** |
| IV. Test-first | Every task starts from a failing test (R9). **Pass** (enforced in `tasks.md`). |
| V. Smallest complete change | `alq-shape` is not touched (Assumptions); `briefs.branch_spec` is deleted, not kept beside `resolve`; the three skills' inline `--jq` filters are deleted. **Pass.** |
| VI. Governing rule apart from governed code | The change replaces `tests/test_spec_source.py`, a standing guard over the skills' text, in the same PR that rewrites those skills. **See Complexity Tracking.** |
| P1. Code decides | Posting is one script the `design-doc` skill runs after it commits and pushes, and the skills call `show`; the gate refuses in code with a next step. No rule rests on an agent following prose except the two skill entry points that choose to *run* the script. **Pass.** |
| P2. Approved entity releases a hold | No lock, count or hold is added or changed. **N/A.** |
| P3. Pure rules, thin handlers | `parse`/`render` are pure. `resolve` takes the issue's comments and a checkout and decides; `gate.py` only maps its refusal to `refuse`. **Pass.** |
| P4. Check that could not run | `gh` failing stays a `RuntimeError` in gh's words and refuses the launch; it is never rendered as "no location comment" (R7). **Pass.** |
| P5. Settled design | Every mechanism below cites R1 to R9, each with Decision, Rationale, Existing tools. **Pass.** |

## Project Structure

### Documentation (this feature)

```text
specs/018-spec-in-spec-folder/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── speclocation-cli.md
└── tasks.md             # /speckit-tasks, not this command
```

### Source Code (repository root)

```text
plugins/alq-review/
├── scripts/
│   ├── speclocation.py          # new: parse / render / resolve / show / post / none
│   ├── github.py                # issue_spec returns (id, body); upsert helper
│   ├── briefs.py                # branch_spec deleted; prompt and brief take the resolved spec
│   └── gate.py                  # review + assess launch call resolve; refusal text
├── skills/
│   ├── design-doc/SKILL.md      # `none` entry; after the run: commit the spec folder, push, post the comment
│   ├── alq-issue-tackle/SKILL.md
│   └── alq-root-cause-check/SKILL.md
└── README.md                    # enforcement item 5

dev/alq-review/tests/
├── test_speclocation.py         # new
├── test_spec_source.py          # rewritten
├── test_gate.py                 # IssueSpec rewritten
└── test_worktree_facts.py       # the one mock of github.issue_spec follows its new return
```

**Structure Decision**: one new module for the location comment, because three consumers and one writer share its form
(R1); handlers stay thin (P3).

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| VI: `test_spec_source.py` (a guard over the skills' text) is replaced in the same PR as the skills it grades | FR-013 requires it. The old pin asserts the opposite of the decided rule (no copy in the worktree; the spec fetched from the comment), so it cannot stay green across this change | Landing a PR that deletes the old pin first leaves the skills ungated until the second PR, and the new pin would still arrive with the rewrite. The user decided: one PR |

## Mechanisms

- The location comment's form (render and parse): R1
- Branch-to-spec resolution and its refusals: R2
- Posting and updating the one location comment: R4
- Commit, push and post after a `design-doc` run, and the `none` entry: R5
- Skills reading the location comment through `show`: R6
- Gate refusal at review and assess launch: R7
- The reviewer prompt and the assessor brief: R8
- Tests replacing the old pin: R9
