# Implementation Plan: The internal review round checks the diff against the decisions that govern it

**Branch**: `88-us1-decision-review` (#88) | **Date**: 2026-10-12 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/020-decision-review/spec.md`

## Summary

At an internal round's launch the gate lists the files of the round's own diff range and asks adrkit, per corpus
(each tracked `docs/adr` and the org corpus at `ALQ_ORG_ADR_DIR`), which governing records cover them. A new boundary
module `adrkit.py` runs adrkit's own library under the hook's deadline and returns one outcome per corpus; a new pure
module `decisions.py` judges adrkit's findings by the spec's rules. When records govern the change,
`alq-review:decision-reviewer` joins the round's expected reviewers with those records as its brief, and its findings
reach `assess-round` like any other. The round's result carries a `decisions` block. An internal round of more than
`max_review_files` files (50) is refused before any adrkit call; the check has its own `decision_checks` setting; each
assessed round's rulings on the decision reviewer's findings go to `gate.log`. The user's notice choice lands first as
ADR-0020 in its own PR, with the constitution's lines on per-check settings and reviewer agents.

Decisions and their reasons are in [research.md](research.md); the check's shapes, causes and refusals in
[data-model.md](data-model.md); the outside interfaces in [contracts/interfaces.md](contracts/interfaces.md).

## Technical Context

**Language/Version**: Python 3 (CI runs 3.13), standard library only, as the rest of `scripts/`; the agent is Markdown;
the workflow is JavaScript

**Primary Dependencies**: git, as today; adrkit's CLI `adr` at one pinned version (node ≥ 22) on `PATH` of the machine
that launches rounds, new, required only when a corpus is to be checked (R4, R5, R11)

**Storage**: none new. The round's `expected` list in the PR's ledger doc names the decision reviewer when it joins;
the check's result is reported in the workflow's return and kept nowhere (R9)

**Testing**: `python -m unittest -v` in `dev/alq-review/tests/` (R14)

**Target Platform**: any machine running Claude Code with alq-review installed; `ALQ_ORG_ADR_DIR` is per machine

**Project Type**: Claude Code plugin (hook, workflow, agent)

**Performance Goals**: one adrkit call per corpus, all corpora at once,
within one 55 s deadline shared with the 30 s review-base fetch and the `gh` calls (R4, R7). Not measured on this
repo's corpora; the deadline bounds them, and a deadline refusal names what each step spent

**Constraints**: no path list anywhere (R2); one validator per document (adrkit's); the gate's one copy of adrkit is
its rule names, pinned by a test (R6); every refusal names a fix that can succeed for the corpus it names (R10); no
fallback when `adr` or its answer is missing (R5, R11)

**Scale/Scope**: this repo has three corpora (17 + 6 + 2 records) with overlapping ids; a round reviews at most
`max_review_files` (50) files (R16), well under adrkit's fixed marker-scan cap of 3000; adrkit's 64 markers per file
is a refusal, not a limit the plugin works around

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Answer |
|---|---|
| I. Contract-first | The shapes are those of adrkit's published `@adrkit/core`; the gate is an adapter, and any other shape is a corpus not checked (R5). No second validator: adrkit alone loads and judges a record. The rule names are a copy of adrkit's, justified in Complexity Tracking and pinned by a test (R6). Pass with that entry. |
| II. Ownership & trust boundaries | All in this repo. `ALQ_ORG_ADR_DIR` and adrkit's output are validated where they enter (`adrkit.py`). The org's records are read, never written. Nothing public. Pass. |
| III. Fail loud, no workarounds, no backwards compatibility | Every way the check can fail is a cause with its next step, and the result names it whenever its refusal does not block (data-model); nothing degrades to "no decisions". One adrkit version; no tolerance for another. Pass. |
| IV. Test-first | Each scenario of the spec is a test written to fail first (R14). Pass. |
| V. Smallest complete change | No cache, no planning-time check, no audit check, no ledger field. `changed_files` is generalised, not duplicated. The whole mechanism ships in one PR because a check that cannot refuse would pass silently (spec, one story). Pass. |
| VI. Governing rule ships apart | ADR-0020 and the constitution lines (R13, T002) are their own PR, merged first. The README changes with the code it describes, as in spec 019. Pass. |
| P1. Code decides | The check, the reviewer's seat in `expected`, every refusal and the notices are decided in the gate; the agent is told nothing it could skip. Each refusal ends with its next step (R10). Pass. |
| P2. Only an approved entity releases a hold | No hold, lock or count is added. A refused launch holds nothing: the next launch checks again. The user releases the check by setting `decision_checks` to `log` (R15, ADR-0011). Pass. |
| P3. Rules are pure | The rules in `decisions.py` are functions of adrkit's answers; `adrkit.py` and the gate do the I/O; `review-round.js` only echoes `decisions` (R6, R9). Pass. |
| P4. A check that could not run is its own outcome | Every way the check can fail is a "could not run" outcome of its corpus, never a pass or a finding against the author (data-model). A matcher adrkit cannot evaluate here is a named notice, not silence. Pass. |

Re-check after Phase 1: unchanged.

## Project Structure

### Documentation (this feature)

```text
specs/020-decision-review/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/interfaces.md
├── checklists/requirements.md
└── tasks.md                    # /speckit-tasks
```

### Source Code (repository root)

ADR first, its own PR (branch `88-adr-notice`):

```text
dev/alq-review/docs/adr/0020-run-the-round-with-a-notice-for-a-matcher-adrkit-cannot-evaluate-here.md
dev/alq-review/.specify/memory/constitution.md   # R13, T002
```

Then the code (branch `88-us1-decision-review`):

```text
plugins/alq-review/
├── scripts/
│   ├── adrkit.py              # new: the adrkit boundary (R5)
│   ├── adrkit_corpus.mjs      # new: runs adrkit's library for one corpus (R4)
│   ├── decisions.py           # new: the pure rules (R6)
│   ├── gate.py                # main takes the deadline; handle/on_workflow carry it; step timings; the file limit;
│   │                          #      _governance(); the refusals; on_agent covers the decision reviewer; the
│   │                          #      decision-review gate.log line on assessment; HOOK_SECONDS, ANSWER_MARGIN
│   ├── hookio.py              # decision_checks_mode(); max_review_files(); refuse_decision(); block_decision()
│   ├── briefs.py              # DECISION_REVIEWER; REVIEWERS includes it; review_range(); _scope(); _decision_prompt();
│   │                          #      waves(); review_args takes governance and injects args.decisions
│   └── worktree.py            # files_in(root, rev_range) replaces changed_files; tracked corpora; files not as HEAD
├── workflows/review-round.js  # returns decisions: args.decisions on every path
├── agents/decision-reviewer.md
├── .claude-plugin/plugin.json # 0.14.0
├── config.json                # "decision_checks": "enforce", "max_review_files": 50
├── hooks/hooks.json           # unchanged; its 60 s timeout is pinned by a test
└── README.md                  # T016, contracts/interfaces.md § README
dev/alq-review/tests/
├── test_decisions.py          # new: the pure rules, contract tests against the real adrkit, rule-name pin
├── test_adrkit.py             # new: the boundary
├── fixtures/adrkit/           # new: a fixture corpus (outside any docs/adr path) and adrkit's captured answer on it
├── test_gate.py               # DecisionReview, HookDeadline
├── test_agents.py             # DecisionReviewer tools
├── test_worktree_facts.py     # files_in; review_args signature
└── paths.py                   # HARNESS
.github/workflows/tests.yml    # setup-node 22; the pinned adrkit install
```

**Structure Decision**: the plugin's existing split: one boundary module per outside service (`github.py`,
`worktree.py`, now `adrkit.py`), pure rules beside them (`policy.py`, `specbinding.py`, now `decisions.py`), the gate
as the only handler, the workflow as orchestration. Callers of what changes, read in the code: `worktree.changed_files`
is called by `briefs._audit_prompt` and tests `test_worktree_facts` (lines 403, 456); `briefs.review_args` by
`gate.on_workflow` and `test_worktree_facts.RoundFacts`; `briefs.REVIEWERS` by `gate.track_subagent`;
`briefs.INTERNAL_REVIEWERS` by `gate.on_agent`, `gate.on_workflow`, `test_gate`, `test_switch`; `gate.handle` by
`gate.main` and the hook driver in `test_gate` (through `main`); `review-round.js`'s returns by the launching agent
and `test_gate` through `workflow_harness.mjs`; `hooks.json`'s timeout by Claude Code.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| `decisions.py` re-declares the adrkit rule names it sorts by (constitution I: no re-declared type-name list) | The spec's rules turn on adrkit's rule names, and adrkit exports no list of them | The copy is pinned to the installed adrkit by a test (R6). Records are loaded by adrkit's library (R4), so no parser, status list or discovery rule is copied |

## Open points

Settled by reading, not by the user: the deadline margin is 5 s (R7); `adr` is required only when a corpus is to be
checked (R11); an org path that coincides with a repo corpus is checked once as the org corpus, as the spec's edge case
says, which reverses PR #92's choice (R3). A repo corpus holding a file not as HEAD has it is not checked (R18), so
the corpus adrkit reads is HEAD's.
